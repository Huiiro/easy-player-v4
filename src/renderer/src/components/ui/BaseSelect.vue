<script setup lang="ts">
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/vue'
import { computed, nextTick, ref } from 'vue'

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
    disabled?: boolean
    clearable?: boolean
    multiple?: boolean
    size?: 'xs' | 'sm' | 'md'
    teleport?: boolean
  }>(),
  {
    placeholder: '请选择',
    disabled: false,
    clearable: false,
    multiple: false,
    size: 'md',
    teleport: false
  }
)

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
    if (selected.value.length === 0) return props.placeholder
    return selected.value
      .map((v) => props.options.find((o) => o.value === v)?.label ?? v)
      .join(', ')
  }

  if (!props.multiple) {
    const opt = props.options.find((o) => o.value === selected.value)
    return opt?.label ?? props.placeholder
  }

  return props.placeholder
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
    md: 'px-3 py-1.5 text-sm'
  }
  return map[props.size]
})

// ==================== 清除 ====================
function onClear(): void {
  selected.value = props.multiple ? [] : ''
}

const panelPosition = ref<Record<string, string>>({})

function updatePanelPosition(event: MouseEvent): void {
  if (!props.teleport) return
  void nextTick(() => {
    const target = event.currentTarget
    if (!(target instanceof HTMLElement)) return
    const rect = target.getBoundingClientRect()
    panelPosition.value = {
      top: `${rect.bottom + 4}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`
    }
  })
}
</script>

<template>
  <Listbox
    v-model="selected"
    :disabled="disabled"
    :multiple="multiple"
    as="div"
    class="relative inline-block text-text"
  >
    <ListboxButton
      as="div"
      :class="[
        'flex items-center gap-2 rounded-md border border-border bg-transparent transition-colors duration-200',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        'hover:border-primary',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
        buttonSizeClass
      ]"
      @click="updatePanelPosition"
    >
      <span class="flex-1 text-left truncate" :class="isPlaceholder ? 'text-text-l2' : ''">
        {{ displayText }}
      </span>

      <!-- clear -->
      <button
        v-if="clearable && !isPlaceholder && !disabled"
        type="button"
        class="shrink-0 text-text-l hover:text-text transition-colors"
        @click.stop="onClear"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <!-- chevron -->
      <svg
        class="w-4 h-4 shrink-0 text-text-l transition-transform duration-200"
        :class="{ 'rotate-180': false }"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6" />
      </svg>
    </ListboxButton>

    <!-- dropdown -->
    <Teleport to="body" :disabled="!teleport">
      <transition
        enter-active-class="transition duration-150 ease-out"
        enter-from-class="opacity-0 scale-95"
        enter-to-class="opacity-100 scale-100"
        leave-active-class="transition duration-100 ease-in"
        leave-from-class="opacity-100 scale-100"
        leave-to-class="opacity-0 scale-95"
      >
        <ListboxOptions
          :class="[
            'z-50 mt-1 min-w-(--anchor-width) max-h-60 overflow-y-auto no-scrollbar rounded-xl border border-border bg-bg p-1 shadow-lg focus:outline-none',
            teleport ? 'fixed' : 'absolute w-full'
          ]"
          :style="teleport ? panelPosition : undefined"
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

              <span class="flex-1 truncate">{{ opt.label }}</span>
            </li>
          </ListboxOption>

          <!-- empty -->
          <div v-if="options.length === 0" class="px-3 py-2 text-sm text-text-l2 text-center">
            暂无数据
          </div>
        </ListboxOptions>
      </transition>
    </Teleport>
  </Listbox>
</template>
