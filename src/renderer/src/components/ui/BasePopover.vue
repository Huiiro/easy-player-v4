<script setup lang="ts">
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/vue'
import { computed } from 'vue'

defineOptions({
  name: 'BasePopover'
})

type Placement = 'top' | 'bottom' | 'left' | 'right'

const props = withDefaults(
  defineProps<{
    title?: string
    content?: string
    trigger?: 'click' | 'hover'
    placement?: Placement
    width?: string
    disabled?: boolean
    showArrow?: boolean
    offset?: number
  }>(),
  {
    trigger: 'click',
    placement: 'bottom',
    width: 'w-64',
    disabled: false,
    showArrow: false,
    offset: 8
  }
)

defineEmits<{
  (e: 'show'): void
  (e: 'hide'): void
}>()

// ==================== 面板位置 ====================
const panelClasses = computed(() => {
  const pos: Record<Placement, string> = {
    top: 'bottom-full mb-2',
    bottom: 'top-full mt-2',
    left: 'right-full mr-2',
    right: 'left-full ml-2'
  }
  return ['absolute z-40', props.width, pos[props.placement]]
})

// ==================== 箭头位置 ====================
const arrowClasses = computed(() => {
  const map: Record<Placement, string> = {
    top: 'bottom-[-5px] left-1/2 -translate-x-1/2 border-t-transparent border-l-transparent',
    bottom: 'top-[-5px] left-1/2 -translate-x-1/2 border-b-transparent border-r-transparent',
    left: 'right-[-5px] top-1/2 -translate-y-1/2 border-l-transparent border-b-transparent',
    right: 'left-[-5px] top-1/2 -translate-y-1/2 border-r-transparent border-t-transparent'
  }
  return ['absolute w-2.5 h-2.5 bg-bg border border-border rotate-45', map[props.placement]]
})
</script>

<template>
  <Popover v-slot="{ open }" class="relative inline-block text-text">
    <!-- 触发元素 -->
    <PopoverButton
      as="div"
      :disabled="disabled"
      :class="[
        'inline-flex items-center',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      ]"
    >
      <slot name="trigger" :open="open" />
    </PopoverButton>

    <!-- 弹出面板 -->
    <transition
      enter-active-class="transition duration-[var(--motion-duration-standard)] ease-[var(--motion-ease-enter)]"
      enter-from-class="opacity-0 scale-95"
      enter-to-class="opacity-100 scale-100"
      leave-active-class="transition duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-exit)]"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-95"
    >
      <PopoverPanel :class="panelClasses">
        <div class="rounded-xl border border-border bg-bg shadow-xl p-4">
          <!-- 标题 -->
          <div v-if="title" class="text-sm font-semibold mb-2">
            {{ title }}
          </div>

          <!-- 内容 -->
          <div class="text-sm text-text-l">
            <slot :open="open">
              {{ content }}
            </slot>
          </div>

          <!-- 箭头 -->
          <div v-if="showArrow" :class="arrowClasses" />
        </div>
      </PopoverPanel>
    </transition>
  </Popover>
</template>
