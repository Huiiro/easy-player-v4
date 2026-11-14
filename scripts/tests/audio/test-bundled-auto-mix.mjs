/* eslint-disable @typescript-eslint/explicit-function-return-type -- Plain JavaScript integration test. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const mac = process.platform === 'darwin'
const resources = path.resolve(
  process.argv[2] ||
    (mac ? 'dist/mac-arm64/EasyPlayer.app/Contents/Resources' : 'dist/win-unpacked/resources')
)
const runtime = path.resolve(process.argv[3] || 'build/auto-mix-runtime')
const python = path.join(runtime, mac ? 'python/bin/python3' : 'python/python.exe')
const ffmpeg = path.join(resources, mac ? 'native/ffmpeg' : 'native/ffmpeg.exe')
const models = path.join(runtime, 'models')
const worker = path.join(resources, 'resources/auto-mix/stem_worker.py')
const build = path.resolve('build')
const directory = await fs.mkdtemp(path.join(build, 'bundled stem check 音频 '))
const environment = {
  ...process.env,
  PATH: mac ? '/usr/bin:/bin' : path.join(process.env.SystemRoot || 'C:/Windows', 'System32'),
  PYTHONHOME: path.join(directory, 'missing-system-python'),
  PYTHONPATH: path.join(directory, 'missing-system-packages'),
  TORCH_HOME: path.join(directory, 'empty-model-cache'),
  PYTHONDONTWRITEBYTECODE: '1'
}
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    env: environment,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 240_000,
    maxBuffer: 4 * 1024 * 1024,
    ...options
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout
}
function wave(frequency) {
  const rate = 44100,
    frames = rate * 3
  const buffer = Buffer.alloc(44 + frames * 4)
  buffer.write('RIFF')
  buffer.writeUInt32LE(buffer.length - 8, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(2, 22)
  buffer.writeUInt32LE(rate, 24)
  buffer.writeUInt32LE(rate * 4, 28)
  buffer.writeUInt16LE(4, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(frames * 4, 40)
  for (let i = 0; i < frames; ++i) {
    const value = Math.round(6000 * Math.sin((i * Math.PI * 2 * frequency) / rate))
    buffer.writeInt16LE(value, 44 + i * 4)
    buffer.writeInt16LE(value, 46 + i * 4)
  }
  return buffer
}
try {
  const version = run(ffmpeg, ['-version']).split('\n')[0]
  const source = path.join(directory, 'outgoing.wav'),
    next = path.join(directory, 'incoming.wav')
  await fs.writeFile(source, wave(220))
  await fs.writeFile(next, wave(440))
  const request = {
    sourcePath: source,
    nextPath: next,
    revision: 1,
    sampleRate: 44100,
    channels: 2,
    outStartFrame: 88200,
    inStartFrame: 0,
    fadeFrames: 44100,
    vocalCue: false
  }
  // Forbid model downloads as well as removing system Python/FFmpeg from PATH.
  const bootstrap = [
    'import sys, socket, urllib.request, runpy',
    'def offline(*args, **kwargs): raise RuntimeError("Network access forbidden in package test")',
    'socket.create_connection = urllib.request.urlopen = offline',
    'sys.argv = sys.argv[1:]',
    'runpy.run_path(sys.argv[0], run_name="__main__")'
  ].join('\n')
  const output = run(
    python,
    [
      '-I',
      '-B',
      '-X',
      'utf8',
      '-c',
      bootstrap,
      worker,
      '--cache',
      path.join(directory, 'stems'),
      '--ffmpeg',
      ffmpeg,
      '--model-repo',
      models
    ],
    {
      input: [1, 2].map((id) => JSON.stringify({ ...request, id })).join('\n') + '\n'
    }
  )
  const results = output
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line))
  assert.equal(results.length, 2)
  for (const result of results) {
    assert.equal(result.ok, true, result.error)
    assert.ok((await fs.stat(result.outVocals)).size > 44)
    assert.ok((await fs.stat(result.inVocals)).size > 44)
  }
  assert.equal(results[0].cached, false)
  assert.equal(results[1].cached, true)
  console.log(
    JSON.stringify({
      ffmpeg: version,
      offlineInference: 'passed',
      isolatedPython: 'passed',
      initialSeconds: results[0].seconds,
      cachedSeconds: results[1].seconds,
      repeatCacheHit: true
    })
  )
} finally {
  assert.equal(path.dirname(path.resolve(directory)), build)
  assert.ok(path.basename(directory).startsWith('bundled stem check '))
  await fs.rm(directory, { recursive: true, force: true })
}
