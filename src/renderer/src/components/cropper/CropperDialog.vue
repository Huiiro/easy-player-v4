<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import Cropper from 'cropperjs'
import 'cropperjs/dist/cropper.css'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ modelValue: boolean; imageUrl: string | null; size?: number }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; confirm: [dataUrl: string] }>()
const { t } = useI18n()
const image = ref<HTMLImageElement | null>(null)
let cropper: Cropper | null = null

async function initialize(): Promise<void> {
  cropper?.destroy()
  cropper = null
  if (!props.modelValue || !props.imageUrl) return
  await nextTick()
  if (!image.value) return
  cropper = new Cropper(image.value, {
    aspectRatio: 1,
    viewMode: 1,
    dragMode: 'move',
    autoCropArea: 1,
    background: false
  })
}

watch(
  () => [props.modelValue, props.imageUrl],
  () => void initialize(),
  { immediate: true }
)

function confirm(): void {
  const canvas = cropper?.getCroppedCanvas({
    width: props.size ?? 1000,
    height: props.size ?? 1000
  })
  if (!canvas) return
  emit('confirm', canvas.toDataURL('image/jpeg', 0.9))
  emit('update:modelValue', false)
}

function close(value: boolean): void {
  if (!value) cropper?.destroy()
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
  >
    <div class="flex h-[min(70vh,46rem)] w-full justify-center">
      <img ref="image" :src="imageUrl || ''" class="block max-h-full max-w-full" alt="" />
    </div>
    <template #footer>
      <BaseButton variant="secondary" @click="close(false)">
        {{ t('metadataEdit.cancel') }}
      </BaseButton>
      <BaseButton @click="confirm">{{ t('metadataEdit.applyCrop') }}</BaseButton>
    </template>
  </BaseDialog>
</template>
