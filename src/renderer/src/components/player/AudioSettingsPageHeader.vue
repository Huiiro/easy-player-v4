<script setup lang="ts">
defineProps<{ title: string }>()
</script>

<template>
  <header class="shrink-0 space-y-1 px-4 py-4 sm:px-5 sm:pt-5">
    <div class="flex min-h-8 flex-wrap items-center justify-between gap-3">
      <h3 class="text-lg font-semibold">{{ title }}</h3>
      <slot />
    </div>
    <slot name="details" />
  </header>
</template>
