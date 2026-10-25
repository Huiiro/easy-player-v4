<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getSystemBackgroundTheme } from './systemBackgroundRegistry'
import { useUIStore } from '@/stores/ui/uiStore'
import { usePlayerStore } from '@/stores/player/playerStore'
import { SystemThemeColorAnalyzer } from './songThemeColors'
import { useMessage } from '@/components/ui/useMessage'

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
const video = ref<HTMLVideoElement | null>(null)
const customMotionPaused = computed(
  () =>
    (background.value.type !== 'image' && background.value.type !== 'video') ||
    !isBackgroundActive.value ||
    ui.showPlayer ||
    ui.reduceMotion
)
function syncCustomVideo(): void {
  if (!video.value) return
  if (customMotionPaused.value) video.value.pause()
  else video.value.play().catch(() => undefined)
}

watch([video, customMotionPaused, () => ui.customBg.url, () => ui.customBg.kind], syncCustomVideo, {
  flush: 'post'
})

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

const syncBackgroundActivity = (): void => {
  isBackgroundActive.value = !document.hidden && document.hasFocus()
}

onMounted(() => {
  document.addEventListener('visibilitychange', syncBackgroundActivity)
  window.addEventListener('focus', syncBackgroundActivity)
  window.addEventListener('blur', syncBackgroundActivity)
})
onBeforeUnmount(() => {
  ui.songThemeColor = null
  document.removeEventListener('visibilitychange', syncBackgroundActivity)
  window.removeEventListener('focus', syncBackgroundActivity)
  window.removeEventListener('blur', syncBackgroundActivity)
})
</script>

<template>
  <!-- Replace resources in one commit: canvases must not be cleared while a
       leaving background is still being faded across the whole window. -->
  <div class="absolute inset-0 pointer-events-none" aria-hidden="true">
    <div
      v-if="background.type === 'theme'"
      key="imported-theme"
      class="ep-app-background absolute inset-0 z-0 overflow-hidden pointer-events-none"
      aria-hidden="true"
    />
    <div
      v-else-if="background.type === 'image' || background.type === 'video'"
      key="custom"
      class="app-background-layer"
      :class="!ui.resolvedAppearance.dark && 'app-background-layer--light'"
      aria-hidden="true"
    >
      <div
        v-if="ui.customBg.kind === 'image'"
        class="absolute -inset-6 bg-cover bg-center transition-[filter] duration-[var(--motion-duration-slow)] ease-[var(--motion-ease-standard)]"
        :style="ui.getBackgroundStyle"
      />
      <div
        v-else-if="ui.customBg.kind === 'video'"
        class="custom-background-media transition-[filter] duration-[var(--motion-duration-slow)] ease-[var(--motion-ease-standard)]"
        :style="{ filter: ui.getBackgroundFilter }"
      >
        <video
          v-if="ui.customBg.url"
          ref="video"
          :src="ui.customBg.url"
          muted
          loop
          playsinline
          preload="metadata"
          @loadeddata="syncCustomVideo"
          @error="showError(t('settings.backgroundVideoUnsupported'))"
        />
      </div>
      <div class="app-background-scrim app-background-scrim--custom" />
    </div>
    <div
      v-else-if="isSystemTheme"
      :key="ui.systemBackground"
      class="app-background-layer"
      :class="!ui.resolvedAppearance.dark && 'app-background-layer--light'"
      aria-hidden="true"
    >
      <div
        class="app-background-host"
        :class="(!isBackgroundActive || ui.showPlayer) && 'app-background-host--paused'"
      >
        <component
          :is="activeTheme.component"
          :key="
            activeTheme.pluginTheme
              ? activeTheme.pluginTheme.pluginId + ':' + activeTheme.pluginTheme.revision
              : activeTheme.id
          "
          v-bind="
            activeTheme.pluginTheme
              ? {
                  theme: activeTheme.pluginTheme,
                  paused: !isBackgroundActive || ui.showPlayer || ui.reduceMotion
                }
              : activeTheme.id === 'solid'
                ? {
                    primary: ui.songThemeColor ?? ui.activeThemeColor,
                    active: isBackgroundActive && !ui.showPlayer,
                    reducedMotion: ui.reduceMotion
                  }
                : {}
          "
          @failure="showError(t('plugins.themeRenderFailed'))"
        />
      </div>
      <div
        v-if="!isSolidTheme || !ui.resolvedAppearance.dark"
        class="app-background-scrim app-background-scrim--system"
      />
    </div>
  </div>
</template>

<style scoped>
.app-background-layer {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  background: var(--color-bg);
}

.app-background-host {
  position: absolute;
  inset: 0;
  overflow: hidden;
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

.app-background-scrim {
  position: absolute;
  inset: 0;
}

.app-background-scrim--custom {
  background: color-mix(in srgb, var(--color-bg) 42%, transparent);
}

.app-background-scrim--system {
  background: var(--ep-background-scrim, color-mix(in srgb, var(--color-bg) 62%, transparent));
}

/* All scene canvases may contain near-black pixels, including solid artwork.
   Use one light surface over them instead of each scene's dark-mode scrim. */
.app-background-layer--light .app-background-scrim {
  background: color-mix(in srgb, var(--color-bg) 90%, transparent);
}

.app-background-host--paused :deep(*) {
  animation-play-state: paused !important;
}
</style>
