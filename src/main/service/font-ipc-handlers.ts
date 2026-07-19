import { ipcMain, shell } from 'electron'
import { mkdirSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { getDataPath } from '../utils/pathUtils'

const extensions = new Set(['.ttf', '.otf', '.woff', '.woff2'])
const directory = (): string => join(getDataPath(), 'ttf')
const isFont = (path: string): boolean => extensions.has(extname(path).toLowerCase())
const displayName = (file: string): string =>
  file.replace(/\.[^.]+$/, '').replace(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}-/i, '')

function listFonts(): Array<{ family: string; file: string; url: string }> {
  const target = directory()
  mkdirSync(target, { recursive: true })
  return readdirSync(target)
    .filter(isFont)
    .sort((a, b) => a.localeCompare(b))
    .map((file) => ({
      family: `EasyPlayerFont-${displayName(file)}`,
      file,
      url: `easy-player-media://font?path=${encodeURIComponent(join(target, file))}`
    }))
}

export function registerFontIpcHandlers(): void {
  ipcMain.handle('fonts:list', () => ({ success: true, data: listFonts() }))
  ipcMain.handle('fonts:open-directory', async () => {
    const target = directory()
    mkdirSync(target, { recursive: true })
    const error = await shell.openPath(target)
    return error ? { success: false, error } : { success: true }
  })
}
