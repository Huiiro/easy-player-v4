/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const worker = process.argv[2] === '--worker'
const folder = worker ? process.argv[3] : fs.mkdtempSync(path.resolve('build/native-next-track-'))
const paths = ['a.wav', 'b.wav', 'c.wav'].map((name) => path.join(folder, name))
// One second of silence; this test opens decoders without starting audio output.
const pcm = Buffer.alloc(44100 * 2 * 2)
const header = Buffer.alloc(44)
header.write('RIFF', 0)
header.writeUInt32LE(36 + pcm.length, 4)
header.write('WAVEfmt ', 8)
header.writeUInt32LE(16, 16)
header.writeUInt16LE(1, 20)
header.writeUInt16LE(2, 22)
header.writeUInt32LE(44100, 24)
header.writeUInt32LE(44100 * 4, 28)
header.writeUInt16LE(4, 32)
header.writeUInt16LE(16, 34)
header.write('data', 36)
header.writeUInt32LE(pcm.length, 40)
if (!worker) {
  for (const file of paths) fs.writeFileSync(file, Buffer.concat([header, pcm]))
  try {
    const result = spawnSync(process.execPath, [__filename, '--worker', folder], {
      env: process.env,
      encoding: 'utf8'
    })
    process.stdout.write(result.stdout || '')
    process.stderr.write(result.stderr || '')
    assert.equal(result.status, 0, 'native decoder checks complete successfully')
  } finally {
    // The worker has exited, so Windows decoder handles are now released.
    for (const file of paths) fs.unlinkSync(file)
    fs.rmdirSync(folder)
  }
  process.exit(0)
}
const { AudioEngine } = require(
  path.resolve(process.env.TEST_ADDON || 'build/native-addon/easy_player_native.node')
)
const engine = new AudioEngine()
try {
  assert.equal(engine.open(paths[0]), true)
  assert.equal(engine.setNextTrack(paths[1], paths[0]), true, 'prepare B for decoder A')
  assert.equal(
    engine.setNextTrack(paths[2], paths[2]),
    false,
    'wrong source cannot replace the target'
  )
  assert.equal(engine.open(paths[1]), true)
  assert.equal(engine.setNextTrack(paths[2], paths[1]), true, 'prepare C for decoder B')
  assert.equal(
    engine.setNextTrack(paths[1], paths[0]),
    false,
    'late A-to-B preload cannot repeat decoder B'
  )
  assert.equal(engine.setNextTrack('', paths[0]), false, 'late clear for A cannot erase B-to-C')
  assert.equal(engine.setNextTrack(paths[2], paths[1]), true)
  assert.equal(
    engine.setNextTrack(paths[1], paths[1]),
    true,
    'intentional single-track repeat remains supported'
  )
  assert.equal(engine.setNextTrack('', paths[1]), true)
  console.log(
    'Native next-track source validation, stale preload/clear rejection and single repeat passed.'
  )
} finally {
  engine.stop()
}
