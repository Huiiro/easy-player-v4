/* eslint-disable @typescript-eslint/no-require-imports -- Windows packaging regression test. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { verifyWindowsRuntime, peInfo } = require('./windows-runtime.cjs')

const source = path.resolve('build/native-addon')
const directory = fs.mkdtempSync(path.resolve('build/crt-runtime-check-'))
try {
  const native = path.join(directory, 'native')
  const app = path.join(directory, 'app')
  fs.mkdirSync(native)
  fs.mkdirSync(app)
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'msvc-runtime.json'), 'utf8'))
  for (const name of [
    'ffmpeg.exe',
    'SoundTouch.dll',
    'samplerate.dll',
    'msvc-runtime.json',
    ...Object.keys(manifest.dlls)
  ])
    fs.copyFileSync(path.join(source, name), path.join(native, name))
  for (const name of Object.keys(manifest.dlls))
    fs.copyFileSync(path.join(source, name), path.join(app, name))
  assert.equal(peInfo(path.join(native, 'ffmpeg.exe')).machine, 0x8664)
  assert.ok(peInfo(path.join(native, 'SoundTouch.dll')).imports.includes('MSVCP140.dll'))
  verifyWindowsRuntime(native, app)
  fs.unlinkSync(path.join(app, 'vcruntime140.dll'))
  assert.throws(() => verifyWindowsRuntime(native, app), /missing, mismatched/)
  fs.copyFileSync(path.join(source, 'vcruntime140.dll'), path.join(app, 'vcruntime140.dll'))
  fs.writeFileSync(path.join(native, 'vcruntime140.dll'), 'corrupted')
  assert.throws(() => verifyWindowsRuntime(native, app), /missing, mismatched/)
  fs.copyFileSync(path.join(source, 'vcruntime140.dll'), path.join(native, 'vcruntime140.dll'))
  delete manifest.dlls['msvcp140.dll']
  fs.writeFileSync(path.join(native, 'msvc-runtime.json'), JSON.stringify(manifest))
  assert.throws(() => verifyWindowsRuntime(native, app), /Unbundled VC\+\+ dependency/)
  console.log(
    'Windows CRT: PE import scan, app/native copies, hash checks and missing dependency rejection passed'
  )
} finally {
  fs.rmSync(directory, { recursive: true, force: true })
}
