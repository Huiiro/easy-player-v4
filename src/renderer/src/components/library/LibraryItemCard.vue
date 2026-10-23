<script setup lang="ts">
import { ref, watch } from 'vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'
const props = defineProps<{
  name: string
  subtitle?: string
  cover?: string | null
  icon: string
  circle?: boolean
  badge?: string
}>()
const failed = ref(false)
watch(
  () => props.cover,
  () => {
    failed.value = false
  }
)
</script>
<template>
  <div
    class="ep-library-artwork relative aspect-square bg-bg-l"
    :class="circle ? 'rounded-full' : 'rounded-xl'"
  >
    <div class="size-full overflow-hidden" :class="circle ? 'rounded-full' : 'rounded-lg'">
      <img
        v-if="cover && !failed"
        :src="cover"
        loading="lazy"
        decoding="async"
        class="size-full object-cover transition-transform duration-[var(--motion-duration-slow)] group-hover:scale-105"
        :alt="name"
        @error="failed = true"
      />
      <span v-else class="grid size-full place-items-center text-text-l"
        ><SvgIcon :name="icon" class-name="size-12"
      /></span>
    </div>
    <span
      v-if="badge"
      class="absolute rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white"
      :class="circle ? 'bottom-1 right-[9%]' : 'bottom-1 right-1'"
      >{{ badge }}</span
    >
  </div>
  <p class="mt-2 truncate text-sm font-medium">{{ name }}</p>
  <p v-if="subtitle" class="mt-0.5 truncate text-xs text-text-l">{{ subtitle }}</p>
</template>
