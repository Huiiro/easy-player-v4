/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')
const asar = require('@electron/asar')

const archive = path.resolve(process.argv[2] || 'dist/win-unpacked/resources/app.asar')
const entries = asar
  .listPackage(archive)
  .map((entry) => entry.replace(/\\/g, '/').replace(/^\//, ''))
const developmentRoots = ['vcpkg', 'plugins', 'packages', 'scripts']
const sourceSDKs = ['@neteasecloudmusicapienhanced/api', 'kugoumusicapi', 'qrc-decoder']
const forbidden = entries.filter(
  (entry) =>
    developmentRoots.some((root) => entry === root || entry.startsWith(root + '/')) ||
    sourceSDKs.some(
      (name) => entry === 'node_modules/' + name || entry.startsWith('node_modules/' + name + '/')
    ) ||
    entry.endsWith('.epp')
)
console.log(`app.asar size: ${(fs.statSync(archive).size / 1024 ** 2).toFixed(1)} MiB`)
console.log(
  `app.asar roots: ${[...new Set(entries.map((entry) => entry.split('/')[0]))].join(', ')}`
)
if (forbidden.length) {
  throw new Error(
    `Optional plugins or development files were packaged: ${forbidden.slice(0, 10).join(', ')}`
  )
}
if (!entries.includes('out/main/index.js')) {
  throw new Error('Packaged application entry point is missing')
}
const main = asar.extractFile(archive, path.join('out', 'main', 'index.js')).toString('utf8')
if (
  ['DoSearchForQQMusicDesktop', 'song_wiki_summary', 'krm_audio'].some((name) =>
    main.includes(name)
  )
) {
  throw new Error('A source implementation was bundled into the application main process')
}
const nativeDir = path.join(path.dirname(archive), 'native')
const nativeEntries = fs.readdirSync(nativeDir, { withFileTypes: true })
const nativeFiles = nativeEntries.map((entry) => entry.name)
const unexpectedNativeFiles = nativeEntries.filter(
  (entry) =>
    !entry.isFile() ||
    (![
      'easy_player_native.node',
      'easy_player_taskbar.exe',
      'ffmpeg.exe',
      'FFmpeg-LICENSE.txt'
    ].includes(entry.name) &&
      !entry.name.toLowerCase().endsWith('.dll')) ||
    entry.name.toLowerCase() === 'easy_player_native.dll'
)
if (unexpectedNativeFiles.length) {
  throw new Error(
    `Non-runtime native files were packaged: ${unexpectedNativeFiles.map((entry) => entry.name).join(', ')}`
  )
}
for (const name of [
  'easy_player_native.node',
  'samplerate.dll',
  'SoundTouch.dll',
  'ffmpeg.exe',
  'FFmpeg-LICENSE.txt'
]) {
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
for (const relative of ['resources/auto-mix/stem_worker.py']) {
  if (!fs.existsSync(path.join(path.dirname(archive), relative))) {
    throw new Error(`Bundled stem runtime resource is missing: ${relative}`)
  }
}
for (const relative of ['tools/auto-mix-python', 'tools/auto-mix-models']) {
  if (fs.existsSync(path.join(path.dirname(archive), relative))) {
    throw new Error(`Optional component must not be bundled in the base installer: ${relative}`)
  }
}
console.log('Windows package content check passed')
