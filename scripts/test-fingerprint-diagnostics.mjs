/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
const require = createRequire(import.meta.url)
let fastTimeout = false
function load(file, mocks = {}) {
  const cache = new Map()
  function visit(filename) {
    filename = path.resolve(filename)
    if (cache.has(filename)) return cache.get(filename)
    const exports = {}
    cache.set(filename, exports)
    vm.runInNewContext(
      ts.transpileModule(readFileSync(filename, 'utf8'), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true
        }
      }).outputText,
      {
        exports,
        process,
        Buffer,
        Error,
        AbortController,
        setTimeout: (fn, ms) => setTimeout(fn, fastTimeout && ms === 120000 ? 10 : ms),
        clearTimeout,
        setImmediate,
        require: (name) => {
          if (name in mocks) return mocks[name]
          if (!name.startsWith('.')) return require(name)
          const target = path.resolve(path.dirname(filename), name)
          return visit(existsSync(target + '.ts') ? target + '.ts' : path.join(target, 'colors.ts'))
        }
      },
      { filename }
    )
    return exports
  }
  return visit(file)
}

const policy = { waitForBackgroundWork: async () => {}, onPlaybackModeChanged: () => () => {} }
async function extraction(spec) {
  let invocation = 0
  const tool = load('src/main/service/audioFingerprintService.ts', {
    './playbackMode': spec.policy ?? policy,
    'node:child_process': {
      spawn: (exe, args) => {
        const response = spec.steps?.[invocation++] ?? spec
        spec.calls?.push({ exe, args })
        const child = new EventEmitter()
        child.stdout = new EventEmitter()
        child.stderr = new EventEmitter()
        child.kill = () => {
          setTimeout(() => child.emit('close', null), 0)
          return true
        }
        setTimeout(() => {
          spec.onSpawn?.(exe)
          if (response.spawnError) {
            child.emit('error', new Error('spawn ENOENT'))
            child.emit('close', -1)
            return
          }
          if (response.hang) return
          if (response.stderr) child.stderr.emit('data', Buffer.from(response.stderr))
          child.stdout.emit('data', Buffer.from(response.output ?? ''))
          child.emit('close', response.code ?? 0)
        }, 0)
        return child
      }
    }
  })
  return tool.calculateAudioFingerprint(
    'fpcalc',
    spec.file ?? 'fixture.flac',
    spec.signal,
    60,
    spec.compatibility
  )
}
for (const [spec, reason] of [
  [{ output: 'invalid JSON' }, 'invalidOutput'],
  [{ output: JSON.stringify({ duration: 1, fingerprint: [1, 2] }) }, 'insufficientAudio'],
  [{ code: 1, stderr: 'Cannot decode fixture' }, 'decodeFailed'],
  [{ spawnError: true }, 'spawn'],
  [{ output: 'x'.repeat(100001) }, 'outputLimit']
])
  await assert.rejects(extraction(spec), (error) => error.reason === reason)
const validOutput = JSON.stringify({
  duration: 50,
  data: [],
  fingerprint: Array.from({ length: 200 }, (_, i) => i * 17)
})
const warned = await extraction({ code: 3, output: validOutput, stderr: 'invalid frame' })
assert.equal(warned.notices[0].reason, 'decodeWarning')
assert.equal(warned.notices[0].exitCode, 3)
await assert.rejects(
  extraction({ code: 3, output: JSON.stringify({ duration: 12, fingerprint: [1, 2] }) }),
  (error) => error.reason === 'insufficientAudio'
)
await assert.rejects(
  extraction({ code: 3, output: 'bad JSON' }),
  (error) => error.reason === 'invalidOutput'
)
await assert.rejects(
  extraction({ code: 1, output: validOutput }),
  (error) => error.reason === 'decodeFailed'
)
const calls = []
const recovered = await extraction({
  file: 'fixture.dff',
  compatibility: { ffmpeg: 'ffmpeg', sourceDuration: 230 },
  calls,
  steps: [{ code: 2, stderr: 'unsupported input' }, { code: 0 }, { code: 0, output: validOutput }]
})
assert.equal(calls.length, 3)
assert.equal(recovered.duration, 230, 'compatibility decoding preserves the full song duration')
assert.equal(recovered.notices[0].reason, 'compatibilityDecode')
const tempOutput = calls[1].args.at(-1)
assert.ok(!existsSync(path.dirname(tempOutput)), 'compatibility temp files are removed')
const failedCalls = []
await assert.rejects(
  extraction({
    file: 'fixture.dff',
    compatibility: { ffmpeg: 'ffmpeg' },
    calls: failedCalls,
    steps: [{ code: 2 }, { code: 1, stderr: 'decoder rejected source' }]
  }),
  (error) => error.reason === 'decodeFailed' && error.stderr.includes('decoder rejected source')
)
assert.ok(!existsSync(path.dirname(failedCalls[1].args.at(-1))))
const pausePolicy = load('src/main/service/playbackMode.ts')
let didPause = false
const pauseCalls = []
const afterPause = await extraction({
  file: 'fixture.dff',
  compatibility: { ffmpeg: 'ffmpeg' },
  policy: pausePolicy,
  calls: pauseCalls,
  steps: [{ code: 2 }, { hang: true }, { code: 2 }, { code: 0 }, { code: 0, output: validOutput }],
  onSpawn: (exe) => {
    if (exe === 'ffmpeg' && !didPause) {
      didPause = true
      pausePolicy.setPlaybackOnly(true)
      setTimeout(() => pausePolicy.setPlaybackOnly(false), 20)
    }
  }
})
assert.equal(
  pauseCalls.length,
  5,
  'paused compatibility decode retries after background work resumes'
)
assert.equal(afterPause.notices[0].reason, 'compatibilityDecode')
for (const call of pauseCalls.filter((call) => call.exe === 'ffmpeg'))
  assert.ok(!existsSync(path.dirname(call.args.at(-1))))
const cancelController = new AbortController()
const cancelCalls = []
await assert.rejects(
  extraction({
    file: 'fixture.dff',
    compatibility: { ffmpeg: 'ffmpeg' },
    signal: cancelController.signal,
    calls: cancelCalls,
    steps: [{ code: 2 }, { hang: true }],
    onSpawn: (exe) => {
      if (exe === 'ffmpeg') cancelController.abort(new Error('cancelled fallback'))
    }
  }),
  /cancelled fallback/
)
assert.ok(!existsSync(path.dirname(cancelCalls[1].args.at(-1))))
fastTimeout = true
const timeoutCalls = []
await assert.rejects(
  extraction({
    file: 'fixture.dff',
    compatibility: { ffmpeg: 'ffmpeg' },
    calls: timeoutCalls,
    steps: [{ code: 2 }, { hang: true }]
  }),
  (error) => error.reason === 'timeout'
)
assert.ok(!existsSync(path.dirname(timeoutCalls[1].args.at(-1))))
fastTimeout = false
fastTimeout = true
await assert.rejects(extraction({ hang: true }), (error) => error.reason === 'timeout')
fastTimeout = false
await assert.rejects(
  extraction({ code: 1, stderr: 'x'.repeat(10000) + ' https://example.test/audio?token=secret' }),
  (error) => error.stderr.length <= 4096 && !error.stderr.includes('secret') && error.exitCode === 1
)
const errors = load('src/main/service/fingerprintExtractionError.ts')
assert.equal(errors.fingerprintDiagnostic(String.fromCharCode(27) + '[31mdecoder'), 'decoder')
const service = load('src/main/service/duplicateFileService.ts', {
  './fingerprintExtractionError': errors,
  './playbackMode': policy
})
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ep-fingerprint-failure-'))
try {
  const audio = path.join(temporary, 'broken.flac')
  await fs.writeFile(audio, 'invalid audio')
  const failures = []
  const songs = [{ id: 1, audio, title: 'Broken', artist: 'Artist', album: 'Album', duration: 120 }]
  const report = await service.detectDuplicateFiles(songs, () => {}, undefined, {
    deep: true,
    fingerprint: async () => {
      throw new errors.FingerprintExtractionError('decodeFailed', 'invalid audio', 1)
    },
    fingerprintFailure: (failure) => failures.push(failure)
  })
  assert.equal(failures.length, 1, 'main process receives one diagnostic for logging')
  assert.equal(report.fingerprintFailures[0].reason, 'decodeFailed')
  assert.equal(report.fingerprintFailures[0].stderr, 'invalid audio')
  assert.equal(report.fingerprintFailures[0].exitCode, 1)
  assert.equal(report.fingerprintSkipped[0], audio)
  const matcher = load('src/main/service/audioFingerprintMatching.ts')
  assert.deepEqual(
    JSON.parse(JSON.stringify(matcher.unpackFingerprint(matcher.packFingerprint(warned)))),
    JSON.parse(JSON.stringify(warned))
  )
  const cacheEntries = new Map()
  const cache = {
    get: (kind, key) => cacheEntries.get(kind + ':' + key),
    set: (kind, key, value) => cacheEntries.set(kind + ':' + key, value),
    clear: () => cacheEntries.clear()
  }
  let computations = 0,
    warningLogs = 0
  const warningScan = () =>
    service.detectDuplicateFiles(songs, () => {}, undefined, {
      deep: true,
      cache,
      fingerprint: async () => {
        computations++
        return warned
      },
      fingerprintWarning: () => warningLogs++
    })
  const warningReport = await warningScan()
  assert.equal(warningReport.fingerprintSkipped.length, 0)
  assert.equal(warningReport.fingerprintWarnings.length, 1)
  assert.equal(
    (await warningScan()).fingerprintWarnings.length,
    1,
    'whole report reuse retains warnings'
  )
  for (const key of cacheEntries.keys()) if (key.startsWith('report:')) cacheEntries.delete(key)
  assert.equal(
    (await warningScan()).fingerprintWarnings.length,
    1,
    'fingerprint cache reuse also retains warnings'
  )
  assert.equal(computations, 1)
  assert.equal(warningLogs, 1)
  assert.ok(
    service
      .duplicateReportMarkdown(warningReport, 'en')
      .includes('Warnings for retained fingerprints')
  )

  for (const language of ['en', 'zh']) {
    const md = service.duplicateReportMarkdown(report, language)
    assert.ok(md.includes('invalid audio') && md.includes(audio))
    assert.ok(
      md.includes(language === 'en' ? 'Audio decoding or extraction failed' : '音频解码或提取失败')
    )
    assert.ok(!md.includes('checkingMs'))
    if (language === 'en') assert.equal(/[\u4e00-\u9fff]/u.test(md), false)
    else assert.equal(md.includes('Fingerprint unavailable'), false)
  }
  const controller = new AbortController()
  const cancelled = service.detectDuplicateFiles(songs, () => {}, controller.signal, {
    deep: true,
    fingerprint: async () => {
      controller.abort()
      throw new Error('cancelled')
    },
    fingerprintFailure: () => {
      throw new Error('cancellation must never be logged as a file failure')
    }
  })
  await assert.rejects(cancelled)
  assert.equal(await fs.readFile(audio, 'utf8'), 'invalid audio')
  console.log(
    'Fingerprint diagnostics/export tests passed: decode, invalid JSON, short audio, spawn, timeout, output limits, bounded/redacted stderr, cancellation exclusion and single-language reports.'
  )
} finally {
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()))
  assert.ok(path.basename(temporary).startsWith('ep-fingerprint-failure-'))
  await fs.rm(temporary, { recursive: true, force: true })
}

if (process.argv.includes('--library-smoke')) {
  const root = process.env.EASY_PLAYER_DATA_DIR || path.join(process.env.APPDATA, 'easy_player')
  const files = (await fs.readdir(path.join(root, 'player_log')))
    .filter((file) => /^log-.*\.log$/.test(file))
    .sort()
    .slice(-2)
  const failures = new Map()
  for (const log of files) {
    for (const line of (await fs.readFile(path.join(root, 'player_log', log), 'utf8')).split(
      '\n'
    )) {
      const marker = '[Duplicate Files] fingerprint extraction failed '
      if (!line.includes(marker)) continue
      try {
        const failure = JSON.parse(line.split(marker)[1])
        failures.set(failure.path, failure)
      } catch {
        /* Ignore unrelated incomplete log lines. */
      }
    }
  }
  const realTool = load('src/main/service/audioFingerprintService.ts', { './playbackMode': policy })
  const executable = path.resolve('resources/lib/fpcalc/win32-x64/fpcalc.exe')
  const ffmpeg = path.resolve('build/native-addon/ffmpeg.exe')
  const result = { validWithWarning: 0, compatible: 0, insufficient: 0, sidecars: 0, unexpected: 0 }
  for (const failure of failures.values()) {
    if (failure.path.split(/[\\/]/).some((part) => part === '__MACOSX' || part.startsWith('._'))) {
      result.sidecars++
      continue
    }
    try {
      const fp = await realTool.calculateAudioFingerprint(executable, failure.path, undefined, 60, {
        ffmpeg
      })
      if (fp.notices?.some((notice) => notice.reason === 'compatibilityDecode')) result.compatible++
      else if (fp.notices?.some((notice) => notice.reason === 'decodeWarning'))
        result.validWithWarning++
      else result.unexpected++
    } catch (error) {
      if (error.reason === 'insufficientAudio') result.insufficient++
      else {
        result.unexpected++
        console.log('Unexpected recovery failure:', error.reason, error.stderr)
      }
    }
  }
  assert.equal(result.unexpected, 0)
  console.log('Read-only recovery on previously failing library files:', JSON.stringify(result))
}
