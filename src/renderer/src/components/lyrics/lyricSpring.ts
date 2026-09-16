/** Analytic damped spring; position and velocity survive retargeting. */
export class LyricSpring {
  position: number
  velocity = 0
  target: number

  constructor(position = 0) {
    this.position = this.target = position
  }

  reset(position: number): void {
    this.position = this.target = position
    this.velocity = 0
  }

  step(seconds: number, frequency = 13, dampingRatio = 1): boolean {
    const dt = Math.max(0, Math.min(seconds, 0.064))
    const offset = this.position - this.target
    const damping = frequency * Math.max(0.1, Math.min(1, dampingRatio))
    const decay = Math.exp(-damping * dt)
    if (dampingRatio >= 1) {
      const impulse = this.velocity + frequency * offset
      this.position = this.target + (offset + impulse * dt) * decay
      this.velocity = (this.velocity - frequency * impulse * dt) * decay
    } else {
      const angular = Math.sqrt(frequency * frequency - damping * damping)
      const sine = Math.sin(angular * dt)
      const cosine = Math.cos(angular * dt)
      const coefficient = (this.velocity + damping * offset) / angular
      this.position = this.target + decay * (offset * cosine + coefficient * sine)
      this.velocity =
        decay * (this.velocity * cosine - (damping * coefficient + angular * offset) * sine)
    }
    if (Math.abs(this.position - this.target) < 0.05 && Math.abs(this.velocity) < 0.1) {
      this.reset(this.target)
      return false
    }
    return true
  }
}
