import type { PlayerCheerLights } from '@/constants'
import type { StageAudioSample } from './stageMusic'
import type { CheerPalette } from './stagePalette'

type CheerPeriod = 1 | 2 | 4

interface CheerTiming {
  beat: number
  strength: number
  period: CheerPeriod
  previousPeriod: CheerPeriod
  periodBlend: number
}

export interface StageCheerFrame extends CheerTiming {
  lights: PlayerCheerLights
  stickAtlas: ImageBitmap
  palettes: readonly CheerPalette[]
}

export const lightstickSpriteSize = 40
export const lightstickAngles = 37

const minTempo = 55
const maxTempo = 220
const initialReferenceRms = 0.09
const rhythmMemory = 1.8

function unit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
}

function smoothstep(value: number): number {
  const t = unit(value)
  return t * t * (3 - 2 * t)
}

export class CheerBeatClock {
  private beats = 0
  private tempo = 0
  private targetTempo = 0
  private strength = 0
  private gain = 0
  private rms = 0
  private sectionRms = 0
  private referenceRms = initialReferenceRms
  private sequence = 0
  private lastDrum?: number
  private updatedAt?: number
  private correction = 0
  private drumDensity = 0
  private period: CheerPeriod = 2
  private previousPeriod: CheerPeriod = 2
  private periodStartedAt = -Infinity

  reset(sequence: number): void {
    this.beats = this.tempo = this.targetTempo = this.strength = 0
    this.gain = this.rms = this.sectionRms = 0
    this.referenceRms = initialReferenceRms
    this.sequence = sequence
    this.lastDrum = this.updatedAt = undefined
    this.correction = 0
    this.drumDensity = 0
    this.period = this.previousPeriod = 2
    this.periodStartedAt = -Infinity
  }

  sample(audio: StageAudioSample, intensity: number, now: number): void {
    if (audio.beatSequence < this.sequence) this.reset(audio.beatSequence)
    this.advance(now)
    this.rms = unit(audio.rms)
    this.gain = unit(intensity)
    const bpm = audio.bpm ?? 0
    const hasTempo = bpm >= minTempo && bpm <= maxTempo
    if (hasTempo) this.targetTempo = bpm
    if (!this.tempo) this.tempo = this.targetTempo

    if (
      audio.beatSequence > this.sequence &&
      audio.lowEnergy >= Math.max(0.004, audio.rms * 0.24)
    ) {
      // Native onsets include other instruments. A bass transient near the beat grid can
      // adjust its phase without letting ornamentation restart the gesture.
      const drumTime = now / 1000
      const interval = drumTime - (this.lastDrum ?? drumTime)
      const predicted = (interval * this.tempo) / 60
      const beats = Math.max(1, Math.round(predicted))
      const onGrid = Math.abs(predicted - beats) <= 0.23
      if (this.lastDrum === undefined || !this.tempo || onGrid || interval > 2.5) {
        const measured = (60 * beats) / interval
        if (!hasTempo && measured >= minTempo && measured <= maxTempo && (!this.tempo || onGrid))
          this.targetTempo = measured
        if (!this.tempo) this.tempo = this.targetTempo
        if (this.lastDrum === undefined && this.strength < 0.02) this.beats = 0
        else if (this.tempo) {
          const offset = Math.round(this.beats) - this.beats
          if (Math.abs(offset) > 0.045) this.correction = Math.max(-0.16, Math.min(0.16, offset))
        }
        this.lastDrum = drumTime
        if (onGrid) {
          const onset = unit(audio.onsetStrength / Math.max(this.rms * 0.55, 0.004))
          this.drumDensity = Math.min(
            1.25,
            this.drumDensity + (0.55 + 0.45 * onset) / ((rhythmMemory * this.tempo) / 60)
          )
        }
      }
    }
    this.sequence = audio.beatSequence
  }

  frame(now: number): CheerTiming {
    this.advance(now)
    return {
      beat: this.beats % 4,
      strength: this.strength,
      period: this.period,
      previousPeriod: this.previousPeriod,
      periodBlend: Number.isFinite(this.periodStartedAt)
        ? smoothstep((this.beats - this.periodStartedAt) / 0.35)
        : 1
    }
  }

  private advance(now: number): void {
    const last = this.updatedAt ?? now
    if (now < last) return
    const dt = (now - last) / 1000
    this.updatedAt = now
    this.tempo += (this.targetTempo - this.tempo) * (1 - Math.exp(-dt / 1.25))
    // Limit individual transients before measuring the section's energy.
    const energyRms = Math.min(this.rms, Math.max(0.035, this.referenceRms * 3))
    const energyTime = energyRms > this.sectionRms ? 0.55 : 0.75
    this.sectionRms += (energyRms - this.sectionRms) * (1 - Math.exp(-dt / energyTime))
    if (this.rms > 0.002) {
      // Keep a soft-section reference across short bursts and loud passages.
      const reference = Math.max(0.008, this.sectionRms)
      const referenceTime = reference > this.referenceRms ? 16 : 1.6
      this.referenceRms += (reference - this.referenceRms) * (1 - Math.exp(-dt / referenceTime))
    }
    const absolute = smoothstep((this.sectionRms - 0.025) / 0.155)
    const contrast = this.sectionRms / this.referenceRms
    const rise = smoothstep((contrast - 1.06) / 0.58)
    const energy = Math.max(absolute, rise)
    const audible = smoothstep((this.sectionRms - 0.002) / 0.01)
    const targetStrength =
      this.tempo && this.rms > 0.002 ? this.gain * audible * (0.14 + 0.86 * energy) : 0
    this.strength += (targetStrength - this.strength) * (1 - Math.exp(-dt / 0.3))
    this.drumDensity *= Math.exp(-dt / rhythmMemory)
    const correction = this.correction * (1 - Math.exp(-dt / 1.15))
    this.correction -= correction
    const previousBar = Math.floor((this.beats + 1) / 4)
    this.beats += (this.tempo / 60) * dt + correction
    // All three motions reach their highest point on beat 4.
    const bar = Math.floor((this.beats + 1) / 4)
    if (bar > previousBar) {
      const rhythm = unit(this.drumDensity)
      const sustainedDrive = Math.max(absolute, smoothstep((contrast - 1.1) / 1.6))
      const activity = 0.82 * sustainedDrive + 0.18 * rhythm
      const period = this.choosePeriod(activity, rhythm)
      if (period !== this.period) {
        this.previousPeriod = this.period
        this.period = period
        this.periodStartedAt = bar * 4 - 1
      }
    }
  }

  private choosePeriod(activity: number, rhythm: number): CheerPeriod {
    // Different entry and exit thresholds keep adjacent sections from flapping.
    if (activity < (this.period === 4 ? 0.34 : 0.24) || this.tempo > 195) return 4
    if (
      activity > (this.period === 1 ? 0.64 : 0.76) &&
      rhythm > (this.period === 1 ? 0.32 : 0.46) &&
      this.tempo <= (this.period === 1 ? 152 : 145)
    )
      return 1
    return 2
  }
}

function reachForPeriod(beat: number, period: CheerPeriod): number {
  const progress = (beat + 1) / period
  const phase = progress - Math.floor(progress)
  const hold = 0.08 / period
  // A longer phrase has more time to prepare the next lift after lowering the arm.
  const releaseEnd = period === 1 ? 0.63 : period === 2 ? 0.44 : 0.37
  if (phase < hold) return 1
  const lowering = phase < releaseEnd
  const t = lowering
    ? (phase - hold) / (releaseEnd - hold)
    : (phase - releaseEnd) / (1 - releaseEnd)
  const eased = smoothstep(t)
  return lowering ? 1 - eased : eased
}

export function cheerReach(
  beat: number,
  period: CheerPeriod = 1,
  previousPeriod = period,
  blend = 1
): number {
  const reach = reachForPeriod(beat, period)
  if (blend >= 1) return reach
  const previousReach = reachForPeriod(beat, previousPeriod)
  return previousReach + (reach - previousReach) * blend
}

export function createLightstickAtlas(palettes: readonly CheerPalette[]): ImageBitmap {
  const canvas = new OffscreenCanvas(
    lightstickSpriteSize * lightstickAngles,
    lightstickSpriteSize * palettes.length
  )
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Lightstick texture canvas is unavailable')
  for (let index = 0; index < lightstickAngles * palettes.length; index++) {
    const row = Math.floor(index / lightstickAngles)
    const angle = index % lightstickAngles
    const { light, core } = palettes[row]
    ctx.save()
    ctx.translate(angle * lightstickSpriteSize, row * lightstickSpriteSize)
    ctx.beginPath()
    ctx.rect(0, 0, lightstickSpriteSize, lightstickSpriteSize)
    ctx.clip()
    ctx.translate(20, 26)
    ctx.rotate((angle - (lightstickAngles - 1) / 2) * 0.04)
    const halo = ctx.createRadialGradient(0, -10, 1, 0, -10, 20)
    halo.addColorStop(0, `rgb(${light} / 0.37)`)
    halo.addColorStop(0.37, `rgb(${light} / 0.21)`)
    halo.addColorStop(1, `rgb(${light} / 0)`)
    ctx.fillStyle = halo
    ctx.fillRect(-26, -30, 52, 48)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(0, -3)
    ctx.lineTo(0, -17)
    ctx.strokeStyle = `rgb(${light})`
    for (const [width, alpha] of [
      [16, 0.13],
      [10, 0.27],
      [6.2, 0.96]
    ]) {
      ctx.lineWidth = width
      ctx.globalAlpha = alpha
      ctx.stroke()
    }
    ctx.strokeStyle = `rgb(${core})`
    ctx.lineWidth = 2.9
    ctx.globalAlpha = 0.77
    ctx.stroke()
    ctx.restore()
  }
  return canvas.transferToImageBitmap()
}
