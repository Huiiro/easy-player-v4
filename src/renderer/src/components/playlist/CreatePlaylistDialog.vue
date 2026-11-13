<script setup lang="ts">
import BaseButton from '@/components/ui/BaseButton.vue'
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import { useMessage } from '@/components/ui/useMessage'
import eventBus from '@/utils/eventBus'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void
  (e: 'created'): void
}>()

const { t } = useI18n()
const { success, error: showError, warning } = useMessage()
const name = ref('')
const error = ref('')
const submitting = ref(false)

function close(): void {
  emit('update:modelValue', false)
}

async function submit(): Promise<void> {
  const trimmed = name.value.trim()
  if (!trimmed) {
    error.value = t('sidebar.playlistNameRequired')
    warning(error.value)
    return
  }
  if (trimmed.length > 64) {
    error.value = t('sidebar.playlistNameTooLong')
    warning(error.value)
    return
  }
  submitting.value = true
  try {
    const response = await window.api.database.command('createPlaylist', { name: trimmed })
    if (!response.success) {
      error.value = response.error || t('sidebar.playlistCreateFailed')
      showError(error.value)
      return
    }
    eventBus.emit('playlistsChanged')
    close()
    emit('created')
    success(t('sidebar.playlistCreated', { name: trimmed }))
  } finally {
    submitting.value = false
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      name.value = ''
      error.value = ''
    }
  }
)
</script>

<template>
  <BaseDialog
    :model-value="modelValue"
    :title="t('sidebar.createPlaylist')"
    width="max-w-sm"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="space-y-3">
      <input
        v-model="name"
        autofocus
        maxlength="64"
        class="input-base h-10 w-full"
        :placeholder="t('playlist.name')"
        @keyup.enter="submit"
      />
      <p v-if="error" class="text-xs text-danger">{{ error }}</p>
    </div>

    <template #footer>
      <BaseButton variant="cancel" @click="close">
        {{ t('common.cancel') }}
      </BaseButton>
      <BaseButton :disabled="submitting" @click="submit">
        {{ t('sidebar.createPlaylist') }}
      </BaseButton>
    </template>
  </BaseDialog>
</template>
