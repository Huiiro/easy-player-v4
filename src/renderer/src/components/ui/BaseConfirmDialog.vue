<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ref } from 'vue'
import BaseDialog from './BaseDialog.vue'
import BaseButton from './BaseButton.vue'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    title: string
    message: string
    confirmText: string
    variant?: 'primary' | 'danger'
    confirmAction?: () => void | Promise<void>
    loading?: boolean
  }>(),
  { variant: 'primary' }
)
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: []
  error: [error: unknown]
}>()
const { t } = useI18n()
const pending = ref(false)

async function confirm(): Promise<void> {
  if (pending.value || props.loading) return
  pending.value = true
  try {
    await props.confirmAction?.()
    emit('confirm')
    emit('update:modelValue', false)
  } catch (error) {
    emit('error', error)
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <BaseDialog
    :model-value="modelValue"
    :title="title"
    width="max-w-sm"
    :close-on-overlay="!pending && !loading"
    :close-on-esc="!pending && !loading"
    :show-close="!pending && !loading"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <p class="break-words text-sm leading-relaxed text-text-l">{{ message }}</p>
    <template #footer>
      <BaseButton
        variant="secondary"
        :disabled="pending || loading"
        @click="emit('update:modelValue', false)"
      >
        {{ t('common.cancel') }}
      </BaseButton>
      <BaseButton :variant="variant" :loading="pending || loading" @click="confirm">{{
        confirmText
      }}</BaseButton>
    </template>
  </BaseDialog>
</template>
