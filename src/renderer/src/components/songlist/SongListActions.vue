<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import FloatingPanel from '@/components/ui/FloatingPanel.vue'
import { useSongActions, type SongActionContext } from './useSongActions'
import SongTagDialog from '@/components/tag/SongTagDialog.vue'
import BatchTagDialog from '@/components/tag/BatchTagDialog.vue'
import SongDetailsDialog from './SongDetailsDialog.vue'
import DeleteSongsDialog from './DeleteSongsDialog.vue'
import AddSongsToPlaylistDialog from './AddSongsToPlaylistDialog.vue'
import MetadataEditDialog from './MetadataEditDialog.vue'
import LyricsEditorDialog from '@/components/lyrics/LyricsEditorDialog.vue'
import LyricsSearchDialog from '@/components/lyrics/LyricsSearchDialog.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'
const props = defineProps<SongActionContext>()
const emit = defineEmits<{ clearSelection: [] }>()
const { t } = useI18n()
const {
  batchTagSongIds,
  menuSongs,
  menuAllLiked,
  menuAllDisliked,
  menuAllDisableNetwork,
  menuAllInstrumental,
  setSelectedPreference,
  setLyricFlag,
  setMenuLyricFlag,
  activeMenuSong,
  activeMenuQueueIndex,
  menuId,
  menuPosition,
  playlistDialogOpen,
  playlistSongIds,
  songTagDialogOpen,
  batchTagDialogOpen,
  tagSongId,
  songsPendingDelete,
  songDetailsOpen,
  songDetailsId,
  metadataEditOpen,
  metadataEditSongId,
  metadataEditCoverUrl,
  lyricsEditorOpen,
  lyricsEditorSongId,
  openLyricsEditor,
  lyricsSearchOpen,
  lyricsSearchSong,
  openLyricsSearch,
  openMenu: openSongMenu,
  closeMenu,
  addActiveMenuSongToQueue,
  playActiveMenuSong,
  removeActiveMenuSongFromQueue,
  setActiveMenuSongPreference,
  copyActiveMenuSongName,
  addActiveMenuSongToPlaylist,
  addSelectedToPlaylist,
  removeActiveMenuSong,
  openActiveMenuSongFolder,
  requestDeleteActiveMenuSong,
  requestDeleteSelectedSongs,
  onSongsDeleted,
  openSongTags,
  openSongDetails,
  openMetadataEdit,
  onMetadataSaved,
  openBatchTags,
  reloadActiveMenuSongFromDisk,
  reloadSelectedSongsFromDisk,
  setMenuElement
} = useSongActions(props, () => emit('clearSelection'))
function useSubmenu(
  trigger: Ref<HTMLButtonElement | null>,
  panel: Ref<HTMLElement | null>
): {
  open: Ref<boolean>
  cancelHide: () => void
  show: () => void
  hide: () => void
  deferHide: () => void
  focusFirst: () => Promise<void>
  returnToTrigger: () => void
} {
  const open = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  function cancelHide(): void {
    clearTimeout(timer)
  }
  function show(): void {
    cancelHide()
    open.value = true
  }
  function hide(): void {
    cancelHide()
    open.value = false
  }
  function deferHide(): void {
    cancelHide()
    timer = setTimeout(hide, 120)
  }
  async function focusFirst(): Promise<void> {
    show()
    // Wait for FloatingPanel to measure and reveal the menu before moving focus.
    await nextTick()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    if (open.value) panel.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }
  function returnToTrigger(): void {
    hide()
    trigger.value?.focus()
  }
  watch(activeMenuSong, hide)
  onBeforeUnmount(cancelHide)
  return { open, cancelHide, show, hide, deferHide, focusFirst, returnToTrigger }
}
const marksTrigger = ref<HTMLButtonElement | null>(null)
const marksPanel = ref<HTMLElement | null>(null)
const editTrigger = ref<HTMLButtonElement | null>(null)
const editPanel = ref<HTMLElement | null>(null)
const {
  open: marksOpen,
  cancelHide: cancelMarksHide,
  show: showMarks,
  hide: hideMarks,
  deferHide: deferMarksHide,
  focusFirst: focusMarks,
  returnToTrigger: returnToMarksTrigger
} = useSubmenu(marksTrigger, marksPanel)
const {
  open: editOpen,
  cancelHide: cancelEditHide,
  show: showEdit,
  hide: hideEdit,
  deferHide: deferEditHide,
  focusFirst: focusEdit,
  returnToTrigger: returnToEditTrigger
} = useSubmenu(editTrigger, editPanel)
watch(
  marksOpen,
  (open) => {
    if (open) hideEdit()
  },
  { flush: 'sync' }
)
watch(
  editOpen,
  (open) => {
    if (open) hideMarks()
  },
  { flush: 'sync' }
)
async function openMenu(
  song: SongActionContext['songs'][number],
  x: number,
  y: number
): Promise<void> {
  hideMarks()
  hideEdit()
  await openSongMenu(song, x, y)
}

defineExpose({
  openMenu,
  closeMenu,
  setSelectedPreference,
  setLyricFlag,
  addSelectedToPlaylist,
  openBatchTags,
  reloadSelectedSongsFromDisk,
  requestDeleteSelectedSongs
})
</script>
<template>
  <!-- menu -->
  <Teleport to="body">
    <div
      v-if="activeMenuSong"
      :ref="setMenuElement"
      :data-song-context-menu="menuId"
      class="ep-menu custom-scrollbar fixed z-[9999] w-56 max-h-[calc(100vh-16px)] overflow-y-auto rounded-xl border border-border bg-bg p-1 text-left shadow-xl"
      :style="menuPosition"
      @click.stop
      @dblclick.stop
      @contextmenu.prevent.stop
    >
      <p v-if="menuSongs.length > 1" class="px-3 py-1.5 text-xs text-text-l">
        {{ t('songList.selected', { count: menuSongs.length }) }}
      </p>
      <button class="menu-item" @click="playActiveMenuSong">
        <SvgIcon name="play-play" class-name="size-4" />
        {{ t('songList.play') }}
      </button>
      <button class="menu-item" @click="addActiveMenuSongToQueue">
        <SvgIcon name="common-plus" class-name="size-4" />
        {{ t('songList.addToQueue') }}
      </button>
      <button
        class="menu-item"
        :disabled="activeMenuQueueIndex < 0"
        @click="removeActiveMenuSongFromQueue"
      >
        <SvgIcon name="common-minimize" class-name="size-4" />
        {{ t('songList.removeFromQueue') }}
      </button>
      <button class="menu-item" @click="addActiveMenuSongToPlaylist">
        <SvgIcon name="common-plus" class-name="size-4" />
        {{ t('songList.addToPlaylist') }}
      </button>
      <button
        ref="marksTrigger"
        class="menu-item"
        :class="{ 'bg-hover': marksOpen }"
        aria-haspopup="menu"
        :aria-expanded="marksOpen"
        @click="showMarks"
        @pointerenter="showMarks"
        @pointerleave="deferMarksHide"
        @keydown.right.prevent="focusMarks"
        @keydown.down.prevent="focusMarks"
        @keydown.esc.stop.prevent="hideMarks"
      >
        <SvgIcon name="common-preference" class-name="size-4" />
        <span class="flex-1">{{ t('songList.marksAndPreference') }}</span>
        <SvgIcon name="arrow-arrow-right-thin" class-name="size-4" />
      </button>
      <button
        ref="editTrigger"
        class="menu-item"
        :class="{ 'bg-hover': editOpen }"
        aria-haspopup="menu"
        :aria-expanded="editOpen"
        @click="showEdit"
        @pointerenter="showEdit"
        @pointerleave="deferEditHide"
        @keydown.right.prevent="focusEdit"
        @keydown.down.prevent="focusEdit"
        @keydown.esc.stop.prevent="hideEdit"
      >
        <SvgIcon name="common-edit" class-name="size-4" />
        <span class="flex-1">{{ t('songList.editSong') }}</span>
        <SvgIcon name="arrow-arrow-right-thin" class-name="size-4" />
      </button>
      <button class="menu-item" @click="openSongTags">
        <SvgIcon name="common-tag" class-name="size-4" />
        {{ t('songList.editTags') }}
      </button>
      <button class="menu-item" @click="openSongDetails">
        <SvgIcon name="common-detail" class-name="size-4" />
        {{ t('songList.details') }}
      </button>
      <button class="menu-item" @click="openActiveMenuSongFolder">
        <SvgIcon name="common-folder" class-name="size-4" />
        {{ t('songList.openFolder') }}
      </button>
      <button
        v-if="activeMenuSong.sourceId === null"
        class="menu-item"
        @click="reloadActiveMenuSongFromDisk"
      >
        <SvgIcon name="common-refresh" class-name="size-4" />
        {{ t('songList.reloadFromDisk') }}
      </button>
      <button class="menu-item" @click="copyActiveMenuSongName">
        <SvgIcon name="common-text-case" class-name="size-4" />
        {{ t('songList.copyName') }}
      </button>
      <button
        v-if="source.type === 'playlist'"
        class="menu-item text-danger"
        @click="removeActiveMenuSong"
      >
        <SvgIcon name="common-delete" class-name="size-4" />
        {{ t('songList.removeFromPlaylist') }}
      </button>
      <button class="menu-item text-danger" @click="requestDeleteActiveMenuSong">
        <SvgIcon name="common-delete" class-name="size-4" />
        {{ t('songList.delete') }}
      </button>
    </div>
    <FloatingPanel
      v-if="activeMenuSong && marksOpen"
      :open="marksOpen"
      :anchor="marksTrigger"
      side="right"
      align="start"
      :offset="12"
      teleport
      class="z-[10000]!"
    >
      <div
        ref="marksPanel"
        :data-song-context-menu="menuId"
        role="menu"
        :aria-label="t('songList.marksAndPreference')"
        class="ep-menu custom-scrollbar w-64 max-h-[calc(100vh-16px)] overflow-y-auto rounded-xl border border-border bg-bg p-1 text-left shadow-xl"
        @pointerenter="cancelMarksHide"
        @pointerleave="deferMarksHide"
        @click.stop
        @dblclick.stop
        @contextmenu.prevent.stop
        @keydown.left.stop.prevent="returnToMarksTrigger"
        @keydown.esc.stop.prevent="returnToMarksTrigger"
      >
        <button
          class="menu-item"
          :class="menuAllLiked ? 'text-primary' : ''"
          :aria-pressed="menuAllLiked"
          @click="setActiveMenuSongPreference(1)"
        >
          <SvgIcon name="play-like" class-name="size-4 shrink-0" />
          {{ t(menuAllLiked ? 'songList.cancelLike' : 'songList.like') }}
        </button>
        <button
          class="menu-item"
          :class="menuAllDisliked ? 'text-danger' : ''"
          :aria-pressed="menuAllDisliked"
          @click="setActiveMenuSongPreference(-1)"
        >
          <SvgIcon name="play-dislike" class-name="size-4 shrink-0" />
          {{ t(menuAllDisliked ? 'songList.cancelDislike' : 'songList.dislike') }}
        </button>
        <div class="mx-2 my-1.5 h-px bg-border" role="separator" />
        <button
          class="menu-item"
          :class="{ 'text-primary': menuAllDisableNetwork }"
          :aria-pressed="menuAllDisableNetwork"
          @click="setMenuLyricFlag('disableNetwork', !menuAllDisableNetwork)"
        >
          <SvgIcon
            :name="menuAllDisableNetwork ? 'common-no-internet-remove' : 'common-no-internet-add'"
            class-name="size-4 shrink-0"
          />
          {{
            t(
              menuAllDisableNetwork ? 'songList.removeDisableNetwork' : 'songList.addDisableNetwork'
            )
          }}
        </button>
        <button
          class="menu-item"
          :class="{ 'text-primary': menuAllInstrumental }"
          :aria-pressed="menuAllInstrumental"
          @click="setMenuLyricFlag('instrumental', !menuAllInstrumental)"
        >
          <SvgIcon
            :name="menuAllInstrumental ? 'common-music-notes-remove' : 'common-music-notes-add'"
            class-name="size-4 shrink-0"
          />
          {{ t(menuAllInstrumental ? 'songList.removeInstrumental' : 'songList.addInstrumental') }}
        </button>
      </div>
    </FloatingPanel>
    <FloatingPanel
      v-if="activeMenuSong && editOpen"
      :open="editOpen"
      :anchor="editTrigger"
      side="right"
      align="start"
      :offset="12"
      teleport
      class="z-[10000]!"
    >
      <div
        ref="editPanel"
        :data-song-context-menu="menuId"
        role="menu"
        :aria-label="t('songList.editSong')"
        class="ep-menu custom-scrollbar w-56 max-h-[calc(100vh-16px)] overflow-y-auto rounded-xl border border-border bg-bg p-1 text-left shadow-xl"
        @pointerenter="cancelEditHide"
        @pointerleave="deferEditHide"
        @click.stop
        @dblclick.stop
        @contextmenu.prevent.stop
        @keydown.left.stop.prevent="returnToEditTrigger"
        @keydown.esc.stop.prevent="returnToEditTrigger"
      >
        <button role="menuitem" class="menu-item" @click="openMetadataEdit">
          <SvgIcon name="common-edit" class-name="size-4 shrink-0" />
          {{ t('songList.editMetadata') }}
        </button>
        <button role="menuitem" class="menu-item" @click="openLyricsEditor">
          <SvgIcon name="common-edit-lrc" class-name="size-4 shrink-0" />
          {{ t('lyricEditor.title') }}
        </button>
        <button role="menuitem" class="menu-item" @click="openLyricsSearch">
          <SvgIcon name="common-search" class-name="size-4 shrink-0" />
          {{ t('playerPanel.lyricSearchTitle') }}
        </button>
      </div>
    </FloatingPanel>
  </Teleport>
  <SongTagDialog v-model="songTagDialogOpen" :song-id="tagSongId" @changed="refresh" />
  <BatchTagDialog v-model="batchTagDialogOpen" :song-ids="batchTagSongIds" @changed="refresh" />
  <SongDetailsDialog v-model="songDetailsOpen" :song-id="songDetailsId" />
  <LyricsEditorDialog v-model="lyricsEditorOpen" :song-id="lyricsEditorSongId" @saved="refresh" />
  <LyricsSearchDialog v-model="lyricsSearchOpen" :song="lyricsSearchSong" @saved="refresh" />
  <MetadataEditDialog
    v-model="metadataEditOpen"
    :song-id="metadataEditSongId"
    :cover-url="metadataEditCoverUrl"
    @saved="onMetadataSaved"
  />
  <DeleteSongsDialog
    :model-value="songsPendingDelete.length > 0"
    :songs="songsPendingDelete"
    @update:model-value="!$event && (songsPendingDelete = [])"
    @deleted="onSongsDeleted"
  />
  <AddSongsToPlaylistDialog v-model="playlistDialogOpen" :song-ids="playlistSongIds" />
</template>
