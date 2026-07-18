import { app, shell, BrowserWindow, ipcMain, net, protocol } from 'electron'
import { existsSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import icon from '../../resources/icon.png?asset'
import { AudioEngineManager } from './audio-engine/index'
import { registerIpcHandlers } from './audio-engine/ipc-handlers'
import { closeDatabase, initDatabase } from './database'
import { registerDatabaseIpcHandlers } from './database/ipc-handlers'
import { registerScanIpcHandlers } from './service/scan-ipc-handlers'
import { getDataPath } from './utils/pathUtils'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'easy-player-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
])
import { createDir } from './utils/pathUtils'

let mainWindow: BrowserWindow | null = null
let audioEngine: AudioEngineManager | null = null

function registerMediaProtocol(): void {
  protocol.handle('easy-player-media', async (request) => {
    const url = new URL(request.url)
    const requestedPath = url.hostname === 'cover' ? url.searchParams.get('path') : null
    if (!requestedPath) return new Response('Not Found', { status: 404 })

    const coverDirectory = resolve(getDataPath(), 'covers')
    const coverPath = resolve(requestedPath)
    const pathRelativeToCovers = relative(coverDirectory, coverPath)
    if (
      pathRelativeToCovers.startsWith('..') ||
      isAbsolute(pathRelativeToCovers) ||
      !existsSync(coverPath)
    ) {
      return new Response('Not Found', { status: 404 })
    }

    return net.fetch(pathToFileURL(coverPath).toString())
  })
}

function createWindow(): void {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    minWidth: 760,
    minHeight: 520,
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
    mainWindow?.show()
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
  registerMediaProtocol()

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))
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

app.on('before-quit', () => {
  closeDatabase()
})
