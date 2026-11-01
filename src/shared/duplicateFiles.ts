import type { FingerprintFailure, FingerprintWarning } from './duplicateFingerprintErrors'

export interface DuplicateFileSong {
  id: number
  title: string
  artist: string | null
  album: string | null
  audio: string
  duration: number | null
  format: string | null
  bitrate: number | null
  sampleRate: number | null
  bitDepth: number | null
}

export interface DuplicateFileEntry extends DuplicateFileSong {
  size: number
  mtimeMs: number
  cacheSignature?: string
  sha256?: string
}

export interface DuplicateFileGroup {
  id: string
  kind: 'exact' | 'similar' | 'audio'
  audioMatch?: { score: number; coverage: number; offsetSeconds: number }
  hash?: string
  durationSpread: number
  files: DuplicateFileEntry[]
}

export interface DuplicateFileProgress {
  phase: 'checking' | 'hashing' | 'fingerprinting' | 'indexing' | 'matching'
  comparedPairs?: number
  current: number
  total: number
  currentPath?: string
  activeChecks?: number
  waitingForPlayback?: boolean
}

export interface DuplicateFileReport {
  checkingStats?: { concurrency: number; slowFiles: Array<{ path: string; elapsedMs: number }> }
  matchingStats: { candidatePairs: number; comparisons: number; reusedPairs: number }
  concurrency: FingerprintConcurrency
  sampleSeconds: 60 | 120
  timings: {
    checkingMs: number
    hashingMs: number
    fingerprintMs: number
    matchingMs: number
    totalMs: number
  }
  mode: 'quick' | 'deep'
  cacheHits: { sha256: number; fingerprint: number; matches: number; report: number }
  fingerprinted: number
  fingerprintSkipped: string[]
  fingerprintFailures?: FingerprintFailure[]
  fingerprintWarnings?: FingerprintWarning[]
  id: string
  createdAt: string
  scanned: number
  hashed: number
  extraFiles: number
  extraBytes: number
  exactGroups: number
  similarGroups: number
  audioGroups: number
  groups: DuplicateFileGroup[]
  skipped: Array<{ path: string; reason: 'unavailable' | 'changed' | 'sidecar' }>
}

export type DuplicateFileResponse<T> =
  | { success: true; data: T }
  | {
      success: false
      error: 'cancelled' | 'busy' | 'stale' | 'invalid' | 'failed' | 'fingerprintMissing'
    }

export interface DuplicateScanOptions {
  concurrency?: FingerprintConcurrency
  sampleSeconds?: 60 | 120
  deep?: boolean
  force?: boolean
}

export type FingerprintConcurrency = 1 | 2 | 4

export interface AudioDuplicatePair {
  a: number
  b: number
  score: number
  coverage: number
  offsetSeconds: number
}

export interface DuplicateCleanupRequest {
  reportId: string
  songIds: number[]
  deleteLocalFiles: boolean
}

export interface DuplicateCleanupResult {
  deletedIds: number[]
  deletedFiles: number
  failedFiles: string[]
}

export type DuplicateTaskStatus =
  'running' | 'interrupted' | 'paused' | 'completed' | 'cancelled' | 'failed'
export interface DuplicateTaskState {
  id: string
  revision: number
  status: DuplicateTaskStatus
  options: DuplicateScanOptions
  progress: DuplicateFileProgress | null
  resumeProgress?: DuplicateFileProgress | null
  settling?: boolean
  recovering: boolean
  resumeCount: number
  startedAt: string
  updatedAt: string
  reportId?: string
  groupCount?: number
  error?: 'failed' | 'fingerprintMissing'
}
export interface DuplicateTaskDetails {
  task: DuplicateTaskState | null
  report: DuplicateFileReport | null
  retainedIds: number[] | null
}
