import { app, shell, BrowserWindow, dialog, ipcMain, net, protocol, screen } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { readdirSync, statSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import icon from '../../resources/icon.png?asset'
import { AudioEngineManager } from './audioEngine'
import { registerIpcHandlers } from './ipc/audioIpcHandlers'
import { closeDatabase, initDatabase } from './database'
import { registerDatabaseIpcHandlers } from './ipc/databaseIpcHandlers'
import { getAppSetting, getSong, setAppSetting } from './database/repository'
import { registerScanIpcHandlers } from './ipc/scanIpcHandlers'
import { registerLyricsIpcHandlers } from './ipc/lyricsIpcHandlers'
import { registerFontIpcHandlers } from './ipc/fontIpcHandlers'
import { registerMetadataIpcHandlers } from './ipc/metadataIpcHandlers'
import { cacheRemoteSong, syncNavidromeSource } from './service/remoteSourceService'
import { getDataPath } from './utils/pathUtils'
import { createDir } from './utils/pathUtils'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'easy-player-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
])

let mainWindow: BrowserWindow | null = null
let miniWindow: BrowserWindow | null = null
let desktopLyricsWindow: BrowserWindow | null = null
let audioEngine: AudioEngineManager | null = null

interface WindowState {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

const defaultWindowState: WindowState = { x: 80, y: 80, width: 1280, height: 780, maximized: false }

function loadWindowState(): WindowState {
  const saved = getAppSetting('window.main')
  if (!saved || typeof saved !== 'object') return defaultWindowState
  const state = saved as Partial<WindowState>
  const width =
    typeof state.width === 'number' ? Math.max(760, state.width) : defaultWindowState.width
  const height =
    typeof state.height === 'number' ? Math.max(520, state.height) : defaultWindowState.height
  const x = typeof state.x === 'number' ? state.x : defaultWindowState.x
  const y = typeof state.y === 'number' ? state.y : defaultWindowState.y
  const visible = screen.getAllDisplays().some((display) => {
    const bounds = display.workArea
    return (
      x + width > bounds.x &&
      x < bounds.x + bounds.width &&
      y + height > bounds.y &&
      y < bounds.y + bounds.height
    )
  })
  return {
    x: visible ? x : defaultWindowState.x,
    y: visible ? y : defaultWindowState.y,
    width,
    height,
    maximized: state.maximized === true
  }
}

function saveWindowState(window: BrowserWindow): void {
  const bounds = window.isMaximized() ? window.getNormalBounds() : window.getBounds()
  setAppSetting('window.main', { ...bounds, maximized: window.isMaximized() })
}

function registerMediaProtocol(): void {
  protocol.handle('easy-player-media', async (request) => {
    const url = new URL(request.url)
    const requestedPath = ['cover', 'font'].includes(url.hostname)
      ? url.searchParams.get('path')
      : null
    if (!requestedPath) return new Response('Not Found', { status: 404 })

    const coverDirectory = resolve(getDataPath(), url.hostname === 'font' ? 'ttf' : 'covers')
    const coverPath = resolve(requestedPath)
    const pathRelativeToCovers = relative(coverDirectory, coverPath)
    if (
      pathRelativeToCovers.startsWith('..') ||
      isAbsolute(pathRelativeToCovers) ||
      !existsSync(coverPath)
    ) {
      return new Response('Not Found', { status: 404 })
    }

    const response = await net.fetch(pathToFileURL(coverPath).toString())
    const headers = new Headers(response.headers)
    // The renderer samples cover pixels with Canvas for player-panel colors.
    // `easy-player-media` is a separate origin from the Vite renderer, so the
    // response must opt in to anonymous CORS reads.
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    })
  })
}

function createWindow(): void {
  const restoredState = loadWindowState()
  // Create the browser window.
  mainWindow = new BrowserWindow({
    x: restoredState.x,
    y: restoredState.y,
    width: restoredState.width,
    height: restoredState.height,
    minWidth: 1280,
    minHeight: 780,
    show: false,
    frame: false,
    backgroundColor: '#111614',
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (restoredState.maximized) mainWindow?.maximize()
    mainWindow?.show()
  })

  let saveWindowStateTimer: ReturnType<typeof setTimeout> | undefined
  const scheduleWindowStateSave = (): void => {
    if (saveWindowStateTimer) clearTimeout(saveWindowStateTimer)
    saveWindowStateTimer = setTimeout(() => {
      saveWindowStateTimer = undefined
      if (mainWindow && !mainWindow.isDestroyed()) saveWindowState(mainWindow)
    }, 300)
  }
  mainWindow.on('resize', scheduleWindowStateSave)
  mainWindow.on('move', scheduleWindowStateSave)
  mainWindow.on('close', () => {
    if (saveWindowStateTimer) clearTimeout(saveWindowStateTimer)
    saveWindowState(mainWindow!)
    // The desktop lyric window is independent, so it would otherwise keep
    // the app alive (and leave audio playing) after its owner is closed.
    if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
      desktopLyricsWindow.close()
    }
    audioEngine?.stop()
  })

  const sendWindowState = (): void => {
    mainWindow?.webContents.send('window:state', { maximized: mainWindow.isMaximized() })
  }
  mainWindow.on('maximize', sendWindowState)
  mainWindow.on('unmaximize', sendWindowState)

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.key !== 'F12') return

    event.preventDefault()
    if (mainWindow?.webContents.isDevToolsOpened()) {
      mainWindow.webContents.closeDevTools()
    } else {
      mainWindow?.webContents.openDevTools({ mode: 'detach' })
    }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createMiniPlayerWindow(): BrowserWindow {
  if (miniWindow && !miniWindow.isDestroyed()) return miniWindow
  miniWindow = new BrowserWindow({
    width: 360,
    height: 84,
    minWidth: 360,
    minHeight: 84,
    maxWidth: 360,
    maxHeight: 84,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#111614',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  miniWindow.setAlwaysOnTop(true, 'floating')
  miniWindow.on('ready-to-show', () => miniWindow?.show())
  miniWindow.on('closed', () => {
    miniWindow = null
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void miniWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/#/mini`)
  } else {
    void miniWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/mini' })
  }
  return miniWindow
}

function createDesktopLyricsWindow(): BrowserWindow {
  if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) return desktopLyricsWindow
  const display = screen.getPrimaryDisplay().workArea
  desktopLyricsWindow = new BrowserWindow({
    width: 760,
    height: 170,
    x: Math.round(display.x + (display.width - 760) / 2),
    y: Math.max(display.y, display.y + display.height - 220),
    minWidth: 420,
    minHeight: 110,
    maxHeight: 360,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    hasShadow: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  desktopLyricsWindow.setAlwaysOnTop(true, 'floating')
  desktopLyricsWindow.on('ready-to-show', () => desktopLyricsWindow?.showInactive())
  desktopLyricsWindow.on('closed', () => {
    desktopLyricsWindow = null
    mainWindow?.webContents.send('desktop-lyrics:closed')
  })
  desktopLyricsWindow.on('resize', () => {
    const bounds = desktopLyricsWindow?.getBounds()
    if (bounds) desktopLyricsWindow?.webContents.send('desktop-lyrics:bounds', bounds)
  })
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void desktopLyricsWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/#/lyric`)
  } else {
    void desktopLyricsWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/lyric' })
  }
  return desktopLyricsWindow
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  app.setAppUserModelId('com.electron')
  createDir()
  initDatabase()
  registerDatabaseIpcHandlers()
  registerScanIpcHandlers()
  registerLyricsIpcHandlers()
  registerFontIpcHandlers()
  registerMetadataIpcHandlers()
  registerMediaProtocol()

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))
  const isPersistedRendererSettingKey = (key: unknown): key is string =>
    typeof key === 'string' && (key.startsWith('player.') || key.startsWith('ui.'))
  ipcMain.on('database:save-setting-sync', (event, request: { key?: unknown; value?: unknown }) => {
    if (!isPersistedRendererSettingKey(request?.key)) {
      event.returnValue = { success: false, error: 'Invalid setting key' }
      return
    }
    try {
      setAppSetting(request.key, request.value)
      event.returnValue = { success: true }
    } catch (error) {
      event.returnValue = {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })
  ipcMain.on('database:get-setting-sync', (event, key: unknown) => {
    if (!isPersistedRendererSettingKey(key)) {
      event.returnValue = { success: false, error: 'Invalid setting key' }
      return
    }
    try {
      event.returnValue = { success: true, data: getAppSetting(key) }
    } catch (error) {
      event.returnValue = {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })
  ipcMain.handle('window:command', (event, command: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return { maximized: false }

    if (command === 'minimize') window.minimize()
    if (command === 'toggle-maximize') {
      if (window.isMaximized()) window.unmaximize()
      else window.maximize()
    }
    if (command === 'close') window.close()

    return { maximized: window.isMaximized() }
  })
  ipcMain.handle('library:show-song-in-folder', async (_event, songId: unknown) => {
    if (!Number.isInteger(songId)) return { success: false, error: 'Invalid song id' }
    const audioPath = getSong(songId as number)?.audio
    if (!audioPath || !existsSync(audioPath)) {
      return { success: false, error: 'Song file no longer exists locally' }
    }
    shell.showItemInFolder(audioPath)
    return { success: true }
  })
  ipcMain.handle('remote-source:test-navidrome', async (_event, config: unknown) => {
    const value = config as { baseUrl?: unknown; user?: unknown; secret?: unknown }
    if (
      typeof value?.baseUrl !== 'string' ||
      typeof value.user !== 'string' ||
      typeof value.secret !== 'string'
    ) {
      return { success: false, error: 'Invalid Navidrome configuration' }
    }
    try {
      const salt = randomBytes(8).toString('hex')
      const token = createHash('md5').update(`${value.secret}${salt}`).digest('hex')
      const baseUrl = value.baseUrl.replace(/\/$/, '')
      const query = new URLSearchParams({
        u: value.user,
        t: token,
        s: salt,
        v: '1.16.1',
        c: 'EasyPlayer',
        f: 'json'
      })
      const response = await fetch(`${baseUrl}/rest/ping.view?${query}`)
      const payload = (await response.json()) as {
        'subsonic-response'?: { status?: string; version?: string; error?: { message?: string } }
      }
      const result = payload['subsonic-response']
      if (!response.ok || result?.status !== 'ok')
        return { success: false, error: result?.error?.message || 'Connection failed' }
      return { success: true, data: { version: result.version || '' } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('remote-source:choose-cache-directory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? { success: false } : { success: true, data: result.filePaths[0] }
  })
  ipcMain.handle('remote-source:default-cache-directory', () => ({
    success: true,
    data: join(getDataPath(), 'cache')
  }))
  ipcMain.handle('remote-source:cache-size', (_event, directory: unknown) => {
    if (typeof directory !== 'string' || !existsSync(directory)) return { success: true, data: 0 }
    const sizeOf = (target: string): number =>
      readdirSync(target, { withFileTypes: true }).reduce((total, entry) => {
        const child = join(target, entry.name)
        return (
          total + (entry.isDirectory() ? sizeOf(child) : entry.isFile() ? statSync(child).size : 0)
        )
      }, 0)
    try {
      return { success: true, data: sizeOf(directory) }
    } catch {
      return { success: true, data: 0 }
    }
  })
  ipcMain.handle('remote-source:sync', async (_event, sourceId: unknown) => {
    if (!Number.isInteger(sourceId)) return { success: false, error: 'Invalid source id' }
    try {
      return { success: true, data: await syncNavidromeSource(sourceId as number) }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('remote-source:cache-song', async (_event, songId: unknown) => {
    if (!Number.isInteger(songId)) return { success: false, error: 'Invalid song id' }
    try {
      return { success: true, data: await cacheRemoteSong(songId as number) }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('mini-player:enter', () => {
    const mini = createMiniPlayerWindow()
    mainWindow?.hide()
    mini.show()
    mini.focus()
    if (!mini.webContents.isLoading()) mainWindow?.webContents.send('mini-player:request-state')
    return { success: true }
  })
  ipcMain.handle('mini-player:restore', () => {
    miniWindow?.hide()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
    }
    return { success: true }
  })
  ipcMain.on('mini-player:ready', () => mainWindow?.webContents.send('mini-player:request-state'))
  ipcMain.on('mini-player:update', (_event, data: unknown) => {
    miniWindow?.webContents.send('mini-player:update', data)
  })
  ipcMain.on('mini-player:action', (_event, action: 'previous' | 'toggle' | 'next') => {
    mainWindow?.webContents.send('mini-player:action', action)
  })
  ipcMain.handle('desktop-lyrics:open', () => {
    const window = createDesktopLyricsWindow()
    window.showInactive()
    return { success: true }
  })
  ipcMain.handle('desktop-lyrics:close', () => {
    desktopLyricsWindow?.close()
    return { success: true }
  })
  ipcMain.on('desktop-lyrics:ready', () =>
    mainWindow?.webContents.send('desktop-lyrics:request-state')
  )
  ipcMain.on('desktop-lyrics:update', (_event, data: unknown) =>
    desktopLyricsWindow?.webContents.send('desktop-lyrics:update', data)
  )
  ipcMain.on('desktop-lyrics:action', (_event, action: 'previous' | 'toggle' | 'next') =>
    mainWindow?.webContents.send('desktop-lyrics:action', action)
  )
  ipcMain.on('desktop-lyrics:set-locked', (_event, locked: unknown) => {
    if (!desktopLyricsWindow) return
    desktopLyricsWindow.setIgnoreMouseEvents(locked === true, { forward: true })
  })
  ipcMain.on('desktop-lyrics:resize-for-font', (_event, fontSize: unknown) => {
    if (!desktopLyricsWindow || typeof fontSize !== 'number') return
    const bounds = desktopLyricsWindow.getBounds()
    const width = Math.max(420, Math.min(1120, Math.round(760 + (fontSize - 34) * 11)))
    const height = Math.max(110, Math.min(360, Math.round(fontSize * 3.75 + 34)))
    desktopLyricsWindow.setBounds({
      x: Math.round(bounds.x - (width - bounds.width) / 2),
      y: bounds.y,
      width,
      height
    })
  })

  createWindow()

  // Initialize audio engine after window is created
  audioEngine = new AudioEngineManager()
  if (mainWindow && audioEngine.loaded) {
    registerIpcHandlers(audioEngine, mainWindow)
    console.log('[Main] Audio engine initialized and IPC handlers registered')
  } else if (mainWindow) {
    console.warn('[Main] Audio engine failed to load — running without audio')
  }

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
      if (audioEngine?.loaded && mainWindow) {
        registerIpcHandlers(audioEngine, mainWindow)
      }
    }
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (audioEngine) {
    audioEngine.stop()
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  closeDatabase()
})
