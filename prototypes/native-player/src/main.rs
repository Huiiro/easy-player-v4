mod audio;
mod lyrics;
mod measure;

use std::{
    cell::RefCell,
    error::Error,
    path::{Path, PathBuf},
    rc::Rc,
    time::{Duration, Instant},
};

use audio::{Audio, Snapshot};
use slint::{ComponentHandle, ModelRc, SharedString, Timer, TimerMode, VecModel};

slint::include_modules!();

#[link(name = "ole32")]
unsafe extern "system" {
    fn OleInitialize(reserved: *mut std::ffi::c_void) -> i32;
    fn OleUninitialize();
}

struct UiApartment;

impl UiApartment {
    fn initialize() -> Result<Self, String> {
        // Winit and the file picker need an STA. WASAPI accepts a host-owned STA.
        let result = unsafe { OleInitialize(std::ptr::null_mut()) };
        if result < 0 {
            return Err(format!(
                "Could not initialize the UI's COM apartment ({result:#x})"
            ));
        }
        Ok(Self)
    }
}

impl Drop for UiApartment {
    fn drop(&mut self) {
        unsafe { OleUninitialize() };
    }
}

struct Session {
    audio: Audio,
    track: Option<PathBuf>,
    lyrics: Vec<lyrics::Line>,
    last_device_service: Instant,
}

impl Session {
    fn open(&mut self, ui: &Player, track: &Path, lyric_path: Option<&Path>) -> Result<(), String> {
        ui.set_loaded(false);
        ui.set_playing(false);
        ui.set_position(0.0);
        ui.set_time_label("0:00 / 0:00".into());
        ui.set_track("尚未打开音频".into());
        self.track = None;
        self.show_lyrics(ui, Vec::new());
        if !self.audio.open(track) {
            return Err(format!("无法打开音频：{}", track.display()));
        }
        self.track = Some(track.to_owned());
        ui.set_loaded(true);
        ui.set_track(
            track
                .file_name()
                .unwrap_or(track.as_os_str())
                .to_string_lossy()
                .as_ref()
                .into(),
        );
        let sidecar = track.with_extension("lrc");
        let lyric_path = lyric_path.or_else(|| sidecar.is_file().then_some(sidecar.as_path()));
        if let Some(path) = lyric_path {
            self.open_lyrics(ui, path);
        } else {
            ui.set_status("未找到同名 LRC，可手动选择歌词".into());
        }
        if !self.audio.set_playing(true) {
            return Err("无法开始播放，请检查默认音频设备".into());
        }
        self.refresh(ui);
        Ok(())
    }

    fn open_lyrics(&mut self, ui: &Player, path: &Path) {
        match lyrics::read(path) {
            Ok(lines) => {
                let count = lines.len();
                self.show_lyrics(ui, lines);
                ui.set_status(format!("已加载 {count} 行 LRC 歌词").into());
                self.refresh(ui);
            }
            Err(error) => ui.set_status(format!("无法读取歌词：{error}").into()),
        }
    }

    fn show_lyrics(&mut self, ui: &Player, lines: Vec<lyrics::Line>) {
        let labels = lines
            .iter()
            .map(|line| SharedString::from(line.text.as_str()))
            .collect::<Vec<_>>();
        self.lyrics = lines;
        ui.set_current_line(-1);
        ui.set_lines(ModelRc::new(VecModel::from(labels)));
    }

    fn ensure_open(&self) -> bool {
        !self.audio.snapshot(false).stopped()
            || self
                .track
                .as_deref()
                .is_some_and(|path| self.audio.open(path))
    }

    fn refresh(&mut self, ui: &Player) -> Snapshot {
        let service = self.last_device_service.elapsed() >= Duration::from_millis(100);
        if service {
            self.last_device_service = Instant::now();
        }
        let snapshot = self.audio.snapshot(service);
        if !ui.get_loaded() {
            return snapshot;
        }
        let seconds = (snapshot.position_ms / 1000.0) as u64;
        let duration = (snapshot.duration_ms / 1000.0) as u64;
        let label = format!(
            "{}:{:02} / {}:{:02}",
            seconds / 60,
            seconds % 60,
            duration / 60,
            duration % 60
        );
        if ui.get_time_label().as_str() != label {
            ui.set_time_label(label.into());
        }
        if snapshot.duration_ms > 0.0 {
            let progress = (snapshot.position_ms / snapshot.duration_ms).clamp(0.0, 1.0) as f32;
            if ui.get_position() != progress {
                ui.set_position(progress);
            }
        }
        if ui.get_playing() != snapshot.playing() {
            ui.set_playing(snapshot.playing());
        }
        let active = lyrics::active_line(&self.lyrics, snapshot.position_ms as u64)
            .map_or(-1, |index| index as i32);
        if ui.get_current_line() != active {
            ui.set_current_line(active);
        }
        snapshot
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    let startup = Instant::now();
    let mut args = std::env::args_os().skip(1);
    let first = args.next();
    let (measure, track) = if first.as_deref().is_some_and(|arg| arg == "--measure") {
        let seconds: u64 = args
            .next()
            .ok_or("Specify benchmark duration in seconds")?
            .to_str()
            .ok_or("Invalid benchmark duration")?
            .parse()?;
        if seconds < 6 {
            return Err("Benchmark duration must be at least 6 seconds".into());
        }
        (
            Some(seconds),
            Some(PathBuf::from(
                args.next().ok_or("Specify the benchmark audio file")?,
            )),
        )
    } else {
        (None, first.map(PathBuf::from))
    };
    let lyric_path = args.next().map(PathBuf::from);
    if args.next().is_some() {
        return Err("Usage: easy-player-native-ui [--measure SECONDS] [AUDIO [LRC]]".into());
    }

    let _apartment = UiApartment::initialize()?;
    let ui = Player::new()?;
    let audio = Audio::new(if measure.is_some() { 0.0 } else { 0.65 })
        .ok_or("Could not initialize WASAPI shared")?;
    let session = Rc::new(RefCell::new(Session {
        audio,
        track: None,
        lyrics: Vec::new(),
        last_device_service: Instant::now(),
    }));

    if let Some(track) = &track {
        if let Err(error) = session.borrow_mut().open(&ui, track, lyric_path.as_deref()) {
            if measure.is_some() {
                return Err(error.into());
            }
            ui.set_status(error.into());
        }
    }

    ui.on_open_audio({
        let weak = ui.as_weak();
        let session = session.clone();
        move || {
            let file = rfd::FileDialog::new()
                .add_filter(
                    "音频",
                    &[
                        "mp3", "flac", "wav", "m4a", "ogg", "opus", "aiff", "dsf", "dff",
                    ],
                )
                .pick_file();
            if let (Some(ui), Some(file)) = (weak.upgrade(), file) {
                if let Err(error) = session.borrow_mut().open(&ui, &file, None) {
                    ui.set_status(error.into());
                }
            }
        }
    });
    ui.on_open_lyrics({
        let weak = ui.as_weak();
        let session = session.clone();
        move || {
            let file = rfd::FileDialog::new()
                .add_filter("LRC", &["lrc"])
                .pick_file();
            if let (Some(ui), Some(file)) = (weak.upgrade(), file) {
                session.borrow_mut().open_lyrics(&ui, &file);
            }
        }
    });
    ui.on_toggle_play({
        let weak = ui.as_weak();
        let session = session.clone();
        move || {
            if let Some(ui) = weak.upgrade() {
                let mut session = session.borrow_mut();
                if !session.ensure_open() || !session.audio.set_playing(!ui.get_playing()) {
                    ui.set_status("无法切换播放状态".into());
                }
                session.refresh(&ui);
            }
        }
    });
    ui.on_seek({
        let weak = ui.as_weak();
        let session = session.clone();
        move |fraction| {
            if let Some(ui) = weak.upgrade() {
                let mut session = session.borrow_mut();
                let duration = session.audio.snapshot(false).duration_ms;
                if !session.ensure_open()
                    || !session
                        .audio
                        .seek(duration * f64::from(fraction.clamp(0.0, 1.0)))
                {
                    ui.set_status("无法跳转到该播放位置".into());
                }
                session.refresh(&ui);
            }
        }
    });

    let timer = Timer::default();
    timer.start(TimerMode::Repeated, Duration::from_millis(40), {
        let weak = ui.as_weak();
        let session = session.clone();
        move || {
            if let Some(ui) = weak.upgrade() {
                session.borrow_mut().refresh(&ui);
            }
        }
    });
    if let Some(seconds) = measure {
        measure::run(&ui, session, startup, seconds)?;
    } else {
        ui.run()?;
    }
    Ok(())
}
