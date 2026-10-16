<script setup lang="ts">
import ExtremePlayer from './components/player/ExtremePlayer.vue'
import { usePlaybackLifecycle } from './hooks/usePlaybackLifecycle'
import { useMessage } from './components/ui/useMessage'
const { messages, remove } = useMessage()
usePlaybackLifecycle()
</script>
<template>
  <div class="extreme-shell"><ExtremePlayer /></div>
  <div class="lightweight-messages" role="status" aria-live="polite">
    <div
      v-for="message in messages"
      :key="message.id"
      class="lightweight-message"
      :data-type="message.type"
    >
      <span>{{ message.message }}</span>
      <button v-if="message.showClose" type="button" @click="remove(message.id)">×</button>
    </div>
  </div>
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
.lightweight-messages {
  position: fixed;
  z-index: 9999;
  top: 16px;
  left: 50%;
  display: grid;
  width: min(420px, calc(100vw - 32px));
  gap: 8px;
  transform: translateX(-50%);
  pointer-events: none;
}
.lightweight-message {
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid #555;
  border-left: 3px solid #aaa;
  border-radius: 8px;
  padding: 12px 16px;
  background: #242424;
  color: #eee;
  box-shadow: 0 4px 16px #0006;
  font-size: 14px;
  pointer-events: auto;
}
.lightweight-message[data-type='success'] {
  border-left-color: #75ce96;
}
.lightweight-message[data-type='warning'],
.lightweight-message[data-type='error'] {
  border-left-color: #edb37b;
}
.lightweight-message span {
  flex: 1;
  overflow-wrap: anywhere;
}
.lightweight-message button {
  border: 0;
  padding: 0 4px;
  background: transparent;
  color: inherit;
}
</style>
