import { nextTick, onBeforeUnmount, ref } from 'vue'
import type { LibrarySong, PagedLibrarySongs } from '@/types/library'
interface Playlist {
  id: number
  name: string
  cover: string | null
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useCardLibrary(options: {
  beforeLoad: () => void
  onSongsLoaded: () => Promise<void>
  onPlaylistsLoaded: () => Promise<void>
  reduceMotion: () => boolean
}) {
  const songs = ref<LibrarySong[]>([])
  const playlists = ref<Playlist[]>([])
  const activePlaylistId = ref<number | null>(null)
  const isLoading = ref(false)
  const isSwitchingPlaylist = ref(false)
  let loadRevision = 0
  let selectionRevision = 0
  let disposed = false
  async function loadSongs(): Promise<void> {
    isLoading.value = true
    options.beforeLoad()
    const revision = ++loadRevision
    try {
      const response =
        activePlaylistId.value === null
          ? await window.api.database.command('querySongs', {})
          : await window.api.database.command('queryPlaylistSongs', {
              playlistId: activePlaylistId.value,
              query: {}
            })
      if (disposed || revision !== loadRevision) return
      const data = response.success ? (response.data as PagedLibrarySongs) : null
      songs.value = data?.data.filter((song) => song.songStatus !== 0) || []
      await options.onSongsLoaded()
    } finally {
      if (revision === loadRevision) isLoading.value = false
    }
  }
  async function loadPlaylists(): Promise<void> {
    const response = await window.api.database.command('listPlaylists')
    if (response.success && !disposed) {
      playlists.value = response.data as Playlist[]
      await options.onPlaylistsLoaded()
    }
  }
  async function selectPlaylist(id: number | null): Promise<void> {
    if (activePlaylistId.value === id) return
    isSwitchingPlaylist.value = true
    const revision = ++selectionRevision
    if (!options.reduceMotion()) await new Promise<void>((resolve) => setTimeout(resolve, 150))
    if (disposed || revision !== selectionRevision) return
    activePlaylistId.value = id
    await loadSongs()
    await nextTick()
    requestAnimationFrame(() => {
      if (!disposed && revision === selectionRevision) isSwitchingPlaylist.value = false
    })
  }
  onBeforeUnmount(() => {
    disposed = true
    loadRevision++
    selectionRevision++
  })
  return {
    songs,
    playlists,
    activePlaylistId,
    isLoading,
    isSwitchingPlaylist,
    loadSongs,
    loadPlaylists,
    selectPlaylist
  }
}
