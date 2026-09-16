/** Smooth confirmed millisecond samples and extrapolate only during known playback. */
export class LyricClock {
  private from = 0
  private target = 0
  private receivedAt = 0
  private duration = 0
  private initialized = false
  private playing = false

  sample(time: number, now: number, playing = false): void {
    const value = Number.isFinite(time) ? time : 0
    const elapsed = now - this.receivedAt
    const jump = value - this.target
    const previous = this.read(now)
    this.from = !this.initialized || jump < 0 || Math.abs(jump - elapsed) > 300 ? value : previous
    // Cover the complete sample interval: a 250ms source must not animate for
    // 120ms and then freeze for the remaining 130ms on every update.
    this.duration = this.from === value ? 0 : Math.min(500, Math.max(16, elapsed))
    this.target = value
    this.receivedAt = now
    this.playing = playing
    this.initialized = true
  }

  read(now: number): number {
    const progress =
      this.duration === 0 ? 1 : Math.min(1, Math.max(0, (now - this.receivedAt) / this.duration))
    const interpolated = this.from + (this.target - this.from) * progress
    // Position events arrive much less frequently than animation frames. Once
    // their interpolation window is exhausted, keep the clock advancing while
    // playback is known to be active instead of freezing until the next IPC
    // sample. The next sample still corrects drift and seeks immediately.
    return this.playing && progress === 1
      ? interpolated + Math.max(0, now - (this.receivedAt + this.duration))
      : interpolated
  }

  isMoving(now: number): boolean {
    return this.playing || now < this.receivedAt + this.duration
  }
}
