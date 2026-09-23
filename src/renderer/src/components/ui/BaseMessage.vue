<script setup lang="ts">
import { computed } from 'vue'
import { useMessage } from './useMessage'
import type { MessageInstance } from './useMessage'

defineOptions({
  name: 'BaseMessage'
})

const { messages, remove } = useMessage()

// ==================== 类型配置 ====================
const typeConfig = computed(() => {
  const map: Record<string, { cls: string; icon: string }> = {
    success: {
      cls: 'border-success',
      icon: 'M5 13l4 4L19 7'
    },
    warning: {
      cls: 'border-warning',
      icon: 'M12 2L2 20h20L12 2z M12 11v4 M12 17h0'
    },
    info: {
      cls: 'border-primary',
      icon: 'M12 2a10 10 0 100 20 10 10 0 000-20z M12 10v6 M12 7h0'
    },
    error: {
      cls: 'border-danger',
      icon: 'M12 2a10 10 0 100 20 10 10 0 000-20z M15 9l-6 6 M9 9l6 6'
    }
  }
  return map
})

function getConfig(type: string) {
  return typeConfig.value[type] ?? typeConfig.value.info
}

function handleClose(msg: MessageInstance): void {
  remove(msg.id)
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center gap-2 pointer-events-none"
    >
      <TransitionGroup
        enter-active-class="transition-all duration-[var(--motion-duration-slow)] ease-[var(--motion-ease-enter)]"
        enter-from-class="opacity-0 -translate-y-4"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition-all duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-exit)]"
        leave-from-class="opacity-100 translate-y-0"
        leave-to-class="opacity-0 -translate-y-2"
      >
        <div
          v-for="msg in messages"
          :key="msg.id"
          class="pointer-events-auto relative flex items-center gap-3 pl-5 pr-4 py-3 rounded-lg shadow-lg bg-bg border border-border min-w-75 max-w-125 overflow-hidden"
          :class="getConfig(msg.type ?? 'info').cls"
        >
          <!-- 左边颜色条 -->
          <div
            class="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg"
            :class="{
              'bg-success': msg.type === 'success',
              'bg-warning': msg.type === 'warning',
              'bg-primary': msg.type === 'info' || !msg.type,
              'bg-danger': msg.type === 'error'
            }"
          />

          <!-- 图标 -->
          <svg
            class="w-5 h-5 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            :class="{
              'text-success': msg.type === 'success',
              'text-warning': msg.type === 'warning',
              'text-primary': msg.type === 'info' || !msg.type,
              'text-danger': msg.type === 'error'
            }"
          >
            <path :d="getConfig(msg.type ?? 'info').icon" />
          </svg>

          <!-- 文字 -->
          <span class="flex-1 text-sm text-text">{{ msg.message }}</span>

          <!-- 关闭按钮 -->
          <button
            v-if="msg.showClose"
            class="shrink-0 p-0.5 rounded hover:bg-hover-bg transition-colors text-text-l hover:text-text"
            @click="handleClose(msg)"
          >
            <svg
              class="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
