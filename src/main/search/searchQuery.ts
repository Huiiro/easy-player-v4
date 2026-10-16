import * as OpenCC from 'opencc-js'
import type Database from 'better-sqlite3'
import {
  normalizeSearchText,
  splitSearchText,
  READING_TOKEN,
  FULL_READING_TOKEN,
  INITIAL_TOKEN,
  FULL_INITIAL_TOKEN,
  KANA_TOKEN,
  FULL_KANA_TOKEN
} from './searchTokens'

const converters = [
  OpenCC.Converter({ from: 'cn', to: 'tw' }),
  OpenCC.Converter({ from: 'cn', to: 'hk' }),
  OpenCC.Converter({ from: 'cn', to: 't' }),
  OpenCC.Converter({ from: 'tw', to: 'cn' }),
  OpenCC.Converter({ from: 'hk', to: 'cn' }),
  OpenCC.Converter({ from: 't', to: 'cn' }),
  OpenCC.Converter({ from: 'tw', to: 'hk' }),
  OpenCC.Converter({ from: 'hk', to: 'tw' })
]

export function searchVariants(text: string): string[] {
  return [
    ...new Set([text, ...converters.map((convert) => convert(text))].map(normalizeSearchText))
  ]
}

const quote = (text: string): string => `"${text.replace(/"/gu, '""')}"`

function readingWord(word: string): string {
  return word.replace(/(?<=\p{Script=Latin})['’](?=\p{Script=Latin})/gu, '')
}

function readingQuery(
  word: string,
  kind: 'any' | 'full' | 'exact' | 'prefix' | 'initial' | 'fullInitial' = 'any'
): string {
  const reading = readingWord(word)
  if (/^[\p{Script=Latin}\p{N}]{2,}$/u.test(reading)) {
    switch (kind) {
      case 'full':
        return quote(FULL_READING_TOKEN + reading)
      case 'exact':
        return quote(READING_TOKEN + reading)
      case 'prefix':
        return quote(READING_TOKEN + reading) + '*'
      case 'initial':
        return quote(INITIAL_TOKEN + reading)
      case 'fullInitial':
        return quote(FULL_INITIAL_TOKEN + reading)
      default:
        return `(${quote(READING_TOKEN + reading)}* OR ${quote(INITIAL_TOKEN + reading)})`
    }
  }
  // Han input only matches original metadata; kana may also match generated readings.
  if (/^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u.test(reading)) {
    if (kind === 'initial' || kind === 'fullInitial') return ''
    if (kind === 'full') return quote(FULL_KANA_TOKEN + reading)
    return quote(KANA_TOKEN + reading) + (kind === 'prefix' || kind === 'any' ? '*' : '')
  }
  return ''
}

export function buildFtsSearchQuery(text: string): string {
  return [...new Set(splitSearchText(text))]
    .slice(0, 12)
    .map((term) => readingQuery(term))
    .filter(Boolean)
    .join(' AND ')
}

const fieldWeights = {
  title: [1000, 900, 800, 760, 700, 640, 320],
  artist: [680, 620, 560, 520, 480, 440, 220],
  album: [360, 330, 300, 280, 260, 240, 120],
  file_name: [200, 180, 160, 140, 130, 120, 60]
} as const

const cache = new WeakMap<
  Database.Database,
  { query: string; changes: number; dataVersion: number }
>()

function changes(db: Database.Database): number {
  return (db.prepare('SELECT total_changes() AS value').get() as { value: number }).value
}

/** Materialize only matching IDs and scores, shared by result/count/scope queries. */
function prepareMatches(db: Database.Database, normalized: string): void {
  const dataVersion = db.pragma('data_version', { simple: true }) as number
  const previous = cache.get(db)
  const outerTransaction = db.inTransaction
  if (
    !outerTransaction &&
    previous?.query === normalized &&
    previous.changes === changes(db) &&
    previous.dataVersion === dataVersion
  )
    return
  // A rollback also rolls back TEMP contents but does not rewind total_changes().
  cache.delete(db)
  db.exec(
    'CREATE TEMP TABLE IF NOT EXISTS song_search_matches(song_id INTEGER PRIMARY KEY, score REAL NOT NULL)'
  )
  const words = normalized.split(/\s+/u).filter(Boolean).slice(0, 12)
  const params: Record<string, string> = {}
  const ctes = words.map((word, index) => {
    const selects: string[] = []
    searchVariants(word).forEach((variant, variantIndex) => {
      const key = `original${index}_${variantIndex}`
      params[key] = variant
      for (const [field, weights] of Object.entries(fieldWeights)) {
        const matches = Array.from(variant).length >= 3 && !variant.includes('\0')
        const matchKey = `${key}_${field}`
        if (matches) params[matchKey] = `${field} : ${quote(variant)}`
        // Short strings retain arbitrary substring matching using native SQLite instr.
        // Longer strings first use the trigram index; no JavaScript per-row callbacks.
        selects.push(`SELECT rowid AS id, CASE WHEN ${field}=@${key} THEN ${weights[0]}
          WHEN instr(${field},@${key})=1 THEN ${weights[1]} ELSE ${weights[2]} END AS score
          FROM song_original_fts WHERE ${matches ? `song_original_fts MATCH @${matchKey} AND ` : ''}instr(${field},@${key})>0`)
      }
    })
    for (const [field, weights] of Object.entries(fieldWeights)) {
      for (const [kind, weight] of [
        ['full', weights[3]],
        ['exact', weights[4]],
        ['prefix', weights[5]],
        ['fullInitial', weights[6] * 1.25],
        ['initial', weights[6]]
      ] as const) {
        const query = readingQuery(word, kind)
        if (!query) continue
        const key = `reading${index}_${field}_${kind}`
        params[key] = `${field} : (${query})`
        selects.push(
          `SELECT rowid AS id, ${weight} AS score FROM song_fts WHERE song_fts MATCH @${key}`
        )
      }
    }
    return `term${index} AS MATERIALIZED (SELECT id, MAX(score) AS score FROM (${selects.join(' UNION ALL ')}) GROUP BY id)`
  })
  const joins = words
    .slice(1)
    .map((_, index) => `INNER JOIN term${index + 1} USING(id)`)
    .join(' ')
  const sum = words.map((_, index) => `term${index}.score`).join('+')
  db.transaction(() => {
    db.exec('DELETE FROM temp.song_search_matches')
    db.prepare(
      `WITH ${ctes.join(',')} INSERT INTO temp.song_search_matches(song_id,score)
      SELECT term0.id,${sum} FROM term0 ${joins}`
    ).run(params)
  })()
  if (!outerTransaction) cache.set(db, { query: normalized, changes: changes(db), dataVersion })
}

export function buildSongSearchFilter(
  db: Database.Database,
  search = '',
  alias = ''
): {
  sql: string
  score: string
  params: Record<string, string>
} {
  const normalized = normalizeSearchText(search).slice(0, 512)
  if (!normalized) return { sql: '', score: '0', params: {} }
  prepareMatches(db, normalized)
  return {
    sql: `${alias}id IN (SELECT song_id FROM temp.song_search_matches)`,
    score: `(SELECT m.score FROM temp.song_search_matches m WHERE m.song_id=${alias}id)`,
    params: {}
  }
}
