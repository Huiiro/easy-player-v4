import path from 'path'
import os from 'os'

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
  // TODO
  return true
}
