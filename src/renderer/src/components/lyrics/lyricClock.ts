/** Interpolate confirmed millisecond samples without predicting past a pause. */
export class LyricClock {
  private from = 0
  private target = 0
  private receivedAt = 0
  private duration = 0
  private initialized = false

  sample(time: number, now: number): void {
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
    this.initialized = true
  }

  read(now: number): number {
    const progress =
      this.duration === 0 ? 1 : Math.min(1, Math.max(0, (now - this.receivedAt) / this.duration))
    return this.from + (this.target - this.from) * progress
  }

  isMoving(now: number): boolean {
    return now < this.receivedAt + this.duration
  }
}
