export * from '../../packages/plugin-sdk/src/networkSources'

import type {
  LyricSearchRequest as ProviderLyricSearchRequest,
  SourceRequest as ProviderSourceRequest
} from '../../packages/plugin-sdk/src/networkSources'
export interface LyricSearchRequest extends ProviderLyricSearchRequest {
  songId?: number
  searchMode?: 'automatic' | 'manual'
}

export type SourceRequest =
  | Exclude<ProviderSourceRequest, { operation: 'lyrics.search' }>
  | (Omit<Extract<ProviderSourceRequest, { operation: 'lyrics.search' }>, 'query'> & {
      query: LyricSearchRequest
    })
