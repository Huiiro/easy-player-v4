import { isPlaybackOnly } from '../playbackMode'
import type { LyricSearchRequest, NetworkLyricCandidate } from './types'
import { searchNeteaseLyrics } from './providers/netease'
import { searchKugouLyrics } from './providers/kugou'
import { searchQQMusicLyrics } from './providers/qqmusic'
import { isRelevantCandidate } from './relevance'

function normalizeMatchText(value?: string | null): string {
  return (value || '').toLowerCase().replace(/[\s\p{P}\p{S}_]+/gu, '')
}

function matchScore(actual: string | undefined, expected: string | null | undefined): number {
  const left = normalizeMatchText(actual)
  const right = normalizeMatchText(expected)
  if (!left || !right) return 0
  if (left === right) return 1
  if (left.includes(right) || right.includes(left)) return 0.8
  const common = [...new Set(left)].filter((character) => right.includes(character)).length
  return common / Math.max(left.length, right.length)
}

function rankCandidates(
  candidates: NetworkLyricCandidate[],
  request: LyricSearchRequest
): NetworkLyricCandidate[] {
  const score = (candidate: NetworkLyricCandidate): number =>
    matchScore(candidate.title, request.title) * 0.7 +
    matchScore(candidate.artist, request.artist) * 0.2 +
    matchScore(candidate.album, request.album) * 0.1
  const preferWordTimed = request.preferWordTimed !== false
  const preferred = (candidate: NetworkLyricCandidate): number =>
    Number(candidate.supportsWordTiming === preferWordTimed)
  return candidates.sort((left, right) => {
    return preferred(right) - preferred(left) || score(right) - score(left)
  })
}

export async function searchNetworkLyrics(
  request: LyricSearchRequest
): Promise<NetworkLyricCandidate[]> {
  if (isPlaybackOnly()) return []
  if (!request?.title?.trim()) return []
  const searchProvider = async (
    search: typeof searchNeteaseLyrics
  ): Promise<NetworkLyricCandidate[]> => {
    const wordTimed = request.preferWordTimed !== false
    let preferred: NetworkLyricCandidate[] = []
    try {
      preferred = (await search(request, wordTimed)).filter((candidate) =>
        isRelevantCandidate(candidate, request)
      )
    } catch {
      // A failure of the preferred format must not prevent this source's fallback.
    }
    if (preferred.length || isPlaybackOnly()) return preferred
    return (await search(request, !wordTimed)).filter((candidate) =>
      isRelevantCandidate(candidate, request)
    )
  }
  const results = await Promise.allSettled(
    [searchNeteaseLyrics, searchKugouLyrics, searchQQMusicLyrics].map(searchProvider)
  )
  return rankCandidates(
    results.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])),
    request
  )
}
