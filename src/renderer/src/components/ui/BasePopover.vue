<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  useId,
  watch
} from 'vue'
import FloatingPanel from './FloatingPanel.vue'
import type { FloatingSide } from './types'

const props = withDefaults(
  defineProps<{
    title?: string
    content?: string
    trigger?: 'click' | 'hover'
    placement?: FloatingSide
    width?: string
    disabled?: boolean
    showArrow?: boolean
    offset?: number
    teleport?: boolean
  }>(),
  {
    trigger: 'click',
    placement: 'bottom',
    width: 'w-64',
    disabled: false,
    showArrow: false,
    offset: 8,
    teleport: false
  }
)
const emit = defineEmits<{ show: []; hide: [] }>()
const open = ref(false)
const anchor = ref<HTMLElement | null>(null)
const contentElement = ref<HTMLElement | null>(null)
const panelId = useId()
let timer: ReturnType<typeof setTimeout> | undefined
function cancelHide(): void {
  clearTimeout(timer)
}
function show(): void {
  cancelHide()
  if (!props.disabled) open.value = true
}
function hide(): void {
  cancelHide()
  open.value = false
}
function deferHide(): void {
  cancelHide()
  timer = setTimeout(hide, 120)
}
function toggle(): void {
  if (open.value) hide()
  else show()
}
function onPointerEnter(): void {
  if (props.trigger === 'hover') show()
}
function onPointerLeave(): void {
  if (props.trigger === 'hover') deferHide()
}
function onOutside(event: Event): void {
  const target = event.target
  if (
    target instanceof Node &&
    !anchor.value?.contains(target) &&
    !contentElement.value?.contains(target)
  )
    hide()
}
function onEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !open.value) return
  event.stopPropagation()
  hide()
  anchor.value?.focus()
}
function onKey(event: KeyboardEvent): void {
  if (event.target !== event.currentTarget) return
  if (['Enter', ' '].includes(event.key)) {
    event.preventDefault()
    toggle()
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    show()
    void nextTick(() =>
      contentElement.value
        ?.querySelector<HTMLElement>('button, input, [tabindex="0"], a[href]')
        ?.focus()
    )
  }
}
watch(open, (value, previous) => {
  if (value !== previous) value ? emit('show') : emit('hide')
})
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) hide()
  }
)
onMounted(() => {
  document.addEventListener('pointerdown', onOutside)
  document.addEventListener('focusin', onOutside)
})
onDeactivated(hide)
onBeforeUnmount(() => {
  cancelHide()
  document.removeEventListener('pointerdown', onOutside)
  document.removeEventListener('focusin', onOutside)
})
const arrowClasses = computed(() => ({
  top: 'bottom-[-5px] left-1/2',
  bottom: 'top-[-5px] left-1/2',
  left: 'right-[-5px] top-1/2',
  right: 'left-[-5px] top-1/2'
}))
defineExpose({ show, hide })
</script>

<template>
  <div class="relative inline-block text-text" @keydown.esc="onEscape">
    <div
      ref="anchor"
      role="button"
      :tabindex="disabled ? -1 : 0"
      :aria-disabled="disabled"
      :aria-expanded="open"
      :aria-controls="open ? panelId : undefined"
      class="inline-flex items-center ep-popover-trigger"
      @click="toggle"
      @keydown="onKey"
      @pointerenter="onPointerEnter"
      @pointerleave="onPointerLeave"
    >
      <slot name="trigger" :open="open" :close="hide" />
    </div>
    <FloatingPanel
      v-slot="{ side }"
      :open="open"
      :anchor="anchor"
      :side="placement"
      :teleport="teleport"
      :offset="offset"
    >
      <Transition name="ep-float">
        <div
          v-if="open"
          :id="panelId"
          ref="contentElement"
          class="ep-popover relative rounded-xl border shadow-xl p-4"
          :class="width"
          @pointerenter="cancelHide"
          @pointerleave="onPointerLeave"
          @keydown.esc="onEscape"
        >
          <div v-if="title" class="text-sm font-semibold mb-2">{{ title }}</div>
          <div class="text-sm text-text-l">
            <slot :open="open" :close="hide">{{ content }}</slot>
          </div>
          <div
            v-if="showArrow"
            class="absolute size-2.5 rotate-45 bg-bg border border-border"
            :class="arrowClasses[side]"
          />
        </div>
      </Transition>
    </FloatingPanel>
  </div>
</template>
