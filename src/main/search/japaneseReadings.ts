import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import {
  addSequence,
  addTextTerms,
  buildBasicSearchTerms,
  normalizeSearchText,
  splitSearchText
} from './searchTokens'
import { KANA_TOKEN, FULL_KANA_TOKEN } from './searchTokens'
import type { SearchFields, SearchTerms } from './searchTokens'

const nodeRequire = createRequire(__filename)
const japanese = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
interface Romanizer {
  init(analyzer: unknown): Promise<void>
  convert(
    text: string,
    options: { to: string; mode: string; romajiSystem?: string }
  ): Promise<string>
}
let instance: Promise<Romanizer> | undefined
const cache = new Map<string, string[]>()

function romanizer(): Promise<Romanizer> {
  if (!instance) {
    instance = (async () => {
      const Kuroshiro = nodeRequire('kuroshiro').default
      const Analyzer = nodeRequire('kuroshiro-analyzer-kuromoji')
      const dict = join(dirname(nodeRequire.resolve('kuromoji/package.json')), 'dict').replace(
        /app\.asar([\\/])/u,
        'app.asar.unpacked$1'
      )
      const converter: Romanizer = new Kuroshiro()
      await converter.init(new (Analyzer.default ?? Analyzer)({ dictPath: dict }))
      return converter
    })().catch((error) => {
      instance = undefined
      throw error
    })
  }
  return instance
}

export function romajiVariants(text: string): string[] {
  const base = normalizeSearchText(text.normalize('NFKD').replace(/\p{M}/gu, ''))
    .replace(/<[^>]*>/gu, ' ')
    .replace(/['’]/gu, '')
  const variants = new Set([base])
  const particles: Record<string, string> = { ha: 'wa', he: 'e', wo: 'o' }
  variants.add(
    splitSearchText(base)
      .map((part) => particles[part] ?? part)
      .join(' ')
  )
  for (const value of [...variants]) variants.add(value.replace(/ou/gu, 'o').replace(/uu/gu, 'u'))
  return [...variants].filter(Boolean)
}

async function readings(text: string): Promise<string[]> {
  const key = normalizeSearchText(text).slice(0, 512)
  const remembered = cache.get(key)
  if (remembered) return remembered
  const converter = await romanizer()
  const values: string[] = []
  for (const to of ['romaji', 'hiragana', 'katakana']) {
    const converted = await converter.convert(key, { to, mode: 'spaced', romajiSystem: 'hepburn' })
    values.push(...(to === 'romaji' ? romajiVariants(converted) : [converted]))
  }
  if (cache.size >= 4096) cache.delete(cache.keys().next().value!)
  cache.set(key, values)
  return values
}

export async function buildSearchTerms(
  fields: SearchFields
): Promise<{ terms: SearchTerms; complete: boolean }> {
  const basic = buildBasicSearchTerms(fields)
  let complete = true
  for (const key of Object.keys(fields) as Array<keyof SearchFields>) {
    const value = fields[key]
    if (!value || !japanese.test(value)) continue
    try {
      const terms = new Set(basic[key].split(' ').filter(Boolean))
      for (const reading of await readings(value)) {
        if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(reading)) {
          const kana = new Set<string>()
          addTextTerms(kana, reading)
          for (const term of kana) terms.add(KANA_TOKEN + term)
          terms.add(FULL_KANA_TOKEN + splitSearchText(reading).join(''))
        } else addSequence(terms, splitSearchText(reading), 8)
      }
      basic[key] = [...terms].join(' ')
    } catch {
      complete = false
    }
  }
  return { terms: basic, complete }
}
