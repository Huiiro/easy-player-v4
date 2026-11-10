<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onErrorCaptured,
  onMounted,
  ref,
  useId,
  watch
} from 'vue'
import type { CSSProperties } from 'vue'
import type { BackgroundScene } from './backgroundScene'
import { customThemeBackgroundCSS } from '@/services/customTheme'

const props = defineProps<{
  scene: BackgroundScene
  paused: boolean
  reducedMotion: boolean
}>()
const emit = defineEmits<{ ready: []; failure: [kind: 'theme' | 'video'] }>()
const root = ref<HTMLElement>()
const video = ref<HTMLVideoElement>()
const styleId = useId()
const backgroundStyle = document.createElement('style')
watch(
  () => props.scene.theme,
  (theme) => {
    backgroundStyle.textContent = theme
      ? customThemeBackgroundCSS(theme, `[data-background-style="${styleId}"]`)
      : ''
  },
  { immediate: true }
)
const frozenBackground = ref<CSSProperties>()
const frozenSurface = ref<CSSProperties>()
const frozenScrim = ref<string>()
const images = new Set<HTMLImageElement>()
let disposed = false
let preparing = false
let signaled = false
let readyFrame = 0
let timeout: ReturnType<typeof setTimeout> | undefined

const rendererProps = computed(() =>
  props.scene.plugin
    ? { theme: props.scene.plugin, paused: props.paused || props.reducedMotion }
    : {
        primary: props.scene.primary,
        dark: props.scene.dark,
        active: !props.paused,
        reducedMotion: props.reducedMotion
      }
)

const surfaceStyle = computed<CSSProperties>(() => {
  const surface = props.scene.surface
  const style: CSSProperties = {
    backgroundColor: props.scene.base,
    backgroundImage: 'none',
    backgroundPosition: 'center',
    backgroundSize: 'cover',
    backgroundRepeat: 'no-repeat'
  }
  if (CSS.supports('color', surface)) {
    const context = document.createElement('canvas').getContext('2d')
    if (surface.startsWith('var(') || !context) return { ...style, backgroundColor: surface }
    context.fillStyle = surface
    context.fillRect(0, 0, 1, 1)
    if (context.getImageData(0, 0, 1, 1).data[3] === 255)
      return { ...style, backgroundColor: surface }
    // Compose translucent fills over an opaque target base before fading.
    style.backgroundImage = `linear-gradient(${surface}, ${surface})`
  } else style.backgroundImage = surface
  return style
})

function syncVideo(): void {
  if (!video.value) return
  if (props.paused || props.reducedMotion) video.value.pause()
  else void video.value.play().catch(() => undefined)
}
watch([video, () => props.paused, () => props.reducedMotion], syncVideo, { flush: 'post' })

async function markReady(): Promise<void> {
  if (disposed || preparing || signaled) return
  preparing = true
  await nextTick()
  const hosts = root.value?.querySelectorAll<HTMLElement>('.ep-app-background, .background-image')
  const urls = new Set<string>()
  for (const host of hosts ?? []) {
    for (const match of getComputedStyle(host).backgroundImage.matchAll(
      /url\(["']?([^"')]+)["']?\)/g
    ))
      urls.add(match[1])
  }
  await Promise.all(
    [...urls].map(async (src) => {
      const image = new Image()
      images.add(image)
      image.src = src
      await image.decode().catch(() => undefined)
      images.delete(image)
    })
  )
  if (disposed || signaled) return
  readyFrame = requestAnimationFrame(() => {
    readyFrame = requestAnimationFrame(() => {
      readyFrame = 0
      if (disposed || signaled) return
      signaled = true
      clearTimeout(timeout)
      emit('ready')
    })
  })
}

function fail(kind: 'theme' | 'video' = 'theme'): void {
  if (disposed) return
  emit('failure', kind)
  void markReady()
}
onErrorCaptured(() => {
  fail()
  return false
})

function readBackground(element: HTMLElement): CSSProperties {
  const style = getComputedStyle(element)
  return {
    backgroundColor: style.backgroundColor,
    backgroundImage: style.backgroundImage,
    backgroundSize: style.backgroundSize,
    backgroundPosition: style.backgroundPosition,
    backgroundRepeat: style.backgroundRepeat
  }
}
function freeze(): void {
  if (root.value) frozenSurface.value = readBackground(root.value)
  const host = root.value?.querySelector<HTMLElement>('.ep-app-background')
  if (host) frozenBackground.value = readBackground(host)
  const scrim = root.value?.querySelector<HTMLElement>('.app-background-scrim')
  if (scrim) frozenScrim.value = getComputedStyle(scrim).backgroundColor
}
function unfreeze(): void {
  frozenSurface.value = undefined
  frozenBackground.value = undefined
  frozenScrim.value = undefined
}
defineExpose({ freeze, unfreeze })

onMounted(() => {
  document.head.append(backgroundStyle)
  // A failed async module or media decode must not retain an outgoing GPU forever.
  timeout = setTimeout(() => {
    if (signaled || disposed) return
    signaled = true
    cancelAnimationFrame(readyFrame)
    emit('failure', props.scene.kind === 'video' ? 'video' : 'theme')
    emit('ready')
  }, 10000)
  if (props.scene.kind !== 'preset' && props.scene.kind !== 'video') void markReady()
  if (props.scene.kind === 'video' && !props.scene.mediaUrl) void markReady()
})
onBeforeUnmount(() => {
  backgroundStyle.remove()
  disposed = true
  clearTimeout(timeout)
  cancelAnimationFrame(readyFrame)
  for (const image of images) image.removeAttribute('src')
  images.clear()
})
</script>

<template>
  <div
    ref="root"
    class="app-background-stage"
    :class="scene.kind !== 'none' && 'app-background-layer'"
    :style="[surfaceStyle, frozenSurface, { '--ep-app-bg': 'var(--_app-background-paint)' }]"
    :data-background-key="scene.key"
    :data-background-style="styleId"
    aria-hidden="true"
  >
    <div
      v-if="scene.kind === 'theme'"
      class="ep-app-background background-content"
      :style="frozenBackground"
    />
    <div
      v-else-if="scene.kind === 'image'"
      class="background-image absolute -inset-6 bg-cover bg-center transition-[filter] duration-[var(--motion-duration-slow)] ease-[var(--motion-ease-standard)]"
      :style="scene.mediaStyle"
    />
    <div
      v-else-if="scene.kind === 'video'"
      class="custom-background-media transition-[filter] duration-[var(--motion-duration-slow)] ease-[var(--motion-ease-standard)]"
      :style="{ filter: scene.mediaFilter }"
    >
      <video
        v-if="scene.mediaUrl"
        ref="video"
        crossorigin="anonymous"
        :src="scene.mediaUrl"
        muted
        loop
        playsinline
        preload="auto"
        @loadeddata="markReady"
        @error="fail('video')"
      />
    </div>
    <div
      v-else-if="scene.kind === 'preset'"
      class="app-background-host"
      :class="paused && 'app-background-host--paused'"
    >
      <component
        :is="scene.component"
        v-bind="rendererProps"
        :style="frozenBackground"
        @ready="markReady"
        @failure="fail()"
      />
    </div>
    <div
      v-if="scene.scrim"
      class="app-background-scrim"
      :class="
        scene.kind === 'preset' ? 'app-background-scrim--system' : 'app-background-scrim--custom'
      "
      :style="{ background: frozenScrim ?? scene.scrim }"
    />
  </div>
</template>

<style scoped>
.app-background-stage,
.background-content,
.app-background-host,
.app-background-scrim {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}
.custom-background-media {
  position: absolute;
  inset: -24px;
  overflow: hidden;
}
.custom-background-media video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.app-background-host--paused :deep(*) {
  animation-play-state: paused !important;
}
</style>
