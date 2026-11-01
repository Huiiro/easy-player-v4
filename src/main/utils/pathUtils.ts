import path from 'path'
import os from 'os'
import fs from 'fs'

function getAppDataDir(): string {
  if (process.platform === 'win32')
    return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  if (process.platform === 'darwin')
    return path.join(os.homedir(), 'Library', 'Application Support')
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
}

export function getBaseDir(): string {
  if (process.env.EASY_PLAYER_DATA_DIR) return path.resolve(process.env.EASY_PLAYER_DATA_DIR)
  return path.join(getAppDataDir(), 'easy_player')
}

export function getDataPath(...parts: string[]): string {
  return path.join(getBaseDir(), 'player_data', ...parts)
}

export function getPluginPath(...parts: string[]): string {
  return path.join(getBaseDir(), 'player_plugin', ...parts)
}

export function getLogPath(...parts: string[]): string {
  return path.join(getBaseDir(), 'player_log', ...parts)
}

// Application-owned directories and runtime assets are defined here. Keep this
// module independent of Electron so workers and Node-based tools can share it.
export function getDatabasePath(): string {
  return getDataPath('player.db')
}

export function getCachePath(...parts: string[]): string {
  return getDataPath('cache', ...parts)
}

export function getCoverPath(...parts: string[]): string {
  return getDataPath('covers', ...parts)
}

export function getFontPath(...parts: string[]): string {
  return getDataPath('ttf', ...parts)
}

export function getBackgroundPath(...parts: string[]): string {
  return getDataPath('backgrounds', ...parts)
}

export function getThemePath(...parts: string[]): string {
  return getDataPath('themes', ...parts)
}

export function getDataTempPath(...parts: string[]): string {
  return getDataPath('temp', ...parts)
}

export function getSystemTempPath(...parts: string[]): string {
  return path.join(os.tmpdir(), ...parts)
}

export function getExportTempPath(): string {
  return getSystemTempPath(`easy_player_export_${Date.now()}`)
}

export function getMetadataTempPrefix(): string {
  return getSystemTempPath('easy_player_metadata_')
}

export function getLyricTimelinePath(id: string): string {
  return getSystemTempPath(`lyric-timeline-${id}.json`)
}

export function getDownloadStagingPrefix(directory: string): string {
  return path.join(directory, '.easy_player_download_')
}

// Anchor runtime paths at the entry module, even if Rollup puts this module in a shared chunk.
let mainDirectory: string | undefined

export function setMainDirectory(directory: string): void {
  mainDirectory = path.resolve(directory)
}

export function getMainPath(...parts: string[]): string {
  return path.join(mainDirectory ?? __dirname, ...parts)
}

export function getProjectPath(...parts: string[]): string {
  return getMainPath('../..', ...parts)
}

export function getResourcePath(isPackaged: boolean, ...parts: string[]): string {
  return isPackaged
    ? path.join(process.resourcesPath, 'resources', ...parts)
    : getProjectPath('resources', ...parts)
}

export function getIconPath(isPackaged: boolean): string {
  return getResourcePath(
    isPackaged,
    'icons',
    process.platform === 'win32' ? 'easy-player.ico' : 'easy-player.png'
  )
}

export function getTrayIconPath(isPackaged: boolean): string {
  return process.platform === 'darwin'
    ? getResourcePath(isPackaged, 'icons', 'easy-playerTemplate.png')
    : getIconPath(isPackaged)
}

export function getTaskbarHelperPath(isPackaged: boolean): string {
  return isPackaged
    ? path.join(process.resourcesPath, 'native', 'easy_player_taskbar.exe')
    : getProjectPath('build', 'taskbar-controls', 'bin', 'Release', 'easy_player_taskbar.exe')
}

export function getDockIconPath(isPackaged: boolean): string {
  return isPackaged
    ? path.join(process.resourcesPath, 'icon.icns')
    : getResourcePath(false, 'icons', 'easy-player.icns')
}

export function getPreloadPath(): string {
  return getMainPath('../preload/index.js')
}

export function getRendererPath(extremeView = false): string {
  return getMainPath('../renderer', extremeView ? 'extreme.html' : 'index.html')
}

export function getSearchWorkerPath(): string {
  return getMainPath('searchWorker.js')
}

export function getNativeAddonPath(isPackaged: boolean): string {
  return isPackaged
    ? path.join(process.resourcesPath, 'native', 'easy_player_native.node')
    : getProjectPath('build', 'native-addon', 'easy_player_native.node')
}

export function getWindowPreviewAddonPath(isPackaged: boolean): string {
  return path.join(path.dirname(getNativeAddonPath(isPackaged)), 'easy_player_window.node')
}

export function getStemRuntimeRoot(): string {
  return getDataPath('components', 'auto-mix')
}

function getInstalledStemDirectory(): string {
  try {
    const installed = JSON.parse(
      fs.readFileSync(path.join(getStemRuntimeRoot(), 'installed.json'), 'utf8')
    )
    if (
      typeof installed.directory === 'string' &&
      /^v\d+\.\d+\.\d+-[a-f0-9]{12}$/.test(installed.directory)
    ) {
      return path.join(getStemRuntimeRoot(), 'versions', installed.directory)
    }
  } catch {
    /* The optional component has not been installed yet. */
  }
  return path.join(getStemRuntimeRoot(), 'versions', 'not-installed')
}

export function getStemPythonPath(): string {
  if (process.env.EASY_PLAYER_STEM_PYTHON) return process.env.EASY_PLAYER_STEM_PYTHON
  return path.join(
    getInstalledStemDirectory(),
    'python',
    process.platform === 'win32' ? 'python.exe' : 'bin/python3'
  )
}

export function getStemFfmpegPath(isPackaged: boolean): string {
  if (process.env.EASY_PLAYER_STEM_FFMPEG) return process.env.EASY_PLAYER_STEM_FFMPEG
  const executable = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const prepared = getProjectPath('build', 'native-addon', executable)
  if (!isPackaged && fs.existsSync(prepared)) return prepared
  return isPackaged
    ? path.join(process.resourcesPath, 'native', executable)
    : process.platform === 'win32'
      ? getProjectPath(
          'build',
          'native-deps',
          'installed',
          'x64-windows-audio',
          'tools',
          'ffmpeg',
          executable
        )
      : getProjectPath('resources', 'lib', 'ffmpeg', 'bin', executable)
}

export function getFingerprintToolPath(isPackaged: boolean): string {
  const executable = process.platform === 'win32' ? 'fpcalc.exe' : 'fpcalc'
  return isPackaged
    ? path.join(process.resourcesPath, 'lib', 'fpcalc', executable)
    : getProjectPath(
        'resources',
        'lib',
        'fpcalc',
        `${process.platform}-${process.arch}`,
        executable
      )
}

export function getStemModelPath(): string {
  if (process.env.EASY_PLAYER_STEM_MODEL_REPO) return process.env.EASY_PLAYER_STEM_MODEL_REPO
  return path.join(getInstalledStemDirectory(), 'models')
}

export function getStemWorkerPath(isPackaged: boolean): string {
  return getResourcePath(isPackaged, 'auto-mix', 'stem_worker.py')
}

export function getStemCachePath(): string {
  // Keep generated stems outside the general cache cleanup scope.
  return getDataPath('auto-mix-stems')
}

export function getYtdlpCommand(isPackaged: boolean, appPath: string): string {
  const executable = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
  const sourceDirectory =
    process.platform === 'win32'
      ? 'win'
      : process.platform === 'darwin'
        ? 'mac'
        : path.join('linux', process.arch)
  const bundled = isPackaged
    ? path.join(process.resourcesPath, 'lib', 'yt-dlp', executable)
    : path.join(appPath, 'resources', 'lib', 'yt-dlp', sourceDirectory, executable)
  return fs.existsSync(bundled) ? bundled : process.env.EASY_PLAYER_YTDLP_PATH || 'yt-dlp'
}

export function getKuromojiDictionaryPath(packageJsonPath: string): string {
  return path
    .join(path.dirname(packageJsonPath), 'dict')
    .replace(/app\.asar([\\/])/u, 'app.asar.unpacked$1')
}

export function createDir(): boolean {
  const dirs = [
    getBaseDir(),
    getDataPath(),
    getPluginPath(),
    getLogPath(),
    getCachePath(),
    getCoverPath(),
    getDataTempPath(),
    getFontPath()
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
