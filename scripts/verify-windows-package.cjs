/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')
const asar = require('@electron/asar')
const crypto = require('node:crypto')
const { nativeProfileHash } = require('./native-runtime-paths.cjs')
const { verifyWindowsRuntime } = require('./windows-runtime.cjs')
const { spawnSync } = require('node:child_process')

const archive = path.resolve(process.argv[2] || 'dist/win-unpacked/resources/app.asar')
const entries = asar
  .listPackage(archive)
  .map((entry) => entry.replace(/\\/g, '/').replace(/^\//, ''))
const developmentRoots = [
  'vcpkg',
  'plugins',
  'packages',
  'scripts',
  'tests',
  'engine-core',
  'engine-windows',
  'engine-macos',
  '.update'
]
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
      'ffmpeg-runtime.json',
      'msvc-runtime.json',
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
  'ffmpeg-runtime.json',
  'msvc-runtime.json',
  'FFmpeg-LICENSE.txt'
]) {
  if (!nativeFiles.includes(name)) throw new Error(`Required native runtime is missing: ${name}`)
}
for (const prefix of ['avcodec-', 'avformat-', 'avutil-', 'swresample-', 'avfilter-']) {
  const matches = nativeFiles.filter(
    (name) => name.startsWith(prefix) && name.toLowerCase().endsWith('.dll')
  )
  if (matches.length !== 1) {
    throw new Error(`Expected one ${prefix} runtime DLL, found ${matches.length}`)
  }
}
const ffmpegRuntime = JSON.parse(
  fs.readFileSync(path.join(nativeDir, 'ffmpeg-runtime.json'), 'utf8')
)
if (
  ffmpegRuntime.profile !== 'audio-core' ||
  ffmpegRuntime.profileSha256 !== nativeProfileHash(path.resolve(__dirname, '..'))
)
  throw new Error('Packaged FFmpeg does not use the current pinned audio profile')
const ffmpegDlls = Object.keys(ffmpegRuntime.dlls)
if (
  ffmpegDlls.length !== 5 ||
  ffmpegDlls.some((name) => !/^(avcodec|avformat|avutil|avfilter|swresample)-\d+\.dll$/.test(name))
)
  throw new Error('Invalid audio FFmpeg runtime manifest')
for (const name of ffmpegDlls) {
  const file = path.join(nativeDir, name)
  if (
    crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !==
    ffmpegRuntime.dlls[name]
  )
    throw new Error(`Packaged FFmpeg DLL checksum mismatch: ${name}`)
}
if (nativeFiles.some((name) => /^(avdevice|swscale|postproc)-\d+\.dll$/i.test(name)))
  throw new Error('Video/device FFmpeg libraries must not be packaged')
const ffmpegBytes = ffmpegDlls.reduce(
  (total, name) => total + fs.statSync(path.join(nativeDir, name)).size,
  fs.statSync(path.join(nativeDir, 'ffmpeg.exe')).size
)
if (ffmpegBytes > 15 * 1024 ** 2) throw new Error('Audio FFmpeg runtime exceeds 15 MiB')
console.log(`Audio FFmpeg size: ${(ffmpegBytes / 1024 ** 2).toFixed(2)} MiB`)
const nativeBytes = nativeFiles.reduce(
  (total, name) => total + fs.statSync(path.join(nativeDir, name)).size,
  0
)
console.log(`Native runtime size: ${(nativeBytes / 1024 ** 2).toFixed(1)} MiB`)
const crt = verifyWindowsRuntime(nativeDir, path.resolve(path.dirname(archive), '..'))
console.log(`VC++ runtime dependency closure verified: ${Object.keys(crt.dlls).join(', ')}`)
const ytdlpDirectory = path.join(path.dirname(archive), 'lib/yt-dlp')
const ytdlp = path.join(ytdlpDirectory, 'yt-dlp.exe')
const ytdlpManifest = JSON.parse(
  fs.readFileSync(path.join(ytdlpDirectory, 'yt-dlp.manifest.json'), 'utf8')
)
const ytdlpLock = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../resources/lib/ytdlp-release.json'), 'utf8')
)
const ytdlpAsset = ytdlpLock.assets['yt-dlp.exe']
if (
  ytdlpManifest.version !== ytdlpLock.version ||
  ytdlpManifest.asset !== 'yt-dlp.exe' ||
  ytdlpManifest.platform !== 'win32' ||
  ytdlpManifest.arch !== 'x64' ||
  ytdlpManifest.sha256 !== ytdlpAsset.sha256 ||
  ytdlpManifest.size !== ytdlpAsset.size ||
  fs.statSync(ytdlp).size !== ytdlpAsset.size ||
  crypto.createHash('sha256').update(fs.readFileSync(ytdlp)).digest('hex') !== ytdlpAsset.sha256
)
  throw new Error('Packaged yt-dlp does not match the locked version and official SHA-256')
const ytdlpVersion = spawnSync(ytdlp, ['--version'], {
  encoding: 'utf8',
  windowsHide: true,
  timeout: 30_000
})
if (
  ytdlpVersion.error ||
  ytdlpVersion.status !== 0 ||
  ytdlpVersion.stdout.trim() !== ytdlpLock.version
)
  throw new Error('Packaged yt-dlp version smoke test failed')
console.log(`yt-dlp ${ytdlpLock.version}: official SHA-256 and executable verified`)
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
