<script setup lang="ts">
import {
  nextTick,
  onActivated,
  onDeactivated,
  onBeforeUnmount,
  ref,
  watch,
  type CSSProperties
} from 'vue'
import { floatingPosition } from './floatingPosition'
import type { FloatingAlign, FloatingSide } from './types'

const props = withDefaults(
  defineProps<{
    open: boolean
    anchor: HTMLElement | null
    side?: FloatingSide
    align?: FloatingAlign
    offset?: number
    teleport?: boolean
    matchWidth?: boolean
  }>(),
  { side: 'bottom', align: 'start', offset: 8, teleport: false, matchWidth: false }
)
const panel = ref<HTMLElement | null>(null)
const active = ref(true)
const style = ref<CSSProperties>({ visibility: 'hidden' })
const actualSide = ref<FloatingSide>(props.side)
let observer: ResizeObserver | undefined
let frame = 0

function update(): void {
  frame = 0
  const el = panel.value
  if (!props.open || !el || !props.anchor) return
  const anchor = props.anchor.getBoundingClientRect()
  if (props.matchWidth) el.style.width = `${anchor.width}px`
  const rect = el.getBoundingClientRect()
  const position = floatingPosition(
    anchor,
    rect,
    { width: window.innerWidth, height: window.innerHeight },
    props.side,
    props.align,
    props.offset
  )
  let { left, top } = position
  if (!props.teleport && el.offsetParent instanceof HTMLElement) {
    const parent = el.offsetParent
    const origin = parent.getBoundingClientRect()
    left -= origin.left + parent.clientLeft - parent.scrollLeft
    top -= origin.top + parent.clientTop - parent.scrollTop
  }
  actualSide.value = position.side
  style.value = {
    position: props.teleport ? 'fixed' : 'absolute',
    left: `${left}px`,
    top: `${top}px`,
    width: props.matchWidth ? `${anchor.width}px` : 'max-content',
    maxWidth: 'calc(100vw - 16px)',
    visibility: 'visible',
    '--ep-floating-available-height': `${position.availableHeight}px`,
    transformOrigin:
      position.side === 'top'
        ? 'bottom'
        : position.side === 'bottom'
          ? 'top'
          : position.side === 'left'
            ? 'right'
            : 'left'
  }
}
function schedule(): void {
  if (!frame) frame = requestAnimationFrame(update)
}
function stop(): void {
  observer?.disconnect()
  observer = undefined
  cancelAnimationFrame(frame)
  frame = 0
  window.removeEventListener('resize', schedule)
  window.removeEventListener('scroll', schedule, true)
}
watch(
  () => [
    active.value,
    props.open,
    props.anchor,
    props.teleport,
    props.side,
    props.align,
    props.offset,
    props.matchWidth
  ],
  async (_value, _previous, onCleanup) => {
    let cancelled = false
    onCleanup(() => {
      cancelled = true
      stop()
    })
    stop()
    if (cancelled || !props.open || !active.value) return
    style.value = { ...style.value, visibility: 'hidden' }
    await nextTick()
    if (cancelled || !props.open || !active.value) return
    update()
    observer = new ResizeObserver(schedule)
    if (panel.value) observer.observe(panel.value)
    if (props.anchor) observer.observe(props.anchor)
    window.addEventListener('resize', schedule, { passive: true })
    window.addEventListener('scroll', schedule, { passive: true, capture: true })
  },
  { immediate: true, flush: 'post' }
)
onBeforeUnmount(stop)
onDeactivated(() => {
  active.value = false
  stop()
})
onActivated(() => {
  active.value = true
})
</script>

<template>
  <Teleport to="body" :disabled="!teleport">
    <div v-show="active" ref="panel" class="ep-floating" :style="style" :data-side="actualSide">
      <slot :side="actualSide" />
    </div>
  </Teleport>
</template>
