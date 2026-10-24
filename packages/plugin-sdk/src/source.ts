import type { SourceTrackDetail, SourceTrackSummary } from './sourceMetadata'
import type {
  ArtworkCandidate,
  LyricSearchRequest,
  MediaDownloadPlan,
  MediaDownloadQuery,
  MediaSearchItem,
  MetadataQuery,
  ProviderLyricCandidate
} from './networkSources'

export interface SourceCallContext {
  host?: import('./host').PluginHostServices
  signal: AbortSignal
  deadline: number
  sourceId?: string
  operation: string
}

/** Trusted in-process adapters only. These interfaces are not a third-party sandbox. */
export interface NetworkSource {
  id: string
  displayName: string
  apiVersion: 1
  version?: string
  lyrics?: {
    search(
      request: LyricSearchRequest,
      wordTimed: boolean,
      context?: SourceCallContext
    ): Promise<ProviderLyricCandidate[]>
    get?(
      resourceId: string,
      wordTimed: boolean,
      context?: SourceCallContext
    ): Promise<ProviderLyricCandidate | null>
  }
  metadata?: {
    search(query: string, context?: SourceCallContext): Promise<SourceTrackSummary[]>
    get(resourceId: string, context?: SourceCallContext): Promise<SourceTrackDetail>
  }
  artwork?: {
    search(request: MetadataQuery, context?: SourceCallContext): Promise<ArtworkCandidate[]>
  }
  download?: {
    matchesUrl(url: URL): boolean
    search(query: string, context?: SourceCallContext): Promise<MediaSearchItem[]>
    parse(url: string, context?: SourceCallContext): Promise<MediaSearchItem[]>
    resolve(request: MediaDownloadQuery, context?: SourceCallContext): Promise<MediaDownloadPlan>
  }
}
