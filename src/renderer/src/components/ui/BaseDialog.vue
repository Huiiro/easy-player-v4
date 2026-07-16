<script setup lang="ts">
import { Dialog, DialogPanel, DialogTitle, TransitionRoot, TransitionChild } from '@headlessui/vue'
import { computed } from 'vue'

defineOptions({
  name: 'BaseDialog'
})

type FooterAlign = 'left' | 'right' | 'between'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    title?: string
    width?: string
    closeOnOverlay?: boolean
    showClose?: boolean
    blur?: boolean
    footerAlign?: FooterAlign
  }>(),
  {
    width: 'max-w-lg',
    closeOnOverlay: true,
    showClose: true,
    blur: true,
    footerAlign: 'right'
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void
  (e: 'close'): void
}>()

function close(): void {
  emit('update:modelValue', false)
  emit('close')
}

function handleClose(): void {
  if (props.closeOnOverlay) {
    close()
  }
}

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
  <TransitionRoot :show="modelValue" as="template">
    <Dialog as="div" class="fixed inset-0 z-50 text-text" @close="handleClose">
      <!-- overlay -->
      <TransitionChild
        as="template"
        enter="transition-opacity duration-200"
        enter-from="opacity-0"
        enter-to="opacity-100"
        leave="transition-opacity duration-150"
        leave-from="opacity-100"
        leave-to="opacity-0"
      >
        <div class="fixed inset-0 bg-black/50" :class="blur ? 'backdrop-blur-sm' : ''" />
      </TransitionChild>

      <!-- container -->
      <div class="fixed inset-0 flex items-center justify-center p-4">
        <TransitionChild
          as="template"
          enter="transition duration-200 ease-out"
          enter-from="opacity-0 scale-95"
          enter-to="opacity-100 scale-100"
          leave="transition duration-150 ease-in"
          leave-from="opacity-100 scale-100"
          leave-to="opacity-0 scale-95"
        >
          <DialogPanel :class="['w-full rounded-2xl bg-bg shadow-xl', width]">
            <!-- header -->
            <div
              v-if="$slots.header || title || showClose"
              class="px-4 py-3 flex items-center justify-between"
            >
              <!-- 左侧：标题 -->
              <div class="flex items-center">
                <slot name="header">
                  <DialogTitle class="text-lg font-semibold">
                    {{ title }}
                  </DialogTitle>
                </slot>
              </div>

              <!-- 右侧：关闭按钮 -->
              <div class="flex items-center select-none">
                <slot name="close">
                  <button
                    v-if="showClose"
                    class="p-1 rounded-md hover:text-primary transition"
                    @click="close"
                  >
                    ✕
                  </button>
                </slot>
              </div>
            </div>

            <!-- content -->
            <div class="p-4">
              <slot />
            </div>

            <!-- footer -->
            <div v-if="$slots.footer" class="px-4 py-3">
              <div :class="footerClass">
                <slot name="footer" />
              </div>
            </div>
          </DialogPanel>
        </TransitionChild>
      </div>
    </Dialog>
  </TransitionRoot>
</template>
