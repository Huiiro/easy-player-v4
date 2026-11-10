<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import { useUIStore } from '@/stores/ui/uiStore'
import { useAnimationActivity } from '@/hooks/useAnimationActivity'
import { mountLiquidGlassStudio, type GlassStudioController } from '@/services/liquidGlassStudio'

const ui = useUIStore()
const activity = useAnimationActivity(() => ui.pauseAnimationsOnBlur !== false)
let controller: GlassStudioController | undefined
watch(
  () =>
    [
      ui.nativeMaterialEnabled,
      ui.extremePlayback,
      activity.value,
      ui.reduceMotion,
      ui.showPlayer
    ] as const,
  ([native, extreme, active, reduced, player]) => {
    if (native || extreme) {
      controller?.dispose()
      controller = undefined
      return
    }
    controller ??= mountLiquidGlassStudio()
    controller.setActivity(active && !player, reduced)
  },
  { immediate: true, flush: 'post' }
)
onBeforeUnmount(() => controller?.dispose())
watch(
  () => [ui.resolvedAppearance.background, ui.backgroundTheme, ui.activeThemeColor],
  () => controller?.refresh(),
  { deep: true, flush: 'post' }
)
</script>

<template><span hidden aria-hidden="true" /></template>
