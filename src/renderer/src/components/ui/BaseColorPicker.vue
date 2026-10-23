<script setup lang="ts">
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/vue'
import { computed, ref, watch } from 'vue'
import FloatingPanel from './FloatingPanel.vue'
import { fromHex, hsvaToRgba, rgbaToHex, type Hsva } from './color'
import { useI18n } from 'vue-i18n'

defineOptions({ name: 'BaseColorPicker' })
const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    modelValue: string
    disabled?: boolean
    showAlpha?: boolean
    showValue?: boolean
    presets?: string[]
    teleport?: boolean
  }>(),
  {
    disabled: false,
    showAlpha: false,
    showValue: true,
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
// ==================== 核心状态 ====================
function readColor(value: string): Hsva {
  try {
    return fromHex(value)
  } catch {
    return { h: 0, s: 0, v: 0, a: 1 }
  }
}
const hsva = ref<Hsva>(readColor(props.modelValue))

watch(
  () => props.modelValue,
  (val) => {
    try {
      hsva.value = fromHex(val)
    } catch {
      /* Keep the last valid external color. */
    }
  }
)

function emitColor(): void {
  if (props.disabled) return
  const hex = rgbaToHex(hsvaToRgba(hsva.value), props.showAlpha)
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
const hexDisplay = computed(() => rgbaToHex(hsvaToRgba(hsva.value), props.showAlpha))
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
  if (props.disabled || !svEl.value) return
  const r = svEl.value.getBoundingClientRect()
  hsva.value.s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
  hsva.value.v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height))
  emitColor()
}
function updateHue(e: PointerEvent): void {
  if (props.disabled || !hueEl.value) return
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
  if (props.disabled || !alphaEl.value) return
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
  if (props.disabled) return
  try {
    hsva.value = fromHex(color)
    emitColor()
  } catch {
    /* Ignore an invalid caller-supplied preset. */
  }
}

// ==================== 方向判断 ====================
const anchorRef = ref<HTMLElement | null>(null)
</script>

<template>
  <div ref="anchorRef" class="relative inline-block">
    <Popover v-slot="{ open }" class="relative">
      <PopoverButton
        as="button"
        type="button"
        :disabled="disabled"
        :aria-label="t('ui.color')"
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
        <span v-if="showValue" class="text-xs text-text-l tabular-nums font-mono">
          {{ hexDisplay }}
        </span>
      </PopoverButton>

      <FloatingPanel :open="open" :anchor="anchorRef" :teleport="teleport">
        <transition
          enter-active-class="transition duration-[var(--motion-duration-standard)] ease-[var(--motion-ease-enter)]"
          enter-from-class="opacity-0 scale-95"
          enter-to-class="opacity-100 scale-100"
          leave-active-class="transition duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-exit)]"
          leave-from-class="opacity-100 scale-100"
          leave-to-class="opacity-0 scale-95"
        >
          <PopoverPanel
            class="ep-color-picker rounded-xl border border-border bg-bg p-3 shadow-xl"
            style="max-height: var(--ep-floating-available-height, 80vh); overflow-y: auto"
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

              <div class="sr-only focus-within:not-sr-only">
                <label
                  >{{ t('ui.hue')
                  }}<input
                    v-model.number="hsva.h"
                    type="range"
                    min="0"
                    max="360"
                    @input="emitColor"
                /></label>
                <label
                  >{{ t('ui.saturation')
                  }}<input
                    v-model.number="hsva.s"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    @input="emitColor"
                /></label>
                <label
                  >{{ t('ui.brightness')
                  }}<input
                    v-model.number="hsva.v"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    @input="emitColor"
                /></label>
                <label v-if="showAlpha"
                  >{{ t('ui.alpha')
                  }}<input
                    v-model.number="hsva.a"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    @input="emitColor"
                /></label>
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
                  class="ep-input input-base h-7 min-w-0 flex-1 text-xs font-mono"
                  :aria-label="t('ui.colorValue')"
                  @focus="onHexFocus"
                  @blur="onHexBlur"
                  @keydown.enter="($event.target as HTMLInputElement).blur()"
                />
              </div>

              <!-- 预设 -->
              <div v-if="presets.length">
                <p class="text-xs text-text-l mb-1.5">{{ t('ui.presets') }}</p>
                <div class="grid grid-cols-8 gap-1">
                  <button
                    v-for="color in presets"
                    :key="color"
                    type="button"
                    :aria-label="color"
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
      </FloatingPanel>
    </Popover>
  </div>
</template>
