<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import { useMessage } from '@/components/ui/useMessage'
import type { LibrarySong } from '@/types/library'

const props = defineProps<{ modelValue: boolean; songs: LibrarySong[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; deleted: [songIds: number[]] }>()
const { t } = useI18n()
const { success, warning, error } = useMessage()
const deleteLocalFiles = ref(false)
const canDeleteLocalFiles = computed(() => props.songs.some((song) => song.sourceId === null))

watch(
  () => props.modelValue,
  (open) => {
    if (open) deleteLocalFiles.value = false
  }
)

async function confirm(): Promise<void> {
  const songIds = props.songs.map((song) => song.id)
  if (!songIds.length) return
  const response = await window.api.database.command('deleteSongs', {
    songIds,
    deleteLocalFiles: deleteLocalFiles.value
  })
  if (!response.success) {
    error(response.error || t('songList.deleteFailed'))
    return
  }
  const result = response.data as { failedFiles: string[] }
  emit('update:modelValue', false)
  emit('deleted', songIds)
  success(t('songList.deleted'))
  if (result.failedFiles.length) warning(t('songList.deleteLocalFileFailed'))
}
</script>

<template>
  <BaseDialog
    :model-value="modelValue"
    :title="t('songList.delete')"
    width="max-w-sm"
    :close-on-overlay="false"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <p class="text-sm text-[var(--color-text-l)]">
      <template v-if="songs.length === 1">
        {{ t('songList.confirmDelete', { title: songs[0]?.title ?? '' }) }}
      </template>
      <template v-else>{{ t('songList.confirmDeleteBatch', { count: songs.length }) }} </template>
    </p>
    <label v-if="canDeleteLocalFiles" class="mt-4 flex cursor-pointer items-center gap-2 text-sm">
      <input v-model="deleteLocalFiles" type="checkbox" class="accent-[var(--color-primary)]" />{{
        t('songList.deleteLocalFile')
      }}
    </label>
    <template #footer>
      <button
        class="btn-hover rounded-lg px-3 py-1.5 text-sm"
        @click="emit('update:modelValue', false)"
      >
        {{ t('common.cancel') }}
      </button>
      <button
        class="btn-hover rounded-lg bg-red-500 px-3 py-1.5 text-sm text-white"
        @click="confirm"
      >
        {{ t('songList.delete') }}
      </button>
    </template>
  </BaseDialog>
</template>
