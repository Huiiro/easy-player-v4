<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import { usePlayerStore } from '@/stores/player/playerStore'
import { useUIStore } from '@/stores/ui/uiStore'
import type { LyricSource, NetworkLyricCandidate } from '@/services/lyrics'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void; (e: 'saved'): void }>()
const ui = useUIStore()
const player = usePlayerStore()
const { t } = useI18n()
const loading = ref(false)
const error = ref('')
const candidates = ref<NetworkLyricCandidate[]>([])
const selected = ref(0)
const lyric = ref('')
const translation = ref('')
const query = ref({ title: '', artist: '', album: '' })
const sources = computed(() => [
  { value: 'auto', label: t('playerPanel.lyricSourceAuto') },
  { value: 'embedded', label: t('lyrics.source.embedded') },
  { value: 'database', label: t('lyrics.source.database') },
  { value: 'local', label: t('lyrics.source.local') },
  { value: 'network', label: t('lyrics.source.network') }
])
async function loadDraft(source = ui.lyricSourceMode): Promise<void> {
  const song = player.currentQueueSong
  lyric.value = ''
  translation.value = ''
  if (!song || source === 'auto' || source === 'network') return
  if (source === 'database') {
    const response = await window.api.database.command('getSong', { id: song.id })
    const data = response.success
      ? (response.data as { lrc?: string | null; translation?: string | null })
      : null
    lyric.value = data?.lrc || ''
    translation.value = data?.translation || ''
    return
  }
  const response = await window.api.lyrics.loadSource(song.audio, source)
  lyric.value = response.success ? response.data || '' : ''
}
async function initializeDraft(): Promise<void> {
  const metadata = player.trackInfo?.metadata
  const song = player.currentQueueSong
  query.value = {
    title: metadata?.title?.trim() || song?.title || '',
    artist: metadata?.artist?.trim() || song?.artist || '',
    album: metadata?.album?.trim() || song?.album || ''
  }
  candidates.value = []
  selected.value = 0
  error.value = ''
  await loadDraft()
}
function updateVisible(value: boolean): void {
  emit('update:modelValue', value)
}
watch(
  () => props.modelValue,
  (visible) => {
    if (visible) void initializeDraft()
  }
)
async function selectSource(source: 'auto' | LyricSource): Promise<void> {
  ui.lyricSourceMode = source
  await loadDraft(source)
}
function selectCandidate(index: number): void {
  selected.value = index
  const item = candidates.value[index]
  if (item) {
    lyric.value = item.lrc
    translation.value = item.translation || ''
  }
}
async function search(): Promise<void> {
  if (!query.value.title.trim()) return
  loading.value = true
  error.value = ''
  candidates.value = []
  try {
    const response = await window.api.lyrics.searchNetwork({ ...query.value })
    if (!response.success) throw new Error(response.error)
    candidates.value = response.data || []
    if (candidates.value.length) selectCandidate(0)
    else error.value = t('playerPanel.lyricSearchEmpty')
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : t('playerPanel.lyricSearchFailed')
  } finally {
    loading.value = false
  }
}
async function save(): Promise<void> {
  const song = player.currentQueueSong
  if (!song) return
  const response = await window.api.database.command('updateSongLyrics', {
    id: song.id,
    lrc: lyric.value,
    translation: translation.value || undefined
  })
  if (!response.success) return
  emit('saved')
  emit('update:modelValue', false)
}
</script>

<template>
  <BaseDialog
    :model-value="props.modelValue"
    :title="t('playerPanel.lyricManage')"
    :close-on-overlay="false"
    width="max-w-4xl"
    @update:model-value="updateVisible"
  >
    <div class="grid gap-5 md:grid-cols-[13rem_minmax(0,1fr)]">
      <div class="space-y-4">
        <div>
          <p class="mb-2 text-xs text-text-l">{{ t('playerPanel.lyricSource') }}</p>
          <div class="grid gap-1">
            <button
              v-for="source in sources"
              :key="source.value"
              class="manager-button rounded-lg px-3 py-2 text-left text-sm"
              :class="
                ui.lyricSourceMode === source.value
                  ? 'bg-primary/25 text-primary'
                  : 'bg-text/5 hover:bg-text/10'
              "
              @click="selectSource(source.value as 'auto' | LyricSource)"
            >
              {{ source.label }}
            </button>
          </div>
        </div>
        <div class="space-y-2 border-t border-border pt-4">
          <p class="text-xs text-text-l">{{ t('playerPanel.lyricSearch') }}</p>
          <input
            v-model="query.title"
            class="lyric-input"
            :placeholder="t('playerPanel.lyricTitle')"
          />
          <input
            v-model="query.artist"
            class="lyric-input"
            :placeholder="t('playerPanel.lyricArtist')"
          />
          <input
            v-model="query.album"
            class="lyric-input"
            :placeholder="t('playerPanel.lyricAlbum')"
          />
          <button
            class="manager-button w-full rounded-lg bg-primary px-3 py-2 text-sm text-white disabled:opacity-50"
            :disabled="loading || !query.title.trim()"
            @click="search"
          >
            {{ loading ? t('playerPanel.lyricSearching') : t('playerPanel.lyricSearch') }}
          </button>
        </div>
      </div>
      <div class="min-w-0 space-y-3">
        <div v-if="candidates.length" class="flex flex-wrap gap-2">
          <button
            v-for="(candidate, index) in candidates"
            :key="candidate.id"
            class="manager-button max-w-full rounded-lg px-2.5 py-1.5 text-left text-xs"
            :class="
              selected === index ? 'bg-primary/25 text-primary' : 'bg-text/5 hover:bg-text/10'
            "
            @click="selectCandidate(index)"
          >
            {{
              t(
                candidate.provider === 'netease'
                  ? 'playerPanel.lyricProviderNetease'
                  : 'playerPanel.lyricProviderKugou'
              )
            }}
            · {{ candidate.title }} — {{ candidate.artist }}
          </button>
        </div>
        <p v-if="error" class="text-sm text-red-400">{{ error }}</p>
        <textarea
          v-model="lyric"
          class="lyric-editor"
          :placeholder="t('playerPanel.lyricEditorPlaceholder')"
        />
        <textarea
          v-model="translation"
          class="lyric-editor lyric-editor--translation"
          :placeholder="t('playerPanel.lyricTranslationPlaceholder')"
        />
      </div>
    </div>
    <template #footer>
      <button
        class="manager-button text-sm pr-4"
        type="button"
        @click="emit('update:modelValue', false)"
      >
        {{ t('common.cancel') }}
      </button>
      <button
        class="btn-hover-base rounded-lg bg-primary px-4 py-2 text-sm text-white disabled:opacity-50"
        type="button"
        @click="save"
      >
        {{ t('common.save') }}
      </button>
    </template>
  </BaseDialog>
</template>

<style scoped>
.manager-button {
  transition:
    transform 150ms ease,
    filter 150ms ease,
    background-color 150ms ease;
}
.manager-button:hover:not(:disabled) {
  transform: translateY(-1px);
  filter: brightness(1.08);
}
.manager-button:active:not(:disabled) {
  transform: scale(0.97);
}
.lyric-input,
.lyric-editor {
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
  background: rgb(255 255 255 / 0.06);
  color: var(--color-text);
  outline: 0;
}
.lyric-input {
  padding: 0.5rem 0.65rem;
  font-size: 0.8125rem;
}
.lyric-editor {
  display: block;
  min-height: 14rem;
  resize: vertical;
  padding: 0.75rem;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 0.75rem;
  line-height: 1.6;
}
.lyric-editor--translation {
  min-height: 7rem;
}
.lyric-input:focus,
.lyric-editor:focus {
  border-color: var(--color-primary);
}
</style>
