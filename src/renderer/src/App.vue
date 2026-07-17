<script setup lang="ts">
import BaseMessage from '@/components/ui/BaseMessage.vue'
</script>
<template>
  <router-view v-slot="{ Component }">
    <component :is="Component" />
  </router-view>
  <BaseMessage />
</template>
