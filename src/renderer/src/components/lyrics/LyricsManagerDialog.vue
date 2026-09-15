<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import { usePlayerStore } from '@/stores/player/playerStore'
import { useUIStore } from '@/stores/ui/uiStore'
import {
  resolveLyrics,
  type LyricFormat,
  type LyricSource,
  type NetworkLyricCandidate
} from '@/services/lyrics'

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
const lyricFormat = ref<LyricFormat | undefined>()
const translationFormat = ref<LyricFormat | undefined>()
const romanization = ref('')
const romanizationFormat = ref<LyricFormat | undefined>()
const query = ref({ title: '', artist: '', album: '' })
const resolvedSource = ref<LyricSource | null>(null)
const previewSource = ref<'auto' | LyricSource>('auto')
const sourceLabel = computed(() => {
  if (!resolvedSource.value) return t('playerPanel.lyricSourceNone')
  return t(`lyrics.source.${resolvedSource.value}`)
})
const isAutoPreview = computed(() => previewSource.value === 'auto')
const sources = computed(() => [
  { value: 'auto', label: t('playerPanel.lyricSourceAuto') },
  { value: 'embedded', label: t('lyrics.source.embedded') },
  { value: 'database', label: t('lyrics.source.database') },
  { value: 'local', label: t('lyrics.source.local') },
  { value: 'network', label: t('lyrics.source.network') }
])
async function loadDraft(source = previewSource.value): Promise<void> {
  const song = player.currentQueueSong
  lyric.value = ''
  translation.value = ''
  romanization.value = ''
  lyricFormat.value = undefined
  translationFormat.value = undefined
  romanizationFormat.value = undefined
  resolvedSource.value = null
  if (!song || source === 'network') return
  if (source === 'auto') {
    const result = await resolveLyrics(
      song,
      ui.lyricSourceOrder,
      'auto',
      ui.autoSearchNetworkLyrics
    )
    resolvedSource.value = result.source
    lyric.value = result.content || ''
    lyricFormat.value = result.format
    translation.value = result.translation || ''
    translationFormat.value = result.translationFormat
    romanization.value = result.romanization || ''
    romanizationFormat.value = result.romanizationFormat
    return
  }
  if (source === 'database') {
    const response = await window.api.database.command('getSong', { id: song.id })
    const data = response.success
      ? (response.data as {
          lrc?: string | null
          lyricFormat?: LyricFormat
          translation?: string | null
          translationFormat?: LyricFormat
          romanization?: string | null
          romanizationFormat?: LyricFormat
        })
      : null
    lyric.value = data?.lrc || ''
    lyricFormat.value = data?.lyricFormat
    translation.value = data?.translation || ''
    translationFormat.value = data?.translationFormat
    romanization.value = data?.romanization || ''
    romanizationFormat.value = data?.romanizationFormat
    return
  }
  const response = await window.api.lyrics.loadSource(song.audio, source)
  lyric.value = response.success ? response.data?.content || '' : ''
  lyricFormat.value = response.success ? response.data?.format : undefined
  resolvedSource.value = lyric.value ? source : null
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
  previewSource.value = ui.lyricSourceMode
  await loadDraft(previewSource.value)
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
  previewSource.value = source
  await loadDraft(source)
}
function applyPlaybackSource(): void {
  ui.lyricSourceMode = previewSource.value
}
function selectCandidate(index: number): void {
  selected.value = index
  const item = candidates.value[index]
  if (item) {
    previewSource.value = 'network'
    resolvedSource.value = 'network'
    lyric.value = item.lrc
    lyricFormat.value = item.format
    translation.value = item.translation || ''
    translationFormat.value = item.translation ? 'lrc' : undefined
    romanization.value = item.romanization || ''
    romanizationFormat.value = item.romanization ? 'lrc' : undefined
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
  if (isAutoPreview.value) return
  const song = player.currentQueueSong
  if (!song) return
  const response = await window.api.database.command('updateSongLyrics', {
    id: song.id,
    lrc: lyric.value,
    lyricFormat: lyricFormat.value,
    translation: translation.value || undefined,
    translationFormat: translation.value ? translationFormat.value : undefined,
    romanization: romanization.value || undefined,
    romanizationFormat: romanization.value ? romanizationFormat.value : undefined
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
    <div class="grid h-[min(64vh,42rem)] min-h-0 gap-5 md:grid-cols-[13rem_minmax(0,1fr)]">
      <div class="custom-scrollbar min-h-0 space-y-4 overflow-y-auto pr-1">
        <div>
          <p class="text-xs text-text-l">{{ t('playerPanel.lyricBrowseSource') }}</p>
          <p class="mb-2 mt-1 text-[10px] leading-relaxed text-text-l/70">
            {{ t('playerPanel.lyricBrowseSourceHint') }}
          </p>
          <div class="grid gap-1">
            <button
              v-for="source in sources"
              :key="source.value"
              class="manager-button rounded-lg px-3 py-2 text-left text-sm"
              :class="
                previewSource === source.value
                  ? 'bg-primary/25 text-primary'
                  : 'bg-text/5 hover:bg-text/10'
              "
              @click="selectSource(source.value as 'auto' | LyricSource)"
            >
              <span>{{ source.label }}</span>
              <span
                v-if="source.value === 'auto' && previewSource === 'auto'"
                class="ml-1 text-[10px] opacity-75"
                >· {{ sourceLabel }}
              </span>
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
      <div class="flex min-w-0 min-h-0 flex-col gap-3">
        <div
          v-if="candidates.length"
          class="candidate-list custom-scrollbar shrink-0 overflow-y-auto pr-1"
        >
          <div class="flex flex-wrap gap-2">
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
        </div>
        <p v-if="error" class="text-sm text-red-400">{{ error }}</p>
        <textarea
          v-model="lyric"
          class="lyric-editor lyric-editor--main custom-scrollbar min-h-0 flex-1"
          :readonly="isAutoPreview"
          :placeholder="t('playerPanel.lyricEditorPlaceholder')"
        />
        <textarea
          v-model="translation"
          class="lyric-editor lyric-editor--translation custom-scrollbar shrink-0"
          :readonly="isAutoPreview"
          :placeholder="t('playerPanel.lyricTranslationPlaceholder')"
        />
        <textarea
          v-model="romanization"
          class="lyric-editor lyric-editor--translation custom-scrollbar shrink-0"
          :readonly="isAutoPreview"
          :placeholder="t('playerPanel.lyricRomanizationPlaceholder')"
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
        :disabled="previewSource === ui.lyricSourceMode"
        @click="applyPlaybackSource"
      >
        {{
          previewSource === ui.lyricSourceMode
            ? t('playerPanel.lyricSourceCurrentSelection')
            : t('playerPanel.lyricSourceApply')
        }}
      </button>
      <button
        class="btn-hover-base rounded-lg bg-primary px-4 py-2 text-sm text-white disabled:opacity-50"
        type="button"
        :disabled="isAutoPreview"
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
  resize: vertical;
  padding: 0.75rem;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 0.75rem;
  line-height: 1.6;
}
.candidate-list {
  min-height: 3rem;
  max-height: 14rem;
  resize: vertical;
}
.lyric-editor--main {
  min-height: 8rem;
}
.lyric-editor::-webkit-scrollbar {
  width: 8px;
}
.lyric-editor::-webkit-scrollbar-track {
  background: color-mix(in srgb, var(--color-bg-l) 70%, transparent);
  border-radius: 999px;
}
.lyric-editor::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--color-text-l) 52%, transparent);
  border: 2px solid transparent;
  background-clip: padding-box;
  border-radius: 999px;
}
.lyric-editor::-webkit-scrollbar-thumb:hover {
  background: var(--color-primary);
  border: 2px solid transparent;
  background-clip: padding-box;
}
.lyric-editor--translation {
  height: 5.5rem;
  min-height: 5.5rem;
}
.lyric-input:focus,
.lyric-editor:focus {
  border-color: var(--color-primary);
}
.lyric-editor[readonly] {
  cursor: default;
}
</style>
