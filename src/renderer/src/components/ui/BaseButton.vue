<script lang="ts" setup>
import { computed } from 'vue'

defineOptions({
  name: 'BaseButton',
  inheritAttrs: false
})

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'xs' | 'sm' | 'md' | 'lg'
type ButtonType = 'button' | 'submit' | 'reset'

const props = withDefaults(
  defineProps<{
    type?: ButtonType
    variant?: Variant
    size?: Size
    disabled?: boolean
    block?: boolean
  }>(),
  {
    type: 'button',
    variant: 'primary',
    size: 'md'
  }
)

const emit = defineEmits(['click'])

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
  props.disabled && 'opacity-50 cursor-not-allowed'
])

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function handleClick(e) {
  if (props.disabled) return
  emit('click', e)
}
</script>

<template>
  <button
    :type="type"
    :disabled="disabled"
    v-bind="$attrs"
    :class="[classes, $attrs.class]"
    @click="handleClick"
  >
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
