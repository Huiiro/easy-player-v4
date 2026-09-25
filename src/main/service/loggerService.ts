import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import { getLogPath } from '../utils/pathUtils'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogSource = 'main' | 'native' | 'renderer' | 'preload'
export interface LogEntry {
  id: number
  timestamp: number
  level: LogLevel
  source: LogSource
  message: string
}

const recent: LogEntry[] = []
const MAX_RECENT = 1000
let nextId = 1

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
    const entry: LogEntry = {
      id: nextId++,
      timestamp: Date.now(),
      level,
      source,
      message: [message, ...params.map(format)].join(' ').replace(/\r?\n/g, '\\n')
    }
    recent.push(entry)
    if (recent.length > MAX_RECENT) recent.shift()

    const line = `[${new Date(entry.timestamp).toISOString()}] [${level.toUpperCase()}] [${source}] ${entry.message}`
    try {
      const directory = getLogPath()
      fs.mkdirSync(directory, { recursive: true })
      const day = new Date(entry.timestamp).toISOString().slice(0, 10)
      fs.appendFileSync(path.join(directory, `log-${day}.log`), `${line}\n`, 'utf8')
    } catch (error) {
      console.error('Could not write application log:', error)
    }

    const output = level === 'warn' ? console.warn : level === 'error' ? console.error : console.log
    output(line)
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('log:entry', entry)
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
    ipcMain.on('log:write', (_event, data: unknown) => {
      if (!data || typeof data !== 'object') return
      const entry = data as { level?: unknown; message?: unknown }
      if (!['debug', 'info', 'warn', 'error'].includes(String(entry.level))) return
      if (typeof entry.message !== 'string') return
      this.write(entry.level as LogLevel, 'renderer', entry.message.slice(0, 8192))
    })
    ipcMain.handle('log:recent', () => recent)
    ipcMain.on('log:preload', (_event, message: unknown) => {
      if (typeof message === 'string') this.write('error', 'preload', message.slice(0, 8192))
    })
  }
}
