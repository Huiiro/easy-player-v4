/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder loads a CommonJS hook. */
const fs = require('node:fs')
const path = require('node:path')
const { Arch } = require('builder-util')
const { writeThirdPartyNotices } = require('./collect-third-party-notices.cjs')

module.exports = async (context) => {
  const root = context.packager.projectDir
  const arch = Arch[context.arch]
  if (context.electronPlatformName === 'darwin' && arch !== 'arm64' && arch !== 'x64')
    throw new Error('Verify individual Mac architectures before building universal')
  if (context.electronPlatformName === 'win32' && arch !== 'x64')
    throw new Error('The bundled Auto Mix runtime currently supports Windows x64 only')
  writeThirdPartyNotices(root, context.electronPlatformName, arch)
  if (context.electronPlatformName === 'darwin') {
    require('../lib/macos-runtime.cjs').verifyMacosRuntime(
      path.join(root, 'build/native-addon'),
      arch,
      root
    )
    const crypto = require('node:crypto')
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
  for (const relative of [
    'build/native-addon/ffmpeg.exe',
    'build/native-addon/ffmpeg-runtime.json',
    'build/native-addon/msvc-runtime.json',
    'resources/lib/yt-dlp/win/yt-dlp.exe',
    'resources/lib/yt-dlp/win/yt-dlp.exe.manifest.json',
    'build/native-addon/easy_player_native.node',
    'build/native-addon/easy_player_smtc.node',
    'build/native-addon/easy_player_window.node',
    'build/taskbar-controls/bin/Release/easy_player_taskbar.exe',
    'resources/lib/fpcalc/win32-x64/fpcalc.exe',
    'resources/lib/fpcalc/win32-x64/manifest.json',
    'resources/lib/fpcalc/win32-x64/LICENSE.md',
    'resources/lib/fpcalc/win32-x64/LGPL-2.1.txt',
    'resources/lib/fpcalc/win32-x64/SOURCES.txt',
    'build/native-addon/samplerate.dll',
    'build/native-addon/SoundTouch.dll',
    'build/native-addon/FFmpeg-LICENSE.txt',
    'resources/auto-mix/stem_worker.py'
  ]) {
    if (!fs.existsSync(path.join(root, relative))) {
      throw new Error(
        `Missing base package resource: ${relative}. Run npm run build:native, npm run build:taskbar, npm run prepare:fpcalc, npm run prepare:ytdlp and npm run prepare:ffmpeg first.`
      )
    }
  }
}
