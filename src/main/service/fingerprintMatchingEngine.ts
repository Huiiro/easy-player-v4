import { createHash } from 'node:crypto'
import type { AudioDuplicatePair, DuplicateFileProgress } from '../../shared/duplicateFiles'
import { waitForBackgroundWork } from './playbackMode'
import type { DuplicateAnalysisCache } from './duplicateAnalysisCache'
import {
  FINGERPRINT_MATCH_VERSION,
  fingerprintCandidateBatches,
  prepareFingerprint,
  comparePreparedFingerprints,
  type PreparedFingerprint,
  type FingerprintItem,
  type FingerprintScore
} from './audioFingerprintMatching'

export type FingerprintBatchComparer = (
  items: FingerprintItem[],
  pairs: Array<[number, number]>,
  signal?: AbortSignal
) => Promise<FingerprintScore[]>
export interface MatchingStats {
  candidatePairs: number
  comparisons: number
  reusedPairs: number
}

function validScore(value?: FingerprintScore): value is FingerprintScore {
  return (
    !!value &&
    typeof value.matched === 'boolean' &&
    Number.isFinite(value.score) &&
    value.score >= 0 &&
    value.score <= 1 &&
    Number.isFinite(value.coverage) &&
    value.coverage >= 0 &&
    value.coverage <= 1 &&
    Number.isFinite(value.offsetSeconds)
  )
}

/** Same eligibility and scoring rules, with streaming candidates, prepared anchors and batched persistence. */
export async function matchFingerprintFiles(
  items: FingerprintItem[],
  options: {
    version: string
    force?: boolean
    cache?: DuplicateAnalysisCache
    compareBatch?: FingerprintBatchComparer
    progress?: (value: DuplicateFileProgress) => void
  },
  signal?: AbortSignal
): Promise<{ pairs: AudioDuplicatePair[]; stats: MatchingStats }> {
  const stats: MatchingStats = { candidatePairs: 0, comparisons: 0, reusedPairs: 0 }
  const pairs: AudioDuplicatePair[] = []
  const byId = new Map(items.map((item) => [item.id, item]))
  const prepared = new Map<number, PreparedFingerprint>()
  const memo = new Map<string, FingerprintScore>()
  let indexed = 0
  const checkpoint = async (): Promise<void> => {
    await new Promise<void>((resolve) => setImmediate(resolve))
    signal?.throwIfAborted()
    await waitForBackgroundWork(signal)
  }
  const progress = (): void =>
    options.progress?.({
      phase: 'matching',
      current: Math.min(indexed, Math.max(0, items.length - 1)),
      total: items.length,
      comparedPairs: stats.candidatePairs
    })
  options.progress?.({ phase: 'indexing', current: 0, total: items.length })
  for await (const batch of fingerprintCandidateBatches(
    items,
    checkpoint,
    (current, total, phase) => {
      if (phase === 'matching') {
        indexed = current
        progress()
      } else options.progress?.({ phase, current, total })
    }
  )) {
    await checkpoint()
    const requests = batch.map(([a, b]) => {
      const first = byId.get(a)!,
        second = byId.get(b)!
      const ordered =
        first.sha256 < second.sha256 ? ([a, b] as [number, number]) : ([b, a] as [number, number])
      const key = createHash('sha256')
        .update(
          JSON.stringify([
            options.version,
            FINGERPRINT_MATCH_VERSION,
            ...ordered.map((id) => byId.get(id)!.sha256)
          ])
        )
        .digest('hex')
      return { a, b, ordered, key }
    })
    const keys = [
      ...new Set(requests.map((request) => request.key).filter((key) => !memo.has(key)))
    ]
    const cached = options.force
      ? new Map<string, FingerprintScore>()
      : options.cache?.getMany
        ? options.cache.getMany<FingerprintScore>('match', keys)
        : new Map(
            keys
              .map((key) => [key, options.cache?.get<FingerprintScore>('match', key)])
              .filter((entry): entry is [string, FingerprintScore] =>
                validScore(entry[1] as FingerprintScore | undefined)
              )
          )
    const missing = new Map<string, [number, number]>()
    for (const request of requests) {
      const score = memo.get(request.key) ?? cached.get(request.key)
      if (validScore(score)) memo.set(request.key, score)
      else if (!missing.has(request.key)) missing.set(request.key, request.ordered)
    }
    const jobs = [...missing.values()]
    let results: FingerprintScore[] = []
    if (jobs.length && options.compareBatch)
      results = await options.compareBatch(items, jobs, signal)
    else
      for (const [a, b] of jobs) {
        if (!prepared.has(a)) prepared.set(a, prepareFingerprint(byId.get(a)!.fingerprint))
        if (!prepared.has(b)) prepared.set(b, prepareFingerprint(byId.get(b)!.fingerprint))
        results.push(comparePreparedFingerprints(prepared.get(a)!, prepared.get(b)!))
      }
    signal?.throwIfAborted()
    if (results.length !== jobs.length || results.some((result) => !validScore(result)))
      throw new Error('Invalid fingerprint worker result')
    const writes = [...missing.keys()].map((key, index) => ({ key, value: results[index] }))
    for (const { key, value } of writes) memo.set(key, value)
    if (options.cache?.setMany) options.cache.setMany('match', writes)
    else for (const { key, value } of writes) options.cache?.set('match', key, value)
    stats.comparisons += jobs.length
    stats.candidatePairs += batch.length
    stats.reusedPairs += batch.length - jobs.length
    for (const { a, b, key } of requests) {
      const match = memo.get(key)!
      if (match.matched)
        pairs.push({
          a,
          b,
          score: match.score,
          coverage: match.coverage,
          offsetSeconds: Math.abs(match.offsetSeconds)
        })
    }
    while (memo.size > 4096) memo.delete(memo.keys().next().value!)
    progress()
  }
  signal?.throwIfAborted()
  options.progress?.({
    phase: 'matching',
    current: items.length,
    total: items.length,
    comparedPairs: stats.candidatePairs
  })
  return { pairs, stats }
}
