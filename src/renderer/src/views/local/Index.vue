<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import FolderTree, { type FolderTreeNode } from '@/components/local/FolderTree.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import SongListView from '@/components/songlist/SongListView.vue'
import AddSongsToPlaylistDialog from '@/components/songlist/AddSongsToPlaylistDialog.vue'
import { useMessage } from '@/components/ui/useMessage'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import { usePlayerStore } from '@/stores/player/playerStore'
import eventBus from '@/utils/eventBus'
import type { LibrarySong } from '@/types/library'

interface LocalFolder {
  id: number
  pid: number | null
  name: string
  fullPath: string
  isRootPath: boolean
  songCount: number
}

const { t } = useI18n()
const { success, warning, error: showError } = useMessage()
const player = usePlayerStore()
const folders = ref<LocalFolder[]>([])
const expandedFolderIds = ref<Set<number>>(new Set())
const branchFolderIds = computed(() => {
  const parentIds = new Set(folders.value.map((folder) => folder.pid))
  return folders.value.filter((folder) => parentIds.has(folder.id)).map((folder) => folder.id)
})
const allFoldersExpanded = computed(
  () =>
    branchFolderIds.value.length > 0 &&
    branchFolderIds.value.every((id) => expandedFolderIds.value.has(id))
)
const sectionRef = ref<HTMLElement | null>(null)
const selectedFolderId = ref<number | null>(null)
const sidebarWidth = ref(Number(localStorage.getItem('easy-player:local-sidebar-width')) || 256)
const isResizing = ref(false)
const listRefreshKey = ref(0)
const menuFolder = ref<FolderTreeNode | null>(null)
const menuPosition = ref({ left: 0, top: 0 })
const menuRef = ref<HTMLElement | null>(null)
const deleteFolder = ref<FolderTreeNode | null>(null)
const deleteDialogOpen = ref(false)
const deleting = ref(false)
const folderActionBusy = ref(false)
const playlistDialogOpen = ref(false)
const playlistSongIds = ref<number[]>([])
const tree = computed<FolderTreeNode[]>(() => {
  const nodes = new Map<number, FolderTreeNode>()
  folders.value.forEach((folder) => nodes.set(folder.id, { ...folder, children: [] }))
  const roots: FolderTreeNode[] = []
  folders.value.forEach((folder) => {
    const node = nodes.get(folder.id)!
    const parent = folder.pid === null ? undefined : nodes.get(folder.pid)
    if (parent) parent.children.push(node)
    else roots.push(node)
  })
  return roots
})
const selectedFolderName = computed(
  () => folders.value.find((folder) => folder.id === selectedFolderId.value)?.fullPath || ''
)

async function loadFolders(): Promise<void> {
  const response = await window.api.database.command('listLocalFolders')
  if (!response.success) return
  const previousIds = new Set(folders.value.map((folder) => folder.id))
  folders.value = response.data as LocalFolder[]
  expandedFolderIds.value = new Set(
    folders.value
      .filter((folder) => !previousIds.has(folder.id) || expandedFolderIds.value.has(folder.id))
      .map((folder) => folder.id)
  )
  if (!folders.value.some((folder) => folder.id === selectedFolderId.value)) {
    selectedFolderId.value = folders.value.find((folder) => folder.isRootPath)?.id ?? null
  }
}
function toggleFolder(id: number): void {
  const next = new Set(expandedFolderIds.value)
  next.has(id) ? next.delete(id) : next.add(id)
  expandedFolderIds.value = next
}
function toggleAllFolders(): void {
  closeMenu()
  expandedFolderIds.value = allFoldersExpanded.value ? new Set() : new Set(branchFolderIds.value)
}
async function rebuildFolders(): Promise<void> {
  const response = await window.api.database.command('rebuildLocalFolders')
  if (!response.success) return
  await loadFolders()
  eventBus.emit('scanFinished')
  success(t('localFiles.rebuildDone', { count: response.data as number }))
}
function closeMenu(): void {
  menuFolder.value = null
}
function openFolderMenu(folder: FolderTreeNode, event: MouseEvent): void {
  menuPosition.value = {
    left: Math.max(8, Math.min(event.clientX, window.innerWidth - 240)),
    top: Math.max(8, Math.min(event.clientY, window.innerHeight - 56))
  }
  menuFolder.value = folder
  void nextTick(() => {
    const menu = menuRef.value
    if (!menu) return
    menuPosition.value = {
      left: Math.max(8, Math.min(event.clientX, window.innerWidth - menu.offsetWidth - 8)),
      top: Math.max(8, Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 8))
    }
    menu.querySelector('button')?.focus()
  })
}
async function runFolderAction(action: 'play' | 'addToPlaylist'): Promise<void> {
  const folder = menuFolder.value
  if (!folder || folderActionBusy.value) return
  closeMenu()
  folderActionBusy.value = true
  const failureKey = action === 'play' ? 'localFiles.playFailed' : 'songList.addToPlaylistFailed'
  try {
    const response = await window.api.database.command('getLocalFolderSongs', {
      folderId: folder.id
    })
    if (!response.success) throw new Error(response.error || t(failureKey))
    const songs = response.data as LibrarySong[]
    if (action === 'play') {
      const playableSongs = songs.filter((song) => song.songStatus !== 0)
      if (!playableSongs.length) {
        warning(t('localFiles.noPlayableSongs'))
        return
      }
      if (!(await player.playCollection(playableSongs, playableSongs[0].id, null))) {
        showError(t(failureKey))
      }
    } else {
      if (!songs.length) {
        warning(t('songList.empty'))
        return
      }
      playlistSongIds.value = songs.map((song) => song.id)
      playlistDialogOpen.value = true
    }
  } catch (error) {
    showError(error instanceof Error ? error.message : t(failureKey))
  } finally {
    folderActionBusy.value = false
  }
}
function handleOutsidePointer(event: PointerEvent): void {
  if (!menuRef.value?.contains(event.target as Node)) closeMenu()
}
function confirmDeleteFolderSongs(folder: FolderTreeNode): void {
  closeMenu()
  deleteFolder.value = folder
  deleteDialogOpen.value = true
}
function updateDeleteDialogOpen(value: boolean): void {
  if (!deleting.value) deleteDialogOpen.value = value
}
async function deleteFolderSongs(): Promise<void> {
  const folder = deleteFolder.value
  if (!folder || deleting.value) return
  deleting.value = true
  try {
    const response = await window.api.database.command('deleteLocalFolderSongs', {
      folderId: folder.id
    })
    if (!response.success) {
      showError(response.error || t('localFiles.deleteFailed'))
      return
    }
    const result = response.data as { deleted: number; removedFolders: number; songIds: number[] }
    const deletedIds = new Set(result.songIds)
    const currentSongId = player.currentQueueSong?.id
    for (let index = player.queue.length - 1; index >= 0; index--) {
      const song = player.queue[index]
      if (song && song.id !== currentSongId && deletedIds.has(song.id)) {
        await player.removeQueueItem(index)
      }
    }
    if (currentSongId !== undefined && deletedIds.has(currentSongId)) {
      const currentIndex = player.queue.findIndex((song) => song.id === currentSongId)
      if (currentIndex >= 0) await player.removeQueueItem(currentIndex)
    }
    deleteDialogOpen.value = false
    deleteFolder.value = null
    await loadFolders()
    listRefreshKey.value++
    eventBus.emit('scanFinished')
    eventBus.emit('playlistsChanged')
    eventBus.emit('tagsChanged')
    success(t('localFiles.deleted', { count: result.deleted }))
  } finally {
    deleting.value = false
  }
}
function startResize(event: PointerEvent): void {
  isResizing.value = true
  event.currentTarget instanceof HTMLElement &&
    event.currentTarget.setPointerCapture(event.pointerId)
}
function resize(event: PointerEvent): void {
  if (!isResizing.value) return
  const left = sectionRef.value?.getBoundingClientRect().left ?? 0
  sidebarWidth.value = Math.min(520, Math.max(180, event.clientX - left))
}
function endResize(): void {
  if (!isResizing.value) return
  isResizing.value = false
  listRefreshKey.value++
  localStorage.setItem('easy-player:local-sidebar-width', String(sidebarWidth.value))
}

onMounted(() => {
  void loadFolders()
  eventBus.on('scanFinished', loadFolders)
  document.addEventListener('pointerdown', handleOutsidePointer)
  window.addEventListener('resize', closeMenu)
})
onBeforeUnmount(() => {
  eventBus.off('scanFinished', loadFolders)
  document.removeEventListener('pointerdown', handleOutsidePointer)
  window.removeEventListener('resize', closeMenu)
})
</script>

<template>
  <section ref="sectionRef" class="flex h-full min-h-0 text-text">
    <aside
      class="custom-scrollbar shrink-0 overflow-y-auto p-3"
      :style="{ width: `${sidebarWidth}px` }"
      @scroll="closeMenu"
    >
      <div class="mb-3 flex items-center justify-between gap-2 px-1">
        <h1 class="text-lg font-bold">{{ t('localFiles.title') }}</h1>
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="btn-hover grid size-7 place-items-center rounded-md disabled:opacity-40"
            :disabled="!branchFolderIds.length"
            :title="allFoldersExpanded ? t('localFiles.collapseAll') : t('localFiles.expandAll')"
            :aria-label="
              allFoldersExpanded ? t('localFiles.collapseAll') : t('localFiles.expandAll')
            "
            @click="toggleAllFolders"
          >
            <SvgIcon
              :name="allFoldersExpanded ? 'common-expand-up' : 'common-expand-down'"
              class-name="size-4"
            />
          </button>
          <button
            class="btn-hover grid size-7 place-items-center rounded-md"
            :title="t('localFiles.rebuild')"
            @click="rebuildFolders"
          >
            <SvgIcon name="common-update" class-name="size-4" />
          </button>
        </div>
      </div>
      <p v-if="!tree.length" class="px-1 text-sm text-text-l">
        {{ t('localFiles.empty') }}
      </p>
      <FolderTree
        v-else
        :nodes="tree"
        :selected-id="selectedFolderId"
        :expanded-ids="expandedFolderIds"
        @select="selectedFolderId = $event"
        @toggle="toggleFolder"
        @contextmenu="openFolderMenu"
      />
      <div class="h-20" />
    </aside>
    <div
      class="local-resizer"
      :class="isResizing && 'is-resizing'"
      @pointerdown="startResize"
      @pointermove="resize"
      @pointerup="endResize"
      @pointercancel="endResize"
    />
    <main class="min-w-0 flex-1 h-full flex flex-col">
      <div
        v-if="selectedFolderName"
        class="border-b border-border px-5 py-2 text-xs text-text-l truncate flex-shrink-0"
      >
        {{ selectedFolderName }}
      </div>
      <SongListView
        v-if="selectedFolderId"
        :key="`${selectedFolderId}-${listRefreshKey}`"
        v-memo="[selectedFolderId, listRefreshKey]"
        :source="{ type: 'folder', id: selectedFolderId }"
        class="flex-1 min-h-0"
      />
      <p v-else class="p-6 text-sm text-text-l">{{ t('localFiles.empty') }}</p>
    </main>
  </section>
  <Teleport to="body">
    <div
      v-if="menuFolder"
      ref="menuRef"
      role="menu"
      class="fixed z-50 w-max min-w-44 rounded-xl border border-border bg-bg-l p-1 text-text shadow-xl"
      :style="{ left: `${menuPosition.left}px`, top: `${menuPosition.top}px` }"
      @keydown.esc.prevent="closeMenu"
    >
      <button
        type="button"
        role="menuitem"
        class="flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm hover:bg-hover disabled:opacity-50"
        :disabled="folderActionBusy"
        @click="runFolderAction('play')"
      >
        <SvgIcon name="play-play" class-name="size-4" />
        {{ t('localFiles.play') }}
      </button>
      <button
        type="button"
        role="menuitem"
        class="flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm hover:bg-hover disabled:opacity-50"
        :disabled="folderActionBusy"
        @click="runFolderAction('addToPlaylist')"
      >
        <SvgIcon name="common-plus" class-name="size-4" />
        {{ t('songList.addToPlaylist') }}
      </button>
      <button
        type="button"
        role="menuitem"
        class="flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm text-red-400 hover:bg-hover"
        @click="confirmDeleteFolderSongs(menuFolder)"
      >
        <SvgIcon name="common-delete" class-name="size-4" />
        {{ t('localFiles.deleteSongs') }}
      </button>
    </div>
  </Teleport>
  <AddSongsToPlaylistDialog v-model="playlistDialogOpen" :song-ids="playlistSongIds" />
  <BaseDialog
    :model-value="deleteDialogOpen"
    :title="t('localFiles.deleteSongs')"
    width="max-w-sm"
    :close-on-overlay="!deleting"
    @update:model-value="updateDeleteDialogOpen"
  >
    <p class="text-sm text-text-l">
      {{
        t('localFiles.confirmDeleteSongs', {
          name: deleteFolder?.name ?? '',
          count: deleteFolder?.songCount ?? 0
        })
      }}
    </p>
    <template #footer>
      <button
        class="btn-hover rounded-lg px-3 py-1.5 text-sm"
        :disabled="deleting"
        @click="deleteDialogOpen = false"
      >
        {{ t('common.cancel') }}
      </button>
      <button
        class="btn-hover-base rounded-lg bg-red-500 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        :disabled="deleting"
        @click="deleteFolderSongs"
      >
        {{ t('localFiles.deleteSongs') }}
      </button>
    </template>
  </BaseDialog>
</template>

<style scoped>
.local-resizer {
  position: relative;
  z-index: 2;
  width: 1px;
  flex: none;
  cursor: col-resize;
  background: var(--color-border);
}
.local-resizer::after {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -4px;
  width: 9px;
  content: '';
}
.local-resizer:hover,
.local-resizer.is-resizing {
  background: var(--color-primary);
}
</style>
