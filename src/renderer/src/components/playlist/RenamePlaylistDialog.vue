<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import { useMessage } from '@/components/ui/useMessage'
import eventBus from '@/utils/eventBus'

interface Playlist {
  id: number
  name: string
  description: string | null
}

const props = defineProps<{ modelValue: boolean; playlist: Playlist | null }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()
const { t } = useI18n()
const { success, warning, error: showError } = useMessage()
const name = ref('')
const error = ref('')
const submitting = ref(false)

watch(
  () => [props.modelValue, props.playlist] as const,
  () => {
    if (!props.modelValue) return
    name.value = props.playlist?.name ?? ''
    error.value = ''
  },
  { immediate: true }
)

function close(): void {
  if (!submitting.value) emit('update:modelValue', false)
}

async function submit(): Promise<void> {
  const playlist = props.playlist
  if (!playlist || submitting.value) return
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
  if (trimmed === playlist.name) {
    close()
    return
  }
  submitting.value = true
  try {
    const response = await window.api.database.command('updatePlaylist', {
      id: playlist.id,
      input: { name: trimmed, description: playlist.description }
    })
    if (!response.success || response.data === false) {
      error.value = (!response.success && response.error) || t('playlist.updateFailed')
      showError(error.value)
      return
    }
    eventBus.emit('playlistsChanged')
    eventBus.emit('playlistRenamed', playlist.id)
    emit('update:modelValue', false)
    success(t('playlist.updated'))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <BaseDialog
    :model-value="modelValue"
    :title="t('playlist.rename')"
    width="max-w-sm"
    :close-on-overlay="!submitting"
    @update:model-value="close"
  >
    <div class="space-y-3">
      <input
        v-model="name"
        autofocus
        maxlength="64"
        class="input-base h-10 w-full"
        :aria-label="t('playlist.name')"
        :placeholder="t('playlist.namePlaceholder')"
        @keyup.enter="submit"
      />
      <p v-if="error" class="text-xs text-danger">{{ error }}</p>
    </div>
    <template #footer>
      <button
        type="button"
        class="btn-hover px-3 py-1.5 text-sm"
        :disabled="submitting"
        @click="close"
      >
        {{ t('common.cancel') }}
      </button>
      <button
        type="button"
        class="btn-hover-base rounded-lg bg-primary px-3 py-1.5 text-sm text-white disabled:opacity-50"
        :disabled="submitting"
        @click="submit"
      >
        {{ t('playlist.rename') }}
      </button>
    </template>
  </BaseDialog>
</template>
