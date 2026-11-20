<script setup lang="ts">
import SvgIcon from '@/components/svg/SvgIcon.vue'

defineOptions({ name: 'BaseDisclosure' })

defineProps<{ label: string }>()
</script>

<template>
  <details class="ep-disclosure">
    <summary
      class="ep-disclosure-summary ep-focusable flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg py-2.5 text-sm font-medium"
    >
      {{ label }}
      <SvgIcon name="arrow-arrow-down" class-name="ep-disclosure-chevron size-4 shrink-0" />
    </summary>
    <slot />
  </details>
</template>

<style scoped>
.ep-disclosure-summary::-webkit-details-marker {
  display: none;
}
.ep-disclosure[open] .ep-disclosure-chevron {
  rotate: 180deg;
}
</style>
