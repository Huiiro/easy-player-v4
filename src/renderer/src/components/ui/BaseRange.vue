<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ value: number; min?: number; max?: number }>(), {
  min: 0,
  max: 100
})

const progress = computed(() => {
  const span = props.max - props.min
  if (!Number.isFinite(span) || span <= 0 || !Number.isFinite(props.value)) return 0
  return Math.max(0, Math.min(1, (props.value - props.min) / span))
})

function updateProgress(event: Event): void {
  const input = event.target as HTMLInputElement
  const span = props.max - props.min
  const ratio = span > 0 ? (Number(input.value) - props.min) / span : 0
  input.style.setProperty('--ep-range-progress', String(Math.max(0, Math.min(1, ratio))))
  input.style.setProperty('--ep-range-has-progress', ratio > 0 ? '1' : '0')
}
</script>

<template>
  <input
    type="range"
    class="ep-range"
    :min="min"
    :max="max"
    :value="value"
    :style="{ '--ep-range-progress': progress, '--ep-range-has-progress': progress > 0 ? 1 : 0 }"
    @input="updateProgress"
  />
</template>
