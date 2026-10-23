import { onBeforeUnmount, ref } from 'vue'
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
  beforeSongsReplace?: () => Promise<void>
}) {
  const songs = ref<LibrarySong[]>([])
  const playlists = ref<Playlist[]>([])
  const activePlaylistId = ref<number | null>(null)
  const isLoading = ref(false)
  const isSwitchingPlaylist = ref(false)
  let loadRevision = 0
  let selectionRevision = 0
  let loadedPlaylistId: number | null = null
  let disposed = false
  async function loadSongs(): Promise<void> {
    isLoading.value = true
    options.beforeLoad()
    const revision = ++loadRevision
    const playlistId = activePlaylistId.value
    try {
      const response =
        playlistId === null
          ? await window.api.database.command('querySongs', {})
          : await window.api.database.command('queryPlaylistSongs', {
              playlistId,
              query: {}
            })
      if (disposed || revision !== loadRevision) return
      if (!response.success) throw new Error(response.error || 'Unable to load songs')
      const data = response.data as PagedLibrarySongs
      await options.beforeSongsReplace?.()
      if (disposed || revision !== loadRevision) return
      songs.value = data.data.filter((song) => song.songStatus !== 0)
      loadedPlaylistId = playlistId
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
    activePlaylistId.value = id
    isSwitchingPlaylist.value = true
    const revision = ++selectionRevision
    try {
      await loadSongs()
    } catch (error) {
      if (!disposed && revision === selectionRevision) {
        activePlaylistId.value = loadedPlaylistId
        throw error
      }
    } finally {
      if (!disposed && revision === selectionRevision) isSwitchingPlaylist.value = false
    }
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
