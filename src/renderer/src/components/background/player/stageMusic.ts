export interface StageAudioSample {
  rms: number
  lowEnergy: number
  onsetStrength: number
  beatSequence: number
  bpm?: number
  spectrum?: readonly number[]
}

export interface StageMusicCue {
  energy: number
  low: number
  mid: number
  high: number
  section: number
  phase: number
  pulse: number
  kick: number
  chase: number
  beatSequence: number
}

const defaultPeriod = 60 / 110
const quiet = { energy: 0, low: 0, mid: 0, high: 0, section: 0 }

function unit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

function band(spectrum: readonly number[], start: number, end: number): number {
  let sum = 0
  let peak = 0
  for (let index = start; index < end; index++) {
    const value = unit(spectrum[index])
    sum += value * value
    peak = Math.max(peak, value)
  }
  // A narrow instrument fundamental should register alongside wider-band sound.
  const magnitude = 0.74 * Math.sqrt(sum / (end - start)) + 0.26 * peak
  return 1 - Math.exp(-magnitude * 3.1)
}

function follow(
  value: number,
  target: number,
  dt: number,
  attack: number,
  release: number
): number {
  return value + (target - value) * (1 - Math.exp(-dt / (target > value ? attack : release)))
}

export class StageMusic {
  private cue: StageMusicCue = {
    ...quiet,
    phase: 0,
    pulse: 0,
    kick: 0,
    chase: 1.25,
    beatSequence: 0
  }
  private target = quiet
  private period = defaultPeriod
  private rate = 0.35
  private beatAge = Infinity
  private phaseError = 0
  private gain = 0

  get levels(): Readonly<StageMusicCue> {
    return this.cue
  }

  reset(sequence: number): void {
    this.cue = { ...quiet, phase: 0, pulse: 0, kick: 0, chase: 1.25, beatSequence: sequence }
    this.target = quiet
    this.period = defaultPeriod
    this.rate = 0.35
    this.beatAge = Infinity
    this.phaseError = 0
    this.gain = 0
  }

  sample(audio: StageAudioSample, intensity: number): number | null {
    if (audio.beatSequence < this.cue.beatSequence) this.reset(audio.beatSequence)
    const gain = unit(intensity)
    this.gain = gain
    const rms = unit(audio.rms)
    const energy = 1 - Math.exp(-rms * 5)
    const audible = unit((rms - 0.002) * 38)
    const onset = unit(audio.onsetStrength * 5.6)
    const lowPass = unit(audio.lowEnergy * 3.4)
    const spectrum = audio.spectrum
    const available = spectrum?.length === 64
    // SpectrumAnalysis uses 45 * 2^(bin/10) Hz. The upper group is the
    // presence band (about 1.17–3.55 kHz), not the entire audible treble.
    const low = available ? 0.84 * band(spectrum, 0, 24) + 0.16 * lowPass : lowPass
    const mid = available ? band(spectrum, 24, 47) : energy * 0.72
    const high = available ? band(spectrum, 47, 64) : energy * 0.23 + onset * 0.25
    this.target = {
      energy: energy * gain,
      low: low * audible * gain,
      mid: mid * audible * gain,
      high: high * audible * gain,
      section:
        unit((0.68 * energy + audible * (0.13 * mid + 0.12 * low + 0.07 * high) - 0.14) / 0.6) *
        gain
    }
    if (audio.beatSequence <= this.cue.beatSequence) return null

    const bpm = audio.bpm ?? 0
    const interval = this.beatAge / (audio.beatSequence - this.cue.beatSequence)
    const observed = bpm >= 55 && bpm <= 220 ? 60 / bpm : interval
    if (observed >= 0.26 && observed <= 1.2) this.period += (observed - this.period) * 0.45
    this.beatAge = 0
    // Steer the motor phase toward a beat boundary without jumping the beam.
    this.phaseError = Math.round(this.cue.phase) - this.cue.phase
    this.cue.beatSequence = audio.beatSequence
    this.cue.pulse = Math.max(this.cue.pulse, gain * Math.max(0.59, onset))
    this.cue.kick = gain * (0.14 + 0.61 * low + 0.25 * onset)
    this.cue.chase = 0
    return Math.max(onset, low) * gain
  }

  advance(dt: number): void {
    const { cue, target } = this
    cue.energy = follow(cue.energy, target.energy, dt, 0.14, 0.5)
    cue.low = follow(cue.low, target.low, dt, 0.063, 0.24)
    cue.mid = follow(cue.mid, target.mid, dt, 0.12, 0.32)
    cue.high = follow(cue.high, target.high, dt, 0.054, 0.21)
    cue.section = follow(cue.section, target.section, dt, 0.58, 1.18)
    cue.pulse *= Math.exp(-dt / 0.17)
    cue.kick *= Math.exp(-dt / 0.31)
    this.beatAge += dt
    const timed = this.beatAge < this.period * 2.45
    const idleRate = 0.27 + cue.energy * 0.24
    const rate = timed ? idleRate + this.gain * (1 / this.period - idleRate) : idleRate
    this.rate = follow(this.rate, rate, dt, 0.28, 0.72)
    const steer = timed ? Math.min(0.62, Math.max(-0.62, this.phaseError * 2.9)) : 0
    this.phaseError -= steer * dt
    cue.phase = (cue.phase + Math.max(0, this.rate + steer * this.gain) * dt) % 8
    cue.chase = Math.min(1.25, this.beatAge / (this.period * 0.96))
  }
}
