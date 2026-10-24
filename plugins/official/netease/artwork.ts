import type { SourceCallContext } from '../../../src/main/sources/types'
import type { ArtworkCandidate, MetadataQuery } from '../../../src/shared/networkSources'

export async function searchNeteaseArtwork(
  request: MetadataQuery,
  context?: SourceCallContext
): Promise<ArtworkCandidate[]> {
  const keyword = [request.title, request.artist, request.album].filter(Boolean).join(' ').trim()
  if (!keyword) return []
  const api = await import('@neteasecloudmusicapienhanced/api')
  const { search: searchNetease } = api.default ?? api
  context?.signal.throwIfAborted()
  const response = (await searchNetease({
    keywords: keyword,
    type: 10,
    limit: 12
  })) as unknown as {
    status?: number
    body?: { result?: { albums?: Array<Record<string, unknown>> } }
  }
  context?.signal.throwIfAborted()
  if (response.status !== 200)
    throw Object.assign(new Error('NetEase artwork search failed'), { status: response.status })
  return (response.body?.result?.albums ?? []).flatMap((album) => {
    const imageUrl =
      typeof album.picUrl === 'string' ? album.picUrl.replace(/^http:\/\//i, 'https://') : ''
    if (!imageUrl) return []
    const artist =
      typeof (album.artist as { name?: string } | undefined)?.name === 'string'
        ? (album.artist as { name: string }).name
        : ''
    return [
      {
        id: String(album.id ?? imageUrl),
        resource: {
          sourceId: 'netease',
          resourceType: 'album' as const,
          resourceId: String(album.id ?? imageUrl)
        },
        title: String(album.name ?? ''),
        artist,
        album: String(album.name ?? ''),
        imageUrl
      }
    ]
  })
}
