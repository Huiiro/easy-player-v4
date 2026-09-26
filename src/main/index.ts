import { setMainLocale, t } from './i18n'
import { logError, logOperation, logParams, logUrl } from './service/operationLogger'
import { performance } from 'node:perf_hooks'
import {
  app,
  shell,
  BrowserWindow,
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
import { release as osRelease } from 'node:os'
import { randomUUID } from 'node:crypto'
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
import { cacheRemoteSong } from './service/remoteSourceService'
import { registerRemoteSourceIpcHandlers } from './ipc/remoteSourceIpcHandlers'
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateStatus,
  initializeUpdater,
  quitAndInstallUpdate
} from './service/updateService'
import { getDataPath } from './utils/pathUtils'
import { createDir } from './utils/pathUtils'
import { Logger } from './service/loggerService'
import sharp from 'sharp'
import {
  queueAudioFiles,
  queueSecondInstanceAudioFiles,
  registerFileAssociationHandlers,
  resetAudioFileDelivery
} from './service/fileAssociationService'

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
let desktopLyricsBoundsTimer: ReturnType<typeof setTimeout> | undefined
let audioEngine: AudioEngineManager | null = null
let tray: Tray | null = null
let trayMenu: Menu | null = null
let trayTrack = { title: '', artist: '', isPlaying: false }
let isQuitting = false
let trafficLightPositionTimer: ReturnType<typeof setTimeout> | undefined

const TRAFFIC_LIGHT_POSITION = { x: 16, y: 14 }

function supportsWindowsMica(): boolean {
  if (process.platform !== 'win32') return false
  const build = Number(osRelease().split('.')[2])
  // Electron exposes system backdrop materials from Windows 11 22H2 onward.
  return Number.isFinite(build) && build >= 22621
}

function setWindowsMica(enabled: boolean): boolean {
  if (!mainWindow || mainWindow.isDestroyed() || !supportsWindowsMica()) return false
  mainWindow.setBackgroundColor('#111614')
  mainWindow.setBackgroundMaterial(enabled ? 'mica' : 'none')
  return enabled
}

function setPlayerWindowControlsVisible(visible: boolean): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (process.platform !== 'darwin') return

  if (trafficLightPositionTimer) {
    clearTimeout(trafficLightPositionTimer)
    trafficLightPositionTimer = undefined
  }

  mainWindow.setWindowButtonVisibility(visible)
  if (!visible) return

  // AppKit can recalculate the traffic-light origin while the player panel is
  // still finishing its leave transition. Reapply the intended position now
  // and once more after that transition settles.
  mainWindow.setWindowButtonPosition(TRAFFIC_LIGHT_POSITION)
  trafficLightPositionTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.setWindowButtonPosition(TRAFFIC_LIGHT_POSITION)
    trafficLightPositionTimer = undefined
  }, 300)
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function quitApplication(): void {
  Logger.info('[Main] quit requested', { audioLoaded: audioEngine?.loaded === true })
  isQuitting = true
  audioEngine?.stop()
  audioEngine?.flushDspSettings()
  saveDesktopLyricsWindowState()
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

// Forward file launches to the existing player, including while it is still starting.
const audioLaunchRequest = {
  args: process.argv.slice(app.isPackaged ? 1 : 2),
  workingDirectory: process.cwd()
}
if (!app.requestSingleInstanceLock(audioLaunchRequest)) {
  app.quit()
} else {
  queueAudioFiles(audioLaunchRequest.args, audioLaunchRequest.workingDirectory)
  app.on('second-instance', (_event, argv, workingDirectory, additionalData) => {
    queueSecondInstanceAudioFiles(argv, workingDirectory, additionalData)
    showMainWindow()
  })
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
    // Keep the macOS menu-bar item compact; track details remain available in
    // the tooltip and context menu.
    tray.setTitle('')
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
    Logger.warn(`[Tray] Icon not found; tray is disabled: ${trayIcon}`)
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
  if (failed.length)
    Logger.warn('[Shortcuts] failed to register shortcuts', { accelerators: failed })
  Logger.debug('[Shortcuts] registration completed', {
    registeredCount: registeredAccelerators.size,
    failedCount: failed.length
  })
  return failed
}

interface WindowState {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

interface DesktopLyricsWindowState {
  x: number
  y: number
  width: number
  height: number
}

const DESKTOP_LYRICS_MIN_FONT_SIZE = 24
const DESKTOP_LYRICS_MIN_HEIGHT = Math.ceil(DESKTOP_LYRICS_MIN_FONT_SIZE * 2.6 + 74.4)

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

function defaultDesktopLyricsWindowState(): DesktopLyricsWindowState {
  const bounds = screen.getPrimaryDisplay().workArea
  const width = 760
  const height = 170
  return {
    x: Math.round(bounds.x + (bounds.width - width) / 2),
    y: Math.max(bounds.y, bounds.y + bounds.height - 220),
    width,
    height
  }
}

function loadDesktopLyricsWindowState(): DesktopLyricsWindowState {
  const fallback = defaultDesktopLyricsWindowState()
  const saved = getAppSetting('window.desktop-lyrics')
  if (!saved || typeof saved !== 'object') return fallback

  const state = saved as Partial<DesktopLyricsWindowState>
  if (
    !Number.isFinite(state.x) ||
    !Number.isFinite(state.y) ||
    !Number.isFinite(state.width) ||
    !Number.isFinite(state.height)
  )
    return fallback

  const restored = {
    x: Math.round(state.x as number),
    y: Math.round(state.y as number),
    width: Math.max(420, Math.round(state.width as number)),
    height: Math.max(DESKTOP_LYRICS_MIN_HEIGHT, Math.min(360, Math.round(state.height as number)))
  }
  const visible = screen.getAllDisplays().some((display) => {
    const bounds = display.workArea
    return (
      restored.x + restored.width > bounds.x &&
      restored.x < bounds.x + bounds.width &&
      restored.y + restored.height > bounds.y &&
      restored.y < bounds.y + bounds.height
    )
  })
  return visible ? restored : fallback
}

function saveDesktopLyricsWindowState(): void {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return
  setAppSetting('window.desktop-lyrics', desktopLyricsWindow.getBounds())
}

function scheduleDesktopLyricsWindowStateSave(): void {
  if (desktopLyricsBoundsTimer) clearTimeout(desktopLyricsBoundsTimer)
  desktopLyricsBoundsTimer = setTimeout(() => {
    saveDesktopLyricsWindowState()
    desktopLyricsBoundsTimer = undefined
  }, 200)
}

function registerMediaProtocol(): void {
  protocol.handle('easy-player-media', async (request) => {
    const url = new URL(request.url)
    const requestedPath = ['cover', 'cover-thumb', 'font'].includes(url.hostname)
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

    const size = Math.min(1024, Math.max(64, Number(url.searchParams.get('size')) || 0))
    if (url.hostname === 'cover-thumb' && size) {
      try {
        const thumbnail = await sharp(coverPath)
          .resize(size, size, { fit: 'cover', withoutEnlargement: true })
          .jpeg({ quality: 78, progressive: true })
          .toBuffer()
        return new Response(thumbnail, {
          headers: {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Access-Control-Allow-Origin': '*'
          }
        })
      } catch (error) {
        Logger.debug(
          '[Media] thumbnail generation failed; serving original cover',
          { coverPath, size },
          logError(error)
        )
        // Fall back to the original image for uncommon formats or corrupt cache entries.
      }
    }
    const response = await net.fetch(pathToFileURL(coverPath).toString())
    const headers = new Headers(response.headers)
    // The renderer samples cover pixels with Canvas for player-panel colors.
    // `easy-player-media` is a separate origin from the Vite renderer, so the
    // response must opt in to anonymous CORS reads.
    headers.set('Access-Control-Allow-Origin', '*')
    if (url.searchParams.get('full') === '1') headers.set('Cache-Control', 'no-store')
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    })
  })
}

function observeWindow(window: BrowserWindow, kind: string): void {
  const windowId = window.id
  Logger.debug('[Window] created', { kind, windowId, bounds: window.getBounds() })
  window.webContents.on('did-finish-load', () =>
    Logger.debug('[Window] renderer loaded', { kind, windowId })
  )
  window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (code === -3) return // A cancelled navigation is expected during replacement loads.
    Logger.error('[Window] renderer load failed', {
      kind,
      windowId,
      code,
      description,
      url: logUrl(url),
      isMainFrame
    })
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    Logger.error('[Window] renderer process gone', {
      kind,
      windowId,
      reason: details.reason,
      exitCode: details.exitCode
    })
  })
  window.on('unresponsive', () => Logger.warn('[Window] renderer unresponsive', { kind, windowId }))
  window.on('closed', () => Logger.debug('[Window] closed', { kind, windowId }))
}

function createWindow(): void {
  const restoredState = loadWindowState()
  const supportsMica = supportsWindowsMica()
  const micaEnabled = supportsMica && getAppSetting('window.mica-enabled') === true
  // Create the browser window.
  mainWindow = new BrowserWindow({
    x: restoredState.x,
    y: restoredState.y,
    width: restoredState.width,
    height: restoredState.height,
    minWidth: 1280,
    minHeight: 780,
    show: false,
    // Use renderer-owned caption buttons. Window Controls Overlay retains
    // native hit targets even when hidden, which conflicts with player UI.
    frame: false,
    // Extend the renderer into the native title bar while retaining macOS
    // traffic-light controls. The renderer reserves this area in Header.
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: TRAFFIC_LIGHT_POSITION
        }
      : {}),
    backgroundColor: '#111614',
    ...(micaEnabled ? { backgroundMaterial: 'mica' as const } : {}),
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  observeWindow(mainWindow, 'main')
  mainWindow.webContents.on('did-start-navigation', (details) => {
    resetAudioFileDelivery(details.isSameDocument, details.isMainFrame)
  })
  setWindowsMica(getAppSetting('window.mica-enabled') === true)

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
  observeWindow(miniWindow, 'mini-player')
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
  const savedBounds = loadDesktopLyricsWindowState()
  desktopLyricsWindow = new BrowserWindow({
    ...savedBounds,
    minWidth: 420,
    minHeight: DESKTOP_LYRICS_MIN_HEIGHT,
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
  observeWindow(desktopLyricsWindow, 'desktop-lyrics')
  desktopLyricsWindow.setAlwaysOnTop(true, 'screen-saver')
  desktopLyricsWindow.setIgnoreMouseEvents(true, { forward: true })
  desktopLyricsWindow.on('ready-to-show', () => desktopLyricsWindow?.showInactive())
  desktopLyricsWindow.on('move', scheduleDesktopLyricsWindowStateSave)
  desktopLyricsWindow.on('close', () => {
    if (desktopLyricsBoundsTimer) {
      clearTimeout(desktopLyricsBoundsTimer)
      desktopLyricsBoundsTimer = undefined
    }
    saveDesktopLyricsWindowState()
  })
  desktopLyricsWindow.on('closed', () => {
    desktopLyricsWindow = null
    mainWindow?.webContents.send('desktop-lyrics:closed')
  })
  desktopLyricsWindow.on('resize', () => {
    const bounds = desktopLyricsWindow?.getBounds()
    if (bounds) desktopLyricsWindow?.webContents.send('desktop-lyrics:bounds', bounds)
    scheduleDesktopLyricsWindowStateSave()
  })
  // `resize` fires continuously while the user is dragging. Syncing the font
  // setting on every frame makes the settings update resize the native window
  // in the opposite direction. `resized` fires once after the gesture ends.
  desktopLyricsWindow.on('resized', () => {
    const bounds = desktopLyricsWindow?.getBounds()
    if (bounds)
      desktopLyricsWindow?.webContents.send('desktop-lyrics:bounds', {
        ...bounds,
        syncFontSize: true
      })
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
app.whenReady().then(() =>
  logOperation(
    '[Main] initialize',
    { platform: process.platform, packaged: app.isPackaged },
    () => {
      const startupStarted = performance.now()
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
      setMainLocale(getAppSetting('system.locale'))
      ipcMain.on('system:set-locale', (_event, locale: unknown) => {
        if (locale !== 'zh' && locale !== 'en') return
        setAppSetting('system.locale', locale)
        setMainLocale(locale)
      })
      Logger.registerIpc()
      Logger.info('[Main] starting application', {
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        packaged: app.isPackaged
      })
      migrateSourceSecrets()
      registerDatabaseIpcHandlers()
      registerScanIpcHandlers()
      registerLyricsIpcHandlers()
      registerFontIpcHandlers()
      registerMetadataIpcHandlers()
      registerFileIpcHandlers()
      registerFileAssociationHandlers(() => mainWindow)
      registerDownloadIpcHandlers()
      createTray()
      ipcMain.handle('system:set-close-to-tray', (_event, enabled: boolean) => {
        return logOperation('[IPC] system:set-close-to-tray', { enabled }, () => {
          setAppSetting('system.close-to-tray', enabled === true)
          return { success: true }
        })
      })
      ipcMain.on('window:set-traffic-light-visible', (_event, visible: boolean) =>
        setPlayerWindowControlsVisible(visible)
      )
      ipcMain.handle('system:set-auto-start', (_event, enabled: boolean) => {
        return logOperation('[IPC] system:set-auto-start', { enabled }, () => {
          app.setLoginItemSettings({ openAtLogin: enabled === true })
          setAppSetting('system.auto-start', enabled === true)
          return { success: true }
        })
      })
      ipcMain.handle('system:get-mica-state', () => {
        const available = supportsWindowsMica()
        return {
          success: true,
          data: { available, enabled: available && getAppSetting('window.mica-enabled') === true }
        }
      })
      ipcMain.handle('system:set-mica-enabled', (_event, enabled: boolean) => {
        return logOperation('[IPC] system:set-mica-enabled', { enabled }, () => {
          const active = setWindowsMica(enabled === true)
          if (supportsWindowsMica()) setAppSetting('window.mica-enabled', active)
          return { success: true, data: { available: supportsWindowsMica(), enabled: active } }
        })
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
        return logOperation(
          '[IPC] shortcuts:register-global',
          { actions: shortcuts && typeof shortcuts === 'object' ? Object.keys(shortcuts) : [] },
          () => {
            try {
              const failed = registerGlobalShortcuts(
                shortcuts && typeof shortcuts === 'object'
                  ? (shortcuts as Partial<Record<ShortcutAction, string>>)
                  : {}
              )
              return { success: true, data: { failed } }
            } catch (error) {
              return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
              }
            }
          }
        )
      })
      ipcMain.handle('shortcuts:unregister-global', () => {
        return logOperation('[IPC] shortcuts:unregister-global', {}, () => {
          globalShortcut.unregisterAll()
          return { success: true }
        })
      })
      registerMediaProtocol()
      initializeUpdater()
      ipcMain.handle('app-update:status', () => ({ success: true, data: getUpdateStatus() }))
      ipcMain.handle('app-update:check', async () => {
        return logOperation('[IPC] app-update:check', {}, async () => {
          try {
            return { success: true, data: await checkForUpdates() }
          } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) }
          }
        })
      })
      ipcMain.handle('app-update:download', async () => {
        return logOperation('[IPC] app-update:download', {}, async () => {
          try {
            return { success: true, data: await downloadUpdate() }
          } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) }
          }
        })
      })
      ipcMain.handle('app-update:install', () => {
        return logOperation('[IPC] app-update:install', {}, () => {
          try {
            quitAndInstallUpdate()
            return { success: true }
          } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) }
          }
        })
      })

      // IPC test
      ipcMain.on('ping', () => Logger.debug('pong'))
      const isPersistedRendererSettingKey = (key: unknown): key is string =>
        typeof key === 'string' && (key.startsWith('player.') || key.startsWith('ui.'))
      ipcMain.on(
        'database:save-setting-sync',
        (event, request: { key?: unknown; value?: unknown }) => {
          if (!isPersistedRendererSettingKey(request?.key)) {
            event.returnValue = { success: false, error: t('invalidSettingKey') }
            return
          }
          try {
            setAppSetting(request.key, request.value)
            event.returnValue = { success: true }
          } catch (error) {
            Logger.error(
              '[Settings] synchronous save failed',
              { key: request.key },
              logError(error)
            )
            event.returnValue = {
              success: false,
              error: error instanceof Error ? error.message : String(error)
            }
          }
        }
      )
      ipcMain.on('database:get-setting-sync', (event, key: unknown) => {
        if (!isPersistedRendererSettingKey(key)) {
          event.returnValue = { success: false, error: t('invalidSettingKey') }
          return
        }
        try {
          event.returnValue = { success: true, data: getAppSetting(key) }
        } catch (error) {
          Logger.error('[Settings] synchronous read failed', { key }, logError(error))
          event.returnValue = {
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }
        }
      })
      ipcMain.handle('window:command', (event, command: string) => {
        return logOperation('[IPC] window:command', { command, windowId: event.sender.id }, () => {
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
      })
      ipcMain.handle('library:show-song-in-folder', async (_event, songId: unknown) => {
        return logOperation('[IPC] library:show-song-in-folder', { songId }, async () => {
          if (!Number.isInteger(songId)) return { success: false, error: t('invalidSongId') }
          const audioPath = getSong(songId as number)?.audio
          if (!audioPath || !existsSync(audioPath)) {
            return { success: false, error: t('songFileRemoved') }
          }
          shell.showItemInFolder(audioPath)
          return { success: true }
        })
      })
      ipcMain.handle('lyrics:open-in-editor', async (_event, request: unknown) => {
        return logOperation('[IPC] lyrics:open-in-editor', logParams(request), async () => {
          const value = request as { songId?: unknown; lyrics?: unknown; lyricFormat?: unknown }
          if (!Number.isInteger(value?.songId)) return { success: false, error: t('invalidSongId') }
          if (typeof value.lyrics !== 'string' || value.lyrics.length > 1_000_000)
            return { success: false, error: t('invalidLyrics') }
          const song = getSong(value.songId as number)
          if (!song) return { success: false, error: t('songNotFound') }

          let audioPath = song.audio
          if (!existsSync(audioPath) && song.sourceId) {
            try {
              audioPath = await cacheRemoteSong(song.id)
            } catch (error) {
              return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
              }
            }
          }
          if (!existsSync(audioPath)) return { success: false, error: t('songFileUnavailable') }

          const payloadPath = join(app.getPath('temp'), `lyric-timeline-${randomUUID()}.json`)
          const payload = {
            version: 1,
            audioPath,
            title: song.title,
            artist: song.artist || '',
            album: song.album || '',
            lyrics: value.lyrics,
            ...(typeof value.lyricFormat === 'string' ? { lyricFormat: value.lyricFormat } : {})
          }
          try {
            await fs.writeFile(payloadPath, JSON.stringify(payload), {
              encoding: 'utf8',
              flag: 'wx'
            })
            await shell.openExternal(
              `lyric-timeline://open?payload=${encodeURIComponent(payloadPath)}`
            )
            setTimeout(() => void fs.unlink(payloadPath).catch(() => undefined), 60_000)
            return { success: true }
          } catch (error) {
            await fs.unlink(payloadPath).catch(() => undefined)
            Logger.error(
              '[Lyrics IPC] open editor failed',
              { songId: song.id, audioPath, payloadPath },
              logError(error)
            )
            return { success: false, error: error instanceof Error ? error.message : String(error) }
          }
        })
      })
      registerRemoteSourceIpcHandlers()
      ipcMain.handle('mini-player:enter', () => {
        return logOperation('[IPC] mini-player:enter', {}, () => {
          const mini = createMiniPlayerWindow()
          mainWindow?.hide()
          mini.show()
          mini.focus()
          if (!mini.webContents.isLoading())
            mainWindow?.webContents.send('mini-player:request-state')
          return { success: true }
        })
      })
      ipcMain.handle('mini-player:restore', () => {
        return logOperation('[IPC] mini-player:restore', {}, () => {
          miniWindow?.hide()
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show()
            mainWindow.focus()
          }
          return { success: true }
        })
      })
      ipcMain.on('mini-player:ready', () =>
        mainWindow?.webContents.send('mini-player:request-state')
      )
      ipcMain.on('mini-player:update', (_event, data: unknown) => {
        miniWindow?.webContents.send('mini-player:update', data)
      })
      ipcMain.on('mini-player:action', (_event, action: 'previous' | 'toggle' | 'next') => {
        mainWindow?.webContents.send('mini-player:action', action)
      })
      ipcMain.handle('desktop-lyrics:open', () => {
        return logOperation('[IPC] desktop-lyrics:open', {}, () => {
          const window = createDesktopLyricsWindow()
          window.showInactive()
          return { success: true }
        })
      })
      ipcMain.handle('desktop-lyrics:close', () => {
        return logOperation('[IPC] desktop-lyrics:close', {}, () => {
          desktopLyricsWindow?.close()
          return { success: true }
        })
      })
      ipcMain.on('desktop-lyrics:ready', () =>
        mainWindow?.webContents.send('desktop-lyrics:request-state')
      )
      ipcMain.on('desktop-lyrics:update', (_event, data: unknown) =>
        desktopLyricsWindow?.webContents.send('desktop-lyrics:update', data)
      )
      ipcMain.on('desktop-lyrics:sync-font-size', (_event, fontSize: unknown) => {
        if (typeof fontSize !== 'number' || !Number.isFinite(fontSize)) return
        mainWindow?.webContents.send(
          'desktop-lyrics:font-size-changed',
          Math.max(24, Math.min(64, Math.round(fontSize)))
        )
      })
      ipcMain.on('desktop-lyrics:action', (_event, action: 'previous' | 'toggle' | 'next') =>
        mainWindow?.webContents.send('desktop-lyrics:action', action)
      )
      ipcMain.on('desktop-lyrics:set-locked', (_event, locked: unknown) => {
        if (!desktopLyricsWindow) return
        desktopLyricsWindow.setIgnoreMouseEvents(locked === true, { forward: true })
      })
      ipcMain.on(
        'desktop-lyrics:resize-for-font',
        (_event, fontSize: unknown, preserveSavedBounds: unknown) => {
          if (!desktopLyricsWindow || typeof fontSize !== 'number') return
          if (preserveSavedBounds === true && getAppSetting('window.desktop-lyrics')) {
            desktopLyricsWindow.webContents.send('desktop-lyrics:bounds', {
              ...desktopLyricsWindow.getBounds(),
              syncFontSize: true
            })
            return
          }
          const bounds = desktopLyricsWindow.getBounds()
          const width = Math.max(420, Math.min(1120, Math.round(760 + (fontSize - 34) * 11)))
          const height = Math.max(
            DESKTOP_LYRICS_MIN_HEIGHT,
            Math.min(360, Math.ceil(Math.max(fontSize * 3.75 + 34, fontSize * 2.6 + 74.4)))
          )
          desktopLyricsWindow.setBounds({
            x: Math.round(bounds.x - (width - bounds.width) / 2),
            y: bounds.y,
            width,
            height
          })
        }
      )

      createWindow()

      // Initialize audio engine after window is created
      audioEngine = new AudioEngineManager()
      if (mainWindow && audioEngine.loaded) {
        registerIpcHandlers(audioEngine, mainWindow)
        Logger.debug('[Main] audio IPC handlers registered')
      } else if (mainWindow) {
        Logger.warn('[Main] Audio engine failed to load — running without audio')
      }

      Logger.info('[Main] application ready', {
        audioLoaded: audioEngine.loaded,
        elapsedMs: Math.round(performance.now() - startupStarted)
      })
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
    }
  )
)

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
  Logger.debug('[Main] will quit; flushing settings and closing database')
  isQuitting = true
  globalShortcut.unregisterAll()
  audioEngine?.flushDspSettings()
  closeDatabase()
})
