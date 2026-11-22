<script setup lang="ts">
import { usePlayerStore } from '@/stores/player/playerStore'
import { useSeekProgress } from './useSeekProgress'

// Keep position ticks and drag previews inside the controls that display them.
const { displayPositionMs, displayPositionFormatted, previewSeek, commitSeek, cancelSeek } =
  useSeekProgress(usePlayerStore())
</script>

<template>
  <slot
    :position="displayPositionMs"
    :formatted="displayPositionFormatted"
    :preview="previewSeek"
    :commit="commitSeek"
    :cancel="cancelSeek"
  />
</template>
