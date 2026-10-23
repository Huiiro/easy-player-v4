<script setup lang="ts">
import { useId } from 'vue'
defineProps<{ label: string; description?: string }>()
const labelId = useId()
const descriptionId = useId()
</script>
<template>
  <div
    class="setting-row"
    role="group"
    :aria-labelledby="labelId"
    :aria-describedby="description ? descriptionId : undefined"
  >
    <div class="min-w-0">
      <h3 :id="labelId">
        <slot name="label">{{ label }}</slot>
      </h3>
      <p v-if="description || $slots.description" :id="descriptionId">
        <slot name="description">{{ description }}</slot>
      </p>
    </div>
    <slot :label-id="labelId" :description-id="descriptionId" />
  </div>
</template>
