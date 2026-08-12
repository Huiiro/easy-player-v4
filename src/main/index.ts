import {
  app,
  shell,
  BrowserWindow,
  dialog,
  globalShortcut,
  Menu,
  ipcMain,
  net,
  nativeImage,
  protocol,
  screen,
  Tray
} from 'electron'
import { existsSync, promises as fs } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AudioEngineManager } from './audioEngine'
import { registerIpcHandlers } from './ipc/audioIpcHandlers'
import { closeDatabase, initDatabase } from './database'
import { registerDatabaseIpcHandlers } from './ipc/databaseIpcHandlers'
import { getAppSetting, getSong, migrateSourceSecrets, setAppSetting } from './database/repository'
import { registerScanIpcHandlers } from './ipc/scanIpcHandlers'
import { registerLyricsIpcHandlers } from './ipc/lyricsIpcHandlers'
import { registerFontIpcHandlers } from './ipc/fontIpcHandlers'
import { registerMetadataIpcHandlers } from './ipc/metadataIpcHandlers'
import { registerFileIpcHandlers } from './ipc/fileIpcHandlers'
import { registerDownloadIpcHandlers } from './ipc/downloadIpcHandlers'
import { cacheRemoteSong, syncRemoteSource, testRemoteSource } from './service/remoteSourceService'
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateStatus,
  initializeUpdater,
  quitAndInstallUpdate
} from './service/updateService'
import { getDataPath } from './utils/pathUtils'
import { createDir } from './utils/pathUtils'
import sharp from 'sharp'

// Set this before Electron creates the macOS application menu. In development
// the executable is Electron.app, but the visible app/menu name is ours.
app.setName('Easy Player')
process.title = 'Easy Player'

/**
 * macOS cannot create a tray image from Windows `.ico` files, and Electron's
 * Tray API does not reliably decode SVG paths. Keep ICO for Windows and use
 * the PNG generated from the project SVG for macOS.
 */
const icon = app.isPackaged
  ? join(
      process.resourcesPath,
      'resources',
      process.platform === 'win32' ? 'easy-player.ico' : 'easy-player.png'
    )
  : join(
      __dirname,
      '../..',
      process.platform === 'win32' ? 'resources/easy-player.ico' : 'resources/easy-player.png'
    )
const trayIcon =
  process.platform === 'darwin'
    ? app.isPackaged
      ? join(process.resourcesPath, 'resources', 'easy-playerTemplate.png')
      : join(__dirname, '../..', 'resources/easy-playerTemplate.png')
    : icon
const dockIcon = app.isPackaged
  ? join(process.resourcesPath, 'icon.icns')
  : join(__dirname, '../..', 'resources/easy-player.icns')

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
let tray: Tray | null = null
let trayMenu: Menu | null = null
let trayTrack = { title: '', artist: '', isPlaying: false }
let isQuitting = false

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function quitApplication(): void {
  isQuitting = true
  audioEngine?.stop()
  globalShortcut.unregisterAll()
  tray?.destroy()
  tray = null
  closeDatabase()
  // Do not let a hidden close-to-tray window intercept this explicit user
  // request. `app.exit` is intentional here; cleanup was completed above.
  app.exit(0)
}

function sendTrayAction(action: 'previous' | 'toggle' | 'next'): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('tray:action', action)
}

// Keep one process and one main window active. A second launch simply restores the first.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())
}

function updateTrayMenu(): void {
  if (!tray) return
  const trackLabel = trayTrack.title || 'No track playing'
  const artistLabel = trayTrack.artist || 'Easy Player'
  const tooltip = trayTrack.title
    ? `${trayTrack.title}${trayTrack.artist ? ` — ${trayTrack.artist}` : ''}`
    : 'Easy Player'
  tray.setToolTip(tooltip)
  if (process.platform === 'darwin') {
    const compactTitle = trayTrack.title.length > 24 ? `${trayTrack.title.slice(0, 23)}…` : trayTrack.title
    // Keep a compact, persistent now-playing entry on the right side of the
    // macOS menu bar. Its assigned menu opens only when the entry is clicked.
    tray.setTitle(` ${compactTitle || 'Easy Player'}`)
  }
  trayMenu = Menu.buildFromTemplate([
      { label: trackLabel, enabled: false },
      { label: artistLabel, enabled: false },
      { type: 'separator' },
      { label: 'Previous', click: () => sendTrayAction('previous') },
      {
        label: trayTrack.isPlaying ? 'Pause' : 'Play',
        click: () => sendTrayAction('toggle')
      },
      { label: 'Next', click: () => sendTrayAction('next') },
      { type: 'separator' },
      {
        label: 'Show window',
        click: showMainWindow
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: quitApplication
      }
    ])
  // macOS menu-bar items use their assigned menu for both normal and
  // secondary clicks. This avoids Electron's fallback status-item menu.
  tray.setContextMenu(trayMenu)
}
function createTray(): void {
  if (tray) return
  if (!existsSync(trayIcon)) {
    console.warn(`[Tray] Icon not found; tray is disabled: ${trayIcon}`)
    return
  }
  tray = new Tray(trayIcon)
  // macOS uses the assigned custom menu for normal and secondary clicks.
  if (process.platform !== 'darwin') {
    tray.on('double-click', showMainWindow)
  }
  updateTrayMenu()
}
const shortcutActions = ['previous', 'toggle', 'next', 'volumeUp', 'volumeDown'] as const
type ShortcutAction = (typeof shortcutActions)[number]

function registerGlobalShortcuts(shortcuts: Partial<Record<ShortcutAction, string>>): string[] {
  globalShortcut.unregisterAll()
  const failed: string[] = []
  const registeredAccelerators = new Set<string>()
  for (const action of shortcutActions) {
    const accelerator = shortcuts[action]?.trim()
    if (!accelerator) continue
    const electronAccelerator = accelerator.replace(
      /(^|\+)meta(?=\+|$)/i,
      `$1${process.platform === 'darwin' ? 'Command' : 'Super'}`
    )
    const normalizedAccelerator = electronAccelerator.toLowerCase()
    if (registeredAccelerators.has(normalizedAccelerator)) {
      failed.push(accelerator)
      continue
    }
    const registered = globalShortcut.register(electronAccelerator, () => {
      mainWindow?.webContents.send('shortcuts:action', action)
    })
    if (!registered) failed.push(accelerator)
    else registeredAccelerators.add(normalizedAccelerator)
  }
  return failed
}

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

    const size = Math.min(512, Math.max(64, Number(url.searchParams.get('size')) || 0))
    if (url.hostname === 'cover' && size) {
      try {
        const thumbnail = await sharp(coverPath)
          .resize(size, size, { fit: 'cover', withoutEnlargement: true })
          .jpeg({ quality: 78, progressive: true })
          .toBuffer()
        return new Response(thumbnail, {
          headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*' }
        })
      } catch {
        // Fall back to the original image for uncommon formats or corrupt cache entries.
      }
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
    // Extend the renderer into the native title bar while retaining macOS
    // traffic-light controls. The renderer reserves this area in Header.
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 16, y: 14 }
        }
      : {}),
    backgroundColor: '#111614',
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
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
  mainWindow.on('close', (event) => {
    if (!isQuitting && getAppSetting('system.close-to-tray') === true) {
      event.preventDefault()
      mainWindow?.hide()
      updateTrayMenu()
      return
    }
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
    try {
      const url = new URL(details.url)
      if (url.protocol === 'https:' || url.protocol === 'http:') void shell.openExternal(url.href)
    } catch {
      // Ignore malformed external navigation requests.
    }
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())

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
      contextIsolation: true,
      nodeIntegration: false,
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
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  // `floating` sits below many exclusive/full-screen games. Keep lyrics above
  // that layer; the renderer makes the window click-through by default so it
  // does not steal focus or input from the game.
  desktopLyricsWindow.setAlwaysOnTop(true, 'screen-saver')
  desktopLyricsWindow.setIgnoreMouseEvents(true, { forward: true })
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
  // Keep Windows notifications and taskbar identity aligned with the packaged app.
  app.setAppUserModelId('com.huiiro.easyplayer')
  // The player is controlled from its right-side status item on macOS. Avoid
  // Electron's empty/default application menu occupying the rest of the bar.
  if (process.platform === 'darwin') Menu.setApplicationMenu(null)
  // `app.dock.setIcon` accepts a NativeImage reliably; passing an ICNS path
  // string makes Electron try its PNG path loader and can reject at startup.
  if (process.platform === 'darwin') {
    const dockImage = nativeImage.createFromPath(dockIcon)
    const fallbackDockImage = nativeImage.createFromPath(icon)
    if (!dockImage.isEmpty()) app.dock?.setIcon(dockImage)
    else if (!fallbackDockImage.isEmpty()) app.dock?.setIcon(fallbackDockImage)
  }
  createDir()
  initDatabase()
  migrateSourceSecrets()
  registerDatabaseIpcHandlers()
  registerScanIpcHandlers()
  registerLyricsIpcHandlers()
  registerFontIpcHandlers()
  registerMetadataIpcHandlers()
  registerFileIpcHandlers()
  registerDownloadIpcHandlers()
  createTray()
  ipcMain.handle('system:set-close-to-tray', (_event, enabled: boolean) => {
    setAppSetting('system.close-to-tray', enabled === true)
    return { success: true }
  })
  ipcMain.on('window:set-traffic-light-visible', (_event, visible: boolean) => {
    if (process.platform === 'darwin') mainWindow?.setWindowButtonVisibility(visible)
  })
  ipcMain.handle('system:set-auto-start', (_event, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled === true })
    setAppSetting('system.auto-start', enabled === true)
    return { success: true }
  })
  ipcMain.on(
    'tray:update',
    (_event, data: { title?: string; artist?: string; isPlaying?: boolean }) => {
      trayTrack = {
        title: data.title || '',
        artist: data.artist || '',
        isPlaying: data.isPlaying === true
      }
      updateTrayMenu()
    }
  )
  ipcMain.handle('shortcuts:register-global', (_event, shortcuts) => {
    try {
      const failed = registerGlobalShortcuts(
        shortcuts && typeof shortcuts === 'object'
          ? (shortcuts as Partial<Record<ShortcutAction, string>>)
          : {}
      )
      return { success: true, data: { failed } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('shortcuts:unregister-global', () => {
    globalShortcut.unregisterAll()
    return { success: true }
  })
  registerMediaProtocol()
  initializeUpdater()
  ipcMain.handle('app-update:status', () => ({ success: true, data: getUpdateStatus() }))
  ipcMain.handle('app-update:check', async () => {
    try {
      return { success: true, data: await checkForUpdates() }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('app-update:download', async () => {
    try {
      return { success: true, data: await downloadUpdate() }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('app-update:install', () => {
    try {
      quitAndInstallUpdate()
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

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
  ipcMain.handle('remote-source:test', async (_event, config: unknown) => {
    const value = config as { type?: unknown; baseUrl?: unknown; user?: unknown; secret?: unknown }
    if (
      (value?.type !== 'navidrome' && value?.type !== 'jellyfin') ||
      typeof value?.baseUrl !== 'string' ||
      typeof value.user !== 'string' ||
      typeof value.secret !== 'string'
    ) {
      return { success: false, error: 'Invalid remote source configuration' }
    }
    try {
      return {
        success: true,
        data: await testRemoteSource(
          value as { type: 'navidrome' | 'jellyfin'; baseUrl: string; user: string; secret: string }
        )
      }
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
  ipcMain.handle('remote-source:cache-size', async (_event, directory: unknown) => {
    if (typeof directory !== 'string' || !existsSync(directory)) return { success: true, data: 0 }
    const sizeOf = async (target: string): Promise<number> => {
      const entries = await fs.readdir(target, { withFileTypes: true })
      let total = 0
      for (const entry of entries) {
        const child = join(target, entry.name)
        if (entry.isDirectory()) total += await sizeOf(child)
        else if (entry.isFile()) total += (await fs.stat(child)).size
      }
      return total
    }
    try {
      return { success: true, data: await sizeOf(directory) }
    } catch {
      return { success: true, data: 0 }
    }
  })
  ipcMain.handle('remote-source:sync', async (_event, sourceId: unknown) => {
    if (!Number.isInteger(sourceId)) return { success: false, error: 'Invalid source id' }
    try {
      return { success: true, data: await syncRemoteSource(sourceId as number) }
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

  app.on('activate', () => {
    // A hidden close-to-tray window must be restored when the Dock icon is
    // activated; only create a replacement when no window exists at all.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
      if (audioEngine?.loaded && mainWindow) {
        registerIpcHandlers(audioEngine, mainWindow)
      }
    } else {
      showMainWindow()
    }
  })
})

// The close-to-tray option is handled by the window's `close` event above.
// If it is disabled, closing the final window must terminate the app on every
// platform; otherwise macOS would leave a background/tray process behind.
app.on('window-all-closed', () => {
  if (audioEngine) {
    audioEngine.stop()
  }
  app.quit()
})

app.on('will-quit', () => {
  isQuitting = true
  globalShortcut.unregisterAll()
  closeDatabase()
})
