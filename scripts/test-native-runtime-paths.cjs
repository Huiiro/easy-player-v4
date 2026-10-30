/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS build helper test. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const {
  nativeRuntimePaths,
  copyIfDifferent,
  nativeDependencyRoot,
  nativeProfileHash
} = require('./native-runtime-paths.cjs')

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'easy-player-native-paths-'))
try {
  const output = path.join(directory, 'output')
  const local = path.join(directory, 'resources/lib/ffmpeg')
  const configured = nativeDependencyRoot(directory)
  fs.mkdirSync(output, { recursive: true })
  for (const relative of [
    'ffmpeg-profile.cmake',
    'vcpkg.json',
    'triplets/x64-windows-audio.cmake',
    'sources.json'
  ]) {
    const file = path.join(directory, 'resources/lib/native-deps', relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.copyFileSync(path.resolve('resources/lib/native-deps', relative), file)
  }
  assert.throws(() => nativeRuntimePaths(directory, output), /prepare:native/)
  const dlls = {}
  for (const prefix of ['avcodec', 'avformat', 'avutil', 'avfilter', 'swresample']) {
    const name = prefix + '-1.dll'
    const file = path.join(configured, 'bin', name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, name)
    dlls[name] = crypto.createHash('sha256').update(name).digest('hex')
  }
  const manifest = {
    formatVersion: 1,
    profile: 'audio-core',
    profileSha256: nativeProfileHash(directory),
    dlls
  }
  const manifestFile = path.join(configured, 'share/ffmpeg/easy-player-runtime.json')
  fs.mkdirSync(path.dirname(manifestFile), { recursive: true })
  fs.writeFileSync(manifestFile, JSON.stringify(manifest))
  assert.equal(nativeRuntimePaths(directory, output).ffmpegRoot, configured)
  fs.writeFileSync(
    path.join(output, 'CMakeCache.txt'),
    [
      `FFMPEG_ROOT:PATH=${configured}`,
      `AVCODEC_LIB:FILEPATH=${path.join(configured, 'lib/avcodec.lib')}`,
      `SAMPLERATE_DLL:FILEPATH=${path.join(directory, 'samplerate.dll')}`
    ].join('\n')
  )
  const runtime = nativeRuntimePaths(directory, output)
  assert.equal(
    runtime.ffmpegRoot,
    configured,
    'Development and packaging must use the same pinned audio FFmpeg'
  )
  assert.equal(runtime.samplerate, path.join(configured, 'bin/samplerate.dll'))
  fs.appendFileSync(
    path.join(output, 'CMakeCache.txt'),
    `\nAVCODEC_LIB:FILEPATH=${path.join(local, 'lib/avcodec.lib')}`
  )
  assert.throws(() => nativeRuntimePaths(directory, output), /cache is inconsistent/)
  fs.writeFileSync(path.join(output, 'CMakeCache.txt'), `FFMPEG_ROOT:PATH=${local}`)
  assert.throws(() => nativeRuntimePaths(directory, output), /another FFmpeg build/)
  fs.writeFileSync(path.join(output, 'CMakeCache.txt'), '')
  const tampered = path.join(configured, 'bin/avcodec-1.dll')
  fs.writeFileSync(tampered, 'tampered')
  assert.throws(() => nativeRuntimePaths(directory, output), /does not match its manifest/)
  fs.writeFileSync(tampered, 'avcodec-1.dll')
  fs.appendFileSync(
    path.join(directory, 'resources/lib/native-deps/ffmpeg-profile.cmake'),
    '\n# profile changed'
  )
  assert.throws(() => nativeRuntimePaths(directory, output), /profile changed/)
  const source = path.join(directory, 'source')
  const target = path.join(directory, 'target')
  fs.writeFileSync(source, 'same bytes')
  fs.writeFileSync(target, 'same bytes')
  fs.utimesSync(target, 1, 1)
  copyIfDifferent(source, target)
  assert.equal(fs.statSync(target).mtimeMs, 1000, 'Identical loaded DLLs must not be rewritten')
  fs.writeFileSync(source, 'changed bytes')
  copyIfDifferent(source, target)
  assert.equal(fs.readFileSync(target, 'utf8'), 'changed bytes')
  console.log('Native runtime source and copy checks passed.')
} finally {
  fs.rmSync(directory, { recursive: true, force: true })
}
