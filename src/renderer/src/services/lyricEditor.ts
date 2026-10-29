import { detectLyricFormat, isLyricFormat, type LyricFormat } from './lyrics'

export const lyricTracks = ['lyric', 'translation', 'romanization'] as const
export type LyricTrack = (typeof lyricTracks)[number]
export interface EditorTrack {
  content: string
  format: LyricFormat
}
export interface LyricEditorDraft {
  lyric: EditorTrack
  translation: EditorTrack
  romanization: EditorTrack
  offsetMs: number | null
}
export function editorTrack(content: string | null | undefined, format?: unknown): EditorTrack {
  return {
    content: content || '',
    format: isLyricFormat(format) ? format : content ? detectLyricFormat(content) : 'lrc'
  }
}
export function emptyLyricDraft(): LyricEditorDraft {
  return {
    lyric: editorTrack(''),
    translation: editorTrack(''),
    romanization: editorTrack(''),
    offsetMs: null
  }
}
function clone(draft: LyricEditorDraft): LyricEditorDraft {
  return {
    ...draft,
    ...Object.fromEntries(lyricTracks.map((track) => [track, { ...draft[track] }]))
  }
}
export function sameLyricDraft(a: LyricEditorDraft, b: LyricEditorDraft): boolean {
  return (
    a.offsetMs === b.offsetMs &&
    lyricTracks.every(
      (track) => a[track].content === b[track].content && a[track].format === b[track].format
    )
  )
}
/** Snapshot all three tracks together, so bulk operations undo as one action. */
export class LyricEditorHistory {
  private snapshots: LyricEditorDraft[]
  private cursor = 0
  private group = ''
  private editedAt = 0
  constructor(initial: LyricEditorDraft) {
    this.snapshots = [clone(initial)]
  }
  get current(): LyricEditorDraft {
    return clone(this.snapshots[this.cursor])
  }
  get canUndo(): boolean {
    return this.cursor > 0
  }
  get canRedo(): boolean {
    return this.cursor < this.snapshots.length - 1
  }
  commit(next: LyricEditorDraft, group = ''): LyricEditorDraft {
    if (sameLyricDraft(next, this.snapshots[this.cursor])) return this.current
    const now = Date.now()
    const combine =
      !!group &&
      group === this.group &&
      now - this.editedAt < 700 &&
      this.cursor > 0 &&
      !this.canRedo
    this.snapshots.splice(this.cursor + 1)
    if (combine) this.snapshots[this.cursor] = clone(next)
    else {
      this.snapshots.push(clone(next))
      this.cursor++
    }
    this.group = group
    this.editedAt = now
    // Strings are immutable; cap both the number and approximate retained bytes.
    let bytes = this.snapshots.reduce(
      (sum, draft) =>
        sum + lyricTracks.reduce((size, track) => size + draft[track].content.length * 2, 0),
      0
    )
    while (this.snapshots.length > 2 && (this.snapshots.length > 100 || bytes > 12_000_000)) {
      const removed = this.snapshots.shift()!
      bytes -= lyricTracks.reduce((sum, track) => sum + removed[track].content.length * 2, 0)
      this.cursor--
    }
    return this.current
  }
  undo(): LyricEditorDraft {
    this.group = ''
    if (this.canUndo) this.cursor--
    return this.current
  }
  redo(): LyricEditorDraft {
    this.group = ''
    if (this.canRedo) this.cursor++
    return this.current
  }
}

export interface LyricEditorRecord {
  key: string
  track: LyricTrack
  start: number
  end: number
  raw: string
  text: string
  timeMs: number | null
  metadata: boolean
  ordinal: number
}
export interface LyricEditorRow {
  key: string
  timeMs: number | null
  metadata: boolean
  ordinal: number
  cells: Record<LyricTrack, LyricEditorRecord[]>
}
export function lyricTimeLabel(timeMs: number): string {
  const value = Math.abs(Math.round(timeMs))
  return `${timeMs < 0 ? '-' : ''}${String(Math.floor(value / 60_000)).padStart(2, '0')}:${String(Math.floor(value / 1000) % 60).padStart(2, '0')}.${String(value % 1000).padStart(3, '0')}`
}
function clockTime(value: string | null, frameRate = 30, tickRate = 1): number {
  if (!value) return 0
  const unit = value.match(/^([\d.]+)(ms|h|m|s|f|t)$/)
  if (unit)
    return (
      Number(unit[1]) *
      ({ ms: 1, h: 3_600_000, m: 60_000, s: 1000, f: 1000 / frameRate, t: 1000 / tickRate }[
        unit[2]
      ] ?? 0)
    )
  const parts = value.split(':').map(Number)
  if (parts.some((part) => !Number.isFinite(part))) return 0
  if (parts.length === 4)
    return (parts[0] * 3600 + parts[1] * 60 + parts[2] + parts[3] / frameRate) * 1000
  return parts.reduce((seconds, part) => seconds * 60 + part, 0) * 1000
}
function ttmlRecords(track: LyricTrack, content: string): LyricEditorRecord[] {
  const document = new DOMParser().parseFromString(content, 'application/xml')
  const elements = Array.from(document.getElementsByTagNameNS('*', 'p'))
  const root = document.documentElement
  const frameRate = Number(root?.getAttribute('ttp:frameRate')) || 30
  const tickRate = Number(root?.getAttribute('ttp:tickRate')) || 1
  const masked = content.replace(/<!--[\s\S]*?-->/g, (comment) => ' '.repeat(comment.length))
  const records: LyricEditorRecord[] = []
  let end = 0,
    paragraphIndex = 0
  function add(start: number, finish: number, element?: Element): void {
    const raw = content.slice(start, finish)
    if (!raw.trim()) return
    let timeMs: number | null = null
    if (element) {
      timeMs = 0
      for (
        let parent: Element | null = element;
        parent;
        parent = parent.parentNode?.nodeType === 1 ? (parent.parentNode as Element) : null
      )
        timeMs += clockTime(parent.getAttribute('begin'), frameRate, tickRate)
      if (!element.hasAttribute('begin')) {
        const starts = Array.from(element.getElementsByTagNameNS('*', 'span'))
          .filter((span) => span.hasAttribute('begin'))
          .map((span) => clockTime(span.getAttribute('begin'), frameRate, tickRate))
        if (starts.length) timeMs += Math.min(...starts)
      }
    }
    records.push({
      key: `${track}:${start}`,
      track,
      start,
      end: finish,
      raw,
      text: element?.textContent || raw,
      timeMs,
      metadata: !element,
      ordinal: records.length
    })
  }
  for (const match of masked.matchAll(
    /<(?:[\w.-]+:)?p(?=[\s>])[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?p\s*>/g
  )) {
    add(end, match.index!)
    end = match.index! + match[0].length
    add(match.index!, end, elements[paragraphIndex++])
  }
  add(end, content.length)
  return records
}
export function lyricEditorRecords(track: LyricTrack, value: EditorTrack): LyricEditorRecord[] {
  if (value.format === 'ttml') return ttmlRecords(track, value.content)
  const offset = Number(value.content.match(/^\s*\[offset:([+-]?\d+)\]/im)?.[1] || 0)
  const records: LyricEditorRecord[] = []
  let ordinal = 0
  let sourceLine = 0
  let previousEnd = 0
  for (const match of value.content.matchAll(/[^\r\n]+/g)) {
    const raw = match[0]
    sourceLine += (value.content.slice(previousEnd, match.index).match(/\r\n|\r|\n/g) || []).length
    previousEnd = match.index! + raw.length
    if (!raw.trim()) continue
    let timeMs: number | null = null
    let repeatTimes: number[] = []
    let text = raw
    const metadata = value.format !== 'plain' && /^\s*\[[a-z][\w-]*:/i.test(raw)
    if (value.format !== 'plain') {
      const wordTime = raw.match(/^\s*\[(\d+),(\d+)\]/)
      const lineTime = raw.match(/\[(\d+):(\d{1,2}(?:[.:]\d{1,3})?)\]/)
      if (wordTime) timeMs = Number(wordTime[1]) + offset
      else if (lineTime) {
        repeatTimes = [
          ...new Set(
            [...raw.matchAll(/\[(\d+):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)].map((tag) =>
              Math.round(Number(tag[1]) * 60_000 + Number(tag[2].replace(':', '.')) * 1000 + offset)
            )
          )
        ]
        timeMs = repeatTimes[0]
      }
      text = raw
        .replace(/^\s*(?:\[\d+:[\d.:]+\]|\[\d+,\d+\])+/g, '')
        .replace(/<\d+:[\d.:]+>|\(\d+,\d+,\d+\)|<\d+,\d+,\d+>/g, '')
    }
    records.push({
      key: `${track}:${match.index}`,
      track,
      start: match.index!,
      end: match.index! + raw.length,
      raw,
      text,
      timeMs,
      metadata,
      ordinal: value.format === 'plain' ? sourceLine : ordinal
    })
    // A single source line can repeat at several timestamps; every occurrence
    // edits the same raw range rather than rewriting or duplicating the source.
    const record = records[records.length - 1]
    for (const repeatTime of repeatTimes.slice(1)) records.push({ ...record, timeMs: repeatTime })
    if (!metadata) ordinal++
  }
  return records
}
export function lyricEditorRows(draft: LyricEditorDraft): LyricEditorRow[] {
  const rows = new Map<string, LyricEditorRow>()
  const mainOffset =
    draft.lyric.format === 'plain'
      ? 0
      : Number(draft.lyric.content.match(/^\s*\[offset:([+-]?\d+)\]/im)?.[1] || 0)
  for (const track of lyricTracks)
    for (const record of lyricEditorRecords(track, draft[track])) {
      if (track !== 'lyric' && record.timeMs != null) record.timeMs += mainOffset
      const key = record.metadata
        ? 'metadata'
        : record.timeMs == null
          ? `plain:${record.ordinal}`
          : `time:${record.timeMs}`
      let row = rows.get(key)
      if (!row) {
        row = {
          key,
          timeMs: record.timeMs,
          metadata: record.metadata,
          ordinal: record.ordinal,
          cells: { lyric: [], translation: [], romanization: [] }
        }
        rows.set(key, row)
      }
      row.cells[track].push(record)
    }
  return [...rows.values()].sort(
    (a, b) =>
      Number(b.metadata) - Number(a.metadata) ||
      (a.timeMs ?? Infinity) - (b.timeMs ?? Infinity) ||
      a.ordinal - b.ordinal
  )
}
export function editLyricRecord(
  track: EditorTrack,
  record: LyricEditorRecord,
  text: string
): EditorTrack {
  return {
    ...track,
    content: track.content.slice(0, record.start) + text + track.content.slice(record.end)
  }
}
export function appendLyricLine(
  track: EditorTrack,
  timeMs: number | null,
  text: string
): EditorTrack {
  if (!text.trim()) return track
  const offset = Number(track.content.match(/^\s*\[offset:([+-]?\d+)\]/im)?.[1] || 0)
  const time = Math.max(0, (timeMs ?? 0) - offset)
  if (track.format === 'ttml') {
    const escape = (value: string): string =>
      value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    const closing = [...track.content.matchAll(/<\/((?:[\w.-]+:)?div)\s*>/g)].at(-1)
    const prefix = closing?.[1].includes(':') ? closing[1].split(':')[0] + ':' : ''
    const paragraph = `<${prefix}p begin="${time / 1000}s">${escape(text)}</${prefix}p>`
    if (closing)
      return {
        ...track,
        content:
          track.content.slice(0, closing.index) +
          paragraph +
          '\n' +
          track.content.slice(closing.index)
      }
    if (!track.content.trim())
      return {
        ...track,
        content: `<tt xmlns="http://www.w3.org/ns/ttml"><body><div>${paragraph}</div></body></tt>`
      }
    throw new Error('Cannot find a TTML paragraph container')
  }
  const line =
    track.format === 'plain'
      ? text
      : track.format === 'yrc' || track.format === 'krc'
        ? `[${time},5000]${text}`
        : `[${lyricTimeLabel(time)}]${text}`
  return {
    ...track,
    content: track.content + (track.content && !/[\r\n]$/.test(track.content) ? '\n' : '') + line
  }
}
function newlineOf(content: string): string {
  return content.match(/\r\n|\n|\r/)?.[0] || '\n'
}
function lineStart(content: string, index: number): number | undefined {
  if (index === 0) return 0
  let line = 0
  for (const match of content.matchAll(/\r\n|\r|\n/g))
    if (++line === index) return match.index! + match[0].length
  return undefined
}
function insertPlainLine(content: string, index: number, text: string): string {
  if (!content && index === 0) return text
  const start = lineStart(content, index)
  const newline = newlineOf(content)
  if (start !== undefined) return content.slice(0, start) + text + newline + content.slice(start)
  const lastLine = (content.match(/\r\n|\r|\n/g) || []).length
  return content + newline.repeat(Math.max(1, index - lastLine)) + text
}
export function fillPlainLyricLine(track: EditorTrack, index: number, text: string): EditorTrack {
  const start = lineStart(track.content, index)
  if (start === undefined) return { ...track, content: insertPlainLine(track.content, index, text) }
  const rest = track.content.slice(start)
  const length = rest.search(/[\r\n]/)
  const end = length < 0 ? track.content.length : start + length
  return { ...track, content: track.content.slice(0, start) + text + track.content.slice(end) }
}
function sourceLineRange(content: string, start: number, end: number): [number, number] {
  const trailing = content.slice(end).match(/^(?:\r\n|\r|\n)/)?.[0]
  return [start, end + (trailing?.length || 0)]
}
function insertTimedLine(
  track: EditorTrack,
  after: LyricEditorRow | null,
  timeMs: number,
  text: string
): { track: EditorTrack; start: number } {
  const records = lyricEditorRecords('lyric', track).filter((record) => !record.metadata)
  const selected = after?.cells.lyric.at(-1)
  const preceding = records
    .filter((record) => (record.timeMs ?? Infinity) < timeMs)
    .sort((a, b) => (a.timeMs ?? 0) - (b.timeMs ?? 0))
    .at(-1)
  const anchor = selected || preceding || records[0]
  const insertBefore = !selected && !preceding && !!anchor
  if (!anchor) {
    const next = appendLyricLine(track, timeMs, text)
    const record = lyricEditorRecords('lyric', next).find((record) => !record.metadata)!
    return { track: next, start: record.start }
  }
  const offset = Number(track.content.match(/^\s*\[offset:([+-]?\d+)\]/im)?.[1] || 0)
  let raw: string
  if (track.format === 'ttml') {
    const document = new DOMParser().parseFromString(track.content, 'application/xml')
    const root = document.documentElement
    const frameRate = Number(root.getAttribute('ttp:frameRate')) || 30
    const tickRate = Number(root.getAttribute('ttp:tickRate')) || 1
    const begin = anchor.raw.match(/^<[^>]*\sbegin\s*=\s*["']([^"']*)["']/)?.[1]
    const spans = [...anchor.raw.matchAll(/<[^>]*\sbegin\s*=\s*["']([^"']*)["']/g)].map((match) =>
      clockTime(match[1], frameRate, tickRate)
    )
    const ownTime = begin
      ? clockTime(begin, frameRate, tickRate)
      : spans.length
        ? Math.min(...spans)
        : 0
    const relative = timeMs - ((anchor.timeMs ?? 0) - ownTime)
    if (relative < 0) throw new Error('lyric-editor-no-gap')
    const prefix = anchor.raw.match(/^<([\w.-]+:)?p(?=[\s>])/)?.[1] || ''
    const escaped = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    raw = `<${prefix}p begin="${relative / 1000}s">${escaped}</${prefix}p>`
  } else {
    const time = Math.max(0, timeMs - offset)
    raw =
      track.format === 'yrc' || track.format === 'krc'
        ? `[${time},5000]${text}`
        : `[${lyricTimeLabel(time)}]${text}`
  }
  const position = insertBefore ? anchor.start : anchor.end
  const newline = newlineOf(track.content)
  const before = insertBefore ? '' : newline
  const tail = insertBefore ? newline : ''
  return {
    track: {
      ...track,
      content:
        track.content.slice(0, position) + before + raw + tail + track.content.slice(position)
    },
    start: position + before.length
  }
}
/** Insert one sentence without rewriting surrounding source timing or markup. */
export function insertLyricRow(
  draft: LyricEditorDraft,
  after: LyricEditorRow | null,
  text: string
): { draft: LyricEditorDraft; row: LyricEditorRow } {
  const next = clone(draft)
  const currentRows = lyricEditorRows(draft).filter((row) => !row.metadata)
  let start: number
  if (draft.lyric.format === 'plain') {
    const index = after ? after.ordinal + 1 : 0
    for (const track of lyricTracks) {
      if (!next[track].content.trim()) next[track].format = 'plain'
      if (next[track].format === 'plain')
        next[track].content = insertPlainLine(
          next[track].content,
          index,
          track === 'lyric' ? text : ''
        )
    }
    start = lineStart(next.lyric.content, index) ?? 0
  } else {
    const time =
      after?.timeMs ?? Number(draft.lyric.content.match(/^\s*\[offset:([+-]?\d+)\]/im)?.[1] || 0)
    const following = after
      ? currentRows.find((row) => row.timeMs != null && row.timeMs > time)
      : undefined
    const insertedTime = !after
      ? time
      : following?.timeMs != null
        ? Math.floor((time + following.timeMs) / 2)
        : time + 5000
    if (
      after &&
      (insertedTime <= time || (following?.timeMs != null && insertedTime >= following.timeMs))
    )
      throw new Error('lyric-editor-no-gap')
    const inserted = insertTimedLine(draft.lyric, after, insertedTime, text)
    next.lyric = inserted.track
    start = inserted.start
  }
  const updatedRows = lyricEditorRows(next).filter((row) => !row.metadata)
  const row = updatedRows.find((row) => row.cells.lyric.some((record) => record.start === start))
  if (!row || updatedRows.length <= currentRows.length) throw new Error('lyric-editor-no-gap')
  return { draft: next, row }
}
/** Delete every track at this time, while keeping other repeated time tags. */
export function deleteLyricRow(draft: LyricEditorDraft, row: LyricEditorRow): LyricEditorDraft {
  const next = clone(draft)
  const mainOffset =
    draft.lyric.format === 'plain'
      ? 0
      : Number(draft.lyric.content.match(/^\s*\[offset:([+-]?\d+)\]/im)?.[1] || 0)
  for (const track of lyricTracks) {
    const source = draft[track]
    if (row.timeMs == null && source.format === 'plain') {
      const start = lineStart(source.content, row.ordinal)
      if (start === undefined) continue
      const end = lineStart(source.content, row.ordinal + 1) ?? source.content.length
      next[track].content = source.content.slice(0, start) + source.content.slice(end)
      continue
    }
    const patches = new Map<number, { start: number; end: number; text: string }>()
    for (const record of row.cells[track]) {
      let replacement: string | null = null
      if (source.format === 'lrc' || source.format === 'elrc') {
        const offset =
          Number(source.content.match(/^\s*\[offset:([+-]?\d+)\]/im)?.[1] || 0) +
          (track === 'lyric' ? 0 : mainOffset)
        const tags = [...record.raw.matchAll(/\[(\d+):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)]
        const retained = tags.filter(
          (tag) =>
            Math.round(
              Number(tag[1]) * 60_000 + Number(tag[2].replace(':', '.')) * 1000 + offset
            ) !== row.timeMs
        )
        if (retained.length)
          replacement = record.raw.replace(
            /\[(\d+):(\d{1,2}(?:[.:]\d{1,3})?)\]/g,
            (tag, minutes, seconds) =>
              Math.round(
                Number(minutes) * 60_000 + Number(String(seconds).replace(':', '.')) * 1000 + offset
              ) === row.timeMs
                ? ''
                : tag
          )
      }
      const [start, end] =
        replacement !== null || source.format === 'ttml'
          ? [record.start, record.end]
          : sourceLineRange(source.content, record.start, record.end)
      patches.set(start, { start, end, text: replacement ?? '' })
    }
    for (const patch of [...patches.values()].sort((a, b) => b.start - a.start))
      next[track].content =
        next[track].content.slice(0, patch.start) +
        patch.text +
        next[track].content.slice(patch.end)
  }
  return next
}
export interface LyricEditorMatch {
  track: LyricTrack
  start: number
  end: number
}
export function findLyricMatches(
  draft: LyricEditorDraft,
  tracks: readonly LyricTrack[],
  search: string,
  caseSensitive: boolean
): LyricEditorMatch[] {
  if (!search) return []
  const expression = new RegExp(
    search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    caseSensitive ? 'g' : 'gi'
  )
  return tracks.flatMap((track) =>
    [...draft[track].content.matchAll(expression)].map((match) => ({
      track,
      start: match.index!,
      end: match.index! + match[0].length
    }))
  )
}
export function replaceLyricMatches(
  draft: LyricEditorDraft,
  matches: LyricEditorMatch[],
  replacement: string
): LyricEditorDraft {
  const result = clone(draft)
  for (const track of lyricTracks)
    for (const match of matches
      .filter((match) => match.track === track)
      .sort((a, b) => b.start - a.start)) {
      const content = result[track].content
      result[track].content = content.slice(0, match.start) + replacement + content.slice(match.end)
    }
  return result
}
