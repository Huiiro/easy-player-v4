export type LyricsSource = 'embedded' | 'local' | 'network'
export type LyricFormat = 'lrc' | 'elrc' | 'yrc' | 'krc' | 'ttml' | 'plain'
export interface LyricLoadPayload {
  content: string
  format: LyricFormat
  path?: string
}
export interface LyricSearchRequest {
  title: string
  artist?: string | null
  album?: string | null
  preferWordTimed?: boolean
}
export interface NetworkLyricCandidate {
  id: string
  provider: 'netease' | 'kugou' | 'qqmusic'
  title: string
  artist: string
  album?: string
  lrc: string
  format?: LyricFormat
  supportsWordTiming: boolean
  translation?: string
  translationFormat?: LyricFormat
  romanization?: string
  romanizationFormat?: LyricFormat
}
