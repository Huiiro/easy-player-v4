const fs = require('node:fs')
const path = require('node:path')
const asar = require('@electron/asar')

const archive = path.resolve(process.argv[2] || 'dist/win-unpacked/resources/app.asar')
const entries = asar
  .listPackage(archive)
  .map((entry) => entry.replace(/\\/g, '/').replace(/^\//, ''))
const forbidden = entries.filter((entry) => entry === 'vcpkg' || entry.startsWith('vcpkg/'))
console.log(`app.asar size: ${(fs.statSync(archive).size / 1024 ** 2).toFixed(1)} MiB`)
console.log(
  `app.asar roots: ${[...new Set(entries.map((entry) => entry.split('/')[0]))].join(', ')}`
)
if (forbidden.length) {
  throw new Error(`Build-only vcpkg files were packaged: ${forbidden.slice(0, 10).join(', ')}`)
}
if (!entries.includes('out/main/index.js')) {
  throw new Error('Packaged application entry point is missing')
}
const nativeDir = path.join(path.dirname(archive), 'native')
const nativeEntries = fs.readdirSync(nativeDir, { withFileTypes: true })
const nativeFiles = nativeEntries.map((entry) => entry.name)
const unexpectedNativeFiles = nativeEntries.filter(
  (entry) =>
    !entry.isFile() ||
    (entry.name !== 'easy_player_native.node' && !entry.name.toLowerCase().endsWith('.dll')) ||
    entry.name.toLowerCase() === 'easy_player_native.dll'
)
if (unexpectedNativeFiles.length) {
  throw new Error(
    `Non-runtime native files were packaged: ${unexpectedNativeFiles.map((entry) => entry.name).join(', ')}`
  )
}
for (const name of ['easy_player_native.node', 'samplerate.dll', 'SoundTouch.dll']) {
  if (!nativeFiles.includes(name)) throw new Error(`Required native runtime is missing: ${name}`)
}
for (const prefix of ['avcodec-', 'avformat-', 'avutil-', 'swresample-']) {
  const matches = nativeFiles.filter(
    (name) => name.startsWith(prefix) && name.toLowerCase().endsWith('.dll')
  )
  if (matches.length !== 1) {
    throw new Error(`Expected one ${prefix} runtime DLL, found ${matches.length}`)
  }
}
const nativeBytes = nativeFiles.reduce(
  (total, name) => total + fs.statSync(path.join(nativeDir, name)).size,
  0
)
console.log(`Native runtime size: ${(nativeBytes / 1024 ** 2).toFixed(1)} MiB`)
console.log('Windows package content check passed')
