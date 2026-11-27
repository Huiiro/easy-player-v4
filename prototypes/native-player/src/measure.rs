use std::{
    cell::RefCell,
    error::Error,
    fs::File,
    io::BufWriter,
    path::Path,
    rc::Rc,
    time::{Duration, Instant},
};

use slint::{ComponentHandle, RenderingState, Timer, TimerMode};

use crate::{Player, Session};

#[derive(Default)]
struct RenderProbe {
    first_frame: Option<Instant>,
    frame_started: Option<Instant>,
    costs_ms: Vec<f64>,
    sampling: bool,
}

pub fn run(
    ui: &Player,
    session: Rc<RefCell<Session>>,
    startup: Instant,
    seconds: u64,
) -> Result<(), Box<dyn Error>> {
    if session.borrow().lyrics.len() < 2 {
        return Err("Benchmark needs at least two timed lyric lines".into());
    }
    let render = Rc::new(RefCell::new(RenderProbe::default()));
    let renderer_timing = ui
        .window()
        .set_rendering_notifier({
            let render = render.clone();
            move |state, _| {
                let mut probe = render.borrow_mut();
                match state {
                    RenderingState::BeforeRendering => probe.frame_started = Some(Instant::now()),
                    RenderingState::AfterRendering => {
                        probe.first_frame.get_or_insert_with(Instant::now);
                        if probe.sampling
                            && let Some(start) = probe.frame_started
                        {
                            probe.costs_ms.push(start.elapsed().as_secs_f64() * 1000.0);
                        }
                    }
                    _ => {}
                }
            }
        })
        .is_ok();
    let timer = Timer::default();
    let result = Rc::new(RefCell::new(Err(String::from(
        "Benchmark closed before completion",
    ))));
    let mut paused_at = None;
    let mut resumed = false;
    let mut sample = None;
    let mut last_row = -1;
    let mut changes = 0;
    timer.start(TimerMode::Repeated, Duration::from_millis(80), {
        let weak = ui.as_weak();
        let result = result.clone();
        move || {
            let Some(ui) = weak.upgrade() else { return };
            let elapsed = startup.elapsed();
            let snapshot = session.borrow().audio.snapshot(false);
            let complete = (|| -> Option<Result<(), String>> {
                if paused_at.is_none() && elapsed >= Duration::from_millis(800) && snapshot.position_ms > 250.0 {
                    ui.invoke_toggle_play();
                    paused_at = Some((Instant::now(), snapshot.position_ms));
                } else if !resumed && let Some((when, position)) = paused_at {
                    if when.elapsed() >= Duration::from_millis(450) {
                        if snapshot.playing() || (snapshot.position_ms - position).abs() > 320.0 {
                            return Some(Err("Playback did not pause".into()));
                        }
                        ui.invoke_seek((2000.0 / snapshot.duration_ms) as f32);
                        let seeked = session.borrow().audio.snapshot(false);
                        if (seeked.position_ms - 2000.0).abs() > 200.0 {
                            return Some(Err(format!("Seek landed at {:.0} ms", seeked.position_ms)));
                        }
                        ui.invoke_toggle_play();
                        resumed = true;
                    }
                }
                if !resumed && elapsed > Duration::from_secs(5) {
                    return Some(Err("Playback did not advance at startup".into()));
                }
                if !resumed {
                    return None;
                }
                if sample.is_none() && snapshot.playing() && snapshot.position_ms >= 3000.0 {
                    println!("READY");
                    render.borrow_mut().sampling = true;
                    sample = Some((Instant::now(), snapshot, ui.get_scroll_offset()));
                }
                let (started, initial, initial_scroll) = sample?;
                let row = ui.get_current_line();
                if row != last_row && row >= 0 {
                    if last_row >= 0 {
                        changes += 1;
                    }
                    last_row = row;
                }
                if started.elapsed() < Duration::from_secs(seconds) {
                    return None;
                }
                let advanced = snapshot.position_ms - initial.position_ms;
                let glitches = snapshot.glitches - initial.glitches;
                let scroll_travel = ui.get_scroll_offset() - initial_scroll;
                render.borrow_mut().sampling = false;
                if let Some(path) = std::env::var_os("EASY_PLAYER_UI_SNAPSHOT") {
                    if let Err(error) = save_snapshot(&ui, Path::new(&path)) {
                        eprintln!("Could not save the rendered window: {error}");
                    }
                }
                let mut probe = render.borrow_mut();
                probe.costs_ms.sort_by(f64::total_cmp);
                let count = probe.costs_ms.len();
                let percentile = |p: f64| {
                    probe.costs_ms.get(((count as f64 * p).ceil() as usize).saturating_sub(1))
                        .map_or("null".to_owned(), |value| format!("{value:.3}"))
                };
                let first = probe.first_frame
                    .map_or("null".to_owned(), |when| format!("{:.2}", (when - startup).as_secs_f64() * 1000.0));
                println!(
                    "{{\"first_render_ms\":{first},\"sample_seconds\":{:.3},\"advanced_ms\":{advanced:.2},\"glitches\":{glitches},\"lyric_changes\":{changes},\"scroll_travel_px\":{scroll_travel:.2},\"render_callbacks_available\":{renderer_timing},\"renders\":{count},\"render_callback_p95_ms\":{},\"render_callback_p99_ms\":{}}}",
                    started.elapsed().as_secs_f64(), percentile(0.95), percentile(0.99)
                );
                Some(if advanced < 950.0 * seconds as f64 || glitches != 0 || changes == 0 || scroll_travel <= 0.0 {
                    Err("Benchmark failed playback, lyric scrolling, or underrun checks".into())
                } else {
                    Ok(())
                })
            })();
            if let Some(outcome) = complete {
                *result.borrow_mut() = outcome;
                let _ = slint::quit_event_loop();
            }
        }
    });
    ui.run()?;
    result.replace(Ok(())).map_err(Into::into)
}

fn save_snapshot(ui: &Player, path: &Path) -> Result<(), Box<dyn Error>> {
    let pixels = ui.window().take_snapshot()?;
    let mut encoder = png::Encoder::new(
        BufWriter::new(File::create(path)?),
        pixels.width(),
        pixels.height(),
    );
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder
        .write_header()?
        .write_image_data(pixels.as_bytes())?;
    Ok(())
}
