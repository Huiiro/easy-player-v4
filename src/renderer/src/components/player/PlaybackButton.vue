<script setup lang="ts">
import SvgIcon from '@/components/svg/SvgIcon.vue'

withDefaults(
  defineProps<{
    playing: boolean
    label: string
    disabled?: boolean
    size?: 'compact' | 'normal' | 'large'
  }>(),
  { disabled: false, size: 'normal' }
)
const emit = defineEmits<{ click: [event: MouseEvent] }>()
</script>

<template>
  <button
    type="button"
    class="playback-button ep-button--primary"
    :class="`playback-button--${size}`"
    :disabled="disabled"
    :title="label"
    :aria-label="label"
    @click="emit('click', $event)"
  >
    <SvgIcon :name="playing ? 'play-pause' : 'play-play'" class="playback-button-icon" />
  </button>
</template>

<style scoped>
.playback-button {
  --playback-fill: var(--btn-primary-bg, var(--color-primary));
  /* Keep the theme fill; use black icons on light gray and pale tinted buttons too. */
  --playback-ink: oklch(
    from var(--playback-fill) clamp(0, calc((0.87 - l + c * 1.6) * 1000), 1) 0 0
  );
  display: inline-grid;
  flex: 0 0 auto;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--playback-fill);
  color: var(--playback-ink);
  box-shadow: 0 2px 12px rgb(0 0 0 / 12%);
  cursor: pointer;
  transition:
    box-shadow 160ms ease,
    opacity 160ms ease;
}
.playback-button--large {
  width: 3.2rem;
  height: 3.2rem;
}
.playback-button--compact {
  width: 1.75rem;
  height: 1.75rem;
}
.playback-button-icon {
  display: block;
  width: 1.25rem;
  height: 1.25rem;
  pointer-events: none;
}
.playback-button--large .playback-button-icon {
  width: 2rem;
  height: 2rem;
}
.playback-button--compact .playback-button-icon {
  width: 0.875rem;
  height: 0.875rem;
}
.playback-button:enabled:hover {
  --playback-fill: var(--btn-primary-bg-hover, var(--btn-primary-bg, var(--color-primary)));
  background: var(--playback-fill);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--playback-fill) 12%, transparent);
}
.playback-button:enabled:active {
  opacity: 0.8;
}
.playback-button:focus-visible {
  outline: 2px solid var(--playback-fill);
  outline-offset: 4px;
}
.playback-button:disabled {
  opacity: 0.45;
  box-shadow: none;
  cursor: not-allowed;
}
</style>
