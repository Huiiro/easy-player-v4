<script setup lang="ts">
import { computed, ref, watch } from 'vue'

defineOptions({ name: 'DspKnobField' })

const props = withDefaults(
  defineProps<{
    modelValue: number
    label: string
    description: string
    min: number
    max: number
    step?: number
    decimals?: number
    unit?: string
    scale?: 'linear' | 'log'
    live?: boolean
  }>(),
  {
    step: 1,
    decimals: 0,
    unit: '',
    scale: 'linear',
    live: true
  }
)

const emit = defineEmits<{
  (event: 'update:modelValue', value: number): void
  (event: 'change'): void
}>()

const value = ref(props.modelValue)
const draft = ref('')
const editing = ref(false)
const dragging = ref(false)
let dragStartY = 0
let dragStartPosition = 0
let dragChanged = false
let lastLiveCommit = 0

watch(
  () => props.modelValue,
  (next) => {
    if (!dragging.value && !editing.value) value.value = next
  }
)

const logarithmic = computed(() => props.scale === 'log' && props.min > 0 && props.max > props.min)

function clamp(number: number): number {
  return Math.min(props.max, Math.max(props.min, number))
}

function normalize(number: number): number {
  const bounded = clamp(number)
  return logarithmic.value
    ? Math.log(bounded / props.min) / Math.log(props.max / props.min)
    : (bounded - props.min) / (props.max - props.min || 1)
}

function denormalize(position: number): number {
  const bounded = Math.min(1, Math.max(0, position))
  return logarithmic.value
    ? props.min * (props.max / props.min) ** bounded
    : props.min + (props.max - props.min) * bounded
}

function quantize(number: number): number {
  const bounded = clamp(number)
  const stepped =
    props.step > 0
      ? props.min + Math.round((bounded - props.min) / props.step) * props.step
      : bounded
  const factor = 10 ** props.decimals
  return clamp(Math.round(stepped * factor) / factor)
}

function format(number: number): string {
  return (Number.isFinite(number) ? number : props.min).toFixed(props.decimals)
}

const position = computed(() => normalize(Number.isFinite(value.value) ? value.value : props.min))
const angle = computed(() => -135 + position.value * 270)

function point(degrees: number, radius: number): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180
  return { x: 36 + Math.sin(radians) * radius, y: 36 - Math.cos(radians) * radius }
}

function arc(from: number, to: number): string {
  const start = point(from, 27)
  const end = point(to, 27)
  return `M ${start.x} ${start.y} A 27 27 0 ${to - from > 180 ? 1 : 0} 1 ${end.x} ${end.y}`
}

const trackPath = arc(-135, 135)
const valuePath = computed(() => (position.value > 0 ? arc(-135, angle.value) : ''))
const needleStart = computed(() => point(angle.value, 12))
const needleEnd = computed(() => point(angle.value, 22))

function update(next: number, live = true): void {
  const adjusted = quantize(next)
  if (adjusted === value.value) return
  value.value = adjusted
  emit('update:modelValue', adjusted)
  if (live && props.live && performance.now() - lastLiveCommit >= 80) {
    lastLiveCommit = performance.now()
    emit('change')
  }
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  event.preventDefault()
  const target = event.currentTarget as HTMLElement
  target.focus()
  target.setPointerCapture(event.pointerId)
  dragging.value = true
  dragChanged = false
  dragStartY = event.clientY
  dragStartPosition = normalize(value.value)
  lastLiveCommit = performance.now()
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return
  const next = denormalize(
    dragStartPosition + ((dragStartY - event.clientY) / 180) * (event.shiftKey ? 0.1 : 1)
  )
  const previous = value.value
  update(next)
  if (value.value !== previous) dragChanged = true
}

function onPointerUp(event: PointerEvent): void {
  if (!dragging.value) return
  onPointerMove(event)
  dragging.value = false
  const target = event.currentTarget as HTMLElement
  if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
  if (dragChanged) emit('change')
}

function onKeydown(event: KeyboardEvent): void {
  const step = props.step > 0 ? props.step : 1
  let next: number
  switch (event.key) {
    case 'ArrowUp':
    case 'ArrowRight':
      next = value.value + step
      break
    case 'ArrowDown':
    case 'ArrowLeft':
      next = value.value - step
      break
    case 'PageUp':
      next = value.value + step * 10
      break
    case 'PageDown':
      next = value.value - step * 10
      break
    case 'Home':
      next = props.min
      break
    case 'End':
      next = props.max
      break
    default:
      return
  }
  event.preventDefault()
  const previous = value.value
  update(next, false)
  if (value.value !== previous) emit('change')
}

function beginEditing(): void {
  draft.value = format(value.value)
  editing.value = true
}

function commitInput(): void {
  if (!editing.value) return
  editing.value = false
  const parsed = Number(draft.value.replace(',', '.'))
  if (!Number.isFinite(parsed) || draft.value.trim() === '') return
  const previous = value.value
  update(parsed, false)
  if (value.value !== previous) emit('change')
}

function cancelInput(event: KeyboardEvent): void {
  editing.value = false
  ;(event.target as HTMLInputElement).blur()
}
</script>

<template>
  <div
    class="knob-field w-48 max-w-full shrink-0 rounded-lg border border-border/50 bg-bg-l/50 px-2 pt-2 text-center"
  >
    <div class="truncate text-xs font-medium text-text" :title="label">{{ label }}</div>
    <button
      type="button"
      class="knob-field__dial mx-auto mt-1 block rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      :class="{ 'cursor-grabbing': dragging }"
      role="slider"
      :aria-label="label"
      :aria-valuemin="min"
      :aria-valuemax="max"
      :aria-valuenow="value"
      :aria-valuetext="`${format(value)}${unit ? ` ${unit}` : ''}`"
      :title="description"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @keydown="onKeydown"
    >
      <svg viewBox="0 0 72 72" class="h-[72px] w-[72px]" aria-hidden="true">
        <path
          :d="trackPath"
          fill="none"
          stroke="var(--color-border-l)"
          stroke-width="4"
          stroke-linecap="round"
        />
        <path
          :d="valuePath"
          fill="none"
          stroke="var(--color-primary)"
          stroke-width="4"
          stroke-linecap="round"
        />
        <circle
          cx="36"
          cy="36"
          r="22"
          fill="var(--color-bg-l2)"
          stroke="var(--color-border)"
          stroke-width="1"
        />
        <circle cx="36" cy="36" r="17" fill="var(--color-bg)" />
        <line
          :x1="needleStart.x"
          :y1="needleStart.y"
          :x2="needleEnd.x"
          :y2="needleEnd.y"
          stroke="var(--color-primary)"
          stroke-width="3"
          stroke-linecap="round"
        />
      </svg>
    </button>
    <div class="mt-1 flex items-center justify-center gap-1">
      <input
        :value="editing ? draft : format(value)"
        class="knob-field__input w-[5.5rem] max-w-full shrink-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-center text-sm leading-5 font-semibold tabular-nums text-text outline-none transition-colors hover:border-border focus:border-primary focus:bg-bg"
        type="text"
        inputmode="decimal"
        :aria-label="`${label} ${unit}`.trim()"
        @focus="beginEditing"
        @input="draft = ($event.target as HTMLInputElement).value"
        @blur="commitInput"
        @keydown.enter="($event.target as HTMLInputElement).blur()"
        @keydown.esc="cancelInput"
      />
      <span v-if="unit" class="shrink-0 text-[10px] text-text-l">{{ unit }}</span>
    </div>
    <p class="mt-0.5 line-clamp-2 min-h-8 text-[10px] leading-4 text-text-l" :title="description">
      {{ description }}
    </p>
  </div>
</template>

<style scoped>
.knob-field__dial {
  cursor: ns-resize;
  touch-action: none;
}

.knob-field__input:focus {
  user-select: text;
}
</style>
