<script setup lang="ts">
import { Dialog, DialogPanel, DialogTitle, TransitionRoot, TransitionChild } from '@headlessui/vue'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useModalClose } from './useModalClose'
import { cssSize } from './types'

defineOptions({
  name: 'BaseDrawer'
})

type Direction = 'left' | 'right' | 'top' | 'bottom'

const props = withDefaults(
  defineProps<{
    modelValue: boolean

    title?: string

    direction?: Direction

    width?: string | number
    height?: string | number

    closeOnEsc?: boolean
    panelClass?: string
    bodyClass?: string
    headerClass?: string
    closeOnOverlay?: boolean

    showClose?: boolean
  }>(),
  {
    direction: 'right',

    width: '30%',
    height: '30%',

    closeOnOverlay: true,
    closeOnEsc: true,

    showClose: true
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'close'): void
  (e: 'afterEnter'): void
  (e: 'afterLeave'): void
}>()

const { t } = useI18n()
const { close, onOverlayClose, onKeydown } = useModalClose(props, emit)
// =======================
// layout
// =======================

const isHorizontal = computed(() => {
  return props.direction === 'left' || props.direction === 'right'
})

const hasHeader = computed(() => {
  return !!props.title
})

const panelClasses = computed(() => {
  const base = `
    fixed
    ep-drawer-panel
    flex
    flex-col
    overflow-hidden
    transform-gpu
    will-change-transform
  `

  const position: Record<Direction, string> = {
    right: `
      top-0
      right-0
      h-full
    `,

    left: `
      top-0
      left-0
      h-full
    `,

    top: `
      top-0
      left-0
      w-full
    `,

    bottom: `
      bottom-0
      left-0
      w-full
    `
  }

  return `${base} ${position[props.direction]}`
})

const panelStyle = computed(() => {
  if (isHorizontal.value) {
    return {
      width: cssSize(props.width),
      maxWidth: '100vw'
    }
  }

  return {
    height: cssSize(props.height),
    maxHeight: '100vh'
  }
})

// =======================
// transition
// =======================

const enterFrom = computed(() => {
  const map: Record<Direction, string> = {
    right: 'translate-x-full',

    left: '-translate-x-full',

    top: '-translate-y-full',

    bottom: 'translate-y-full'
  }

  return map[props.direction]
})

const leaveTo = computed(() => {
  const map: Record<Direction, string> = {
    right: 'translate-x-full',

    left: '-translate-x-full',

    top: '-translate-y-full',

    bottom: 'translate-y-full'
  }

  return map[props.direction]
})
</script>

<template>
  <TransitionRoot
    :show="modelValue"
    as="template"
    @after-enter="emit('afterEnter')"
    @after-leave="emit('afterLeave')"
  >
    <Dialog
      as="div"
      class="ep-drawer pointer-events-auto fixed inset-0 z-50 text-text"
      @close="onOverlayClose"
      @keydown="onKeydown"
    >
      <!-- overlay -->

      <TransitionChild
        as="template"
        enter="transition-opacity duration-[var(--motion-duration-standard)] ease-[var(--motion-ease-enter)]"
        enter-from="opacity-0"
        enter-to="opacity-100"
        leave="transition-opacity duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-exit)]"
        leave-from="opacity-100"
        leave-to="opacity-0"
      >
        <div class="ep-overlay fixed inset-0" />
      </TransitionChild>

      <!-- drawer -->

      <TransitionChild
        as="template"
        enter="
    transition-transform
    duration-[var(--motion-duration-standard)]
    ease-[var(--motion-ease-enter)]
  "
        :enter-from="enterFrom"
        enter-to="
    translate-x-0
    translate-y-0
  "
        leave="
    transition-transform
    duration-[var(--motion-duration-fast)]
    ease-[var(--motion-ease-exit)]
  "
        leave-from="
    translate-x-0
    translate-y-0
  "
        :leave-to="leaveTo"
      >
        <DialogPanel :class="[panelClasses, panelClass]" :style="panelStyle">
          <!-- floating close -->

          <button
            v-if="showClose && !hasHeader && !$slots.header"
            type="button"
            :aria-label="t('common.close')"
            class="absolute top-4 right-4 z-20 p-1.5 rounded-md hover:bg-hover-bg transition-colors"
            @click="close"
          >
            <svg
              class="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <!-- header -->

          <div
            v-if="hasHeader || $slots.header"
            class="ep-drawer-header px-5 py-4 flex items-center justify-between border-b border-border shrink-0"
            :class="headerClass"
          >
            <slot name="header">
              <div class="flex items-center min-w-0">
                <DialogTitle v-if="title" class="text-lg font-semibold truncate">
                  {{ title }}
                </DialogTitle>
              </div>
              <div class="shrink-0 ml-4">
                <slot name="close">
                  <button
                    v-if="showClose"
                    type="button"
                    :aria-label="t('common.close')"
                    class="p-1.5 rounded-md hover:bg-hover-bg transition-colors"
                    @click="close"
                  >
                    <svg
                      class="w-5 h-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </slot>
              </div>
            </slot>
          </div>

          <!-- content -->

          <div
            class="ep-drawer-body flex-1 overflow-y-auto custom-scrollbar p-5"
            :class="[bodyClass, { 'pt-12': showClose && !hasHeader && !$slots.header }]"
          >
            <slot :close="close" />
          </div>

          <!-- footer -->

          <div
            v-if="$slots.footer"
            class="ep-drawer-footer px-5 py-4 border-t border-border shrink-0"
          >
            <slot name="footer" :close="close" />
          </div>
        </DialogPanel>
      </TransitionChild>
    </Dialog>
  </TransitionRoot>
</template>
