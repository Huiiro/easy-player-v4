<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{ open: boolean }>()
const present = ref(props.open)

watch(
  () => props.open,
  (open) => {
    if (open) present.value = true
  },
  { flush: 'sync' }
)

function releasePanel(): void {
  // A quick reopen cancels the leave; keep its existing canvas and listeners.
  if (!props.open) present.value = false
}
</script>

<template>
  <Transition name="player-panel" @after-leave="releasePanel">
    <div v-show="props.open" class="player-panel-layer" :inert="!props.open">
      <!-- v-show hides the host before GPU cleanup. Unmounting a v-if child in
           Transition would clear its canvas while the leave is still visible. -->
      <slot v-if="present" />
    </div>
  </Transition>
</template>

<style scoped>
.player-panel-layer {
  position: fixed;
  inset: 0;
  z-index: 40;
  isolation: isolate;
}
.player-panel-enter-active,
.player-panel-leave-active {
  transition: opacity var(--motion-duration-theme) var(--motion-ease-standard);
}
.player-panel-enter-from,
.player-panel-leave-to {
  opacity: 0;
}
</style>
