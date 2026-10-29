<script setup lang="ts">
import { useId } from 'vue'
defineProps<{ title: string }>()
const titleId = useId()
</script>

<template>
  <section class="settings-group" :aria-labelledby="titleId">
    <h3 :id="titleId" class="settings-group-title">{{ title }}</h3>
    <slot />
  </section>
</template>
