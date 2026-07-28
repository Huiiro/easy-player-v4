<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import type { SongDetails } from '@/types/library'

const props = defineProps<{ modelValue: boolean; songId: number | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const { t } = useI18n()
const loading = ref(false)
const song = ref<SongDetails | null>(null)

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds < 0) return '—'
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}
function formatFileSize(bytes: number | null): string {
  if (bytes === null || bytes < 0) return '—'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
async function load(): Promise<void> {
  if (!props.modelValue || !props.songId) return
  loading.value = true
  song.value = null
  try {
    const response = await window.api.database.command('getSong', { id: props.songId })
    song.value = response.success && response.data ? (response.data as SongDetails) : null
  } finally {
    loading.value = false
  }
}
watch(
  () => [props.modelValue, props.songId],
  () => void load(),
  { immediate: true }
)
</script>

<template>
  <BaseDialog
    :model-value="modelValue"
    :title="t('songDetails.title')"
    width="max-w-3xl"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <p v-if="loading" class="py-8 text-center text-sm text-[var(--color-text-l)]">
      {{ t('songDetails.loading') }}
    </p>
    <p v-else-if="!song" class="py-8 text-center text-sm text-[var(--color-text-l)]">
      {{ t('songDetails.loadFailed') }}
    </p>
    <div v-else class="space-y-5 text-sm">
      <section>
        <h3 class="mb-2 font-semibold">{{ song.title }}</h3>
        <div class="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          <p>
            <span class="detail-label">{{ t('songDetails.artist') }}</span>
            {{ song.artist || '—' }}
          </p>
          <p>
            <span class="detail-label">{{ t('songDetails.album') }}</span>
            {{ song.album || '—' }}
          </p>
          <p>
            <span class="detail-label">{{ t('songDetails.genre') }}</span>
            {{ song.genre || '—' }}
          </p>
          <p>
            <span class="detail-label">{{ t('songDetails.year') }}</span>
            {{ song.year ?? '—' }}
          </p>
          <p>
            <span class="detail-label">{{ t('songDetails.track') }}</span>
            {{ song.trackNo ?? '—' }}
          </p>
          <p>
            <span class="detail-label">{{ t('songDetails.disc') }}</span>
            {{ song.diskNo ?? '—' }}
          </p>
        </div>
      </section>
      <section>
        <h3 class="mb-2 font-semibold">{{ t('songDetails.audio') }}</h3>
        <div class="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          <p>
            <span class="detail-label">{{ t('songDetails.format') }}</span>
            {{ song.format || '—' }}
          </p>
          <p>
            <span class="detail-label">{{ t('songDetails.duration') }}</span>
            {{ formatDuration(song.duration) }}
          </p>
          <p>
            <span class="detail-label">{{ t('songDetails.fileSize') }}</span>
            {{ formatFileSize(song.fileSize) }}
          </p>
          <p>
            <span class="detail-label">{{ t('songDetails.bitrate') }}</span>
            {{ song.bitrate ? `${song.bitrate} kbps` : '—' }}
          </p>
          <p>
            <span class="detail-label">{{ t('songDetails.sampleRate') }}</span>
            {{ song.sampleRate ? `${song.sampleRate} Hz` : '—' }}
          </p>
          <p>
            <span class="detail-label">{{ t('songDetails.bitDepth') }}</span>
            {{ song.bitDepth ? `${song.bitDepth} bit` : '—' }}
          </p>
          <p>
            <span class="detail-label">{{ t('songDetails.channels') }}</span>
            {{ song.channels ?? '—' }}
          </p>
          <p>
            <span class="detail-label">{{ t('songDetails.playTimes') }}</span>
            {{ song.playTimes }}
          </p>
        </div>
      </section>
      <section>
        <h3 class="mb-2 font-semibold">{{ t('songDetails.source') }}</h3>
        <p>
          <span class="detail-label">{{ t('songDetails.filePath') }}</span>
          <span class="break-all">{{ song.audio }}</span>
        </p>
        <p>
          <span class="detail-label">{{ t('songDetails.fileName') }}</span>
          {{ song.fileName || '—' }}
        </p>
        <p>
          <span class="detail-label">{{ t('songDetails.createdAt') }}</span>
          {{ song.createdAt }}
        </p>
        <p v-if="song.remoteId">
          <span class="detail-label">{{ t('songDetails.remoteId') }}</span>
          {{ song.remoteId }}
        </p>
      </section>
      <section v-if="song.tags?.length">
        <h3 class="mb-2 font-semibold">{{ t('songDetails.tags') }}</h3>
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="tag in song.tags"
            :key="tag.id"
            class="rounded-full px-2 py-0.5 text-xs text-white"
            :style="{ backgroundColor: tag.color || '#7c3aed' }"
            >{{ tag.name }}</span
          >
        </div>
      </section>
    </div>
  </BaseDialog>
</template>

<style scoped>
.detail-label {
  margin-right: 0.35rem;
  color: var(--color-text-l);
  font-weight: 500;
}
.detail-label::after {
  content: '：';
}
</style>
