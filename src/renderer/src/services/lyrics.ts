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
  agentIds?: string[]
  roles?: string[]
  language?: string
}

export interface LyricDocument {
  format: LyricFormat
  metadata: {
    title?: string
    artist?: string
    album?: string
    offsetMs: number
  }
  agents?: LyricAgent[]
  lines: LyricLine[]
}

export interface LyricAgent {
  id: string
  name?: string
  type?: 'person' | 'character' | 'group' | 'organization' | 'other'
}

export type LyricVocalPosition = 'left' | 'right' | 'center'
export type LyricTrackKind = 'main' | 'background' | 'translation' | 'romanization' | 'other'

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
  /** TTML metadata retained for multi-singer and profile-specific rendering. */
  agentIds?: string[]
  agents?: LyricAgent[]
  roles?: string[]
  language?: string
  trackId?: string
  trackKind?: LyricTrackKind
  vocalPosition?: LyricVocalPosition
  isChorus?: boolean
  isBackground?: boolean
}

export interface LyricChar {
  char: string
  start: number
  duration: number
  agentIds?: string[]
  roles?: string[]
  language?: string
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
  agents?: LyricAgent[]
  lines: LyricLine[]
  embeddedTranslationLines?: LyricLine[]
  embeddedRomanizationLines?: LyricLine[]
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
    const next = tokens[index + 1]
    const nextStartMs = next ? parseTimestamp(next[1], next[2]) : null
    return startMs === null || !text
      ? []
      : [
          {
            text,
            startMs,
            endMs: nextStartMs !== null ? Math.max(startMs + 1, nextStartMs) : startMs
          }
        ]
  })
  return { text: words.map((word) => word.text).join(''), words }
}

function parseElrcDirective(
  content: string
): Pick<
  LyricLine,
  'agentIds' | 'agents' | 'roles' | 'trackKind' | 'vocalPosition' | 'isChorus' | 'isBackground'
> & { content: string } {
  const wrapped = content.match(/^\[(bg|v1|v2|group):([\s\S]*)\]$/i)
  const prefixed = wrapped ? null : content.match(/^\[(bg|v1|v2|group):\]([\s\S]*)$/i)
  const directive = (wrapped?.[1] || prefixed?.[1])?.toLowerCase()
  const resolvedContent = wrapped?.[2] ?? prefixed?.[2] ?? content
  if (!directive) return { content }
  if (directive === 'bg') {
    return {
      content: resolvedContent,
      roles: ['x-bg'],
      trackKind: 'background',
      isBackground: true
    }
  }
  if (directive === 'group') {
    const agent: LyricAgent = { id: 'group', name: 'group', type: 'group' }
    return {
      content: resolvedContent,
      agentIds: [agent.id],
      agents: [agent],
      trackKind: 'main',
      vocalPosition: 'center',
      isChorus: true
    }
  }
  const agent: LyricAgent = { id: directive, name: directive, type: 'person' }
  return {
    content: resolvedContent,
    agentIds: [agent.id],
    agents: [agent],
    trackKind: 'main',
    vocalPosition: directive === 'v1' ? 'left' : 'right'
  }
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
    const { content: directiveContent, ...lineSemantics } = parseElrcDirective(content)
    const parsedWords = parseEnhancedWords(directiveContent)
    const parsed = {
      ...parsedWords,
      words: parsedWords.words?.map((word) => ({
        ...word,
        agentIds: lineSemantics.agentIds,
        roles: lineSemantics.roles
      }))
    }
    // Timestamp-only entries mark instrumental breaks and must retain timing.
    for (const stamp of stamps) {
      const timeMs = parseTimestamp(stamp[1], stamp[2])
      if (timeMs !== null) lines.push({ timeMs, ...parsed, ...lineSemantics })
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

interface TtmlTimeParameters {
  frameRate: number
  subFrameRate: number
  tickRate: number
}

const DEFAULT_TTML_TIME_PARAMETERS: TtmlTimeParameters = {
  frameRate: 30,
  subFrameRate: 1,
  tickRate: 1
}

function parseTtmlTime(
  value: string | null,
  parameters: TtmlTimeParameters = DEFAULT_TTML_TIME_PARAMETERS
): number | null {
  if (!value) return null
  const normalized = value.trim()
  const offset = normalized.match(/^([\d.]+)(ms|h|m|s|f|t)$/i)
  if (offset) {
    const amount = Number(offset[1])
    if (!Number.isFinite(amount)) return null
    const metric = offset[2].toLowerCase()
    const milliseconds =
      metric === 'ms'
        ? amount
        : metric === 'h'
          ? amount * 3_600_000
          : metric === 'm'
            ? amount * 60_000
            : metric === 'f'
              ? (amount / parameters.frameRate) * 1000
              : metric === 't'
                ? (amount / parameters.tickRate) * 1000
                : amount * 1000
    return Math.round(milliseconds)
  }
  const frameClock = normalized.match(/^(\d+):(\d{2}):(\d{2}):(\d+)(?:\.(\d+))?$/)
  if (frameClock) {
    const [, hours, minutes, seconds, frames, subFrames = '0'] = frameClock
    const frameValue = Number(frames) + Number(subFrames) / parameters.subFrameRate
    const total =
      (Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000 +
      (frameValue / parameters.frameRate) * 1000
    return Number.isFinite(total) && total >= 0 ? Math.round(total) : null
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

function inferTrackKind(roles: string[]): LyricTrackKind {
  if (roles.some((role) => ['x-bg', 'x-background', 'x-background-vocal'].includes(role)))
    return 'background'
  if (roles.some((role) => ['x-translation', 'x-translated'].includes(role))) return 'translation'
  if (roles.some((role) => ['x-romanization', 'x-romanized'].includes(role))) return 'romanization'
  return roles.some((role) => role.startsWith('x-')) ? 'other' : 'main'
}

function parseTtmlTrack(source: string): ParsedLrcTrack {
  const metadata = emptyMetadata()
  const lines: LyricLine[] = []
  let wordCount = 0
  if (source.length > MAX_LYRIC_CONTENT_LENGTH || typeof DOMParser === 'undefined')
    return { metadata, lines }

  const xml = new DOMParser().parseFromString(source, 'application/xml')
  if (xml.querySelector('parsererror')) return { metadata, lines }

  const metadataNamespace = 'http://www.w3.org/ns/ttml#metadata'
  const parameterNamespace = 'http://www.w3.org/ns/ttml#parameter'
  const xmlNamespace = 'http://www.w3.org/XML/1998/namespace'
  const root = xml.documentElement
  const numericParameter = (name: string, fallback: number): number => {
    const raw = root.getAttributeNS(parameterNamespace, name) || root.getAttribute(`ttp:${name}`)
    const value = Number(raw)
    return Number.isFinite(value) && value > 0 ? value : fallback
  }
  const nominalFrameRate = numericParameter('frameRate', 30)
  const multiplierParts = (
    root.getAttributeNS(parameterNamespace, 'frameRateMultiplier') ||
    root.getAttribute('ttp:frameRateMultiplier') ||
    '1 1'
  )
    .trim()
    .split(/\s+/)
    .map(Number)
  const frameRateMultiplier =
    multiplierParts.length === 2 &&
    multiplierParts.every((part) => Number.isFinite(part) && part > 0)
      ? multiplierParts[0] / multiplierParts[1]
      : 1
  const subFrameRate = numericParameter('subFrameRate', 1)
  const explicitTickRate = numericParameter('tickRate', 0)
  const timeParameters: TtmlTimeParameters = {
    frameRate: nominalFrameRate * frameRateMultiplier,
    subFrameRate,
    tickRate:
      explicitTickRate ||
      (root.hasAttributeNS(parameterNamespace, 'frameRate') || root.hasAttribute('ttp:frameRate')
        ? nominalFrameRate * frameRateMultiplier * subFrameRate
        : 1)
  }
  const paragraphs = Array.from(xml.getElementsByTagNameNS('*', 'p'))
  const absoluteSpanParagraphs = new WeakSet<Element>()
  const hasVendorTimingAttribute = Array.from(root.attributes).some(
    (attribute) => attribute.localName === 'timing'
  )
  for (const paragraph of paragraphs) {
    const paragraphBegin = parseTtmlTime(paragraph.getAttribute('begin'), timeParameters)
    if (paragraphBegin === null || paragraphBegin <= 0) continue
    const firstTimedSpan = Array.from(paragraph.getElementsByTagNameNS('*', 'span')).find((span) =>
      span.hasAttribute('begin')
    )
    const firstSpanBegin = firstTimedSpan
      ? parseTtmlTime(firstTimedSpan.getAttribute('begin'), timeParameters)
      : null
    if (
      firstSpanBegin !== null &&
      (hasVendorTimingAttribute || Math.abs(firstSpanBegin - paragraphBegin) <= 2)
    )
      absoluteSpanParagraphs.add(paragraph)
  }

  interface TtmlInterval {
    begin: number
    end?: number
  }
  const intervalCache = new WeakMap<Element, TtmlInterval>()
  const timingElementNames = new Set(['tt', 'body', 'div', 'p', 'span', 'br'])
  const timingParent = (element: Element): Element | null => {
    let parent = element.parentElement
    while (parent && !timingElementNames.has(parent.localName)) parent = parent.parentElement
    return parent
  }
  const resolveInterval = (element: Element): TtmlInterval => {
    const cached = intervalCache.get(element)
    if (cached) return cached
    const parent = timingParent(element)
    if (!parent) {
      const rootInterval = { begin: 0 }
      intervalCache.set(element, rootInterval)
      return rootInterval
    }
    const parentInterval = resolveInterval(parent)
    const isSequential = parent.getAttribute('timeContainer')?.toLowerCase() === 'seq'
    let referenceBegin = parentInterval.begin
    if (isSequential) {
      let sibling = element.previousElementSibling
      while (sibling && !timingElementNames.has(sibling.localName))
        sibling = sibling.previousElementSibling
      if (sibling) {
        const previousInterval = resolveInterval(sibling)
        referenceBegin = previousInterval.end ?? previousInterval.begin
      }
    }
    const rawBegin = parseTtmlTime(element.getAttribute('begin'), timeParameters) ?? 0
    const paragraph = element.localName === 'span' ? element.closest('p') : null
    const usesAbsoluteSpanTime = paragraph ? absoluteSpanParagraphs.has(paragraph) : false
    const begin = usesAbsoluteSpanTime ? rawBegin : referenceBegin + rawBegin
    const rawEnd = parseTtmlTime(element.getAttribute('end'), timeParameters)
    const duration = parseTtmlTime(element.getAttribute('dur'), timeParameters)
    const explicitEnd =
      rawEnd === null ? undefined : usesAbsoluteSpanTime ? rawEnd : referenceBegin + rawEnd
    const durationEnd = duration === null ? undefined : begin + duration
    const ownEnd =
      explicitEnd !== undefined && durationEnd !== undefined
        ? Math.min(explicitEnd, durationEnd)
        : (explicitEnd ?? durationEnd)
    const end =
      ownEnd !== undefined && parentInterval.end !== undefined
        ? Math.min(ownEnd, parentInterval.end)
        : (ownEnd ?? parentInterval.end)
    const interval = { begin, end }
    intervalCache.set(element, interval)
    return interval
  }
  const agentElements = Array.from(xml.getElementsByTagNameNS(metadataNamespace, 'agent'))
  const agents: LyricAgent[] = agentElements.flatMap((element) => {
    const id = element.getAttributeNS(xmlNamespace, 'id') || element.getAttribute('xml:id') || ''
    if (!id) return []
    const rawType = element.getAttribute('type')
    const type = ['person', 'character', 'group', 'organization', 'other'].includes(rawType || '')
      ? (rawType as LyricAgent['type'])
      : undefined
    const nameElement = element.getElementsByTagNameNS(metadataNamespace, 'name')[0]
    const name = nameElement?.textContent?.replace(/\s+/g, ' ').trim() || undefined
    return [{ id, name, type }]
  })
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]))
  const singerPositions = new Map<string, LyricVocalPosition>()

  const inheritedAttribute = (
    element: Element,
    namespace: string,
    localName: string,
    qualifiedName: string
  ): string | undefined => {
    let current: Element | null = element
    while (current) {
      const value =
        current.getAttributeNS(namespace, localName) || current.getAttribute(qualifiedName)
      if (value) return value
      current = current.parentElement
    }
    return undefined
  }

  const ownRoles = (element: Element): string[] =>
    (element.getAttributeNS(metadataNamespace, 'role') || element.getAttribute('ttm:role') || '')
      .split(/\s+/)
      .filter(Boolean)
  const isBackgroundElement = (element: Element): boolean =>
    inferTrackKind(ownRoles(element)) === 'background'
  const belongsToBackground = (element: Element, paragraph: Element): boolean => {
    let current: Element | null = element
    while (current && current !== paragraph) {
      if (isBackgroundElement(current)) return true
      current = current.parentElement
    }
    return false
  }
  const timedLeafSpans = (elements: Element[]): Element[] =>
    elements.filter(
      (element) =>
        element.hasAttribute('begin') &&
        !Array.from(element.getElementsByTagNameNS('*', 'span')).some(
          (descendant) => descendant !== element && descendant.hasAttribute('begin')
        )
    )
  const parseTimedSpans = (spans: Element[]): LyricWord[] =>
    timedLeafSpans(spans).flatMap((span) => {
      if (wordCount >= MAX_LYRIC_WORDS) return []
      const interval = resolveInterval(span)
      const wordStart = interval.begin
      const wordEnd = interval.end
      const text = span.textContent?.replace(/\s+/g, ' ') || ''
      if (!text.trim()) return []
      const agentIds = (inheritedAttribute(span, metadataNamespace, 'agent', 'ttm:agent') || '')
        .split(/\s+/)
        .filter(Boolean)
      const roles = (inheritedAttribute(span, metadataNamespace, 'role', 'ttm:role') || '')
        .split(/\s+/)
        .filter(Boolean)
      wordCount += 1
      return [
        {
          text,
          startMs: wordStart,
          endMs: Math.max(wordStart + 1, wordEnd ?? wordStart),
          agentIds: agentIds.length ? agentIds : undefined,
          roles: roles.length ? roles : undefined,
          language: inheritedAttribute(span, xmlNamespace, 'lang', 'xml:lang')
        }
      ]
    })
  const textWithoutBackground = (node: Node, root: Element): string => {
    if (node instanceof Element && node !== root && isBackgroundElement(node)) return ''
    if (node instanceof Element && node.localName === 'br') return '\n'
    return Array.from(node.childNodes)
      .map((child) =>
        child.nodeType === Node.TEXT_NODE
          ? child.textContent || ''
          : textWithoutBackground(child, root)
      )
      .join('')
  }

  for (const paragraph of paragraphs) {
    if (lines.length >= MAX_LYRIC_LINES) break
    const paragraphInterval = resolveInterval(paragraph)
    const startMs = paragraphInterval.begin
    const explicitEnd = paragraphInterval.end
    const paragraphSpans = Array.from(paragraph.getElementsByTagNameNS('*', 'span'))
    const nestedBackgroundRoots = paragraphSpans.filter(
      (span) =>
        isBackgroundElement(span) &&
        !belongsToBackground(span.parentElement || paragraph, paragraph)
    )
    const words = parseTimedSpans(
      paragraphSpans.filter((span) => !belongsToBackground(span, paragraph))
    )
    const text = textWithoutBackground(paragraph, paragraph)
      .replace(/[^\S\r\n]+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .trim()
    const agentIds = (inheritedAttribute(paragraph, metadataNamespace, 'agent', 'ttm:agent') || '')
      .split(/\s+/)
      .filter(Boolean)
    const resolvedAgents = agentIds.flatMap((id) => {
      const agent = agentsById.get(id)
      return agent ? [agent] : []
    })
    const roles = (inheritedAttribute(paragraph, metadataNamespace, 'role', 'ttm:role') || '')
      .split(/\s+/)
      .filter(Boolean)
    const trackKind = inferTrackKind(roles)
    const language = inheritedAttribute(paragraph, xmlNamespace, 'lang', 'xml:lang')
    const trackId = (() => {
      let current: Element | null = paragraph
      while (current) {
        if (current.localName === 'div')
          return (
            current.getAttributeNS(xmlNamespace, 'id') ||
            current.getAttribute('xml:id') ||
            undefined
          )
        current = current.parentElement
      }
      return undefined
    })()
    const isChorus =
      agentIds.length > 1 || resolvedAgents.some((agent) => agent.type === 'group') || undefined
    let vocalPosition: LyricVocalPosition | undefined
    if (isChorus) vocalPosition = 'center'
    else if (agentIds.length === 1) {
      const agentId = agentIds[0]
      vocalPosition = singerPositions.get(agentId)
      if (!vocalPosition) {
        vocalPosition = singerPositions.size % 2 === 0 ? 'left' : 'right'
        singerPositions.set(agentId, vocalPosition)
      }
    }
    if (text) {
      lines.push({
        timeMs: startMs,
        endMs: explicitEnd,
        text,
        words: words.length ? words : undefined,
        agentIds: agentIds.length ? agentIds : undefined,
        agents: resolvedAgents.length ? resolvedAgents : undefined,
        roles: roles.length ? roles : undefined,
        language,
        trackId,
        trackKind,
        vocalPosition,
        isChorus,
        isBackground: trackKind === 'background' || undefined
      })
    }
    for (const background of nestedBackgroundRoots) {
      if (lines.length >= MAX_LYRIC_LINES) break
      const backgroundText = background.textContent?.replace(/\s+/g, ' ').trim() || ''
      if (!backgroundText) continue
      const backgroundInterval = resolveInterval(background)
      const backgroundStart = backgroundInterval.begin
      const backgroundEnd = backgroundInterval.end
      const backgroundAgentIds = (
        inheritedAttribute(background, metadataNamespace, 'agent', 'ttm:agent') || ''
      )
        .split(/\s+/)
        .filter(Boolean)
      const backgroundAgents = backgroundAgentIds.flatMap((id) => {
        const agent = agentsById.get(id)
        return agent ? [agent] : []
      })
      const backgroundWords = parseTimedSpans([
        background,
        ...Array.from(background.getElementsByTagNameNS('*', 'span'))
      ])
      lines.push({
        timeMs: backgroundStart,
        endMs: backgroundEnd ?? explicitEnd,
        text: backgroundText,
        words: backgroundWords.length ? backgroundWords : undefined,
        agentIds: backgroundAgentIds.length ? backgroundAgentIds : undefined,
        agents: backgroundAgents.length ? backgroundAgents : undefined,
        roles: ownRoles(background),
        language: inheritedAttribute(background, xmlNamespace, 'lang', 'xml:lang'),
        trackId,
        trackKind: 'background',
        vocalPosition,
        isBackground: true
      })
    }
  }
  const embeddedTranslationLines = lines.filter((line) => line.trackKind === 'translation')
  const embeddedRomanizationLines = lines.filter((line) => line.trackKind === 'romanization')
  return {
    metadata,
    agents: agents.length ? agents : undefined,
    lines: lines.filter(
      (line) => line.trackKind !== 'translation' && line.trackKind !== 'romanization'
    ),
    embeddedTranslationLines: embeddedTranslationLines.length
      ? embeddedTranslationLines
      : undefined,
    embeddedRomanizationLines: embeddedRomanizationLines.length
      ? embeddedRomanizationLines
      : undefined
  }
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
    const lastWord = line.words?.at(-1)
    const lastWordStart = lastWord?.startMs ?? line.timeMs
    const explicitWordEnd =
      lastWord && lastWord.endMs > lastWord.startMs ? lastWord.endMs : undefined
    const inferredEnd = Math.max(line.timeMs + 300, explicitWordEnd ?? lastWordStart + 300)
    const fallbackEnd = explicitWordEnd ?? nextLineStart ?? inferredEnd
    const endMs = Math.max(line.timeMs + 1, line.endMs ?? fallbackEnd)
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
        duration: Math.max(1, Math.round(duration)),
        agentIds: word.agentIds,
        roles: word.roles,
        language: word.language
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
    : main.embeddedTranslationLines
      ? { metadata: emptyMetadata(), lines: main.embeddedTranslationLines }
      : undefined
  const romanization = payload.romanization
    ? parseTrack(payload.romanization.content, payload.romanization.format)
    : main.embeddedRomanizationLines
      ? { metadata: emptyMetadata(), lines: main.embeddedRomanizationLines }
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
    agents: main.agents,
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
