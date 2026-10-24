import { defineSourcePlugin } from '../../sdk/define'
import { searchQQMusicTracks, getQQMusicTrack, searchQQMusicArtwork } from './metadata'
import { searchQQMusicLyrics, getQQMusicLyrics } from './lyrics'

export const qqmusicPlugin = defineSourcePlugin(
  { id: 'qqmusic', displayName: 'QQ Music', capabilities: ['lyrics', 'artwork', 'metadata'] },
  () => ({
    id: 'qqmusic',
    displayName: 'QQ Music',
    apiVersion: 1,
    lyrics: { search: searchQQMusicLyrics, get: getQQMusicLyrics },
    metadata: { search: searchQQMusicTracks, get: getQQMusicTrack },
    artwork: { search: searchQQMusicArtwork }
  })
)
