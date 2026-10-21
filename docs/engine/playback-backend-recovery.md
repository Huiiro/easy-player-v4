# Playback failure reporting and speed tail handling

WASAPI and DirectSound start waits for the render thread's actual device-start
result. Failure joins the thread and returns false, allowing AudioEngine to report
the error without entering Playing. A runtime render error is exposed through
BackendEventFailure and serviced by the Windows host's existing 100 ms timer.
The engine releases the failed output, enters Stopped and reports an error.
It does not automatically switch devices or retry a persistently broken output.

Both Windows backends implement flush_checked. WASAPI checks Stop, Reset and
restart; DirectSound checks Stop, cursor reset, Lock, Unlock and Play. A failed
seek flush returns false to the engine, which stops playback and reports failure.

For speed-adjusted playback, stream_drained now waits for both SRC and SoundTouch.
After SRC exhausts its output, preallocated 128-frame silence blocks push the
time-stretch tail through. Output is capped to the expected real-input duration;
padding is bounded to 200 blocks, matching SoundTouch's flush bound. This avoids
the temporary new[] allocation performed by SoundTouch::flush. Repeated EOF polls
produce no extra frames, and configure/reset clears all drain bookkeeping.

Regression coverage:

- windows_backend_failure_test exercises the real Windows backend methods and
  render threads with COM ABI stubs, including startup/render errors and each
  checked flush failure. It requires no audio device.
- audio_backend_recovery_test checks engine error/state propagation and prevents
  an automatic runtime-failure retry loop.
- dsp_stream_end_test checks 512-frame and one-second inputs at 0.5x, 0.75x, 1.5x
  and 2x, with matching sample rates and 44.1/48 kHz SRC in both directions,
  repeated EOF and reuse of the pipeline. Generated duration must be within
  16 frames of the expected duration and contain nonzero audio.

These changes do not implement hardware-buffer draining after EOF or fix the
other issues identified in the broader backend audit.

## Restart progress regression

Startup device selection could leave reopen_position_ms_=0 before any source was
opened. A later seek to the persisted position succeeded in Ready, but play()
applied the stale reopen snapshot and returned to zero. Opening a source now
discards old reopen snapshots; a seek before backend creation records the latest
requested resume point for both PCM and DoP.

Checkpoint persistence is also flushed synchronously before engine stop/database
shutdown on explicit quit, final-window close and normal will-quit. Repeated
cleanup after stop preserves the snapshot instead of saving idle position zero.
Run `node scripts/test-playback-checkpoint.mjs` for exit/restart persistence tests;
the native engine recovery test covers startup device selection followed by a
restore seek, and overriding an earlier device snapshot with a newer seek.
