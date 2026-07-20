export interface LibrarySong {
  id: number
  title: string
  artist: string | null
  album: string | null
  duration: number | null
  cover: string | null
  audio: string
  isNewest: boolean
  songStatus: number
  sourceId: number | null
  playTime?: string
  tags?: Array<{ id: number; name: string; color: string | null }>
}

export interface PagedLibrarySongs {
  data: LibrarySong[]
  total: number
}

export interface SongDetails extends LibrarySong {
  lrc: string | null
  translation: string | null
  year: number | null
  genre: string | null
  bitrate: number | null
  sampleRate: number | null
  bitDepth: number | null
  channels: number | null
  format: string | null
  fileName: string | null
  fileSize: number | null
  playTimes: number
  trackNo: number | null
  diskNo: number | null
  remoteId: string | null
  createdAt: string
}
