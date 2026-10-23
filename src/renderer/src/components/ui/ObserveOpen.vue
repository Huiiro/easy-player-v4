<script setup lang="ts">
import { watch } from 'vue'
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ change: [open: boolean] }>()
watch(
  () => props.open,
  (open, previous) => {
    if (previous !== undefined || open) emit('change', open)
  },
  { immediate: true }
)
</script>
<template><slot /></template>
