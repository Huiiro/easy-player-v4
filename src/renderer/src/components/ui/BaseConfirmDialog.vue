<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import BaseDialog from './BaseDialog.vue'
import BaseButton from './BaseButton.vue'

withDefaults(
  defineProps<{
    modelValue: boolean
    title: string
    message: string
    confirmText: string
    variant?: 'primary' | 'danger'
  }>(),
  { variant: 'primary' }
)
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: []
}>()
const { t } = useI18n()

function confirm(): void {
  emit('update:modelValue', false)
  emit('confirm')
}
</script>

<template>
  <BaseDialog
    :model-value="modelValue"
    :title="title"
    width="max-w-sm"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <p class="break-words text-sm leading-relaxed text-text-l">{{ message }}</p>
    <template #footer>
      <BaseButton variant="secondary" @click="emit('update:modelValue', false)">
        {{ t('common.cancel') }}
      </BaseButton>
      <BaseButton :variant="variant" @click="confirm">{{ confirmText }}</BaseButton>
    </template>
  </BaseDialog>
</template>
