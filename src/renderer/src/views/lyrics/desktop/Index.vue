<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch, type CSSProperties } from 'vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'

interface DesktopState {
  songId?: number
  revision?: number
  current: string
  next: string
  translation: string
  positionMs?: number
  sweepStartMs?: number
  sweepEndMs?: number
  isPlaying?: boolean
  styles: {
    fontSize: number
    activeColor: string
    inactiveColor: string
    fontBold: boolean
    glow: boolean
    sweep: boolean
    showTranslation: boolean
    autoHideBackground: boolean
    fontFamily: string
  }
}

// Desktop lyrics are primarily an overlay. Starting locked makes the window
// click-through, so interacting with a full-screen game cannot focus this
// window or accidentally activate its controls.
const locked = ref(true)
const hovering = ref(true)
const windowHeight = ref(window.innerHeight)
const lockButton = ref<HTMLButtonElement>()
const currentBox = ref<HTMLElement>()
const currentText = ref<HTMLElement>()
const secondBox = ref<HTMLElement>()
const secondText = ref<HTMLElement>()
const currentOverflows = ref(false)
const secondOverflows = ref(false)
const displayedFirst = ref('')
const displayedSecond = ref('')
let previousCurrent = ''
let previousSongId: number | undefined
let previousRevision: number | undefined
let hasReceivedState = false
let lastReportedFontSize: number | undefined
let replaceFirst = true
const activeSlot = ref<'first' | 'second'>('first')
const animatedSweepProgress = ref(0)
let sweepPositionAnchor = { positionMs: 0, receivedAt: performance.now() }
let sweepAnimationFrame: number | undefined
const state = ref<DesktopState>({
  current: '',
  next: '',
  translation: '',
  isPlaying: false,
  styles: {
    fontSize: 34,
    activeColor: '#ffffff',
    inactiveColor: 'rgba(255, 255, 255, 0.58)',
    fontBold: true,
    glow: true,
    sweep: false,
    showTranslation: true,
    autoHideBackground: true,
    fontFamily: ''
  }
})
let hideTimer: ReturnType<typeof setTimeout> | undefined
let lockButtonCapturesMouse = false
const backgroundVisible = computed(
  () => !locked.value && (hovering.value || !state.value.styles.autoHideBackground)
)
function fontSizeForWindowHeight(height: number): number {
  const resizedSize = (height - 34) / 3.75
  // 24px vertical padding + the 26.4px toolbar / 4px margin + lyric gap and
  // an additional glow-safe buffer. Two equal lyric rows must always fit.
  const availableLyricsHeight = Math.max(0, height - 24 - 30.4 - 4 - 16)
  const maxFittingSize = availableLyricsHeight / (2 * 1.3)
  return Math.max(24, Math.min(64, Math.round(Math.min(resizedSize, maxFittingSize))))
}
const lyricFontSize = computed(() => fontSizeForWindowHeight(windowHeight.value))
const fontFamilyStyle = computed(() => {
  const family = state.value.styles.fontFamily
  if (!family) return undefined
  return family
})
const currentStyle = computed(() => ({
  fontSize: `${lyricFontSize.value}px`,
  lineHeight: 1.3,
  color: state.value.styles.activeColor,
  fontWeight: state.value.styles.fontBold ? 700 : 500,
  textShadow: state.value.styles.glow ? `0 0 8px ${state.value.styles.activeColor}` : 'none',
  fontFamily: fontFamilyStyle.value
}))
const inactiveStyle = computed(() => ({
  color: state.value.styles.inactiveColor,
  fontSize: `${lyricFontSize.value}px`,
  lineHeight: 1.3,
  fontWeight: state.value.styles.fontBold ? 700 : 500,
  textShadow: 'none',
  fontFamily: fontFamilyStyle.value
}))
const sweepProgress = computed(() => animatedSweepProgress.value)

function updateSweepProgress(now = performance.now()): void {
  const startMs = state.value.sweepStartMs
  const endMs = state.value.sweepEndMs
  if (typeof startMs !== 'number' || typeof endMs !== 'number' || endMs <= startMs) {
    animatedSweepProgress.value = 0
    return
  }
  const elapsedMs = state.value.isPlaying ? Math.max(0, now - sweepPositionAnchor.receivedAt) : 0
  const positionMs = sweepPositionAnchor.positionMs + elapsedMs
  animatedSweepProgress.value = Math.max(0, Math.min(1, (positionMs - startMs) / (endMs - startMs)))
}

function animateSweep(now: number): void {
  updateSweepProgress(now)
  if (state.value.styles.sweep && state.value.isPlaying)
    sweepAnimationFrame = requestAnimationFrame(animateSweep)
  else sweepAnimationFrame = undefined
}

function syncSweepAnimation(): void {
  updateSweepProgress()
  if (state.value.styles.sweep && state.value.isPlaying && sweepAnimationFrame === undefined)
    sweepAnimationFrame = requestAnimationFrame(animateSweep)
  if ((!state.value.styles.sweep || !state.value.isPlaying) && sweepAnimationFrame !== undefined) {
    cancelAnimationFrame(sweepAnimationFrame)
    sweepAnimationFrame = undefined
  }
}

function lineStyle(slot: 'first' | 'second'): CSSProperties {
  const active = activeSlot.value === slot
  const style = active ? currentStyle.value : inactiveStyle.value
  if (!active || !state.value.styles.sweep) return style
  const progress = `${(sweepProgress.value * 100).toFixed(2)}%`
  return {
    ...style,
    color: 'transparent',
    textShadow: 'none',
    backgroundImage: `linear-gradient(90deg, ${state.value.styles.activeColor} 0%, ${state.value.styles.activeColor} ${progress}, ${state.value.styles.inactiveColor} ${progress}, ${state.value.styles.inactiveColor} 100%)`,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text'
  }
}

async function checkOverflow(): Promise<void> {
  await nextTick()
  currentOverflows.value =
    !!currentBox.value &&
    !!currentText.value &&
    currentText.value.scrollWidth > currentBox.value.clientWidth
  secondOverflows.value =
    !!secondBox.value &&
    !!secondText.value &&
    secondText.value.scrollWidth > secondBox.value.clientWidth
  if (currentBox.value && currentText.value)
    currentText.value.style.setProperty(
      '--marquee-distance',
      `${-Math.max(0, currentText.value.scrollWidth - currentBox.value.clientWidth)}px`
    )
  if (secondBox.value && secondText.value)
    secondText.value.style.setProperty(
      '--marquee-distance',
      `${-Math.max(0, secondText.value.scrollWidth - secondBox.value.clientWidth)}px`
    )
}
function scheduleHide(): void {
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    hovering.value = false
  }, 2600)
}
function enter(): void {
  hovering.value = true
  if (hideTimer) clearTimeout(hideTimer)
}
function setLockButtonMouseCapture(capture: boolean): void {
  if (lockButtonCapturesMouse === capture) return
  lockButtonCapturesMouse = capture
  // Keep the lyric body click-through while locked. Electron forwards mouse
  // moves in this mode, so only reclaim the pointer when it reaches the lock
  // control itself; its click can then unlock the window normally.
  window.api.desktopLyrics.setLocked(!capture)
}
function move(event: MouseEvent): void {
  if (!locked.value) {
    enter()
    return
  }

  const rect = lockButton.value?.getBoundingClientRect()
  const isOverLockButton =
    !!rect &&
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  setLockButtonMouseCapture(isOverLockButton)
}
function leave(): void {
  if (locked.value) setLockButtonMouseCapture(false)
  else scheduleHide()
}
function toggleLock(): void {
  locked.value = !locked.value
  lockButtonCapturesMouse = false
  window.api.desktopLyrics.setLocked(locked.value)
}
function action(type: 'previous' | 'toggle' | 'next'): void {
  window.api.desktopLyrics.action(type)
}
function closeWindow(): void {
  window.api.desktopLyrics.close()
}

const removeUpdate = window.api.desktopLyrics.onUpdate((data) => {
  if (!data || typeof data !== 'object') return
  const next = data as Partial<DesktopState>
  const previousState = state.value
  const fontSizeChanged =
    typeof next.styles?.fontSize === 'number' &&
    next.styles.fontSize !== previousState.styles.fontSize
  const fontSizeCameFromWindow =
    typeof next.styles?.fontSize === 'number' && next.styles.fontSize === lastReportedFontSize
  // Playback progress arrives frequently while sweep mode is active. Measuring
  // scroll widths forces layout, so reserve that work for text/metric changes
  // rather than every gradient-progress update.
  const needsOverflowCheck =
    next.current !== previousState.current ||
    next.next !== previousState.next ||
    next.translation !== previousState.translation ||
    fontSizeChanged ||
    (typeof next.styles?.fontFamily === 'string' &&
      next.styles.fontFamily !== previousState.styles.fontFamily) ||
    (typeof next.styles?.fontBold === 'boolean' &&
      next.styles.fontBold !== previousState.styles.fontBold)
  state.value = {
    ...state.value,
    ...next,
    styles: { ...state.value.styles, ...(next.styles || {}) }
  }
  if (typeof next.positionMs === 'number')
    sweepPositionAnchor = { positionMs: next.positionMs, receivedAt: performance.now() }
  syncSweepAnimation()
  if (
    !previousCurrent ||
    !next.current ||
    next.songId !== previousSongId ||
    next.revision !== previousRevision
  ) {
    displayedFirst.value = state.value.current
    displayedSecond.value = state.value.next
    replaceFirst = true
    activeSlot.value = 'first'
  } else if (next.current !== previousCurrent) {
    const replacement = state.value.next || state.value.current
    if (state.value.translation) {
      displayedFirst.value = state.value.current
      activeSlot.value = 'first'
    } else if (replaceFirst) {
      displayedFirst.value = replacement
      replaceFirst = false
      // The unchanged second slot is the lyric currently being played.
      activeSlot.value = 'second'
    } else {
      displayedSecond.value = replacement
      replaceFirst = true
      // The unchanged first slot is the lyric currently being played.
      activeSlot.value = 'first'
    }
  } else if (next.next !== previousState.next && !state.value.translation) {
    if (activeSlot.value === 'first') displayedSecond.value = state.value.next
    else displayedFirst.value = state.value.next
  }
  previousCurrent = state.value.current
  previousSongId = state.value.songId
  previousRevision = state.value.revision
  // On the first update, keep restored bounds when they exist; a brand-new
  // window can still auto-size for a non-default persisted font. Later font
  // changes resize the window and are saved normally.
  if (!hasReceivedState) window.api.desktopLyrics.resizeForFont(state.value.styles.fontSize, true)
  else if (fontSizeChanged && !fontSizeCameFromWindow)
    window.api.desktopLyrics.resizeForFont(state.value.styles.fontSize)
  if (fontSizeCameFromWindow) lastReportedFontSize = undefined
  hasReceivedState = true
  if (needsOverflowCheck) void checkOverflow()
})
const removeBounds = window.api.desktopLyrics.onBounds((bounds) => {
  windowHeight.value = bounds.height
  if (bounds.syncFontSize) {
    const fontSize = fontSizeForWindowHeight(bounds.height)
    if (fontSize !== state.value.styles.fontSize) {
      lastReportedFontSize = fontSize
      window.api.desktopLyrics.syncFontSize(fontSize)
    }
  }
  void checkOverflow()
})
const handleResize = (): void => {
  windowHeight.value = window.innerHeight
  void checkOverflow()
}

watch(
  [displayedFirst, displayedSecond, () => state.value.translation, lyricFontSize],
  () => void checkOverflow()
)
onMounted(() => {
  window.api.desktopLyrics.ready()
  window.api.desktopLyrics.setLocked(true)
  window.addEventListener('resize', handleResize)
  // Draggable Electron regions do not consistently bubble pointer-enter to
  // Vue. A window-level listener still receives the forwarded moves.
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseleave', leave)
  scheduleHide()
  syncSweepAnimation()
})
onUnmounted(() => {
  removeUpdate()
  removeBounds()
  window.api.desktopLyrics.setLocked(false)
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('mousemove', move)
  window.removeEventListener('mouseleave', leave)
  if (hideTimer) clearTimeout(hideTimer)
  if (sweepAnimationFrame !== undefined) cancelAnimationFrame(sweepAnimationFrame)
})
</script>

<template>
  <main
    class="desktop-lyrics relative h-screen select-none p-2"
    :class="locked ? '[-webkit-app-region:no-drag]' : '[-webkit-app-region:drag]'"
    @pointerenter="enter"
    @pointerleave="leave"
  >
    <div
      v-if="!locked && !hovering"
      class="absolute inset-0 z-10 [-webkit-app-region:no-drag]"
      @mouseenter="enter"
      @mousemove="enter"
    />
    <div
      class="flex h-full flex-col rounded-2xl px-6 py-3 transition-colors duration-[var(--motion-duration-theme)]"
      :class="backgroundVisible ? 'bg-black/30 backdrop-blur-sm' : 'bg-transparent'"
    >
      <div
        class="mb-1 flex h-[1.65rem] shrink-0 items-center justify-center gap-2 transition-opacity duration-[var(--motion-duration-standard)] [-webkit-app-region:no-drag]"
        :class="hovering || locked ? 'opacity-100' : 'pointer-events-none opacity-0'"
      >
        <button ref="lockButton" class="desktop-action" @click="toggleLock">
          <SvgIcon :name="locked ? 'play-lock-w' : 'play-unlock-w'" class-name="size-4" />
        </button>
        <template v-if="!locked"
          ><button class="desktop-action" @click="action('previous')">
            <SvgIcon name="play-prev" class-name="size-3.5" /></button
          ><button class="desktop-action" @click="action('toggle')">
            <SvgIcon
              :name="state.isPlaying ? 'play-pause' : 'play-play'"
              class-name="size-4"
            /></button
          ><button class="desktop-action" @click="action('next')">
            <SvgIcon name="play-next" class-name="size-3.5" /></button
        ></template>
        <button v-if="!locked" class="desktop-action" @click="closeWindow">
          <SvgIcon name="common-close" class-name="size-3.5" />
        </button>
      </div>
      <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 text-center">
        <div ref="currentBox" class="marquee-box">
          <p
            ref="currentText"
            class="marquee-text"
            :class="currentOverflows && 'marquee-text--scroll'"
            :style="lineStyle('first')"
          >
            {{ displayedFirst }}
          </p>
        </div>
        <div ref="secondBox" class="marquee-box">
          <p
            ref="secondText"
            class="marquee-text"
            :class="secondOverflows && 'marquee-text--scroll'"
            :style="state.translation ? inactiveStyle : lineStyle('second')"
          >
            {{ state.translation || displayedSecond }}
          </p>
        </div>
      </div>
    </div>
  </main>
</template>

<style>
html,
body,
#app {
  background: transparent !important;
}
</style>
<style scoped>
.desktop-lyrics {
  color: white;
  background: transparent;
  overflow: hidden;
}
.desktop-action {
  display: grid;
  place-items: center;
  width: 1.65rem;
  height: 1.65rem;
  border-radius: 9999px;
  color: white;
  background: rgb(0 0 0 / 24%);
}
.desktop-action:hover {
  background: rgb(0 0 0 / 48%);
}
.marquee-box {
  width: 100%;
  overflow: hidden;
}
.marquee-text {
  display: inline-block;
  max-width: none;
  padding-block: 0.08em;
  white-space: nowrap;
}
.marquee-text--scroll {
  padding-right: 4rem;
  animation: lyric-marquee 8s linear infinite;
}
@keyframes lyric-marquee {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(var(--marquee-distance));
  }
}
</style>
