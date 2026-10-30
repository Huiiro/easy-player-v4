/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder loads a CommonJS hook. */
const fs = require('node:fs')
const path = require('node:path')

module.exports = async (context) => {
  if (context.electronPlatformName !== 'win32') return
  if (context.arch !== 1)
    throw new Error('The bundled Auto Mix runtime currently supports Windows x64 only')
  const root = context.packager.projectDir
  for (const relative of [
    'build/native-addon/ffmpeg.exe',
    'build/native-addon/easy_player_native.node',
    'build/native-addon/samplerate.dll',
    'build/native-addon/SoundTouch.dll',
    'build/native-addon/FFmpeg-LICENSE.txt',
    'resources/auto-mix/stem_worker.py'
  ]) {
    if (!fs.existsSync(path.join(root, relative))) {
      throw new Error(
        `Missing Auto Mix package resource: ${relative}. Run npm run prepare:auto-mix first.`
      )
    }
  }
}
