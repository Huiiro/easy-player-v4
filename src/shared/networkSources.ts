export * from '../../packages/plugin-sdk/src/networkSources'

import type { LyricSearchRequest as ProviderLyricSearchRequest } from '../../packages/plugin-sdk/src/networkSources'
export interface LyricSearchRequest extends ProviderLyricSearchRequest {
  songId?: number
}
