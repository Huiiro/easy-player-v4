import { pinyin } from 'pinyin-pro'

export const SEARCH_INDEX_VERSION = 3
export const READING_TOKEN = 'epreading'
export const FULL_READING_TOKEN = 'epfullreading'
export const INITIAL_TOKEN = 'epinitial'
export const FULL_INITIAL_TOKEN = 'epfullinitial'
export const KANA_TOKEN = 'epkana'
export const FULL_KANA_TOKEN = 'epfullkana'
/** Pick the first complete Japanese reading, skipping a preceding Mandarin alias. */
export function japaneseSortReading(terms: string, original: string): string | null {
  const basic = new Set(
    buildBasicSearchTerms({
      title: original,
      artist: null,
      album: null,
      fileName: null
    }).title.split(' ')
  )
  const readings = terms.split(' ').filter((term) => term.startsWith(FULL_READING_TOKEN))
  const japanese = readings.find((term) => !basic.has(term))
  return japanese ? japanese.slice(FULL_READING_TOKEN.length) : null
}
export const normalizeSearchText = (text: string): string =>
  text.normalize('NFKC').toLowerCase().trim()
export const splitSearchText = (text: string): string[] =>
  normalizeSearchText(text)
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter(Boolean)

export interface SearchFields {
  title: string
  artist: string | null
  album: string | null
  fileName: string | null
}

export type SearchTerms = Record<keyof SearchFields, string>

export function addSequence(
  terms: Set<string>,
  parts: string[],
  windowSize: number,
  full = true
): void {
  if (!parts.length) return
  terms.add(READING_TOKEN + parts.join(''))
  if (full) terms.add(FULL_READING_TOKEN + parts.join(''))
  const initials = parts.map((part) => Array.from(part)[0] ?? '')
  // Abbreviations match a complete reading sequence, never an arbitrary prefix.
  if (initials.length >= 2) terms.add(INITIAL_TOKEN + initials.join(''))
  if (full && initials.length >= 2) terms.add(FULL_INITIAL_TOKEN + initials.join(''))
  for (let start = 0; start < parts.length; start++) {
    for (let size = 1; size <= windowSize && start + size <= parts.length; size++)
      terms.add(READING_TOKEN + parts.slice(start, start + size).join(''))
  }
}

export function addTextTerms(terms: Set<string>, text: string): void {
  const normalized = normalizeSearchText(text).slice(0, 512)
  const parts = splitSearchText(normalized)
  for (const part of parts) terms.add(part)
  if (parts.length > 1) terms.add(parts.join(''))
  for (const match of normalized.matchAll(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu
  )) {
    const chars = Array.from(match[0])
    for (let start = 0; start < chars.length; start++)
      for (let size = 1; size <= 3 && start + size <= chars.length; size++)
        terms.add(chars.slice(start, start + size).join(''))
  }
  // Kana is a strong field-level Japanese cue: 綺麗 in a Japanese title reads
  // kirei, and must not also create the unrelated Mandarin alias qili.
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(normalized)) return
  for (const match of normalized.matchAll(/\p{Script=Han}+/gu)) {
    const syllables = pinyin(match[0], { toneType: 'none', type: 'array' })
    const entireField = normalized.replace(/[^\p{L}\p{N}]/gu, '') === match[0]
    addSequence(terms, syllables.map(normalizeSearchText).filter(Boolean), 6, entireField)
  }
}

export function buildBasicSearchTerms(fields: SearchFields): SearchTerms {
  const result = {} as SearchTerms
  for (const key of Object.keys(fields) as Array<keyof SearchFields>) {
    const terms = new Set<string>()
    addTextTerms(terms, fields[key] ?? '')
    result[key] = [...terms].join(' ')
  }
  return result
}
