<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useSongActions, type SongActionContext } from './useSongActions'
import SongTagDialog from '@/components/tag/SongTagDialog.vue'
import BatchTagDialog from '@/components/tag/BatchTagDialog.vue'
import SongDetailsDialog from './SongDetailsDialog.vue'
import DeleteSongsDialog from './DeleteSongsDialog.vue'
import AddSongsToPlaylistDialog from './AddSongsToPlaylistDialog.vue'
import MetadataEditDialog from './MetadataEditDialog.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'
const props = defineProps<SongActionContext>()
const emit = defineEmits<{ clearSelection: [] }>()
const { t } = useI18n()
const {
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
defineExpose({
  openMenu,
  closeMenu,
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
        class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-hover"
        :class="activeMenuSong.preference === 1 ? 'text-primary' : ''"
        :aria-pressed="activeMenuSong.preference === 1"
        @click="setActiveMenuSongPreference(1)"
      >
        <SvgIcon name="play-like" class-name="size-4" />
        {{ t(activeMenuSong.preference === 1 ? 'songList.cancelLike' : 'songList.like') }}
      </button>
      <button
        class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-hover"
        :class="activeMenuSong.preference === -1 ? 'text-red-400' : ''"
        :aria-pressed="activeMenuSong.preference === -1"
        @click="setActiveMenuSongPreference(-1)"
      >
        <SvgIcon name="play-dislike" class-name="size-5" />
        {{ t(activeMenuSong.preference === -1 ? 'songList.cancelDislike' : 'songList.dislike') }}
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
        class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm text-red-400 hover:bg-hover"
        @click="removeActiveMenuSong"
      >
        <SvgIcon name="common-delete" class-name="size-4" />
        {{ t('songList.removeFromPlaylist') }}
      </button>
      <button
        class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm text-red-400 hover:bg-hover"
        @click="requestDeleteActiveMenuSong"
      >
        <SvgIcon name="common-delete" class-name="size-4" />
        {{ t('songList.delete') }}
      </button>
    </div>
  </Teleport>
  <SongTagDialog v-model="songTagDialogOpen" :song-id="tagSongId" @changed="refresh" />
  <BatchTagDialog v-model="batchTagDialogOpen" :song-ids="[...selectedIds]" @changed="refresh" />
  <SongDetailsDialog v-model="songDetailsOpen" :song-id="songDetailsId" />
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
