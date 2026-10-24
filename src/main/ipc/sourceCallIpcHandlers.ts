import { ipcMain } from 'electron'
import type { SourceRequest, MetadataQuery } from '../../shared/networkSources'
import { searchSourceTracks, getSourceTrack, getSourceTrackLyrics } from '../sources/metadata'
import { searchSourceArtwork } from '../sources/artwork'
import { fetchArtworkDataUrl } from '../sources/artworkFetch'
import { searchSourceMedia, parseSourceMedia } from '../sources/download'
import { searchNetworkLyrics } from '../service/lyrics/network'
import { withSourceRequest, cancelSourceRequest } from '../sources/requests'
import { sourceFailure, SourceCallError } from '../sources/errors'
import { setSourceCallLogger } from '../sources/runtime'
import { Logger } from '../service/loggerService'
import { isPlaybackOnly } from '../service/playbackMode'

function validateQuery(query: MetadataQuery): void {
  if (
    !query ||
    typeof query.title !== 'string' ||
    query.title.length > 500 ||
    [query.artist, query.album].some(
      (value) => value != null && (typeof value !== 'string' || value.length > 500)
    )
  )
    throw new SourceCallError('INVALID_REQUEST')
}
async function dispatch(request: SourceRequest, signal: AbortSignal): Promise<unknown> {
  const options = { signal }
  if (!request || typeof request !== 'object' || Array.isArray(request))
    throw new SourceCallError('INVALID_REQUEST')
  if (isPlaybackOnly()) throw new SourceCallError('BACKGROUND_PAUSED')
  switch (request.operation) {
    case 'metadata.search':
      return searchSourceTracks(request.sourceId, request.query, options)
    case 'metadata.get':
      return getSourceTrack(request.resource, options)
    case 'lyrics.get':
      return getSourceTrackLyrics(request.resource, options)
    case 'lyrics.search':
      validateQuery(request.query)
      if (
        request.query.preferWordTimed !== undefined &&
        typeof request.query.preferWordTimed !== 'boolean'
      )
        throw new SourceCallError('INVALID_REQUEST')
      return searchNetworkLyrics(request.query, options)
    case 'artwork.fetch':
      return { dataUrl: await fetchArtworkDataUrl(request.imageUrl, options) }
    case 'artwork.search': {
      validateQuery(request.query)
      const candidates = await searchSourceArtwork(request.query, options)
      if (!request.previews) return candidates
      const results = await Promise.allSettled(
        candidates.map(async (candidate) => ({
          ...candidate,
          previewUrl: await fetchArtworkDataUrl(candidate.imageUrl, options)
        }))
      )
      signal.throwIfAborted()
      const fulfilled = results.filter((result) => result.status === 'fulfilled')
      if (!fulfilled.length && results.length) throw (results[0] as PromiseRejectedResult).reason
      return fulfilled.map((result) => result.value)
    }
    case 'download.search':
      return searchSourceMedia(request.sourceId, request.query, options)
    case 'download.parse':
      return parseSourceMedia(request.url, options)
    default:
      throw new SourceCallError('INVALID_REQUEST')
  }
}
export function registerSourceCallIpcHandlers(): void {
  setSourceCallLogger((entry) => {
    if (entry.status === 'failed') Logger.warn('[Source call]', entry)
    else Logger.debug('[Source call]', entry)
  })
  ipcMain.handle('network-sources:invoke', async (event, request: SourceRequest) => {
    try {
      return {
        success: true,
        data: await withSourceRequest(event.sender, request, (signal) => dispatch(request, signal))
      }
    } catch (reason) {
      const failure = sourceFailure(reason)
      return { success: false, error: failure.message, failure }
    }
  })
  ipcMain.handle('network-sources:cancel', (event, requestId: unknown) => ({
    success: true,
    cancelled: cancelSourceRequest(event.sender.id, requestId)
  }))
}
