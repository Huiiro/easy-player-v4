<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { EqBand } from '@/types/audio'

const props = defineProps<{
  bands: EqBand[]
  sampleRate: number
  selectedIndex: number
}>()
const emit = defineEmits<{
  (event: 'update:selectedIndex', value: number): void
  (event: 'update:band', index: number, value: Partial<EqBand>): void
  (event: 'toggle:band', index: number): void
  (event: 'commit'): void
}>()
const { t } = useI18n()
const svg = ref<SVGSVGElement | null>(null)
const hoveredIndex = ref<number | null>(null)
let pendingDrag: { index: number; pointerId: number; clientX: number; clientY: number } | null =
  null
const draggingIndex = ref<number | null>(null)
const width = 800
const height = 300
const left = 46
const right = 20
const top = 18
const bottom = 32
const plotWidth = width - left - right
const plotHeight = height - top - bottom
const minFrequency = 20
const maxFrequency = 20000
const minDisplayDb = -18
const maxDisplayDb = 18
const frequencyTicks = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]
const gainTicks = [-12, -6, 0, 6, 12]

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
function frequencyX(frequency: number): number {
  return (
    left +
    (Math.log(clamp(frequency, minFrequency, maxFrequency) / minFrequency) /
      Math.log(maxFrequency / minFrequency)) *
      plotWidth
  )
}
function xFrequency(x: number): number {
  return minFrequency * (maxFrequency / minFrequency) ** clamp((x - left) / plotWidth, 0, 1)
}
function gainY(db: number): number {
  return (
    top +
    ((maxDisplayDb - clamp(db, minDisplayDb, maxDisplayDb)) / (maxDisplayDb - minDisplayDb)) *
      plotHeight
  )
}
function yGain(y: number): number {
  return clamp(maxDisplayDb - ((y - top) / plotHeight) * (maxDisplayDb - minDisplayDb), -12, 12)
}
function formatFrequency(frequency: number): string {
  return frequency >= 1000
    ? `${Number((frequency / 1000).toFixed(1))}k`
    : `${Math.round(frequency)}`
}

const points = computed(() =>
  props.bands.map((band) => ({
    x: frequencyX(band.frequencyHz),
    y: gainY(band.gainDb),
    enabled: band.enabled
  }))
)

interface Coefficients {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}
const responsePath = computed(() => {
  const sampleRate = props.sampleRate > 0 ? props.sampleRate : 48000
  const filters: Coefficients[] = props.bands
    .filter((band) => band.enabled && Math.abs(band.gainDb) >= 0.0001)
    .map((band) => {
      const omega = (2 * Math.PI * Math.min(band.frequencyHz, sampleRate * 0.45)) / sampleRate
      const alpha = Math.sin(omega) / (2 * Math.max(0.1, band.q))
      const a = 10 ** (band.gainDb / 40)
      const a0 = 1 + alpha / a
      return {
        b0: (1 + alpha * a) / a0,
        b1: (-2 * Math.cos(omega)) / a0,
        b2: (1 - alpha * a) / a0,
        a1: (-2 * Math.cos(omega)) / a0,
        a2: (1 - alpha / a) / a0
      }
    })
  const maxCurveFrequency = Math.min(maxFrequency, sampleRate * 0.45)
  const steps = 192
  const path: string[] = []
  for (let index = 0; index < steps; index++) {
    const frequency = minFrequency * (maxCurveFrequency / minFrequency) ** (index / (steps - 1))
    const omega = (2 * Math.PI * frequency) / sampleRate
    const cos1 = Math.cos(omega)
    const sin1 = Math.sin(omega)
    const cos2 = Math.cos(2 * omega)
    const sin2 = Math.sin(2 * omega)
    let responseDb = 0
    for (const filter of filters) {
      const numeratorReal = filter.b0 + filter.b1 * cos1 + filter.b2 * cos2
      const numeratorImaginary = -filter.b1 * sin1 - filter.b2 * sin2
      const denominatorReal = 1 + filter.a1 * cos1 + filter.a2 * cos2
      const denominatorImaginary = -filter.a1 * sin1 - filter.a2 * sin2
      const numeratorPower = numeratorReal ** 2 + numeratorImaginary ** 2
      const denominatorPower = denominatorReal ** 2 + denominatorImaginary ** 2
      responseDb += 10 * Math.log10(Math.max(1e-20, numeratorPower / denominatorPower))
    }
    path.push(
      `${index === 0 ? 'M' : 'L'}${frequencyX(frequency).toFixed(2)},${gainY(responseDb).toFixed(2)}`
    )
  }
  return path.join(' ')
})

function localPoint(event: PointerEvent): { x: number; y: number } | null {
  const element = svg.value
  const matrix = element?.getScreenCTM()
  if (!element || !matrix) return null
  const point = element.createSVGPoint()
  point.x = event.clientX
  point.y = event.clientY
  const local = point.matrixTransform(matrix.inverse())
  return { x: local.x, y: local.y }
}
function nearestPoint(event: MouseEvent | PointerEvent): number {
  const matrix = svg.value?.getScreenCTM()
  if (!matrix) return -1
  let nearest = -1
  let distance = 22 ** 2
  points.value.forEach((point, index) => {
    const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix)
    const candidate = (screen.x - event.clientX) ** 2 + (screen.y - event.clientY) ** 2
    if (candidate < distance) {
      nearest = index
      distance = candidate
    }
  })
  return nearest
}
function startDrag(event: PointerEvent): void {
  if (event.button !== 0) return
  const index = nearestPoint(event)
  if (index < 0) return
  hoveredIndex.value = index
  emit('update:selectedIndex', index)
  pendingDrag = {
    index,
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY
  }
  svg.value?.setPointerCapture(event.pointerId)
}
function updateDraggedBand(index: number, event: PointerEvent): void {
  const local = localPoint(event)
  if (!local) return
  const previous = props.bands[index - 1]?.frequencyHz ?? minFrequency / 1.02
  const next = props.bands[index + 1]?.frequencyHz ?? maxFrequency * 1.02
  const frequencyHz = clamp(
    Math.round(xFrequency(local.x) * 10) / 10,
    Math.max(minFrequency, previous * 1.02),
    Math.min(maxFrequency, next / 1.02)
  )
  const gainDb = Math.round(yGain(local.y) * 10) / 10
  emit('update:band', index, { frequencyHz, gainDb, enabled: Math.abs(gainDb) >= 0.0001 })
}
function movePointer(event: PointerEvent): void {
  if (pendingDrag?.pointerId === event.pointerId) {
    if (
      draggingIndex.value === null &&
      Math.hypot(event.clientX - pendingDrag.clientX, event.clientY - pendingDrag.clientY) >= 6
    ) {
      draggingIndex.value = pendingDrag.index
    }
    if (draggingIndex.value !== null) updateDraggedBand(draggingIndex.value, event)
    return
  }
  const nearest = nearestPoint(event)
  hoveredIndex.value = nearest < 0 ? null : nearest
  if (nearest >= 0 && nearest !== props.selectedIndex) emit('update:selectedIndex', nearest)
}
function endDrag(event: PointerEvent): void {
  if (pendingDrag?.pointerId !== event.pointerId) return
  if (draggingIndex.value !== null && event.type === 'pointerup')
    updateDraggedBand(draggingIndex.value, event)
  const changed = draggingIndex.value !== null
  draggingIndex.value = null
  pendingDrag = null
  if (svg.value?.hasPointerCapture(event.pointerId))
    svg.value.releasePointerCapture(event.pointerId)
  if (changed) emit('commit')
}
function toggleBand(event: MouseEvent): void {
  const index = nearestPoint(event)
  if (index < 0) return
  event.preventDefault()
  hoveredIndex.value = index
  emit('update:selectedIndex', index)
  emit('toggle:band', index)
}
function nudge(index: number, event: KeyboardEvent): void {
  const band = props.bands[index]
  if (!band) return
  let gainDb = band.gainDb
  let frequencyHz = band.frequencyHz
  let gainChanged = false
  if (event.key === 'ArrowUp') {
    gainDb = clamp(gainDb + 0.5, -12, 12)
    gainChanged = true
  } else if (event.key === 'ArrowDown') {
    gainDb = clamp(gainDb - 0.5, -12, 12)
    gainChanged = true
  } else if (event.key === 'ArrowLeft') frequencyHz /= 1.03
  else if (event.key === 'ArrowRight') frequencyHz *= 1.03
  else return
  event.preventDefault()
  emit('update:selectedIndex', index)
  const previous = props.bands[index - 1]?.frequencyHz ?? minFrequency / 1.02
  const next = props.bands[index + 1]?.frequencyHz ?? maxFrequency * 1.02
  frequencyHz = clamp(
    frequencyHz,
    Math.max(minFrequency, previous * 1.02),
    Math.min(maxFrequency, next / 1.02)
  )
  gainDb = Math.round(gainDb * 10) / 10
  emit('update:band', index, {
    frequencyHz: Math.round(frequencyHz * 10) / 10,
    gainDb,
    enabled: gainChanged ? Math.abs(gainDb) >= 0.0001 : band.enabled
  })
  emit('commit')
}
</script>

<template>
  <svg
    ref="svg"
    class="block w-full touch-none rounded-lg border border-border bg-bg-l/30"
    :class="draggingIndex !== null ? 'cursor-grabbing' : hoveredIndex !== null ? 'cursor-grab' : ''"
    :viewBox="`0 0 ${width} ${height}`"
    role="group"
    :aria-label="t('ap.v2EqGraph')"
    @pointerdown="startDrag"
    @pointermove="movePointer"
    @pointerup="endDrag"
    @pointercancel="endDrag"
    @lostpointercapture="endDrag"
    @pointerleave="hoveredIndex = null"
    @dblclick="toggleBand"
  >
    <g v-for="db in gainTicks" :key="`gain-${db}`">
      <line
        :x1="left"
        :x2="width - right"
        :y1="gainY(db)"
        :y2="gainY(db)"
        stroke="var(--color-border)"
        :stroke-width="db === 0 ? 1.4 : 0.7"
      />
      <text
        :x="left - 8"
        :y="gainY(db) + 4"
        text-anchor="end"
        fill="currentColor"
        class="text-[11px] text-text-l"
      >
        {{ db > 0 ? `+${db}` : db }}
      </text>
    </g>
    <g v-for="frequency in frequencyTicks" :key="`frequency-${frequency}`">
      <line
        :x1="frequencyX(frequency)"
        :x2="frequencyX(frequency)"
        :y1="top"
        :y2="height - bottom"
        stroke="var(--color-border)"
        stroke-width="0.7"
      />
      <text
        :x="frequencyX(frequency)"
        :y="height - 10"
        text-anchor="middle"
        fill="currentColor"
        class="text-[11px] text-text-l"
      >
        {{ formatFrequency(frequency) }}
      </text>
    </g>
    <path :d="responsePath" fill="none" stroke="var(--color-primary)" stroke-width="2.5" />
    <g
      v-for="(point, index) in points"
      :key="index"
      :opacity="point.enabled ? 1 : selectedIndex === index ? 0.38 : 0.2"
    >
      <circle
        v-if="selectedIndex === index"
        :cx="point.x"
        :cy="point.y"
        r="11"
        fill="none"
        stroke="var(--color-primary)"
        stroke-width="1.5"
      />
      <circle
        :cx="point.x"
        :cy="point.y"
        :r="selectedIndex === index ? 6 : 4.5"
        :fill="point.enabled ? 'var(--color-primary)' : 'var(--color-bg)'"
        :stroke="
          point.enabled || selectedIndex === index ? 'var(--color-primary)' : 'var(--color-text-l)'
        "
        stroke-width="2"
        tabindex="0"
        role="slider"
        :aria-label="`${formatFrequency(bands[index].frequencyHz)} Hz`"
        :aria-valuemin="-12"
        :aria-valuemax="12"
        :aria-valuenow="bands[index].gainDb"
        @focus="emit('update:selectedIndex', index)"
        @keydown="nudge(index, $event)"
        @keydown.enter.prevent="emit('toggle:band', index)"
        @keydown.space.prevent="emit('toggle:band', index)"
      />
    </g>
  </svg>
</template>
