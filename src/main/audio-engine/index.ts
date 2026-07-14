import { join } from 'path'
import { app } from 'electron'
import { TrackInfo, DeviceInfo } from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let nativeAddon: any = null

function loadNativeAddon(): boolean {
  if (nativeAddon) return true

  try {
    // In development: load from out/main/native/
    // In production: load from extraResources/native/
    const isDev = !app.isPackaged

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    if (isDev) {
      // Development: load from build/native-addon/
      const addonPath = join(__dirname, '..', '..', 'build', 'native-addon', 'easy_player_native.node')
      nativeAddon = require(addonPath)
    } else {
      const addonPath = join(
        process.resourcesPath,
        'native',
        'easy_player_native.node'
      )
      nativeAddon = require(addonPath)
    }

    console.log('[AudioEngineManager] Native addon loaded successfully')
    return true
  } catch (err) {
    console.error('[AudioEngineManager] Failed to load native addon:', err)
    return false
  }
}

export class AudioEngineManager {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private engine: any = null
  private isLoaded = false

  constructor() {
    this.isLoaded = loadNativeAddon()
    if (this.isLoaded) {
      this.engine = new nativeAddon.AudioEngine()
    }
  }

  get loaded(): boolean {
    return this.isLoaded && this.engine !== null
  }

  // ── Lifecycle ──

  open(filePath: string): boolean {
    if (!this.engine) return false
    return this.engine.open(filePath)
  }

  play(): boolean {
    if (!this.engine) return false
    return this.engine.play()
  }

  pause(): boolean {
    if (!this.engine) return false
    return this.engine.pause()
  }

  stop(): boolean {
    if (!this.engine) return false
    return this.engine.stop()
  }

  seek(positionMs: number): boolean {
    if (!this.engine) return false
    return this.engine.seek(positionMs)
  }

  // ── Control ──

  setVolume(volume: number): void {
    this.engine?.setVolume(volume)
  }

  // ── Device / Backend ──

  enumerateDevices(): DeviceInfo[] {
    if (!this.engine) return []
    return this.engine.enumerateDevices()
  }

  setDevice(deviceId: string): void {
    this.engine?.setDevice(deviceId)
  }

  // ── Query ──

  getStatus() {
    if (!this.engine) return null
    return this.engine.getStatus()
  }

  getGlitchCount(): number {
    if (!this.engine) return 0
    return this.engine.getGlitchCount()
  }

  // ── Callbacks ──

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onStateChanged(callback: (state: number) => void): void {
    this.engine?.onStateChanged(callback)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onPositionChanged(callback: (posMs: number, durMs: number) => void): void {
    this.engine?.onPositionChanged(callback)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onError(callback: (code: number, msg: string) => void): void {
    this.engine?.onError(callback)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onLog(callback: (level: number, msg: string) => void): void {
    this.engine?.onLog(callback)
  }
}
