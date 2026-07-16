import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface PersistedEqBand {
  enabled: boolean
  frequencyHz: number
  gainDb: number
  q: number
}
export interface PersistedDspNode { id: 'compressor' | 'delay' | 'reverb' | 'chorus' | 'noise_gate' | 'phaser'; enabled: boolean }
export interface PersistedCompressor { thresholdDb: number; ratio: number; attackMs: number; releaseMs: number; makeupDb: number }
export interface PersistedDelay { delayMs: number; feedback: number; mix: number }
export interface PersistedReverb { roomSize: number; decay: number; mix: number }
export interface PersistedLimiter { enabled: boolean; ceilingDb: number; releaseMs: number }
export interface PersistedChorus { rateHz: number; depthMs: number; mix: number }
export interface PersistedNoiseGate { thresholdDb: number; attackMs: number; holdMs: number; releaseMs: number; rangeDb: number }
export interface PersistedPhaser { rateHz: number; depth: number; centerHz: number; feedback: number; mix: number }
export interface PersistedChannelMatrix { enabled: boolean; balance: number; swapStereo: boolean; monoDownmix: boolean; outputGains: number[] }
export type PersistedOutputBackend = 'directsound' | 'wasapi_shared' | 'wasapi_exclusive' | 'asio'
export interface PersistedOutputDevice { backend: PersistedOutputBackend; deviceId: string }

export interface DspSettings {
  version: 1
  volume: number
  preamp: { enabled: boolean; db: number }
  replayGain: { mode: 'off' | 'track' | 'album'; preventClipping: boolean }
  playbackSpeed: { enabled: boolean; speed: number }
  eqBands: PersistedEqBand[]
  dspNodes: PersistedDspNode[]
  compressor: PersistedCompressor
  delay: PersistedDelay
  reverb: PersistedReverb
  limiter: PersistedLimiter
  chorus: PersistedChorus
  noiseGate: PersistedNoiseGate
  phaser: PersistedPhaser
  channelMatrix: PersistedChannelMatrix
  resampler: { forceOutputRate: boolean; targetSampleRate: number; quality: 'best' | 'medium' | 'fast' }
  dopEnabled: boolean
  transition: { gaplessEnabled: boolean; crossfadeEnabled: boolean; crossfadeMs: number }
  outputDevice: PersistedOutputDevice
}

export const defaultDspSettings = (): DspSettings => ({
  version: 1,
  volume: 1,
  preamp: { enabled: false, db: 0 },
  replayGain: { mode: 'off', preventClipping: true },
  playbackSpeed: { enabled: false, speed: 1 },
  eqBands: [],
  dspNodes: [
    { id: 'compressor', enabled: false }, { id: 'delay', enabled: false }, { id: 'reverb', enabled: false }, { id: 'chorus', enabled: false }, { id: 'noise_gate', enabled: false }, { id: 'phaser', enabled: false }
  ],
  compressor: { thresholdDb: -18, ratio: 4, attackMs: 10, releaseMs: 100, makeupDb: 0 },
  delay: { delayMs: 250, feedback: 0.25, mix: 0.2 },
  reverb: { roomSize: 0.5, decay: 0.4, mix: 0.15 },
  limiter: { enabled: false, ceilingDb: -1, releaseMs: 80 },
  chorus: { rateHz: 0.8, depthMs: 8, mix: 0.35 },
  noiseGate: { thresholdDb: -50, attackMs: 5, holdMs: 50, releaseMs: 150, rangeDb: -80 },
  phaser: { rateHz: 0.4, depth: 0.6, centerHz: 800, feedback: 0.2, mix: 0.5 },
  channelMatrix: { enabled: false, balance: 0, swapStereo: false, monoDownmix: false, outputGains: [1,1,1,1,1,1,1,1] },
  resampler: { forceOutputRate: false, targetSampleRate: 48000, quality: 'best' }
  , dopEnabled: false
  , transition: { gaplessEnabled: true, crossfadeEnabled: false, crossfadeMs: 5000 }
  , outputDevice: { backend: 'directsound', deviceId: 'default' }
})

function filePath(): string {
  return join(app.getPath('userData'), 'dsp-settings.json')
}

export function loadDspSettings(): DspSettings {
  try {
    const path = filePath()
    if (!existsSync(path)) return defaultDspSettings()
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== 1) {
      return defaultDspSettings()
    }
    const settings = parsed as Partial<DspSettings>
    const defaults = defaultDspSettings()
    const persistedNodes = Array.isArray(settings.dspNodes)
      ? settings.dspNodes.filter((node): node is PersistedDspNode =>
        !!node && typeof node === 'object' &&
        ((node as PersistedDspNode).id === 'compressor' || (node as PersistedDspNode).id === 'delay' ||
         (node as PersistedDspNode).id === 'reverb' || (node as PersistedDspNode).id === 'chorus' ||
         (node as PersistedDspNode).id === 'noise_gate' || (node as PersistedDspNode).id === 'phaser'))
      : []
    const hasUniqueNodeIds = new Set(persistedNodes.map((node) => node.id)).size === persistedNodes.length
    const dspNodes = hasUniqueNodeIds && persistedNodes.length === 3
      ? [...persistedNodes, { id: 'chorus' as const, enabled: false }, { id: 'noise_gate' as const, enabled: false }, { id: 'phaser' as const, enabled: false }]
      : hasUniqueNodeIds && persistedNodes.length === 4
        ? [...persistedNodes, { id: 'noise_gate' as const, enabled: false }, { id: 'phaser' as const, enabled: false }]
        : hasUniqueNodeIds && persistedNodes.length === 5
          ? [...persistedNodes, { id: 'phaser' as const, enabled: false }]
          : hasUniqueNodeIds && persistedNodes.length === 6 ? persistedNodes : defaults.dspNodes
    return {
      version: 1,
      volume: typeof settings.volume === 'number' ? Math.max(0, Math.min(1, settings.volume)) : defaults.volume,
      preamp: {
        enabled: settings.preamp?.enabled === true,
        db: typeof settings.preamp?.db === 'number' ? Math.max(-24, Math.min(24, settings.preamp.db)) : 0
      },
      replayGain: { mode: settings.replayGain?.mode === 'track' || settings.replayGain?.mode === 'album' ? settings.replayGain.mode : 'off', preventClipping: settings.replayGain?.preventClipping !== false },
      playbackSpeed: { enabled: settings.playbackSpeed?.enabled === true, speed: typeof settings.playbackSpeed?.speed === 'number' ? Math.max(0.5, Math.min(2, settings.playbackSpeed.speed)) : 1 },
      eqBands: Array.isArray(settings.eqBands) ? settings.eqBands.slice(0, 20) : [],
      dspNodes,
      compressor: {
        thresholdDb: typeof settings.compressor?.thresholdDb === 'number' ? settings.compressor.thresholdDb : defaults.compressor.thresholdDb,
        ratio: typeof settings.compressor?.ratio === 'number' ? settings.compressor.ratio : defaults.compressor.ratio,
        attackMs: typeof settings.compressor?.attackMs === 'number' ? settings.compressor.attackMs : defaults.compressor.attackMs,
        releaseMs: typeof settings.compressor?.releaseMs === 'number' ? settings.compressor.releaseMs : defaults.compressor.releaseMs,
        makeupDb: typeof settings.compressor?.makeupDb === 'number' ? settings.compressor.makeupDb : defaults.compressor.makeupDb
      },
      delay: {
        delayMs: typeof settings.delay?.delayMs === 'number' ? settings.delay.delayMs : defaults.delay.delayMs,
        feedback: typeof settings.delay?.feedback === 'number' ? settings.delay.feedback : defaults.delay.feedback,
        mix: typeof settings.delay?.mix === 'number' ? settings.delay.mix : defaults.delay.mix
      },
      reverb: {
        roomSize: typeof settings.reverb?.roomSize === 'number' ? settings.reverb.roomSize : defaults.reverb.roomSize,
        decay: typeof settings.reverb?.decay === 'number' ? settings.reverb.decay : defaults.reverb.decay,
        mix: typeof settings.reverb?.mix === 'number' ? settings.reverb.mix : defaults.reverb.mix
      },
      limiter: {
        enabled: settings.limiter?.enabled === true,
        ceilingDb: typeof settings.limiter?.ceilingDb === 'number' ? settings.limiter.ceilingDb : defaults.limiter.ceilingDb,
        releaseMs: typeof settings.limiter?.releaseMs === 'number' ? settings.limiter.releaseMs : defaults.limiter.releaseMs
      },
      chorus: {
        rateHz: typeof settings.chorus?.rateHz === 'number' ? settings.chorus.rateHz : defaults.chorus.rateHz,
        depthMs: typeof settings.chorus?.depthMs === 'number' ? settings.chorus.depthMs : defaults.chorus.depthMs,
        mix: typeof settings.chorus?.mix === 'number' ? settings.chorus.mix : defaults.chorus.mix
      },
      noiseGate: {
        thresholdDb: typeof settings.noiseGate?.thresholdDb === 'number' ? settings.noiseGate.thresholdDb : defaults.noiseGate.thresholdDb,
        attackMs: typeof settings.noiseGate?.attackMs === 'number' ? settings.noiseGate.attackMs : defaults.noiseGate.attackMs,
        holdMs: typeof settings.noiseGate?.holdMs === 'number' ? settings.noiseGate.holdMs : defaults.noiseGate.holdMs,
        releaseMs: typeof settings.noiseGate?.releaseMs === 'number' ? settings.noiseGate.releaseMs : defaults.noiseGate.releaseMs,
        rangeDb: typeof settings.noiseGate?.rangeDb === 'number' ? settings.noiseGate.rangeDb : defaults.noiseGate.rangeDb
      },
      phaser: {
        rateHz: typeof settings.phaser?.rateHz === 'number' ? settings.phaser.rateHz : defaults.phaser.rateHz,
        depth: typeof settings.phaser?.depth === 'number' ? settings.phaser.depth : defaults.phaser.depth,
        centerHz: typeof settings.phaser?.centerHz === 'number' ? settings.phaser.centerHz : defaults.phaser.centerHz,
        feedback: typeof settings.phaser?.feedback === 'number' ? settings.phaser.feedback : defaults.phaser.feedback,
        mix: typeof settings.phaser?.mix === 'number' ? settings.phaser.mix : defaults.phaser.mix
      },
      channelMatrix: {
        enabled: settings.channelMatrix?.enabled === true,
        balance: typeof settings.channelMatrix?.balance === 'number' ? settings.channelMatrix.balance : defaults.channelMatrix.balance,
        swapStereo: settings.channelMatrix?.swapStereo === true,
        monoDownmix: settings.channelMatrix?.monoDownmix === true,
        outputGains: Array.isArray(settings.channelMatrix?.outputGains) && settings.channelMatrix.outputGains.length === 8 ? settings.channelMatrix.outputGains.map((gain) => typeof gain === 'number' ? Math.max(0, Math.min(2, gain)) : 1) : defaults.channelMatrix.outputGains
      },
      resampler: {
        forceOutputRate: settings.resampler?.forceOutputRate === true,
        targetSampleRate: typeof settings.resampler?.targetSampleRate === 'number'
          ? settings.resampler.targetSampleRate : defaults.resampler.targetSampleRate,
        quality: settings.resampler?.quality === 'medium' || settings.resampler?.quality === 'fast'
          ? settings.resampler.quality : 'best'
      },
      dopEnabled: settings.dopEnabled === true,
      transition: {
        gaplessEnabled: settings.transition?.gaplessEnabled !== false,
        crossfadeEnabled: settings.transition?.crossfadeEnabled === true,
        crossfadeMs: typeof settings.transition?.crossfadeMs === 'number'
          ? Math.max(0, Math.min(30000, settings.transition.crossfadeMs)) : defaults.transition.crossfadeMs
      },
      outputDevice: {
        backend: settings.outputDevice?.backend === 'wasapi_shared' || settings.outputDevice?.backend === 'wasapi_exclusive' || settings.outputDevice?.backend === 'asio'
          ? settings.outputDevice.backend : 'directsound',
        deviceId: typeof settings.outputDevice?.deviceId === 'string' && settings.outputDevice.deviceId.length > 0
          ? settings.outputDevice.deviceId : 'default'
      }
    }
  } catch {
    return defaultDspSettings()
  }
}

export function saveDspSettings(settings: DspSettings): void {
  const path = filePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(settings, null, 2), 'utf8')
}
