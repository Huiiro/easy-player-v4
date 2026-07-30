<script setup lang="ts">
import { computed } from 'vue'
import { getSystemBackgroundTheme } from './systemBackgroundRegistry'
import { useUIStore } from '@/stores/ui/uiStore'

const ui = useUIStore()
const activeTheme = computed(() => getSystemBackgroundTheme(ui.systemBackground))
const isSystemTheme = computed(() => !ui.useCustomBg && ui.systemBackground !== 'none')
</script>

<template>
  <div
    v-if="ui.useCustomBg"
    class="pointer-events-none absolute -inset-6 z-0 bg-cover bg-center transition-[filter,opacity] duration-300"
    :style="ui.getBackgroundStyle"
    aria-hidden="true"
  />
  <component :is="activeTheme.component" v-else-if="isSystemTheme" />
</template>
