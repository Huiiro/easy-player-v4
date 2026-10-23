<script setup lang="ts">
defineProps<{ muted?: boolean }>()
</script>
<template>
  <div class="settings-card" :class="{ muted }"><slot /></div>
</template>
