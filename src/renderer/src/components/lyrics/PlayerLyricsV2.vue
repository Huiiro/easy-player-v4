<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { LyricLine, LyricSource, resolveLyrics } from '@/services/lyrics'
import { useUIStore } from '@/stores/ui/uiStore'
import { LyricSpring } from './lyricSpring'
import { LyricClock } from './lyricClock'
import { withLyricInterludes } from './lyricInterlude'

const props = withDefaults(
  defineProps<{
    song: {
      id: number
      audio: string
      title?: string
      artist?: string | null
      album?: string | null
    } | null
    sourceOrder: LyricSource[]
    currentTime: number
    isPlaying?: boolean
    forcedSource?: LyricSource | 'auto'
    autoSearchNetwork?: boolean
    reloadToken?: number
    layoutToken?: number
    alignMode?: 'left' | 'center' | 'right'
    allowTransform?: boolean
    darkText?: boolean
  }>(),
  {
    alignMode: 'left',
    allowTransform: true,
    forcedSource: 'auto',
    autoSearchNetwork: true,
    reloadToken: 0,
    layoutToken: 0,
    darkText: false,
    isPlaying: false
  }
)
const emit = defineEmits<{ seek: [positionMs: number] }>()

const ui = useUIStore()
const lyrics = shallowRef<LyricLine[]>([])
const source = ref<LyricSource | null>(null)
const viewportRef = ref<HTMLElement>()
const lineRefs = ref<HTMLElement[]>([])
const isUserScrolling = ref(false)
const scrollSpring = new LyricSpring()
let rowSprings: LyricSpring[] = []
let rowStartTimes: number[] = []
let rowTarget = Number.NaN
let rowFocus = -1
let motionRaf = 0
let motionTime = 0
let expectedScroll = 0
let resizeObserver: ResizeObserver | undefined
const trackRef = ref<HTMLElement>()
const enableAutoScroll = computed(() => {
  return !isUserScrolling.value
})
let scrollTimer: ReturnType<typeof setTimeout> | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let snapTimer: ReturnType<typeof setTimeout> | null = null
let snapRaf = 0
let lyricLoadId = 0
let isUnmounted = false
const currentIndex = ref(0)
const hasUntimedLyrics = computed(
  () => lyrics.value.length > 0 && lyrics.value.every((line) => line.untimed)
)
const clock = new LyricClock()
let sweepRaf = 0
interface SweepElement {
  element: HTMLElement
  width: number
  start?: number
  duration: number
  emphasisStart?: number
  emphasisDuration: number
  settleDuration: number
  previous: number
  previousEmphasis: number
  previousLift: number
}
const MAX_CHARACTER_BLEND_MS = 120
const MAX_BLENDABLE_GAP_MS = 80
const MIN_CHARACTER_OVERLAP_MS = 40
const DISTRIBUTED_CHARACTER_SPAN = 1.65
let sweepElements: SweepElement[] = []
let interludeElement: HTMLElement | null = null
const MIN_PLAYER_WIDTH = 1280
const MIN_PLAYER_HEIGHT = 780
const MIN_LYRICS_FONT_SIZE = 2.4
const MAX_LYRICS_FONT_SIZE = 4.8
const LYRICS_FONT_SIZE_STEP = 0.24
const MIN_LYRICS_PADDING = 30
const MAX_LYRICS_PADDING = 78
const LYRICS_PADDING_STEP = 3

function getWindowSizeProgress(current: number, minimum: number, maximum: number): number {
  if (maximum <= minimum) return 1
  const range = maximum - minimum
  return Math.max(0, Math.min(1, (current - minimum) / range))
}

function updateAutomaticLyricsMetrics(): void {
  if (!ui.autoAdjustLyricsDisplay) return
  const widthProgress = getWindowSizeProgress(
    window.outerWidth,
    MIN_PLAYER_WIDTH,
    window.screen.availWidth
  )
  const heightProgress = getWindowSizeProgress(
    window.outerHeight,
    MIN_PLAYER_HEIGHT,
    window.screen.availHeight
  )
  const progress = Math.min(widthProgress, heightProgress)
  const fontSteps = Math.round(
    ((MAX_LYRICS_FONT_SIZE - MIN_LYRICS_FONT_SIZE) / LYRICS_FONT_SIZE_STEP) * progress
  )
  const paddingSteps = Math.round(
    ((MAX_LYRICS_PADDING - MIN_LYRICS_PADDING) / LYRICS_PADDING_STEP) * progress
  )
  ui.setLyricsFontSize(MIN_LYRICS_FONT_SIZE + fontSteps * LYRICS_FONT_SIZE_STEP)
  ui.setLyricsFontPadding(MIN_LYRICS_PADDING + paddingSteps * LYRICS_PADDING_STEP)
}

function handleWindowResize(): void {
  updateAutomaticLyricsMetrics()
  requestSnapToCurrent()
}

function findCurrentLineIndex(lyrics: LyricLine[], currentTime: number): number {
  for (let i = lyrics.length - 1; i >= 0; i--) {
    if (currentTime >= lyrics[i].timeMs) {
      return i
    }
  }
  return 0
}

async function load(): Promise<void> {
  const loadId = ++lyricLoadId
  stopMotion()
  cancelAnimationFrame(sweepRaf)
  sweepRaf = 0
  sweepElements = []
  writeScroll(0)
  if (scrollTimer) clearTimeout(scrollTimer)
  if (debounceTimer) clearTimeout(debounceTimer)
  isUserScrolling.value = false
  currentIndex.value = 0
  rowSprings = []
  rowTarget = Number.NaN
  lyrics.value = []
  source.value = null
  lineRefs.value = []
  const song = props.song
  if (!song) return
  let result: Awaited<ReturnType<typeof resolveLyrics>>
  try {
    result = await resolveLyrics(
      song,
      props.sourceOrder,
      props.forcedSource,
      props.autoSearchNetwork
    )
  } catch (error) {
    if (!isUnmounted && loadId === lyricLoadId) console.warn('Unable to load lyrics', error)
    return
  }
  if (isUnmounted || loadId !== lyricLoadId) return
  lyrics.value = withLyricInterludes(result.lines)
  source.value = result.source
}

const scheduleSnapToCurrent = (): void => {
  if (snapTimer) clearTimeout(snapTimer)
  snapTimer = setTimeout(() => {
    snapTimer = null
    requestSnapToCurrent()
  }, 120)
}

const requestSnapToCurrent = (): void => {
  if (snapRaf) cancelAnimationFrame(snapRaf)
  snapRaf = requestAnimationFrame(() => {
    snapRaf = 0
    if (!isUnmounted) snapToCurrent()
  })
}

// AMLL-inspired separation of layout targets, per-line springs and manual scrolling.
// Native scrolling retains keyboard/touch support; row offsets provide the trailing wave.
function stopMotion(): void {
  cancelAnimationFrame(motionRaf)
  motionRaf = 0
}

function writeScroll(value: number): void {
  const viewport = viewportRef.value
  if (!viewport) return
  viewport.scrollTop = value
  expectedScroll = viewport.scrollTop
}

function animateScroll(now: number): void {
  const viewport = viewportRef.value
  if (!viewport) return
  const dt = (now - motionTime) / 1000
  motionTime = now
  let moving = scrollSpring.step(dt, 9)
  writeScroll(scrollSpring.position)
  const scrollTop = expectedScroll
  rowSprings.forEach((spring, idx) => {
    const distance = Math.max(0, idx - currentIndex.value)
    const frequency = Math.max(6.5, 10 - distance * 0.5)
    if (now < (rowStartTimes[idx] ?? 0)) {
      spring.step(dt, frequency, 0.82)
      moving = true
    } else {
      spring.target = rowTarget
      moving = spring.step(dt, frequency, 0.82) || moving
    }
    const element = lineRefs.value[idx]
    if (element) element.style.setProperty('--scroll-y', `${scrollTop - spring.position}px`)
  })
  motionRaf = moving ? requestAnimationFrame(animateScroll) : 0
}

const snapToCurrent = (): void => {
  const viewport = viewportRef.value
  const el = lineRefs.value[currentIndex.value]
  if (!viewport || viewport.clientHeight === 0) return
  const anchor = viewport.clientHeight * (hasUntimedLyrics.value ? 0.5 : 0.25)
  viewport.style.setProperty('--viewport-padding-top', `${anchor}px`)
  viewport.style.setProperty('--viewport-padding-bottom', `${viewport.clientHeight - anchor}px`)
  if (!el || isUserScrolling.value || hasUntimedLyrics.value) return
  const target = Math.max(
    0,
    Math.min(
      el.offsetTop - anchor + el.offsetHeight / 2,
      viewport.scrollHeight - viewport.clientHeight
    )
  )
  if (ui.reduceMotion || !props.allowTransform) {
    stopMotion()
    writeScroll(target)
    scrollSpring.reset(target)
    rowSprings = lineRefs.value.map((element) => {
      element.style.setProperty('--scroll-y', '0px')
      return new LyricSpring(target)
    })
    return
  }
  if (!motionRaf) scrollSpring.reset(viewport.scrollTop)
  if (rowSprings.length !== lineRefs.value.length) {
    rowSprings = lineRefs.value.map(() => new LyricSpring(viewport.scrollTop))
  }
  scrollSpring.target = target
  if (
    Math.abs(rowTarget - target) > 0.5 ||
    !Number.isFinite(rowTarget) ||
    rowFocus !== currentIndex.value
  ) {
    rowTarget = target
    rowFocus = currentIndex.value
    const now = performance.now()
    rowStartTimes = rowSprings.map(
      (_spring, idx) => now + Math.min(260, Math.max(0, idx - rowFocus) * 60)
    )
  }
  if (!motionRaf) {
    motionTime = performance.now()
    motionRaf = requestAnimationFrame(animateScroll)
  }
}

const handleInteraction = (): void => {
  if (hasUntimedLyrics.value) return
  stopMotion()
  isUserScrolling.value = true
  // Clear only the small per-line trailing displacement when native input takes over.
  lineRefs.value.forEach((element) => element.style.setProperty('--scroll-y', '0px'))
  rowSprings = []
  if (scrollTimer) clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => {
    scrollTimer = null
    isUserScrolling.value = false
    requestSnapToCurrent()
  }, 1500)
}

const handleScroll = (): void => {
  const viewport = viewportRef.value
  // Wheel/touch/keyboard handlers interrupt explicitly; browser clamping during
  // our own animation must not cancel every line spring.
  if (!viewport || motionRaf || Math.abs(viewport.scrollTop - expectedScroll) < 1) return
  handleInteraction()
  expectedScroll = viewport.scrollTop
}

function handleKeydown(event: KeyboardEvent): void {
  if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
    handleInteraction()
  }
}

function paintSweep(now: number): void {
  const time = clock.read(now)
  const line = lyrics.value[currentIndex.value]
  if (!line || line.untimed) return
  const next = lyrics.value[currentIndex.value + 1]
  const duration = Math.max(1, (line.endMs ?? next?.timeMs ?? line.timeMs + 5000) - line.timeMs)
  const lineFill = Math.max(0, Math.min(1, (time - line.timeMs) / duration))
  if (interludeElement) {
    const exit = Math.max(0, Math.min(1, (line.timeMs + duration - time) / 400))
    interludeElement.style.setProperty('--interlude-exit', String(exit))
    sweepElements.forEach(({ element }, index) => {
      const progress = Math.max(0, Math.min(1, lineFill * 3 - index))
      const pulse =
        ui.reduceMotion || !props.allowTransform
          ? 0
          : Math.sin((time - line.timeMs) / 280 - index * 0.8) * 0.07
      element.style.opacity = String(0.3 + progress * 0.7)
      element.style.transform = `scale(${0.75 + progress * 0.25 + pulse})`
    })
    return
  }
  const hasTimedCharacters = sweepElements.some((entry) => entry.start !== undefined)
  let waveCenter = hasTimedCharacters ? -1 : lineFill * sweepElements.length - 1
  if (hasTimedCharacters) {
    for (let index = 0; index < sweepElements.length; index += 1) {
      const entry = sweepElements[index]
      if (entry.start === undefined || time < entry.start) break
      const characterProgress = Math.max(0, Math.min(1, (time - entry.start) / entry.duration))
      waveCenter = index - 1 + characterProgress
      if (characterProgress < 1) break
    }
  }
  sweepElements.forEach((entry, index) => {
    const distributedEmphasisProgress =
      (lineFill *
        Math.max(
          DISTRIBUTED_CHARACTER_SPAN,
          sweepElements.length - 1 + DISTRIBUTED_CHARACTER_SPAN
        ) -
        index) /
      DISTRIBUTED_CHARACTER_SPAN
    const progress =
      entry.start !== undefined
        ? Math.max(0, Math.min(1, (time - entry.start) / entry.duration))
        : Math.max(0, Math.min(1, lineFill * sweepElements.length - index))
    const emphasisProgress =
      entry.emphasisStart !== undefined
        ? Math.max(0, Math.min(1, (time - entry.emphasisStart) / entry.emphasisDuration))
        : Math.max(0, Math.min(1, distributedEmphasisProgress))
    if (entry.start === undefined && ui.lyricsStyle !== 'follow') return
    let leadProgress = progress
    let highlightProgress = progress
    // Precisely timed lyrics use a two-stage sweep. The leading color lifts
    // the glyph group first, then the final highlight catches up.
    let emphasis: number
    if (entry.start !== undefined) {
      const riseDuration = Math.max(1, entry.emphasisDuration - entry.settleDuration)
      leadProgress = Math.max(
        0,
        Math.min(1, (time - (entry.emphasisStart ?? entry.start)) / riseDuration)
      )
      highlightProgress = progress
      emphasis = leadProgress
    } else {
      emphasis = emphasisProgress + 2.2 * emphasisProgress ** 3 * (1 - emphasisProgress)
    }
    // One asymmetric Dock-like wave affects several neighboring glyphs. Its
    // narrow leading edge rises quickly, while the wider trailing edge lets
    // highlighted glyphs settle slowly as one coherent group.
    const distanceFromWave = index - waveCenter
    const waveWidth = distanceFromWave < 0 ? 1.9 : 0.82
    const lift =
      distanceFromWave < -5 || distanceFromWave > 3
        ? 0
        : Math.exp(-0.5 * (distanceFromWave / waveWidth) ** 2)
    if (
      entry.previous === progress &&
      entry.previousEmphasis === emphasisProgress &&
      entry.previousLift === lift
    )
      return
    entry.previous = progress
    entry.previousEmphasis = emphasisProgress
    entry.previousLift = lift
    const edgeEnvelope = Math.max(
      0,
      Math.min(1, highlightProgress / 0.18, (1 - highlightProgress) / 0.18)
    )
    const edgeWidth = Math.min(entry.width, Math.max(6, entry.width * 0.34)) * edgeEnvelope
    const sweepPosition = highlightProgress * entry.width
    const seamOverlap = edgeWidth > 0 ? 1.5 : 0
    entry.element.style.setProperty('--progress', String(highlightProgress))
    entry.element.style.setProperty(
      '--fill-size',
      `${Math.min(entry.width, Math.max(0, sweepPosition - edgeWidth / 2 + seamOverlap))}px`
    )
    entry.element.style.setProperty('--edge-size', `${edgeWidth}px`)
    entry.element.style.setProperty('--edge-position', `${sweepPosition - edgeWidth / 2}px`)
    entry.element.style.setProperty('--emphasis', String(emphasis))
    entry.element.style.setProperty('--lift', String(lift))
  })
}

function animateSweep(now: number): void {
  const index = hasUntimedLyrics.value ? 0 : findCurrentLineIndex(lyrics.value, clock.read(now))
  if (index !== currentIndex.value) {
    currentIndex.value = index
    // The active character DOM changes after Vue commits; refreshSweepElements
    // paints that DOM in nextTick using the same clock, including the last word.
  } else {
    paintSweep(now)
  }
  sweepRaf = clock.isMoving(now) ? requestAnimationFrame(animateSweep) : 0
}

function refreshSweepElements(): void {
  const line = lineRefs.value[currentIndex.value]
  interludeElement = line?.querySelector<HTMLElement>('.lyric-interlude') ?? null
  const elements = Array.from(
    line?.querySelectorAll<HTMLElement>('.lyric-karaoke-char, .lyric-char, .interlude-dot') ?? []
  )
  sweepElements = elements.map((element, index) => {
    const start = element.dataset.start === undefined ? undefined : Number(element.dataset.start)
    const sourceDuration = Math.max(1, Number(element.dataset.duration) || 1)
    const previous = elements[index - 1]
    const previousStart = Number(previous?.dataset.start)
    const previousDuration = Math.max(1, Number(previous?.dataset.duration) || 1)
    const gap =
      start === undefined || !Number.isFinite(previousStart)
        ? Number.POSITIVE_INFINITY
        : start - (previousStart + previousDuration)
    // Run adjacent glyphs as a continuous wave instead of isolated pops. A
    // following glyph becomes visible while its predecessor is still settling;
    // explicit pauses in the timed source remain untouched.
    const blend =
      index > 0 && start !== undefined && gap <= MAX_BLENDABLE_GAP_MS
        ? Math.min(
            MAX_CHARACTER_BLEND_MS,
            Math.max(sourceDuration * 0.55, gap + MIN_CHARACTER_OVERLAP_MS)
          )
        : 0
    const settleDuration =
      start === undefined ? 0 : Math.min(280, Math.max(160, sourceDuration * 1.2))
    return {
      element,
      width: element.offsetWidth,
      start,
      duration: sourceDuration,
      emphasisStart: start === undefined ? undefined : start - blend,
      emphasisDuration: sourceDuration + blend + settleDuration,
      settleDuration,
      previous: -1,
      previousEmphasis: -1,
      previousLift: -1
    }
  })
  paintSweep(performance.now())
}

const updatePlayback = (): void => {
  const time = Number.isFinite(props.currentTime) ? props.currentTime : 0
  clock.sample(time, performance.now(), props.isPlaying)
  if (!sweepRaf) sweepRaf = requestAnimationFrame(animateSweep)
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const getLineStyle = (idx: number) => {
  if (lyrics.value[idx]?.untimed) {
    return {
      transform: 'none',
      filter: 'none',
      opacity: 1
    }
  }
  const distance = idx - currentIndex.value
  const abs = Math.abs(distance)
  const blur = Math.min(abs * 1.2, 6)
  const opacity = 1 - Math.min(abs * 0.22, 0.75)

  if (isUserScrolling.value) {
    return {
      transform: 'none',
      filter: 'none',
      opacity: idx === currentIndex.value ? 1 : 0.6
    }
  }
  if (idx === currentIndex.value) {
    return {
      transform:
        props.allowTransform && !ui.reduceMotion ? 'translateY(var(--scroll-y, 0px))' : 'none',
      filter: 'blur(0px)',
      opacity: 1,
      zIndex: 10
    }
  }

  return {
    transform:
      props.allowTransform && !ui.reduceMotion ? 'translateY(var(--scroll-y, 0px))' : 'none',
    filter: `blur(${blur}px)`,
    opacity
  }
}

// Keep the styles for the
// complete lyric list stable between line/scroll changes so that update does
// not allocate a new object for every off-screen line on each render.
const lineStyles = computed(() => lyrics.value.map((_line, idx) => getLineStyle(idx)))

const onClickLyric = (line: number): void => {
  if (line == null) return
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    if (scrollTimer) clearTimeout(scrollTimer)
    isUserScrolling.value = false
    emit('seek', line)
    requestSnapToCurrent()
  }, 60)
}

watch(
  [
    () => props.song?.id,
    () => props.song?.audio,
    () => props.sourceOrder.join('|'),
    () => props.forcedSource,
    () => props.autoSearchNetwork,
    () => props.reloadToken
  ],
  () => void load(),
  { immediate: true }
)

watch(
  currentIndex,
  (index, oldIndex) => {
    const collapsedHeight =
      oldIndex !== undefined &&
      index > oldIndex &&
      !lyrics.value[oldIndex]?.untimed &&
      !lyrics.value[oldIndex]?.text.trim()
        ? (lineRefs.value[oldIndex]?.offsetHeight ?? 0)
        : 0
    void nextTick(() => {
      if (collapsedHeight > 0 && viewportRef.value) {
        stopMotion()
        writeScroll(Math.max(0, viewportRef.value.scrollTop - collapsedHeight))
        scrollSpring.reset(viewportRef.value.scrollTop)
        lineRefs.value.forEach((element) => element.style.setProperty('--scroll-y', '0px'))
        rowSprings = []
        rowTarget = Number.NaN
        rowFocus = -1
      }
      refreshSweepElements()
      if (enableAutoScroll.value) requestSnapToCurrent()
    })
  },
  {
    immediate: true
  }
)

watch(
  [lyrics, source],
  () => {
    updatePlayback()
    void nextTick(refreshSweepElements)
    requestSnapToCurrent()
  },
  { flush: 'post' }
)

watch(
  [
    () => ui.lyricsFontSize,
    () => ui.lyricsFontPadding,
    () => ui.showLyricsTranslation,
    () => ui.showLyricsRomanization
  ],
  () => {
    scheduleSnapToCurrent()
  }
)

watch(
  () => ui.autoAdjustLyricsDisplay,
  (enabled) => {
    if (enabled) updateAutomaticLyricsMetrics()
    scheduleSnapToCurrent()
  }
)

watch(
  () => props.alignMode,
  () => scheduleSnapToCurrent()
)
watch(
  () => props.layoutToken,
  () => scheduleSnapToCurrent()
)

watch(
  [
    () => ui.showLyricsRomanization,
    () => ui.lyricsStyle,
    () => ui.reduceMotion,
    () => props.allowTransform
  ],
  refreshSweepElements,
  { flush: 'post' }
)

watch([() => ui.reduceMotion, () => props.allowTransform], () => requestSnapToCurrent())
watch([() => props.currentTime, () => props.isPlaying], updatePlayback, { immediate: true })

onMounted(() => {
  updateAutomaticLyricsMetrics()
  snapToCurrent()
  const viewport = viewportRef.value
  viewport?.addEventListener('scroll', handleScroll, {
    passive: true
  })
  window.addEventListener('resize', handleWindowResize)
  resizeObserver = new ResizeObserver(() => requestSnapToCurrent())
  if (viewport) resizeObserver.observe(viewport)
  if (trackRef.value) resizeObserver.observe(trackRef.value)
})

onUnmounted(() => {
  isUnmounted = true
  lyricLoadId += 1
  const viewport = viewportRef.value
  viewport?.removeEventListener('scroll', handleScroll)
  window.removeEventListener('resize', handleWindowResize)
  if (snapRaf) cancelAnimationFrame(snapRaf)
  if (scrollTimer) clearTimeout(scrollTimer)
  if (debounceTimer) clearTimeout(debounceTimer)
  if (snapTimer) clearTimeout(snapTimer)
  stopMotion()
  cancelAnimationFrame(sweepRaf)
  sweepElements = []
  resizeObserver?.disconnect()
  lineRefs.value = []
})
</script>

<template>
  <div
    ref="viewportRef"
    class="lyric-viewport"
    :class="[
      props.darkText && 'player-lyrics--dark-text',
      ui.reduceMotion && 'reduce-motion',
      !props.allowTransform && 'no-transform'
    ]"
    tabindex="0"
    @wheel.passive="handleInteraction"
    @touchmove.passive="handleInteraction"
    @keydown="handleKeydown"
  >
    <div ref="trackRef" class="lyric-track">
      <div
        v-for="(line, idx) in lyrics"
        :key="idx"
        ref="lineRefs"
        v-memo="[
          line,
          lineStyles[idx],
          currentIndex === idx,
          ui.showLyricsTranslation,
          ui.showLyricsRomanization,
          ui.lyricsStyle,
          alignMode
        ]"
        class="lyric-line group hover:bg-white/2"
        :class="{
          'lyric-line--interlude': !line.untimed && !line.text.trim(),
          'lyric-line--pending-interlude':
            !line.untimed && !line.text.trim() && currentIndex !== idx
        }"
        :style="lineStyles[idx]"
      >
        <div
          v-if="!line.untimed && !line.text.trim()"
          class="lyric-interlude"
          :class="{ 'is-active': currentIndex === idx }"
          :style="{
            justifyContent:
              alignMode === 'left' ? 'flex-start' : alignMode === 'right' ? 'flex-end' : 'center'
          }"
          role="status"
          aria-label="间奏"
        >
          <span v-for="dot in 3" :key="dot" class="interlude-dot" aria-hidden="true" />
        </div>
        <!-- 主歌词 -->
        <div v-else class="lyric-main" :style="{ textAlign: alignMode }">
          <template v-if="ui.showLyricsRomanization && line.rubySegments?.length">
            <ruby
              v-for="(segment, segmentIndex) in line.rubySegments"
              :key="segmentIndex"
              class="lyric-ruby"
            >
              <template v-if="currentIndex == idx">
                <span
                  v-for="(char, charIdx) in segment.chars"
                  :key="charIdx"
                  class="lyric-karaoke-char"
                  :data-start="char.start"
                  :data-duration="char.duration"
                >
                  {{ char.char }}
                </span>
              </template>
              <span v-else>{{ segment.text }}</span>
              <rt>{{ segment.romanization }}</rt>
            </ruby>
          </template>
          <template v-else>
            <div v-if="line.untimed" class="lyric-plain">
              {{ line.text }}
            </div>
            <div v-else-if="currentIndex == idx">
              <!-- 逐字歌词 -->
              <template v-if="line.chars?.length">
                <span
                  v-for="(char, charIdx) in line.chars"
                  :key="charIdx"
                  class="lyric-karaoke-char"
                  :data-start="char.start"
                  :data-duration="char.duration"
                >
                  {{ char.char }}
                </span>
              </template>
              <!-- 普通歌词 -->
              <template v-else>
                <span
                  v-for="(char, charIdx) in line.text"
                  :key="charIdx"
                  :class="['lyric-char', ui.lyricsStyle == 'glow' ? 'lyric-glow' : '']"
                  :style="ui.lyricsStyle == 'follow' ? undefined : `color: var(--lrc-highlight)`"
                >
                  {{ char }}
                </span>
              </template>
            </div>
            <div v-else>
              {{ line.text }}
            </div>
          </template>
          <div
            v-if="ui.showLyricsRomanization && line.romanization && !line.rubySegments?.length"
            class="lyric-romanization"
          >
            {{ line.romanization }}
          </div>
          <!-- 翻译 -->
          <div v-if="ui.showLyricsTranslation && line.translation" class="lyric-translation">
            {{ line.translation }}
          </div>
        </div>
        <!-- 右侧固定操作按钮轨道 -->
        <div
          v-if="line.text.trim()"
          class="absolute left-16 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-all duration-200"
        >
          <button
            :disabled="line.untimed || !line.text.trim()"
            :aria-label="line.text"
            class="flex text-xs bg-white/5 hover:bg-white/10 px-2 py-1 rounded backdrop-blur"
            @click.stop="onClickLyric(line.timeMs)"
          >
            ▶
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lyric-viewport {
  position: relative;
  min-height: 0;
  min-width: 0;
  overflow-anchor: none;
  box-sizing: border-box;
  overflow: auto;
  overflow-x: hidden;
  overflow-wrap: break-word;
  word-break: keep-all;
  word-wrap: break-word;
  scroll-behavior: auto;
  scrollbar-width: none;
  perspective: 1200px;
  height: 100%;
  user-select: none;
  mask-image: linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%);
}

.lyric-viewport::-webkit-scrollbar {
  display: none;
}

.lyric-track {
  /* Keep lyric length and viewport padding out of the parent's intrinsic size. */
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  padding-inline: 0;
  padding-top: var(--viewport-padding-top, 25vh);
  padding-bottom: var(--viewport-padding-bottom, 75vh);
}

.lyric-line {
  min-height: calc(var(--lrc-size) * 2.8);
  display: flex;
  flex-direction: column;
  justify-content: center;
  position: relative;
  padding: var(--lrc-padding) 40px;
  transition:
    opacity 350ms ease,
    filter 400ms ease;
  transform-origin: center center;
}

.lyric-line--interlude {
  max-height: calc(var(--lrc-size) * 2.8 + var(--lrc-padding) * 2);
  overflow: hidden;
}

.lyric-line--pending-interlude {
  min-height: 0;
  max-height: 0;
  padding-block: 0;
  opacity: 0 !important;
  pointer-events: none;
}

.reduce-motion .lyric-line,
.reduce-motion .lyric-karaoke-char {
  transition: none;
}

.lyric-main {
  padding: 0 calc(var(--lrc-padding) + 40px);
  color: var(--lrc-default);
  font-size: var(--lrc-size);
  line-height: var(--lrc-height);
  font-weight: 700;
}

.lyric-plain {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  word-break: break-word;
}

.lyric-translation {
  margin-top: 10px;
  font-size: var(--lrc-translate-size);
  color: var(--lrc-translate);
}

.lyric-romanization {
  margin-top: 0.3rem;
  color: color-mix(in srgb, var(--lrc-translate) 88%, var(--lrc-default));
  font-size: calc(var(--lrc-translate-size) * 0.92);
  letter-spacing: 0.025em;
}

.lyric-ruby {
  ruby-position: over;
  ruby-align: center;
  white-space: pre;
}

.lyric-ruby rt {
  color: color-mix(in srgb, var(--lrc-translate) 88%, var(--lrc-default));
  font-size: 0.42em;
  font-weight: 600;
  letter-spacing: 0.025em;
  user-select: text;
}

.lyric-glow {
  color: var(--lrc-highlight);

  text-shadow:
    0 0 4px color-mix(in srgb, var(--lrc-highlight) 80%, transparent),
    0 0 4px color-mix(in srgb, var(--lrc-highlight) 60%, transparent),
    0 0 8px color-mix(in srgb, var(--lrc-highlight) 40%, transparent);
}

.lyric-interlude {
  display: flex;
  align-items: center;
  gap: 0.38em;
  min-height: calc(var(--lrc-size) * 1.5);
  padding: 0 calc(var(--lrc-padding) + 40px);
  font-size: var(--lrc-size);
  opacity: 0.3;
}
.lyric-interlude.is-active {
  opacity: var(--interlude-exit, 1);
}
.interlude-dot {
  width: 0.32em;
  height: 0.32em;
  border-radius: 50%;
  background: var(--lrc-highlight);
  opacity: 0.3;
  will-change: transform, opacity;
}
.lyric-char,
.lyric-karaoke-char {
  display: inline-block;
  white-space: pre;
  color: transparent;
  background-image:
    linear-gradient(
      to right,
      var(--lrc-highlight) 0%,
      var(--lrc-highlight) 12%,
      color-mix(in srgb, var(--lrc-highlight) 72%, var(--lrc-default)) 38%,
      color-mix(in srgb, var(--lrc-highlight) 32%, var(--lrc-default)) 72%,
      var(--lrc-default) 100%
    ),
    linear-gradient(to right, var(--lrc-highlight), var(--lrc-highlight)),
    linear-gradient(to right, var(--lrc-default), var(--lrc-default));
  background-size:
    var(--edge-size, 0px) 100%,
    var(--fill-size, 0px) 100%,
    100% 100%;
  background-position:
    var(--edge-position, 0px) center,
    left center,
    left center;
  background-repeat: no-repeat;
  background-clip: text;
  -webkit-background-clip: text;
}
.lyric-karaoke-char {
  font-size: inherit;
  transform: translateY(calc(var(--lift, 0) * -4px)) scale(calc(1.03 + var(--lift, 0) * 0.08));
  opacity: clamp(0.25, calc(0.25 + var(--emphasis, 0) * 0.75), 1);
  transform-origin: center bottom;
  will-change: transform, opacity;
  scale: 1.06;
  letter-spacing: 3px;
}
.reduce-motion .lyric-karaoke-char,
.no-transform .lyric-karaoke-char {
  transform: none;
  scale: none;
}
</style>
