import type { ArtworkCandidate, MetadataQuery } from '../../shared/networkSources'
import { getNetworkSources } from './index'
import { isPlaybackOnly } from '../service/playbackMode'
import { invokeSource, type SourceCallOptions } from './runtime'
import { SourceCallError } from './errors'

export async function searchSourceArtwork(
  request: MetadataQuery,
  options: SourceCallOptions = {}
): Promise<ArtworkCandidate[]> {
  if (isPlaybackOnly()) throw new SourceCallError('BACKGROUND_PAUSED')
  if (![request.title, request.artist, request.album].some((value) => value?.trim())) return []
  const sources = getNetworkSources()
    .list()
    .filter((source) => source.artwork)
  const results = await Promise.allSettled(
    sources.map(async (source) =>
      (
        await invokeSource(
          source.id,
          'artwork.search',
          (entry, context) => entry.artwork!.search(request, context),
          options
        )
      ).map((candidate) => ({
        ...candidate,
        resource: { ...candidate.resource, sourceId: source.id }
      }))
    )
  )
  if (options.signal?.aborted) throw new SourceCallError('CANCELLED')
  if (isPlaybackOnly()) throw new SourceCallError('BACKGROUND_PAUSED')
  const fulfilled = results.filter((result) => result.status === 'fulfilled')
  if (!fulfilled.length && results.length) throw (results[0] as PromiseRejectedResult).reason
  return fulfilled.flatMap((result) => result.value)
}
