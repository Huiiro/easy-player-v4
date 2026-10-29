<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
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
  openMenu,
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
const marksOpen = ref(false)
const marksTrigger = ref<HTMLButtonElement | null>(null)
const marksPanel = ref<HTMLElement | null>(null)
let marksHideTimer: ReturnType<typeof setTimeout> | undefined
function cancelMarksHide(): void {
  clearTimeout(marksHideTimer)
}
function showMarks(): void {
  cancelMarksHide()
  marksOpen.value = true
}
function hideMarks(): void {
  cancelMarksHide()
  marksOpen.value = false
}
function deferMarksHide(): void {
  cancelMarksHide()
  marksHideTimer = setTimeout(hideMarks, 120)
}
async function focusMarks(): Promise<void> {
  showMarks()
  await nextTick()
  marksPanel.value?.querySelector('button')?.focus()
}
function returnToMarksTrigger(): void {
  hideMarks()
  marksTrigger.value?.focus()
}
watch(activeMenuSong, hideMarks)
onBeforeUnmount(cancelMarksHide)

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
      class="fixed z-[9999] w-47 max-h-[calc(100vh-16px)] overflow-y-auto rounded-lg border border-border bg-bg p-1 text-left shadow-xl"
      :style="menuPosition"
      @click.stop
      @dblclick.stop
      @contextmenu.prevent.stop
    >
      <p v-if="menuSongs.length > 1" class="px-3 py-1.5 text-xs text-text-l">
        {{ t('songList.selected', { count: menuSongs.length }) }}
      </p>
      <button
        class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-hover"
        @click="playActiveMenuSong"
      >
        <SvgIcon name="play-play" class-name="size-4" />
        {{ t('songList.play') }}
      </button>
      <button
        class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-hover"
        @click="addActiveMenuSongToQueue"
      >
        <SvgIcon name="common-plus" class-name="size-4" />
        {{ t('songList.addToQueue') }}
      </button>
      <button
        class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm enabled:hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="activeMenuQueueIndex < 0"
        @click="removeActiveMenuSongFromQueue"
      >
        <SvgIcon name="common-minimize" class-name="size-4" />
        {{ t('songList.removeFromQueue') }}
      </button>
      <button
        class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-hover"
        @click="addActiveMenuSongToPlaylist"
      >
        <SvgIcon name="common-plus" class-name="size-4" />
        {{ t('songList.addToPlaylist') }}
      </button>
      <button
        ref="marksTrigger"
        class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-hover"
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
        class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-hover"
        @click="openSongTags"
      >
        <SvgIcon name="common-tag" class-name="size-4" />
        {{ t('songList.editTags') }}
      </button>
      <button
        class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-hover"
        @click="openMetadataEdit"
      >
        <SvgIcon name="common-edit" class-name="size-4" />
        {{ t('songList.editMetadata') }}
      </button>
      <button
        class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-hover"
        @click="openLyricsEditor"
      >
        <SvgIcon name="common-edit-lrc" class-name="size-4" />
        {{ t('lyricEditor.title') }}
      </button>
      <button
        class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-hover"
        @click="openSongDetails"
      >
        <SvgIcon name="common-detail" class-name="size-4" />
        {{ t('songList.details') }}
      </button>
      <button
        class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-hover"
        @click="openActiveMenuSongFolder"
      >
        <SvgIcon name="common-folder" class-name="size-4" />
        {{ t('songList.openFolder') }}
      </button>
      <button
        v-if="activeMenuSong.sourceId === null"
        class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-hover"
        @click="reloadActiveMenuSongFromDisk"
      >
        <SvgIcon name="common-refresh" class-name="size-4" />
        {{ t('songList.reloadFromDisk') }}
      </button>
      <button
        class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-hover"
        @click="copyActiveMenuSongName"
      >
        <SvgIcon name="common-text-case" class-name="size-4" />
        {{ t('songList.copyName') }}
      </button>
      <button
        v-if="source.type === 'playlist'"
        class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm text-danger hover:bg-hover"
        @click="removeActiveMenuSong"
      >
        <SvgIcon name="common-delete" class-name="size-4" />
        {{ t('songList.removeFromPlaylist') }}
      </button>
      <button
        class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm text-danger hover:bg-hover"
        @click="requestDeleteActiveMenuSong"
      >
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
        role="menu"
        :aria-label="t('songList.marksAndPreference')"
        class="w-64 max-h-[calc(100vh-16px)] overflow-y-auto rounded-lg border border-border bg-bg p-1 text-left text-text shadow-xl"
        @pointerenter="cancelMarksHide"
        @pointerleave="deferMarksHide"
        @click.stop
        @dblclick.stop
        @contextmenu.prevent.stop
        @keydown.left.stop.prevent="returnToMarksTrigger"
        @keydown.esc.stop.prevent="returnToMarksTrigger"
      >
        <button
          class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-hover"
          :class="menuAllLiked ? 'text-primary' : ''"
          :aria-pressed="menuAllLiked"
          @click="setActiveMenuSongPreference(1)"
        >
          <SvgIcon name="play-like" class-name="size-4 shrink-0" />
          {{ t(menuAllLiked ? 'songList.cancelLike' : 'songList.like') }}
        </button>
        <button
          class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-hover"
          :class="menuAllDisliked ? 'text-danger' : ''"
          :aria-pressed="menuAllDisliked"
          @click="setActiveMenuSongPreference(-1)"
        >
          <SvgIcon name="play-dislike" class-name="size-4 shrink-0" />
          {{ t(menuAllDisliked ? 'songList.cancelDislike' : 'songList.dislike') }}
        </button>
        <div class="mx-2 my-1.5 h-px bg-border" role="separator" />
        <button
          class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-hover"
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
          class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-hover"
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
  </Teleport>
  <SongTagDialog v-model="songTagDialogOpen" :song-id="tagSongId" @changed="refresh" />
  <BatchTagDialog v-model="batchTagDialogOpen" :song-ids="batchTagSongIds" @changed="refresh" />
  <SongDetailsDialog v-model="songDetailsOpen" :song-id="songDetailsId" />
  <LyricsEditorDialog v-model="lyricsEditorOpen" :song-id="lyricsEditorSongId" @saved="refresh" />
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
