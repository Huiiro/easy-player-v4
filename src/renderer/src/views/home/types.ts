import type { LibrarySong } from '@/types/library'

export interface OverviewStats {
  songCount: number
  albumCount: number
  artistCount: number
  librarySize: number
  totalPlaySeconds: number
  todayPlaySeconds: number
  eligiblePlays: number
  completedPlays: number
  quality: {
    standard: { count: number; bytes: number }
    high: { count: number; bytes: number }
    ultra: { count: number; bytes: number }
    lossless: { count: number; bytes: number }
    bitrateCount: number
    sizeFallbackCount: number
    unknownCount: number
    thresholds: {
      highKbps: number
      ultraKbps: number
      losslessKbps: number
      highMiB: number
      ultraMiB: number
      losslessMiB: number
    }
  }
  timePeriods: Array<{
    id: 'lateNight' | 'morning' | 'noon' | 'earlyAfternoon' | 'afternoon' | 'evening'
    playedSeconds: number
    plays: number
  }>
}

export interface HistoryDay {
  date: string
  seconds: number
}

export interface RankedSong extends LibrarySong {
  value: number
}

export interface Playlist {
  id: number
  name: string
  cover: string | null
  description: string | null
}

export type RecommendationGroup = 'recommended' | 'discovery'

export interface RecommendationCard {
  group: RecommendationGroup
  generatedFor: string
  songs: LibrarySong[]
  total: number
}
