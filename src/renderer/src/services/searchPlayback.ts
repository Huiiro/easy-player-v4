import type { usePlayerStore } from '@/stores/player/playerStore'
import type { LibrarySong } from '@/types/library'

/** Search results reuse the active queue instead of replacing its collection. */
export async function playSearchResult(
  player: Pick<ReturnType<typeof usePlayerStore>, 'queue' | 'addToQueue' | 'playQueueItem'>,
  song: LibrarySong
): Promise<boolean> {
  if (song.songStatus === 0) return false
  let index = player.queue.findIndex((queued) => queued.id === song.id)
  if (index < 0) {
    player.addToQueue([song], true)
    index = player.queue.findIndex((queued) => queued.id === song.id)
  }
  return index >= 0 ? player.playQueueItem(index, -1, 'selected', 'search') : false
}
