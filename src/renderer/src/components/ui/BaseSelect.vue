<script setup lang="ts">
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import FloatingPanel from './FloatingPanel.vue'
import { controlSizeClasses, type ControlSize } from './types'

defineOptions({
  name: 'BaseSelect'
})

interface SelectOption {
  label: string
  value: string | number
  disabled?: boolean
  group?: string
}

const props = withDefaults(
  defineProps<{
    modelValue: string | number | (string | number)[]
    options: SelectOption[]
    placeholder?: string
    ariaLabel?: string
    disabled?: boolean
    clearable?: boolean
    multiple?: boolean
    size?: ControlSize
    teleport?: boolean
  }>(),
  {
    disabled: false,
    clearable: false,
    multiple: false,
    size: 'md',
    teleport: false
  }
)
const { t } = useI18n()
const anchor = ref<HTMLElement | null>(null)
const optionsElement = ref<HTMLElement | null>(null)
const scrollRail = ref<HTMLElement | null>(null)
const scrollRange = ref(0)
const scrollOffset = ref(0)
const railHeight = ref(0)
const thumbHeight = ref(0)
const thumbTop = computed(() =>
  scrollRange.value > 0
    ? (scrollOffset.value / scrollRange.value) * Math.max(0, railHeight.value - thumbHeight.value)
    : 0
)
let measureFrame = 0
let dragOffset: number | undefined

function viewport(): HTMLElement | null {
  return optionsElement.value
}
function measureScroll(): void {
  measureFrame = 0
  const element = viewport()
  scrollRange.value = element ? Math.max(0, element.scrollHeight - element.clientHeight) : 0
  scrollOffset.value = element?.scrollTop ?? 0
  railHeight.value = scrollRail.value?.clientHeight ?? element?.clientHeight ?? 0
  thumbHeight.value =
    element && element.scrollHeight > 0
      ? Math.min(
          railHeight.value,
          Math.max(24, (railHeight.value * element.clientHeight) / element.scrollHeight)
        )
      : 0
}
function scheduleMeasure(): void {
  if (!measureFrame) measureFrame = requestAnimationFrame(measureScroll)
}
function onListScroll(): void {
  scrollOffset.value = viewport()?.scrollTop ?? 0
}
function moveScroll(event: PointerEvent): void {
  const element = viewport(),
    rail = scrollRail.value
  if (!element || !rail || dragOffset === undefined || props.disabled) return
  const travel = Math.max(1, railHeight.value - thumbHeight.value)
  element.scrollTop =
    Math.max(
      0,
      Math.min(1, (event.clientY - rail.getBoundingClientRect().top - dragOffset) / travel)
    ) * scrollRange.value
  onListScroll()
}
function startScroll(event: PointerEvent): void {
  if (event.button !== 0 || props.disabled || scrollRange.value <= 0) return
  const rail = scrollRail.value
  if (!rail) return
  viewport()?.parentElement?.focus({ preventScroll: true })
  dragOffset =
    event.target instanceof Element && event.target.closest('.ep-select-scrollbar-thumb')
      ? event.clientY - rail.getBoundingClientRect().top - thumbTop.value
      : thumbHeight.value / 2
  rail.setPointerCapture(event.pointerId)
  moveScroll(event)
}
function stopScroll(): void {
  dragOffset = undefined
}
watch(
  [optionsElement, scrollRail],
  (_value, _previous, cleanup) => {
    const observer = new ResizeObserver(scheduleMeasure)
    const element = viewport()
    if (element) observer.observe(element)
    if (scrollRail.value) observer.observe(scrollRail.value)
    scheduleMeasure()
    cleanup(() => observer.disconnect())
  },
  { flush: 'post' }
)
watch(() => props.options, scheduleMeasure, { deep: true, flush: 'post' })
onBeforeUnmount(() => cancelAnimationFrame(measureFrame))
const placeholderText = computed(() => props.placeholder ?? t('ui.selectPlaceholder'))

const emit = defineEmits<{
  (e: 'update:modelValue', val: string | number | (string | number)[]): void
  (e: 'change', val: string | number | (string | number)[]): void
}>()

// ==================== v-model ====================
const selected = computed({
  get: () => props.modelValue,
  set: (val) => {
    emit('update:modelValue', val)
    emit('change', val)
  }
})

// ==================== 显示文本 ====================
const displayText = computed(() => {
  if (props.multiple && Array.isArray(selected.value)) {
    if (selected.value.length === 0) return placeholderText.value
    return selected.value
      .map((v) => props.options.find((o) => o.value === v)?.label ?? v)
      .join(', ')
  }

  if (!props.multiple) {
    const opt = props.options.find((o) => o.value === selected.value)
    return opt?.label ?? placeholderText.value
  }

  return placeholderText.value
})

const isPlaceholder = computed(() => {
  if (props.multiple) return Array.isArray(selected.value) && selected.value.length === 0
  return !props.options.some((option) => option.value === selected.value)
})

// ==================== 尺寸 ====================
const sizeClass = computed(() => controlSizeClasses[props.size])

// ==================== 清除 ====================
function onClear(): void {
  if (props.disabled) return
  selected.value = props.multiple ? [] : ''
}
</script>

<template>
  <Listbox
    v-slot="{ open }"
    v-model="selected"
    :disabled="disabled"
    :multiple="multiple"
    as="div"
    class="ep-select-root relative inline-block min-w-0 max-w-full text-text"
  >
    <div ref="anchor" class="relative w-full min-w-0">
      <ListboxButton
        as="button"
        type="button"
        :aria-label="ariaLabel"
        :class="[
          'ep-select flex w-full min-w-0 items-center gap-2 rounded-md border border-border bg-transparent transition-colors duration-[var(--motion-duration-standard)]',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
          'hover:border-primary',
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
          sizeClass,
          `ep-control--${size}`,
          clearable && !isPlaceholder ? 'pr-8' : ''
        ]"
      >
        <span
          class="min-w-0 flex-1 text-left truncate"
          :class="isPlaceholder ? 'text-text-l2' : ''"
        >
          {{ displayText }}
        </span>

        <!-- chevron -->
        <svg
          class="size-[1em] shrink-0 text-text-l transition-transform duration-[var(--motion-duration-standard)]"
          :class="{ 'rotate-180': open }"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6" />
        </svg>
      </ListboxButton>
      <button
        v-if="clearable && !isPlaceholder && !disabled"
        type="button"
        class="absolute right-2 top-1/2 -translate-y-1/2 text-text-l"
        :aria-label="t('ui.clear')"
        @click.stop="onClear"
      >
        ×
      </button>
    </div>

    <!-- dropdown -->
    <FloatingPanel :open="open" :anchor="anchor" :teleport="teleport" match-width :offset="4">
      <transition
        enter-active-class="transition duration-[var(--motion-duration-standard)] ease-[var(--motion-ease-enter)]"
        enter-from-class="opacity-0 scale-95"
        enter-to-class="opacity-100 scale-100"
        leave-active-class="transition duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-exit)]"
        leave-from-class="opacity-100 scale-100"
        leave-to-class="opacity-0 scale-95"
      >
        <ListboxOptions
          v-if="open"
          as="div"
          static
          class="ep-select-options w-full rounded-xl border p-1 shadow-lg focus:outline-none"
          style="max-height: min(15rem, var(--ep-floating-available-height, 15rem))"
          @click.prevent
        >
          <!-- Keep the material outside the scrolling viewport. Native scroll and
             listbox keyboard handling remain on the options, never the canvas. -->
          <div
            ref="optionsElement"
            class="ep-select-list focus:outline-none"
            role="presentation"
            @scroll.passive="onListScroll"
          >
            <template v-for="(opt, index) in options" :key="opt.value">
              <div
                v-if="opt.group && opt.group !== options[index - 1]?.group"
                class="ep-select-group px-2 py-1.5 text-xs text-text-l"
                :class="index > 0 ? 'mt-1 border-t border-border pt-2' : ''"
                role="presentation"
              >
                {{ opt.group }}
              </div>
              <ListboxOption
                v-slot="{ active, selected: isSelected }"
                :value="opt.value"
                :disabled="opt.disabled"
                as="template"
              >
                <li
                  :class="[
                    'ep-select-option flex min-w-0 items-center gap-2 rounded-lg cursor-pointer transition-colors select-none',
                    sizeClass,
                    `ep-control--${size}`,
                    opt.disabled ? 'opacity-50 cursor-not-allowed' : '',
                    isSelected
                      ? 'bg-primary/8 font-medium text-primary'
                      : active
                        ? 'bg-primary/4'
                        : ''
                  ]"
                >
                  <!-- checkmark -->
                  <svg
                    v-if="isSelected"
                    class="size-[1em] shrink-0 text-primary"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span v-else class="size-[1em] shrink-0" />

                  <slot name="option" :option="opt" :selected="isSelected" :active="active">
                    <span class="min-w-0 flex-1 truncate">{{ opt.label }}</span>
                  </slot>
                </li>
              </ListboxOption>
            </template>

            <!-- empty -->
            <div
              v-if="options.length === 0"
              class="ep-select-empty flex items-center justify-center text-text-l2 text-center"
              :class="[sizeClass, `ep-control--${size}`]"
            >
              <slot name="empty">{{ t('ui.empty') }}</slot>
            </div>
          </div>
          <div
            v-if="scrollRange > 0"
            ref="scrollRail"
            class="ep-select-scrollbar"
            aria-hidden="true"
            @pointerdown.stop.prevent="startScroll"
            @pointermove="moveScroll"
            @pointerup="stopScroll"
            @pointercancel="stopScroll"
            @lostpointercapture="stopScroll"
            @click.stop.prevent
          >
            <div
              class="ep-select-scrollbar-thumb"
              :style="{ height: `${thumbHeight}px`, transform: `translateY(${thumbTop}px)` }"
            />
          </div>
        </ListboxOptions>
      </transition>
    </FloatingPanel>
  </Listbox>
</template>

<style scoped>
.ep-select-options {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.ep-select-list {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: none;
}
.ep-select-list::-webkit-scrollbar {
  width: 0;
  height: 0;
}
.ep-select-scrollbar {
  position: absolute;
  inset-block: 4px;
  right: 0;
  width: 12px;
  touch-action: none;
  cursor: default;
}
.ep-select-scrollbar-thumb {
  position: absolute;
  top: 0;
  right: 2px;
  width: 4px;
  border-radius: 999px;
  background: var(--scrollbar-thumb, var(--color-border));
}
.ep-select-scrollbar:hover .ep-select-scrollbar-thumb {
  background: var(--scrollbar-thumb-hover, var(--color-text-l));
}
</style>
