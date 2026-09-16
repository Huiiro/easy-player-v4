export type LyricSource = 'embedded' | 'database' | 'local' | 'network'
export type LyricFormat = 'lrc' | 'elrc' | 'yrc' | 'ttml' | 'plain'

export interface LyricPayload {
  content: string
  format?: LyricFormat
  translation?: { content: string; format?: LyricFormat }
  romanization?: { content: string; format?: LyricFormat }
  source: LyricSource
  path?: string
}

export interface LyricWord {
  text: string
  startMs: number
  endMs: number
}

export interface LyricDocument {
  format: LyricFormat
  metadata: {
    title?: string
    artist?: string
    album?: string
    offsetMs: number
  }
  lines: LyricLine[]
}

export interface LyricLine {
  timeMs: number
  endMs?: number
  text: string
  untimed?: boolean
  translation?: string
  romanization?: string
  romanizationWords?: LyricWord[]
  rubySegments?: LyricRubySegment[]
  words?: LyricWord[]
  chars?: LyricChar[]
}

export interface LyricChar {
  char: string
  start: number
  duration: number
}

export interface LyricRubySegment {
  text: string
  romanization: string
  chars: LyricChar[]
}

export interface NetworkLyricCandidate {
  id: string
  provider: 'netease' | 'kugou'
  title: string
  artist: string
  album?: string
  lrc: string
  format?: LyricFormat
  translation?: string
  romanization?: string
}

interface ParsedLrcTrack {
  metadata: LyricDocument['metadata']
  lines: LyricLine[]
}

const LRC_TIME_TAG = /\[(\d+):(\d{1,2}(?:[.:]\d{1,3})?)\]/g
const ELRC_WORD_TAG = /<(\d+):(\d{1,2}(?:[.:]\d{1,3})?)>([^<]*)/g
const YRC_LINE_TAG = /^\[(\d+),(\d+)\](.*)$/
const YRC_WORD_TAG = /\((\d+),(\d+),\d+\)([^()]+)/g
const MAX_LYRIC_CONTENT_LENGTH = 1_000_000
const MAX_LYRIC_LINES = 5_000
const MAX_LYRIC_WORDS = 50_000

function parseTimestamp(minutes: string, seconds: string): number | null {
  const normalized = seconds.replace(':', '.')
  const value = Number(minutes) * 60_000 + Number(normalized) * 1000
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null
}

function emptyMetadata(): LyricDocument['metadata'] {
  return { offsetMs: 0 }
}

export function isLyricFormat(value: unknown): value is LyricFormat {
  return ['lrc', 'elrc', 'yrc', 'ttml', 'plain'].includes(String(value))
}

function detectLyricFormat(content: string): LyricFormat {
  const source = content.replace(/^\uFEFF/, '').trim()
  if (/<tt(?:\s|>)/i.test(source)) return 'ttml'
  if (/^\s*\[\d+,\d+\]\s*\(\d+,\d+,\d+\)/m.test(source)) return 'yrc'
  if (ELRC_WORD_TAG.test(source)) {
    ELRC_WORD_TAG.lastIndex = 0
    return 'elrc'
  }
  if (LRC_TIME_TAG.test(source)) {
    LRC_TIME_TAG.lastIndex = 0
    return 'lrc'
  }
  return 'plain'
}

function parseEnhancedWords(content: string): Pick<LyricLine, 'text' | 'words'> {
  const tokens = [...content.matchAll(ELRC_WORD_TAG)]
  ELRC_WORD_TAG.lastIndex = 0
  if (!tokens.length) return { text: content.trim() }

  const prefix = content.slice(0, tokens[0].index).trim()
  const words = tokens.flatMap((token, index) => {
    const startMs = parseTimestamp(token[1], token[2])
    const text = `${index === 0 ? prefix : ''}${token[3]}`
    return startMs === null || !text ? [] : [{ text, startMs, endMs: startMs }]
  })
  return { text: words.map((word) => word.text).join(''), words }
}

function parseLrcTrack(source: string): ParsedLrcTrack {
  const metadata = emptyMetadata()
  const lines: LyricLine[] = []
  const plainLines: string[] = []

  for (const rawLine of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    const metadataTag = line.match(/^\[([a-z][\w-]*):(.*)\]$/i)
    if (metadataTag && !/^\d+$/.test(metadataTag[1])) {
      const key = metadataTag[1].toLowerCase()
      const value = metadataTag[2].trim()
      if (key === 'offset') {
        const offset = Number(value)
        if (Number.isFinite(offset)) metadata.offsetMs = Math.round(offset)
      } else if (key === 'ti') metadata.title = value
      else if (key === 'ar') metadata.artist = value
      else if (key === 'al') metadata.album = value
      continue
    }

    const stamps = [...line.matchAll(LRC_TIME_TAG)]
    LRC_TIME_TAG.lastIndex = 0
    if (!stamps.length) {
      plainLines.push(line)
      continue
    }

    const content = line.replace(LRC_TIME_TAG, '').trim()
    LRC_TIME_TAG.lastIndex = 0
    const parsed = parseEnhancedWords(content)
    // Timestamp-only entries mark instrumental breaks and must retain timing.
    for (const stamp of stamps) {
      const timeMs = parseTimestamp(stamp[1], stamp[2])
      if (timeMs !== null) lines.push({ timeMs, ...parsed })
    }
  }

  // A file containing only timing markers is still an empty source, so source
  // fallback can continue. Retain blanks when they delimit actual lyric text.
  if (!lines.some((entry) => entry.text.trim())) lines.length = 0
  if (!lines.length && plainLines.length)
    lines.push(...plainLines.map((text) => ({ timeMs: 0, text, untimed: true })))
  return { metadata, lines }
}

function parseYrcTrack(source: string): ParsedLrcTrack {
  const metadata = emptyMetadata()
  const lines: LyricLine[] = []
  let wordCount = 0

  for (const rawLine of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (lines.length >= MAX_LYRIC_LINES || wordCount >= MAX_LYRIC_WORDS) break
    const match = rawLine.trim().match(YRC_LINE_TAG)
    if (!match) continue
    const timeMs = Number(match[1])
    const durationMs = Number(match[2])
    if (!Number.isFinite(timeMs) || !Number.isFinite(durationMs) || timeMs < 0 || durationMs < 0)
      continue

    const words: LyricWord[] = []
    for (const token of match[3].matchAll(YRC_WORD_TAG)) {
      if (wordCount >= MAX_LYRIC_WORDS) break
      const rawStart = Number(token[1])
      const wordDuration = Number(token[2])
      const text = token[3]
      if (!text || !Number.isFinite(rawStart) || !Number.isFinite(wordDuration)) continue
      const startMs = rawStart < timeMs ? timeMs + rawStart : rawStart
      words.push({ text, startMs, endMs: Math.max(startMs + 1, startMs + wordDuration) })
      wordCount += 1
    }
    const text =
      words.map((word) => word.text).join('') || match[3].replace(YRC_WORD_TAG, '').trim()
    YRC_WORD_TAG.lastIndex = 0
    if (text)
      lines.push({
        timeMs,
        endMs: Math.max(timeMs + 1, timeMs + durationMs),
        text,
        words: words.length ? words : undefined
      })
  }
  return { metadata, lines }
}

function parseTtmlTime(value: string | null): number | null {
  if (!value) return null
  const normalized = value.trim()
  const offset = normalized.match(/^([\d.]+)(ms|s)$/i)
  if (offset) {
    const amount = Number(offset[1])
    if (!Number.isFinite(amount)) return null
    return Math.round(offset[2].toLowerCase() === 'ms' ? amount : amount * 1000)
  }
  const parts = normalized.split(':')
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part)))
    return null
  const seconds = Number(parts.pop())
  const minutes = Number(parts.pop())
  const hours = parts.length ? Number(parts.pop()) : 0
  const total = (hours * 3600 + minutes * 60 + seconds) * 1000
  return Number.isFinite(total) && total >= 0 ? Math.round(total) : null
}

function parseTtmlTrack(source: string): ParsedLrcTrack {
  const metadata = emptyMetadata()
  const lines: LyricLine[] = []
  let wordCount = 0
  if (source.length > MAX_LYRIC_CONTENT_LENGTH || typeof DOMParser === 'undefined')
    return { metadata, lines }

  const xml = new DOMParser().parseFromString(source, 'application/xml')
  if (xml.querySelector('parsererror')) return { metadata, lines }

  for (const paragraph of Array.from(xml.getElementsByTagName('p'))) {
    if (lines.length >= MAX_LYRIC_LINES) break
    const startMs = parseTtmlTime(paragraph.getAttribute('begin'))
    if (startMs === null) continue
    const explicitEnd = parseTtmlTime(paragraph.getAttribute('end'))
    const duration = parseTtmlTime(paragraph.getAttribute('dur'))
    const words = Array.from(paragraph.getElementsByTagName('span')).flatMap((span) => {
      if (wordCount >= MAX_LYRIC_WORDS) return []
      const wordStart = parseTtmlTime(span.getAttribute('begin'))
      const wordEnd = parseTtmlTime(span.getAttribute('end'))
      const wordDuration = parseTtmlTime(span.getAttribute('dur'))
      const text = span.textContent?.replace(/\s+/g, ' ').trim() || ''
      if (!text || wordStart === null) return []
      wordCount += 1
      return [
        {
          text,
          startMs: wordStart,
          endMs: Math.max(wordStart + 1, wordEnd ?? wordStart + (wordDuration ?? 0))
        }
      ]
    })
    const text = paragraph.textContent?.replace(/\s+/g, ' ').trim() || ''
    if (!text) continue
    lines.push({
      timeMs: startMs,
      endMs: explicitEnd ?? (duration === null ? undefined : startMs + duration),
      text,
      words: words.length ? words : undefined
    })
  }
  return { metadata, lines }
}

function findTrackLine(track: LyricLine[], timeMs: number): LyricLine | undefined {
  let closest: LyricLine | undefined
  let difference = Number.POSITIVE_INFINITY
  for (const line of track) {
    const distance = Math.abs(line.timeMs - timeMs)
    if (distance < difference) {
      closest = line
      difference = distance
    }
  }
  return difference <= 30 ? closest : undefined
}

function finalizeWordTiming(lines: LyricLine[]): LyricLine[] {
  const sorted = [...lines].sort((left, right) => left.timeMs - right.timeMs)
  return sorted.map((line, index) => {
    const nextLineStart = sorted[index + 1]?.timeMs
    const lastWordStart = line.words?.at(-1)?.startMs ?? line.timeMs
    const inferredEnd = Math.max(line.timeMs + 300, lastWordStart + 300)
    const endMs = Math.max(line.timeMs + 1, line.endMs ?? nextLineStart ?? inferredEnd)
    const words = line.words?.map((word, wordIndex, allWords) => ({
      ...word,
      endMs: Math.max(
        word.startMs + 1,
        word.endMs > word.startMs ? word.endMs : (allWords[wordIndex + 1]?.startMs ?? endMs)
      )
    }))
    const chars = words?.flatMap((word) => {
      const glyphs = Array.from(word.text)
      const duration = Math.max(1, (word.endMs - word.startMs) / Math.max(1, glyphs.length))
      return glyphs.map((char, charIndex) => ({
        char,
        start: Math.round(word.startMs + duration * charIndex),
        duration: Math.max(1, Math.round(duration))
      }))
    })
    return { ...line, endMs, words, chars: chars?.length ? chars : undefined }
  })
}

function addRubySegments(line: LyricLine): LyricLine {
  if (!line.words?.length || !line.romanizationWords?.length || !line.chars?.length) return line

  let characterIndex = 0
  const segments: LyricRubySegment[] = []
  for (const word of line.words) {
    const characterCount = Array.from(word.text).length
    const chars = line.chars.slice(characterIndex, characterIndex + characterCount)
    characterIndex += characterCount
    const romanWords = line.romanizationWords.filter(
      (romanWord) => romanWord.startMs < word.endMs && romanWord.endMs > word.startMs
    )
    if (!chars.length || !romanWords.length) return line
    segments.push({
      text: word.text,
      romanization: romanWords.map((romanWord) => romanWord.text).join(''),
      chars
    })
  }
  return segments.length ? { ...line, rubySegments: segments } : line
}

function parsePlainLyrics(content: string): LyricDocument {
  const lines = content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_LYRIC_LINES)
  return {
    format: 'plain',
    metadata: emptyMetadata(),
    lines: lines.map((text) => ({ timeMs: 0, text, untimed: true }))
  }
}

export function parseLyrics(payload: LyricPayload): LyricDocument {
  const format = payload.format || detectLyricFormat(payload.content)
  if (payload.content.length > MAX_LYRIC_CONTENT_LENGTH)
    return { format, metadata: emptyMetadata(), lines: [] }
  if (format === 'plain') return parsePlainLyrics(payload.content)

  const parseTrack = (content: string, trackFormat?: LyricFormat): ParsedLrcTrack => {
    const resolvedFormat = trackFormat || detectLyricFormat(content)
    if (resolvedFormat === 'yrc') return parseYrcTrack(content)
    if (resolvedFormat === 'ttml') return parseTtmlTrack(content)
    return parseLrcTrack(content)
  }
  const main = parseTrack(payload.content, format)
  const translation = payload.translation
    ? parseTrack(payload.translation.content, payload.translation.format)
    : undefined
  const romanization = payload.romanization
    ? parseTrack(payload.romanization.content, payload.romanization.format)
    : undefined
  const offsetTrack = (track: ParsedLrcTrack, offsetMs: number): LyricLine[] =>
    track.lines.map((line) => ({
      ...line,
      timeMs: line.timeMs + offsetMs,
      words: line.words?.map((word) => ({
        ...word,
        startMs: word.startMs + offsetMs,
        endMs: word.endMs + offsetMs
      }))
    }))
  const mainLines = offsetTrack(main, main.metadata.offsetMs)
  const translationLines = translation
    ? finalizeWordTiming(
        offsetTrack(translation, main.metadata.offsetMs + translation.metadata.offsetMs)
      )
    : undefined
  const romanizationLines = romanization
    ? finalizeWordTiming(
        offsetTrack(romanization, main.metadata.offsetMs + romanization.metadata.offsetMs)
      )
    : undefined
  const lines = mainLines.map((line) => {
    const translationLine = translationLines
      ? findTrackLine(translationLines, line.timeMs)
      : undefined
    const romanizationLine = romanizationLines
      ? findTrackLine(romanizationLines, line.timeMs)
      : undefined
    return {
      ...line,
      translation: translationLine?.text,
      romanization: romanizationLine?.text,
      romanizationWords: romanizationLine?.words
    }
  })
  return {
    format,
    metadata: main.metadata,
    lines: finalizeWordTiming(lines).map(addRubySegments)
  }
}

/** @deprecated Use parseLyrics() with a LyricPayload for new integrations. */
export function parseLrc(source: string, translation?: string | null): LyricLine[] {
  return parseLyrics({
    content: source,
    translation: translation ? { content: translation, format: 'lrc' } : undefined,
    source: 'database'
  }).lines
}

export async function resolveLyrics(
  song: {
    id: number
    audio: string
    title?: string
    artist?: string | null
    album?: string | null
  },
  order: LyricSource[],
  forcedSource: LyricSource | 'auto' = 'auto',
  allowAutoNetworkSearch = true
): Promise<{
  lines: LyricLine[]
  source: LyricSource | null
  content?: string
  format?: LyricFormat
  translation?: string
  translationFormat?: LyricFormat
  romanization?: string
  romanizationFormat?: LyricFormat
}> {
  const sourceOrder =
    forcedSource === 'auto'
      ? [
          ...order.filter((source) => source !== 'network'),
          ...(allowAutoNetworkSearch && order.includes('network') ? ['network' as const] : [])
        ]
      : [forcedSource]
  for (const source of sourceOrder) {
    let lrc: string | null | undefined
    let format: LyricFormat | undefined
    let translation: string | null | undefined
    let translationFormat: LyricFormat | undefined
    let romanization: string | null | undefined
    let romanizationFormat: LyricFormat | undefined
    if (source === 'database') {
      const response = await window.api.database.command('getSong', { id: song.id })
      const data = response.success
        ? (response.data as {
            lrc?: string | null
            lyricFormat?: unknown
            translation?: string | null
            translationFormat?: unknown
            romanization?: string | null
            romanizationFormat?: unknown
          })
        : null
      lrc = data?.lrc
      format = isLyricFormat(data?.lyricFormat) ? data.lyricFormat : undefined
      translation = data?.translation
      translationFormat = isLyricFormat(data?.translationFormat)
        ? data.translationFormat
        : undefined
      romanization = data?.romanization
      romanizationFormat = isLyricFormat(data?.romanizationFormat)
        ? data.romanizationFormat
        : undefined
    } else if (source === 'network') {
      // Network lookup is intentionally only an automatic fallback. Manual
      // searches are handled by the lyrics manager and require saving first.
      if (forcedSource !== 'auto' || !allowAutoNetworkSearch) continue
      const response = await window.api.lyrics.searchNetwork({
        title: song.title || '',
        artist: song.artist,
        album: song.album
      })
      const candidate = response.success ? response.data?.[0] : null
      if (!candidate) continue
      lrc = candidate.lrc
      format = candidate.format
      translation = candidate.translation
      translationFormat = 'lrc'
      romanization = candidate.romanization
      romanizationFormat = 'lrc'
      // Automatic lookup deliberately accepts the first match and caches it.
      await window.api.database.command('updateSongLyrics', {
        id: song.id,
        lrc,
        lyricFormat: format,
        translation,
        translationFormat,
        romanization,
        romanizationFormat
      })
    } else {
      const response = await window.api.lyrics.loadSource(song.audio, source)
      lrc = response.success ? response.data?.content : null
      format = response.success ? response.data?.format : undefined
    }
    if (!lrc) continue
    const lines = parseLyrics({
      content: lrc,
      format,
      translation: translation ? { content: translation, format: translationFormat } : undefined,
      romanization: romanization
        ? { content: romanization, format: romanizationFormat }
        : undefined,
      source
    }).lines
    if (lines.length)
      return {
        lines,
        source,
        content: lrc,
        format,
        translation: translation || undefined,
        translationFormat,
        romanization: romanization || undefined,
        romanizationFormat
      }
  }
  return { lines: [], source: null }
}
