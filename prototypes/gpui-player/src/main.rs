#[path = "../../native-player/src/audio.rs"]
mod audio;
#[path = "../../native-player/src/lyrics.rs"]
mod lyrics;
mod measure;

use std::{
    cell::{Cell, RefCell},
    error::Error,
    path::{Path, PathBuf},
    rc::Rc,
    time::{Duration, Instant},
};

use audio::{Audio, Snapshot};
use gpui::{
    App, Application, Bounds, Context, FontWeight, MouseButton, Pixels, Point, SharedString,
    TitlebarOptions, Window, WindowBounds, WindowOptions, canvas, div, prelude::*, px, relative,
    rgb, size,
};
use measure::{Benchmark, Paint};

const ROW: f32 = 56.0;
const SCROLL_TIME: f32 = 0.280;

struct Scroll {
    from: f32,
    target: f32,
    started: Instant,
}

impl Scroll {
    fn position(&self) -> f32 {
        let t = (self.started.elapsed().as_secs_f32() / SCROLL_TIME).min(1.0);
        self.from + (self.target - self.from) * (1.0 - (1.0 - t).powi(3))
    }
}

struct Player {
    audio: Audio,
    track: Option<PathBuf>,
    name: SharedString,
    status: SharedString,
    lyrics: Vec<lyrics::Line>,
    labels: Vec<SharedString>,
    active: Option<usize>,
    scroll: Scroll,
    snapshot: Snapshot,
    last_device_check: Instant,
    rail: Rc<Cell<Bounds<Pixels>>>,
    seek_preview: Option<f64>,
    paint: Option<Rc<Cell<Paint>>>,
}

impl Player {
    fn new(audio: Audio, paint: Option<Rc<Cell<Paint>>>) -> Self {
        Self {
            audio,
            track: None,
            name: "尚未打开音频".into(),
            status: "打开本地音频以开始播放".into(),
            lyrics: Vec::new(),
            labels: Vec::new(),
            active: None,
            scroll: Scroll {
                from: 0.0,
                target: 0.0,
                started: Instant::now(),
            },
            snapshot: Snapshot::default(),
            last_device_check: Instant::now(),
            rail: Rc::default(),
            seek_preview: None,
            paint,
        }
    }

    fn open(&mut self, track: &Path, lyrics: Option<&Path>) -> Result<(), String> {
        self.track = None;
        self.name = "尚未打开音频".into();
        self.lyrics.clear();
        self.labels.clear();
        self.active = None;
        self.scroll = Scroll {
            from: 0.0,
            target: 0.0,
            started: Instant::now(),
        };
        self.seek_preview = None;
        self.snapshot = Snapshot::default();
        if !self.audio.open(track) {
            return Err(format!("无法打开音频：{}", track.display()));
        }
        self.track = Some(track.to_owned());
        self.name = track
            .file_name()
            .unwrap_or(track.as_os_str())
            .to_string_lossy()
            .into_owned()
            .into();
        let sidecar = track.with_extension("lrc");
        if let Some(lyrics) = lyrics.or_else(|| sidecar.is_file().then_some(sidecar.as_path())) {
            self.open_lyrics(lyrics);
        } else {
            self.status = "未找到同名 LRC，可手动选择歌词".into();
        }
        if !self.audio.set_playing(true) {
            return Err("无法开始播放，请检查默认音频设备".into());
        }
        self.refresh();
        Ok(())
    }

    fn open_lyrics(&mut self, path: &Path) {
        match lyrics::read(path) {
            Ok(lines) => {
                self.status = format!("已加载 {} 行 LRC 歌词", lines.len()).into();
                self.labels = lines.iter().map(|line| line.text.clone().into()).collect();
                self.lyrics = lines;
                self.refresh();
            }
            Err(error) => self.status = format!("无法读取歌词：{error}").into(),
        }
    }

    fn ensure_open(&self) -> bool {
        !self.snapshot.stopped()
            || self
                .track
                .as_deref()
                .is_some_and(|path| self.audio.open(path))
    }

    fn toggle(&mut self) -> bool {
        let ok = self.ensure_open() && self.audio.set_playing(!self.snapshot.playing());
        if !ok {
            self.status = "无法切换播放状态".into();
        }
        self.refresh();
        ok
    }

    fn seek(&mut self, fraction: f64) -> bool {
        let ms = self.snapshot.duration_ms * fraction;
        let ok = self.ensure_open() && self.audio.seek(ms);
        if !ok {
            self.status = "无法跳转到该播放位置".into();
        }
        self.refresh();
        ok
    }

    fn refresh(&mut self) -> bool {
        let service = self.last_device_check.elapsed() >= Duration::from_millis(100);
        if service {
            self.last_device_check = Instant::now();
        }
        let snapshot = self.audio.snapshot(service);
        let changed = self.snapshot.position_ms != snapshot.position_ms
            || self.snapshot.playing() != snapshot.playing();
        self.snapshot = snapshot;
        let active = lyrics::active_line(&self.lyrics, snapshot.position_ms as u64);
        if active == self.active {
            return changed;
        }
        self.active = active;
        self.scroll = Scroll {
            from: self.scroll.position(),
            target: active.unwrap_or(0) as f32 * ROW,
            started: Instant::now(),
        };
        true
    }

    fn fraction_at(&self, position: Point<Pixels>) -> f64 {
        let bounds = self.rail.get();
        let width = f32::from(bounds.size.width).max(1.0);
        f64::from((f32::from(position.x - bounds.origin.x) / width).clamp(0.0, 1.0))
    }

    fn finish_seek(&mut self, position: Point<Pixels>, cx: &mut Context<Self>) {
        if self.seek_preview.take().is_some() {
            self.seek(self.fraction_at(position));
            cx.notify();
        }
    }
}

fn clock(ms: f64) -> String {
    let seconds = (ms / 1000.0) as u64;
    format!("{}:{:02}", seconds / 60, seconds % 60)
}

impl Render for Player {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let track_loaded = self.track.is_some();
        let position = self
            .seek_preview
            .map_or(self.snapshot.position_ms, |fraction| {
                fraction * self.snapshot.duration_ms
            });
        let progress = (position / self.snapshot.duration_ms.max(1.0)).clamp(0.0, 1.0) as f32;
        let offset = self.scroll.position();
        if (offset - self.scroll.target).abs() > 0.01 {
            window.request_animation_frame();
        }
        let visible = (f32::from(window.viewport_size().height) / ROW).ceil() as usize + 2;
        let first = ((offset / ROW) as usize).saturating_sub(visible / 2);
        let rows = self
            .labels
            .iter()
            .enumerate()
            .skip(first)
            .take(visible)
            .map(|(index, line)| {
                let selected = self.active == Some(index);
                div()
                    .absolute()
                    .top(relative(0.5))
                    .mt(px(index as f32 * ROW - offset - ROW / 2.0))
                    .left_0()
                    .w_full()
                    .px(px(30.0))
                    .h(px(ROW))
                    .flex()
                    .justify_center()
                    .items_center()
                    .text_center()
                    .text_color(rgb(if selected { 0xf3f6ff } else { 0x9eaaca }))
                    .text_size(px(if selected { 23.0 } else { 17.0 }))
                    .font_weight(if selected {
                        FontWeight::BOLD
                    } else {
                        FontWeight::NORMAL
                    })
                    .child(div().w_full().overflow_hidden().child(line.clone()))
            });

        div()
            .size_full()
            .relative()
            .flex()
            .flex_col()
            .gap(px(12.0))
            .px(px(34.0))
            .pt(px(22.0))
            .pb(px(20.0))
            .bg(rgb(0x111831))
            .text_color(rgb(0xf3f6ff))
            .text_size(px(14.0))
            .on_mouse_move(cx.listener(|this, event: &gpui::MouseMoveEvent, _, cx| {
                if this.seek_preview.is_some() {
                    this.seek_preview = Some(this.fraction_at(event.position));
                    cx.notify();
                }
            }))
            .on_mouse_up_out(
                MouseButton::Left,
                cx.listener(|this, event: &gpui::MouseUpEvent, _, cx| {
                    this.finish_seek(event.position, cx);
                }),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.0))
                    .child(
                        div()
                            .flex_1()
                            .text_size(px(24.0))
                            .font_weight(FontWeight::BOLD)
                            .child("Easy Player"),
                    )
                    .child(button("open-audio", "打开音频", true).on_click(cx.listener(
                        |this, _, _, cx| {
                            if let Some(track) = rfd::FileDialog::new()
                                .add_filter(
                                    "音频",
                                    &[
                                        "mp3", "flac", "wav", "m4a", "ogg", "opus", "aiff", "dsf",
                                        "dff",
                                    ],
                                )
                                .pick_file()
                            {
                                if let Err(error) = this.open(&track, None) {
                                    this.status = error.into();
                                }
                                cx.notify();
                            }
                        },
                    )))
                    .child(
                        button("open-lrc", "选择歌词", track_loaded).on_click(cx.listener(
                            |this, _, _, cx| {
                                if this.track.is_some()
                                    && let Some(path) = rfd::FileDialog::new()
                                        .add_filter("LRC", &["lrc"])
                                        .pick_file()
                                {
                                    this.open_lyrics(&path);
                                    cx.notify();
                                }
                            },
                        )),
                    ),
            )
            .child(
                div()
                    .relative()
                    .flex_1()
                    .min_h(px(0.0))
                    .rounded(px(16.0))
                    .overflow_hidden()
                    .bg(rgb(0x192341))
                    .when(self.labels.is_empty(), |pane| {
                        pane.flex()
                            .items_center()
                            .justify_center()
                            .text_color(rgb(0xaab6d2))
                            .child(if track_loaded {
                                "暂无同步歌词"
                            } else {
                                "歌词"
                            })
                    })
                    .children(rows),
            )
            .child(
                div()
                    .text_size(px(17.0))
                    .truncate()
                    .child(self.name.clone()),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(12.0))
                    .child(
                        button(
                            "toggle",
                            if self.snapshot.playing() {
                                "暂停"
                            } else {
                                "播放"
                            },
                            track_loaded,
                        )
                        .on_click(cx.listener(|this, _, _, cx| {
                            if this.track.is_some() {
                                this.toggle();
                                cx.notify();
                            }
                        })),
                    )
                    .child(
                        div()
                            .relative()
                            .flex_1()
                            .h(px(24.0))
                            .flex()
                            .items_center()
                            .cursor_pointer()
                            .on_mouse_down(
                                MouseButton::Left,
                                cx.listener(|this, event: &gpui::MouseDownEvent, _, cx| {
                                    if this.track.is_some() {
                                        this.seek_preview = Some(this.fraction_at(event.position));
                                        cx.notify();
                                    }
                                }),
                            )
                            .on_mouse_up(
                                MouseButton::Left,
                                cx.listener(|this, event: &gpui::MouseUpEvent, _, cx| {
                                    this.finish_seek(event.position, cx);
                                }),
                            )
                            .on_mouse_up_out(
                                MouseButton::Left,
                                cx.listener(|this, event: &gpui::MouseUpEvent, _, cx| {
                                    this.finish_seek(event.position, cx);
                                }),
                            )
                            .child(
                                div()
                                    .w_full()
                                    .h(px(4.0))
                                    .rounded_full()
                                    .bg(rgb(0x33405c))
                                    .child(
                                        div()
                                            .w(relative(progress))
                                            .h_full()
                                            .rounded_full()
                                            .bg(rgb(0x79c7f8)),
                                    ),
                            )
                            .child(
                                canvas(
                                    {
                                        let rail = self.rail.clone();
                                        move |bounds, _, _| rail.set(bounds)
                                    },
                                    |_, _, _, _| {},
                                )
                                .absolute()
                                .inset_0(),
                            ),
                    )
                    .child(format!(
                        "{} / {}",
                        clock(position),
                        clock(self.snapshot.duration_ms)
                    )),
            )
            .child(
                div()
                    .text_color(rgb(0xaab6d2))
                    .truncate()
                    .child(self.status.clone()),
            )
            .when_some(self.paint.clone(), |root, paint| {
                root.child(
                    canvas(
                        |_, _, _| (),
                        move |_, (), _, _| {
                            let mut sample = paint.get();
                            sample.first.get_or_insert_with(Instant::now);
                            sample.renders += 1;
                            sample.scroll = offset;
                            paint.set(sample);
                        },
                    )
                    .absolute()
                    .size(px(0.0)),
                )
            })
    }
}

fn button(id: &'static str, text: &'static str, enabled: bool) -> gpui::Stateful<gpui::Div> {
    div()
        .id(id)
        .rounded(px(6.0))
        .px(px(13.0))
        .py(px(5.0))
        .bg(rgb(0x25304e))
        .when(enabled, |button| {
            button
                .cursor_pointer()
                .hover(|style| style.bg(rgb(0x344261)))
        })
        .when(!enabled, |button| button.text_color(rgb(0x7890ad)))
        .child(text)
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
        if !(6..=300).contains(&seconds) {
            return Err("Benchmark duration must be 6–300 seconds".into());
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
        return Err("Usage: easy-player-gpui-ui [--measure SECONDS] [AUDIO [LRC]]".into());
    }
    let outcome = Rc::new(RefCell::new(measure.map_or(Ok(()), |_| {
        Err("Benchmark closed before completion".to_owned())
    })));
    Application::new().run({
        let outcome = outcome.clone();
        move |cx: &mut App| {
            let result = (|| -> Result<(), String> {
                let paint = measure.map(|_| Rc::new(Cell::new(Paint::default())));
                let mut player = Player::new(
                    Audio::new(if measure.is_some() { 0.0 } else { 0.65 })
                        .ok_or("Could not initialize WASAPI shared")?,
                    paint.clone(),
                );
                if let Some(track) = track {
                    if let Err(error) = player.open(&track, lyric_path.as_deref()) {
                        if measure.is_some() {
                            return Err(error);
                        }
                        player.status = error.into();
                    }
                }
                if measure.is_some() && player.lyrics.len() < 2 {
                    return Err("Benchmark needs at least two timed lyric lines".into());
                }
                let bounds = Bounds::centered(None, size(px(840.0), px(620.0)), cx);
                let window = cx
                    .open_window(
                        WindowOptions {
                            window_bounds: Some(WindowBounds::Windowed(bounds)),
                            window_min_size: Some(size(px(460.0), px(400.0))),
                            titlebar: Some(TitlebarOptions {
                                title: Some("Easy Player · GPUI".into()),
                                appears_transparent: false,
                                traffic_light_position: None,
                            }),
                            ..Default::default()
                        },
                        |_, cx| cx.new(|_| player),
                    )
                    .map_err(|err| err.to_string())?;
                window
                    .update(cx, |_, _, cx| {
                        let mut benchmark = measure
                            .zip(paint)
                            .map(|(seconds, paint)| Benchmark::new(startup, seconds, paint));
                        let outcome = outcome.clone();
                        cx.spawn(async move |view, cx| {
                            loop {
                                cx.background_executor()
                                    .timer(Duration::from_millis(40))
                                    .await;
                                if view
                                    .update(cx, |player, cx| {
                                        if player.refresh() {
                                            cx.notify();
                                        }
                                        if let Some(result) = benchmark
                                            .as_mut()
                                            .and_then(|bench| bench.tick(player, cx))
                                        {
                                            *outcome.borrow_mut() = result;
                                            cx.quit();
                                        }
                                    })
                                    .is_err()
                                {
                                    break;
                                }
                            }
                        })
                        .detach();
                    })
                    .map_err(|err| err.to_string())?;
                cx.on_window_closed(|cx| {
                    if cx.windows().is_empty() {
                        cx.quit();
                    }
                })
                .detach();
                cx.activate(true);
                Ok(())
            })();
            if let Err(error) = result {
                *outcome.borrow_mut() = Err(error);
                cx.quit();
            }
        }
    });
    outcome.replace(Ok(())).map_err(Into::into)
}
