import { defineSourcePlugin } from '../../sdk/define'
import { searchKugouTracks, getKugouTrack, searchKugouArtwork } from './metadata'
import { searchKugouLyrics, getKugouLyrics } from './lyrics'

export const kugouPlugin = defineSourcePlugin(
  { id: 'kugou', displayName: 'KuGou', capabilities: ['lyrics', 'artwork', 'metadata'] },
  () => ({
    id: 'kugou',
    displayName: 'KuGou',
    apiVersion: 1,
    lyrics: { search: searchKugouLyrics, get: getKugouLyrics },
    metadata: { search: searchKugouTracks, get: getKugouTrack },
    artwork: { search: searchKugouArtwork }
  })
)
