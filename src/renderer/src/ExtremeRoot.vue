<script setup lang="ts">
import ExtremePlayer from './components/player/ExtremePlayer.vue'
import { usePlaybackLifecycle } from './hooks/usePlaybackLifecycle'
usePlaybackLifecycle()
</script>
<template>
  <div class="extreme-shell"><ExtremePlayer /></div>
</template>
<style>
html,
body,
#app,
.extreme-shell {
  height: 100%;
  margin: 0;
  background: #151515;
  color: #eee;
  font-family: system-ui, sans-serif;
}
* {
  box-sizing: border-box;
}
button,
input {
  -webkit-app-region: no-drag;
}
button {
  font: inherit;
  cursor: pointer;
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
