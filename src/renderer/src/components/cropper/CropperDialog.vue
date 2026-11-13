<script setup lang="ts">
import { nextTick, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import Cropper from 'cropperjs'
import 'cropperjs/dist/cropper.css'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ modelValue: boolean; imageUrl: string | null; size?: number }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; confirm: [dataUrl: string] }>()
const { t } = useI18n()
const image = ref<HTMLImageElement | null>(null)
const displayImageUrl = ref<string | null>(null)
const cropperReady = ref(false)
let cropper: Cropper | null = null
let entered = false
let active = true
let revision = 0

function destroy(): void {
  cropperReady.value = false
  cropper?.destroy()
  cropper = null
}
function initialize(): void {
  destroy()
  if (!entered || !props.modelValue || !displayImageUrl.value || !image.value) return
  const current = revision
  cropper = new Cropper(image.value, {
    aspectRatio: 1,
    viewMode: 1,
    dragMode: 'move',
    autoCropArea: 1,
    background: false,
    ready: () => {
      if (current === revision && props.modelValue && entered) cropperReady.value = true
    }
  })
}
function afterEnter(): void {
  if (!props.modelValue) return
  entered = true
  initialize()
}
function afterLeave(): void {
  if (active && props.modelValue) return
  entered = false
  destroy()
  displayImageUrl.value = null
}

watch(
  () => [props.modelValue, props.imageUrl],
  async () => {
    const current = ++revision
    if (!props.modelValue) {
      entered = false
      return
    }
    displayImageUrl.value = props.imageUrl
    await nextTick()
    if (current === revision && entered) initialize()
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  revision++
  destroy()
})
onActivated(() => {
  active = true
})
onDeactivated(() => {
  active = false
  revision++
  entered = false
})

function confirm(): void {
  if (!props.modelValue || !entered) return
  const canvas = cropper?.getCroppedCanvas({
    width: props.size ?? 1000,
    height: props.size ?? 1000
  })
  if (!canvas) return
  emit('confirm', canvas.toDataURL('image/jpeg', 0.9))
  emit('update:modelValue', false)
}

function close(value: boolean): void {
  emit('update:modelValue', value)
}
</script>

<template>
  <BaseDialog
    :model-value="modelValue"
    :title="t('metadataEdit.cropCover')"
    width="max-w-4xl"
    :close-on-overlay="false"
    @update:model-value="close"
    @after-enter="afterEnter"
    @after-leave="afterLeave"
  >
    <div class="flex h-[min(70vh,46rem)] w-full justify-center">
      <img ref="image" :src="displayImageUrl || ''" class="block max-h-full max-w-full" alt="" />
    </div>
    <template #footer>
      <BaseButton variant="cancel" @click="close(false)">
        {{ t('metadataEdit.cancel') }}
      </BaseButton>
      <BaseButton :disabled="!cropperReady" @click="confirm">{{
        t('metadataEdit.applyCrop')
      }}</BaseButton>
    </template>
  </BaseDialog>
</template>
