<script setup lang="ts">
withDefaults(defineProps<{ card: boolean; reduceMotion?: boolean }>(), { reduceMotion: false })

function blockLeavingContent(element: Element): void {
  if (element instanceof HTMLElement) element.inert = true
}
function activateContent(element: Element): void {
  if (element instanceof HTMLElement) element.inert = false
}
</script>

<template>
  <Transition
    name="layout-mode"
    mode="out-in"
    @before-leave="blockLeavingContent"
    @before-enter="activateContent"
    @leave-cancelled="activateContent"
  >
    <div
      :key="card ? 'card' : 'library'"
      class="layout-mode-surface"
      :data-mode="card ? 'card' : 'library'"
      :data-reduced-motion="reduceMotion"
    >
      <slot v-if="card" name="card" />
      <slot v-else />
    </div>
  </Transition>
</template>

<style scoped>
.layout-mode-surface {
  display: flex;
  flex: 1;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.layout-mode-enter-active {
  transition:
    opacity var(--motion-duration-slow) var(--motion-ease-enter),
    transform var(--motion-duration-slow) cubic-bezier(0.22, 1, 0.36, 1);
}
.layout-mode-leave-active {
  pointer-events: none;
  transition:
    opacity var(--motion-duration-fast) var(--motion-ease-exit),
    transform var(--motion-duration-fast) var(--motion-ease-exit);
}
.layout-mode-enter-from,
.layout-mode-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
.layout-mode-enter-from[data-mode='card'] {
  transform: translateY(12px) scale(0.99);
}
.layout-mode-leave-to[data-mode='card'] {
  transform: translateY(8px) scale(0.99);
}
.layout-mode-enter-active[data-reduced-motion='true'],
.layout-mode-leave-active[data-reduced-motion='true'] {
  transition: none;
}
@media (prefers-reduced-motion: reduce) {
  .layout-mode-enter-active,
  .layout-mode-leave-active {
    transition: none;
  }
}
</style>
