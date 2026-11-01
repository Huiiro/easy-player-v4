import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMessage } from '@/components/ui/useMessage'
import type { LibrarySong } from '@/types/library'

// Shared by song-list actions and the playback panel; capture IDs when an action is chosen.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useSongDialogs() {
  const { t } = useI18n()
  const { success, error } = useMessage()
  const songDetailsOpen = ref(false)
  const songDetailsId = ref<number | null>(null)
  const lyricsEditorOpen = ref(false)
  const lyricsEditorSongId = ref<number | null>(null)
  const songTagDialogOpen = ref(false)
  const tagSongId = ref<number | null>(null)

  function openSongDetails(song: LibrarySong): void {
    songDetailsId.value = song.id
    songDetailsOpen.value = true
  }
  function openLyricsEditor(song: LibrarySong): void {
    lyricsEditorSongId.value = song.id
    lyricsEditorOpen.value = true
  }
  function openSongTags(song: LibrarySong): void {
    tagSongId.value = song.id
    songTagDialogOpen.value = true
  }
  async function copySongName(song: LibrarySong): Promise<void> {
    const name = [
      song.title?.trim() || song.fileName?.trim(),
      song.artist?.trim(),
      song.album?.trim()
    ]
      .filter(Boolean)
      .join(' - ')
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
        error(t('songList.copyNameFailed'))
        return
      }
    }
    success(t('songList.nameCopied'))
  }
  return {
    songDetailsOpen,
    songDetailsId,
    lyricsEditorOpen,
    lyricsEditorSongId,
    songTagDialogOpen,
    tagSongId,
    openSongDetails,
    openLyricsEditor,
    openSongTags,
    copySongName
  }
}
