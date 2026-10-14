import { getAppSetting, setAppSetting } from '../database/repository'
import { Logger } from '../service/loggerService'
import { logError } from '../service/operationLogger'

export interface PersistedEqBand {
  enabled: boolean
  frequencyHz: number
  gainDb: number
  q: number
}
export interface PersistedDspNode {
  id:
    | 'channel_matrix'
    | 'replay_gain'
    | 'preamp'
    | 'eq'
    | 'compressor'
    | 'delay'
    | 'reverb'
    | 'chorus'
    | 'noise_gate'
    | 'phaser'
    | 'stereo_field'
    | 'crossfeed'
    | 'impulse_response'
    | 'limiter'
  enabled: boolean
}
export interface PersistedCompressor {
  thresholdDb: number
  ratio: number
  attackMs: number
  releaseMs: number
  makeupDb: number
}
export interface PersistedDelay {
  delayMs: number
  feedback: number
  mix: number
}
export interface PersistedReverb {
  roomSize: number
  decay: number
  mix: number
}
export interface PersistedLimiter {
  enabled: boolean
  ceilingDb: number
  releaseMs: number
}
export interface PersistedChorus {
  rateHz: number
  depthMs: number
  mix: number
}
export interface PersistedNoiseGate {
  thresholdDb: number
  attackMs: number
  holdMs: number
  releaseMs: number
  rangeDb: number
}
export interface PersistedPhaser {
  rateHz: number
  depth: number
  centerHz: number
  feedback: number
  mix: number
}
export interface PersistedChannelMatrix {
  enabled: boolean
  balance: number
  swapStereo: boolean
  monoDownmix: boolean
  outputGains: number[]
}
export interface PersistedStereoField {
  enabled: boolean
  midDb: number
  sideDb: number
  width: number
}
export interface PersistedCrossfeed {
  enabled: boolean
  strength: number
  cutoffHz: number
  delayMs: number
}
export interface PersistedImpulseResponse {
  enabled: boolean
  path: string
  autoGain: boolean
  gainDb: number
}
export type PersistedOutputBackend = 'directsound' | 'wasapi_shared' | 'wasapi_exclusive' | 'asio'
export interface PersistedOutputDevice {
  backend: PersistedOutputBackend
  deviceId: string
}

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
  stereoField: PersistedStereoField
  crossfeed: PersistedCrossfeed
  impulseResponse: PersistedImpulseResponse
  resampler: {
    forceOutputRate: boolean
    targetSampleRate: number
    quality: 'best' | 'medium' | 'fast'
  }
  dopEnabled: boolean
  transition: {
    gaplessEnabled: boolean
    crossfadeEnabled: boolean
    crossfadeMs: number
    crossfadeAuto: boolean
    pauseFadeEnabled: boolean
    pauseFadeMs: number
  }
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
    { id: 'channel_matrix', enabled: false },
    { id: 'replay_gain', enabled: false },
    { id: 'preamp', enabled: false },
    { id: 'eq', enabled: false },
    { id: 'compressor', enabled: false },
    { id: 'delay', enabled: false },
    { id: 'reverb', enabled: false },
    { id: 'chorus', enabled: false },
    { id: 'noise_gate', enabled: false },
    { id: 'phaser', enabled: false },
    { id: 'stereo_field', enabled: false },
    { id: 'crossfeed', enabled: false },
    { id: 'impulse_response', enabled: false },
    { id: 'limiter', enabled: false }
  ],
  compressor: { thresholdDb: -18, ratio: 4, attackMs: 10, releaseMs: 100, makeupDb: 0 },
  delay: { delayMs: 250, feedback: 0.25, mix: 0.2 },
  reverb: { roomSize: 0.5, decay: 0.4, mix: 0.15 },
  limiter: { enabled: false, ceilingDb: -1, releaseMs: 80 },
  chorus: { rateHz: 0.8, depthMs: 8, mix: 0.35 },
  noiseGate: { thresholdDb: -50, attackMs: 5, holdMs: 50, releaseMs: 150, rangeDb: -80 },
  phaser: { rateHz: 0.4, depth: 0.6, centerHz: 800, feedback: 0.2, mix: 0.5 },
  channelMatrix: {
    enabled: false,
    balance: 0,
    swapStereo: false,
    monoDownmix: false,
    outputGains: [1, 1, 1, 1, 1, 1, 1, 1]
  },
  stereoField: { enabled: false, midDb: 0, sideDb: 0, width: 1 },
  crossfeed: { enabled: false, strength: 0.5, cutoffHz: 700, delayMs: 0.25 },
  impulseResponse: { enabled: false, path: '', autoGain: true, gainDb: 0 },
  resampler: { forceOutputRate: false, targetSampleRate: 48000, quality: 'best' },
  dopEnabled: false,
  transition: {
    gaplessEnabled: true,
    crossfadeEnabled: false,
    crossfadeMs: 5000,
    crossfadeAuto: false,
    pauseFadeEnabled: true,
    pauseFadeMs: 180
  },
  outputDevice: { backend: 'directsound', deviceId: 'default' }
})

export function defaultEqBands(): PersistedEqBand[] {
  const frequencies = [
    20, 31.5, 50, 80, 125, 200, 315, 500, 800, 1250, 2000, 3150, 5000, 8000, 10000, 12000, 14000,
    16000, 18000, 20000
  ]
  return frequencies.map((frequencyHz) => ({ enabled: false, frequencyHz, gainDb: 0, q: 1 }))
}

const DSP_SETTINGS_KEY = 'audio.dsp-settings'

function migrateLegacyEqPreset(bands: PersistedEqBand[]): PersistedEqBand[] {
  const frequencies = [
    20, 31.5, 50, 80, 125, 200, 315, 500, 800, 1250, 2000, 3150, 5000, 8000, 10000, 12000, 14000,
    16000, 18000, 20000
  ]
  const legacyCurves: { gains: number[]; scale?: number; replacement?: number[] }[] = [
    {
      gains: [6, 6, 5.5, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      replacement: [2, 2, 2, 2, 1.5, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    },
    { gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 1, 2, 3, 4, 4.5, 5, 5, 5, 5], scale: 0.3 },
    {
      gains: [-2, -2, -1.5, -1, -0.5, 0, 1, 2, 3, 3.5, 4, 3.5, 2.5, 1, 0, -0.5, -1, -1, -1, -1],
      scale: 0.55
    },
    {
      gains: [3, 3, 2.5, 2, 1.5, 1, 0, -1, -1.5, -1, 0, 1, 2, 2.5, 3, 3, 3, 2.5, 2.5, 2],
      scale: 0.5
    },
    {
      gains: [4.5, 4.5, 4, 3, 1, 0, -1, -2, -1.5, 0, 1, 2, 3, 3.5, 3, 2.5, 2, 2, 2, 2],
      scale: 0.5
    },
    {
      gains: [3, 3, 2.5, 1.5, 0.5, 0, 1, 2, 2.5, 2, 1, 1.5, 2.5, 3, 3, 2.5, 2, 2, 2, 1.5],
      scale: 0.5
    },
    {
      gains: [-1, -1, -0.5, 0, 1.5, 2.5, 3, 3, 2, 0.5, -0.5, -1, -0.5, 1, 2, 2.5, 2.5, 2, 2, 2],
      scale: 0.65
    },
    { gains: [4, 4, 3.5, 3, 2, 0, -1.5, -2, -1, 1, 2.5, 3.5, 4, 4, 3.5, 3, 3, 3, 3, 3], scale: 0.4 }
  ]
  if (bands.length !== frequencies.length) return bands
  for (const curve of legacyCurves) {
    const matches = bands.every(
      (band, index) =>
        band.frequencyHz === frequencies[index] &&
        band.gainDb === curve.gains[index] &&
        band.q === 1 &&
        band.enabled === (curve.gains[index] !== 0)
    )
    if (matches) {
      return bands.map((band, index) => {
        const gainDb =
          curve.replacement?.[index] ??
          Math.round(curve.gains[index] * (curve.scale ?? 1) * 10) / 10
        return { ...band, gainDb, enabled: gainDb !== 0 }
      })
    }
  }
  return bands
}

export function loadDspSettings(): DspSettings {
  try {
    const parsed = getAppSetting(DSP_SETTINGS_KEY)
    if (!parsed || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== 1) {
      return defaultDspSettings()
    }
    const settings = parsed as Partial<DspSettings>
    const defaults = defaultDspSettings()
    const legacyIrPreset = (
      settings.impulseResponse as (PersistedImpulseResponse & { preset?: string }) | undefined
    )?.preset
    const allowedNodeIds = new Set(defaults.dspNodes.map((node) => node.id))
    const persistedNodes = Array.isArray(settings.dspNodes)
      ? settings.dspNodes.filter(
          (node): node is PersistedDspNode =>
            !!node &&
            typeof node === 'object' &&
            allowedNodeIds.has((node as PersistedDspNode).id) &&
            typeof (node as PersistedDspNode).enabled === 'boolean'
        )
      : []
    const hasUniqueNodeIds =
      new Set(persistedNodes.map((node) => node.id)).size === persistedNodes.length
    const legacyIds = new Set(['compressor', 'delay', 'reverb', 'chorus', 'noise_gate', 'phaser'])
    const isLegacyOrder =
      persistedNodes.length >= 3 &&
      persistedNodes.length <= 6 &&
      persistedNodes.every((node) => legacyIds.has(node.id))
    const dspNodes: PersistedDspNode[] =
      hasUniqueNodeIds && persistedNodes.length === defaults.dspNodes.length
        ? persistedNodes
        : hasUniqueNodeIds && isLegacyOrder
          ? [
              ...defaults.dspNodes.slice(0, 4),
              ...persistedNodes,
              ...defaults.dspNodes
                .slice(4, 10)
                .filter((node) => !persistedNodes.some((old) => old.id === node.id)),
              ...defaults.dspNodes.slice(10)
            ]
          : defaults.dspNodes
    return {
      version: 1,
      volume:
        typeof settings.volume === 'number'
          ? Math.max(0, Math.min(1, settings.volume))
          : defaults.volume,
      preamp: {
        enabled: settings.preamp?.enabled === true,
        db:
          typeof settings.preamp?.db === 'number'
            ? Math.max(-24, Math.min(24, settings.preamp.db))
            : 0
      },
      replayGain: {
        mode:
          settings.replayGain?.mode === 'track' || settings.replayGain?.mode === 'album'
            ? settings.replayGain.mode
            : 'off',
        preventClipping: settings.replayGain?.preventClipping !== false
      },
      playbackSpeed: {
        enabled: settings.playbackSpeed?.enabled === true,
        speed:
          typeof settings.playbackSpeed?.speed === 'number'
            ? Math.max(0.5, Math.min(2, settings.playbackSpeed.speed))
            : 1
      },
      eqBands: Array.isArray(settings.eqBands)
        ? migrateLegacyEqPreset(settings.eqBands.slice(0, 20))
        : [],
      dspNodes,
      compressor: {
        thresholdDb:
          typeof settings.compressor?.thresholdDb === 'number'
            ? settings.compressor.thresholdDb
            : defaults.compressor.thresholdDb,
        ratio:
          typeof settings.compressor?.ratio === 'number'
            ? settings.compressor.ratio
            : defaults.compressor.ratio,
        attackMs:
          typeof settings.compressor?.attackMs === 'number'
            ? settings.compressor.attackMs
            : defaults.compressor.attackMs,
        releaseMs:
          typeof settings.compressor?.releaseMs === 'number'
            ? settings.compressor.releaseMs
            : defaults.compressor.releaseMs,
        makeupDb:
          typeof settings.compressor?.makeupDb === 'number'
            ? settings.compressor.makeupDb
            : defaults.compressor.makeupDb
      },
      delay: {
        delayMs:
          typeof settings.delay?.delayMs === 'number'
            ? settings.delay.delayMs
            : defaults.delay.delayMs,
        feedback:
          typeof settings.delay?.feedback === 'number'
            ? settings.delay.feedback
            : defaults.delay.feedback,
        mix: typeof settings.delay?.mix === 'number' ? settings.delay.mix : defaults.delay.mix
      },
      reverb: {
        roomSize:
          typeof settings.reverb?.roomSize === 'number'
            ? settings.reverb.roomSize
            : defaults.reverb.roomSize,
        decay:
          typeof settings.reverb?.decay === 'number'
            ? settings.reverb.decay
            : defaults.reverb.decay,
        mix: typeof settings.reverb?.mix === 'number' ? settings.reverb.mix : defaults.reverb.mix
      },
      limiter: {
        enabled: settings.limiter?.enabled === true,
        ceilingDb:
          typeof settings.limiter?.ceilingDb === 'number'
            ? settings.limiter.ceilingDb
            : defaults.limiter.ceilingDb,
        releaseMs:
          typeof settings.limiter?.releaseMs === 'number'
            ? settings.limiter.releaseMs
            : defaults.limiter.releaseMs
      },
      chorus: {
        rateHz:
          typeof settings.chorus?.rateHz === 'number'
            ? settings.chorus.rateHz
            : defaults.chorus.rateHz,
        depthMs:
          typeof settings.chorus?.depthMs === 'number'
            ? settings.chorus.depthMs
            : defaults.chorus.depthMs,
        mix: typeof settings.chorus?.mix === 'number' ? settings.chorus.mix : defaults.chorus.mix
      },
      noiseGate: {
        thresholdDb:
          typeof settings.noiseGate?.thresholdDb === 'number'
            ? settings.noiseGate.thresholdDb
            : defaults.noiseGate.thresholdDb,
        attackMs:
          typeof settings.noiseGate?.attackMs === 'number'
            ? settings.noiseGate.attackMs
            : defaults.noiseGate.attackMs,
        holdMs:
          typeof settings.noiseGate?.holdMs === 'number'
            ? settings.noiseGate.holdMs
            : defaults.noiseGate.holdMs,
        releaseMs:
          typeof settings.noiseGate?.releaseMs === 'number'
            ? settings.noiseGate.releaseMs
            : defaults.noiseGate.releaseMs,
        rangeDb:
          typeof settings.noiseGate?.rangeDb === 'number'
            ? settings.noiseGate.rangeDb
            : defaults.noiseGate.rangeDb
      },
      phaser: {
        rateHz:
          typeof settings.phaser?.rateHz === 'number'
            ? settings.phaser.rateHz
            : defaults.phaser.rateHz,
        depth:
          typeof settings.phaser?.depth === 'number'
            ? settings.phaser.depth
            : defaults.phaser.depth,
        centerHz:
          typeof settings.phaser?.centerHz === 'number'
            ? settings.phaser.centerHz
            : defaults.phaser.centerHz,
        feedback:
          typeof settings.phaser?.feedback === 'number'
            ? settings.phaser.feedback
            : defaults.phaser.feedback,
        mix: typeof settings.phaser?.mix === 'number' ? settings.phaser.mix : defaults.phaser.mix
      },
      channelMatrix: {
        enabled: settings.channelMatrix?.enabled === true,
        balance:
          typeof settings.channelMatrix?.balance === 'number'
            ? settings.channelMatrix.balance
            : defaults.channelMatrix.balance,
        swapStereo: settings.channelMatrix?.swapStereo === true,
        monoDownmix: settings.channelMatrix?.monoDownmix === true,
        outputGains:
          Array.isArray(settings.channelMatrix?.outputGains) &&
          settings.channelMatrix.outputGains.length === 8
            ? settings.channelMatrix.outputGains.map((gain) =>
                typeof gain === 'number' ? Math.max(0, Math.min(2, gain)) : 1
              )
            : defaults.channelMatrix.outputGains
      },
      stereoField: {
        enabled: settings.stereoField?.enabled === true,
        midDb:
          typeof settings.stereoField?.midDb === 'number' &&
          Number.isFinite(settings.stereoField.midDb)
            ? Math.max(-12, Math.min(6, settings.stereoField.midDb))
            : 0,
        sideDb:
          typeof settings.stereoField?.sideDb === 'number' &&
          Number.isFinite(settings.stereoField.sideDb)
            ? Math.max(-12, Math.min(6, settings.stereoField.sideDb))
            : 0,
        width:
          typeof settings.stereoField?.width === 'number' &&
          Number.isFinite(settings.stereoField.width)
            ? Math.max(0, Math.min(2, settings.stereoField.width))
            : 1
      },
      crossfeed: {
        enabled: settings.crossfeed?.enabled === true,
        strength:
          typeof settings.crossfeed?.strength === 'number' &&
          Number.isFinite(settings.crossfeed.strength)
            ? Math.max(0, Math.min(1, settings.crossfeed.strength))
            : defaults.crossfeed.strength,
        cutoffHz:
          typeof settings.crossfeed?.cutoffHz === 'number' &&
          Number.isFinite(settings.crossfeed.cutoffHz)
            ? Math.max(300, Math.min(1500, settings.crossfeed.cutoffHz))
            : defaults.crossfeed.cutoffHz,
        delayMs:
          typeof settings.crossfeed?.delayMs === 'number' &&
          Number.isFinite(settings.crossfeed.delayMs)
            ? Math.max(0, Math.min(0.6, settings.crossfeed.delayMs))
            : defaults.crossfeed.delayMs
      },
      impulseResponse: {
        enabled:
          settings.impulseResponse?.enabled === true &&
          (legacyIrPreset === undefined || legacyIrPreset === 'custom') &&
          !!settings.impulseResponse.path,
        path:
          typeof settings.impulseResponse?.path === 'string' ? settings.impulseResponse.path : '',
        autoGain: settings.impulseResponse?.autoGain !== false,
        gainDb:
          typeof settings.impulseResponse?.gainDb === 'number' &&
          Number.isFinite(settings.impulseResponse.gainDb)
            ? Math.max(-24, Math.min(12, settings.impulseResponse.gainDb))
            : 0
      },
      resampler: {
        forceOutputRate: settings.resampler?.forceOutputRate === true,
        targetSampleRate:
          typeof settings.resampler?.targetSampleRate === 'number'
            ? settings.resampler.targetSampleRate
            : defaults.resampler.targetSampleRate,
        quality:
          settings.resampler?.quality === 'medium' || settings.resampler?.quality === 'fast'
            ? settings.resampler.quality
            : 'best'
      },
      dopEnabled: settings.dopEnabled === true,
      transition: {
        gaplessEnabled: settings.transition?.gaplessEnabled !== false,
        crossfadeEnabled: settings.transition?.crossfadeEnabled === true,
        crossfadeAuto: settings.transition?.crossfadeAuto === true,
        pauseFadeEnabled: settings.transition?.pauseFadeEnabled !== false,
        pauseFadeMs:
          typeof settings.transition?.pauseFadeMs === 'number' &&
          Number.isFinite(settings.transition.pauseFadeMs)
            ? Math.max(0, Math.min(1000, settings.transition.pauseFadeMs))
            : defaults.transition.pauseFadeMs,
        crossfadeMs:
          typeof settings.transition?.crossfadeMs === 'number'
            ? Math.max(0, Math.min(30000, settings.transition.crossfadeMs))
            : defaults.transition.crossfadeMs
      },
      outputDevice: {
        backend:
          settings.outputDevice?.backend === 'wasapi_shared' ||
          settings.outputDevice?.backend === 'wasapi_exclusive' ||
          settings.outputDevice?.backend === 'asio'
            ? settings.outputDevice.backend
            : 'directsound',
        deviceId:
          typeof settings.outputDevice?.deviceId === 'string' &&
          settings.outputDevice.deviceId.length > 0
            ? settings.outputDevice.deviceId
            : 'default'
      }
    }
  } catch (error) {
    Logger.warn(
      '[AudioEngine] failed to load DSP settings; using defaults',
      { key: DSP_SETTINGS_KEY },
      logError(error)
    )
    return defaultDspSettings()
  }
}

export function saveDspSettings(settings: DspSettings): void {
  setAppSetting(DSP_SETTINGS_KEY, settings)
}
