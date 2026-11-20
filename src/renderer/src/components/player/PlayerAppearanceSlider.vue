<script setup lang="ts">
import SettingRow from '@/components/settings/SettingRow.vue'
import BaseRange from '@/components/ui/BaseRange.vue'

defineProps<{
  label: string
  valueText: string
  min?: number
  max?: number
  step?: number
}>()
const value = defineModel<number>({ required: true })
</script>

<template>
  <SettingRow :label="label" class="appearance-slider">
    <div class="flex min-w-0 items-center gap-2">
      <BaseRange
        v-model="value"
        class="min-w-0 flex-1"
        :min="min"
        :max="max"
        :step="step"
        :aria-label="label"
        :aria-valuetext="valueText"
      />
      <span class="min-w-9 shrink-0 text-right text-xs text-text-l tabular-nums" aria-hidden="true">
        {{ valueText }}
      </span>
    </div>
  </SettingRow>
</template>
