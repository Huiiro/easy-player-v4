<!-- 扫描进度组件 -->
<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import eventBus from '@/utils/eventBus'

const props = defineProps<{
  visible: boolean
  scanning: boolean
  current: number
  total: number
  added: number
  duplicates: number
}>()

const emit = defineEmits(['update:visible'])

const { t } = useI18n()
const progress = ref(0)
let autoCloseTimer: number | undefined = undefined

watch(
  () => [props.current, props.total],
  () => {
    progress.value = props.total > 0 ? Math.min((props.current / props.total) * 100, 100) : 0
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  if (autoCloseTimer) clearTimeout(autoCloseTimer)
})

watch(
  () => [props.scanning, props.visible] as const,
  ([scanning, visible]) => {
    if (!scanning && visible) {
      // 通知父组件重新加载
      if (autoCloseTimer) return
      autoCloseTimer = window.setTimeout(() => {
        eventBus.emit('scanFinished')
        close()
      }, 2500)
    } else if (scanning && autoCloseTimer) {
      clearTimeout(autoCloseTimer)
      autoCloseTimer = undefined
    }
  }
)

const close = (): void => {
  if (autoCloseTimer) clearTimeout(autoCloseTimer)
  autoCloseTimer = undefined
  emit('update:visible', false)
}
</script>

<template>
  <transition name="slide-fade">
    <div v-if="visible" class="fixed bottom-6 right-6 z-[100] pointer-events-none">
      <div
        class="bg-bg rounded-xl shadow-lg p-4 w-80 border border-r border-border pointer-events-auto transform transition-all duration-[var(--motion-duration-slow)]"
      >
        <!-- header -->
        <div class="flex mb-2 justify-between items-center text-text">
          {{ scanning ? t('scan.scanning') : t('scan.finished') }}
          <button class="hover:text-primary" @click="close">
            <svgIcon name="common-close" class-name="w-4 h-4 icon" />
          </button>
        </div>

        <!-- 进度条 -->
        <div class="w-full h-3 bg-bg-l rounded-full overflow-hidden mb-2 relative">
          <div
            class="h-full bg-primary relative overflow-hidden"
            :style="{ width: `${progress}%` }"
          >
            <!-- 条纹动画 -->
            <div class="absolute top-0 left-0 h-full w-full bg-primary-l-20 animate-stripes" />
          </div>
        </div>

        <!-- 文字进度 -->
        <p class="text-sm text-text-l">
          {{ t('scan.progress', { current, total }) }}
        </p>
        <p class="text-xs mt-1">
          <span class="text-success">{{ t('scan.added', { count: added }) }}</span>
          <span class="text-danger ml-10"> {{ t('scan.duplicates', { count: duplicates }) }} </span>
        </p>
      </div>
    </div>
  </transition>
</template>

<style scoped>
/* 弹窗浮入 + 渐隐 */
.slide-fade-enter-from {
  opacity: 0;
  transform: translateX(100%) translateY(20%);
}

.slide-fade-enter-to {
  opacity: 1;
  transform: translateX(0) translateY(0);
}

.slide-fade-leave-from {
  opacity: 1;
  transform: translateX(0) translateY(0);
}

.slide-fade-leave-to {
  opacity: 0;
  transform: translateX(100%) translateY(20%);
}

.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all var(--motion-duration-slow) var(--motion-ease-standard);
}

/* 条纹动画 */
@keyframes stripes {
  0% {
    background-position: 0 0;
  }
  100% {
    background-position: 40px 0;
  }
}

.animate-stripes {
  background-image: linear-gradient(
    45deg,
    rgba(255, 255, 255, 0.15) 25%,
    transparent 25%,
    transparent 50%,
    rgba(255, 255, 255, 0.15) 50%,
    rgba(255, 255, 255, 0.15) 75%,
    transparent 75%,
    transparent
  );
  background-size: 40px 40px;
  animation: stripes 1s linear infinite;
}
</style>
