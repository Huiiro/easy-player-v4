import type { LyricSearchRequest } from './types'

export function searchKeyword(request: LyricSearchRequest): string {
  return [request.title, request.artist, request.album].filter(Boolean).join(' ').trim()
}

function normalizeTitle(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}_]+/gu, '')
}

function baseTitle(value: string): string {
  const version =
    /\b(?:live|remix|mix|remaster(?:ed)?|version|ver\.?|edit|acoustic|instrumental|cover|feat\.?)\b|现场|翻唱|伴奏|纯音乐|原唱|重制|版/iu
  return value
    .normalize('NFKC')
    .replace(/\s*[([【]([^\])】]*)[)\]】]/gu, (match, note: string) =>
      version.test(note) ? '' : match
    )
    .replace(/\s+[-–—]\s+(.+)$/u, (match, note: string) => (version.test(note) ? '' : match))
}

/** Compare song names, allowing punctuation and version notes but not arbitrary substrings. */
export function isRelatedTitle(actual: string, expected: string, artist?: string | null): boolean {
  const left = normalizeTitle(baseTitle(actual))
  const right = normalizeTitle(baseTitle(expected))
  if (!left || !right) return false
  if (left === right) return true
  const singer = normalizeTitle(artist || '')
  return Boolean(singer && (left === right + singer || left === singer + right))
}
