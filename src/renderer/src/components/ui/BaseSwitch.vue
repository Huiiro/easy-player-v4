<script setup lang="ts">
import { computed } from 'vue'

defineOptions({
  name: 'BaseSwitch'
})

const props = withDefaults(
  defineProps<{
    modelValue: boolean | string | number
    disabled?: boolean
    size?: 'sm' | 'md' | 'lg'
    activeText?: string
    inactiveText?: string
    activeValue?: boolean | string | number
    inactiveValue?: boolean | string | number
    activeColor?: string
    inactiveColor?: string
  }>(),
  {
    disabled: false,
    size: 'md',
    activeValue: true,
    inactiveValue: false
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean | string | number): void
  (e: 'change', val: boolean | string | number): void
}>()

// ==================== 选中状态 ====================
const isChecked = computed(() => props.modelValue === props.activeValue)

// ==================== 尺寸配置 ====================
interface SizeConfig {
  trackWidth: number
  trackHeight: number
  knobSize: number
  knobTranslate: number
}

const sizeMap: Record<string, SizeConfig> = {
  sm: { trackWidth: 28, trackHeight: 14, knobSize: 10, knobTranslate: 14 },
  md: { trackWidth: 40, trackHeight: 20, knobSize: 16, knobTranslate: 20 },
  lg: { trackWidth: 52, trackHeight: 24, knobSize: 20, knobTranslate: 28 }
}

const currentSize = computed(() => sizeMap[props.size])

// ==================== 样式 ====================
const trackClass = computed(() => {
  return 'relative inline-flex rounded-full transition-colors duration-[var(--motion-duration-standard)] cursor-pointer shrink-0'
})

const trackStyle = computed(() => {
  const bg = isChecked.value
    ? props.activeColor || 'var(--color-primary)'
    : props.inactiveColor || 'var(--color-border)'
  return {
    width: `${currentSize.value.trackWidth}px`,
    height: `${currentSize.value.trackHeight}px`,
    backgroundColor: bg
  }
})

const knobStyle = computed(() => {
  const s = currentSize.value
  const gap = (s.trackHeight - s.knobSize) / 2
  const translateX = isChecked.value ? s.knobTranslate : 0
  return {
    width: `${s.knobSize}px`,
    height: `${s.knobSize}px`,
    top: `${gap}px`,
    left: `${gap}px`,
    transform: `translateX(${translateX}px)`
  }
})

// ==================== 显示文本 ====================
const currentText = computed(() => {
  return isChecked.value ? props.activeText : props.inactiveText
})

// ==================== 事件 ====================
function toggle(): void {
  if (props.disabled) return
  const newValue = isChecked.value ? props.inactiveValue : props.activeValue
  emit('update:modelValue', newValue)
  emit('change', newValue)
}
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="isChecked"
    :disabled="disabled"
    :class="[
      'inline-flex items-center gap-2',
      disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
    ]"
    @click="toggle"
  >
    <!-- 轨道 + 滑块 -->
    <span :class="trackClass" :style="trackStyle">
      <span
        class="absolute rounded-full bg-white shadow-sm transition-transform duration-[var(--motion-duration-standard)] ease-[var(--motion-ease-standard)]"
        :style="knobStyle"
      />
    </span>

    <!-- 文字标签 -->
    <span v-if="currentText" class="text-sm text-text-l select-none">
      {{ currentText }}
    </span>

    <!-- 默认插槽（可替代文字标签） -->
    <slot v-if="!currentText" />
  </button>
</template>
