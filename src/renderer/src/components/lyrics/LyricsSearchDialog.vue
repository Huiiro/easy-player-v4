<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { createSourceRequestScope } from '@/services/sourceRequests'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import { usePlayerStore } from '@/stores/player/playerStore'
import { useUIStore } from '@/stores/ui/uiStore'
import eventBus from '@/utils/eventBus'
import type { LibrarySong } from '@/types/library'
import type { LyricFormat, NetworkLyricCandidate } from '@/services/lyrics'

type EditingSong = Pick<LibrarySong, 'id' | 'audio' | 'title' | 'artist' | 'album'>
const props = defineProps<{ modelValue: boolean; song?: EditingSong | null }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void; (e: 'saved'): void }>()
const ui = useUIStore()
const player = usePlayerStore()
const editingSong = shallowRef<EditingSong | null>(null)
const saving = ref(false)
const settingsReady = ref(false)

let editSession = 0
const { t } = useI18n()
const providerLabelKeys: Record<string, string> = {
  netease: 'playerPanel.lyricProviderNetease',
  kugou: 'playerPanel.lyricProviderKugou',
  qqmusic: 'playerPanel.lyricProviderQQMusic'
}
const requests = createSourceRequestScope()
const loading = ref(false)
function cancelRequest(): void {
  requests.cancelAll()
  loading.value = false
  draftLoading.value = false
}
onBeforeUnmount(() => {
  editSession++
  cancelRequest()
})
const error = ref('')
const candidates = ref<NetworkLyricCandidate[]>([])
const searched = ref(false)
const selected = ref(0)
const lyric = ref('')
const translation = ref('')
const lyricFormat = ref<LyricFormat | undefined>()
const translationFormat = ref<LyricFormat | undefined>()
const romanization = ref('')
const romanizationFormat = ref<LyricFormat | undefined>()
const query = ref({ title: '', artist: '', album: '' })
const draftLoading = ref(false)
async function loadDraft(): Promise<void> {
  requests.cancel('draft')
  const song = editingSong.value
  lyric.value = ''
  translation.value = ''
  romanization.value = ''
  lyricFormat.value = undefined
  translationFormat.value = undefined
  romanizationFormat.value = undefined
  draftLoading.value = false
  if (!song) return
  const call = requests.start('draft')
  draftLoading.value = true
  try {
    const response = await window.api.database.command('getSong', { id: song.id })
    if (!call.isCurrent()) return
    if (!response.success) throw new Error(response.error)
    const data = response.data as {
      lrc?: string | null
      lyricFormat?: LyricFormat
      translation?: string | null
      translationFormat?: LyricFormat
      romanization?: string | null
      romanizationFormat?: LyricFormat
    } | null
    lyric.value = data?.lrc || ''
    lyricFormat.value = data?.lyricFormat
    translation.value = data?.translation || ''
    translationFormat.value = data?.translationFormat
    romanization.value = data?.romanization || ''
    romanizationFormat.value = data?.romanizationFormat
  } catch (cause) {
    if (call.isCurrent()) error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (call.isCurrent()) draftLoading.value = false
    call.finish()
  }
}
async function initializeDraft(): Promise<void> {
  const song = editingSong.value
  const session = editSession
  if (!song) return
  const metadata =
    player.currentQueueSong?.id === song.id && player.trackInfo?.filePath === song.audio
      ? player.trackInfo?.metadata
      : null
  query.value = {
    title: metadata?.title?.trim() || song?.title || '',
    artist: metadata?.artist?.trim() || song?.artist || '',
    album: metadata?.album?.trim() || song?.album || ''
  }
  candidates.value = []
  searched.value = false
  selected.value = 0
  error.value = ''
  await loadDraft()
  if (session === editSession) settingsReady.value = true
}
function updateVisible(value: boolean): void {
  emit('update:modelValue', value)
}
function afterLeave(): void {
  if (props.modelValue) return
  cancelRequest()
  settingsReady.value = false
  saving.value = false
  editingSong.value = null
  candidates.value = []
  lyric.value = translation.value = romanization.value = ''
  error.value = ''
}
watch(
  // Playback can advance independently; each open dialog owns one editing target.
  () => props.modelValue,
  (visible) => {
    editSession++
    requests.cancelAll()
    if (!visible) return
    settingsReady.value = false
    cancelRequest()
    saving.value = false
    const song = visible ? (props.song !== undefined ? props.song : player.currentQueueSong) : null
    editingSong.value = song
      ? {
          id: song.id,
          audio: song.audio,
          title: song.title,
          artist: song.artist,
          album: song.album
        }
      : null
    if (visible) void initializeDraft()
  },
  { immediate: true }
)
function selectCandidate(index: number): void {
  requests.cancel('draft')
  draftLoading.value = false
  selected.value = index
  const item = candidates.value[index]
  if (item) {
    lyric.value = item.lrc
    lyricFormat.value = item.format
    translation.value = item.translation || ''
    translationFormat.value = item.translationFormat ?? (item.translation ? 'lrc' : undefined)
    romanization.value = item.romanization || ''
    romanizationFormat.value = item.romanizationFormat ?? (item.romanization ? 'lrc' : undefined)
  }
}
async function search(): Promise<void> {
  if (
    !props.modelValue ||
    !editingSong.value ||
    saving.value ||
    !settingsReady.value ||
    !query.value.title.trim()
  )
    return
  requests.cancel('draft')
  draftLoading.value = false
  const call = requests.start('search')
  loading.value = true
  error.value = ''
  candidates.value = []
  searched.value = false
  try {
    const response = await window.api.lyrics.searchNetwork(
      {
        ...query.value,
        songId: editingSong.value.id,
        searchMode: 'manual',
        preferWordTimed: ui.preferWordTimedNetworkLyrics
      },
      call.options
    )
    if (!call.isCurrent()) return
    if (!response.success) throw new Error(response.error)
    candidates.value = response.data || []
    searched.value = true
    if (candidates.value.length) selectCandidate(0)
  } catch (reason) {
    if (call.isCurrent())
      error.value = reason instanceof Error ? reason.message : t('playerPanel.lyricSearchFailed')
  } finally {
    if (call.isCurrent()) loading.value = false
    call.finish()
  }
}
async function save(): Promise<void> {
  if (!props.modelValue || !settingsReady.value || draftLoading.value || saving.value) return
  const song = editingSong.value
  if (!song) return
  const session = editSession
  saving.value = true
  try {
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
    eventBus.emit('lyricsUpdated', song.id)
    if (session !== editSession || !props.modelValue) return
    emit('saved')
    emit('update:modelValue', false)
  } finally {
    if (session === editSession) saving.value = false
  }
}
</script>

<template>
  <BaseDialog
    :model-value="props.modelValue"
    :title="t('playerPanel.lyricSearchTitle')"
    :close-on-overlay="false"
    width="max-w-5xl"
    @update:model-value="updateVisible"
    @after-leave="afterLeave"
  >
    <div class="grid h-[min(68vh,45rem)] min-h-0 gap-5 md:grid-cols-[13rem_minmax(0,1fr)]">
      <div class="flex min-h-0 flex-col gap-4 overflow-hidden" data-lyric-search-sidebar>
        <div
          class="candidate-list custom-scrollbar min-h-0 flex-1 overflow-y-auto pr-1"
          data-lyric-search-results
        >
          <p v-if="candidates.length" class="mb-2 text-xs text-text-l">
            {{ t('playerPanel.lyricSearchResults') }}
          </p>
          <p
            v-else
            class="grid min-h-full place-items-center px-3 text-center text-xs leading-relaxed text-text-l"
            role="status"
          >
            {{
              loading
                ? t('playerPanel.lyricSearching')
                : searched
                  ? t('playerPanel.lyricSearchEmpty')
                  : t('playerPanel.lyricSearchHint')
            }}
          </p>
          <div v-if="candidates.length" class="flex flex-col gap-2">
            <button
              v-for="(candidate, index) in candidates"
              :key="candidate.id"
              class="manager-button w-full max-w-full break-words rounded-lg px-2.5 py-1.5 text-left text-xs"
              :class="
                selected === index ? 'bg-primary/25 text-primary' : 'bg-text/5 hover:bg-text/10'
              "
              @click="selectCandidate(index)"
            >
              <span class="block font-medium">
                {{ candidate.title }}
                <template v-if="candidate.artist"> — {{ candidate.artist }}</template>
              </span>
              <span class="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                <span class="text-current/75">
                  {{
                    providerLabelKeys[candidate.provider]
                      ? t(providerLabelKeys[candidate.provider])
                      : candidate.providerName
                  }}
                </span>
                <span class="inline-flex items-center gap-1 rounded bg-text/10 px-1.5 py-0.5">
                  {{ (candidate.format || 'lrc').toUpperCase() }}
                  ·
                  {{
                    t(
                      candidate.supportsWordTiming
                        ? 'playerPanel.lyricWordTimed'
                        : 'playerPanel.lyricLineTimed'
                    )
                  }}
                </span>
              </span>
            </button>
          </div>
        </div>
        <div class="shrink-0 space-y-2 border-t border-border pt-3" data-lyric-search-form>
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
          <BaseButton
            class="w-full"
            :disabled="loading || saving || !editingSong || !settingsReady || !query.title.trim()"
            @click="search"
          >
            {{ loading ? t('playerPanel.lyricSearching') : t('playerPanel.lyricSearch') }}
          </BaseButton>
          <BaseButton v-if="loading" variant="secondary" class="w-full" @click="cancelRequest">
            {{ t('common.cancelRequest') }}
          </BaseButton>
        </div>
      </div>
      <div class="flex min-w-0 min-h-0 flex-col gap-3" data-lyric-search-editor>
        <p v-if="error" class="text-sm text-danger">{{ error }}</p>
        <textarea
          v-model="lyric"
          class="lyric-editor lyric-editor--main custom-scrollbar min-h-0 flex-1 ep-lyric-textarea"
          :readonly="draftLoading || saving || !editingSong || !settingsReady"
          :placeholder="t('playerPanel.lyricEditorPlaceholder')"
        />
        <textarea
          v-model="translation"
          class="lyric-editor lyric-editor--translation custom-scrollbar shrink-0 ep-lyric-textarea"
          :readonly="draftLoading || saving || !editingSong || !settingsReady"
          :placeholder="t('playerPanel.lyricTranslationPlaceholder')"
        />
        <textarea
          v-model="romanization"
          class="lyric-editor lyric-editor--translation custom-scrollbar shrink-0 ep-lyric-textarea"
          :readonly="draftLoading || saving || !editingSong || !settingsReady"
          :placeholder="t('playerPanel.lyricRomanizationPlaceholder')"
        />
      </div>
    </div>
    <template #footer>
      <p
        v-if="editingSong"
        class="mr-auto min-w-0 flex-1 truncate text-xs text-text-l"
        :title="[editingSong.title, editingSong.artist].filter(Boolean).join(' — ')"
      >
        {{ editingSong.title }}
        <template v-if="editingSong.artist"> — {{ editingSong.artist }}</template>
      </p>
      <BaseButton variant="cancel" type="button" @click="emit('update:modelValue', false)">
        {{ t('common.cancel') }}
      </BaseButton>
      <BaseButton
        type="button"
        :disabled="draftLoading || saving || !editingSong || !settingsReady"
        @click="save"
      >
        {{ t('playerPanel.lyricSaveDatabase') }}
      </BaseButton>
    </template>
  </BaseDialog>
</template>

<style scoped>
.manager-button {
  transition:
    transform var(--motion-duration-fast) var(--motion-ease-standard),
    filter var(--motion-duration-fast) var(--motion-ease-standard),
    background-color var(--motion-duration-fast) var(--motion-ease-standard);
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
  overscroll-behavior: contain;
}
.lyric-editor--main {
  min-height: 8rem;
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
