import { fingerprintFailureDetails } from './fingerprintExtractionError'
import type {
  FingerprintFailure,
  FingerprintWarning
} from '../../shared/duplicateFingerprintErrors'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import type { Stats } from 'node:fs'
import { lstat } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { waitForBackgroundWork } from './playbackMode'
import { checkDuplicateFileStates } from './duplicateFileChecking'
import { similarSongCandidates, buildDuplicateGroups } from './duplicateSongMatching'
import type { DuplicateAnalysisCache } from './duplicateAnalysisCache'
import { normalizeFingerprintConcurrency, runFingerprintTasks } from './fingerprintTaskPool'
import { matchFingerprintFiles, type FingerprintBatchComparer } from './fingerprintMatchingEngine'
import {
  fingerprintVersion,
  FINGERPRINT_MATCH_VERSION,
  validFingerprint,
  packFingerprint,
  unpackFingerprint,
  type AudioFingerprint
} from './audioFingerprintMatching'
import type {
  DuplicateFileSong,
  DuplicateFileEntry,
  DuplicateFileProgress,
  DuplicateFileReport,
  AudioDuplicatePair,
  FingerprintConcurrency
} from '../../shared/duplicateFiles'

export async function hashDuplicateFile(file: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(file, { signal })
  try {
    for await (const chunk of stream) {
      signal?.throwIfAborted()
      await waitForBackgroundWork(signal)
      signal?.throwIfAborted()
      hash.update(chunk)
    }
    return hash.digest('hex')
  } finally {
    stream.destroy()
  }
}

/** Read-only scan. Hash same-size files and metadata-based song candidates. */
export async function detectDuplicateFiles(
  songs: DuplicateFileSong[],
  progress: (progress: DuplicateFileProgress) => void = () => {},
  signal?: AbortSignal,
  options: {
    fingerprintWarning?: (warning: FingerprintWarning) => void
    fingerprintFailure?: (failure: FingerprintFailure) => void
    compareBatch?: FingerprintBatchComparer
    concurrency?: FingerprintConcurrency
    sampleSeconds?: 60 | 120
    deep?: boolean
    force?: boolean
    cache?: DuplicateAnalysisCache
    fingerprint?: (
      file: string,
      signal?: AbortSignal,
      duration?: number
    ) => Promise<AudioFingerprint>
  } = {}
): Promise<DuplicateFileReport> {
  const startedAt = performance.now()
  const sampleSeconds = options.sampleSeconds === 120 ? 120 : 60
  const concurrency = normalizeFingerprintConcurrency(options.concurrency)
  const extractionVersion = fingerprintVersion(sampleSeconds)
  const cacheKey = (value: unknown): string =>
    createHash('sha256').update(JSON.stringify(value)).digest('hex')
  const signature = (audio: string, stat: Stats): string => {
    const resolved = path.resolve(audio)
    return cacheKey([
      process.platform === 'win32' ? resolved.toLowerCase() : resolved,
      stat.size,
      stat.mtimeMs,
      stat.ctimeMs,
      stat.dev,
      stat.ino
    ])
  }
  const cached = <T>(kind: string, key: string): T | undefined =>
    options.force ? undefined : options.cache?.get<T>(kind, key)
  const report: DuplicateFileReport = {
    matchingStats: { candidatePairs: 0, comparisons: 0, reusedPairs: 0 },
    concurrency,
    sampleSeconds,
    timings: { checkingMs: 0, hashingMs: 0, fingerprintMs: 0, matchingMs: 0, totalMs: 0 },
    mode: options.deep ? 'deep' : 'quick',
    cacheHits: { sha256: 0, fingerprint: 0, matches: 0, report: 0 },
    fingerprinted: 0,
    fingerprintSkipped: [],
    fingerprintFailures: [],
    fingerprintWarnings: [],
    audioGroups: 0,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    scanned: songs.length,
    hashed: 0,
    extraFiles: 0,
    extraBytes: 0,
    exactGroups: 0,
    similarGroups: 0,
    groups: [],
    skipped: []
  }
  const buckets = new Map<number, DuplicateFileEntry[]>()
  const checked = await checkDuplicateFileStates(songs, progress, signal)
  signal?.throwIfAborted()
  report.skipped = checked.skipped
  report.checkingStats = { concurrency: checked.concurrency, slowFiles: checked.slowFiles }
  for (const { song, stat } of checked.files) {
    const file: DuplicateFileEntry = {
      ...song,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      cacheSignature: signature(song.audio, stat)
    }
    const bucket = buckets.get(stat.size) ?? []
    bucket.push(file)
    buckets.set(stat.size, bucket)
  }
  const allFiles = [...buckets.values()].flat()
  report.timings.checkingMs = performance.now() - startedAt
  const reportKey = cacheKey([
    'report-v4',
    extractionVersion,
    FINGERPRINT_MATCH_VERSION,
    !!options.deep,
    report.scanned,
    allFiles,
    report.skipped
  ])
  const previous = cached<DuplicateFileReport>('report', reportKey)
  if (previous?.groups && Array.isArray(previous.groups)) {
    return {
      ...previous,
      checkingStats: report.checkingStats,
      matchingStats: report.matchingStats,
      concurrency,
      sampleSeconds,
      timings: { ...report.timings, totalMs: performance.now() - startedAt },
      id: report.id,
      createdAt: report.createdAt,
      cacheHits: {
        sha256: previous.hashed,
        fingerprint: previous.fingerprinted,
        matches: 0,
        report: 1
      }
    }
  }
  const candidateIds = new Set(
    [
      ...[...buckets.values()].filter((bucket) => bucket.length > 1).flat(),
      ...similarSongCandidates(allFiles).flat()
    ].map((file) => file.id)
  )
  const candidates = options.deep ? allFiles : allFiles.filter((file) => candidateIds.has(file.id))
  const hashingStartedAt = performance.now()
  progress({ phase: 'hashing', current: 0, total: candidates.length })
  for (const [index, file] of candidates.entries()) {
    signal?.throwIfAborted()
    try {
      const storedHash = cached<string>('sha256', `sha256-v1:${file.cacheSignature}`)
      const hash =
        storedHash && /^[a-f0-9]{64}$/.test(storedHash)
          ? storedHash
          : await hashDuplicateFile(file.audio, signal)
      if (hash === storedHash) report.cacheHits.sha256++
      const stat = await lstat(file.audio)
      signal?.throwIfAborted()
      if (!stat.isFile() || signature(file.audio, stat) !== file.cacheSignature) {
        report.skipped.push({ path: file.audio, reason: 'changed' })
      } else {
        file.sha256 = hash
        if (storedHash !== hash)
          options.cache?.set('sha256', `sha256-v1:${file.cacheSignature}`, hash)
        report.hashed++
      }
    } catch {
      signal?.throwIfAborted()
      report.skipped.push({ path: file.audio, reason: 'unavailable' })
    }
    progress({ phase: 'hashing', current: index + 1, total: candidates.length })
  }
  signal?.throwIfAborted()
  report.timings.hashingMs = performance.now() - hashingStartedAt
  let matchingStartedAt = performance.now()
  const audioPairs: AudioDuplicatePair[] = []
  if (options.deep) {
    const fingerprintStartedAt = performance.now()
    const fingerprints = new Map<number, AudioFingerprint>()
    const extracted = new Map<number, AudioFingerprint>()
    const validFiles = candidates.filter((file) => file.sha256)
    progress({ phase: 'fingerprinting', current: 0, total: validFiles.length })
    let completed = 0
    await runFingerprintTasks(
      validFiles,
      concurrency,
      async (file, _index, taskSignal) => {
        taskSignal.throwIfAborted()
        await waitForBackgroundWork(taskSignal)
        try {
          const key = `${extractionVersion}:${file.cacheSignature}`
          let fingerprint = unpackFingerprint(
            cached<ReturnType<typeof packFingerprint>>('fingerprint', key)
          )
          const reused = !!fingerprint
          if (fingerprint) report.cacheHits.fingerprint++
          else
            fingerprint = await options.fingerprint?.(
              file.audio,
              taskSignal,
              file.duration ?? undefined
            )
          if (!validFingerprint(fingerprint)) throw new Error('fingerprintFailed')
          const stat = await lstat(file.audio)
          taskSignal.throwIfAborted()
          if (!stat.isFile() || signature(file.audio, stat) !== file.cacheSignature)
            throw new Error('changed')
          if (!reused) options.cache?.set('fingerprint', key, packFingerprint(fingerprint))
          for (const notice of fingerprint.notices ?? []) {
            const warning = { ...notice, path: file.audio }
            report.fingerprintWarnings!.push(warning)
            if (!reused) options.fingerprintWarning?.(warning)
          }
          extracted.set(file.id, fingerprint)
          report.fingerprinted++
        } catch (error) {
          taskSignal.throwIfAborted()
          if (error instanceof Error && error.message === 'changed') {
            file.sha256 = undefined
            report.skipped.push({ path: file.audio, reason: 'changed' })
          }
          const failure = fingerprintFailureDetails(file.audio, error)
          report.fingerprintFailures!.push(failure)
          options.fingerprintFailure?.(failure)
          report.fingerprintSkipped.push(file.audio)
        }
        taskSignal.throwIfAborted()
        progress({ phase: 'fingerprinting', current: ++completed, total: validFiles.length })
      },
      signal
    )
    // Completion order must not change candidate discovery or grouping.
    for (const file of validFiles) {
      const fingerprint = extracted.get(file.id)
      if (fingerprint) fingerprints.set(file.id, fingerprint)
    }
    report.fingerprintWarnings!.sort((a, b) => a.path.localeCompare(b.path))
    report.fingerprintSkipped.sort()
    report.fingerprintFailures!.sort((a, b) => a.path.localeCompare(b.path))
    report.timings.fingerprintMs = performance.now() - fingerprintStartedAt
    matchingStartedAt = performance.now()
    const byId = new Map(validFiles.map((file) => [file.id, file]))
    const matched = await matchFingerprintFiles(
      [...fingerprints].map(([id, fingerprint]) => ({
        id,
        fingerprint,
        sha256: byId.get(id)!.sha256!
      })),
      {
        version: extractionVersion,
        force: options.force,
        cache: options.cache,
        compareBatch: options.compareBatch,
        progress
      },
      signal
    )
    audioPairs.push(...matched.pairs)
    report.matchingStats = matched.stats
    report.cacheHits.matches = matched.stats.reusedPairs
  }
  signal?.throwIfAborted()
  report.groups = buildDuplicateGroups(candidates, audioPairs)
  for (const group of report.groups) {
    report.extraFiles += group.files.length - 1
    if (group.kind === 'exact') report.exactGroups++
    else if (group.kind === 'audio') report.audioGroups++
    else report.similarGroups++
    report.extraBytes +=
      group.files.reduce((sum, file) => sum + file.size, 0) -
      Math.max(...group.files.map((file) => file.size))
  }
  report.timings.matchingMs = performance.now() - matchingStartedAt
  report.timings.totalMs = performance.now() - startedAt
  if (!report.skipped.length && !report.fingerprintSkipped.length)
    options.cache?.set('report', reportKey, report)
  return report
}

/** Validate trusted report entries again; never accept paths supplied by the renderer. */
export async function validateDuplicateCleanup(
  report: DuplicateFileReport,
  songIds: number[],
  currentSong: (id: number) => { audio: string; sourceId: number | null } | undefined
): Promise<DuplicateFileEntry[]> {
  if (
    !Array.isArray(songIds) ||
    !songIds.length ||
    songIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
  )
    throw new Error('invalid')
  const selected = new Set(songIds)
  const targets: DuplicateFileEntry[] = []
  const involved = report.groups.filter((group) =>
    group.files.some((file) => selected.has(file.id))
  )
  for (const group of involved) {
    const keep = group.files.find((file) => !selected.has(file.id))
    if (!keep) throw new Error('invalid')
    const removed = group.files.filter((file) => selected.has(file.id))
    for (const file of [keep, ...removed]) {
      const current = currentSong(file.id)
      if (!current || current.sourceId !== null || current.audio !== file.audio)
        throw new Error('stale')
      try {
        const before = await lstat(file.audio)
        if (!before.isFile() || before.size !== file.size || before.mtimeMs !== file.mtimeMs)
          throw new Error('stale')
        const hash = await hashDuplicateFile(file.audio)
        const after = await lstat(file.audio)
        if (
          hash !== file.sha256 ||
          !after.isFile() ||
          after.size !== file.size ||
          after.mtimeMs !== file.mtimeMs
        )
          throw new Error('stale')
      } catch {
        throw new Error('stale')
      }
    }
    targets.push(...removed)
  }
  if (targets.length !== selected.size) throw new Error('invalid')
  return targets
}

export { duplicateReportMarkdown } from './duplicateReportMarkdown'
