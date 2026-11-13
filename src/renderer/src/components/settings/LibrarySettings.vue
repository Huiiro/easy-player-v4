<script setup lang="ts">
import SettingGroup from '@/components/settings/SettingGroup.vue'
import SettingRow from './SettingRow.vue'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import eventBus from '@/utils/eventBus'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import { useMessage } from '@/components/ui/useMessage'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useUIStore } from '@/stores/ui/uiStore'
import type { LibraryWatchDirectory } from '../../../../shared/libraryAutoImport'

const { t } = useI18n()
const ui = useUIStore()
const { success, info, error } = useMessage()
const importingSong = ref(false)
const importProgress = ref<{ current: number; total: number } | null>(null)
const missingSongIds = ref<number[]>([])
const removeMissingDialogOpen = ref(false)
const watchedFolders = ref<LibraryWatchDirectory[]>([])
const loadingWatchedFolders = ref(true)
const savingWatchedFolders = ref(false)
let offProgress: (() => void) | undefined

async function loadWatchedFolders(): Promise<void> {
  try {
    watchedFolders.value = await window.api.library.getWatchedFolders()
  } catch {
    error(t('settings.watchedFoldersFailed'))
  } finally {
    loadingWatchedFolders.value = false
  }
}

async function saveWatchedFolders(folders: LibraryWatchDirectory[]): Promise<void> {
  savingWatchedFolders.value = true
  try {
    watchedFolders.value = await window.api.library.setWatchedFolders(
      folders.map(({ path, enabled }) => ({ path, enabled }))
    )
  } catch {
    error(t('settings.watchedFoldersFailed'))
  } finally {
    savingWatchedFolders.value = false
  }
}

async function addWatchedFolder(): Promise<void> {
  savingWatchedFolders.value = true
  try {
    const path = await window.api.library.selectLocalMusicFolder()
    if (path) await saveWatchedFolders([...watchedFolders.value, { path, enabled: true }])
  } catch {
    error(t('settings.watchedFoldersFailed'))
  } finally {
    savingWatchedFolders.value = false
  }
}

function toggleWatchedFolder(path: string, enabled: boolean): void {
  void saveWatchedFolders(
    watchedFolders.value.map((folder) => (folder.path === path ? { ...folder, enabled } : folder))
  )
}

function removeWatchedFolder(path: string): void {
  void saveWatchedFolders(watchedFolders.value.filter((folder) => folder.path !== path))
}

function openDuplicateDialog(): void {
  eventBus.emit('openDuplicateReport')
}

async function importSingleSong(): Promise<void> {
  if (importingSong.value) return
  importingSong.value = true
  try {
    const response = await window.api.library.importLocalMusicFile(ui.ignoreShortSongs)
    if (!response) return
    if (response.result.added > 0) {
      eventBus.emit('scanFinished')
      success(t('settings.singleSongImported'))
    } else if (response.result.duplicates > 0) {
      info(t('settings.singleSongExists'))
    } else if (response.result.skipped > 0) {
      info(t('settings.shortSongsSkipped', { count: response.result.skipped }))
    } else {
      error(t('settings.singleSongImportFailed'))
    }
  } catch {
    error(t('settings.singleSongImportFailed'))
  } finally {
    importingSong.value = false
  }
}

async function run(action: 'exportLibrary' | 'importLibrary' | 'recoverMovedSongs'): Promise<void> {
  try {
    const result =
      action === 'exportLibrary'
        ? await window.api.files.exportLibrary(['songs', 'playlists', 'tags', 'settings'])
        : await window.api.files[action]()
    if (result.cancelled) return
    if (!result.success) {
      error(t('settings.fileOperationFailed'))
      return
    }
    success(
      action === 'recoverMovedSongs'
        ? t('settings.filesRecovered', result.data as { recovered: number; total: number })
        : t('settings.fileOperationDone')
    )
    eventBus.emit('scanFinished')
    eventBus.emit('playlistsChanged')
    eventBus.emit('tagsChanged')
  } catch {
    error(t('settings.fileOperationFailed'))
  } finally {
    importProgress.value = null
  }
}
async function checkMissingSongs(): Promise<void> {
  const result = await window.api.database.command('checkMissingSongs')
  if (!result.success) {
    error(t('settings.fileOperationFailed'))
    return
  }
  missingSongIds.value = (result.data as { songIds: number[] }).songIds
  eventBus.emit('scanFinished')
  if (!missingSongIds.value.length) {
    success(t('settings.noMissingSongs'))
    return
  }
  removeMissingDialogOpen.value = true
}
async function removeMissingSongs(): Promise<void> {
  const result = await window.api.database.command('deleteSongs', {
    songIds: [...missingSongIds.value],
    deleteLocalFiles: false
  })
  if (!result.success) {
    error(t('settings.fileOperationFailed'))
    return
  }
  removeMissingDialogOpen.value = false
  success(t('settings.missingSongsRemoved', { count: missingSongIds.value.length }))
  missingSongIds.value = []
  eventBus.emit('scanFinished')
  eventBus.emit('playlistsChanged')
  eventBus.emit('tagsChanged')
}
onMounted(() => {
  offProgress = window.api.files.onImportProgress((progress) => (importProgress.value = progress))
  eventBus.on('scanFinished', loadWatchedFolders)
  void loadWatchedFolders()
})
onBeforeUnmount(() => {
  offProgress?.()
  eventBus.off('scanFinished', loadWatchedFolders)
})
</script>

<template>
  <SettingGroup :title="t('settings.groups.folderMonitoring')">
    <SettingRow
      :label="t('settings.autoImportLocalMusic')"
      :description="t('settings.autoImportLocalMusicDescription')"
    >
      <BaseSwitch
        v-model="ui.autoImportLocalMusic"
        :aria-label="t('settings.autoImportLocalMusic')"
        size="md"
      />
    </SettingRow>
    <SettingRow
      :label="t('settings.showAutoImportNotifications')"
      :description="t('settings.showAutoImportNotificationsDescription')"
    >
      <BaseSwitch
        v-model="ui.showAutoImportNotifications"
        :aria-label="t('settings.showAutoImportNotifications')"
        :disabled="!ui.autoImportLocalMusic"
        size="md"
      />
    </SettingRow>
    <SettingRow
      :label="t('settings.watchedFolders')"
      :description="t('settings.watchedFoldersDescription')"
    >
      <BaseButton
        variant="secondary"
        size="sm"
        :disabled="loadingWatchedFolders || savingWatchedFolders"
        @click="addWatchedFolder"
      >
        {{ t('settings.addWatchedFolder') }}
      </BaseButton>
    </SettingRow>
    <div class="watch-folders" :aria-busy="loadingWatchedFolders || savingWatchedFolders">
      <p v-if="loadingWatchedFolders" class="text-sm text-text-l">{{ t('library.loading') }}</p>
      <p v-else-if="!watchedFolders.length" class="text-sm text-text-l">
        {{ t('settings.noWatchedFolders') }}
      </p>
      <div v-for="folder in watchedFolders" :key="folder.path" class="watch-folder">
        <div class="min-w-0 flex-1">
          <p class="text-sm text-text" :title="folder.path">
            {{ folder.path.split(/[\\/]/).pop() || folder.path }}
          </p>
          <p class="break-all text-xs text-text-l">{{ folder.path }}</p>
        </div>
        <BaseSwitch
          :model-value="folder.enabled"
          :aria-label="t('settings.watchFolder', { path: folder.path })"
          :disabled="savingWatchedFolders"
          size="md"
          @update:model-value="toggleWatchedFolder(folder.path, $event === true)"
        />
        <BaseButton
          variant="ghost"
          size="sm"
          :disabled="savingWatchedFolders"
          :aria-label="t('settings.removeWatchedFolder', { path: folder.path })"
          @click="removeWatchedFolder(folder.path)"
        >
          {{ t('settings.remove') }}
        </BaseButton>
      </div>
    </div>
  </SettingGroup>
  <SettingGroup :title="t('settings.groups.importMusic')">
    <SettingRow
      :label="t('settings.importSongs')"
      :description="t('settings.importSongsDescription')"
    >
      <button
        class="btn-hover-base text-sm"
        type="button"
        @click="eventBus.emit('importLocalMusic')"
      >
        {{ t('settings.importSongs') }}
      </button>
    </SettingRow>
    <SettingRow
      :label="t('settings.importSingleSong')"
      :description="t('settings.importSingleSongDescription')"
    >
      <button
        class="btn-hover-base text-sm disabled:cursor-wait disabled:opacity-50"
        type="button"
        :disabled="importingSong"
        @click="importSingleSong"
      >
        {{ t('settings.importSingleSong') }}
      </button>
    </SettingRow>
    <SettingRow
      :label="t('settings.ignoreShortSongs')"
      :description="t('settings.ignoreShortSongsDescription')"
    >
      <BaseSwitch v-model="ui.ignoreShortSongs" size="md" />
    </SettingRow>
  </SettingGroup>
  <SettingGroup :title="t('settings.groups.libraryDisplay')">
    <SettingRow
      :label="t('settings.albumGroupByName')"
      :description="t('settings.albumGroupByNameDescription')"
    >
      <BaseSwitch v-model="ui.albumGroupByName" size="md" />
    </SettingRow>
    <SettingRow
      :label="t('settings.genreSeparator')"
      :description="t('settings.genreSeparatorDescription')"
    >
      <div class="w-64">
        <input
          v-model="ui.genreSeparator"
          class="input-base text-center"
          :aria-label="t('settings.genreSeparator')"
          :placeholder="t('settings.genreSeparatorPlaceholder')"
          maxlength="8"
        />
      </div>
    </SettingRow>
    <div class="setting-row text-nowrap">
      <div>
        <h3>{{ t('settings.artistSeparator') }}</h3>
        <p>{{ t('settings.artistSeparatorDescription') }}</p>
      </div>
      <div class="w-64">
        <input
          v-model="ui.artistSeparator"
          class="input-base text-center"
          :placeholder="t('settings.artistSeparatorPlaceholder')"
          maxlength="8"
        />
      </div>
    </div>
    <SettingRow
      :label="t('settings.normalizeMetadataSeparator')"
      :description="t('settings.normalizeMetadataSeparatorDescription')"
    >
      <BaseSwitch v-model="ui.normalizeMetadataSeparator" size="md" />
    </SettingRow>
  </SettingGroup>
  <SettingGroup :title="t('settings.groups.libraryMaintenance')">
    <SettingRow :label="t('duplicates.title')" :description="t('duplicates.description')">
      <BaseButton variant="secondary" size="sm" @click="openDuplicateDialog">
        {{ t('duplicates.start') }}
      </BaseButton>
    </SettingRow>
    <SettingRow
      :label="t('settings.libraryBackup')"
      :description="t('settings.libraryBackupDescription')"
    >
      <div class="actions">
        <button class="btn-hover-base text-sm" type="button" @click="run('exportLibrary')">
          {{ t('settings.exportLibrary') }}
        </button>
        <button class="btn-hover-base text-sm" type="button" @click="run('importLibrary')">
          {{ t('settings.importLibrary') }}
        </button>
      </div>
    </SettingRow>
    <SettingRow
      :label="t('settings.recoverMovedFiles')"
      :description="t('settings.recoverMovedFilesDescription')"
    >
      <button class="btn-hover-base text-sm" type="button" @click="run('recoverMovedSongs')">
        {{ t('settings.recover') }}
      </button>
    </SettingRow>
    <SettingRow
      :label="t('settings.checkMissingSongs')"
      :description="t('settings.checkMissingSongsDescription')"
    >
      <button class="btn-hover-base text-sm" type="button" @click="checkMissingSongs">
        {{ t('settings.check') }}
      </button>
    </SettingRow>
    <div v-if="importProgress" class="progress">
      <div>
        <span>{{ t('library.loading') }}</span>
        <span>
          {{ importProgress.total ? `${importProgress.current} / ${importProgress.total}` : '—' }}
        </span>
      </div>
      <span class="track">
        <span
          :style="{
            width: importProgress.total
              ? `${(importProgress.current / importProgress.total) * 100}%`
              : '0%'
          }"
        />
      </span>
    </div>

    <BaseDialog
      v-model="removeMissingDialogOpen"
      :title="t('settings.removeMissingSongs')"
      width="max-w-sm"
    >
      <p class="text-sm text-text-l">
        {{ t('settings.removeMissingSongsConfirm', { count: missingSongIds.length }) }}
      </p>
      <template #footer>
        <BaseButton variant="cancel" @click="removeMissingDialogOpen = false">
          {{ t('common.cancel') }}
        </BaseButton>
        <BaseButton variant="danger" @click="removeMissingSongs">
          {{ t('settings.remove') }}
        </BaseButton>
      </template>
    </BaseDialog>
  </SettingGroup>
</template>

<style scoped>
.watch-folders {
  padding: 0 1.25rem 1rem;
}
.watch-folder {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--color-border);
}
.actions {
  display: flex;
  gap: 0.5rem;
}
.progress {
  padding: 0.8rem 1.25rem 1rem;
  border-top: 1px solid var(--color-border);
  color: var(--color-text-l);
  font-size: 0.75rem;
}
.progress > div {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.45rem;
}
.track {
  display: block;
  height: 0.28rem;
  overflow: hidden;
  border-radius: 999px;
  background: var(--color-hover);
}
.track > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-primary);
  transition: width var(--motion-duration-standard) var(--motion-ease-standard);
}
</style>
