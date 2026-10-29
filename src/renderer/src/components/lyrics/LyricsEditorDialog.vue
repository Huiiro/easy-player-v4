<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import BaseConfirmDialog from '@/components/ui/BaseConfirmDialog.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import eventBus from '@/utils/eventBus'
import { normalizeLyricOffset } from '../../../../shared/songLyrics'
import type { LyricFormat } from '@/services/lyrics'
import {
  lyricTracks,
  editorTrack,
  emptyLyricDraft,
  sameLyricDraft,
  LyricEditorHistory,
  lyricEditorRows,
  lyricEditorRecords,
  lyricTimeLabel,
  editLyricRecord,
  appendLyricLine,
  insertLyricRow,
  deleteLyricRow,
  fillPlainLyricLine,
  findLyricMatches,
  replaceLyricMatches,
  type LyricTrack,
  type LyricEditorDraft,
  type LyricEditorRecord,
  type LyricEditorRow,
  type LyricEditorMatch
} from '@/services/lyricEditor'

const props = defineProps<{ modelValue: boolean; songId: number | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; saved: [songId: number] }>()
const { t } = useI18n()
const draft = shallowRef(emptyLyricDraft())
const original = shallowRef(emptyLyricDraft())
let history = new LyricEditorHistory(draft.value)
const canUndo = ref(false)
const canRedo = ref(false)
const target = shallowRef<{ id: number; title: string; artist: string | null } | null>(null)
const loading = ref(false)
const ready = ref(false)
const saving = ref(false)
const error = ref('')
const layout = ref<'separate' | 'merged'>('separate')
const editable = ref(true)
const activeTrack = ref<LyricTrack>('lyric')
const discardOpen = ref(false)
const root = ref<HTMLElement>()
const showSearch = ref(false)
const showOffset = ref(false)
const activeEditor = ref<string | null>(null)
const metadataOpen = ref(false)
const selection = shallowRef<LyricEditorMatch | null>(null)
let revealingMatch = false
let session = 0
const pendingCells = ref<Record<string, string>>({})
const offsetInput = ref('')
const hasPending = computed(
  () =>
    Object.keys(pendingCells.value).length > 0 ||
    offsetInput.value !== (draft.value.offsetMs == null ? '' : String(draft.value.offsetMs))
)
watch(
  () => draft.value.offsetMs,
  (value) => {
    offsetInput.value = value == null ? '' : String(value)
  }
)
const busy = computed(() => loading.value || saving.value || !ready.value)
const dirty = computed(() => hasPending.value || !sameLyricDraft(draft.value, original.value))
const rows = computed(() => lyricEditorRows(draft.value))
const formats: LyricFormat[] = ['lrc', 'elrc', 'yrc', 'krc', 'ttml', 'plain']
const formatOptions = computed(() =>
  formats.map((value) => ({
    value,
    label: value === 'plain' ? t('lyricEditor.plain') : value.toUpperCase()
  }))
)
const searchText = ref('')
const replacement = ref('')
const caseSensitive = ref(false)
const searchScope = ref('all')
const currentMatch = shallowRef<LyricEditorMatch | null>(null)
const scopeOptions = computed(() => [
  { value: 'all', label: t('lyricEditor.allTracks') },
  { value: 'current', label: t('lyricEditor.currentTrack') },
  ...lyricTracks.map((value) => ({ value, label: t(`lyricEditor.${value}`) }))
])
const searchTracks = computed(() =>
  searchScope.value === 'all'
    ? [...lyricTracks]
    : searchScope.value === 'current'
      ? [activeTrack.value]
      : [searchScope.value as LyricTrack]
)
const matches = computed(() =>
  findLyricMatches(draft.value, searchTracks.value, searchText.value, caseSensitive.value)
)
const currentMatchIndex = computed(() =>
  currentMatch.value
    ? matches.value.findIndex(
        (match) =>
          match.track === currentMatch.value?.track &&
          match.start === currentMatch.value?.start &&
          match.end === currentMatch.value?.end
      )
    : -1
)
const matchLocation = computed(() => {
  if (currentMatchIndex.value < 0) return ''
  const match = matches.value[currentMatchIndex.value]
  const prefix = draft.value[match.track].content.slice(0, match.start)
  const lines = prefix.split(/\r\n|\r|\n/)
  return t('lyricEditor.matchLocation', {
    track: t(`lyricEditor.${match.track}`),
    line: lines.length,
    column: Array.from(lines.at(-1) || '').length + 1
  })
})
watch([searchText, searchScope, caseSensitive], () => {
  currentMatch.value = null
})
watch(activeTrack, () => {
  if (searchScope.value === 'current') currentMatch.value = null
})

function apply(next: LyricEditorDraft, group = ''): void {
  draft.value = history.commit(next, group)
  canUndo.value = history.canUndo
  canRedo.value = history.canRedo
  currentMatch.value = null
  pendingCells.value = {}
}
function flushCell(): void {
  const element = document.activeElement
  if (
    element instanceof HTMLTextAreaElement &&
    element.hasAttribute('data-lyric-cell') &&
    Object.hasOwn(pendingCells.value, element.dataset.lyricCell || '') &&
    root.value?.contains(element)
  )
    element.dispatchEvent(new Event('change', { bubbles: true }))
  if (element instanceof HTMLInputElement && element.id === 'song-lyric-editor-offset')
    setOffset(offsetInput.value)
}
function stageCell(key: string, event: Event): void {
  pendingCells.value = { ...pendingCells.value, [key]: (event.target as HTMLTextAreaElement).value }
}
function editorKey(row: LyricEditorRow, record: LyricEditorRecord): string {
  return row.metadata ? `${row.key}:${record.key}` : `row:${row.key}`
}
async function openRecord(row: LyricEditorRow, record: LyricEditorRecord): Promise<void> {
  flushCell()
  activeEditor.value = editorKey(row, record)
  await nextTick()
  const textarea = [
    ...(root.value?.querySelectorAll<HTMLTextAreaElement>('[data-lyric-cell]') ?? [])
  ].find((element) => element.dataset.lyricCell === record.key)
  textarea?.focus({ preventScroll: true })
}
function openRow(row: LyricEditorRow): void {
  const record = row.cells.lyric[0] || row.cells.romanization[0] || row.cells.translation[0]
  if (record) void openRecord(row, record)
}
function finishRecord(): void {
  flushCell()
  activeEditor.value = null
}
function undo(): void {
  if (busy.value || !editable.value) return
  flushCell()
  draft.value = history.undo()
  canUndo.value = history.canUndo
  canRedo.value = history.canRedo
  currentMatch.value = null
}
function redo(): void {
  if (busy.value || !editable.value) return
  flushCell()
  draft.value = history.redo()
  canUndo.value = history.canUndo
  canRedo.value = history.canRedo
  currentMatch.value = null
}
function updateTrack(track: LyricTrack, event: Event): void {
  if (busy.value || !editable.value) return
  const content = (event.target as HTMLTextAreaElement).value
  apply({ ...draft.value, [track]: { ...draft.value[track], content } }, `typing:${track}`)
}
function updateFormat(track: LyricTrack, value: string | number | (string | number)[]): void {
  if (busy.value || !editable.value) return
  apply({ ...draft.value, [track]: { ...draft.value[track], format: value as LyricFormat } })
}
function updateCell(record: LyricEditorRecord, event: Event): void {
  if (busy.value || !editable.value) return
  const next = {
    ...draft.value,
    [record.track]: editLyricRecord(
      draft.value[record.track],
      record,
      (event.target as HTMLTextAreaElement).value
    )
  }
  const currentRowKey = activeEditor.value
  apply(next)
  if (currentRowKey?.startsWith('row:')) {
    const candidates = lyricEditorRows(next).filter((row) =>
      row.cells[record.track].some((cell) => cell.start === record.start)
    )
    const row = candidates.find((row) => `row:${row.key}` === currentRowKey) || candidates[0]
    if (row) activeEditor.value = `row:${row.key}`
  }
}
function addCell(track: LyricTrack, row: LyricEditorRow, event: Event): void {
  if (busy.value || !editable.value) return
  try {
    const text = (event.target as HTMLTextAreaElement).value
    if (
      row.timeMs == null &&
      (draft.value[track].format === 'plain' ||
        (!draft.value[track].content.trim() && draft.value.lyric.format === 'plain'))
    ) {
      apply({
        ...draft.value,
        [track]: fillPlainLyricLine({ ...draft.value[track], format: 'plain' }, row.ordinal, text)
      })
      return
    }
    apply({
      ...draft.value,
      [track]: appendLyricLine(
        draft.value[track],
        row.timeMs == null
          ? null
          : row.timeMs -
              (track === 'lyric'
                ? 0
                : Number(draft.value.lyric.content.match(/^\s*\[offset:([+-]?\d+)\]/im)?.[1] || 0)),
        (event.target as HTMLTextAreaElement).value
      )
    })
  } catch (cause) {
    error.value = String(cause)
  }
}
function currentRow(row: LyricEditorRow): LyricEditorRow | undefined {
  return (
    rows.value.find((current) => current.key === row.key) ||
    rows.value.find((current) =>
      lyricTracks.some((track) =>
        current.cells[track].some((record) =>
          row.cells[track].some((previous) => previous.start === record.start)
        )
      )
    )
  )
}
function insertAfter(row: LyricEditorRow | null): void {
  if (busy.value || !editable.value) return
  flushCell()
  const after = row ? currentRow(row) : null
  if (row && !after) return
  try {
    const result = insertLyricRow(draft.value, after ?? null, t('lyricEditor.newLine'))
    apply(result.draft)
    selection.value = null
    error.value = ''
    openRow(result.row)
  } catch (cause) {
    error.value =
      cause instanceof Error && cause.message === 'lyric-editor-no-gap'
        ? t('lyricEditor.noTimeGap')
        : String(cause)
  }
}
function removeRow(row: LyricEditorRow): void {
  if (busy.value || !editable.value) return
  flushCell()
  const current = currentRow(row)
  if (!current) return
  apply(deleteLyricRow(draft.value, current))
  activeEditor.value = null
  selection.value = null
}
function setOffset(value: string | number | null): void {
  if (busy.value || !editable.value) return
  const number = value === '' || value === null ? null : Number(value)
  if (number !== null && !Number.isFinite(number)) return
  apply(
    { ...draft.value, offsetMs: number === null ? null : normalizeLyricOffset(number) },
    'offset'
  )
  offsetInput.value = draft.value.offsetMs == null ? '' : String(draft.value.offsetMs)
}
function focusTrack(track: LyricTrack, event: Event): void {
  activeTrack.value = track
  rememberSelection(event)
}
function rememberSelection(event: Event | HTMLTextAreaElement): void {
  if (revealingMatch) return
  const textarea = event instanceof HTMLTextAreaElement ? event : event.target
  if (!(textarea instanceof HTMLTextAreaElement)) return
  const track = (textarea.dataset.lyricTrack || textarea.dataset.track) as LyricTrack
  if (!lyricTracks.includes(track)) return
  let offset = 0
  if (textarea.hasAttribute('data-lyric-cell')) {
    const record = lyricEditorRecords(track, draft.value[track]).find(
      (record) => record.key === textarea.dataset.lyricCell
    )
    if (!record) return
    offset = record.start
  }
  const next = {
    track,
    start: offset + textarea.selectionStart,
    end: offset + textarea.selectionEnd
  }
  selection.value = next
  currentMatch.value =
    matches.value.find(
      (match) => match.track === next.track && match.start === next.start && match.end === next.end
    ) ?? null
}
async function toggleSearch(): Promise<void> {
  const element = document.activeElement
  let text = ''
  if (element instanceof HTMLTextAreaElement && root.value?.contains(element)) {
    rememberSelection(element)
    text = element.value.slice(element.selectionStart, element.selectionEnd)
  }
  flushCell()
  if (!text && selection.value)
    text = draft.value[selection.value.track].content.slice(
      selection.value.start,
      selection.value.end
    )
  showSearch.value = !showSearch.value
  if (!showSearch.value) return
  if (text && !/[\r\n]/.test(text)) searchText.value = text
  await nextTick()
  if (searchText.value && selection.value) {
    const selected = matches.value.find(
      (match) =>
        match.track === selection.value?.track &&
        match.start === selection.value?.start &&
        match.end === selection.value?.end
    )
    if (selected) {
      currentMatch.value = selected
      await revealMatch(selected)
      return
    }
  }
  root.value?.querySelector<HTMLInputElement>('input[data-lyric-find]')?.focus()
}
function toggleOffset(): void {
  flushCell()
  showOffset.value = !showOffset.value
}
function scrollSelectionIntoView(textarea: HTMLTextAreaElement, start: number, end: number): void {
  // setSelectionRange selects text but does not reliably scroll a textarea's
  // internal viewport. Measure the same wrapped text to reveal long documents.
  const style = getComputedStyle(textarea)
  const mirror = document.createElement('div')
  mirror.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;left:-10000px;top:0;box-sizing:border-box;white-space:pre-wrap;overflow-wrap:break-word;'
  for (const property of [
    'font',
    'line-height',
    'letter-spacing',
    'word-spacing',
    'padding',
    'text-indent',
    'tab-size',
    'word-break'
  ])
    mirror.style.setProperty(property, style.getPropertyValue(property))
  mirror.style.width = `${textarea.clientWidth}px`
  mirror.append(document.createTextNode(textarea.value.slice(0, start)))
  const marker = document.createElement('span')
  marker.textContent = textarea.value.slice(start, end) || '\u200b'
  mirror.append(marker, document.createTextNode(textarea.value.slice(end)))
  document.body.append(mirror)
  const top = marker.offsetTop
  const bottom = top + marker.offsetHeight
  if (top < textarea.scrollTop || bottom > textarea.scrollTop + textarea.clientHeight)
    textarea.scrollTop = Math.max(0, top - (textarea.clientHeight - marker.offsetHeight) / 2)
  mirror.remove()
}
async function revealMatch(match: LyricEditorMatch): Promise<void> {
  const token = session
  if (layout.value === 'merged') {
    const record = lyricEditorRecords(match.track, draft.value[match.track]).find(
      (record) => record.start <= match.start && record.end >= match.end
    )
    const row = record
      ? rows.value.find((row) => row.cells[match.track].some((cell) => cell.key === record.key))
      : undefined
    if (record && row) {
      activeEditor.value = editorKey(row, record)
      if (row.metadata) metadataOpen.value = true
    }
  }
  await nextTick()
  if (token !== session || !props.modelValue) return
  let textarea: HTMLTextAreaElement | undefined
  let start = match.start
  if (layout.value === 'separate') {
    textarea =
      root.value?.querySelector<HTMLTextAreaElement>(`[data-lyric-track="${match.track}"]`) ??
      undefined
  } else {
    const record = lyricEditorRecords(match.track, draft.value[match.track]).find(
      (record) => record.start <= match.start && record.end >= match.end
    )
    if (record) {
      textarea = [
        ...(root.value?.querySelectorAll<HTMLTextAreaElement>('[data-lyric-cell]') ?? [])
      ].find((element) => element.dataset.lyricCell === record.key)
      start -= record.start
    }
  }
  if (!textarea) return
  revealingMatch = true
  textarea.focus({ preventScroll: true })
  textarea.setSelectionRange(start, start + match.end - match.start)
  textarea.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  scrollSelectionIntoView(textarea, start, start + match.end - match.start)
  selection.value = { ...match }
  revealingMatch = false
}
function navigateMatch(direction: 1 | -1): void {
  flushCell()
  if (!matches.value.length) return
  const index = currentMatchIndex.value
  let next =
    index < 0
      ? direction === 1
        ? 0
        : matches.value.length - 1
      : (index + direction + matches.value.length) % matches.value.length
  if (index < 0 && selection.value) {
    const anchor = selection.value
    const trackIndex = lyricTracks.indexOf(anchor.track)
    const ordered = matches.value.map((match, index) => ({ match, index }))
    const candidate =
      direction === 1
        ? ordered.find(
            ({ match }) =>
              lyricTracks.indexOf(match.track) > trackIndex ||
              (match.track === anchor.track && match.start >= anchor.end)
          )
        : ordered
            .reverse()
            .find(
              ({ match }) =>
                lyricTracks.indexOf(match.track) < trackIndex ||
                (match.track === anchor.track && match.end <= anchor.start)
            )
    if (candidate) next = candidate.index
  }
  currentMatch.value = matches.value[next]
  void revealMatch(currentMatch.value)
}
function findNext(): void {
  navigateMatch(1)
}
function replaceCurrent(): void {
  if (busy.value || !editable.value) return
  flushCell()
  const match = currentMatch.value
  if (!match) {
    findNext()
    return
  }
  apply(replaceLyricMatches(draft.value, [match], replacement.value))
  selection.value = {
    track: match.track,
    start: match.start,
    end: match.start + replacement.value.length
  }
  navigateMatch(1)
}
function replaceAll(): void {
  if (busy.value || !editable.value) return
  flushCell()
  apply(replaceLyricMatches(draft.value, matches.value, replacement.value))
}
function switchLayout(value: 'separate' | 'merged'): void {
  flushCell()
  activeEditor.value = null
  layout.value = value
  if (currentMatch.value) void revealMatch(currentMatch.value)
}
function switchEditable(value: boolean): void {
  flushCell()
  activeEditor.value = null
  editable.value = value
}
function close(): void {
  discardOpen.value = false
  emit('update:modelValue', false)
}
function requestClose(): void {
  if (saving.value) return
  flushCell()
  if (dirty.value) discardOpen.value = true
  else close()
}
async function load(): Promise<void> {
  const token = ++session
  showSearch.value = false
  showOffset.value = false
  activeEditor.value = null
  metadataOpen.value = false
  selection.value = null
  ready.value = false
  loading.value = false
  saving.value = false
  error.value = ''
  discardOpen.value = false
  target.value = null
  draft.value = emptyLyricDraft()
  original.value = emptyLyricDraft()
  history = new LyricEditorHistory(draft.value)
  pendingCells.value = {}
  offsetInput.value = ''
  canUndo.value = false
  canRedo.value = false
  currentMatch.value = null
  if (!props.modelValue || props.songId == null) return
  const id = props.songId
  loading.value = true
  try {
    const response = await window.api.database.command('getSong', { id })
    if (token !== session) return
    if (!response.success) throw new Error(response.error)
    const data = response.data as {
      title: string
      artist: string | null
      lrc?: string
      lyricFormat?: string
      translation?: string
      translationFormat?: string
      romanization?: string
      romanizationFormat?: string
      offsetMs?: number | null
    } | null
    if (!data) throw new Error(t('lyricEditor.songMissing'))
    target.value = { id, title: data.title, artist: data.artist }
    const next: LyricEditorDraft = {
      lyric: editorTrack(data.lrc, data.lyricFormat),
      translation: editorTrack(data.translation, data.translationFormat),
      romanization: editorTrack(data.romanization, data.romanizationFormat),
      offsetMs: data.offsetMs ?? null
    }
    history = new LyricEditorHistory(next)
    draft.value = history.current
    original.value = history.current
    ready.value = true
  } catch (cause) {
    if (token === session) error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (token === session) loading.value = false
  }
}
watch(
  () => [props.modelValue, props.songId],
  () => void load(),
  { immediate: true, flush: 'sync' }
)
onBeforeUnmount(() => {
  session++
})
async function save(): Promise<void> {
  flushCell()
  if (busy.value || !target.value) return
  const song = target.value
  const token = session
  const value = draft.value
  saving.value = true
  error.value = ''
  try {
    const response = await window.api.database.command('updateSongLyrics', {
      id: song.id,
      lrc: value.lyric.content,
      lyricFormat: value.lyric.format,
      translation: value.translation.content,
      translationFormat: value.translation.format,
      romanization: value.romanization.content,
      romanizationFormat: value.romanization.format,
      offsetMs: value.offsetMs
    })
    if (!response.success || response.data === false)
      throw new Error(response.success ? t('lyricEditor.songMissing') : response.error)
    eventBus.emit('lyricsUpdated', song.id)
    eventBus.emit('songLyricSettingsChanged', song.id)
    emit('saved', song.id)
    if (token === session) close()
  } catch (cause) {
    if (token === session) error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (token === session) saving.value = false
  }
}
function keyboard(event: KeyboardEvent): void {
  if (event.isComposing || !(event.ctrlKey || event.metaKey)) return
  const key = event.key.toLowerCase()
  if (!['z', 'y', 's', 'f', 'h'].includes(key)) return
  if (key === 'f' || key === 'h') {
    event.preventDefault()
    event.stopPropagation()
    if (!showSearch.value) void toggleSearch()
    else root.value?.querySelector<HTMLInputElement>('input[data-lyric-find]')?.focus()
    return
  }
  // Search inputs retain their own native text undo history.
  if (key !== 's' && event.target instanceof HTMLInputElement && event.target.type !== 'number')
    return
  event.preventDefault()
  event.stopPropagation()
  if (key === 's') void save()
  else if (key === 'y' || event.shiftKey) redo()
  else undo()
}
</script>

<template>
  <BaseDialog
    :model-value="modelValue"
    :title="t('lyricEditor.title')"
    width="max-w-6xl"
    :close-on-overlay="false"
    :close-on-esc="!saving"
    :show-close="!saving"
    @update:model-value="!$event && requestClose()"
  >
    <div
      ref="root"
      class="flex h-[min(72vh,50rem)] min-h-0 flex-col gap-3"
      data-lyrics-editor
      @keydown="keyboard"
    >
      <!-- header -->
      <div class="flex flex-wrap items-center gap-2" data-lyric-editor-toolbar>
        <div
          class="flex gap-1 rounded-lg border border-border p-1"
          :aria-label="t('lyricEditor.layout')"
        >
          <BaseButton
            v-for="value in ['separate', 'merged'] as const"
            :key="value"
            class="editor-mode"
            size="xs"
            :variant="layout === value ? 'secondary' : 'ghost'"
            :aria-pressed="layout === value"
            @click="switchLayout(value)"
          >
            <template #left>
              <SvgIcon
                :name="value === 'separate' ? 'common-layout' : 'common-lyrics2'"
                class-name="size-3.5 shrink-0"
              />
            </template>
            {{ t(`lyricEditor.${value}`) }}
          </BaseButton>
        </div>
        <BaseButton
          size="sm"
          variant="ghost"
          :aria-pressed="!editable"
          @click="switchEditable(!editable)"
        >
          <template #left>
            <SvgIcon
              :name="editable ? 'menu-display' : 'common-edit'"
              class-name="size-3.5 shrink-0"
            />
          </template>
          {{ t(editable ? 'lyricEditor.view' : 'lyricEditor.edit') }}
        </BaseButton>
        <BaseButton
          size="sm"
          variant="ghost"
          class="editor-mode"
          :aria-pressed="showSearch"
          :aria-expanded="showSearch"
          aria-controls="lyric-editor-search-panel"
          @click="toggleSearch"
        >
          <template #left>
            <SvgIcon name="common-search" class-name="size-3.5 shrink-0" />
          </template>
          {{ t('lyricEditor.findReplace') }}
        </BaseButton>
        <BaseButton
          size="sm"
          variant="ghost"
          class="editor-mode"
          :aria-pressed="showOffset"
          :aria-expanded="showOffset"
          aria-controls="lyric-editor-offset-panel"
          @click="toggleOffset"
        >
          <template #left>
            <SvgIcon name="common-time" class-name="size-3.5 shrink-0" />
          </template>
          {{ t('lyricEditor.adjustOffset') }}
        </BaseButton>
        <div class="ml-auto flex gap-1">
          <BaseButton
            size="sm"
            variant="secondary"
            :disabled="busy || !editable || (!canUndo && !hasPending)"
            @click="undo"
          >
            <template #left>
              <SvgIcon name="common-back-left" class-name="size-3.5 shrink-0" />
            </template>
            {{ t('lyricEditor.undo') }}
          </BaseButton>
          <BaseButton
            size="sm"
            variant="secondary"
            :disabled="busy || !editable || !canRedo"
            @click="redo"
          >
            <template #left>
              <SvgIcon
                name="common-back-left"
                class-name="size-3.5 shrink-0"
                style="transform: scaleX(-1)"
              />
            </template>
            {{ t('lyricEditor.redo') }}
          </BaseButton>
        </div>
      </div>
      <!-- search && replace -->
      <div
        v-if="showSearch"
        id="lyric-editor-search-panel"
        class="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2"
        data-lyric-search-tools
      >
        <BaseInput
          v-model="searchText"
          data-lyric-find
          class="min-w-28 flex-1"
          size="sm"
          :placeholder="t('lyricEditor.find')"
          :aria-label="t('lyricEditor.find')"
          :disabled="busy"
          @keydown.enter.prevent="navigateMatch($event.shiftKey ? -1 : 1)"
          @keydown.esc.stop.prevent="showSearch = false"
        />
        <BaseInput
          v-model="replacement"
          class="min-w-28 flex-1"
          size="sm"
          :placeholder="t('lyricEditor.replacement')"
          :aria-label="t('lyricEditor.replacement')"
          :disabled="busy || !editable"
        />
        <BaseSelect
          v-model="searchScope"
          :options="scopeOptions"
          size="sm"
          class="w-32"
          :aria-label="t('lyricEditor.scope')"
        />
        <label class="flex items-center gap-1 text-xs">
          <input v-model="caseSensitive" type="checkbox" />
          {{ t('lyricEditor.caseSensitive') }}
        </label>
        <span class="text-xs text-text-l" role="status" data-lyric-match-status>
          {{
            t('lyricEditor.matchPosition', {
              current: currentMatchIndex + 1,
              total: matches.length
            })
          }}
          <span v-if="matchLocation"> · {{ matchLocation }}</span>
        </span>
        <BaseButton
          variant="secondary"
          size="sm"
          :disabled="busy || !matches.length"
          @click="navigateMatch(-1)"
        >
          <template #left>
            <SvgIcon name="arrow-arrow-up" class-name="size-3.5 shrink-0" />
          </template>
          {{ t('lyricEditor.findPrevious') }}
        </BaseButton>
        <BaseButton
          variant="secondary"
          size="sm"
          :disabled="busy || !matches.length"
          @click="findNext"
        >
          <template #left>
            <SvgIcon name="arrow-arrow-down" class-name="size-3.5 shrink-0" />
          </template>
          {{ t('lyricEditor.findNext') }}
        </BaseButton>
        <BaseButton
          variant="secondary"
          size="sm"
          :disabled="busy || !editable || !matches.length"
          @click="replaceCurrent"
        >
          <template #left>
            <SvgIcon name="arrow-arrow-left-right" class-name="size-3.5 shrink-0" />
          </template>
          {{ t('lyricEditor.replace') }}
        </BaseButton>
        <BaseButton
          variant="secondary"
          size="sm"
          :disabled="busy || !editable || !matches.length"
          @click="replaceAll"
        >
          <template #left>
            <SvgIcon name="common-update" class-name="size-3.5 shrink-0" />
          </template>
          {{ t('lyricEditor.replaceAll') }}
        </BaseButton>
      </div>
      <!-- offset -->
      <div
        v-if="showOffset"
        id="lyric-editor-offset-panel"
        class="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2"
        data-lyric-offset-tools
      >
        <label for="song-lyric-editor-offset" class="text-xs">{{ t('lyricEditor.offset') }}</label>
        <BaseButton
          size="xs"
          variant="secondary"
          :disabled="busy || !editable"
          @click="setOffset((draft.offsetMs ?? 0) - 100)"
          >−100</BaseButton
        >
        <BaseInput
          id="song-lyric-editor-offset"
          v-model="offsetInput"
          class="w-24"
          style="width: 6rem"
          type="number"
          min="-5000"
          max="5000"
          step="100"
          size="sm"
          :clearable="false"
          :disabled="busy || !editable"
          :placeholder="t('lyricEditor.unset')"
          @change="setOffset(offsetInput)"
        />
        <span class="text-xs text-text-l">ms</span>
        <BaseButton
          size="xs"
          variant="secondary"
          :disabled="busy || !editable"
          @click="setOffset((draft.offsetMs ?? 0) + 100)"
          >+100</BaseButton
        >
        <BaseButton
          size="xs"
          variant="ghost"
          :disabled="busy || !editable || draft.offsetMs === null"
          @click="setOffset(null)"
        >
          <template #left>
            <SvgIcon name="common-refresh" class-name="size-3.5 shrink-0" />
          </template>
          {{ t('lyricEditor.clearOffset') }}
        </BaseButton>
        <span class="text-xs text-text-l">{{ t('lyricEditor.offsetHint') }}</span>
      </div>
      <!-- tooltip -->
      <!-- lyrics -->
      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
      <p v-if="loading" class="text-sm text-text-l" role="status">{{ t('lyricEditor.loading') }}</p>
      <div v-if="layout === 'separate'" class="grid min-h-0 flex-1 gap-3 md:grid-cols-3">
        <div v-for="track in lyricTracks" :key="track" class="flex min-h-0 min-w-0 flex-col gap-2">
          <span class="flex items-center justify-between gap-2 text-sm font-medium">
            {{ t(`lyricEditor.${track}`) }}
            <BaseSelect
              :model-value="draft[track].format"
              :options="formatOptions"
              size="xs"
              class="w-24"
              :disabled="busy || !editable"
              :aria-label="t('lyricEditor.trackFormat', { track: t(`lyricEditor.${track}`) })"
              @update:model-value="updateFormat(track, $event)"
            />
          </span>
          <textarea
            :value="draft[track].content"
            :data-lyric-track="track"
            class="editor-textarea custom-scrollbar min-h-20 flex-1"
            :aria-label="t(`lyricEditor.${track}`)"
            :placeholder="t('lyricEditor.emptyTrack')"
            :readonly="busy || !editable"
            spellcheck="false"
            @focus="focusTrack(track, $event)"
            @select="rememberSelection"
            @keyup="rememberSelection"
            @click="rememberSelection"
            @input="updateTrack(track, $event)"
          />
        </div>
      </div>
      <div v-else class="flex min-h-0 flex-1 flex-col gap-2">
        <div class="flex items-center justify-between gap-2">
          <p class="text-xs text-text-l">{{ t('lyricEditor.timelineHint') }}</p>
        </div>
        <div class="custom-scrollbar min-h-0 flex-1 overflow-auto rounded-lg" data-lyric-timeline>
          <div class="lyric-reading-content">
            <template v-for="row in rows" :key="row.key">
              <details
                v-if="row.metadata"
                :open="metadataOpen"
                class="mb-4 rounded-lg border border-border p-3 text-xs text-text-l"
                @toggle="metadataOpen = ($event.target as HTMLDetailsElement).open"
              >
                <summary class="cursor-pointer">{{ t('lyricEditor.metadata') }}</summary>
                <div v-for="track in lyricTracks" :key="track" class="space-y-2">
                  <div v-for="record in row.cells[track]" :key="record.key" class="mt-3">
                    <button
                      v-if="activeEditor !== editorKey(row, record)"
                      type="button"
                      class="w-full break-all text-left"
                      :data-lyric-display="record.key"
                      :aria-label="t('lyricEditor.editTrack', { track: t(`lyricEditor.${track}`) })"
                      @click="openRecord(row, record)"
                    >
                      {{ t(`lyricEditor.${track}`) }} · {{ record.raw }}
                    </button>
                    <template v-else>
                      <textarea
                        :value="pendingCells[record.key] ?? record.raw"
                        :data-lyric-cell="record.key"
                        :data-track="track"
                        class="editor-textarea custom-scrollbar"
                        :rows="Math.min(6, record.raw.split('\n').length + 1)"
                        :aria-label="t(`lyricEditor.${track}`)"
                        :readonly="busy || !editable"
                        spellcheck="false"
                        @focus="focusTrack(track, $event)"
                        @select="rememberSelection"
                        @keyup="rememberSelection"
                        @click="rememberSelection"
                        @input="stageCell(record.key, $event)"
                        @change="updateCell(record, $event)"
                      />
                      <div class="flex justify-end">
                        <BaseButton size="xs" variant="ghost" @click="finishRecord">
                          {{ t('lyricEditor.done') }}
                        </BaseButton>
                      </div>
                    </template>
                  </div>
                </div>
              </details>
              <article
                v-else
                class="lyric-reading-group"
                :class="{ 'lyric-reading-group--editing': activeEditor === `row:${row.key}` }"
                :data-timeline-time="row.timeMs"
              >
                <span class="lyric-reading-time" data-lyric-row-time>{{
                  row.timeMs == null
                    ? t('lyricEditor.untimed')
                    : lyricTimeLabel(row.timeMs - (draft.offsetMs ?? 0))
                }}</span>
                <div class="min-w-0">
                  <div
                    v-for="track in ['lyric', 'romanization', 'translation'] as const"
                    :key="track"
                    class="lyric-reading-track"
                    :class="`lyric-reading-track--${track}`"
                  >
                    <template v-if="activeEditor !== `row:${row.key}`">
                      <template v-for="record in row.cells[track]" :key="record.key">
                        <button
                          v-if="editable"
                          type="button"
                          class="lyric-reading-text"
                          :data-lyric-display="record.key"
                          :data-track="track"
                          :aria-label="t('lyricEditor.editSentence')"
                          @click="openRecord(row, record)"
                        >
                          {{ record.text }}
                        </button>
                        <p v-else class="lyric-reading-text" :data-lyric-display="record.key">
                          {{ record.text }}
                        </p>
                      </template>
                    </template>
                    <div v-else class="mb-3">
                      <span class="mb-1 block text-xs font-normal text-text-l">
                        {{ t(`lyricEditor.${track}`) }}
                      </span>
                      <textarea
                        v-for="record in row.cells[track]"
                        :key="record.key"
                        :value="pendingCells[record.key] ?? record.raw"
                        :data-lyric-cell="record.key"
                        :data-track="track"
                        class="editor-textarea custom-scrollbar mb-1"
                        :rows="Math.min(6, record.raw.split('\n').length + 1)"
                        :aria-label="t(`lyricEditor.${track}`)"
                        :readonly="busy || !editable"
                        spellcheck="false"
                        @focus="focusTrack(track, $event)"
                        @select="rememberSelection"
                        @keyup="rememberSelection"
                        @click="rememberSelection"
                        @input="stageCell(record.key, $event)"
                        @change="updateCell(record, $event)"
                      />
                      <textarea
                        v-if="!row.cells[track].length"
                        :key="`new:${row.key}:${track}`"
                        :value="pendingCells[`new:${row.key}:${track}`] ?? ''"
                        :data-lyric-cell="`new:${row.key}:${track}`"
                        :data-track="track"
                        class="editor-textarea"
                        rows="2"
                        :aria-label="t(`lyricEditor.${track}`)"
                        :placeholder="t('lyricEditor.addCell')"
                        :readonly="busy || !editable"
                        @focus="focusTrack(track, $event)"
                        @select="rememberSelection"
                        @keyup="rememberSelection"
                        @click="rememberSelection"
                        @input="stageCell(`new:${row.key}:${track}`, $event)"
                        @change="addCell(track, row, $event)"
                      />
                    </div>
                  </div>
                </div>
                <div class="lyric-reading-actions" data-lyric-row-actions>
                  <BaseButton
                    v-if="activeEditor === `row:${row.key}`"
                    class="lyric-row-action"
                    size="xs"
                    variant="secondary"
                    :disabled="busy"
                    @click="finishRecord"
                  >
                    <template #left>
                      <SvgIcon name="common-check" class-name="size-3.5 shrink-0" />
                    </template>
                    {{ t('lyricEditor.done') }}
                  </BaseButton>
                  <BaseButton
                    v-else-if="editable"
                    class="lyric-row-action"
                    size="xs"
                    variant="ghost"
                    :disabled="busy"
                    @click="openRow(row)"
                  >
                    <template #left>
                      <SvgIcon name="common-edit" class-name="size-3.5 shrink-0" />
                    </template>
                    {{ t('lyricEditor.editRow') }}
                  </BaseButton>
                  <BaseButton
                    v-if="editable"
                    class="lyric-row-action"
                    size="xs"
                    variant="ghost"
                    :disabled="busy"
                    :aria-label="t('lyricEditor.insertAfter')"
                    :title="t('lyricEditor.insertAfter')"
                    @click="insertAfter(row)"
                  >
                    <template #left>
                      <SvgIcon name="common-plus" class-name="size-3.5 shrink-0" />
                    </template>
                    {{ t('lyricEditor.insertBelow') }}
                  </BaseButton>
                  <BaseButton
                    v-if="editable"
                    class="lyric-row-action text-danger"
                    size="xs"
                    variant="ghost"
                    :disabled="busy"
                    :aria-label="t('lyricEditor.deleteRow')"
                    :title="t('lyricEditor.deleteRow')"
                    @click="removeRow(row)"
                  >
                    <template #left>
                      <SvgIcon name="common-delete" class-name="size-3.5 shrink-0" />
                    </template>
                    {{ t('lyricEditor.deleteRow') }}
                  </BaseButton>
                </div>
              </article>
            </template>
          </div>
          <div
            v-if="!rows.some((row) => !row.metadata)"
            class="space-y-3 p-10 text-center text-sm text-text-l"
          >
            <p>{{ t('lyricEditor.emptyTimeline') }}</p>
            <BaseButton
              v-if="editable"
              size="sm"
              variant="secondary"
              :disabled="busy"
              @click="insertAfter(null)"
            >
              <template #left>
                <SvgIcon name="common-plus" class-name="size-3.5 shrink-0" />
              </template>
              {{ t('lyricEditor.insertFirst') }}
            </BaseButton>
          </div>
        </div>
      </div>
    </div>
    <template #footer>
      <p
        class="mr-auto min-w-0 flex-1 truncate text-xs text-text-l"
        :title="[target?.title, target?.artist].filter(Boolean).join(' — ')"
      >
        {{ target?.title }}
        <template v-if="target?.artist"> — {{ target.artist }}</template>
        <span v-if="dirty"> · {{ t('lyricEditor.unsaved') }}</span>
      </p>
      <BaseButton variant="secondary" :disabled="saving" @click="requestClose">
        {{ t('common.cancel') }}
      </BaseButton>
      <BaseButton :loading="saving" :disabled="busy || !dirty" @click="save">
        {{ t('common.save') }}
      </BaseButton>
    </template>
  </BaseDialog>
  <BaseConfirmDialog
    v-model="discardOpen"
    :title="t('lyricEditor.discardTitle')"
    :message="t('lyricEditor.discardMessage')"
    :confirm-text="t('lyricEditor.discard')"
    variant="danger"
    @confirm="close"
  />
</template>

<style scoped>
.editor-textarea {
  display: block;
  width: 100%;
  resize: vertical;
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
  background: var(--color-bg);
  padding: 0.65rem;
  color: var(--color-text);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 0.75rem;
  line-height: 1.65;
  outline: none;
  tab-size: 2;
}
.editor-textarea:focus {
  border-color: var(--color-primary);
}
.editor-textarea[readonly] {
  cursor: text;
}
.editor-mode[aria-pressed='true'] {
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 8%, transparent);
}
.lyric-reading-content {
  width: 100%;
  padding: 0.75rem 0;
}
.lyric-reading-group {
  display: grid;
  grid-template-columns: 6rem minmax(0, 1fr) 7.5rem;
  align-items: start;
  column-gap: 1rem;
  padding: 1rem;
  border-radius: 0.75rem;
  content-visibility: auto;
  contain-intrinsic-size: auto 8rem;
}
.lyric-reading-group:hover,
.lyric-reading-group:focus-within,
.lyric-reading-group--editing {
  background: color-mix(in srgb, var(--color-text) 2%, transparent);
}
.lyric-reading-track + .lyric-reading-track {
  margin-top: 0.3rem;
}
.lyric-reading-track:empty {
  display: none;
}
.lyric-reading-text {
  display: block;
  width: 100%;
  border: 0;
  padding: 0;
  background: transparent;
  text-align: left;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.65;
  cursor: text;
}
button.lyric-reading-text {
  cursor: pointer;
}
.lyric-reading-track--lyric .lyric-reading-text {
  color: var(--color-text);
  font-size: 1.25rem;
  font-weight: 600;
}
.lyric-reading-track--translation .lyric-reading-text {
  color: var(--color-text-l);
  font-size: 0.9rem;
}
.lyric-reading-track--romanization .lyric-reading-text {
  color: var(--color-text-l);
  font-size: 0.8rem;
  opacity: 0.8;
}
.lyric-reading-time {
  padding-top: 0.4rem;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--color-text-l);
}
.lyric-reading-actions {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.25rem;
}
.lyric-row-action {
  width: 100%;
  justify-content: flex-start;
  white-space: nowrap;
}
@media (max-width: 640px) {
  .lyric-reading-group {
    grid-template-columns: 5.25rem minmax(0, 1fr) 7rem;
    column-gap: 0.5rem;
    padding-inline: 0.5rem;
  }
}
[data-lyric-timeline] {
  scroll-padding-block: 1rem;
}
</style>
