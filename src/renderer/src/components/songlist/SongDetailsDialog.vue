<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import type { SongDetails } from '@/types/library'
import { useUIStore } from '@/stores/ui/uiStore'
import { formatGenres } from '@/utils/genres'
import { formatArtists } from '@/utils/artists'

const props = defineProps<{ modelValue: boolean; songId: number | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const { t } = useI18n()
const ui = useUIStore()
const loading = ref(false)
const song = ref<SongDetails | null>(null)
const coverFailed = ref(false)
const coverUrl = computed(() =>
  song.value?.cover
    ? `easy-player-media://cover?path=${encodeURIComponent(song.value.cover)}`
    : null
)
const badges = computed(() => {
  const value = song.value
  const items: Array<{ id: string; icon: string; label: string; danger?: boolean }> = []
  if (!value) return items
  if (value.preference === 1 || value.preference === -1)
    items.push({
      id: 'preference',
      icon: value.preference === 1 ? 'play-like' : 'play-dislike',
      label: t(value.preference === 1 ? 'songList.like' : 'songList.dislike'),
      danger: value.preference === -1
    })
  if (value.sourceId != null)
    items.push({ id: 'remote', icon: 'menu-remote', label: t('songList.remoteSong') })
  if (value.disableNetworkLyrics)
    items.push({
      id: 'disable-network',
      icon: 'common-no-internet',
      label: t('lyrics.disableNetwork')
    })
  if (value.instrumental)
    items.push({ id: 'instrumental', icon: 'common-music-notes', label: t('lyrics.instrumental') })
  if (value.songStatus === 0)
    items.push({
      id: 'unavailable',
      icon: 'common-close',
      label: t('songDetails.unavailable'),
      danger: true
    })
  return items
})
let loadRevision = 0
onBeforeUnmount(() => {
  ++loadRevision
})

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
  const revision = ++loadRevision
  const id = props.songId
  song.value = null
  coverFailed.value = false
  loading.value = false
  if (!props.modelValue || !id) return
  loading.value = true
  try {
    const response = await window.api.database.command('getSong', { id })
    if (revision === loadRevision)
      song.value = response.success && response.data ? (response.data as SongDetails) : null
  } catch {
    if (revision === loadRevision) song.value = null
  } finally {
    if (revision === loadRevision) loading.value = false
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
      <section class="flex items-start gap-4" data-song-summary>
        <img
          v-if="coverUrl && !coverFailed"
          :key="coverUrl"
          :src="coverUrl"
          :alt="t('songDetails.coverAlt', { title: song.title })"
          class="size-24 shrink-0 rounded-xl object-cover sm:size-28"
          @error="coverFailed = true"
        />
        <div
          v-else
          class="grid size-24 shrink-0 place-items-center rounded-xl bg-bg-l text-text-l sm:size-28"
          role="img"
          :aria-label="t('songDetails.noCover')"
        >
          <SvgIcon name="common-music" class-name="size-10 opacity-60" />
        </div>
        <div class="min-w-0 flex-1 py-1">
          <h3 class="break-words text-lg font-semibold leading-snug">{{ song.title }}</h3>
          <p v-if="song.artist" class="mt-1 break-words text-text-l">
            {{ formatArtists(song.artist, ui.artistSeparator, ui.normalizeMetadataSeparator) }}
          </p>
          <div
            v-if="badges.length"
            class="mt-3 flex flex-wrap gap-1.5"
            role="group"
            :aria-label="t('songDetails.flags')"
          >
            <span
              v-for="badge in badges"
              :key="badge.id"
              :data-song-flag="badge.id"
              class="inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs"
              :class="
                badge.danger
                  ? 'border-danger/20 bg-danger/5 text-danger'
                  : 'border-primary/20 bg-primary/5 text-primary'
              "
            >
              <SvgIcon :name="badge.icon" class-name="size-3.5 shrink-0" />
              {{ badge.label }}
            </span>
          </div>
        </div>
      </section>
      <section>
        <dl class="detail-grid">
          <div class="detail-field">
            <dt class="detail-label">{{ t('songDetails.artist') }}</dt>
            <dd class="detail-value">
              {{
                formatArtists(song.artist, ui.artistSeparator, ui.normalizeMetadataSeparator) || '—'
              }}
            </dd>
          </div>
          <div class="detail-field">
            <dt class="detail-label">{{ t('songDetails.album') }}</dt>
            <dd class="detail-value">{{ song.album || '—' }}</dd>
          </div>
          <div class="detail-field">
            <dt class="detail-label">{{ t('songDetails.genre') }}</dt>
            <dd class="detail-value">
              {{
                formatGenres(song.genre, ui.genreSeparator, ui.normalizeMetadataSeparator) || '—'
              }}
            </dd>
          </div>
          <div class="detail-field">
            <dt class="detail-label">{{ t('songDetails.year') }}</dt>
            <dd class="detail-value">{{ song.year ?? '—' }}</dd>
          </div>
          <div class="detail-field">
            <dt class="detail-label">{{ t('songDetails.track') }}</dt>
            <dd class="detail-value">{{ song.trackNo ?? '—' }}</dd>
          </div>
          <div class="detail-field">
            <dt class="detail-label">{{ t('songDetails.disc') }}</dt>
            <dd class="detail-value">{{ song.diskNo ?? '—' }}</dd>
          </div>
        </dl>
      </section>
      <section>
        <h3 class="mb-2 font-semibold">{{ t('songDetails.audio') }}</h3>
        <dl class="detail-grid">
          <div class="detail-field">
            <dt class="detail-label">{{ t('songDetails.format') }}</dt>
            <dd class="detail-value">{{ song.format || '—' }}</dd>
          </div>
          <div class="detail-field">
            <dt class="detail-label">{{ t('songDetails.duration') }}</dt>
            <dd class="detail-value">{{ formatDuration(song.duration) }}</dd>
          </div>
          <div class="detail-field">
            <dt class="detail-label">{{ t('songDetails.fileSize') }}</dt>
            <dd class="detail-value">{{ formatFileSize(song.fileSize) }}</dd>
          </div>
          <div class="detail-field">
            <dt class="detail-label">{{ t('songDetails.bitrate') }}</dt>
            <dd class="detail-value">{{ song.bitrate ? `${song.bitrate} kbps` : '—' }}</dd>
          </div>
          <div class="detail-field">
            <dt class="detail-label">{{ t('songDetails.sampleRate') }}</dt>
            <dd class="detail-value">{{ song.sampleRate ? `${song.sampleRate} Hz` : '—' }}</dd>
          </div>
          <div class="detail-field">
            <dt class="detail-label">{{ t('songDetails.bitDepth') }}</dt>
            <dd class="detail-value">{{ song.bitDepth ? `${song.bitDepth} bit` : '—' }}</dd>
          </div>
          <div class="detail-field">
            <dt class="detail-label">{{ t('songDetails.channels') }}</dt>
            <dd class="detail-value">{{ song.channels ?? '—' }}</dd>
          </div>
          <div class="detail-field">
            <dt class="detail-label">{{ t('songDetails.playTimes') }}</dt>
            <dd class="detail-value">{{ song.playTimes }}</dd>
          </div>
        </dl>
      </section>
      <section>
        <h3 class="mb-2 font-semibold">{{ t('songDetails.source') }}</h3>
        <dl class="detail-grid detail-grid--single">
          <div class="detail-field">
            <dt class="detail-label">{{ t('songDetails.fileName') }}</dt>
            <dd class="detail-value">{{ song.fileName || '—' }}</dd>
          </div>
          <div class="detail-field">
            <dt class="detail-label">{{ t('songDetails.filePath') }}</dt>
            <dd class="detail-value">
              <span class="break-all">{{ song.audio }}</span>
            </dd>
          </div>

          <div class="detail-field">
            <dt class="detail-label">{{ t('songDetails.createdAt') }}</dt>
            <dd class="detail-value">{{ song.createdAt }}</dd>
          </div>
          <div v-if="song.remoteId" class="detail-field">
            <dt class="detail-label">{{ t('songDetails.remoteId') }}</dt>
            <dd class="detail-value">{{ song.remoteId }}</dd>
          </div>
        </dl>
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
.detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.625rem 2rem;
}
.detail-field {
  display: grid;
  grid-template-columns: 5.5rem minmax(0, 1fr);
  align-items: start;
  column-gap: 0.75rem;
}
.detail-label {
  color: var(--color-text-l);
  font-weight: 500;
}
.detail-label::after {
  content: '：';
}
.detail-value {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}
@media (min-width: 640px) {
  .detail-grid:not(.detail-grid--single) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
