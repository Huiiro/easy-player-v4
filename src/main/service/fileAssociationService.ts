import { ipcMain, shell, type BrowserWindow } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getDatabase } from '../database'
import { getSong } from '../database/repository'
import { scanMusicDirectory, SUPPORTED_EXTENSIONS } from './scanService'
import { Logger } from './loggerService'

const runFile = promisify(execFile)
const pendingFiles: string[][] = []
let rendererReady = false
let processing = false
let getWindow: () => BrowserWindow | null = () => null

export function resetAudioFileDelivery(isInPlace = false, isMainFrame = true): void {
  // Hash/router navigation keeps the player and its IPC listeners alive.
  if (isInPlace || !isMainFrame) return
  rendererReady = false
}

export function queueSecondInstanceAudioFiles(
  argv: string[],
  workingDirectory: string,
  additionalData: unknown
): void {
  const launch = additionalData as { args?: unknown; workingDirectory?: unknown } | null
  if (
    launch &&
    Array.isArray(launch.args) &&
    launch.args.every((arg) => typeof arg === 'string') &&
    typeof launch.workingDirectory === 'string'
  ) {
    queueAudioFiles(launch.args, launch.workingDirectory)
    return
  }
  // Electron may reorder argv; inspect all entries instead of dropping a fixed prefix.
  queueAudioFiles(argv, workingDirectory)
}

export function queueAudioFiles(args: string[], workingDirectory = process.cwd()): void {
  const files = [
    ...new Set(
      args.filter((arg) => !arg.startsWith('-')).map((arg) => resolve(workingDirectory, arg))
    )
  ].filter((file) => {
    try {
      return (
        SUPPORTED_EXTENSIONS.includes(extname(file).toLowerCase()) &&
        existsSync(file) &&
        statSync(file).isFile()
      )
    } catch {
      return false
    }
  })
  if (!files.length) return
  pendingFiles.push(files)
  void deliverFiles()
}

async function deliverFiles(): Promise<void> {
  if (!rendererReady || processing) return
  processing = true
  try {
    while (pendingFiles.length && rendererReady) {
      const files = pendingFiles.shift()!
      const songs = [] as NonNullable<ReturnType<typeof getSong>>[]
      for (const file of files) {
        try {
          let row = getDatabase().prepare('SELECT id FROM song WHERE audio = ?').get(file) as
            { id: number } | undefined
          if (!row) {
            await scanMusicDirectory(dirname(file), undefined, [file])
            row = getDatabase().prepare('SELECT id FROM song WHERE audio = ?').get(file) as
              { id: number } | undefined
          }
          const song = row ? getSong(row.id) : null
          if (song) songs.push(song)
          else throw new Error(`Unable to import audio file: ${file}`)
        } catch (error) {
          Logger.warn('[File association] cannot open file', { file, error: String(error) })
          getWindow()?.webContents.send('system:open-files-error')
        }
      }
      const window = getWindow()
      if (!rendererReady || !window || window.isDestroyed()) {
        rendererReady = false
        pendingFiles.unshift(files)
        break
      }
      if (songs.length) window.webContents.send('system:open-audio-files', songs)
    }
  } finally {
    processing = false
  }
}

export function registerFileAssociationHandlers(window: () => BrowserWindow | null): void {
  getWindow = window
  ipcMain.handle('system:has-pending-audio-files', () => pendingFiles.length > 0)
  ipcMain.on('system:audio-files-ready', (event, ready: boolean) => {
    if (event.sender !== getWindow()?.webContents) return
    rendererReady = ready === true
    if (rendererReady) void deliverFiles()
  })
  ipcMain.handle('system:open-default-apps', async () => {
    if (process.platform !== 'win32') return { success: false, error: 'Windows only' }
    try {
      // The installer registers in the hive matching its per-user/per-machine scope.
      let query = ''
      for (const [hive, parameter] of [
        ['HKCU', 'registeredAppUser'],
        ['HKLM', 'registeredAppMachine']
      ]) {
        try {
          await runFile(
            'reg.exe',
            ['query', `${hive}\\Software\\RegisteredApplications`, '/v', 'Easy Player', '/reg:64'],
            { windowsHide: true }
          )
          query = `?${parameter}=${encodeURIComponent('Easy Player')}`
          break
        } catch {
          /* Try the next installation scope; older installs use the general page. */
        }
      }
      await shell.openExternal(`ms-settings:defaultapps${query}`)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })
}
