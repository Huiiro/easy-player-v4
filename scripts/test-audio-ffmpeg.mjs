/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone integration test. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createDsdFixtures } from './lib/dsd-fixtures.mjs'

const require = createRequire(import.meta.url)
const runtime = path.resolve(process.argv[2] || 'build/native-addon')
const ffmpeg = path.join(runtime, 'ffmpeg.exe')
const environment = {
  ...process.env,
  PATH: path.join(process.env.SystemRoot || 'C:/Windows', 'System32')
}
const run = (args) => {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-v', 'error', ...args], {
    env: environment,
    windowsHide: true,
    maxBuffer: 4 * 1024 ** 2,
    timeout: 20_000
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr?.toString())
  return result.stdout
}
const decoders = run(['-decoders']).toString()
for (const name of [
  'mp3',
  'aac',
  'alac',
  'ape',
  'flac',
  'opus',
  'vorbis',
  'dsd_lsbf',
  'dsd_msbf',
  'dst',
  'pcm_s16le',
  'pcm_s24le',
  'pcm_f32le'
])
  assert.match(decoders, new RegExp(`\\b${name}\\b`))
for (const match of decoders.matchAll(/^\s+V[A-Z.]{5}\s+([a-z0-9_]+)/gm))
  assert.ok(
    ['bmp', 'mjpeg', 'png', 'vp8', 'webp'].includes(match[1]),
    `Unexpected video decoder: ${match[1]}`
  )
assert.doesNotMatch(run(['-encoders']).toString(), /^\s+V[A-Z.]{5}\s+[a-z0-9_]+/m)
const filters = run(['-filters']).toString()
assert.match(filters, /\baresample\b/)
assert.doesNotMatch(filters, /\b(scale|zscale|overlay|subtitles|libplacebo)\b/)
const protocols = run(['-protocols']).toString()
for (const name of ['file', 'pipe', 'http', 'https', 'tls'])
  assert.match(protocols, new RegExp(`\\b${name}\\b`))
const fixtureRoot = path.resolve('tests/fixtures/audio-core')
const fixtures = (await fs.readdir(fixtureRoot))
  .filter((name) => !name.endsWith('.md'))
  .map((name) => path.join(fixtureRoot, name))
assert.equal(fixtures.length, 7)
const temporary = await fs.mkdtemp(path.resolve('build/audio-core-dsd-'))
try {
  fixtures.push(...(await createDsdFixtures(temporary)))
  for (const fixture of fixtures) {
    const pcm = run([
      '-i',
      fixture,
      '-map',
      '0:a:0',
      '-ac',
      '2',
      '-ar',
      '44100',
      '-c:a',
      'pcm_f32le',
      '-f',
      'f32le',
      'pipe:1'
    ])
    assert.ok(pcm.length > 4096, path.basename(fixture))
    let peak = 0
    for (let offset = 0; offset + 4 <= pcm.length; offset += 4) {
      const sample = pcm.readFloatLE(offset)
      assert.ok(Number.isFinite(sample))
      peak = Math.max(peak, Math.abs(sample))
    }
    if (!['.dsf', '.dff'].includes(path.extname(fixture)))
      assert.ok(peak > 0.01 && peak < 1, `Invalid decoded signal: ${fixture}`)
  }
  const code = `const {AudioEngine}=require(process.argv[1]); const files=JSON.parse(process.argv[2]); const engine=new AudioEngine(); for(const file of files){if(!engine.open(file))throw Error('Cannot open '+file);engine.stop();}console.log('Native playback decoder: '+files.length+' formats passed');`
  const native = spawnSync(
    require('electron'),
    ['-e', code, path.join(runtime, 'easy_player_native.node'), JSON.stringify(fixtures)],
    {
      env: { ...environment, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000
    }
  )
  assert.ifError(native.error)
  assert.equal(native.status, 0, native.stderr || native.stdout)
  console.log(native.stdout.trim())
  console.log(
    'Audio FFmpeg: codec profile, artwork-only video decoding, HTTPS protocols, seven audio codecs and DSF/DFF PCM decoding passed'
  )
} finally {
  await fs.rm(temporary, { recursive: true, force: true })
}
