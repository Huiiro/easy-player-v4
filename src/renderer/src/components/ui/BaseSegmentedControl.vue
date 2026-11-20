<script setup lang="ts" generic="T extends string | number">
defineOptions({ name: 'BaseSegmentedControl' })

defineProps<{ options: readonly { value: T; label: string }[] }>()

const selected = defineModel<T>({ required: true })
</script>

<template>
  <div class="ep-segmented-control" role="group">
    <button
      v-for="{ value, label } in options"
      :key="value"
      type="button"
      class="ep-segment ep-focusable"
      :aria-pressed="selected === value"
      @click="selected = value"
    >
      {{ label }}
    </button>
  </div>
</template>

<style scoped>
.ep-segmented-control {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: 0.25rem;
  padding: 0.1875rem;
  border: 1px solid color-mix(in srgb, var(--color-text) 8%, transparent);
  border-radius: 999px;
  background-color: color-mix(in srgb, var(--color-text) 5%, transparent);
}
.ep-segment {
  min-width: 0;
  min-height: 2rem;
  padding: 0.3125rem 0.625rem;
  border: 1px solid transparent;
  border-radius: inherit;
  background-color: transparent;
  color: var(--color-text-l);
  font-size: 0.8125rem;
  font-weight: 500;
  line-height: 1.2;
  white-space: normal;
  transition:
    background-color var(--motion-duration-fast) var(--motion-ease-standard),
    color var(--motion-duration-fast) var(--motion-ease-standard);
}
.ep-segment:hover,
.ep-segment[aria-pressed='true'] {
  color: var(--color-text);
  background-color: color-mix(in srgb, var(--color-text) 8%, transparent);
}
.ep-segment[aria-pressed='true'] {
  border-color: color-mix(in srgb, var(--color-text) 11%, transparent);
}
.ep-segment[aria-pressed='true']:hover {
  background-color: color-mix(in srgb, var(--color-text) 15%, transparent);
}
</style>
