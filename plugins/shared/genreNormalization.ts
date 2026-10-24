import { genreMatchKey } from '../../src/shared/metadataValues'
import { NETEASE_GENRE_NAMES } from './data/neteaseGenreNames'

// Stable project spellings. Avoid slashes, which the library treats as separate genre values.
const canonicalOverrides: Readonly<Record<string, string>> = {
  日本流行: 'Jpop',
  华语流行: 'Cpop',
  KPop: 'Kpop',
  泰国流行: 'Tpop',
  'R&B': 'R&B',
  嘻哈说唱: 'Hip Hop',
  地域说唱: 'Regional Hip Hop',
  拉丁饶舌: 'Latin Hip Hop',
  '另类/独立': 'Alternative & Indie',
  '广播剧/音声': 'Drama & Voice'
}

const aliases = new Map<string, string>()
for (const [original, english] of Object.entries(NETEASE_GENRE_NAMES)) {
  const canonical = canonicalOverrides[original] ?? english
  for (const name of [original, english, canonical]) aliases.set(genreMatchKey(name), canonical)
}
// Recognize common alternate spellings without guessing translations of unknown names.
for (const [name, canonical] of Object.entries({
  'J pop': 'Jpop',
  'K-Pop': 'Kpop',
  'K pop': 'Kpop',
  韩国流行: 'Kpop',
  韩语流行: 'Kpop',
  'C pop': 'Cpop',
  'T pop': 'Tpop'
}))
  aliases.set(genreMatchKey(name), canonical)
const prefixes = [...aliases.keys()].sort((left, right) => right.length - left.length)

/** Normalize a source genre while retaining hierarchical labels such as Pop-Jpop. */
export function normalizeSourceGenreName(input: string): string {
  let remainder = input.trim().normalize('NFC')
  const output: string[] = []
  while (remainder) {
    const key = genreMatchKey(remainder)
    const exact = aliases.get(key)
    if (exact) {
      output.push(exact)
      break
    }
    // Match full known names first: the hyphen in J-Pop or J-Rock is part of an alias.
    const prefix = prefixes.find(
      (name) => key.startsWith(name) && /^\s*-/.test(remainder.slice(name.length))
    )
    if (prefix) {
      output.push(aliases.get(prefix)!)
      remainder = remainder.slice(prefix.length).trimStart().slice(1).trimStart()
    } else {
      const boundary = remainder.indexOf('-')
      if (boundary < 0) {
        output.push(remainder)
        break
      }
      output.push(remainder.slice(0, boundary).trimEnd())
      remainder = remainder.slice(boundary + 1).trimStart()
    }
  }
  return output.join('-')
}

/** Deduplicate after normalization so Chinese and English aliases yield a single candidate. */
export function normalizeSourceGenreNames(values: readonly string[]): string[] {
  const names = new Map<string, string>()
  for (const value of values) {
    const name = normalizeSourceGenreName(value)
    if (name && !names.has(genreMatchKey(name))) names.set(genreMatchKey(name), name)
  }
  return [...names.values()]
}
