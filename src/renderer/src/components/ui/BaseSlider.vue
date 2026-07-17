<script setup lang="ts">
import { computed, ref } from 'vue'

defineOptions({
  name: 'BaseSlider'
})

type SliderSize = 'xs' | 'sm' | 'md'

interface Props {
  modelValue: number
  min?: number
  max?: number
  step?: number
  marks?: Record<number, string>
  size?: SliderSize
  vertical?: boolean
  disabled?: boolean

  transform?: (v: number) => number
  reverseTransform?: (v: number) => number
}

const props = withDefaults(defineProps<Props>(), {
  min: 0,
  max: 100,
  step: 1,
  size: 'md',
  vertical: false,
  disabled: false
})

const emit = defineEmits<{
  (e: 'update:modelValue', v: number): void
  (e: 'change', v: number): void
}>()

// =======================
// size
// =======================

const sizeMap = {
  xs: {
    track: 4,
    thumb: 12
  },

  sm: {
    track: 6,
    thumb: 14
  },

  md: {
    track: 8,
    thumb: 18
  }
}

const cur = computed(() => sizeMap[props.size])

// =======================
// value
// =======================

const value = computed({
  get() {
    return props.reverseTransform ? props.reverseTransform(props.modelValue) : props.modelValue
  },

  set(v: number) {
    emit('update:modelValue', props.transform ? props.transform(v) : v)
  }
})

const range = computed(() => props.max - props.min)

const percent = computed(() => {
  if (range.value <= 0) return 0

  return ((value.value - props.min) / range.value) * 100
})

// =======================
// state
// =======================

const sliderRef = ref<HTMLElement | null>(null)

const dragging = ref(false)

// =======================
// style
// =======================

const containerStyle = computed(() => {
  if (props.vertical) {
    return {
      width: `${cur.value.thumb}px`,
      height: '100%'
    }
  }

  return {
    height: `${cur.value.thumb}px`,
    width: '100%'
  }
})

const trackStyle = computed(() => {
  if (props.vertical) {
    return {
      width: `${cur.value.track}px`,

      height: '100%',

      left: `calc(50% - ${cur.value.track / 2}px)`
    }
  }

  return {
    height: `${cur.value.track}px`,

    width: '100%',

    top: `calc(50% - ${cur.value.track / 2}px)`
  }
})

const fillStyle = computed(() => {
  if (props.vertical) {
    return {
      height: `${percent.value}%`,

      width: '100%',

      bottom: '0'
    }
  }

  return {
    width: `${percent.value}%`,

    height: '100%'
  }
})

const thumbStyle = computed(() => {
  const t = cur.value.thumb
  const r = percent.value / 100 // ratio 0-1，避免 CSS calc 中 % * length 非法

  if (props.vertical) {
    return {
      bottom: `calc(${r} * (100% - ${t}px))`,
      left: `calc(50% - ${t / 2}px)`
    }
  }

  return {
    left: `calc(${r} * (100% - ${t}px))`,
    top: `calc(50% - ${t / 2}px)`
  }
})

// =======================
// geometry
// =======================

function pointToValue(x: number, y: number) {
  const el = sliderRef.value

  if (!el) return props.min

  const rect = el.getBoundingClientRect()

  const thumb = cur.value.thumb

  let ratio: number

  if (props.vertical) {
    const usable = rect.height - thumb

    ratio = (rect.bottom - y - thumb / 2) / usable
  } else {
    const usable = rect.width - thumb

    ratio = (x - rect.left - thumb / 2) / usable
  }

  ratio = Math.max(0, Math.min(1, ratio))

  return props.min + ratio * range.value
}

function snap(v: number) {
  v = Math.max(props.min, Math.min(props.max, v))

  return Math.round((v - props.min) / props.step) * props.step + props.min
}

// =======================
// events
// =======================

function onTrackClick(e: MouseEvent) {
  const v = snap(pointToValue(e.clientX, e.clientY))

  value.value = v

  emit('change', v)
}

function onPointerDown(e: PointerEvent) {
  dragging.value = true

  sliderRef.value?.setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return

  value.value = snap(pointToValue(e.clientX, e.clientY))
}

function onPointerUp() {
  if (!dragging.value) return

  dragging.value = false

  emit('change', value.value)
}

function onKeyDown(e: KeyboardEvent) {
  let v = value.value

  switch (e.key) {
    case 'ArrowRight':
    case 'ArrowUp':
      v += props.step
      break

    case 'ArrowLeft':
    case 'ArrowDown':
      v -= props.step
      break

    case 'Home':
      v = props.min
      break

    case 'End':
      v = props.max
      break

    default:
      return
  }

  e.preventDefault()

  value.value = snap(v)

  emit('change', value.value)
}

// =======================
// marks
// =======================

const markEntries = computed(() => {
  if (!props.marks) return []

  const t = cur.value.thumb

  return Object.entries(props.marks).map(([k, label]) => {
    const val = Number(k)
    const r = range.value > 0 ? (val - props.min) / range.value : 0

    // 与 thumbStyle 使用相同坐标系：ratio * (100% - thumb) + thumb/2 = 拇指中心
    const pos = `calc(${r} * (100% - ${t}px) + ${t / 2}px)`

    return {
      value: val,
      label,
      pos
    }
  })
})

function onMarkClick(v: number) {
  value.value = snap(v)

  emit('change', value.value)
}
</script>

<template>
  <div class="select-none" :class="vertical ? 'inline-flex h-full' : ''">
    <div
      ref="sliderRef"
      role="slider"
      :tabindex="disabled ? -1 : 0"
      class="relative outline-none"
      :class="disabled ? 'pointer-events-none opacity-50' : ''"
      :style="containerStyle"
      :aria-valuemin="min"
      :aria-valuemax="max"
      :aria-valuenow="modelValue"
      :aria-disabled="disabled"
      @click="onTrackClick"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @keydown="onKeyDown"
    >
      <!-- track -->

      <div class="absolute rounded-full bg-border overflow-hidden" :style="trackStyle">
        <div
          class="absolute rounded-full bg-primary"
          :class="vertical ? 'bottom-0 left-0' : 'left-0 top-0'"
          :style="fillStyle"
        />
      </div>

      <!-- thumb -->

      <div
        class="absolute rounded-full border-2 border-primary bg-bg cursor-grab transform-gpu transition-shadow duration-150"
        :class="
          dragging
            ? 'cursor-grabbing shadow-[0_0_0_4px_var(--color-hover-t-20)]'
            : 'hover:shadow-[0_0_0_4px_var(--color-hover-t-20)]'
        "
        :style="[
          thumbStyle,
          {
            width: `${cur.thumb}px`,
            height: `${cur.thumb}px`
          }
        ]"
        @pointerdown.stop="onPointerDown"
      />

      <!-- marks -->

      <template v-if="marks">
        <div
          v-for="m in markEntries"
          :key="m.value"
          class="absolute cursor-pointer"
          :style="
            vertical
              ? {
                  bottom: m.pos,
                  left: '50%',
                  transform: 'translate(-50%, 50%)'
                }
              : {
                  left: m.pos,
                  top: '50%',
                  transform: 'translate(-50%, -50%)'
                }
          "
          @click.stop="onMarkClick(m.value)"
        >
          <div class="w-2 h-2 rounded-full bg-border-l mx-auto" />

          <span
            class="absolute text-xs text-text-l whitespace-nowrap"
            :class="vertical ? 'left-full ml-2 -translate-y-1/2' : 'top-full mt-1 left-1/2 -translate-x-1/2'"
          >
            {{ m.label }}
          </span>
        </div>
      </template>
    </div>
  </div>
</template>
