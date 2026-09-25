<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { usePlayerStore } from '@/stores/player/playerStore'
import { useLogStore } from '@/stores/log/logStore'

const player = usePlayerStore()
const logs = useLogStore()
const isSeeking = ref(false)
const seekPreviewMs = ref<number | null>(null)
let eqCommitTimer: ReturnType<typeof setTimeout> | undefined
let beatPulseTimer: ReturnType<typeof setTimeout> | undefined
let visualDecayTimer: ReturnType<typeof setInterval> | undefined
const beatPulse = ref(false)
let lastBeatSequence = 0
const waterfallFrames = ref<{ timeMs: number; levels: number[] }[]>([])
let lastWaterfallTimeMs = 0
const visualActivity = ref(0)
let lastAnalysisUpdateAt = 0

const displayPositionMs = computed(() => seekPreviewMs.value ?? player.positionMs)
const displayProgress = computed(() =>
  player.durationMs > 0 ? displayPositionMs.value / player.durationMs : 0
)

const backendLabel: Record<string, string> = {
  asio: 'ASIO',
  wasapi_shared: 'WASAPI Shared',
  wasapi_exclusive: 'WASAPI Exclusive',
  directsound: 'DirectSound'
}

const currentBackendLabel = computed(
  () => backendLabel[player.currentBackend] ?? player.currentBackend
)
const deviceKey = (backend: string, id: string) => `${backend}\u0000${id}`
const selectedOutputDeviceKey = computed(() =>
  deviceKey(player.currentBackend, player.currentDeviceId)
)
const rhythmPulse = computed(() =>
  Math.max(
    beatPulse.value ? 1 : 0,
    Math.min(1, player.audioAnalysis.lowEnergy * 8 + player.audioAnalysis.onsetStrength * 20)
  )
)
const visualTarget = computed(() => {
  if (!player.rhythmVisualConfig.enabled || player.state !== 'playing') return 0
  return rhythmPulse.value * player.rhythmVisualConfig.intensity
})
const visualStyle = computed(() => {
  const activity = player.rhythmVisualConfig.reducedMotion
    ? visualActivity.value * 0.25
    : visualActivity.value
  return {
    transform: `scale(${1 + (player.rhythmVisualConfig.reducedMotion ? 0 : activity * 0.018)})`,
    boxShadow: `0 0 ${8 + activity * 26}px rgba(106, 160, 220, ${0.12 + activity * 0.4})`
  }
})
const latestLoudnessLog = computed(() => {
  for (let index = logs.entries.length - 1; index >= 0; --index) {
    const entry = logs.entries[index]
    if (entry.message.startsWith('Loudness analysis:')) return entry.message
  }
  return 'Waiting for native loudness analysis log…'
})

watch(
  () => player.audioAnalysis.beatSequence,
  (sequence) => {
    if (sequence === 0) {
      lastBeatSequence = 0
      return
    }
    if (sequence === lastBeatSequence) return
    lastBeatSequence = sequence
    beatPulse.value = true
    if (beatPulseTimer) clearTimeout(beatPulseTimer)
    beatPulseTimer = setTimeout(() => {
      beatPulse.value = false
    }, 100)
  }
)

watch(
  () => player.audioAnalysis,
  (snapshot) => {
    lastAnalysisUpdateAt = performance.now()
    const timeMs = snapshot.analysisTimeMs
    if (timeMs < lastWaterfallTimeMs) {
      waterfallFrames.value = []
      lastWaterfallTimeMs = 0
    }
    if (timeMs <= 0 || timeMs - lastWaterfallTimeMs < 50) return
    lastWaterfallTimeMs = timeMs
    waterfallFrames.value = [
      ...waterfallFrames.value.slice(-59),
      { timeMs, levels: [...snapshot.spectrum] }
    ]
  }
)

function waterfallColor(level: number): string {
  const normalized = Math.max(0, Math.min(1, level))
  return `hsl(${218 - normalized * 178} 78% ${18 + normalized * 48}%)`
}
function bitPerfectLabel(): string {
  const chain = player.audioChain
  if (!chain) return 'Bit-perfect unavailable'
  if (chain.isBitPerfect) return 'Bit-perfect verified'
  if (chain.bitPerfectVerificationState === 'eligible_unverified')
    return 'Bit-perfect candidate — verify hardware'
  return 'Bit-perfect unavailable'
}

// ── Startup ──
onMounted(async () => {
  player.setLoudnessAnalysisEnabled(true)
  player.loadRhythmVisualConfig()
  lastAnalysisUpdateAt = performance.now()
  visualDecayTimer = setInterval(() => {
    const hasFreshAnalysis = performance.now() - lastAnalysisUpdateAt < 350
    const target = hasFreshAnalysis ? visualTarget.value : 0
    const easing = target > visualActivity.value ? 0.38 : 0.12
    visualActivity.value += (target - visualActivity.value) * easing
    if (Math.abs(visualActivity.value) < 0.001 && target === 0) visualActivity.value = 0
  }, 33)
  player.subscribeToEvents()
  await player.logEngineInfo()
  await player.loadOutputDeviceSettings()
  await player.refreshDevices()
  await player.refreshAudioChain()
  await player.refreshAudioAnalysis()
  await player.loadEqBands()
  await player.loadReplayGain()
  await player.loadPlaybackSpeed()
  await player.loadResamplerConfig()
  await player.loadDopEnabled()
  await player.loadTransitionConfig()
  await player.loadDspNodes()
  await player.loadCompressorConfig()
  await player.loadDelayConfig()
  await player.loadReverbConfig()
  await player.loadChorusConfig()
  await player.loadNoiseGateConfig()
  await player.loadPhaserConfig()
  await player.loadChannelMatrixConfig()
  await player.loadLimiter()

  console.log('[App] Audio player UI mounted')
})

onUnmounted(() => {
  player.setLoudnessAnalysisEnabled(false)
  if (eqCommitTimer) clearTimeout(eqCommitTimer)
  if (beatPulseTimer) clearTimeout(beatPulseTimer)
  if (visualDecayTimer) clearInterval(visualDecayTimer)
  player.unsubscribe()
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

function setPreampEnabled(event: Event) {
  void player.setPreamp(player.preampDb, (event.target as HTMLInputElement).checked)
}

function setPreampDb(event: Event) {
  void player.setPreamp(Number((event.target as HTMLInputElement).value), player.preampEnabled)
}
function updateReplayGain(): void {
  void player.setReplayGain()
}
function updatePlaybackSpeed(): void {
  void player.setPlaybackSpeed()
}

function previewEqGain(index: number, event: Event) {
  const band = player.eqBands[index]
  band.gainDb = Number((event.target as HTMLInputElement).value)
  // A non-zero gain is an intentional EQ edit, so make it audible without
  // requiring the user to find and tick the small per-band checkbox.
  band.enabled = Math.abs(band.gainDb) >= 0.0001
  scheduleEqCommit()
}

function commitEqBands() {
  if (eqCommitTimer) clearTimeout(eqCommitTimer)
  eqCommitTimer = undefined
  void player.commitEqBands()
}

function scheduleEqCommit() {
  if (eqCommitTimer) clearTimeout(eqCommitTimer)
  eqCommitTimer = setTimeout(commitEqBands, 80)
}

function setEqBandEnabled(index: number, event: Event) {
  player.eqBands[index].enabled = (event.target as HTMLInputElement).checked
  commitEqBands()
}

function updateResampler(): void {
  void player.setResamplerConfig(player.resamplerConfig)
}
function updateDopEnabled(event: Event): void {
  void player.setDopEnabled((event.target as HTMLInputElement).checked)
}
function updateTransitionConfig(): void {
  void player.setTransitionConfig()
}

function nodeLabel(id: string): string {
  return id === 'compressor'
    ? 'Compressor'
    : id === 'delay'
      ? 'Delay'
      : id === 'reverb'
        ? 'Reverb'
        : id === 'chorus'
          ? 'Chorus'
          : id === 'noise_gate'
            ? 'Noise Gate'
            : 'Phaser'
}

function updateDspNodes(): void {
  void player.commitDspNodes()
}
function updateCompressor(): void {
  void player.setCompressorConfig()
}
function updateDelay(): void {
  void player.setDelayConfig()
}
function updateReverb(): void {
  void player.setReverbConfig()
}
function updateChorus(): void {
  void player.setChorusConfig()
}
function updateNoiseGate(): void {
  void player.setNoiseGateConfig()
}
function updatePhaser(): void {
  void player.setPhaserConfig()
}
function updateChannelMatrix(): void {
  void player.setChannelMatrixConfig()
}
function updateLimiter(): void {
  void player.setLimiter()
}

function formatFrequency(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)}k` : `${hz}`
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

async function copyLog(entry: { timestamp: number; level: string; source?: string; message: string }) {
  const time = new Date(entry.timestamp).toLocaleTimeString()
  const text = `[${time}] [${entry.level.toUpperCase()}] [${entry.source ?? 'renderer'}] ${entry.message}`
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
  <div class="app-container" @drop="handleFileDrop" @dragover="handleDragOver">
    <!-- Title Bar -->
    <header class="title-bar">
      <h1>Easy Player</h1>
      <span class="version">Phase 1 — WASAPI + DSound</span>
    </header>

    <!-- Drop Zone -->
    <div class="drop-zone" :style="visualStyle">
      <p v-if="!player.currentFile">Drop an audio file here (WAV, FLAC, MP3...)</p>
      <p v-else>
        {{ player.trackInfo?.metadata?.title || player.currentFile }}
      </p>
    </div>

    <section class="analysis-section">
      <div class="analysis-heading">
        <span>Audio analysis</span
        ><small
          >out {{ player.audioAnalysis.outputTimeMs.toFixed(0) }} ms · analysis
          {{ player.audioAnalysis.analysisTimeMs.toFixed(0) }} ms · lag
          {{ player.audioAnalysis.analysisLatencyMs.toFixed(0) }} ms · dropped
          {{ player.audioAnalysis.droppedFrames }}</small
        >
      </div>
      <div class="analysis-meter">
        <span
          class="rms"
          :style="{ width: `${Math.min(100, player.audioAnalysis.rms * 260)}%` }"
        ></span
        ><span
          class="low"
          :style="{ width: `${Math.min(100, player.audioAnalysis.lowEnergy * 360)}%` }"
        ></span>
      </div>
      <div class="spectrum">
        <i
          v-for="(level, index) in player.audioAnalysis.spectrum"
          :key="index"
          :style="{ height: `${Math.max(2, level * 100)}%` }"
        ></i>
      </div>
      <div class="spectrum-range">
        <span>45 Hz</span><span>Log frequency · 64 bands</span><span>20 kHz</span>
      </div>
      <div class="waterfall" aria-label="64 band spectrum waterfall">
        <div v-for="frame in waterfallFrames" :key="frame.timeMs" class="waterfall-row">
          <i
            v-for="(level, index) in frame.levels"
            :key="index"
            :style="{ backgroundColor: waterfallColor(level) }"
          ></i>
        </div>
      </div>
      <div class="waterfall-label">
        <span>old</span><span>spectrogram · ~3 s history</span><span>now</span>
      </div>
      <small
        >RMS {{ player.audioAnalysis.rms.toFixed(3) }} · Low
        {{ player.audioAnalysis.lowEnergy.toFixed(3) }} · Onset
        {{ player.audioAnalysis.onsetStrength.toFixed(3) }} ·
        <b :class="{ 'beat-active': beatPulse }">Beat {{ player.audioAnalysis.beatSequence }}</b> ·
        Est. BPM
        {{ player.audioAnalysis.bpm > 0 ? player.audioAnalysis.bpm.toFixed(1) : '—' }}</small
      >
      <div class="loudness-row">
        <span
          >LUFS M <b>{{ player.audioAnalysis.momentaryLufs.toFixed(1) }}</b></span
        ><span
          >S <b>{{ player.audioAnalysis.shortTermLufs.toFixed(1) }}</b></span
        ><span
          >I <b>{{ player.audioAnalysis.integratedLufs.toFixed(1) }}</b></span
        ><small>K-weighted output meter</small>
      </div>
      <div class="analysis-debug">{{ latestLoudnessLog }}</div>
      <div class="visual-controls">
        <label
          ><input
            v-model="player.rhythmVisualConfig.enabled"
            type="checkbox"
            @change="player.saveRhythmVisualConfig()"
          />
          Rhythm visuals</label
        >
        <label
          >Intensity
          <input
            v-model.number="player.rhythmVisualConfig.intensity"
            type="range"
            min="0"
            max="1"
            step="0.05"
            @change="player.saveRhythmVisualConfig()"
          />
          {{ Math.round(player.rhythmVisualConfig.intensity * 100) }}%</label
        >
        <label
          ><input
            v-model="player.rhythmVisualConfig.reducedMotion"
            type="checkbox"
            @change="player.saveRhythmVisualConfig()"
          />
          Reduce motion</label
        >
      </div>
    </section>

    <!-- Output Device Selector -->
    <div class="selector-row">
      <div class="selector-group">
        <label>Output device:</label>
        <select
          :value="selectedOutputDeviceKey"
          @change="
            async (e) => {
              const value = (e.target as HTMLSelectElement).value
              const device = player.devices.find((d) => deviceKey(d.backend, d.id) === value)
              if (device) await player.selectOutputDevice(device)
            }
          "
        >
          <option
            v-for="dev in player.devices"
            :key="`${dev.backend}:${dev.id}`"
            :value="deviceKey(dev.backend, dev.id)"
          >
            {{ backendLabel[dev.backend] }} + {{ dev.name }}{{ dev.isDefault ? ' (default)' : '' }}
          </option>
        </select>
      </div>
      <button class="btn-refresh" title="Refresh devices" @click="player.refreshDevices()">
        &#x21bb;
      </button>
    </div>

    <!-- Player Controls -->
    <div class="controls">
      <button
        v-if="!player.isPlaying"
        class="btn btn-play"
        :disabled="player.state === 'idle'"
        @click="player.play()"
      >
        &#9654; Play
      </button>
      <button v-else class="btn btn-pause" @click="player.pause()">&#9646;&#9646; Pause</button>
      <button class="btn btn-stop" :disabled="player.state === 'idle'" @click="player.stop()">
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
        @pointercancel="
          () => {
            isSeeking = false
            seekPreviewMs = null
          }
        "
      >
        <div class="progress-fill" :style="{ width: displayProgress * 100 + '%' }"></div>
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

    <!-- Preamp: manual gain; metadata-driven ReplayGain is a later node. -->
    <div class="preamp-section">
      <label>
        <input type="checkbox" :checked="player.preampEnabled" @change="setPreampEnabled" />
        Preamp
      </label>
      <input
        type="range"
        min="-24"
        max="24"
        step="0.1"
        :value="player.preampDb"
        :disabled="!player.preampEnabled"
        @input="setPreampDb"
      />
      <span>{{ player.preampDb.toFixed(1) }} dB</span>
    </div>
    <div class="preamp-section">
      <label
        >ReplayGain
        <select v-model="player.replayGainConfig.mode" @change="updateReplayGain">
          <option value="off">Off</option>
          <option value="track">Track</option>
          <option value="album">Album</option>
        </select></label
      >
      <label
        ><input
          v-model="player.replayGainConfig.preventClipping"
          :disabled="player.replayGainConfig.mode === 'off'"
          type="checkbox"
          @change="updateReplayGain"
        />
        Prevent clipping</label
      >
      <span>{{
        player.replayGainConfig.active
          ? `${player.replayGainConfig.appliedGainDb.toFixed(2)} dB applied`
          : 'No matching tag'
      }}</span>
    </div>
    <div class="preamp-section">
      <label
        ><input
          v-model="player.playbackSpeedConfig.enabled"
          type="checkbox"
          @change="updatePlaybackSpeed"
        />
        Preserve-pitch speed</label
      >
      <input
        v-model.number="player.playbackSpeedConfig.speed"
        :disabled="!player.playbackSpeedConfig.enabled"
        type="range"
        min="0.5"
        max="2"
        step="0.05"
        @change="updatePlaybackSpeed"
      />
      <span>{{ player.playbackSpeedConfig.speed.toFixed(2) }}×</span>
    </div>

    <section class="channel-matrix-section">
      <label
        ><input
          v-model="player.channelMatrixConfig.enabled"
          type="checkbox"
          @change="updateChannelMatrix"
        />
        Channel matrix</label
      >
      <label
        >Balance
        <input
          v-model.number="player.channelMatrixConfig.balance"
          :disabled="!player.channelMatrixConfig.enabled"
          type="range"
          min="-1"
          max="1"
          step="0.01"
          @change="updateChannelMatrix"
        />
        {{ player.channelMatrixConfig.balance.toFixed(2) }}</label
      >
      <label
        ><input
          v-model="player.channelMatrixConfig.swapStereo"
          :disabled="!player.channelMatrixConfig.enabled"
          type="checkbox"
          @change="updateChannelMatrix"
        />
        Swap L/R</label
      >
      <label
        ><input
          v-model="player.channelMatrixConfig.monoDownmix"
          :disabled="!player.channelMatrixConfig.enabled"
          type="checkbox"
          @change="updateChannelMatrix"
        />
        Stereo to mono</label
      >
      <div class="channel-gains">
        <label v-for="(_gain, index) in player.channelMatrixConfig.outputGains" :key="index"
          >Ch {{ index + 1 }}
          <input
            v-model.number="player.channelMatrixConfig.outputGains[index]"
            :disabled="!player.channelMatrixConfig.enabled"
            type="number"
            min="0"
            max="2"
            step="0.01"
            @change="updateChannelMatrix"
        /></label>
      </div>
    </section>

    <!-- 20-band parametric EQ: Q is fixed at 1.0 in this initial panel. -->
    <section class="eq-section">
      <div class="eq-heading">
        <span>Parametric EQ</span>
        <span class="eq-heading-actions">
          <small
            >{{
              player.eqBands.filter((band) => band.enabled && Math.abs(band.gainDb) >= 0.0001)
                .length
            }}
            active · ±12 dB · Q 1.0</small
          >
          <button class="eq-apply" @click="commitEqBands">Apply EQ</button>
        </span>
      </div>
      <div class="eq-bands">
        <div v-for="(band, index) in player.eqBands" :key="band.frequencyHz" class="eq-band">
          <span class="eq-gain">{{ band.gainDb.toFixed(1) }}</span>
          <input
            class="eq-slider"
            type="range"
            min="-12"
            max="12"
            step="0.1"
            :value="band.gainDb"
            @input="previewEqGain(index, $event)"
          />
          <label class="eq-frequency">
            <input
              type="checkbox"
              :checked="band.enabled"
              @change="setEqBandEnabled(index, $event)"
            />
            {{ formatFrequency(band.frequencyHz) }}
          </label>
        </div>
      </div>
    </section>

    <section class="dsp-nodes-section">
      <div class="dsp-nodes-heading">
        DSP node order <small>Enabled nodes process audio in the listed order.</small>
      </div>
      <div v-for="(node, index) in player.dspNodes" :key="node.id" class="dsp-node-row">
        <label
          ><input v-model="node.enabled" type="checkbox" @change="updateDspNodes" />
          {{ nodeLabel(node.id) }}</label
        >
        <span>{{
          node.id === 'compressor'
            ? 'real-time dynamics processor'
            : node.id === 'delay'
              ? 'real-time echo processor'
              : node.id === 'reverb'
                ? 'real-time multi-tap reverb'
                : node.id === 'chorus'
                  ? 'modulated-delay processor'
                  : node.id === 'noise_gate'
                    ? 'stereo-linked noise gate'
                    : 'four-stage all-pass modulation'
        }}</span>
        <button :disabled="index === 0" @click="player.moveDspNode(index, -1)">↑</button>
        <button
          :disabled="index === player.dspNodes.length - 1"
          @click="player.moveDspNode(index, 1)"
        >
          ↓
        </button>
      </div>
      <div
        v-if="player.dspNodes.some((node) => node.id === 'compressor' && node.enabled)"
        class="compressor-controls"
      >
        <label
          >Threshold
          <input
            v-model.number="player.compressorConfig.thresholdDb"
            type="number"
            min="-60"
            max="0"
            step="1"
            @change="updateCompressor"
          />
          dB</label
        >
        <label
          >Ratio
          <input
            v-model.number="player.compressorConfig.ratio"
            type="number"
            min="1"
            max="20"
            step="0.1"
            @change="updateCompressor"
          />:1</label
        >
        <label
          >Attack
          <input
            v-model.number="player.compressorConfig.attackMs"
            type="number"
            min="0.1"
            max="500"
            step="0.1"
            @change="updateCompressor"
          />
          ms</label
        >
        <label
          >Release
          <input
            v-model.number="player.compressorConfig.releaseMs"
            type="number"
            min="5"
            max="2000"
            step="1"
            @change="updateCompressor"
          />
          ms</label
        >
        <label
          >Makeup
          <input
            v-model.number="player.compressorConfig.makeupDb"
            type="number"
            min="-12"
            max="24"
            step="0.5"
            @change="updateCompressor"
          />
          dB</label
        >
      </div>
      <div
        v-if="player.dspNodes.some((node) => node.id === 'delay' && node.enabled)"
        class="compressor-controls"
      >
        <label
          >Time
          <input
            v-model.number="player.delayConfig.delayMs"
            type="number"
            min="1"
            max="2000"
            step="1"
            @change="updateDelay"
          />
          ms</label
        >
        <label
          >Feedback
          <input
            v-model.number="player.delayConfig.feedback"
            type="number"
            min="0"
            max="0.95"
            step="0.01"
            @change="updateDelay"
        /></label>
        <label
          >Wet mix
          <input
            v-model.number="player.delayConfig.mix"
            type="number"
            min="0"
            max="1"
            step="0.01"
            @change="updateDelay"
        /></label>
      </div>
      <div
        v-if="player.dspNodes.some((node) => node.id === 'reverb' && node.enabled)"
        class="compressor-controls"
      >
        <label
          >Room
          <input
            v-model.number="player.reverbConfig.roomSize"
            type="number"
            min="0"
            max="1"
            step="0.05"
            @change="updateReverb"
        /></label>
        <label
          >Decay
          <input
            v-model.number="player.reverbConfig.decay"
            type="number"
            min="0"
            max="1"
            step="0.05"
            @change="updateReverb"
        /></label>
        <label
          >Wet mix
          <input
            v-model.number="player.reverbConfig.mix"
            type="number"
            min="0"
            max="1"
            step="0.05"
            @change="updateReverb"
        /></label>
      </div>
      <div
        v-if="player.dspNodes.some((node) => node.id === 'chorus' && node.enabled)"
        class="compressor-controls"
      >
        <label
          >Rate
          <input
            v-model.number="player.chorusConfig.rateHz"
            type="number"
            min="0.05"
            max="10"
            step="0.05"
            @change="updateChorus"
          />
          Hz</label
        >
        <label
          >Depth
          <input
            v-model.number="player.chorusConfig.depthMs"
            type="number"
            min="0.1"
            max="15"
            step="0.1"
            @change="updateChorus"
          />
          ms</label
        >
        <label
          >Wet mix
          <input
            v-model.number="player.chorusConfig.mix"
            type="number"
            min="0"
            max="1"
            step="0.01"
            @change="updateChorus"
        /></label>
      </div>
      <div
        v-if="player.dspNodes.some((node) => node.id === 'noise_gate' && node.enabled)"
        class="compressor-controls"
      >
        <label
          >Threshold
          <input
            v-model.number="player.noiseGateConfig.thresholdDb"
            type="number"
            min="-80"
            max="0"
            step="1"
            @change="updateNoiseGate"
          />
          dB</label
        >
        <label
          >Attack
          <input
            v-model.number="player.noiseGateConfig.attackMs"
            type="number"
            min="0.1"
            max="200"
            step="0.1"
            @change="updateNoiseGate"
          />
          ms</label
        >
        <label
          >Hold
          <input
            v-model.number="player.noiseGateConfig.holdMs"
            type="number"
            min="0"
            max="2000"
            step="1"
            @change="updateNoiseGate"
          />
          ms</label
        >
        <label
          >Release
          <input
            v-model.number="player.noiseGateConfig.releaseMs"
            type="number"
            min="5"
            max="2000"
            step="1"
            @change="updateNoiseGate"
          />
          ms</label
        >
        <label
          >Range
          <input
            v-model.number="player.noiseGateConfig.rangeDb"
            type="number"
            min="-100"
            max="0"
            step="1"
            @change="updateNoiseGate"
          />
          dB</label
        >
      </div>
      <div
        v-if="player.dspNodes.some((node) => node.id === 'phaser' && node.enabled)"
        class="compressor-controls"
      >
        <label
          >Rate
          <input
            v-model.number="player.phaserConfig.rateHz"
            type="number"
            min="0.05"
            max="10"
            step="0.05"
            @change="updatePhaser"
          />
          Hz</label
        >
        <label
          >Depth
          <input
            v-model.number="player.phaserConfig.depth"
            type="number"
            min="0"
            max="1"
            step="0.05"
            @change="updatePhaser"
        /></label>
        <label
          >Center
          <input
            v-model.number="player.phaserConfig.centerHz"
            type="number"
            min="100"
            max="5000"
            step="10"
            @change="updatePhaser"
          />
          Hz</label
        >
        <label
          >Feedback
          <input
            v-model.number="player.phaserConfig.feedback"
            type="number"
            min="-0.95"
            max="0.95"
            step="0.05"
            @change="updatePhaser"
        /></label>
        <label
          >Wet mix
          <input
            v-model.number="player.phaserConfig.mix"
            type="number"
            min="0"
            max="1"
            step="0.05"
            @change="updatePhaser"
        /></label>
      </div>
      <div class="compressor-controls">
        <label
          ><input v-model="player.limiterConfig.enabled" type="checkbox" @change="updateLimiter" />
          Limiter</label
        >
        <label
          >Ceiling
          <input
            v-model.number="player.limiterConfig.ceilingDb"
            :disabled="!player.limiterConfig.enabled"
            type="number"
            min="-12"
            max="0"
            step="0.1"
            @change="updateLimiter"
          />
          dB</label
        >
        <label
          >Release
          <input
            v-model.number="player.limiterConfig.releaseMs"
            :disabled="!player.limiterConfig.enabled"
            type="number"
            min="5"
            max="2000"
            step="1"
            @change="updateLimiter"
          />
          ms</label
        >
      </div>
    </section>

    <section class="resampler-section">
      <div class="resampler-heading">Sample-rate conversion</div>
      <label>
        <input
          v-model="player.resamplerConfig.forceOutputRate"
          type="checkbox"
          @change="updateResampler"
        />
        Force output rate
      </label>
      <select
        v-model.number="player.resamplerConfig.targetSampleRate"
        :disabled="!player.resamplerConfig.forceOutputRate"
        @change="updateResampler"
      >
        <option :value="44100">44.1 kHz</option>
        <option :value="48000">48 kHz</option>
        <option :value="88200">88.2 kHz</option>
        <option :value="96000">96 kHz</option>
        <option :value="176400">176.4 kHz</option>
        <option :value="192000">192 kHz</option>
      </select>
      <select v-model="player.resamplerConfig.quality" @change="updateResampler">
        <option value="best">Best quality</option>
        <option value="medium">Medium quality</option>
        <option value="fast">Fastest</option>
      </select>
      <small>Changing this setting safely reopens the output path.</small>
    </section>
    <section class="resampler-section dop-section">
      <div class="resampler-heading">DSD transport</div>
      <label>
        <input :checked="player.dopEnabled" type="checkbox" @change="updateDopEnabled" />
        Enable DoP (PCM24 carrier)
      </label>
      <small
        >Only for a confirmed DoP-capable DAC with WASAPI Exclusive or ASIO. Takes effect on the
        next DSD playback; DSP, volume and analysis are bypassed.</small
      >
    </section>
    <section class="resampler-section">
      <div class="resampler-heading">Track transition</div>
      <label
        ><input
          v-model="player.transitionConfig.gaplessEnabled"
          type="checkbox"
          @change="updateTransitionConfig"
        />
        Gapless loop</label
      >
      <label
        ><input
          v-model="player.transitionConfig.crossfadeEnabled"
          :disabled="!player.transitionConfig.gaplessEnabled"
          type="checkbox"
          @change="updateTransitionConfig"
        />
        Crossfade</label
      >
      <label
        >Duration
        <input
          v-model.number="player.transitionConfig.crossfadeMs"
          :disabled="
            !player.transitionConfig.gaplessEnabled || !player.transitionConfig.crossfadeEnabled
          "
          type="number"
          min="0"
          max="30000"
          step="100"
          @change="updateTransitionConfig"
        />
        ms</label
      >
      <small
        >Current single-track mode loops the opened file. Crossfade disables PCM bit-perfect
        status.</small
      >
    </section>

    <section v-if="player.audioChain" class="chain-section">
      <div class="chain-heading">
        <span>Audio pipeline</span>
        <span
          :class="
            player.audioChain.isBitPerfect
              ? 'bit-perfect-ok'
              : player.audioChain.isBitPerfectEligible
                ? 'bit-perfect-candidate'
                : 'bit-perfect-off'
          "
        >
          {{ bitPerfectLabel() }}
        </span>
      </div>
      <div class="chain-format">
        {{ player.audioChain.sourceFormat.sampleRate || '—' }} Hz /
        {{ player.audioChain.sourceFormat.channels || '—' }} ch
        <span>→</span>
        {{ player.audioChain.backendFormat.sampleRate || '—' }} Hz /
        {{ player.audioChain.backendFormat.channels || '—' }} ch
      </div>
      <div class="chain-nodes">
        <span
          v-for="node in player.audioChain.activeNodes"
          :key="`active-${node}`"
          class="chain-node active"
          >{{ node }}</span
        >
        <span
          v-for="node in player.audioChain.bypassedNodes"
          :key="`bypassed-${node}`"
          class="chain-node"
          >{{ node }} (bypass)</span
        >
      </div>
      <small v-if="player.audioChain.bitPerfectBlockers.length" class="chain-blockers">
        {{ player.audioChain.bitPerfectBlockers.join(' · ') }}
      </small>
    </section>

    <!-- Status -->
    <div class="status-bar">
      <span
        >State: <strong>{{ player.state }}</strong></span
      >
      <span
        >| Backend: <strong>{{ currentBackendLabel }}</strong></span
      >
      <span v-if="player.trackInfo">
        | {{ player.trackInfo.format }} {{ player.trackInfo.sampleRate }}Hz
        {{ player.trackInfo.bitDepth }}bit {{ player.trackInfo.channels }}ch
      </span>
      <span v-if="player.trackInfo?.isDsd" class="dsd-status">
        | DSD {{ player.trackInfo.format }} ({{ player.trackInfo.dsdSampleRate }}Hz) →
        {{
          player.trackInfo.dsdTransport === 'pcm_conversion'
            ? `PCM ${player.trackInfo.sampleRate}Hz → output ${player.audioChain?.backendFormat.sampleRate || '—'}Hz`
            : player.trackInfo.dsdTransport
        }}
      </span>
      <span v-if="player.glitchCount > 0" class="glitch-warn">
        | Glitches: {{ player.glitchCount }}
      </span>
      <span
        v-if="player.audioChain"
        :class="
          player.audioChain.isBitPerfect
            ? 'bit-perfect-ok'
            : player.audioChain.isBitPerfectEligible
              ? 'bit-perfect-candidate'
              : 'bit-perfect-off'
        "
        :title="player.audioChain.bitPerfectBlockers.join('\n')"
      >
        | {{ bitPerfectLabel() }}
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
          <span class="log-level">[{{ entry.source ?? 'renderer' }}]</span>
          <span class="log-msg">{{ entry.message }}</span>
        </div>
        <div v-if="logs.filteredEntries.length === 0" class="log-empty">No log entries yet.</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
  padding: 16px;
  font-family: 'Segoe UI', system-ui, sans-serif;
  background: #1a1a2e;
  color: #e0e0e0;
  overflow-x: hidden;
  overflow-y: auto;
}

.title-bar {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 12px;
}
.title-bar h1 {
  margin: 0;
  font-size: 1.2rem;
  color: #7ec8e3;
}
.version {
  font-size: 0.75rem;
  color: #888;
}

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
  transition:
    transform 120ms ease-out,
    box-shadow 120ms ease-out;
}

.beat-active {
  color: #7ec8e3;
  text-shadow: 0 0 10px #7ec8e3;
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
.btn-refresh:hover {
  background: #333;
}

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
.btn:disabled {
  opacity: 0.3;
  cursor: default;
}
.btn-play {
  background: #2d6a4f;
}
.btn-pause {
  background: #b8860b;
}
.btn-stop {
  background: #8b0000;
}

.progress-section {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.time {
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
  min-width: 48px;
}
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
.volume-section input {
  width: 120px;
}
.preamp-section {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 0.85rem;
}
.preamp-section input[type='range'] {
  width: 120px;
}
.preamp-section span {
  min-width: 54px;
  color: #aaa;
}
.eq-section {
  margin-bottom: 10px;
  padding: 8px;
  background: #151525;
  border: 1px solid #343448;
  border-radius: 4px;
}
.eq-heading {
  display: flex;
  justify-content: space-between;
  margin-bottom: 5px;
  font-size: 0.8rem;
}
.eq-heading small {
  color: #888;
}
.eq-heading-actions {
  display: flex;
  align-items: center;
  gap: 7px;
}
.eq-apply {
  background: #274a5e;
  color: #d7edf8;
  border: 1px solid #47758e;
  border-radius: 3px;
  padding: 2px 6px;
  font-size: 0.7rem;
  cursor: pointer;
}
.eq-bands {
  display: flex;
  gap: 5px;
  overflow-x: auto;
  padding-bottom: 2px;
}
.eq-band {
  display: flex;
  flex: 0 0 28px;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  font-size: 0.64rem;
}
.eq-gain {
  color: #9ec8df;
  font-variant-numeric: tabular-nums;
}
.eq-slider {
  width: 92px;
  height: 14px;
  margin: 38px -39px;
  transform: rotate(-90deg);
}
.eq-frequency {
  display: flex;
  align-items: center;
  gap: 1px;
  color: #aaa;
  white-space: nowrap;
}
.eq-frequency input {
  width: 11px;
  height: 11px;
  margin: 0;
}
.resampler-section {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  padding: 8px;
  background: #151525;
  border: 1px solid #343448;
  border-radius: 4px;
  font-size: 0.75rem;
}
.resampler-heading {
  color: #cdd8df;
  margin-right: 3px;
}
.resampler-section select {
  background: #222;
  color: #ccc;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 3px 5px;
  font-size: 0.75rem;
}
.resampler-section small {
  color: #777;
}
.dop-section {
  align-items: flex-start;
}
.dop-section small {
  max-width: 520px;
  line-height: 1.35;
}
.dsp-nodes-section {
  margin-bottom: 10px;
  padding: 8px;
  background: #151525;
  border: 1px solid #343448;
  border-radius: 4px;
  font-size: 0.75rem;
}
.channel-matrix-section {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
  padding: 8px;
  background: #151525;
  border: 1px solid #343448;
  border-radius: 4px;
  font-size: 0.75rem;
}
.analysis-section {
  margin: 10px 0;
  padding: 8px;
  background: #151525;
  border: 1px solid #343448;
  border-radius: 4px;
  font-size: 0.75rem;
  color: #aab;
}
.analysis-heading {
  display: flex;
  justify-content: space-between;
  color: #cdd8df;
  margin-bottom: 5px;
}
.analysis-heading small {
  color: #777;
}
.analysis-meter {
  height: 7px;
  position: relative;
  overflow: hidden;
  border-radius: 4px;
  background: #262638;
  margin-bottom: 4px;
}
.analysis-meter span {
  position: absolute;
  inset: 0 auto 0 0;
  transition: width 45ms linear;
}
.analysis-meter .rms {
  background: #5b9bd5;
}
.analysis-meter .low {
  background: rgba(123, 208, 139, 0.75);
}
.spectrum {
  height: 72px;
  display: flex;
  align-items: end;
  gap: 2px;
  margin: 7px 0;
}
.spectrum i {
  flex: 1;
  min-width: 1px;
  background: linear-gradient(#9ec8df, #4e75a7);
  transition: height 45ms linear;
}
.waterfall {
  height: 128px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-top: 8px;
  padding: 3px;
  overflow: hidden;
  background: #0d1020;
  border: 1px solid #282c46;
  border-radius: 3px;
}
.waterfall-row {
  height: 1.6px;
  min-height: 1.6px;
  display: flex;
  gap: 1px;
}
.waterfall-row i {
  flex: 1;
  min-width: 1px;
}
.waterfall-label {
  display: flex;
  justify-content: space-between;
  color: #687282;
  font-size: 0.65rem;
}
.loudness-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-top: 5px;
  color: #8da0b4;
}
.loudness-row b {
  color: #d4e3ef;
  font-variant-numeric: tabular-nums;
}
.loudness-row small {
  margin-left: auto;
  color: #687282;
}
.analysis-debug {
  margin-top: 4px;
  padding: 3px 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #7b8795;
  background: #10101e;
  border-radius: 3px;
  font-family: 'Cascadia Code', Consolas, monospace;
  font-size: 0.68rem;
}
.visual-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-top: 7px;
  color: #99a9b8;
}
.visual-controls label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.visual-controls input[type='range'] {
  width: 82px;
  accent-color: #6aa0dc;
}
.spectrum-range {
  display: flex;
  justify-content: space-between;
  color: #777;
  font-size: 0.68rem;
}
.channel-matrix-section label {
  display: flex;
  align-items: center;
  gap: 4px;
}
.channel-gains {
  display: grid;
  grid-template-columns: repeat(4, minmax(88px, 1fr));
  gap: 4px;
  width: 100%;
}
.dsp-nodes-heading {
  color: #cdd8df;
  margin-bottom: 5px;
}
.dsp-nodes-heading small {
  color: #777;
  margin-left: 6px;
}
.dsp-node-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 2px 0;
}
.dsp-node-row label {
  min-width: 106px;
}
.dsp-node-row span {
  flex: 1;
  color: #888;
}
.dsp-node-row button {
  background: #222;
  color: #ccc;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 0 5px;
  cursor: pointer;
}
.dsp-node-row button:disabled {
  opacity: 0.35;
  cursor: default;
}
.compressor-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 6px;
  color: #aaa;
}
.compressor-controls input {
  width: 52px;
  background: #222;
  color: #ddd;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 2px 3px;
}
.chain-section {
  margin-bottom: 10px;
  padding: 8px;
  background: #151525;
  border: 1px solid #343448;
  border-radius: 4px;
  font-size: 0.75rem;
}
.chain-heading {
  display: flex;
  justify-content: space-between;
  margin-bottom: 5px;
  color: #cdd8df;
}
.chain-format {
  color: #9ec8df;
  font-variant-numeric: tabular-nums;
}
.chain-format span {
  padding: 0 7px;
  color: #777;
}
.chain-nodes {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 6px;
}
.chain-node {
  padding: 2px 5px;
  border-radius: 3px;
  background: #272735;
  color: #858595;
}
.chain-node.active {
  background: #225340;
  color: #bde8ca;
}
.chain-blockers {
  display: block;
  color: #d6a970;
  margin-top: 6px;
  line-height: 1.35;
}

.status-bar {
  font-size: 0.75rem;
  color: #888;
  margin-bottom: 12px;
  display: flex;
  gap: 8px;
}
.glitch-warn {
  color: #e74c3c;
}
.bit-perfect-ok {
  color: #70d6a0;
}
.bit-perfect-candidate {
  color: #80c8f0;
}
.bit-perfect-off {
  color: #d6a970;
}
.dsd-status {
  color: #a88de1;
}

.log-viewer {
  flex: 0 0 220px;
  min-height: 180px;
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
.log-header h3 {
  margin: 0;
  font-size: 0.85rem;
  flex: 1;
}
.log-header select,
.log-header button {
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
.log-entry:hover {
  background: #1a1a1a;
}
.log-entry:hover .log-copy-btn {
  opacity: 1;
}
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
.log-copy-btn:active {
  background: #333;
}
.log-debug {
  color: #888;
}
.log-info {
  color: #ccc;
}
.log-warn {
  color: #f0ad4e;
}
.log-error {
  color: #e74c3c;
}
.log-time {
  color: #555;
  white-space: nowrap;
}
.log-level {
  white-space: nowrap;
  min-width: 56px;
}
.log-msg {
  word-break: break-all;
}
.log-empty {
  padding: 10px;
  color: #555;
}
</style>
