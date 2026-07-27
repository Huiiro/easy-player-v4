<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import eventBus from '@/utils/eventBus'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const cacheDirectory = ref('')
const cacheLimitGb = ref(2)
const cacheUsed = ref(0)
const message = ref('')
const importProgress = ref<{ current: number; total: number } | null>(null)
let offProgress: (() => void) | undefined
const formatBytes = (bytes: number): string =>
  bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
async function loadCache(): Promise<void> {
  const [directory, limit, fallback] = await Promise.all([
    window.api.database.command('getSetting', { key: 'remote.cache-directory' }),
    window.api.database.command('getSetting', { key: 'remote.cache-limit-gb' }),
    window.api.remoteSource.defaultCacheDirectory()
  ])
  cacheDirectory.value =
    directory.success && typeof directory.data === 'string' ? directory.data : fallback.data || ''
  cacheLimitGb.value = limit.success && typeof limit.data === 'number' ? limit.data : 2
  const size = await window.api.remoteSource.cacheSize(cacheDirectory.value)
  cacheUsed.value = size.data || 0
}
async function chooseCacheDirectory(): Promise<void> {
  const result = await window.api.remoteSource.chooseCacheDirectory()
  if (!result.success || !result.data) return
  await window.api.database.command('setSetting', {
    key: 'remote.cache-directory',
    value: result.data
  })
  await loadCache()
}
async function saveCacheLimit(): Promise<void> {
  cacheLimitGb.value = Math.max(0.5, Math.min(100, Number(cacheLimitGb.value) || 2))
  await window.api.database.command('setSetting', {
    key: 'remote.cache-limit-gb',
    value: cacheLimitGb.value
  })
}
async function run(action: 'exportLibrary' | 'importLibrary' | 'recoverMovedSongs'): Promise<void> {
  if (action === 'importLibrary') importProgress.value = { current: 0, total: 0 }
  const result =
    action === 'exportLibrary'
      ? await window.api.files.exportLibrary(['songs', 'playlists', 'tags', 'settings'])
      : await window.api.files[action]()
  if (result.cancelled) return
  if (!result.success) {
    message.value = t('settings.fileOperationFailed')
    return
  }
  message.value =
    action === 'recoverMovedSongs'
      ? t('settings.filesRecovered', result.data as { recovered: number; total: number })
      : t('settings.fileOperationDone')
  importProgress.value = null
  eventBus.emit('scanFinished')
  eventBus.emit('playlistsChanged')
  eventBus.emit('tagsChanged')
}
onMounted(() => {
  void loadCache()
  offProgress = window.api.files.onImportProgress((progress) => (importProgress.value = progress))
})
onBeforeUnmount(() => offProgress?.())
</script>

<template>
  <div class="file-management">
    <div class="file-row">
      <div>
        <h3>{{ t('remote.cacheDirectory') }}</h3>
        <p>{{ t('remote.cacheUsed', { size: formatBytes(cacheUsed) }) }}</p>
      </div>
      <div class="file-path-control">
        <input :value="cacheDirectory" readonly class="input-base" />
        <button
          class="btn-hover-base text-sm text-nowrap"
          type="button"
          @click="chooseCacheDirectory"
        >
          {{ t('remote.chooseDirectory') }}
        </button>
      </div>
    </div>
    <div class="file-row">
      <div>
        <h3>{{ t('remote.cacheLimit') }}</h3>
        <p>{{ t('remote.cacheDescription') }}</p>
      </div>
      <div class="flex items-center gap-2">
        <input
          v-model.number="cacheLimitGb"
          class="input-base h-7 max-w-18"
          type="number"
          min="0.5"
          max="20"
          step="0.5"
          @change="saveCacheLimit"
        />
        <span>G</span>
      </div>
    </div>
    <div class="file-row">
      <div>
        <h3>{{ t('settings.libraryBackup') }}</h3>
        <p>{{ t('settings.libraryBackupDescription') }}</p>
      </div>
      <div class="file-actions">
        <button class="btn-hover-base text-sm" type="button" @click="run('exportLibrary')">
          {{ t('settings.exportLibrary') }}
        </button>
        <button class="btn-hover-base text-sm" type="button" @click="run('importLibrary')">
          {{ t('settings.importLibrary') }}
        </button>
      </div>
    </div>
    <div class="file-row">
      <div>
        <h3>{{ t('settings.recoverMovedFiles') }}</h3>
        <p>{{ t('settings.recoverMovedFilesDescription') }}</p>
      </div>
      <button class="btn-hover-base text-sm" type="button" @click="run('recoverMovedSongs')">
        {{ t('settings.recover') }}
      </button>
    </div>
    <div v-if="importProgress" class="file-progress">
      <div class="file-progress-head">
        <span>{{ t('library.loading') }}</span>
        <span>
          {{ importProgress.total ? `${importProgress.current} / ${importProgress.total}` : '—' }}
        </span>
      </div>
      <div class="file-progress-track">
        <span
          :style="{
            width: importProgress.total
              ? `${(importProgress.current / importProgress.total) * 100}%`
              : '0%'
          }"
        />
      </div>
    </div>
    <p v-if="message" class="file-message">{{ message }}</p>
  </div>
</template>

<style scoped>
.file-row {
  display: flex;
  min-height: 76px;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
  padding: 1.1rem 1.25rem;
}
.file-row + .file-row {
  border-top: 1px solid var(--color-border);
}
.file-row h3 {
  color: var(--color-text);
  font-size: 0.9rem;
  font-weight: 550;
}
.file-row p {
  margin-top: 0.25rem;
  color: var(--color-text-l);
  font-size: 0.8125rem;
  line-height: 1.45;
}
.file-path-control,
.file-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 0 0 auto;
}
.file-path-control .input-base {
  width: 34rem;
}
.file-progress {
  padding: 0.8rem 1.25rem 1rem;
  border-top: 1px solid var(--color-border);
}
.file-progress-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.45rem;
  color: var(--color-text-l);
  font-size: 0.75rem;
}
.file-progress-track {
  height: 0.28rem;
  overflow: hidden;
  border-radius: 999px;
  background: var(--color-hover);
}
.file-progress-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-primary);
  transition: width 160ms ease;
}
.file-message {
  padding: 0.8rem 1.25rem;
  border-top: 1px solid var(--color-border);
  color: var(--color-primary);
  font-size: 0.8125rem;
}
</style>
