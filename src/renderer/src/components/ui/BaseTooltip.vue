<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onDeactivated, ref, useId, watch } from 'vue'
import FloatingPanel from './FloatingPanel.vue'
import { cssSize, type FloatingSide } from './types'

defineOptions({ name: 'BaseTooltip' })
const props = withDefaults(
  defineProps<{
    content?: string
    ariaLabel?: string
    interactive?: boolean
    variant?: 'text' | 'control'
    placement?: FloatingSide
    disabled?: boolean
    openDelay?: number
    closeDelay?: number
    offset?: number
    controlWidth?: number | string
    controlHeight?: number | string
  }>(),
  {
    interactive: false,
    variant: 'text',
    placement: 'top',
    disabled: false,
    openDelay: 100,
    closeDelay: 140,
    offset: 8
  }
)
const anchor = ref<HTMLElement | null>(null)
const emit = defineEmits<{ wheel: [event: WheelEvent]; show: []; hide: [] }>()
const panel = ref<HTMLElement | null>(null)
const open = ref(false)
const panelId = useId()
let timer: ReturnType<typeof setTimeout> | undefined
let focusFrame = 0
let hovering = false
let dragging = false
let dismissed = false
const triggerProps = computed(() =>
  props.interactive
    ? {
        'aria-haspopup': 'dialog' as const,
        'aria-expanded': open.value,
        'aria-controls': open.value ? panelId : undefined
      }
    : { 'aria-describedby': open.value ? panelId : undefined }
)
const panelStyle = computed(() => ({
  '--ep-tooltip-control-width':
    props.controlWidth === undefined ? undefined : cssSize(props.controlWidth),
  '--ep-tooltip-control-height':
    props.controlHeight === undefined ? undefined : cssSize(props.controlHeight)
}))
function cancelTimer(): void {
  clearTimeout(timer)
  timer = undefined
}
function hide(): void {
  cancelTimer()
  cancelAnimationFrame(focusFrame)
  focusFrame = 0
  open.value = false
}
function show(immediate = false): void {
  cancelTimer()
  if (props.disabled || dismissed) return
  if (immediate || props.openDelay <= 0) open.value = true
  else
    timer = setTimeout(() => {
      open.value = true
    }, props.openDelay)
}
function contains(target: EventTarget | null): boolean {
  return (
    target instanceof Node && !!(anchor.value?.contains(target) || panel.value?.contains(target))
  )
}
function deferHide(): void {
  cancelTimer()
  timer = setTimeout(() => {
    if (!hovering && !dragging && !contains(document.activeElement)) {
      dismissed = false
      hide()
    }
  }, props.closeDelay)
}
function enter(): void {
  hovering = true
  dismissed = false
  show()
}
function leave(): void {
  hovering = false
  deferHide()
}
function focus(): void {
  show(true)
}
function blur(): void {
  deferHide()
}
function dismiss(): void {
  dismissed = true
  hide()
}
function onOutside(event: Event): void {
  if (!contains(event.target)) {
    dragging = false
    dismissed = false
    hide()
  }
}
function onEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  const restore = panel.value?.contains(document.activeElement)
  dismiss()
  if (restore)
    anchor.value?.querySelector<HTMLElement>('button, a[href], input, [tabindex="0"]')?.focus()
}
async function onKey(event: KeyboardEvent): Promise<void> {
  if (
    !props.interactive ||
    panel.value?.contains(event.target as Node) ||
    !['ArrowDown', 'ArrowUp'].includes(event.key)
  )
    return
  event.preventDefault()
  dismissed = false
  show(true)
  await nextTick()
  // Wait for FloatingPanel's nested positioning updates to reveal the portal.
  if (!open.value || props.disabled) return
  cancelAnimationFrame(focusFrame)
  focusFrame = requestAnimationFrame(() => {
    focusFrame = 0
    panel.value
      ?.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled), [tabindex="0"]')
      ?.focus()
  })
}
function onRelease(): void {
  dragging = false
  deferHide()
}
function onDrag(): void {
  dragging = true
}
watch(open, (value, _old, cleanup) => {
  if (!value) return
  document.addEventListener('pointerdown', onOutside)
  document.addEventListener('keydown', onEscape)
  document.addEventListener('pointerup', onRelease)
  document.addEventListener('pointercancel', onRelease)
  cleanup(() => {
    document.removeEventListener('pointerdown', onOutside)
    document.removeEventListener('keydown', onEscape)
    document.removeEventListener('pointerup', onRelease)
    document.removeEventListener('pointercancel', onRelease)
  })
})
watch(
  open,
  (value) => {
    if (value) emit('show')
    else emit('hide')
  },
  { flush: 'sync' }
)
watch(
  () => props.disabled,
  (value) => {
    if (value) hide()
  }
)
onDeactivated(() => {
  hovering = dragging = false
  hide()
})
onBeforeUnmount(hide)
defineExpose({ show: () => show(true), hide })
</script>

<template>
  <span
    ref="anchor"
    class="ep-tooltip-trigger"
    @pointerenter="enter"
    @pointerleave="leave"
    @focusin="focus"
    @focusout="blur"
    @keydown="onKey"
    @wheel="emit('wheel', $event)"
    @click="interactive && show(true)"
  >
    <slot name="trigger" :trigger-props="triggerProps" :open="open" />
    <FloatingPanel
      :open="open"
      :anchor="anchor"
      :side="placement"
      align="center"
      :offset="offset"
      teleport
    >
      <Transition name="ep-float">
        <div
          v-if="open"
          :id="panelId"
          ref="panel"
          class="ep-tooltip"
          :class="`ep-tooltip--${variant}`"
          :style="panelStyle"
          :role="interactive ? 'dialog' : 'tooltip'"
          :aria-label="interactive ? ariaLabel || content : undefined"
          :data-interactive="interactive || undefined"
          @pointerenter="enter"
          @pointerleave="leave"
          @focusin="focus"
          @focusout="blur"
          @pointerdown="onDrag"
          @wheel="emit('wheel', $event)"
        >
          <slot>{{ content }}</slot>
        </div>
      </Transition>
    </FloatingPanel>
  </span>
</template>

<style scoped>
.ep-tooltip-trigger {
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
}
.ep-tooltip {
  position: relative;
  box-sizing: border-box;
  max-width: min(var(--ep-tooltip-max-width, 280px), calc(100vw - 16px));
  padding: var(--ep-tooltip-padding, 6px 10px);
  border: 1px solid var(--ep-tooltip-border, var(--color-border));
  border-radius: var(--ep-tooltip-radius, 10px);
  background: var(--ep-tooltip-bg, var(--color-bg-l));
  color: var(--ep-tooltip-text, var(--color-text));
  box-shadow: var(--ep-tooltip-shadow, 0 6px 20px rgb(0 0 0 / 16%));
  font-size: var(--ep-tooltip-font-size, 12px);
  line-height: 1.5;
  overflow-wrap: anywhere;
  isolation: isolate;
  pointer-events: none;
}
.ep-tooltip[data-interactive='true'] {
  pointer-events: auto;
}
.ep-tooltip--control {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: var(--ep-tooltip-control-width, 40px);
  height: var(--ep-tooltip-control-height, 160px);
  padding: 8px 3px;
  font-variant-numeric: tabular-nums;
}
.ep-tooltip--control :deep(input[type='range']) {
  writing-mode: vertical-lr;
  direction: rtl;
  flex: 1;
  width: 6px;
  min-height: 0;
  margin: 4px 0;
  cursor: pointer;
  accent-color: var(--ep-progress-fill, var(--color-primary));
}
</style>
