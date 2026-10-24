import type {
  MediaDownloadQuery,
  MediaDownloadPlan,
  MediaSearchItem
} from '../../shared/networkSources'
import { getNetworkSources } from './index'
import { invokeSource, type SourceCallOptions } from './runtime'
import { SourceCallError } from './errors'

export function searchSourceMedia(
  sourceId: string,
  query: string,
  options: SourceCallOptions = {}
): Promise<MediaSearchItem[]> {
  if (
    typeof sourceId !== 'string' ||
    typeof query !== 'string' ||
    !query.trim() ||
    query.length > 500
  )
    throw new SourceCallError('INVALID_REQUEST')
  return invokeSource(
    sourceId,
    'download.search',
    (source, context) => source.download!.search(query.trim(), context),
    options
  )
}
export function parseSourceMedia(
  url: string,
  options: SourceCallOptions = {}
): Promise<MediaSearchItem[]> {
  if (typeof url !== 'string' || url.length > 10000 || !/^https?:\/\//i.test(url.trim()))
    throw new SourceCallError('INVALID_REQUEST')
  let sourceId: string
  try {
    sourceId = getNetworkSources().findDownload(url.trim()).id
  } catch (error) {
    if (error instanceof SourceCallError) throw error
    throw new SourceCallError('SOURCE_NOT_FOUND', undefined, 'download.parse', { cause: error })
  }
  return invokeSource(
    sourceId,
    'download.parse',
    (source, context) => source.download!.parse(url.trim(), context),
    options
  )
}
export function resolveSourceMedia(
  sourceId: string,
  query: MediaDownloadQuery,
  options: SourceCallOptions = {}
): Promise<MediaDownloadPlan> {
  return invokeSource(
    sourceId,
    'download.resolve',
    (source, context) => source.download!.resolve(query, context),
    options
  )
}
