/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder loads a CommonJS hook. */
const fs = require('node:fs')
const path = require('node:path')

module.exports = async (context) => {
  if (context.electronPlatformName === 'darwin') {
    const arch = context.arch === 3 ? 'arm64' : context.arch === 1 ? 'x64' : null
    if (!arch) throw new Error('Verify individual Mac architectures before building universal')
    require('./macos-runtime.cjs').verifyMacosRuntime(
      path.join(context.packager.projectDir, 'build/native-addon'),
      arch,
      context.packager.projectDir
    )
    const crypto = require('node:crypto')
    const root = context.packager.projectDir
    const release = JSON.parse(
      fs.readFileSync(path.join(root, 'resources/lib/ytdlp-release.json'), 'utf8')
    )
    const yt = fs.readFileSync(path.join(root, 'resources/lib/yt-dlp/mac/yt-dlp'))
    if (
      yt.length !== release.assets['yt-dlp_macos'].size ||
      crypto.createHash('sha256').update(yt).digest('hex') !== release.assets['yt-dlp_macos'].sha256
    )
      throw new Error('Mac yt-dlp source asset does not match the locked official digest')
    return
  }
  if (context.electronPlatformName !== 'win32') return
  if (context.arch !== 1)
    throw new Error('The bundled Auto Mix runtime currently supports Windows x64 only')
  const root = context.packager.projectDir
  for (const relative of [
    'build/native-addon/ffmpeg.exe',
    'build/native-addon/ffmpeg-runtime.json',
    'build/native-addon/msvc-runtime.json',
    'resources/lib/yt-dlp/win/yt-dlp.exe',
    'resources/lib/yt-dlp/win/yt-dlp.exe.manifest.json',
    'build/native-addon/easy_player_native.node',
    'build/native-addon/samplerate.dll',
    'build/native-addon/SoundTouch.dll',
    'build/native-addon/FFmpeg-LICENSE.txt',
    'resources/auto-mix/stem_worker.py'
  ]) {
    if (!fs.existsSync(path.join(root, relative))) {
      throw new Error(
        `Missing base package resource: ${relative}. Run npm run build:native and npm run prepare:ffmpeg first.`
      )
    }
  }
}
