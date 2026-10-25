<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { InstalledPluginTheme } from '../../../../shared/themePlugins'

const props = withDefaults(defineProps<{ theme: InstalledPluginTheme; paused?: boolean }>(), {
  paused: false
})
const emit = defineEmits<{ failure: [] }>()
const frame = ref<HTMLIFrameElement | null>(null)
const ready = ref(false)
const failed = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
const source = computed(() => {
  const expected = `easy-player-media://plugin-theme/${props.theme.pluginId}/${props.theme.revision}/__frame.html`
  return props.theme.rendererUrl === expected ? expected : undefined
})
function sendState(): void {
  frame.value?.contentWindow?.postMessage(
    { channel: 'easy-player-theme', type: 'state', paused: props.paused },
    '*'
  )
}
function fail(): void {
  if (failed.value) return
  clearTimeout(timer)
  failed.value = true
  ready.value = false
  emit('failure')
}
function message(event: MessageEvent): void {
  if (!frame.value?.contentWindow || event.source !== frame.value.contentWindow) return
  if (!event.data || event.data.channel !== 'easy-player-theme') return
  if (event.data.type === 'ready') {
    clearTimeout(timer)
    ready.value = true
    sendState()
  } else if (event.data.type === 'failed') fail()
}
watch(() => props.paused, sendState)
onMounted(() => {
  window.addEventListener('message', message)
  if (!source.value) fail()
  else timer = setTimeout(fail, 10000)
})
onBeforeUnmount(() => {
  clearTimeout(timer)
  window.removeEventListener('message', message)
  if (frame.value) {
    frame.value.style.visibility = 'hidden'
    frame.value.contentWindow?.postMessage({ channel: 'easy-player-theme', type: 'dispose' }, '*')
  }
  // Removing the sandboxed frame destroys its document, timers and graphics contexts.
})
</script>

<template>
  <div
    class="sandboxed-theme-background ep-app-background"
    :style="{ '--theme-background': theme.data.background }"
    aria-hidden="true"
  >
    <iframe
      v-if="source && !failed"
      ref="frame"
      :src="source"
      :title="theme.displayName"
      :class="{ ready }"
      sandbox="allow-scripts"
      referrerpolicy="no-referrer"
      tabindex="-1"
      @load="sendState"
      @error="fail"
    />
  </div>
</template>

<style scoped>
:where(.sandboxed-theme-background) {
  background: var(--theme-background);
}
.sandboxed-theme-background,
iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  pointer-events: none;
}
.sandboxed-theme-background {
  contain: strict;
}
iframe {
  display: block;
  border: 0;
  opacity: 0;
}
iframe.ready {
  opacity: 1;
}
</style>
