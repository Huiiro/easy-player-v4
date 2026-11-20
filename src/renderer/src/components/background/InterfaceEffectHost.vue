<script setup lang="ts">
import { defineAsyncComponent, watchEffect } from 'vue'
import { useUIStore } from '@/stores/ui/uiStore'

const ui = useUIStore()
const LiquidGlassStudioHost = defineAsyncComponent(() => import('./LiquidGlassStudioHost.vue'))

watchEffect((onCleanup) => {
  if (ui.interfaceEffect !== 'frosted-glass' || ui.nativeMaterialEnabled || ui.extremePlayback)
    return
  const root = document.documentElement
  root.setAttribute('data-ep-frosted-glass', '')
  onCleanup(() => root.removeAttribute('data-ep-frosted-glass'))
})
</script>

<template>
  <LiquidGlassStudioHost v-if="ui.interfaceEffect === 'liquid-glass-studio'" />
</template>
