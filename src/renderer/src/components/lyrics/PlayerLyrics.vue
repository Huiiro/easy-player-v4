<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { LyricChar, LyricLine, LyricSource, resolveLyrics } from '@/services/lyrics'
import { useUIStore } from '@/stores/ui/uiStore'
import { gsap } from 'gsap'

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
    forcedSource?: LyricSource | 'auto'
    autoSearchNetwork?: boolean
    reloadToken?: number
    layoutToken?: number
    alignMode?: 'left' | 'center' | 'right'
    allowTransform?: boolean
  }>(),
  {
    alignMode: 'left',
    allowTransform: true,
    forcedSource: 'auto',
    autoSearchNetwork: true,
    reloadToken: 0,
    layoutToken: 0
  }
)
const emit = defineEmits<{ seek: [positionMs: number] }>()

const ui = useUIStore()
const lyrics = ref<LyricLine[]>([])
const source = ref<LyricSource | null>(null)
const viewportRef = ref<HTMLElement>()
const lineRefs = ref<HTMLElement[]>([])
const isUserScrolling = ref(false)
const isAutoScrolling = ref(false)
const enableAutoScroll = computed(() => {
  return !isUserScrolling.value
})
let scrollTimer: ReturnType<typeof setTimeout> | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let snapTimer: ReturnType<typeof setTimeout> | null = null
let autoScrollTimer: ReturnType<typeof setTimeout> | null = null
let snapRaf = 0
let lyricLoadId = 0
let isUnmounted = false
const currentIndex = ref(0)
const velocity = ref(12)
const lineProgress = ref(0)
const FPS = 48
const FRAME_TIME = 1000 / FPS
let smoothTime = 0
let raf = 0
let lastTick = 0
const frame = ref(0)
const currentScrollTop = ref(0)
const scrollVelocity = ref(0)
let lastScrollTop = 0
let lastTime = performance.now()

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
  lyrics.value = []
  source.value = null
  lineRefs.value = []
  const song = props.song
  if (!song) return
  const result = await resolveLyrics(
    song,
    props.sourceOrder,
    props.forcedSource,
    props.autoSearchNetwork
  )
  if (isUnmounted || loadId !== lyricLoadId) return
  lyrics.value = result.lines
  source.value = result.source
}

const setLineRef = (el: Element | null, idx: number): void => {
  if (!el) return
  lineRefs.value[idx] = el as HTMLElement
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

/**
 * 自动定位到当前歌词
 */
const snapToCurrent = (): void => {
  const viewport = viewportRef.value
  const el = lineRefs.value[currentIndex.value]
  if (!viewport || !el) return

  isAutoScrolling.value = true

  const center = viewport.clientHeight / 2
  const target = el.offsetTop - center + el.offsetHeight / 2

  gsap.to(viewport, {
    scrollTop: target,
    duration: 0.85,
    ease: 'power4.out',
    overwrite: true
  })
  if (autoScrollTimer) clearTimeout(autoScrollTimer)
  autoScrollTimer = setTimeout(() => {
    isAutoScrolling.value = false
    autoScrollTimer = null
  }, 1000)
}

/**
 * 用户滚动
 */
const handleScroll = (): void => {
  const viewport = viewportRef.value
  if (!viewport) return
  if (isAutoScrolling.value) return

  isUserScrolling.value = true
  if (scrollTimer) clearTimeout(scrollTimer)
  scrollTimer = window.setTimeout(() => {
    scrollTimer = null
    isUserScrolling.value = false
    requestSnapToCurrent()
  }, 1500)
}

const handleScrollVelocity = (): void => {
  const viewport = viewportRef.value
  if (!viewport) return

  const now = performance.now()
  const dt = now - lastTime
  const st = viewport.scrollTop
  const delta = st - lastScrollTop
  scrollVelocity.value = delta / Math.max(dt, 1)
  currentScrollTop.value = st
  lastScrollTop = st
  lastTime = now
}

const update = (now: number): void => {
  raf = requestAnimationFrame(update)
  if (now - lastTick < FRAME_TIME) return
  lastTick = now

  const real = props.currentTime
  smoothTime += (real - smoothTime) * 0.25
  frame.value = now

  const idx = findCurrentLineIndex(lyrics.value, smoothTime)
  currentIndex.value = idx

  const line = lyrics.value[idx]
  if (!line) return

  const next = lyrics.value[idx + 1]
  const duration = next ? next.timeMs - line.timeMs : 5
  const p = (smoothTime - line.timeMs) / duration
  lineProgress.value = Math.max(0, Math.min(p, 1))
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const getLineStyle = (idx: number) => {
  const distance = idx - currentIndex.value
  const directionFactor = distance < 0 ? 0.35 : 1.65
  const abs = Math.abs(distance)
  const centerBias = 1 - Math.min(abs * 0.15, 0.8)
  const lagStrength = Math.min(Math.pow(abs, 1.35) * 1.95, 28) * directionFactor
  const lagY = scrollVelocity.value * lagStrength * 16 * centerBias
  const scale = Math.max(1 - abs * 0.02, 0.65)
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
      transform: `translateY(${lagY}px) scale(1.06)`,
      filter: 'blur(0px)',
      opacity: 1,
      zIndex: 10
    }
  }

  return {
    transform: props.allowTransform ? `translateY(${lagY}px) scale(${scale})` : `none`,
    filter: `blur(${blur}px)`,
    opacity
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const getNormalCharStyle = (idx: number, total: number) => {
  const progress = lineProgress.value * total - idx
  const fill = Math.max(0, Math.min(progress, 1))
  return {
    '--fill': `${fill * 100}%`
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const getCharStyle = (char: LyricChar) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  frame.value
  const progress = (smoothTime - char.start) / char.duration
  const clamp = Math.max(0, Math.min(progress, 1))
  const durationMs = (char.duration + 0.2) * 1000
  const translateY = -(clamp * 2)
  const fillProgress = clamp * 100
  return {
    '--fill-progress': `${fillProgress}%`,
    '--translate-y': `${translateY}px`,
    '--scale': 0.98 + clamp * 0.05,
    '--opacity': 0.25 + clamp * 0.75,
    '--duration': `${durationMs}ms`
  }
}

const onClickLyric = (line: number): void => {
  if (line == null) return
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    emit('seek', line)
  }, 60)
}

watch(
  () => [
    props.song?.id,
    props.sourceOrder.join('|'),
    props.forcedSource,
    props.autoSearchNetwork,
    props.reloadToken
  ],
  () => void load(),
  { immediate: true }
)

watch(
  currentIndex,
  (newIndex, oldIndex) => {
    const distance = Math.abs(newIndex - oldIndex)
    velocity.value = Math.min(10 + distance * 5, 40)
    if (enableAutoScroll.value) {
      snapToCurrent()
    }
  },
  {
    immediate: true
  }
)

watch(
  [() => lyrics, () => source],
  () => {
    snapToCurrent()
  },
  {
    deep: true
  }
)

watch([() => ui.lyricsFontSize, () => ui.lyricsFontPadding, () => ui.showLyricsTranslation], () => {
  scheduleSnapToCurrent()
})

watch(
  () => props.alignMode,
  () => scheduleSnapToCurrent()
)
watch(
  () => props.layoutToken,
  () => scheduleSnapToCurrent()
)

onMounted(() => {
  snapToCurrent()
  const viewport = viewportRef.value
  viewport?.addEventListener('scroll', handleScroll, {
    passive: true
  })
  window.addEventListener('resize', snapToCurrent)
  raf = requestAnimationFrame(update)
})

onUnmounted(() => {
  isUnmounted = true
  lyricLoadId += 1
  const viewport = viewportRef.value
  viewport?.removeEventListener('scroll', handleScroll)
  window.removeEventListener('resize', snapToCurrent)
  cancelAnimationFrame(raf)
  if (snapRaf) cancelAnimationFrame(snapRaf)
  if (scrollTimer) clearTimeout(scrollTimer)
  if (debounceTimer) clearTimeout(debounceTimer)
  if (snapTimer) clearTimeout(snapTimer)
  if (autoScrollTimer) clearTimeout(autoScrollTimer)
  if (viewport) gsap.killTweensOf(viewport)
  lineRefs.value = []
})
</script>

<template>
  <div ref="viewportRef" class="lyric-viewport" @scroll="handleScrollVelocity">
    <div class="lyric-track">
      <div
        v-for="(line, idx) in lyrics"
        :key="idx"
        :ref="(el) => setLineRef(el as Element, idx)"
        class="lyric-line group hover:bg-white/2"
        :style="getLineStyle(idx)"
      >
        <!-- 主歌词 -->
        <div class="lyric-main" :style="{ textAlign: alignMode }">
          <div v-if="currentIndex == idx">
            <!-- 逐字歌词 -->
            <template v-if="line.chars?.length">
              <span
                v-for="(char, charIdx) in line.chars"
                :key="charIdx"
                class="lyric-karaoke-char"
                :style="getCharStyle(char)"
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
                :style="
                  ui.lyricsStyle == 'follow'
                    ? getNormalCharStyle(charIdx, line.text.length)
                    : `color: var(--lrc-highlight)`
                "
              >
                {{ char }}
              </span>
            </template>
          </div>
          <div v-else>
            {{ line.text }}
          </div>
          <!-- 翻译 -->
          <div v-if="ui.showLyricsTranslation && line.translation" class="lyric-translation">
            {{ line.translation }}
          </div>
        </div>
        <!-- 右侧固定操作按钮轨道 -->
        <div
          class="absolute left-16 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-all duration-200"
        >
          <button
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
  box-sizing: border-box;
  overflow: auto;
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
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  will-change: transform;
  padding: 60vh 0;
}

.lyric-line {
  min-height: calc(var(--lrc-size) * 2.8);
  display: flex;
  flex-direction: column;
  justify-content: center;
  position: relative;
  padding: var(--lrc-padding) 40px;
  transition:
    transform 700ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 350ms ease,
    filter 400ms ease;
  will-change: transform;
  transform-origin: center center;
}

.lyric-main {
  padding: 0 calc(var(--lrc-padding) + 40px);
  color: var(--lrc-default);
  font-size: var(--lrc-size);
  line-height: var(--lrc-height);
  font-weight: 700;
}

.lyric-translation {
  margin-top: 10px;
  font-size: var(--lrc-translate-size);
  color: var(--lrc-translate);
}

.lyric-glow {
  color: var(--lrc-highlight);

  text-shadow:
    0 0 4px color-mix(in srgb, var(--lrc-highlight) 80%, transparent),
    0 0 4px color-mix(in srgb, var(--lrc-highlight) 60%, transparent),
    0 0 8px color-mix(in srgb, var(--lrc-highlight) 40%, transparent);
}

.lyric-char {
  display: inline-block;
  white-space: pre;
  color: transparent;
  background-image: linear-gradient(
    to right,
    var(--lrc-highlight) var(--fill),
    var(--lrc-default) var(--fill)
  );
  background-clip: text;
  -webkit-background-clip: text;
  will-change: background-image;
  transform: translateZ(0);
}

.lyric-karaoke-char {
  display: inline-block;
  white-space: pre;
  font-size: inherit;
  color: transparent;
  background-image:
    linear-gradient(to right, var(--lrc-highlight), var(--lrc-highlight)),
    linear-gradient(to right, var(--lrc-default), var(--lrc-default));
  background-size:
    var(--fill-progress) 100%,
    100% 100%;
  background-position: left center;
  background-repeat: no-repeat;
  background-clip: text;
  -webkit-background-clip: text;
  transform: translateY(var(--translate-y)) scale(var(--scale));
  opacity: var(--opacity);
  transition:
    background-size 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    opacity 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  will-change: background-size, transform, opacity;
  transform-origin: center bottom;
  scale: 1.06;
  letter-spacing: 3px;
}
</style>
