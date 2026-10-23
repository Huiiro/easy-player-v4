export type LegacyId = 'compressor' | 'delay' | 'reverb' | 'chorus' | 'noise_gate' | 'phaser'
export type Field = {
  key: string
  label: string
  help: string
  min: number
  max: number
  step?: number
  decimals?: number
  unit?: string
}

export const effectFields: Record<LegacyId | 'limiter', Field[]> = {
  compressor: [
    {
      key: 'thresholdDb',
      label: 'threshold',
      help: 'compressorThreshold',
      min: -60,
      max: 0,
      step: 0.1,
      decimals: 1,
      unit: 'dB'
    },
    {
      key: 'ratio',
      label: 'ratio',
      help: 'compressorRatio',
      min: 1,
      max: 20,
      step: 0.1,
      decimals: 1
    },
    {
      key: 'attackMs',
      label: 'attack',
      help: 'compressorAttack',
      min: 0.1,
      max: 500,
      step: 0.1,
      decimals: 1,
      unit: 'ms'
    },
    {
      key: 'releaseMs',
      label: 'release',
      help: 'compressorRelease',
      min: 5,
      max: 2000,
      unit: 'ms'
    },
    {
      key: 'makeupDb',
      label: 'makeupGain',
      help: 'compressorMakeup',
      min: -12,
      max: 24,
      step: 0.1,
      decimals: 1,
      unit: 'dB'
    }
  ],
  delay: [
    { key: 'delayMs', label: 'time', help: 'delayTime', min: 1, max: 2000, unit: 'ms' },
    {
      key: 'feedback',
      label: 'feedback',
      help: 'delayFeedback',
      min: 0,
      max: 0.95,
      step: 0.01,
      decimals: 2
    },
    { key: 'mix', label: 'mix', help: 'wetDryMix', min: 0, max: 1, step: 0.01, decimals: 2 }
  ],
  reverb: [
    {
      key: 'roomSize',
      label: 'roomSize',
      help: 'reverbRoomSize',
      min: 0,
      max: 1,
      step: 0.05,
      decimals: 2
    },
    { key: 'decay', label: 'decay', help: 'reverbDecay', min: 0, max: 1, step: 0.05, decimals: 2 },
    { key: 'mix', label: 'mix', help: 'wetDryMix', min: 0, max: 1, step: 0.05, decimals: 2 }
  ],
  chorus: [
    {
      key: 'rateHz',
      label: 'rate',
      help: 'chorusRate',
      min: 0.05,
      max: 10,
      step: 0.05,
      decimals: 2,
      unit: 'Hz'
    },
    {
      key: 'depthMs',
      label: 'depth',
      help: 'chorusDepth',
      min: 0.1,
      max: 15,
      step: 0.1,
      decimals: 1,
      unit: 'ms'
    },
    { key: 'mix', label: 'mix', help: 'wetDryMix', min: 0, max: 1, step: 0.01, decimals: 2 }
  ],
  noise_gate: [
    {
      key: 'thresholdDb',
      label: 'threshold',
      help: 'gateThreshold',
      min: -80,
      max: 0,
      step: 0.1,
      decimals: 1,
      unit: 'dB'
    },
    {
      key: 'attackMs',
      label: 'attack',
      help: 'gateAttack',
      min: 0.1,
      max: 200,
      step: 0.1,
      decimals: 1,
      unit: 'ms'
    },
    { key: 'holdMs', label: 'hold', help: 'gateHold', min: 0, max: 2000, unit: 'ms' },
    { key: 'releaseMs', label: 'release', help: 'gateRelease', min: 5, max: 2000, unit: 'ms' },
    {
      key: 'rangeDb',
      label: 'attenuationRange',
      help: 'gateRange',
      min: -100,
      max: 0,
      step: 0.1,
      decimals: 1,
      unit: 'dB'
    }
  ],
  phaser: [
    {
      key: 'rateHz',
      label: 'rate',
      help: 'phaserRate',
      min: 0.05,
      max: 10,
      step: 0.05,
      decimals: 2,
      unit: 'Hz'
    },
    { key: 'depth', label: 'depth', help: 'phaserDepth', min: 0, max: 1, step: 0.05, decimals: 2 },
    {
      key: 'centerHz',
      label: 'centerFrequency',
      help: 'phaserCenter',
      min: 100,
      max: 5000,
      unit: 'Hz'
    },
    {
      key: 'feedback',
      label: 'feedback',
      help: 'phaserFeedback',
      min: -0.95,
      max: 0.95,
      step: 0.05,
      decimals: 2
    },
    { key: 'mix', label: 'mix', help: 'wetDryMix', min: 0, max: 1, step: 0.05, decimals: 2 }
  ],
  limiter: [
    {
      key: 'ceilingDb',
      label: 'ceiling',
      help: 'limiterCeiling',
      min: -12,
      max: 0,
      step: 0.1,
      decimals: 1,
      unit: 'dB'
    },
    { key: 'releaseMs', label: 'release', help: 'limiterRelease', min: 5, max: 2000, unit: 'ms' }
  ]
}
