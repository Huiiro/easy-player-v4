import { computed, nextTick, onMounted, onBeforeUnmount, onDeactivated, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePlayerStore } from '@/stores/player/playerStore'
import { useMessage } from '@/components/ui/useMessage'
import eventBus from '@/utils/eventBus'
import type { LibrarySong } from '@/types/library'
import type { SongListSource } from '@/services/songListQuery'
export interface SongActionContext {
  source: SongListSource
  songs: LibrarySong[]
  selectedIds: Set<number>
  refresh: () => Promise<void>
  playSong: (song: LibrarySong) => Promise<void>
}
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useSongActions(props: SongActionContext, clearSelection: () => void) {
  const player = usePlayerStore()
  const { t } = useI18n()
  const { success, warning, error: showError } = useMessage()
  const activeMenuSong = ref<LibrarySong | null>(null)
  const activeMenuQueueIndex = computed(() =>
    player.queue.findIndex((song) => song.id === activeMenuSong.value?.id)
  )
  const menuElement = ref<HTMLElement | null>(null)
  const menuPosition = ref({ left: '0px', top: '0px' })
  const playlistDialogOpen = ref(false)
  const playlistSongIds = ref<number[]>([])
  const songTagDialogOpen = ref(false)
  const batchTagDialogOpen = ref(false)
  const tagSongId = ref<number | null>(null)
  const songsPendingDelete = ref<LibrarySong[]>([])
  const songDetailsOpen = ref(false)
  const songDetailsId = ref<number | null>(null)
  const metadataEditOpen = ref(false)
  const metadataEditSongId = ref<number | null>(null)
  const metadataEditCoverUrl = ref<string | null>(null)
  const openMenu = async (song: LibrarySong, x: number, y: number): Promise<void> => {
    activeMenuSong.value = song
    menuPosition.value = { left: `${x}px`, top: `${y}px` }
    eventBus.emit('songActionsMenuOpened', 'songlist')
    await nextTick()
    const menu = menuElement.value
    if (!menu) return
    menuPosition.value = {
      left: `${Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`,
      top: `${Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8))}px`
    }
  }
  const closeMenu = (): void => {
    activeMenuSong.value = null
  }
  const addActiveMenuSongToQueue = (): void => {
    const song = activeMenuSong.value
    if (song) {
      if (player.queue.some((queuedSong) => queuedSong.id === song.id)) {
        warning(t('songList.alreadyInQueue'))
      } else {
        player.addToQueue([song], true)
        success(t('songList.addedToQueue'))
      }
    }
    closeMenu()
  }
  const playActiveMenuSong = (): void => {
    if (activeMenuSong.value) void props.playSong(activeMenuSong.value)
    closeMenu()
  }
  async function removeActiveMenuSongFromQueue(): Promise<void> {
    const index = activeMenuQueueIndex.value
    closeMenu()
    if (index < 0) return
    try {
      await player.removeQueueItem(index)
      success(t('songList.removedFromQueue'))
    } catch {
      showError(t('songList.removeFromQueueFailed'))
    }
  }
  async function setActiveMenuSongPreference(preference: -1 | 1): Promise<void> {
    const song = activeMenuSong.value
    closeMenu()
    if (!song) return
    const next = song.preference === preference ? 0 : preference
    if (!(await player.setPreference(song.id, next))) showError(t('recommendation.failed'))
  }
  async function copyActiveMenuSongName(): Promise<void> {
    const song = activeMenuSong.value
    closeMenu()
    const name = song?.title.trim() || (song?.fileName ?? '').trim()
    if (!name) return
    try {
      await navigator.clipboard.writeText(name)
    } catch {
      const input = document.createElement('textarea')
      input.value = name
      input.style.position = 'fixed'
      input.style.opacity = '0'
      document.body.appendChild(input)
      input.select()
      const copied = document.execCommand('copy')
      input.remove()
      if (!copied) {
        showError(t('songList.copyNameFailed'))
        return
      }
    }
    success(t('songList.nameCopied'))
  }

  function openPlaylistPicker(songIds: number[]): void {
    if (!songIds.length) return
    playlistSongIds.value = [...songIds]
    playlistDialogOpen.value = true
  }
  async function removeSongsFromCurrentPlaylist(songIds: number[]): Promise<void> {
    if (props.source.type !== 'playlist' || !songIds.length) return
    const response = await window.api.database.command('removeSongsFromPlaylist', {
      playlistId: props.source.id,
      songIds: [...songIds]
    })
    if (response.success) {
      await removeDeletedSongsFromQueue(songIds)
      clearSelection()
      await props.refresh()
      eventBus.emit('playlistsChanged')
      success(t('songList.removedFromPlaylist'))
    }
  }
  async function addActiveMenuSongToPlaylist(): Promise<void> {
    const songId = activeMenuSong.value?.id
    closeMenu()
    if (songId) openPlaylistPicker([songId])
  }
  function addSelectedToPlaylist(): void {
    openPlaylistPicker([...props.selectedIds])
  }
  function removeActiveMenuSong(): void {
    if (activeMenuSong.value) void removeSongsFromCurrentPlaylist([activeMenuSong.value.id])
    closeMenu()
  }
  async function openActiveMenuSongFolder(): Promise<void> {
    const songId = activeMenuSong.value?.id
    closeMenu()
    if (!songId) return
    const response = await window.api.library.showSongInFolder(songId)
    if (!response.success) showError(response.error || t('songList.openFolderFailed'))
  }
  function requestDeleteActiveMenuSong(): void {
    const song = activeMenuSong.value
    closeMenu()
    if (!song) return
    songsPendingDelete.value = [song]
  }
  function requestDeleteSelectedSongs(): void {
    const selectedSongs = props.songs.filter((song) => props.selectedIds.has(song.id))
    if (!selectedSongs.length) return
    songsPendingDelete.value = selectedSongs
  }
  async function removeDeletedSongsFromQueue(songIds: number[]): Promise<void> {
    const deleted = new Set(songIds)
    for (let index = player.queue.length - 1; index >= 0; index--) {
      if (deleted.has(player.queue[index].id)) await player.removeQueueItem(index)
    }
  }
  async function onSongsDeleted(songIds: number[]): Promise<void> {
    await removeDeletedSongsFromQueue(songIds)
    clearSelection()
    songsPendingDelete.value = []
    await props.refresh()
    eventBus.emit('playlistsChanged')
    eventBus.emit('tagsChanged')
  }
  function openSongTags(): void {
    if (!activeMenuSong.value) return
    tagSongId.value = activeMenuSong.value.id
    songTagDialogOpen.value = true
    closeMenu()
  }
  async function openSongDetails(): Promise<void> {
    const songId = activeMenuSong.value?.id
    closeMenu()
    if (!songId) return
    songDetailsId.value = songId
    songDetailsOpen.value = true
  }
  function openMetadataEdit(): void {
    const song = activeMenuSong.value
    closeMenu()
    if (!song) return
    if (song.sourceId) {
      warning(t('metadataEdit.remoteNotSupported'))
      return
    }
    metadataEditSongId.value = song.id
    metadataEditCoverUrl.value = song.cover
      ? `easy-player-media://cover?path=${encodeURIComponent(song.cover)}`
      : null
    metadataEditOpen.value = true
  }
  function onMetadataSaved(): void {
    void props.refresh()
  }
  function openBatchTags(): void {
    if (!props.selectedIds.size) return
    batchTagDialogOpen.value = true
  }
  async function reloadSongsFromDisk(songIds: number[]): Promise<void> {
    if (!songIds.length) return
    const response = await window.api.metadata.reload(songIds)
    if (!response.success) {
      showError(response.error || t('songList.reloadFromDiskFailed'))
      return
    }
    await props.refresh()
    const result = response.data
    success(t('songList.reloadedFromDisk', { count: result?.reloaded || 0 }))
    if (result?.failed) warning(t('songList.reloadFromDiskPartial', { count: result.failed }))
  }
  function reloadActiveMenuSongFromDisk(): void {
    const song = activeMenuSong.value
    closeMenu()
    if (!song) return
    void reloadSongsFromDisk([song.id])
  }
  function reloadSelectedSongsFromDisk(): void {
    const localIds = props.songs
      .filter((song) => props.selectedIds.has(song.id) && song.sourceId === null)
      .map((song) => song.id)
    if (!localIds.length) {
      warning(t('songList.remoteReloadNotSupported'))
      return
    }
    void reloadSongsFromDisk(localIds)
  }
  const onSongActionsMenuOpened = (source: 'footer' | 'songlist'): void => {
    if (source !== 'songlist') closeMenu()
  }
  onMounted(() => {
    eventBus.on('songActionsMenuOpened', onSongActionsMenuOpened)
    window.addEventListener('click', closeMenu)
    window.addEventListener('contextmenu', closeMenu)
  })
  onDeactivated(closeMenu)
  onBeforeUnmount(() => {
    eventBus.off('songActionsMenuOpened', onSongActionsMenuOpened)
    window.removeEventListener('click', closeMenu)
    window.removeEventListener('contextmenu', closeMenu)
  })
  function setMenuElement(element: unknown): void {
    menuElement.value = element instanceof HTMLElement ? element : null
  }
  return {
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
    openPlaylistPicker,
    removeSongsFromCurrentPlaylist,
    addActiveMenuSongToPlaylist,
    addSelectedToPlaylist,
    removeActiveMenuSong,
    openActiveMenuSongFolder,
    requestDeleteActiveMenuSong,
    requestDeleteSelectedSongs,
    removeDeletedSongsFromQueue,
    onSongsDeleted,
    openSongTags,
    openSongDetails,
    openMetadataEdit,
    onMetadataSaved,
    openBatchTags,
    reloadSongsFromDisk,
    reloadActiveMenuSongFromDisk,
    reloadSelectedSongsFromDisk,
    setMenuElement
  }
}
