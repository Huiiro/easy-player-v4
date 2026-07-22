import path from 'path'

export function getFfmpegPath(): string {
  const execName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'

  if (process.env.NODE_ENV !== 'production') {
    // Dev mode: ffmpeg lives inside the native addon deps directory.
    // process.cwd() is the project root during electron-vite dev.
    return path.join(
      process.cwd(),
      'src',
      'main',
      'native',
      'deps',
      'ffmpeg',
      'ffmpeg-master-latest-win64-gpl-shared',
      'bin',
      execName
    )
  }

  // Production: ffmpeg should be bundled alongside the app resources.
  if (process.resourcesPath) {
    return path.join(process.resourcesPath, 'bin', execName)
  }

  // Fallback: plain Node.js production (unlikely for Electron).
  return path.join(
    __dirname,
    'ffmpeg-master-latest-win64-gpl-shared',
    'bin',
    execName
  )
}
