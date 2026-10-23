<script lang="ts" setup>
import { computed } from 'vue'
import type { ControlSize } from './types'

defineOptions({
  name: 'BaseButton',
  inheritAttrs: false
})

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonType = 'button' | 'submit' | 'reset'

const props = withDefaults(
  defineProps<{
    type?: ButtonType
    variant?: Variant
    size?: ControlSize
    disabled?: boolean
    loading?: boolean
    iconOnly?: boolean
    block?: boolean
  }>(),
  {
    type: 'button',
    variant: 'primary',
    size: 'md'
  }
)

const emit = defineEmits<{ click: [event: MouseEvent] }>()

/* size */
const sizeClass = computed(() => {
  return {
    xs: 'px-2 py-1 text-xs gap-1',
    sm: 'px-2.5 py-1.5 text-xs gap-1.5',
    md: 'px-4 py-1.5 text-sm gap-2',
    lg: 'px-5 py-2 text-base gap-2.5'
  }[props.size]
})

const variantClass = computed(() => `ep-button--${props.variant}`)

/* base classes */
const baseClass =
  'ep-button inline-flex items-center justify-center border font-medium transition ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2'

const classes = computed(() => [
  baseClass,
  sizeClass.value,
  variantClass.value,
  props.block && 'w-full',
  `ep-control--${props.size}`,
  props.iconOnly && 'ep-button--icon',
  (props.disabled || props.loading) && 'opacity-50 cursor-not-allowed'
])

function handleClick(e: MouseEvent): void {
  if (props.disabled || props.loading) return
  emit('click', e)
}
</script>

<template>
  <button
    v-bind="$attrs"
    :type="type"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
    :class="classes"
    @click="handleClick"
  >
    <slot v-if="loading" name="loading"><span class="ep-spinner" aria-hidden="true" /></slot>
    <!-- left icon -->
    <span v-if="$slots.left" class="flex items-center">
      <slot name="left" />
    </span>

    <!-- content -->
    <span class="flex items-center">
      <slot />
    </span>

    <!-- right icon -->
    <span v-if="$slots.right" class="flex items-center">
      <slot name="right" />
    </span>
  </button>
</template>
