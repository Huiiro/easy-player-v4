import { ElectronAPI } from '@electron-toolkit/preload'
import type { DeviceInfo, PlaybackStatus } from '../renderer/src/types/audio'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      audio: {
        getFilePath(file: File): string
        open(filePath: string): Promise<{ success: boolean; data?: unknown; error?: string }>
        play(startPosition?: number): Promise<{ success: boolean }>
        pause(): Promise<{ success: boolean }>
        stop(): Promise<{ success: boolean }>
        seek(positionMs: number): Promise<{ success: boolean }>
        setVolume(volume: number): Promise<{ success: boolean }>
        enumerateDevices(): Promise<{ success: boolean; data?: DeviceInfo[]; error?: string }>
        setDevice(deviceId: string): Promise<{ success: boolean }>
        setBackend(backend: string): Promise<{ success: boolean }>
        getStatus(): Promise<{ success: boolean; data?: PlaybackStatus; error?: string }>

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onEvent(type: string, callback: (data: any) => void): () => void
        onStateChanged(callback: (data: { state: string; trackInfo: unknown }) => void): () => void
        onPositionChanged(callback: (data: { positionMs: number; durationMs: number }) => void): () => void
        onTrackEnded(callback: (data: { reason: string }) => void): () => void
        onError(callback: (data: { code: number; message: string; recoverable: boolean }) => void): () => void
        onLogEntry(callback: (data: { level: string; message: string; timestamp: number }) => void): () => void
      }
    }
  }
}
