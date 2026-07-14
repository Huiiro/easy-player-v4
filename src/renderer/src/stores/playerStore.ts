import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { PlaybackState, TrackInfo, DeviceInfo } from '../types/audio'
import { audioBridge } from '../services/audioBridge'
import { useLogStore } from './logStore'

export const usePlayerStore = defineStore('player', () => {
  // ── State ──
  const state = ref<PlaybackState>('idle')
  const positionMs = ref(0)
  const durationMs = ref(0)
  const volume = ref(1.0)
  const glitchCount = ref(0)
  const trackInfo = ref<TrackInfo | null>(null)
  const currentFile = ref<string | null>(null)
  const currentBackend = ref<string>('directsound')
  const devices = ref<DeviceInfo[]>([])
  const currentDeviceId = ref('default')

  // ── Computed ──
  const isPlaying = computed(() => state.value === 'playing')
  const isPaused = computed(() => state.value === 'paused')
  const progress = computed(() =>
    durationMs.value > 0 ? positionMs.value / durationMs.value : 0
  )
  const positionFormatted = computed(() => formatTime(positionMs.value))
  const durationFormatted = computed(() => formatTime(durationMs.value))

  // ── Actions ──
  async function openFile(filePath: string) {
    currentFile.value = filePath
    const ok = await audioBridge.open(filePath)
    if (ok) {
      const status = await audioBridge.getStatus()
      if (status) {
        trackInfo.value = status.trackInfo
        durationMs.value = status.durationMs
      }
    }
    return ok
  }

  async function play() {
    const ok = await audioBridge.play()
    return ok
  }

  async function pause() {
    return audioBridge.pause()
  }

  async function stop() {
    return audioBridge.stop()
  }

  async function seek(ms: number) {
    const targetMs = Math.max(0, durationMs.value > 0 ? Math.min(ms, durationMs.value) : ms)
    positionMs.value = targetMs
    return audioBridge.seek(targetMs)
  }

  async function setVolume(vol: number) {
    volume.value = Math.max(0, Math.min(1, vol))
    await audioBridge.setVolume(volume.value)
  }

  async function setBackend(backend: string) {
    if (currentBackend.value === backend) return
    currentBackend.value = backend
    const ok = await audioBridge.setBackend(backend)
    if (ok) {
      // Refresh device list after backend change
      await refreshDevices()
    }
  }

  async function setDevice(deviceId: string) {
    if (currentDeviceId.value === deviceId) return
    currentDeviceId.value = deviceId
    await audioBridge.setDevice(deviceId)
  }

  async function refreshDevices() {
    devices.value = await audioBridge.enumerateDevices()
  }

  // ── Event subscriptions ──
  let unsubs: (() => void)[] = []

  function subscribeToEvents() {
    unsubs.push(
      audioBridge.onStateChanged((data) => {
        state.value = data.state as PlaybackState
        if (data.trackInfo) {
          trackInfo.value = data.trackInfo as TrackInfo
        }
      })
    )

    unsubs.push(
      audioBridge.onPositionChanged((data) => {
        positionMs.value = data.positionMs
        durationMs.value = data.durationMs
      })
    )

    // Forward engine errors to the log store
    unsubs.push(
      audioBridge.onError((data) => {
        const logStore = useLogStore()
        logStore.addEntry({
          level: 'error',
          message: `[${data.code}] ${data.message}`,
          timestamp: Date.now()
        })
      })
    )
  }

  function unsubscribe() {
    unsubs.forEach((fn) => fn())
    unsubs = []
  }

  return {
    // State
    state,
    positionMs,
    durationMs,
    volume,
    glitchCount,
    trackInfo,
    currentFile,
    currentBackend,
    devices,
    currentDeviceId,
    // Computed
    isPlaying,
    isPaused,
    progress,
    positionFormatted,
    durationFormatted,
    // Actions
    openFile,
    play,
    pause,
    stop,
    seek,
    setVolume,
    setBackend,
    setDevice,
    refreshDevices,
    // Events
    subscribeToEvents,
    unsubscribe
  }
})

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${min}:${sec.toString().padStart(2, '0')}`
}
