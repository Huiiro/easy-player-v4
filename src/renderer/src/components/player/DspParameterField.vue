<script setup lang="ts">
defineOptions({ name: 'DspParameterField' })

const props = withDefaults(
  defineProps<{
    modelValue: number
    label: string
    description: string
    min: number
    max: number
    step?: number
    decimals?: number
    unit?: string
  }>(),
  {
    step: 1,
    decimals: 0,
    unit: ''
  }
)

const emit = defineEmits<{
  (event: 'update:modelValue', value: number): void
  (event: 'change'): void
}>()

function formatValue(value: number): string {
  const safeValue = Number.isFinite(value) ? value : props.min
  return safeValue.toFixed(props.decimals)
}

function commit(event: Event): void {
  const input = event.target as HTMLInputElement
  const parsed = Number(input.value.replace(',', '.'))
  if (!Number.isFinite(parsed)) {
    input.value = formatValue(props.modelValue)
    return
  }

  const factor = 10 ** props.decimals
  const value = Math.round(Math.min(props.max, Math.max(props.min, parsed)) * factor) / factor
  input.value = formatValue(value)
  emit('update:modelValue', value)
  emit('change')
}
</script>

<template>
  <label class="block min-w-0">
    <span class="flex items-baseline justify-between gap-2">
      <span class="font-medium text-text">{{ label }}</span>
      <span v-if="unit" class="shrink-0 text-[10px] text-text-l2">{{ unit }}</span>
    </span>
    <input
      :value="formatValue(modelValue)"
      class="input-base mt-1 h-6 w-full tabular-nums"
      type="number"
      inputmode="decimal"
      :min="min"
      :max="max"
      :step="step"
      @change="commit"
    />
    <span class="mt-1 block text-[10px] leading-4 text-text-l">{{ description }}</span>
  </label>
</template>
