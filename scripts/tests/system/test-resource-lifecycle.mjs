/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function load(file, mocks = {}, globals = {}) {
  const exports = {}
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    {
      exports,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      require: (name) => {
        assert(name in mocks, name)
        return mocks[name]
      },
      ...globals
    }
  )
  return exports
}

const shutdown = load('src/main/service/applicationShutdown.ts')
const policy = load('src/main/service/playbackMode.ts', { './applicationShutdown': shutdown })
policy.setPlaybackOnly(true)
const waiting = policy.waitForBackgroundWork()
const cancelled = assert.rejects(waiting, /Application is shutting down/)
shutdown.beginApplicationShutdown()
await cancelled
assert.throws(() => policy.requireBackgroundWork(), /Application is shutting down/)
await assert.rejects(policy.waitForBackgroundWork(), /Application is shutting down/)
let late = 0
shutdown.onApplicationShutdown(() => late++)
shutdown.beginApplicationShutdown()
assert.equal(late, 1, 'shutdown registration after cancellation runs once')

const cleared = []
let saves = 0
const settingsDb = new Map()
const dspSettings = load('src/main/audioEngine/dspSettings.ts', {
  '../database/repository': {
    getAppSetting: (key) => settingsDb.get(key),
    setAppSetting: (key, value) => settingsDb.set(key, JSON.parse(JSON.stringify(value)))
  },
  '../service/loggerService': { Logger: { warn() {} } },
  '../service/operationLogger': {}
})
const engineTypes = load('src/main/audioEngine/types.ts')
const { AudioEngineManager } = load(
  'src/main/audioEngine/index.ts',
  {
    electron: { app: {} },
    'node:fs': { existsSync: () => false },
    '../service/autoMixStemService': {},
    '../utils/pathUtils': {},
    '../service/playbackMode': { isPlaybackOnly: () => false },
    '../service/loggerService': { Logger: { warn() {}, error() {} } },
    '../service/operationLogger': { logOperation: (_name, _data, action) => action() },
    './types': engineTypes,
    '../../shared/audioProcessingProfiles': load('src/shared/audioProcessingProfiles.ts'),
    './dspSettings': {
      ...dspSettings,
      saveDspSettings: (settings) => {
        saves++
        dspSettings.saveDspSettings(settings)
      }
    }
  },
  { clearTimeout: (timer) => cleared.push(timer), clearInterval: (timer) => cleared.push(timer) }
)
const audio = Object.create(AudioEngineManager.prototype)
audio.deviceEvents = 'device-poll'
audio.stemRequestTimer = 'stem-poll'
audio.dspSettingsSaveTimer = 'dsp-save'
audio.dspSettings = { outputDevice: {} }
audio.stemShutdown = Promise.resolve()
let release
let closed = false
audio.stemService = {
  closeAndWait: () =>
    new Promise((resolve) => {
      release = resolve
    })
}
const closing = audio.shutdown().then(() => {
  closed = true
})
await Promise.resolve()
assert.deepEqual(cleared, ['device-poll', 'stem-poll', 'dsp-save'])
assert.equal(saves, 1, 'final DSP state must flush while SQLite is available')
assert.equal(closed, false, 'shutdown must wait for the stem process close event')
audio.resumeStemService()
assert.equal(audio.stemService, undefined, 'late maintenance completion cannot restart a worker')
audio.persistDspSettings()
assert.equal(saves, 1)
release()
await closing
await audio.shutdown()

const manager = Object.create(AudioEngineManager.prototype)
const initial = dspSettings.defaultDspSettings()
initial.volume = 0.35
initial.outputDevice = { backend: 'wasapi_exclusive', deviceId: 'speakers' }
initial.playbackSpeed = { enabled: true, speed: 1.4 }
initial.impulseResponse = { enabled: true, path: 'room.wav', autoGain: true, gainDb: 0 }
initial.eqBands = dspSettings.defaultEqBands()
manager.dspSettings = initial
manager.pendingPlaybackOperations = 0
const live = { ...initial }
let missingFilter = false
let restarted = false
manager.engine = {
  getEqBands: () => live.eqBands,
  getStatus: () => ({
    state: engineTypes.EngineState.Playing,
    positionMs: 1250,
    trackInfo: { filePath: 'track.wav' }
  }),
  setVolume: (volume) => {
    live.volume = volume
  },
  setPreamp: (db, enabled) => {
    live.preamp = { db, enabled }
  },
  selectOutputDevice: (backend, deviceId) => {
    live.outputDevice = { backend, deviceId }
    return true
  },
  restart: () => {
    restarted = true
    Object.assign(live, dspSettings.defaultDspSettings())
    return true
  }
}
for (const [method, key] of Object.entries({
  setReplayGain: 'replayGain',
  setPlaybackSpeed: 'playbackSpeed',
  setEqBands: 'eqBands',
  setDspNodes: 'dspNodes',
  setCompressorConfig: 'compressor',
  setDelayConfig: 'delay',
  setReverbConfig: 'reverb',
  setChorusConfig: 'chorus',
  setNoiseGateConfig: 'noiseGate',
  setPhaserConfig: 'phaser',
  setChannelMatrixConfig: 'channelMatrix',
  setStereoFieldConfig: 'stereoField',
  setCrossfeedConfig: 'crossfeed',
  setImpulseResponseConfig: 'impulseResponse',
  setLimiter: 'limiter',
  setResamplerConfig: 'resampler',
  setDopEnabled: 'dopEnabled',
  setTransitionConfig: 'transition'
})) {
  manager.engine[method] = (value) => {
    if (key === 'impulseResponse' && missingFilter && value.enabled) return false
    live[key] = value
    return true
  }
}

assert.equal(manager.saveAudioProcessingProfile('  Speakers  ').success, true)
assert.equal(manager.saveAudioProcessingProfile('speakers').error, 'profile_name_exists')
assert.equal(manager.listAudioProcessingProfiles().join(), 'Speakers')
assert.equal(manager.resetAudioProcessingSettings().success, true)
assert.equal(live.playbackSpeed.speed, 1)
missingFilter = true
assert.equal(manager.applyAudioProcessingProfile('Speakers').success, false)
assert.equal(live.playbackSpeed.speed, 1, 'failed profile apply rolls back earlier settings')
assert.equal(dspSettings.loadDspSettings().playbackSpeed.speed, 1)
missingFilter = false
assert.equal(manager.applyAudioProcessingProfile('Speakers').success, true)
assert.equal(live.playbackSpeed.speed, 1.4)
assert.equal(dspSettings.loadDspSettings().playbackSpeed.speed, 1.4)
assert.equal(manager.dspSettings.volume, 0.35)
assert.equal(manager.dspSettings.outputDevice.deviceId, 'speakers')
manager.pendingPlaybackOperations = 1
assert.equal(manager.restartEngine().error, 'playback_busy')
assert.equal(restarted, false)
manager.pendingPlaybackOperations = 0
const restart = manager.restartEngine()
assert.equal(restart.success, true)
assert.equal(restart.resume.filePath, 'track.wav')
assert.equal(restart.resume.positionMs, 1250)
assert.equal(live.playbackSpeed.speed, 1.4)
assert.equal(live.volume, 0.35)
assert.equal(live.outputDevice.deviceId, 'speakers')
assert.equal(manager.saveAudioProcessingProfile('Headphones').success, true)
assert.equal(manager.deleteAudioProcessingProfile('Speakers').success, true)
assert.equal(manager.listAudioProcessingProfiles().join(), 'Headphones')
assert.equal(manager.applyAudioProcessingProfile('Speakers').error, 'profile_not_found')
assert.equal(manager.deleteAudioProcessingProfile('Speakers').error, 'profile_not_found')
assert.equal(live.playbackSpeed.speed, 1.4, 'deleting a preset leaves the live settings alone')
console.log(
  'Resource lifecycle, audio profile persistence and rollback, and engine restart settings passed'
)
