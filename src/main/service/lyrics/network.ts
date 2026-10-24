import { invokeSource, type SourceCallOptions } from '../../sources/runtime'
import { SourceCallError } from '../../sources/errors'
import { isPlaybackOnly } from '../playbackMode'
import type { LyricSearchRequest, NetworkLyricCandidate } from './types'
import { getNetworkSources } from '../../sources'
import type { NetworkSource } from '../../sources/types'
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
  request: LyricSearchRequest,
  options: SourceCallOptions = {}
): Promise<NetworkLyricCandidate[]> {
  if (isPlaybackOnly()) return []
  if (!request?.title?.trim()) return []
  const searchProvider = async (source: NetworkSource): Promise<NetworkLyricCandidate[]> =>
    invokeSource(
      source.id,
      'lyrics.search',
      async (activeSource, context) => {
        const search = async (
          request: LyricSearchRequest,
          wordTimed: boolean
        ): Promise<NetworkLyricCandidate[]> =>
          (await activeSource.lyrics!.search(request, wordTimed, context)).map((candidate) => ({
            ...candidate,
            provider: source.id,
            providerName: source.displayName,
            resource: {
              sourceId: source.id,
              resourceType: 'track',
              resourceId: candidate.resourceId
            }
          }))
        const wordTimed = request.preferWordTimed !== false
        let preferred: NetworkLyricCandidate[] = []
        try {
          preferred = (await search(request, wordTimed)).filter((candidate) =>
            isRelevantCandidate(candidate, request)
          )
        } catch {
          context.signal.throwIfAborted()
          // A failure of the preferred format must not prevent this source's fallback.
        }
        context.signal.throwIfAborted()
        if (preferred.length || isPlaybackOnly()) return preferred
        return (await search(request, !wordTimed)).filter((candidate) =>
          isRelevantCandidate(candidate, request)
        )
      },
      options
    )
  const results = await Promise.allSettled(
    getNetworkSources()
      .list()
      .filter((source) => source.lyrics)
      .map(searchProvider)
  )
  if (options.signal?.aborted) throw new SourceCallError('CANCELLED')
  if (results.length && results.every((result) => result.status === 'rejected'))
    throw (results[0] as PromiseRejectedResult).reason
  return rankCandidates(
    results.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])),
    request
  )
}
