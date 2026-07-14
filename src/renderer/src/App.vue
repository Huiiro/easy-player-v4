<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { usePlayerStore } from './stores/playerStore'
import { useLogStore } from './stores/logStore'

const player = usePlayerStore()
const logs = useLogStore()
const isSeeking = ref(false)
const seekPreviewMs = ref<number | null>(null)

const displayPositionMs = computed(() => seekPreviewMs.value ?? player.positionMs)
const displayProgress = computed(() =>
  player.durationMs > 0 ? displayPositionMs.value / player.durationMs : 0
)

// ── Startup ──
onMounted(async () => {
  player.subscribeToEvents()
  logs.subscribe()
  await player.refreshDevices()

  console.log('[App] Audio player UI mounted')
})

onUnmounted(() => {
  player.unsubscribe()
  logs.unsubscribeEvents()
})

// ── Event handlers ──
async function handleFileDrop(event: DragEvent) {
  event.preventDefault()
  const files = event.dataTransfer?.files
  if (files && files.length > 0) {
    const filePath = window.api.audio.getFilePath(files[0])
    console.log('[App] Opening file:', filePath)
    await player.openFile(filePath)
    await player.play()
  }
}

function handleDragOver(event: DragEvent) {
  event.preventDefault()
}

function getSeekPositionMs(event: PointerEvent): number {
  const bar = event.currentTarget as HTMLElement
  const rect = bar.getBoundingClientRect()
  const pct = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
  return pct * player.durationMs
}

function handleProgressPointerDown(event: PointerEvent) {
  if (player.durationMs <= 0) return
  isSeeking.value = true
  seekPreviewMs.value = getSeekPositionMs(event)
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function handleProgressPointerMove(event: PointerEvent) {
  if (!isSeeking.value) return
  seekPreviewMs.value = getSeekPositionMs(event)
}

async function handleProgressPointerUp(event: PointerEvent) {
  if (!isSeeking.value) return
  const targetMs = getSeekPositionMs(event)
  seekPreviewMs.value = targetMs
  isSeeking.value = false
  ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
  await player.seek(targetMs)
  seekPreviewMs.value = null
}

// ── Format ──
function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${min}:${sec.toString().padStart(2, '0')}`
}

async function copyLog(entry: { timestamp: number; level: string; message: string }) {
  const time = new Date(entry.timestamp).toLocaleTimeString()
  const text = `[${time}] [${entry.level.toUpperCase()}] ${entry.message}`
  try {
    await navigator.clipboard.writeText(text)
    console.log('[App] Copied to clipboard')
  } catch {
    // fallback for older browsers
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
}
</script>

<template>
  <div
    class="app-container"
    @drop="handleFileDrop"
    @dragover="handleDragOver"
  >
    <!-- Title Bar -->
    <header class="title-bar">
      <h1>Easy Player</h1>
      <span class="version">Phase 1 — WASAPI + DSound</span>
    </header>

    <!-- Drop Zone -->
    <div class="drop-zone">
      <p v-if="!player.currentFile">
        Drop an audio file here (WAV, FLAC, MP3...)
      </p>
      <p v-else>
        {{ player.trackInfo?.metadata?.title || player.currentFile }}
      </p>
    </div>

    <!-- Backend / Device Selector -->
    <div class="selector-row">
      <div class="selector-group">
        <label>Backend:</label>
        <select
          :value="player.currentBackend"
          @change="async (e) => {
            await player.setBackend((e.target as HTMLSelectElement).value)
          }"
        >
          <option value="wasapi_shared">WASAPI Shared</option>
          <option value="wasapi_exclusive">WASAPI Exclusive</option>
          <option value="directsound">DirectSound</option>
        </select>
      </div>
      <div class="selector-group">
        <label>Device:</label>
        <select
          :value="player.currentDeviceId"
          @change="async (e) => {
            await player.setDevice((e.target as HTMLSelectElement).value)
          }"
        >
          <option
            v-for="dev in player.devices"
            :key="dev.id"
            :value="dev.id"
          >
            {{ dev.name }} {{ dev.isDefault ? '(default)' : '' }}
          </option>
        </select>
      </div>
      <button class="btn-refresh" @click="player.refreshDevices()" title="Refresh devices">
        &#x21bb;
      </button>
    </div>

    <!-- Player Controls -->
    <div class="controls">
      <button
        v-if="!player.isPlaying"
        class="btn btn-play"
        @click="player.play()"
        :disabled="player.state === 'idle'"
      >
        &#9654; Play
      </button>
      <button v-else class="btn btn-pause" @click="player.pause()">
        &#9646;&#9646; Pause
      </button>
      <button class="btn btn-stop" @click="player.stop()" :disabled="player.state === 'idle'">
        &#9632; Stop
      </button>
    </div>

    <!-- Progress -->
    <div class="progress-section">
      <span class="time">{{ formatTime(displayPositionMs) }}</span>
      <div
        class="progress-bar"
        @pointerdown="handleProgressPointerDown"
        @pointermove="handleProgressPointerMove"
        @pointerup="handleProgressPointerUp"
        @pointercancel="isSeeking = false; seekPreviewMs = null"
      >
        <div class="progress-fill" :style="{ width: (displayProgress * 100) + '%' }"></div>
      </div>
      <span class="time">{{ formatTime(player.durationMs) }}</span>
    </div>

    <!-- Volume -->
    <div class="volume-section">
      <label>Volume:</label>
      <input
        type="range"
        min="0"
        max="100"
        :value="Math.round(player.volume * 100)"
        @input="player.setVolume(Number(($event.target as HTMLInputElement).value) / 100)"
      />
    </div>

    <!-- Status -->
    <div class="status-bar">
      <span>State: <strong>{{ player.state }}</strong></span>
      <span v-if="player.trackInfo">
        | {{ player.trackInfo.format }}
        {{ player.trackInfo.sampleRate }}Hz
        {{ player.trackInfo.bitDepth }}bit
        {{ player.trackInfo.channels }}ch
      </span>
      <span v-if="player.glitchCount > 0" class="glitch-warn">
        | Glitches: {{ player.glitchCount }}
      </span>
    </div>

    <!-- Log Viewer -->
    <div class="log-viewer">
      <div class="log-header">
        <h3>Log</h3>
        <select v-model="logs.filter">
          <option value="all">All</option>
          <option value="debug">Debug</option>
          <option value="info">Info</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
        </select>
        <button @click="logs.clear()">Clear</button>
      </div>
      <div class="log-entries">
        <div
          v-for="(entry, i) in logs.filteredEntries"
          :key="i"
          :class="'log-entry log-' + entry.level"
        >
          <button class="log-copy-btn" title="Copy log" @click="copyLog(entry)">📋</button>
          <span class="log-time">{{ new Date(entry.timestamp).toLocaleTimeString() }}</span>
          <span class="log-level">[{{ entry.level.toUpperCase() }}]</span>
          <span class="log-msg">{{ entry.message }}</span>
        </div>
        <div v-if="logs.filteredEntries.length === 0" class="log-empty">
          No log entries yet.
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 16px;
  font-family: 'Segoe UI', system-ui, sans-serif;
  background: #1a1a2e;
  color: #e0e0e0;
  overflow: hidden;
}

.title-bar {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 12px;
}
.title-bar h1 { margin: 0; font-size: 1.2rem; color: #7ec8e3; }
.version { font-size: 0.75rem; color: #888; }

.drop-zone {
  border: 2px dashed #444;
  border-radius: 8px;
  padding: 24px;
  text-align: center;
  margin-bottom: 12px;
  color: #888;
  min-height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.selector-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
  font-size: 0.8rem;
}
.selector-group {
  display: flex;
  align-items: center;
  gap: 4px;
}
.selector-group label {
  color: #999;
  white-space: nowrap;
}
.selector-group select {
  background: #222;
  color: #ccc;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 3px 6px;
  font-size: 0.8rem;
  max-width: 200px;
}
.btn-refresh {
  background: #222;
  color: #ccc;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 3px 8px;
  cursor: pointer;
  font-size: 0.85rem;
}
.btn-refresh:hover { background: #333; }

.controls {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.btn {
  padding: 8px 20px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  color: #fff;
}
.btn:disabled { opacity: 0.3; cursor: default; }
.btn-play { background: #2d6a4f; }
.btn-pause { background: #b8860b; }
.btn-stop { background: #8b0000; }

.progress-section {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.time { font-size: 0.8rem; font-variant-numeric: tabular-nums; min-width: 48px; }
.progress-bar {
  flex: 1;
  height: 6px;
  background: #333;
  border-radius: 3px;
  cursor: pointer;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: #7ec8e3;
  border-radius: 3px;
  transition: width 0.1s linear;
}

.volume-section {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.volume-section input { width: 120px; }

.status-bar {
  font-size: 0.75rem;
  color: #888;
  margin-bottom: 12px;
  display: flex;
  gap: 8px;
}
.glitch-warn { color: #e74c3c; }

.log-viewer {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #111;
  border-radius: 4px;
  overflow: hidden;
}
.log-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: #222;
  border-bottom: 1px solid #333;
}
.log-header h3 { margin: 0; font-size: 0.85rem; flex: 1; }
.log-header select, .log-header button {
  background: #333;
  color: #ccc;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 2px 8px;
  font-size: 0.75rem;
}

.log-entries {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 0.7rem;
  line-height: 1.5;
}
.log-entry {
  padding: 1px 10px;
  display: flex;
  gap: 8px;
}
.log-entry:hover { background: #1a1a1a; }
.log-entry:hover .log-copy-btn { opacity: 1; }
.log-copy-btn {
  opacity: 0;
  background: none;
  border: 1px solid #444;
  border-radius: 3px;
  color: #aaa;
  cursor: pointer;
  font-size: 0.65rem;
  padding: 0 3px;
  line-height: 1;
  margin-right: 2px;
  transition: opacity 0.15s;
  flex-shrink: 0;
}
.log-copy-btn:active { background: #333; }
.log-debug { color: #888; }
.log-info  { color: #ccc; }
.log-warn  { color: #f0ad4e; }
.log-error { color: #e74c3c; }
.log-time { color: #555; white-space: nowrap; }
.log-level { white-space: nowrap; min-width: 56px; }
.log-msg { word-break: break-all; }
.log-empty { padding: 10px; color: #555; }
</style>
