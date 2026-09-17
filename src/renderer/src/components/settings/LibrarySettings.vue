<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import eventBus from '@/utils/eventBus'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import { useMessage } from '@/components/ui/useMessage'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { useUIStore } from '@/stores/ui/uiStore'

const { t } = useI18n()
const ui = useUIStore()
const { success, error } = useMessage()
const importProgress = ref<{ current: number; total: number } | null>(null)
const missingSongIds = ref<number[]>([])
const removeMissingDialogOpen = ref(false)
let offProgress: (() => void) | undefined

async function run(action: 'exportLibrary' | 'importLibrary' | 'recoverMovedSongs'): Promise<void> {
  const result =
    action === 'exportLibrary'
      ? await window.api.files.exportLibrary(['songs', 'playlists', 'tags', 'settings'])
      : await window.api.files[action]()
  if (result.cancelled) {
    importProgress.value = null
    return
  }
  if (!result.success) {
    importProgress.value = null
    error(t('settings.fileOperationFailed'))
    return
  }
  success(
    action === 'recoverMovedSongs'
      ? t('settings.filesRecovered', result.data as { recovered: number; total: number })
      : t('settings.fileOperationDone')
  )
  importProgress.value = null
  eventBus.emit('scanFinished')
  eventBus.emit('playlistsChanged')
  eventBus.emit('tagsChanged')
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
})
onBeforeUnmount(() => offProgress?.())
</script>

<template>
  <div class="setting-row text-nowrap">
    <div>
      <h3>{{ t('settings.artistSeparator') }}</h3>
      <p>{{ t('settings.artistSeparatorDescription') }}</p>
    </div>
    <div class="w-120">
      <input
        v-model="ui.artistSeparator"
        class="input-base text-center"
        :placeholder="t('settings.artistSeparatorPlaceholder')"
        maxlength="8"
      />
    </div>
  </div>
  <div class="setting-row">
    <div>
      <h3>{{ t('settings.normalizeArtistSeparator') }}</h3>
      <p>{{ t('settings.normalizeArtistSeparatorDescription') }}</p>
    </div>
    <BaseSwitch v-model="ui.normalizeArtistSeparator" size="md" />
  </div>
  <div class="setting-row">
    <div>
      <h3>{{ t('settings.libraryBackup') }}</h3>
      <p>{{ t('settings.libraryBackupDescription') }}</p>
    </div>
    <div class="actions">
      <button class="btn-hover-base text-sm" type="button" @click="run('exportLibrary')">
        {{ t('settings.exportLibrary') }}
      </button>
      <button class="btn-hover-base text-sm" type="button" @click="run('importLibrary')">
        {{ t('settings.importLibrary') }}
      </button>
    </div>
  </div>
  <div class="setting-row">
    <div>
      <h3>{{ t('settings.recoverMovedFiles') }}</h3>
      <p>{{ t('settings.recoverMovedFilesDescription') }}</p>
    </div>
    <button class="btn-hover-base text-sm" type="button" @click="run('recoverMovedSongs')">
      {{ t('settings.recover') }}
    </button>
  </div>
  <div class="setting-row">
    <div>
      <h3>{{ t('settings.checkMissingSongs') }}</h3>
      <p>{{ t('settings.checkMissingSongsDescription') }}</p>
    </div>
    <button class="btn-hover-base text-sm" type="button" @click="checkMissingSongs">
      {{ t('settings.check') }}
    </button>
  </div>
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
      <button class="btn-hover px-3 py-1.5 text-sm" @click="removeMissingDialogOpen = false">
        {{ t('common.cancel') }}
      </button>
      <button
        class="rounded-lg bg-red-500 px-3 py-1.5 text-sm text-white"
        @click="removeMissingSongs"
      >
        {{ t('settings.remove') }}
      </button>
    </template>
  </BaseDialog>
</template>

<style scoped>
.setting-row {
  display: flex;
  min-height: 76px;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
  padding: 1.1rem 1.25rem;
}

.setting-row h3 {
  color: var(--color-text);
  font-size: 0.9rem;
  font-weight: 550;
}
.setting-row p {
  margin-top: 0.25rem;
  color: var(--color-text-l);
  font-size: 0.8125rem;
  line-height: 1.45;
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
  transition: width 160ms ease;
}
</style>
