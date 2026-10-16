<!-- SvgIcon -->
<template>
  <svg :class="svgClass" :style="svgStyle" aria-hidden="true">
    <use :xlink:href="iconName" />
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  name: string
  className?: string
  size?: number | string
}>()

const iconName = computed(() => `#icon-${props.name}`)
const svgClass = computed(() => `svg-icon ${props.className ?? ''}`)
const svgStyle = computed(() => {
  if (props.size === undefined) return undefined
  const size = typeof props.size === 'number' ? `${props.size}px` : props.size
  return { width: size, height: size }
})
</script>

<style scoped>
.svg-icon {
  /* width: 1em; */
  /* height: 1em; */
  fill: currentColor;
  vertical-align: middle;
}
</style>
