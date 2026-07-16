import path from 'path'
import os from 'os'
import fs from 'fs'

export function getBaseDir(): string {
  const baseDir =
    process.platform === 'win32'
      ? process.env.APPDATA || ''
      : path.join(os.homedir(), 'Library', 'Application Support')
  return path.join(baseDir, 'easy-player')
}

export function getDataPath(): string {
  return path.join(getBaseDir(), 'player_data')
}

export function getPluginPath(): string {
  return path.join(getBaseDir(), 'player_plugin')
}

export function getLogPath(): string {
  return path.join(getBaseDir(), 'player_log')
}

export function createDir(): boolean {
  const dirs = [
    getBaseDir(),
    getDataPath(),
    getPluginPath(),
    getLogPath(),
    path.join(getDataPath(), 'cache'),
    path.join(getDataPath(), 'covers'),
    path.join(getDataPath(), 'temp')
  ]

  try {
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, {
          recursive: true
        })
      }
    }

    return true
  } catch (error) {
    console.error('[Directory] create failed:', error)
    return false
  }
}
