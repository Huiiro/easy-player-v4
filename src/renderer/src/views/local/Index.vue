<script setup lang="ts">
import SongListView from '@/components/songlist/SongListView.vue'
</script>

<template>
  <SongListView :source="{ type: 'local' }" />
</template>
