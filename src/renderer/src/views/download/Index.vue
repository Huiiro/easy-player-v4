<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { useMessage } from '@/components/ui/useMessage'

type Platform = 'youtube' | 'bili'
type DownloadStatus = 'idle' | 'downloading' | 'done' | 'error'
type DownloadType = 'audio' | 'video'
type DownloadQuality = 'best' | 'high' | 'standard' | 'compact'
interface ResultItem {
  platform: Platform
  id: string
  title: string
  url: string
  thumbnail: string | null
  thumbnailUrl?: string | null
  duration: number | null
  uploader: string | null
  status: DownloadStatus
  progress: number
}
interface DownloadHistoryItem {
  id: number
  platform: Platform
  resourceId: string
  title: string | null
  filePath: string | null
  quality: string | null
  status: DownloadStatus
  progress: number
  createdAt: string
}

const { t, locale } = useI18n()
const { success, error } = useMessage()
const platform = ref<Platform>('youtube')
const query = ref('')
const directory = ref('')
const downloadType = ref<DownloadType>('audio')
const quality = ref<DownloadQuality>('best')
const loading = ref(false)
const results = ref<ResultItem[]>([])
const selectedIds = ref<string[]>([])
const taskToId = new Map<string, string>()
const history = ref<DownloadHistoryItem[]>([])
const thumbnailCache = ref<Record<string, string>>({})
const loadingThumbnailIds = new Set<string>()

const selectedResults = computed(() =>
  results.value.filter((item) => selectedIds.value.includes(item.id))
)
const isDirectUrl = computed(() => /^https?:\/\//i.test(query.value.trim()))
const allSelected = computed(
  () => results.value.length > 0 && selectedIds.value.length === results.value.length
)
const downloadTypeOptions = computed(() => [
  { label: t('download.audio'), value: 'audio' },
  { label: t('download.video'), value: 'video' }
])
const qualityOptions = computed(() =>
  downloadType.value === 'audio'
    ? [
        { label: t('download.bestAudio'), value: 'best' },
        { label: t('download.highAudio'), value: 'high' },
        { label: t('download.standardAudio'), value: 'standard' },
        { label: t('download.compactAudio'), value: 'compact' }
      ]
    : [
        { label: t('download.bestVideo'), value: 'best' },
        { label: t('download.highVideo'), value: 'high' },
        { label: t('download.standardVideo'), value: 'standard' },
        { label: t('download.compactVideo'), value: 'compact' }
      ]
)

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—'
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}
async function chooseDirectory(): Promise<void> {
  const selected = await window.api.downloads.chooseDirectory()
  if (selected) {
    directory.value = selected
    await window.api.database.command('setSetting', { key: 'download.directory', value: selected })
  }
}
async function loadDownloadDirectory(): Promise<void> {
  const result = await window.api.database.command('getSetting', { key: 'download.directory' })
  if (result.success && typeof result.data === 'string') directory.value = result.data
}
async function loadHistory(): Promise<void> {
  try {
    history.value = await window.api.downloads.history()
  } catch {
    error(t('download.historyFailed'))
  }
}
async function showInFolder(filePath: string | null): Promise<void> {
  if (!filePath) return error(t('download.noFile'))
  const result = await window.api.downloads.showInFolder(filePath)
  if (!result.success) error(result.error || t('download.openFailed'))
}
async function loadResults(): Promise<void> {
  const value = query.value.trim()
  if (!value) return error(t('download.inputRequired'))
  loading.value = true
  try {
    const items = isDirectUrl.value
      ? await window.api.downloads.parse(value)
      : await window.api.downloads.search(platform.value, value)
    results.value = items.map((item) => ({ ...item, status: 'idle', progress: 0 }))
    thumbnailCache.value = {}
    selectedIds.value = results.value
      .filter((item) => item.selected !== false)
      .map((item) => item.id)
    if (!results.value.length) error(t('download.noResults'))
  } catch (reason) {
    error(reason instanceof Error ? reason.message : t('download.parseFailed'))
  } finally {
    loading.value = false
  }
}
function thumbnailFor(item: ResultItem): string | null {
  return thumbnailCache.value[item.id] || item.thumbnail
}
async function loadThumbnail(id: string): Promise<void> {
  const item = results.value.find((result) => result.id === id)
  if (!item?.thumbnailUrl || thumbnailCache.value[id] || loadingThumbnailIds.has(id)) return
  loadingThumbnailIds.add(id)
  try {
    const thumbnail = await window.api.downloads.thumbnail(item.thumbnailUrl)
    thumbnailCache.value = { ...thumbnailCache.value, [id]: thumbnail }
  } catch {
    // A failed thumbnail must not block parsing or downloading the media item.
  } finally {
    loadingThumbnailIds.delete(id)
  }
}
const thumbnailObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return
      const id = (entry.target as HTMLElement).dataset.thumbnailId
      if (id) void loadThumbnail(id)
      thumbnailObserver.unobserve(entry.target)
    })
  },
  { rootMargin: '160px 0px' }
)
function observeThumbnail(element: unknown, item: ResultItem): void {
  if (!(element instanceof Element) || !item.thumbnailUrl || thumbnailFor(item)) return
  ;(element as HTMLElement).dataset.thumbnailId = item.id
  thumbnailObserver.observe(element)
}
function toggleAll(): void {
  selectedIds.value = allSelected.value ? [] : results.value.map((item) => item.id)
}
async function download(item: ResultItem, notifyMissingDirectory = true): Promise<boolean> {
  if (!directory.value) {
    if (notifyMissingDirectory) error(t('download.chooseDirectoryFirst'))
    return false
  }
  if (item.status === 'downloading' || item.status === 'done') return false
  try {
    item.status = 'downloading'
    item.progress = 0
    const task = await window.api.downloads.start({
      platform: item.platform,
      url: item.url,
      title: item.title,
      resourceId: item.id,
      directory: directory.value,
      downloadType: downloadType.value,
      quality: quality.value,
      locale: locale.value
    })
    taskToId.set(task.taskId, item.id)
    return true
  } catch (reason) {
    item.status = 'error'
    error(reason instanceof Error ? reason.message : t('download.startFailed'))
    return false
  }
}
async function downloadSelected(): Promise<void> {
  if (!directory.value) return error(t('download.chooseDirectoryFirst'))
  if (!selectedResults.value.length) return error(t('download.selectAtLeastOne'))
  let started = 0
  for (const item of selectedResults.value) if (await download(item, false)) started += 1
  if (started) success(t('download.queued', { count: started }))
}
const removeProgress = window.api.downloads.onProgress((progress) => {
  const id = taskToId.get(progress.taskId)
  const item = results.value.find((result) => result.id === id)
  if (!item) return
  item.status = progress.status
  item.progress = progress.progress
  if (progress.status !== 'downloading') {
    taskToId.delete(progress.taskId)
    void loadHistory()
    if (progress.status === 'done') success(t('download.completed', { title: item.title }))
    if (progress.status === 'error')
      error(progress.error || t('download.downloadFailed', { title: item.title }))
  }
})
onMounted(() => {
  void loadHistory()
  void loadDownloadDirectory()
})
onBeforeUnmount(() => {
  removeProgress()
  thumbnailObserver.disconnect()
})
</script>

<template>
  <main class="custom-scrollbar h-full overflow-y-auto px-7 py-6 text-text">
    <section class="mb-6">
      <p class="text-sm text-text-l">{{ t('download.eyebrow') }}</p>
      <h1 class="mt-1 text-3xl font-semibold tracking-tight">{{ t('download.title') }}</h1>
      <p class="mt-2 text-sm text-text-l">
        {{ t('download.description') }}
      </p>
    </section>

    <section class="download-surface relative z-20 mb-5 p-5">
      <div class="mb-4 flex flex-wrap gap-2">
        <button
          v-for="source in [
            { id: 'bili', label: t('download.sourceBili') },
            { id: 'youtube', label: t('download.sourceYoutube') }
          ] as const"
          :key="source.id"
          class="source-button"
          :class="platform === source.id && 'selected'"
          type="button"
          @click="platform = source.id"
        >
          {{ source.label }}
        </button>
      </div>
      <div class="flex gap-2">
        <input
          v-model="query"
          class="input-base min-w-0 flex-1"
          :placeholder="
            platform === 'youtube' ? t('download.searchYoutube') : t('download.searchBili')
          "
          @keyup.enter="loadResults"
        />
        <button class="primary-button" type="button" :disabled="loading" @click="loadResults">
          <SvgIcon name="common-search" class-name="size-4" />
          {{
            loading
              ? t('download.loading')
              : isDirectUrl
                ? t('download.parse')
                : t('download.search')
          }}
        </button>
      </div>
      <div class="relative z-20 mt-3 flex flex-wrap gap-2">
        <BaseSelect
          v-model="downloadType"
          :options="downloadTypeOptions"
          class="selection-control w-1/3"
        />
        <BaseSelect v-model="quality" :options="qualityOptions" class="selection-control w-1/3" />
      </div>
      <div class="mt-4 flex items-center gap-3 text-sm">
        <span class="min-w-0 flex-1 truncate text-text-l">{{
          directory || t('download.noDirectory')
        }}</span>
        <button class="secondary-button" type="button" @click="chooseDirectory">
          {{ t('download.chooseDirectory') }}
        </button>
      </div>
    </section>

    <section v-if="results.length" class="download-surface relative z-0 p-5">
      <div class="mb-4 flex items-center justify-between gap-3">
        <label class="flex cursor-pointer items-center gap-2 text-sm text-text-l">
          <input
            :checked="allSelected"
            class="accent-primary"
            type="checkbox"
            @change="toggleAll"
          />
          {{ t('download.selectAll', { selected: selectedIds.length, total: results.length }) }}
        </label>
        <button class="primary-button" type="button" @click="downloadSelected">
          {{ t('download.downloadSelected') }}
        </button>
      </div>
      <div class="result-list custom-scrollbar space-y-2 overflow-y-auto">
        <article v-for="item in results" :key="item.id" class="download-result">
          <input v-model="selectedIds" :value="item.id" class="accent-primary" type="checkbox" />
          <span
            :ref="(element) => observeThumbnail(element, item)"
            class="grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-primary/12 text-primary"
          >
            <img
              v-if="thumbnailFor(item)"
              :src="thumbnailFor(item) || undefined"
              class="size-full object-cover"
              :alt="item.title"
            />
            <SvgIcon v-else name="common-music" class-name="size-5" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{{ item.title }}</p>
            <p class="mt-1 text-xs text-text-l">
              {{ item.uploader || t('download.unknownAuthor') }} ·
              {{ formatDuration(item.duration) }}
            </p>
            <div v-if="item.status === 'downloading'" class="download-progress">
              <i :style="{ width: `${item.progress}%` }" />
            </div>
          </div>
          <button
            class="secondary-button shrink-0"
            type="button"
            :disabled="item.status === 'downloading' || item.status === 'done'"
            @click="download(item)"
          >
            {{
              item.status === 'done'
                ? t('download.done')
                : item.status === 'downloading'
                  ? `${item.progress}%`
                  : item.status === 'error'
                    ? t('download.retry')
                    : t('download.download')
            }}
          </button>
        </article>
      </div>
    </section>

    <section class="download-surface mt-5 p-5">
      <div class="mb-4 flex items-center justify-between gap-3">
        <div>
          <p class="text-sm font-medium">{{ t('download.history') }}</p>
          <p class="mt-1 text-xs text-text-l">{{ t('download.historyDescription') }}</p>
        </div>
        <button class="secondary-button" type="button" @click="loadHistory">
          {{ t('download.refresh') }}
        </button>
      </div>
      <p v-if="!history.length" class="py-5 text-center text-sm text-text-l">
        {{ t('download.noHistory') }}
      </p>
      <div v-else class="history-list custom-scrollbar space-y-2 overflow-y-auto">
        <article v-for="task in history" :key="task.id" class="download-result">
          <span class="grid size-10 place-items-center rounded-lg bg-primary/12 text-primary">
            <SvgIcon name="common-music" class-name="size-4" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{{ task.title || t('download.unnamed') }}</p>
            <p class="mt-1 truncate text-xs text-text-l">
              {{ task.platform === 'youtube' ? 'YouTube' : '哔哩哔哩' }} ·
              {{ task.quality || t('download.defaultQuality') }} ·
              {{
                task.status === 'done'
                  ? t('download.done')
                  : task.status === 'error'
                    ? t('download.failed')
                    : t('download.downloading')
              }}
            </p>
          </div>
          <button
            class="secondary-button shrink-0"
            type="button"
            :disabled="task.status !== 'done'"
            @click="showInFolder(task.filePath)"
          >
            {{ t('download.open') }}
          </button>
        </article>
      </div>
    </section>

    <div class="h-20" />
  </main>
</template>

<style scoped>
.download-surface {
  border: 1px solid color-mix(in srgb, var(--color-border) 76%, transparent);
  border-radius: 14px;
  background: color-mix(in srgb, var(--color-bg-l) 24%, transparent);
  box-shadow: 0 1px 1px color-mix(in srgb, var(--color-black-20) 30%, transparent);
  backdrop-filter: blur(8px);
}
.source-button,
.secondary-button,
.primary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  border-radius: 8px;
  padding: 0.5rem 0.8rem;
  font-size: 0.8125rem;
  transition:
    background-color 0.2s,
    border-color 0.2s;
}
.source-button,
.secondary-button {
  border: 1px solid var(--color-border);
  color: var(--color-text);
}
.source-button:hover,
.secondary-button:hover {
  background: var(--color-hover);
}
.source-button.selected {
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 14%, transparent);
  color: var(--color-primary);
}
.primary-button {
  background: var(--color-primary);
  color: white;
}
.primary-button:disabled,
.secondary-button:disabled {
  cursor: default;
  opacity: 0.55;
}
.download-result {
  display: flex;
  content-visibility: auto;
  contain-intrinsic-size: 76px;
  min-height: 76px;
  align-items: center;
  gap: 0.75rem;
  border: 1px solid color-mix(in srgb, var(--color-border) 72%, transparent);
  border-radius: 12px;
  padding: 0.65rem 0.75rem;
  background: color-mix(in srgb, var(--color-bg-l) 17%, transparent);
}
.download-progress {
  height: 3px;
  margin-top: 0.5rem;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-border) 60%, transparent);
}
.download-progress i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-primary);
  transition: width 0.2s ease;
}
.selection-control {
  min-width: 9rem;
}
.result-list,
.history-list {
  max-height: min(46vh, 31rem);
  padding-right: 0.25rem;
}
</style>
