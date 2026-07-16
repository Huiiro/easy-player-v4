<script setup lang="ts">
import { computed } from 'vue'

defineOptions({
  name: 'BaseSkeleton'
})

const props = withDefaults(
  defineProps<{
    type?: 'card' | 'row'
    size?: number
    width?: string | number
    shape?: 'square' | 'rounded' | 'circle'
  }>(),
  {
    type: 'card',
    size: 120,
    shape: 'rounded'
  }
)

const wrapperStyle = computed(() => {
  if (props.width) {
    return {
      width: typeof props.width === 'number' ? props.width + 'px' : props.width
    }
  }
  return {}
})

const wrapperClass = computed(() => {
  return [props.type === 'card' && 'flex flex-col']
})

const coverClass = computed(() => {
  return [
    props.shape === 'circle' && 'rounded-full',
    props.shape === 'rounded' && 'rounded-lg',
    props.shape === 'square' && 'rounded-none'
  ]
})
</script>

<template>
  <div class="animate-pulse" :class="wrapperClass" :style="wrapperStyle">
    <!-- 自定义内容优先 -->
    <slot v-if="$slots.default" />

    <!-- 默认卡片骨架 -->
    <template v-else>
      <div v-if="type === 'card'" class="flex flex-col gap-2">
        <!-- 封面 -->
        <div
          class="bg-black/25 dark:bg-white/25"
          :class="coverClass"
          :style="{ height: size + 'px' }"
        />

        <!-- 标题 -->
        <div class="h-4 bg-black/25 dark:bg-white/25 rounded w-3/4" />

        <!-- 副标题 -->
        <div class="h-3 bg-black/25 dark:bg-white/25 rounded w-1/2" />
      </div>

      <!-- 行骨架 -->
      <div v-else-if="type === 'row'" class="flex items-center gap-3 p-2">
        <div
          class="w-10 h-10 bg-black/25 dark:bg-white/25 rounded"
          :class="coverClass"
          :style="{ height: size + 'px', width: size + 'px' }"
        />
        <div class="flex-1 space-y-2">
          <div class="h-4 bg-black/25 dark:bg-white/25 rounded w-3/4" />
          <div class="h-3 bg-black/25 dark:bg-white/25 rounded w-1/3" />
        </div>
      </div>
    </template>
  </div>
</template>
