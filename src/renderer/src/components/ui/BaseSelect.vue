<script setup lang="ts">
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import FloatingPanel from './FloatingPanel.vue'
import type { ControlSize } from './types'

defineOptions({
  name: 'BaseSelect'
})

interface SelectOption {
  label: string
  value: string | number
  disabled?: boolean
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
const buttonSizeClass = computed(() => {
  const map: Record<string, string> = {
    xs: 'px-2 py-0.5 text-xs',
    sm: 'px-2.5 py-1 text-xs',
    md: 'px-3 py-1.5 text-sm',
    lg: 'px-4 py-2 text-base'
  }
  return map[props.size]
})

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
          buttonSizeClass,
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
          class="w-4 h-4 shrink-0 text-text-l transition-transform duration-[var(--motion-duration-standard)]"
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
          :class="[
            'ep-select-options w-full overflow-y-auto custom-scrollbar rounded-xl border border-border bg-bg p-1 shadow-lg focus:outline-none'
          ]"
          style="max-height: min(15rem, var(--ep-floating-available-height, 15rem))"
        >
          <ListboxOption
            v-for="opt in options"
            :key="opt.value"
            v-slot="{ active, selected: isSelected }"
            :value="opt.value"
            :disabled="opt.disabled"
            as="template"
          >
            <li
              :class="[
                'flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors select-none',
                opt.disabled ? 'opacity-50 cursor-not-allowed' : '',
                isSelected
                  ? 'bg-primary/30 font-medium text-primary'
                  : active
                    ? 'bg-primary/20'
                    : ''
              ]"
            >
              <!-- checkmark -->
              <svg
                v-if="isSelected"
                class="w-4 h-4 shrink-0 text-primary"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span v-else class="w-4 shrink-0" />

              <slot name="option" :option="opt" :selected="isSelected" :active="active"
                ><span class="flex-1 truncate">{{ opt.label }}</span></slot
              >
            </li>
          </ListboxOption>

          <!-- empty -->
          <div v-if="options.length === 0" class="px-3 py-2 text-sm text-text-l2 text-center">
            <slot name="empty">{{ t('ui.empty') }}</slot>
          </div>
        </ListboxOptions>
      </transition>
    </FloatingPanel>
  </Listbox>
</template>
