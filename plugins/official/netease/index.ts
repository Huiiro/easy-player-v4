import { defineSourcePlugin } from '../../sdk/define'
import { searchNeteaseTracks, getNeteaseTrack } from './metadata'
import { searchNeteaseLyrics, getNeteaseLyrics } from './lyrics'
import { searchNeteaseArtwork } from './artwork'

export const neteasePlugin = defineSourcePlugin(
  {
    id: 'netease',
    displayName: 'NetEase Cloud Music',
    capabilities: ['lyrics', 'artwork', 'metadata']
  },
  () => ({
    id: 'netease',
    displayName: 'NetEase Cloud Music',
    apiVersion: 1,
    lyrics: { search: searchNeteaseLyrics, get: getNeteaseLyrics },
    metadata: { search: searchNeteaseTracks, get: getNeteaseTrack },
    artwork: { search: searchNeteaseArtwork }
  })
)
