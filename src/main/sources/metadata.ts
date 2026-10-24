import type { SourceResourceRef, NetworkLyricCandidate } from '../../shared/networkSources'
import type { SourceTrackDetail, SourceTrackSummary } from '../../shared/sourceMetadata'
import { getNetworkSources } from './index'
import { invokeSource, type SourceCallOptions } from './runtime'
import { SourceCallError } from './errors'

function validateResource(resource: SourceResourceRef): void {
  if (
    !resource ||
    resource.resourceType !== 'track' ||
    typeof resource.sourceId !== 'string' ||
    typeof resource.resourceId !== 'string' ||
    !resource.resourceId.trim()
  )
    throw new SourceCallError('INVALID_REQUEST')
}
export function listMetadataSources(): { id: string; displayName: string }[] {
  return getNetworkSources()
    .list()
    .filter((source) => source.metadata)
    .map(({ id, displayName }) => ({ id, displayName }))
}
export async function searchSourceTracks(
  sourceId: string,
  query: string,
  options: SourceCallOptions = {}
): Promise<SourceTrackSummary[]> {
  if (
    typeof sourceId !== 'string' ||
    typeof query !== 'string' ||
    !query.trim() ||
    query.length > 500
  )
    throw new SourceCallError('INVALID_REQUEST')
  const results = await invokeSource(
    sourceId,
    'metadata.search',
    (source, context) => source.metadata!.search(query.trim(), context),
    options
  )
  return results.map((item) => ({ ...item, resource: { ...item.resource, sourceId } }))
}
export async function getSourceTrack(
  resource: SourceResourceRef,
  options: SourceCallOptions = {}
): Promise<SourceTrackDetail> {
  validateResource(resource)
  const result = await invokeSource(
    resource.sourceId,
    'metadata.get',
    (source, context) => source.metadata!.get(resource.resourceId, context),
    options
  )
  return { ...result, resource: { ...resource } }
}
export async function getSourceTrackLyrics(
  resource: SourceResourceRef,
  options: SourceCallOptions = {}
): Promise<NetworkLyricCandidate | null> {
  validateResource(resource)
  // Use line-timed lyrics for portable embedded tags in the metadata editor.
  const result = await invokeSource(
    resource.sourceId,
    'lyrics.get',
    (source, context) => source.lyrics!.get!(resource.resourceId, false, context),
    options
  )
  return result
    ? {
        ...result,
        provider: resource.sourceId,
        providerName: getNetworkSources().get(resource.sourceId)?.displayName ?? resource.sourceId,
        resource: { ...resource }
      }
    : null
}
