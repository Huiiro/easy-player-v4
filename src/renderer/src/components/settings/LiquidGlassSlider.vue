<script setup lang="ts">
import BaseRange from '@/components/ui/BaseRange.vue'
import { LIQUID_GLASS_CONTROLS, type LiquidGlassSliderKey } from '@/services/liquidGlassProfile'

defineProps<{ field: LiquidGlassSliderKey; label: string; valueText: string }>()
const value = defineModel<number>({ required: true })
const emit = defineEmits<{ change: [] }>()
</script>

<template>
  <label class="glass-settings-control grid items-center gap-2 text-xs">
    <span>{{ label }}</span>
    <BaseRange
      v-model="value"
      class="w-full min-w-0"
      v-bind="LIQUID_GLASS_CONTROLS[field]"
      :aria-valuetext="valueText"
      @change="emit('change')"
    />
    <span class="text-right text-text-l tabular-nums" aria-hidden="true">{{ valueText }}</span>
  </label>
</template>

<style scoped>
.glass-settings-control {
  grid-column: 1 / -1;
  grid-template-columns: subgrid;
}
</style>
