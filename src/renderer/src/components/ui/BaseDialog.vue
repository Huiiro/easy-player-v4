<script setup lang="ts">
import { Dialog, DialogPanel, DialogTitle, TransitionRoot, TransitionChild } from '@headlessui/vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useModalClose } from './useModalClose'
import { cssSize } from './types'

defineOptions({
  name: 'BaseDialog'
})

type FooterAlign = 'left' | 'right' | 'between'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    title?: string
    width?: string | number
    closeOnEsc?: boolean
    panelClass?: string
    bodyClass?: string
    headerClass?: string
    closeOnOverlay?: boolean
    showClose?: boolean
    blur?: boolean
    footerAlign?: FooterAlign
  }>(),
  {
    width: 'max-w-lg',
    closeOnOverlay: true,
    closeOnEsc: true,
    showClose: true,
    blur: true,
    footerAlign: 'right'
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void
  (e: 'close'): void
  (e: 'afterEnter'): void
  (e: 'afterLeave'): void
}>()

const { t } = useI18n()
const { close, onOverlayClose, onKeydown } = useModalClose(props, emit)
const legacyWidth = computed(
  () => typeof props.width === 'string' && /^(?:max-w-|w-)/.test(props.width)
)
const panelStyle = computed(() =>
  legacyWidth.value ? undefined : { maxWidth: cssSize(props.width) }
)
/* footer */
const footerClass = computed(() => {
  const map = {
    left: 'justify-start',
    right: 'justify-end',
    between: 'justify-between'
  }
  return `flex items-center gap-2 ${map[props.footerAlign]}`
})
</script>

<template>
  <!-- TransitionRoot owns unmounting so the portal stays intact during leave. -->
  <TransitionRoot
    :show="modelValue"
    as="template"
    @after-enter="emit('afterEnter')"
    @after-leave="emit('afterLeave')"
  >
    <Dialog
      static
      as="div"
      class="ep-dialog pointer-events-auto fixed inset-0 z-50 text-text"
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
        <div
          class="ep-overlay fixed inset-0"
          :class="blur ? 'ep-overlay--blur backdrop-blur-sm' : ''"
        />
      </TransitionChild>

      <!-- container -->
      <div class="fixed inset-0 flex items-start justify-center overflow-y-auto p-4">
        <TransitionChild
          as="template"
          enter="transition duration-[var(--motion-duration-standard)] ease-[var(--motion-ease-enter)]"
          enter-from="opacity-0 scale-95"
          enter-to="opacity-100 scale-100"
          leave="transition duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-exit)]"
          leave-from="opacity-100 scale-100"
          leave-to="opacity-0 scale-95"
        >
          <DialogPanel
            :class="['ep-dialog-panel my-auto w-full', legacyWidth ? width : '', panelClass]"
            :style="panelStyle"
          >
            <!-- header -->
            <div
              v-if="$slots.header || title || showClose"
              class="ep-dialog-header px-4 py-3 flex items-center justify-between"
              :class="headerClass"
            >
              <!-- 左侧：标题 -->
              <div class="flex items-center">
                <slot name="header">
                  <DialogTitle class="ep-dialog-title text-lg font-semibold">
                    {{ title }}
                  </DialogTitle>
                </slot>
              </div>

              <!-- 右侧：关闭按钮 -->
              <div class="flex items-center select-none">
                <slot name="close">
                  <button
                    v-if="showClose"
                    type="button"
                    :aria-label="t('common.close')"
                    class="p-1 rounded-md hover:text-primary transition"
                    @click="close"
                  >
                    ✕
                  </button>
                </slot>
              </div>
            </div>

            <!-- content -->
            <div class="ep-dialog-body p-4" :class="bodyClass">
              <slot :close="close" />
            </div>

            <!-- footer -->
            <div v-if="$slots.footer" class="ep-dialog-footer px-4 py-3">
              <div :class="footerClass">
                <slot name="footer" :close="close" />
              </div>
            </div>
          </DialogPanel>
        </TransitionChild>
      </div>
    </Dialog>
  </TransitionRoot>
</template>
