use std::{
    cell::Cell,
    rc::Rc,
    time::{Duration, Instant},
};

use gpui::Context;

use crate::{Player, audio::Snapshot};

#[derive(Clone, Copy, Default)]
pub struct Paint {
    pub first: Option<Instant>,
    pub renders: usize,
    pub scroll: f32,
}

enum Phase {
    Starting,
    Paused(Instant, f64),
    Resuming,
    Sampling {
        start: Instant,
        initial: Snapshot,
        paint: Paint,
    },
}

pub struct Benchmark {
    startup: Instant,
    duration: Duration,
    phase: Phase,
    paint: Rc<Cell<Paint>>,
    row: Option<usize>,
    changes: usize,
}

impl Benchmark {
    pub fn new(startup: Instant, seconds: u64, paint: Rc<Cell<Paint>>) -> Self {
        Self {
            startup,
            duration: Duration::from_secs(seconds),
            phase: Phase::Starting,
            paint,
            row: None,
            changes: 0,
        }
    }

    pub fn tick(
        &mut self,
        player: &mut Player,
        cx: &mut Context<Player>,
    ) -> Option<Result<(), String>> {
        let snapshot = player.snapshot;
        match self.phase {
            Phase::Starting => {
                if self.startup.elapsed() > Duration::from_secs(8) {
                    return Some(Err("Playback did not advance at startup".into()));
                }
                if self.startup.elapsed() >= Duration::from_millis(800)
                    && snapshot.position_ms > 250.0
                {
                    if !player.toggle() {
                        return Some(Err("Pause was rejected".into()));
                    }
                    self.phase = Phase::Paused(Instant::now(), snapshot.position_ms);
                    cx.notify();
                }
            }
            Phase::Paused(start, position) if start.elapsed() >= Duration::from_millis(450) => {
                if snapshot.playing() || (snapshot.position_ms - position).abs() > 320.0 {
                    return Some(Err("Playback did not pause".into()));
                }
                if !player.seek(2000.0 / snapshot.duration_ms)
                    || (player.snapshot.position_ms - 2000.0).abs() > 200.0
                {
                    return Some(Err("Seek did not land at 2 seconds".into()));
                }
                if !player.toggle() {
                    return Some(Err("Resume was rejected".into()));
                }
                self.phase = Phase::Resuming;
                cx.notify();
            }
            Phase::Resuming => {
                if self.startup.elapsed() > Duration::from_secs(12) {
                    return Some(Err("Playback did not resume".into()));
                }
                if snapshot.playing() && snapshot.position_ms >= 3000.0 {
                    self.phase = Phase::Sampling {
                        start: Instant::now(),
                        initial: snapshot,
                        paint: self.paint.get(),
                    };
                    self.row = player.active;
                    println!("READY");
                }
            }
            Phase::Sampling {
                start,
                initial,
                paint,
            } => {
                if self.row != player.active {
                    self.row = player.active;
                    self.changes += 1;
                }
                if start.elapsed() >= self.duration {
                    let advanced = snapshot.position_ms - initial.position_ms;
                    let glitches = snapshot.glitches - initial.glitches;
                    let rendered = self.paint.get();
                    let renders = rendered.renders - paint.renders;
                    let scroll = rendered.scroll - paint.scroll;
                    let first = rendered.first.map_or("null".into(), |instant| {
                        format!("{:.2}", (instant - self.startup).as_secs_f64() * 1000.0)
                    });
                    println!(
                        "{{\"first_paint_ms\":{first},\"sample_seconds\":{:.3},\"advanced_ms\":{advanced:.2},\"glitches\":{glitches},\"lyric_changes\":{},\"scroll_travel_px\":{scroll:.2},\"renders\":{renders}}}",
                        start.elapsed().as_secs_f64(),
                        self.changes
                    );
                    return Some(
                        if advanced < 950.0 * self.duration.as_secs_f64()
                            || glitches != 0
                            || self.changes == 0
                            || scroll <= 0.0
                            || renders == 0
                        {
                            Err("Benchmark failed playback, lyric scrolling, paint, or underrun checks".into())
                        } else {
                            Ok(())
                        },
                    );
                }
            }
            _ => {}
        }
        None
    }
}
