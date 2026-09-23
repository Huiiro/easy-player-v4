<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { getSystemBackgroundTheme } from './systemBackgroundRegistry'
import { useUIStore } from '@/stores/ui/uiStore'

const ui = useUIStore()
const activeTheme = computed(() => getSystemBackgroundTheme(ui.systemBackground))
const isSystemTheme = computed(() => !ui.useCustomBg && ui.systemBackground !== 'none')
const isBackgroundActive = ref(!document.hidden && document.hasFocus())

const syncBackgroundActivity = (): void => {
  isBackgroundActive.value = !document.hidden && document.hasFocus()
}

onMounted(() => {
  document.addEventListener('visibilitychange', syncBackgroundActivity)
  window.addEventListener('focus', syncBackgroundActivity)
  window.addEventListener('blur', syncBackgroundActivity)
})
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', syncBackgroundActivity)
  window.removeEventListener('focus', syncBackgroundActivity)
  window.removeEventListener('blur', syncBackgroundActivity)
})
</script>

<template>
  <Transition name="app-theme-background">
    <div v-if="ui.useCustomBg" key="custom" class="app-background-layer" aria-hidden="true">
      <div
        class="absolute -inset-6 bg-cover bg-center transition-[filter] duration-[var(--motion-duration-slow)] ease-[var(--motion-ease-standard)]"
        :style="ui.getBackgroundStyle"
      />
      <div class="app-background-scrim app-background-scrim--custom" />
    </div>
    <div
      v-else-if="isSystemTheme"
      :key="ui.systemBackground"
      class="app-background-layer"
      aria-hidden="true"
    >
      <div
        class="app-background-host"
        :class="(!isBackgroundActive || ui.showPlayer) && 'app-background-host--paused'"
      >
        <component
          :is="activeTheme.component"
          v-bind="
            activeTheme.id === 'blackhole' ? { paused: !isBackgroundActive || ui.showPlayer } : {}
          "
        />
      </div>
      <div class="app-background-scrim app-background-scrim--system" />
    </div>
  </Transition>
</template>

<style scoped>
.app-background-layer {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}

.app-background-host {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.app-background-scrim {
  position: absolute;
  inset: 0;
}

.app-background-scrim--custom {
  background: color-mix(in srgb, var(--color-bg) 76%, transparent);
}

.app-background-scrim--system {
  background: color-mix(in srgb, var(--color-bg) 62%, transparent);
}

.app-background-host--paused :deep(*) {
  animation-play-state: paused !important;
}

.app-theme-background-enter-active,
.app-theme-background-leave-active {
  transition: opacity var(--motion-duration-theme) var(--motion-ease-standard);
}

.app-theme-background-enter-from,
.app-theme-background-leave-to {
  opacity: 0;
}
</style>
