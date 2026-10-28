import {
  pluginLogContext,
  redactPluginLog,
  type PluginLogContext,
  type PluginLogEntry
} from '../../shared/pluginLogs'
import { t } from '../i18n'
import { isPlaybackOnly } from './playbackMode'
import fs from 'node:fs'
import { BrowserWindow, ipcMain, shell } from 'electron'
import { getLogPath } from '../utils/pathUtils'
import { getAppSetting, setAppSetting } from '../database/repository'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogSource = 'main' | 'native' | 'renderer' | 'preload'
export interface LogEntry {
  id: number
  timestamp: number
  level: LogLevel
  source: LogSource
  message: string
  plugin?: PluginLogContext
}

const recent: LogEntry[] = []
const pluginRecent: PluginLogEntry[] = []
const MAX_RECENT = 1000
const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error']
const LEVEL_SETTING_KEY = 'logging.level'
let minimumLevel: LogLevel = 'info'
let nextId = 1

function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && LEVELS.includes(value as LogLevel)
}

function format(value: unknown): string {
  if (value instanceof Error) return value.stack || value.message
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

export class Logger {
  static write(level: LogLevel, source: LogSource, message: string, ...params: unknown[]): void {
    this.publish(level, source, [message, ...params.map(format)].join(' '))
  }

  static plugin(
    level: LogLevel,
    context: PluginLogContext,
    message: unknown,
    source: LogSource = 'main'
  ): void {
    const plugin = pluginLogContext(context)
    if (!plugin || !isLogLevel(level)) return
    this.publish(
      level,
      source,
      '[Plugin] ' + plugin.pluginId + ' ' + redactPluginLog(message),
      plugin
    )
  }

  static recentPlugins(): PluginLogEntry[] {
    return structuredClone(pluginRecent)
  }

  private static publish(
    level: LogLevel,
    source: LogSource,
    message: string,
    plugin?: PluginLogContext
  ): void {
    if (isPlaybackOnly() && level !== 'error') return
    if (LEVELS.indexOf(level) < LEVELS.indexOf(minimumLevel)) return
    const entry: LogEntry = {
      id: nextId++,
      timestamp: Date.now(),
      level,
      source,
      message: message.replace(/\r?\n/g, '\\n'),
      ...(plugin ? { plugin } : {})
    }
    if (plugin) {
      pluginRecent.push({ ...entry, plugin })
      if (pluginRecent.length > MAX_RECENT) pluginRecent.shift()
    }
    recent.push(entry)
    if (recent.length > MAX_RECENT) recent.shift()

    const line = `[${new Date(entry.timestamp).toISOString()}] [${level.toUpperCase()}] [${source}] ${entry.message}${entry.plugin ? ' ' + JSON.stringify(entry.plugin) : ''}`
    try {
      const directory = getLogPath()
      fs.mkdirSync(directory, { recursive: true })
      const day = new Date(entry.timestamp).toISOString().slice(0, 10)
      fs.appendFileSync(getLogPath(`log-${day}.log`), `${line}\n`, 'utf8')
    } catch (error) {
      console.error('Could not write application log:', error)
    }

    const output = level === 'warn' ? console.warn : level === 'error' ? console.error : console.log
    output(line)
    for (const window of BrowserWindow.getAllWindows()) {
      try {
        if (!window.isDestroyed() && !window.webContents.isDestroyed())
          window.webContents.send('log:entry', entry)
      } catch {
        /* A closing window must not interrupt the logged operation. */
      }
    }
  }

  static debug(message: string, ...params: unknown[]): void {
    this.write('debug', 'main', message, ...params)
  }
  static info(message: string, ...params: unknown[]): void {
    this.write('info', 'main', message, ...params)
  }
  static warn(message: string, ...params: unknown[]): void {
    this.write('warn', 'main', message, ...params)
  }
  static error(message: string, ...params: unknown[]): void {
    this.write('error', 'main', message, ...params)
  }
  static log(message: string, ...params: unknown[]): void {
    this.info(message, ...params)
  }

  static registerIpc(): void {
    const savedLevel = getAppSetting(LEVEL_SETTING_KEY)
    minimumLevel = isLogLevel(savedLevel) ? savedLevel : 'info'
    ipcMain.handle('log:get-level', () => minimumLevel)
    ipcMain.handle('log:set-level', (_event, level: unknown) => {
      if (!isLogLevel(level)) return { success: false, error: t('invalidLogLevel') }
      try {
        setAppSetting(LEVEL_SETTING_KEY, level)
        minimumLevel = level
        return { success: true, level }
      } catch (error) {
        this.error('Could not save log level:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    })
    ipcMain.on('log:write', (_event, data: unknown) => {
      if (!data || typeof data !== 'object') return
      const entry = data as { level?: unknown; message?: unknown }
      if (!isLogLevel(entry.level)) return
      if (typeof entry.message !== 'string') return
      this.write(entry.level as LogLevel, 'renderer', entry.message.slice(0, 8192))
    })
    ipcMain.handle('log:recent', () => recent)
    ipcMain.handle('log:open-directory', async () => {
      try {
        const directory = getLogPath()
        fs.mkdirSync(directory, { recursive: true })
        const error = await shell.openPath(directory)
        return error ? { success: false, error } : { success: true }
      } catch {
        return { success: false, error: 'LOG_DIRECTORY_OPEN_FAILED' }
      }
    })
    ipcMain.on('log:preload', (_event, message: unknown) => {
      if (typeof message === 'string') this.write('error', 'preload', message.slice(0, 8192))
    })
  }
}
