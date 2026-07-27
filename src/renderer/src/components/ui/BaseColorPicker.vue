<script setup lang="ts">
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/vue'
import { computed, ref, watch } from 'vue'

defineOptions({ name: 'BaseColorPicker' })

const props = withDefaults(
  defineProps<{
    modelValue: string
    disabled?: boolean
    showAlpha?: boolean
    presets?: string[]
    teleport?: boolean
  }>(),
  {
    disabled: false,
    showAlpha: false,
    teleport: false,
    presets: () => [
      '#D0021B',
      '#F5A623',
      '#F8E71C',
      '#8B572A',
      '#7ED321',
      '#417505',
      '#BD10E0',
      '#9013FE',
      '#4A90D9',
      '#50E3C2',
      '#B8E986',
      '#000000',
      '#4A4A4A',
      '#9B9B9B',
      '#FFFFFF'
    ]
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', val: string): void
  (e: 'change', val: string): void
}>()

// ==================== 颜色空间 ====================
interface Rgba {
  r: number
  g: number
  b: number
  a: number
}
interface Hsva {
  h: number
  s: number
  v: number
  a: number
}

function parseAnyColor(val: string): Rgba {
  const s = val.trim()
  // rgba / rgb
  const rgbaMatch = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/)
  if (rgbaMatch)
    return {
      r: +rgbaMatch[1],
      g: +rgbaMatch[2],
      b: +rgbaMatch[3],
      a: rgbaMatch[4] !== undefined ? +rgbaMatch[4] : 1
    }
  // hsla / hsl
  const hslMatch = s.match(/hsla?\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*(?:,\s*([\d.]+))?\s*\)/)
  if (hslMatch) {
    const h = +hslMatch[1] / 360,
      ss = +hslMatch[2] / 100,
      l = +hslMatch[3] / 100
    const a = hslMatch[4] !== undefined ? +hslMatch[4] : 1
    const hue2rgb = (p: number, q: number, t: number): number => {
      if (t < 0) t += 1
      if (t > 1) t -= 1
      if (t < 1 / 6) return p + (q - p) * 6 * t
      if (t < 1 / 2) return q
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
      return p
    }
    if (ss === 0) {
      const v = Math.round(l * 255)
      return { r: v, g: v, b: v, a }
    }
    const q = l < 0.5 ? l * (1 + ss) : l + ss - l * ss
    const p = 2 * l - q
    return {
      r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
      g: Math.round(hue2rgb(p, q, h) * 255),
      b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
      a
    }
  }
  // hsv (not standard CSS, but used in presets)
  const hsvMatch = s.match(/hsv\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*\)/)
  if (hsvMatch) {
    const h = +hsvMatch[1] / 360,
      ss = +hsvMatch[2] / 100,
      v = +hsvMatch[3] / 100
    const c = v * ss,
      x = c * (1 - Math.abs(((h * 6) % 2) - 1)),
      m = v - c
    let r = 0,
      g = 0,
      b = 0
    if (h * 6 < 1) {
      r = c
      g = x
    } else if (h * 6 < 2) {
      r = x
      g = c
    } else if (h * 6 < 3) {
      g = c
      b = x
    } else if (h * 6 < 4) {
      g = x
      b = c
    } else if (h * 6 < 5) {
      r = x
      b = c
    } else {
      r = c
      b = x
    }
    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255),
      a: 1
    }
  }
  // hex
  const hx = s.replace('#', '')
  if (hx.length === 6 || hx.length === 8)
    return {
      r: parseInt(hx.slice(0, 2), 16),
      g: parseInt(hx.slice(2, 4), 16),
      b: parseInt(hx.slice(4, 6), 16),
      a: hx.length === 8 ? parseInt(hx.slice(6, 8), 16) / 255 : 1
    }
  if (hx.length === 3)
    return {
      r: parseInt(hx[0] + hx[0], 16),
      g: parseInt(hx[1] + hx[1], 16),
      b: parseInt(hx[2] + hx[2], 16),
      a: 1
    }
  return { r: 0, g: 0, b: 0, a: 1 }
}

function hsvaToRgba(hsva: Hsva): Rgba {
  const h = ((hsva.h % 360) + 360) % 360
  const c = hsva.v * hsva.s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = hsva.v - c
  let r = 0,
    g = 0,
    b = 0
  if (h < 60) {
    r = c
    g = x
  } else if (h < 120) {
    r = x
    g = c
  } else if (h < 180) {
    g = c
    b = x
  } else if (h < 240) {
    g = x
    b = c
  } else if (h < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
    a: hsva.a
  }
}

function rgbaToHex(rgba: Rgba): string {
  const hex = [rgba.r, rgba.g, rgba.b]
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')
  if (props.showAlpha && rgba.a < 1)
    return `#${hex}${Math.round(rgba.a * 255)
      .toString(16)
      .padStart(2, '0')}`
  return `#${hex}`
}

function fromHex(hex: string): Hsva {
  const { r, g, b, a } = parseAnyColor(hex)
  const max = Math.max(r, g, b) / 255,
    min = Math.min(r, g, b) / 255,
    d = max - min
  let h = 0
  if (d > 0) {
    if (max === r / 255) h = 60 * (((g / 255 - b / 255) / d + 6) % 6)
    else if (max === g / 255) h = 60 * ((b / 255 - r / 255) / d + 2)
    else h = 60 * ((r / 255 - g / 255) / d + 4)
  }
  return { h, s: max === 0 ? 0 : d / max, v: max, a }
}

// ==================== 核心状态 ====================
const hsva = ref<Hsva>(fromHex(props.modelValue))

watch(
  () => props.modelValue,
  (val) => {
    hsva.value = fromHex(val)
  }
)

function emitColor(): void {
  const hex = rgbaToHex(hsvaToRgba(hsva.value))
  emit('update:modelValue', hex)
  emit('change', hex)
}

// ==================== 派生值 ====================
const svBg = computed(() => {
  const { r, g, b } = hsvaToRgba({ h: hsva.value.h, s: 1, v: 1, a: 1 })
  return `rgb(${r},${g},${b})`
})
const svLeft = computed(() => `${hsva.value.s * 100}%`)
const svTop = computed(() => `${(1 - hsva.value.v) * 100}%`)
const hueLeft = computed(() => `${(hsva.value.h / 360) * 100}%`)
const alphaLeft = computed(() => `${hsva.value.a * 100}%`)
const alphaPct = computed(() => Math.round(hsva.value.a * 100))
const hexDisplay = computed(() => rgbaToHex(hsvaToRgba(hsva.value)))
const colorStr = computed(() => {
  const a = hsva.value.a
  const { r, g, b } = hsvaToRgba({ ...hsva.value, a: 1 })
  return a < 1 ? `rgba(${r},${g},${b},${a.toFixed(2)})` : `rgb(${r},${g},${b})`
})
const alphaGradient = computed(() => {
  const { r, g, b } = hsvaToRgba({ ...hsva.value, a: 1 })
  return `linear-gradient(to right, transparent, rgb(${r},${g},${b}))`
})

// ==================== Hex 输入 ====================
const hexInput = ref(props.modelValue)
const hexFocused = ref(false)

watch(hexDisplay, (val) => {
  if (!hexFocused.value) hexInput.value = val
})

function onHexFocus(): void {
  hexFocused.value = true
}
function onHexBlur(): void {
  hexFocused.value = false
  const val = hexInput.value.trim()
  if (!val) {
    hexInput.value = hexDisplay.value
    return
  }
  try {
    hsva.value = fromHex(val.startsWith('#') ? val : `#${val}`)
    emitColor()
    hexInput.value = hexDisplay.value
  } catch {
    hexInput.value = hexDisplay.value
  }
}

// ==================== 交互 ====================
let draggingSv = false,
  draggingHue = false,
  draggingAlpha = false
const svEl = ref<HTMLElement | null>(null)
const hueEl = ref<HTMLElement | null>(null)
const alphaEl = ref<HTMLElement | null>(null)

function updateSv(e: PointerEvent): void {
  if (!svEl.value) return
  const r = svEl.value.getBoundingClientRect()
  hsva.value.s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
  hsva.value.v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height))
  emitColor()
}
function updateHue(e: PointerEvent): void {
  if (!hueEl.value) return
  hsva.value.h = Math.max(
    0,
    Math.min(
      360,
      ((e.clientX - hueEl.value.getBoundingClientRect().left) /
        hueEl.value.getBoundingClientRect().width) *
        360
    )
  )
  emitColor()
}
function updateAlpha(e: PointerEvent): void {
  if (!alphaEl.value) return
  hsva.value.a = Math.max(
    0,
    Math.min(
      1,
      (e.clientX - alphaEl.value.getBoundingClientRect().left) /
        alphaEl.value.getBoundingClientRect().width
    )
  )
  emitColor()
}

function onSvDown(e: PointerEvent): void {
  draggingSv = true
  svEl.value?.setPointerCapture(e.pointerId)
  updateSv(e)
}
function onSvMove(e: PointerEvent): void {
  if (draggingSv) updateSv(e)
}
function onSvUp(): void {
  draggingSv = false
}
function onHueDown(e: PointerEvent): void {
  draggingHue = true
  hueEl.value?.setPointerCapture(e.pointerId)
  updateHue(e)
}
function onHueMove(e: PointerEvent): void {
  if (draggingHue) updateHue(e)
}
function onHueUp(): void {
  draggingHue = false
}
function onAlphaDown(e: PointerEvent): void {
  draggingAlpha = true
  alphaEl.value?.setPointerCapture(e.pointerId)
  updateAlpha(e)
}
function onAlphaMove(e: PointerEvent): void {
  if (draggingAlpha) updateAlpha(e)
}
function onAlphaUp(): void {
  draggingAlpha = false
}

function selectPreset(color: string): void {
  hsva.value = fromHex(color)
  emitColor()
}

// ==================== 方向判断 ====================
const anchorRef = ref<HTMLElement | null>(null)
const panelAbove = ref(false)
const panelPosition = ref<Record<string, string>>({})

function onOpenChange(open: boolean): void {
  if (!open || !anchorRef.value) return
  const r = anchorRef.value.getBoundingClientRect()
  // 预估面板高度 ~360px，下方放不下且上方够就翻上去
  panelAbove.value = r.bottom + 370 > window.innerHeight && r.top > 370
  if (props.teleport) {
    panelPosition.value = {
      left: `${Math.max(8, Math.min(r.left, window.innerWidth - 256))}px`,
      top: `${panelAbove.value ? Math.max(8, r.top - 370) : r.bottom + 8}px`
    }
  }
}
</script>

<template>
  <div ref="anchorRef" class="relative inline-block">
    <Popover v-slot="{ open }" class="relative" :disabled="disabled">
      <span style="display: none">{{ onOpenChange(open) }}</span>

      <PopoverButton
        as="div"
        :class="[
          'inline-flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 cursor-pointer transition-colors hover:border-primary select-none',
          disabled ? 'opacity-50 cursor-not-allowed' : '',
          open ? 'border-primary ring-2 ring-primary/20' : ''
        ]"
      >
        <span
          class="size-5 shrink-0 rounded-sm border border-black/15"
          :style="{ backgroundColor: colorStr }"
        />
        <span class="text-xs text-text-l tabular-nums font-mono">{{ hexDisplay }}</span>
      </PopoverButton>

      <Teleport to="body" :disabled="!teleport">
        <transition
          enter-active-class="transition duration-150 ease-out"
          enter-from-class="opacity-0 scale-95"
          enter-to-class="opacity-100 scale-100"
          leave-active-class="transition duration-100 ease-in"
          leave-from-class="opacity-100 scale-100"
          leave-to-class="opacity-0 scale-95"
        >
          <PopoverPanel
            class="left-0 z-50 rounded-xl border border-border bg-bg p-3 shadow-xl"
            :class="
              teleport ? 'fixed' : ['absolute', panelAbove ? 'bottom-full mb-2' : 'top-full mt-2']
            "
            :style="teleport ? panelPosition : undefined"
            @click.stop
          >
            <div class="flex flex-col gap-3 select-none" style="width: 232px">
              <!-- SV Board -->
              <div
                ref="svEl"
                class="relative h-40 w-full rounded-lg cursor-crosshair touch-none"
                :style="{
                  background: `linear-gradient(to right, white, transparent), linear-gradient(to top, black, transparent), ${svBg}`
                }"
                @pointerdown.prevent="onSvDown"
                @pointermove="onSvMove"
                @pointerup="onSvUp"
                @pointercancel="onSvUp"
              >
                <div
                  class="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_2px_rgba(0,0,0,0.6)] pointer-events-none"
                  :style="{ left: svLeft, top: svTop }"
                />
              </div>

              <!-- Hue Bar -->
              <div
                ref="hueEl"
                class="relative h-3.5 w-full rounded-full cursor-pointer touch-none"
                style="
                  background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
                "
                @pointerdown.prevent="onHueDown"
                @pointermove="onHueMove"
                @pointerup="onHueUp"
                @pointercancel="onHueUp"
              >
                <div
                  class="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 size-4 rounded-full border-2 border-white shadow-[0_0_2px_rgba(0,0,0,0.6)] pointer-events-none"
                  :style="{ left: hueLeft }"
                />
              </div>

              <!-- Alpha Bar -->
              <div v-if="showAlpha" class="flex items-center gap-2">
                <span class="text-xs text-text-l w-4 shrink-0">A</span>
                <div
                  ref="alphaEl"
                  class="relative h-3.5 flex-1 rounded-full cursor-pointer touch-none overflow-hidden"
                  @pointerdown.prevent="onAlphaDown"
                  @pointermove="onAlphaMove"
                  @pointerup="onAlphaUp"
                  @pointercancel="onAlphaUp"
                >
                  <div
                    class="absolute inset-0 pointer-events-none"
                    style="
                      background-image:
                        linear-gradient(45deg, #aaa 25%, transparent 25%),
                        linear-gradient(-45deg, #aaa 25%, transparent 25%),
                        linear-gradient(45deg, transparent 75%, #aaa 75%),
                        linear-gradient(-45deg, transparent 75%, #aaa 75%);
                      background-size: 8px 8px;
                      background-position:
                        0 0,
                        0 4px,
                        4px -4px,
                        -4px 0;
                    "
                  />
                  <div
                    class="absolute inset-0 rounded-full pointer-events-none"
                    :style="{ background: alphaGradient }"
                  />
                  <div
                    class="absolute top-0 -translate-x-1/2 w-1 h-full bg-white border-x border-black/20 pointer-events-none"
                    :style="{ left: alphaLeft }"
                  />
                </div>
                <span class="text-xs text-text-l w-9 text-right tabular-nums shrink-0"
                  >{{ alphaPct }}%</span
                >
              </div>

              <!-- 预览 + Hex -->
              <div class="flex items-center gap-2">
                <div
                  class="size-8 rounded-lg border border-border shrink-0"
                  style="
                    background-image:
                      linear-gradient(45deg, #aaa 25%, transparent 25%),
                      linear-gradient(-45deg, #aaa 25%, transparent 25%),
                      linear-gradient(45deg, transparent 75%, #aaa 75%),
                      linear-gradient(-45deg, transparent 75%, #aaa 75%);
                    background-size: 8px 8px;
                    background-position:
                      0 0,
                      0 4px,
                      4px -4px,
                      -4px 0;
                  "
                >
                  <div class="size-full rounded-lg" :style="{ backgroundColor: colorStr }" />
                </div>
                <input
                  v-model="hexInput"
                  class="input-base h-7 flex-1 text-xs font-mono"
                  @focus="onHexFocus"
                  @blur="onHexBlur"
                  @keydown.enter="($event.target as HTMLInputElement).blur()"
                />
              </div>

              <!-- 预设 -->
              <div v-if="presets.length">
                <p class="text-xs text-text-l mb-1.5">预设</p>
                <div class="grid grid-cols-8 gap-1">
                  <button
                    v-for="color in presets"
                    :key="color"
                    class="size-6 rounded-md border border-border/50 transition-transform hover:scale-115 active:scale-95"
                    :style="{ backgroundColor: color }"
                    :title="color"
                    @click="selectPreset(color)"
                  />
                </div>
              </div>
            </div>
          </PopoverPanel>
        </transition>
      </Teleport>
    </Popover>
  </div>
</template>
