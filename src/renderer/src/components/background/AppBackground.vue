<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowReactive,
  shallowRef,
  watch
} from 'vue'
import { useI18n } from 'vue-i18n'
import { getSystemBackgroundTheme } from './systemBackgroundRegistry'
import { useUIStore } from '@/stores/ui/uiStore'
import { usePlayerStore } from '@/stores/player/playerStore'
import { solidBackgroundColor, SystemThemeColorAnalyzer } from './songThemeColors'
import { useMessage } from '@/components/ui/useMessage'
import BackgroundLayer from './BackgroundLayer.vue'
import { backgroundSceneKey, type BackgroundScene } from './backgroundScene'
import { backgroundAppearanceHandoff } from '@/services/appearanceController'

const emit = defineEmits<{ contrast: [dark: boolean] }>()
const ui = useUIStore()
const player = usePlayerStore()
const { t } = useI18n()
const { error: showError } = useMessage()
const background = computed(() => ui.resolvedAppearance.background)
const activeTheme = computed(() =>
  getSystemBackgroundTheme(background.value.type === 'preset' ? background.value.id : 'none')
)
const isSystemTheme = computed(() => background.value.type === 'preset')
const isBackgroundActive = ref(!document.hidden && document.hasFocus())
const isSolidTheme = computed(() => isSystemTheme.value && activeTheme.value.id === 'solid')
const needsSongColor = computed(() => isSolidTheme.value || ui.accentSource === 'song')

watch(
  () => [needsSongColor.value, player.currentQueueSong?.id, player.currentQueueSong?.cover],
  (_, __, onCleanup) => {
    const song = player.currentQueueSong
    if (!needsSongColor.value || !song?.cover) {
      ui.songThemeColor = null
      return
    }
    const cached = SystemThemeColorAnalyzer.getCachedSystemThemeColor(song.cover)
    if (cached) {
      ui.songThemeColor = `rgb(${cached})`
      return
    }
    // Sample a bounded thumbnail once per song, even when the player panel is closed.
    const image = new Image()
    let cancelled = false
    onCleanup(() => {
      cancelled = true
      image.onload = image.onerror = null
      image.removeAttribute('src')
    })
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      if (cancelled) return
      const color = SystemThemeColorAnalyzer.getSystemThemeColor(image, song.cover!)
      ui.songThemeColor = color ? `rgb(${color})` : null
    }
    image.onerror = () => {
      if (!cancelled) ui.songThemeColor = null
    }
    image.src = `easy-player-media://cover-thumb?path=${encodeURIComponent(song.cover)}&size=256`
  },
  { immediate: true }
)

interface LayerEntry {
  id: number
  scene: BackgroundScene
  opacity: number
  animated: boolean
  phase: 'current' | 'pending' | 'entering' | 'outgoing'
}
type LayerHandle = { freeze: () => void; unfreeze: () => void }
const layers = shallowRef<LayerEntry[]>([])
const handles = new Map<number, LayerHandle>()
const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
const systemReducedMotion = ref(motionQuery.matches)
const reducedMotion = computed(() => ui.reduceMotion || systemReducedMotion.value)
const globallyPaused = computed(() => !isBackgroundActive.value || ui.showPlayer)
let nextLayerId = 0
let current: LayerEntry | undefined
let pending: LayerEntry | undefined
let queued: BackgroundScene | undefined
let fading = false
let disposed = false
let fadeFrame = 0
let fadeTimeout: ReturnType<typeof setTimeout> | undefined
let viewTransition: ViewTransition | undefined

const scene = computed<BackgroundScene>(() => {
  const appearance = ui.resolvedAppearance
  const kind = appearance.nativeMaterialEnabled ? 'native' : appearance.background.type
  const plugin = activeTheme.value.pluginTheme
  const theme = ui.backgroundTheme
  const base =
    theme?.tokens['--color-bg'] ??
    appearance.backgroundSurface ??
    (appearance.dark ? 'var(--_theme-bg-dark)' : 'var(--_theme-bg-light)')
  const key = backgroundSceneKey(
    appearance,
    ui.effectiveCustomThemeName,
    ui.customBg.url,
    plugin?.revision
  )
  return {
    key,
    kind,
    surface:
      kind === 'preset'
        ? (plugin?.data.background ??
          appearance.backgroundSurface ??
          solidBackgroundColor(ui.songThemeColor ?? ui.activeThemeColor, appearance.dark))
        : (theme?.tokens['--ep-app-bg'] ?? base),
    base: !appearance.dark && appearance.contentDark ? 'var(--_theme-bg-dark)' : base,
    scrim: appearance.backgroundScrim,
    component: activeTheme.value.component,
    plugin,
    theme,
    primary: ui.songThemeColor ?? ui.activeThemeColor,
    dark: appearance.dark,
    contentDark: appearance.contentDark,
    mediaUrl: ui.customBg.url,
    mediaStyle: { ...ui.getBackgroundStyle },
    mediaFilter: ui.getBackgroundFilter
  }
})

function setLayerRef(id: number, value: unknown): void {
  if (value) handles.set(id, value as LayerHandle)
  else handles.delete(id)
}
function stopFade(): void {
  viewTransition?.skipTransition()
  viewTransition = undefined
  document.documentElement.classList.remove('appearance-snapshot')
  cancelAnimationFrame(fadeFrame)
  clearTimeout(fadeTimeout)
  fadeFrame = 0
  fading = false
}
function createLayer(value: BackgroundScene, phase: LayerEntry['phase']): LayerEntry {
  return shallowReactive({
    id: ++nextLayerId,
    scene: value,
    opacity: phase === 'pending' ? 0 : 1,
    animated: false,
    phase
  })
}
function finishFade(layer: LayerEntry): void {
  if (disposed || pending !== layer) return
  stopFade()
  layer.opacity = 1
  layer.animated = false
  layer.phase = 'current'
  current = layer
  pending = undefined
  layers.value = [layer]
  if (scene.value.key === layer.scene.key) handles.get(layer.id)?.unfreeze()
  emit('contrast', layer.scene.contentDark)
  const next = queued
  queued = undefined
  backgroundAppearanceHandoff.settle(!!next)
  // Dispose the covered canvas before mounting another queued resource.
  if (next)
    void nextTick(() => {
      if (!disposed && scene.value.key === next.key && current === layer) requestScene(scene.value)
    })
}
function duration(): number {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--motion-duration-theme')
    .trim()
  const amount = Number.parseFloat(value)
  return Number.isFinite(amount) ? Math.max(0, value.endsWith('ms') ? amount : amount * 1000) : 220
}
function ready(layer: LayerEntry): void {
  if (disposed || pending !== layer || fading) return
  if (reducedMotion.value || duration() === 0) {
    backgroundAppearanceHandoff.start(layer.scene.key, false)
    emit('contrast', layer.scene.contentDark)
    finishFade(layer)
    return
  }
  fading = true
  handles.get(layer.id)?.freeze()
  layer.phase = 'entering'
  if (document.startViewTransition) {
    const transition = document.startViewTransition(async () => {
      if (disposed || pending !== layer) return
      const root = document.documentElement
      root.classList.add('appearance-snapshot')
      try {
        backgroundAppearanceHandoff.start(layer.scene.key, false)
        emit('contrast', layer.scene.contentDark)
        layer.opacity = 1
        await nextTick()
        // Commit the complete new palette before its snapshot is captured.
        void root.offsetHeight
      } finally {
        root.classList.remove('appearance-snapshot')
      }
    })
    viewTransition = transition
    void transition.ready.catch(() => undefined)
    void transition.finished.then(
      () => finishFade(layer),
      () => finishFade(layer)
    )
    return
  }
  layer.animated = true
  void nextTick(() => {
    if (pending !== layer || !fading) return
    fadeFrame = requestAnimationFrame(() => {
      fadeFrame = requestAnimationFrame(() => {
        if (pending !== layer || !fading) return
        backgroundAppearanceHandoff.start(layer.scene.key, true)
        emit('contrast', layer.scene.contentDark)
        layer.opacity = 1
        fadeTimeout = setTimeout(() => finishFade(layer), duration() + 80)
      })
    })
  })
}
function requestScene(value: BackgroundScene): void {
  if (disposed) return
  if (value.kind === 'native') {
    backgroundAppearanceHandoff.release(value.key)
    stopFade()
    current = pending = undefined
    queued = undefined
    layers.value = []
    emit('contrast', value.contentDark)
    return
  }
  if (fading && !reducedMotion.value) {
    if (pending?.scene.key === value.key) {
      pending.scene = value
      queued = undefined
    } else queued = value
    return
  }
  if (!pending && current?.scene.key === value.key) {
    current.scene = value
    emit('contrast', value.contentDark)
    return
  }
  if (reducedMotion.value || !current) {
    backgroundAppearanceHandoff.release(value.key)
    stopFade()
    pending = queued = undefined
    current = createLayer(value, 'current')
    layers.value = [current]
    emit('contrast', value.contentDark)
    return
  }
  if (pending?.scene.key === value.key) {
    pending.scene = value
    return
  }
  stopFade()
  queued = undefined
  if (current.scene.key === value.key) {
    backgroundAppearanceHandoff.release(value.key)
    pending = undefined
    current.scene = value
    current.phase = 'current'
    handles.get(current.id)?.unfreeze()
    layers.value = [current]
    emit('contrast', value.contentDark)
    return
  }
  handles.get(current.id)?.freeze()
  backgroundAppearanceHandoff.hold(current.scene.key)
  current.phase = 'outgoing'
  pending = createLayer(value, 'pending')
  // Target first in DOM for controls/tests, but explicitly above the opaque old layer.
  layers.value = [pending, current]
}
function onTransitionEnd(layer: LayerEntry, event: TransitionEvent): void {
  if (
    event.target === event.currentTarget &&
    event.propertyName === 'opacity' &&
    layer.opacity === 1
  )
    finishFade(layer)
}
function failure(kind: 'theme' | 'video'): void {
  showError(
    t(kind === 'video' ? 'settings.backgroundVideoUnsupported' : 'plugins.themeRenderFailed')
  )
}
watch(scene, requestScene, { immediate: true, flush: 'sync' })
watch(reducedMotion, (disabled) => {
  if (disabled && pending) {
    backgroundAppearanceHandoff.start(pending.scene.key, false)
    finishFade(pending)
  }
})
const syncBackgroundActivity = (): void => {
  isBackgroundActive.value = !document.hidden && document.hasFocus()
}
const syncReducedMotion = (): void => {
  systemReducedMotion.value = motionQuery.matches
}
onMounted(() => {
  document.addEventListener('visibilitychange', syncBackgroundActivity)
  window.addEventListener('focus', syncBackgroundActivity)
  window.addEventListener('blur', syncBackgroundActivity)
  motionQuery.addEventListener('change', syncReducedMotion)
})
onBeforeUnmount(() => {
  disposed = true
  backgroundAppearanceHandoff.release(scene.value.key)
  stopFade()
  handles.clear()
  ui.songThemeColor = null
  document.removeEventListener('visibilitychange', syncBackgroundActivity)
  window.removeEventListener('focus', syncBackgroundActivity)
  window.removeEventListener('blur', syncBackgroundActivity)
  motionQuery.removeEventListener('change', syncReducedMotion)
})
</script>

<template>
  <div class="absolute inset-0 pointer-events-none" aria-hidden="true">
    <BackgroundLayer
      v-for="layer in layers"
      :key="layer.id"
      :ref="(value) => setLayerRef(layer.id, value)"
      :scene="layer.scene"
      :paused="
        globallyPaused ||
        layer.phase === 'outgoing' ||
        (layer.phase === 'entering' && !!viewTransition)
      "
      :reduced-motion="reducedMotion"
      :data-background-layer="layer.id"
      :data-background-phase="layer.phase"
      :style="{
        opacity: layer.opacity,
        zIndex: layer === current ? 0 : 1,
        willChange:
          layer.phase === 'entering' || layer.phase === 'outgoing' ? 'opacity' : undefined,
        transition: layer.animated
          ? 'opacity var(--motion-duration-theme) var(--motion-ease-standard)'
          : 'none'
      }"
      @ready="ready(layer)"
      @failure="failure"
      @transitionend="onTransitionEnd(layer, $event)"
    />
  </div>
</template>
