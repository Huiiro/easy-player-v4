import { getDatabase } from '../index'
import {
  getDailyRecommendationGroups,
  getRecentDiscoveryGroups,
  getRecommendationScores,
  selectRecommendationGroups
} from '../recommendations'
import type { RecommendationScore } from '../recommendations'
import type { Song } from '../types'
import { songColumns, type SongRow, attachTags, mapSong } from './songHelpers'

type RecommendationGroup = 'recommended' | 'discovery' | 'lessRecommended'

type RecommendationSong = Song & RecommendationScore

type HomeRecommendationGroup = 'recommended' | 'discovery'

type HomeRecommendationCard = {
  group: HomeRecommendationGroup
  generatedFor: string
  songs: RecommendationSong[]
  total: number
}

function attachRecommendationSongs(items: RecommendationScore[]): RecommendationSong[] {
  if (!items.length) return []
  const ids = items.map((score) => score.songId)
  const rows = getDatabase()
    .prepare(`SELECT ${songColumns} FROM song WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as SongRow[]
  const songs = new Map(attachTags(rows.map(mapSong)).map((song) => [song.id, song]))
  return items.flatMap((score) => {
    const song = songs.get(score.songId)
    return song ? [{ ...song, ...score, preference: song.preference }] : []
  })
}

export function getHomeRecommendations(): HomeRecommendationCard[] {
  const today = getDailyRecommendationGroups()
  const favorite: HomeRecommendationCard = {
    group: 'recommended',
    generatedFor: today.generatedFor,
    songs: attachRecommendationSongs(today.recommended.slice(0, 20)),
    total: today.recommended.length
  }
  const discovery = getRecentDiscoveryGroups()
    .filter(({ scores }) => scores.length > 0)
    .map(({ generatedFor, scores }): HomeRecommendationCard => ({
      group: 'discovery',
      generatedFor,
      songs: attachRecommendationSongs(scores.slice(0, 20)),
      total: scores.length
    }))
  return [favorite, ...discovery]
}

export function getHomeRecommendationSongs(
  group: HomeRecommendationGroup,
  generatedFor: string
): RecommendationSong[] {
  if (group === 'recommended') {
    const today = getDailyRecommendationGroups()
    return generatedFor === today.generatedFor ? attachRecommendationSongs(today.recommended) : []
  }
  if (group === 'discovery') {
    const snapshot = getRecentDiscoveryGroups().find((item) => item.generatedFor === generatedFor)
    return snapshot ? attachRecommendationSongs(snapshot.scores) : []
  }
  return []
}

export function getRecommendations(limit = 24): {
  recommended: Array<Song & RecommendationScore>
  discovery: Array<Song & RecommendationScore>
  lessRecommended: Array<Song & RecommendationScore>
  totals: Record<RecommendationGroup, number>
  generatedFor: string
  dataThrough: string
} {
  const bounded = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 24
  const groups = getDailyRecommendationGroups()
  // Feedback management reflects resets immediately; daily listening lists stay fixed.
  const lessRecommended = selectRecommendationGroups(getRecommendationScores(), 100).lessRecommended
  return {
    recommended: attachRecommendationSongs(groups.recommended.slice(0, bounded)),
    discovery: attachRecommendationSongs(groups.discovery.slice(0, bounded)),
    lessRecommended: attachRecommendationSongs(lessRecommended.slice(0, bounded)),
    totals: {
      recommended: groups.recommended.length,
      discovery: groups.discovery.length,
      lessRecommended: lessRecommended.length
    },
    generatedFor: groups.generatedFor,
    dataThrough: groups.dataThrough
  }
}

export function getRecommendationPage(
  group: RecommendationGroup,
  excludeSongIds: number[] = [],
  limit = 20
): { items: RecommendationSong[]; total: number; generatedFor: string } {
  if (!['recommended', 'discovery', 'lessRecommended'].includes(group))
    return { items: [], total: 0, generatedFor: '' }
  const excluded = new Set(
    Array.isArray(excludeSongIds)
      ? excludeSongIds.filter((id) => Number.isInteger(id) && id > 0)
      : []
  )
  const size = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 24
  const daily = getDailyRecommendationGroups()
  const scores =
    group === 'lessRecommended'
      ? selectRecommendationGroups(getRecommendationScores(), 100).lessRecommended
      : daily[group]
  return {
    items: attachRecommendationSongs(
      scores.filter((score) => !excluded.has(score.songId)).slice(0, size)
    ),
    total: scores.length,
    generatedFor: daily.generatedFor
  }
}
