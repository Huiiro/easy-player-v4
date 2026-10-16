<script setup lang="ts">
import { computed, useAttrs, useSlots } from 'vue'

defineOptions({
  name: 'BaseInput',
  inheritAttrs: false
})

const props = withDefaults(
  defineProps<{
    modelValue?: string | number
    placeholder?: string
    clearable?: boolean
    disabled?: boolean
    type?: string
  }>(),
  {
    modelValue: '',
    clearable: true,
    disabled: false,
    type: 'text'
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', val: string): void
  (e: 'clear'): void
}>()

const attrs = useAttrs()
const slots = useSlots()

const value = computed({
  get: () => props.modelValue,
  set: (val: string) => emit('update:modelValue', val)
})

function clear(): void {
  value.value = ''
  emit('clear')
}

const inputPaddingClass = computed(() => {
  const hasPrefix = !!slots.prefix
  const hasSuffix = !!slots.suffix
  const hasClear = props.clearable && !!value.value

  return [hasPrefix ? 'pl-8' : 'pl-2', hasSuffix || hasClear ? 'pr-8' : 'pr-2']
})

const inputAttrs = computed(() => {
  return Object.fromEntries(
    Object.entries(attrs).filter(([key]) => key !== 'class' && key !== 'style')
  )
})
</script>

<template>
  <div class="relative w-full" :class="attrs.class" :style="attrs.style">
    <!-- prefix -->
    <div
      v-if="$slots.prefix"
      class="absolute left-2 top-1/2 -translate-y-1/2 flex items-center pointer-events-none"
    >
      <slot name="prefix" />
    </div>

    <!-- input -->
    <input
      v-model="value"
      :type="type"
      :placeholder="placeholder"
      :disabled="disabled"
      v-bind="inputAttrs"
      class="ep-input py-1 rounded border text-sm w-full outline-none transition-all duration-[var(--motion-duration-standard)] ease-[var(--motion-ease-standard)]"
      :class="inputPaddingClass"
    />

    <!-- suffix + clear -->
    <div
      v-if="$slots.suffix || (clearable && value)"
      class="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1"
    >
      <slot name="suffix" />

      <button
        v-if="clearable && value"
        type="button"
        class="text-text-l hover:text-text"
        @click="clear"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  </div>
</template>
