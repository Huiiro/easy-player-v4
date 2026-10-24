import { invokeArtworkFetch, type SourceCallOptions } from './runtime'
import { SourceCallError } from './errors'

export function fetchArtworkDataUrl(
  imageUrl: string,
  options: SourceCallOptions = {}
): Promise<string> {
  if (typeof imageUrl !== 'string' || imageUrl.length > 10000 || !/^https?:\/\//i.test(imageUrl))
    throw new SourceCallError('INVALID_REQUEST')
  return invokeArtworkFetch(async ({ signal }) => {
    const response = await fetch(imageUrl, { signal })
    if (!response.ok)
      throw Object.assign(new Error('Artwork HTTP failure'), { status: response.status })
    const contentType = response.headers.get('content-type')?.split(';')[0] ?? ''
    if (!contentType.startsWith('image/') || !response.body) {
      await response.body?.cancel()
      throw new SourceCallError('INVALID_RESPONSE')
    }
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 20 * 1024 * 1024) {
          await reader.cancel()
          throw new SourceCallError('INVALID_RESPONSE')
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
    if (!size) throw new SourceCallError('INVALID_RESPONSE')
    return 'data:' + contentType + ';base64,' + Buffer.concat(chunks).toString('base64')
  }, options)
}
