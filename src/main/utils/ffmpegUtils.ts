import path from 'path'

export function getFfmpegPath(): string {
  if (process.env.NODE_ENV === 'development') {
    return path.join(__dirname, '..', 'ffmpeg-master-latest-win64-gpl-shared', 'bin')
  }

  // 生产环境 - Electron 应用
  if (process.resourcesPath) {
    return path.join(process.resourcesPath, 'ffmpeg-master-latest-win64-gpl-shared', 'bin')
  }

  // 生产环境 - Node.js 应用
  return path.join(__dirname, 'ffmpeg-master-latest-win64-gpl-shared', 'bin')
}
