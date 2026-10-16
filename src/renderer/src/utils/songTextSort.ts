import { pinyin } from 'pinyin-pro'
import type { LibrarySong } from '@/types/library'

const kana = /[\p{Script=Hiragana}\p{Script=Katakana}]/u
export function songSortText(
  song: LibrarySong,
  field: 'title' | 'artist' | 'album' | 'fileName'
): string {
  const text = song[field] ?? ''
  const japaneseContext = [song.title, song.artist, song.album, song.fileName].some((value) =>
    kana.test((value ?? '').normalize('NFKC'))
  )
  // Pure Han alone is ambiguous; a kana-bearing field supplies Japanese context.
  return japaneseContext && song.sortReadings?.[field] ? song.sortReadings[field]! : text
}

/** Mix Chinese pinyin and Latin text in one alphabet, independent of the UI locale. */
export function createSongTextComparator(): (left: string, right: string) => number {
  const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })
  const keys = new Map<string, string>()
  function key(text: string): string {
    const cached = keys.get(text)
    if (cached !== undefined) return cached
    const normalized = text.normalize('NFKC').toLowerCase().trim()
    // Kana-bearing Japanese names should not be transliterated as Mandarin.
    const value =
      /\p{Script=Han}/u.test(normalized) &&
      !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(normalized)
        ? pinyin(normalized, { toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('')
        : normalized
    // Retain keys across query refreshes, with a bound for long-lived list views.
    if (keys.size >= 50_000) keys.delete(keys.keys().next().value!)
    keys.set(text, value)
    return value
  }
  return (left, right) => collator.compare(key(left), key(right))
}
