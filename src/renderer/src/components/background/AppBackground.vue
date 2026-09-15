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
  <div
    v-if="ui.useCustomBg"
    class="pointer-events-none absolute -inset-6 z-0 bg-cover bg-center transition-[filter,opacity] duration-300"
    :style="ui.getBackgroundStyle"
    aria-hidden="true"
  />
  <div
    v-else-if="isSystemTheme"
    class="app-background-host"
    :class="(!isBackgroundActive || ui.showPlayer) && 'app-background-host--paused'"
    aria-hidden="true"
  >
    <component
      :is="activeTheme.component"
      v-bind="
        activeTheme.id === 'blackhole' ? { paused: !isBackgroundActive || ui.showPlayer } : {}
      "
    />
  </div>
</template>

<style scoped>
.app-background-host {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}

.app-background-host--paused :deep(*) {
  animation-play-state: paused !important;
}
</style>
