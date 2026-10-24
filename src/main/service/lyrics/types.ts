export type {
  LyricFormat,
  LyricSearchRequest,
  NetworkLyricCandidate,
  ProviderLyricCandidate
} from '../../../shared/networkSources'
import type { LyricFormat } from '../../../shared/networkSources'
export type LyricsSource = 'embedded' | 'local' | 'network'
export interface LyricLoadPayload {
  content: string
  format: LyricFormat
  path?: string
}
