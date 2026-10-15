import type { LyricSearchRequest, NetworkLyricCandidate } from './types'
import { isRelatedTitle } from './utils'

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}_]+/gu, '')
}

const unknownArtists = new Set([
  'unknown',
  'unknownartist',
  '未知歌手',
  '未知艺术家',
  'variousartists',
  '群星'
])

function artistNames(value: string): string[][] {
  return value
    .normalize('NFKC')
    .split(/\s*(?:[/、,，;；&+]|\b(?:feat\.?|ft\.?|and|with)\b)\s*/iu)
    .map((name) =>
      [
        name.replace(/\([^)]*\)/g, ''),
        ...[...name.matchAll(/\(([^)]+)\)/g)].map((match) => match[1])
      ]
        .map(normalize)
        .filter((alias) => alias && !unknownArtists.has(alias))
    )
    .filter((aliases) => aliases.length)
}

function matchesArtist(actual: string, expected?: string | null): boolean {
  const requested = artistNames(expected || '')
  if (!requested.length) return true
  if (normalize(actual) === normalize(expected || '')) return true
  const available = new Set(artistNames(actual).flat())
  return requested.every((aliases) => aliases.some((alias) => available.has(alias)))
}

const versionPatterns = [
  /\blive\b|现场|演唱会/iu,
  /\binstrumental\b|伴奏|纯音乐/iu,
  /\b(?:remix|mix|dj)\b|混音/iu,
  /\bacoustic\b|不插电/iu,
  /\bcover\b|翻唱/iu,
  /\bpiano\b|钢琴/iu,
  /女声/iu,
  /男声/iu,
  /\b(?:sped\s*up|speed\s*up)\b|加速/iu,
  /\bslowed\b|降速|慢速/iu
]

function versionTags(title: string): boolean[] {
  const normalized = title.normalize('NFKC')
  const notes = [
    ...[...normalized.matchAll(/[([【]([^\])】]*)[)\]】]/gu)].map((match) => match[1]),
    normalized.match(/\s+[-–—]\s+(.+)$/u)?.[1] || ''
  ].join(' ')
  return versionPatterns.map((pattern) => pattern.test(notes))
}

/** Artist and recording version must agree before word-timing preferences are considered. */
export function isRelevantCandidate(
  candidate: NetworkLyricCandidate,
  request: LyricSearchRequest
): boolean {
  if (!isRelatedTitle(candidate.title, request.title, request.artist)) return false
  if (!matchesArtist(candidate.artist, request.artist)) return false
  const actualVersion = versionTags(candidate.title)
  const expectedVersion = versionTags(request.title)
  return actualVersion.every((tag, index) => tag === expectedVersion[index])
}
