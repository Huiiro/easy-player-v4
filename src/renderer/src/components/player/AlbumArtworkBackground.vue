<script setup lang="ts">
import { onMounted, ref } from 'vue'

defineProps<{ src: string }>()
const emit = defineEmits<{ load: [image: HTMLImageElement]; error: [event: Event] }>()
const imageRef = ref<HTMLImageElement>()
let loaded = false

function onLoad(): void {
  const image = imageRef.value
  if (!image?.naturalWidth || loaded) return
  loaded = true
  emit('load', image)
}

onMounted(onLoad)
</script>

<template>
  <img
    ref="imageRef"
    :src="src"
    class="panel-background-item max-w-none object-cover"
    alt=""
    crossorigin="anonymous"
    @load="onLoad"
    @error="emit('error', $event)"
  />
</template>

<style scoped>
.panel-background-item {
  filter: blur(64px) saturate(1.68) contrast(1.28) brightness(0.52);
}
</style>
