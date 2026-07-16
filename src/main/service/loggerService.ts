import fs from 'fs'
import path from 'path'
import { getLogPath } from '../utils/pathUtils'

export class Logger {
  private static logDir = getLogPath()

  private static getLogFile(): string {
    if (!fs.existsSync(this.logDir)) fs.mkdirSync(this.logDir, { recursive: true })
    const date = new Date().toISOString().split('T')[0] // YYYY-MM-DD
    return path.join(this.logDir, `log-${date}.log`)
  }

  private static writeToFile(level: string, message: string, ...optionalParams: any[]): string {
    const timestamp = new Date().toISOString()
    const text = `[${timestamp}] [${level}] ${message} ${optionalParams.map((p) => JSON.stringify(p)).join(' ')}\n`
    fs.appendFileSync(this.getLogFile(), text, { encoding: 'utf8' })
    return text
  }

  static info(message: string, ...optionalParams: any[]): void {
    const text = this.writeToFile('INFO', message, ...optionalParams)
    console.log(text)
  }

  static warn(message: string, ...optionalParams: any[]): void {
    const text = this.writeToFile('WARN', message, ...optionalParams)
    console.warn(text)
  }

  static error(message: string, ...optionalParams: any[]): void {
    const text = this.writeToFile('ERROR', message, ...optionalParams)
    console.error(text)
  }

  static log(message: string, ...optionalParams: any[]): void {
    this.info(message, ...optionalParams)
  }
}
