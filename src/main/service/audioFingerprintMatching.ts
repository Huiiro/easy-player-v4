import type { FingerprintNotice } from '../../shared/duplicateFingerprintErrors'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
export const FINGERPRINT_SAMPLE_SECONDS = 60
export function fingerprintVersion(sampleSeconds: 60 | 120 = FINGERPRINT_SAMPLE_SECONDS): string {
  return `chromaprint-1.6.2-alg2-${sampleSeconds}s-v1`
}
export const FINGERPRINT_MATCH_VERSION = 'align-v1-score90-coverage85'
const FRAME_SECONDS = 4096 / 3 / 11025

export interface AudioFingerprint {
  notices?: FingerprintNotice[]
  data: number[]
  duration: number
}
export interface FingerprintScore {
  score: number
  coverage: number
  offsetSeconds: number
  matched: boolean
}

export interface FingerprintItem {
  id: number
  sha256: string
  fingerprint: AudioFingerprint
}

export interface PreparedFingerprint {
  data: Uint32Array
  anchors: Uint32Array
}

export function prepareFingerprint(fingerprint: { data: ArrayLike<number> }): PreparedFingerprint {
  const data =
    fingerprint.data instanceof Uint32Array ? fingerprint.data : Uint32Array.from(fingerprint.data)
  const anchors = Uint32Array.from(data, (value, index) => ((value >>> 16) << 11) | index)
  anchors.sort()
  return { data, anchors }
}

/** Emit eligible candidates in bounded batches instead of retaining a library-wide pair map. */
export async function* fingerprintCandidateBatches(
  items: FingerprintItem[],
  checkpoint: () => Promise<void>,
  onIndexed: (current: number, total: number, phase: 'indexing' | 'matching') => void,
  batchSize = 128
): AsyncGenerator<Array<[number, number]>> {
  const postings = new Map<number, Set<number>>()
  const keysByFile: Uint16Array[] = []
  for (let index = 0; index < items.length; index++) {
    const fingerprint = items[index].fingerprint
    const keys = new Set<number>()
    for (let position = 0; position < fingerprint.data.length; position += 3)
      keys.add(fingerprint.data[position] >>> 16)
    keysByFile.push(Uint16Array.from(keys))
    for (const key of keysByFile[index]) {
      const ids = postings.get(key) ?? new Set<number>()
      if (ids.size <= 128) ids.add(index)
      postings.set(key, ids)
    }
    if (index % 32 === 0) {
      await checkpoint()
      onIndexed(index + 1, items.length, 'indexing')
    }
  }
  onIndexed(items.length, items.length, 'indexing')
  let batch: Array<[number, number]> = []
  for (let index = 0; index < items.length; index++) {
    await checkpoint()
    const first = items[index]
    const votes = new Map<number, number>()
    for (const key of keysByFile[index]) {
      const candidates = postings.get(key)!
      if (candidates.size > 128) continue
      for (const other of candidates) {
        const second = items[other]
        if (
          second.id <= first.id ||
          first.sha256 === second.sha256 ||
          Math.abs(first.fingerprint.duration - second.fingerprint.duration) > 10
        )
          continue
        votes.set(other, (votes.get(other) ?? 0) + 1)
      }
    }
    for (const [other, count] of votes)
      if (count >= 5) {
        batch.push([first.id, items[other].id])
        if (batch.length >= batchSize) {
          yield batch
          batch = []
        }
      }
    onIndexed(index + 1, items.length, 'matching')
  }
  if (batch.length) yield batch
}

export function packFingerprint(value: AudioFingerprint): {
  duration: number
  data: string
  notices?: FingerprintNotice[]
} {
  const buffer = Buffer.alloc(value.data.length * 4)
  value.data.forEach((item, index) => buffer.writeUInt32LE(item, index * 4))
  return {
    duration: value.duration,
    data: deflateRawSync(buffer).toString('base64'),
    ...(value.notices?.length ? { notices: value.notices } : {})
  }
}

export function unpackFingerprint(value?: {
  duration: number
  data: string
  notices?: FingerprintNotice[]
}): AudioFingerprint | undefined {
  if (!value || typeof value.data !== 'string') return undefined
  try {
    const buffer = inflateRawSync(Buffer.from(value.data, 'base64'), { maxOutputLength: 8000 })
    if (buffer.length % 4) return undefined
    const result = {
      duration: value.duration,
      ...(value.notices?.length ? { notices: value.notices } : {}),
      data: Array.from({ length: buffer.length / 4 }, (_, index) => buffer.readUInt32LE(index * 4))
    }
    return validFingerprint(result) ? result : undefined
  } catch {
    return undefined
  }
}

export function validFingerprint(value: AudioFingerprint | undefined): value is AudioFingerprint {
  return (
    !!value &&
    Number.isFinite(value.duration) &&
    value.duration > 0 &&
    Array.isArray(value.data) &&
    value.data.length >= 100 &&
    value.data.length <= 2000 &&
    value.data.every((item) => Number.isInteger(item) && item >= 0 && item <= 0xffffffff)
  )
}

function popcount(value: number): number {
  value -= (value >>> 1) & 0x55555555
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333)
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

/** Coarse postings avoid comparing every pair in a large library; common/silent anchors are ignored. */
export function fingerprintCandidatePairs(
  items: Array<{ id: number; fingerprint: AudioFingerprint }>
): Array<[number, number]> {
  const postings = new Map<number, Set<number>>()
  for (const { id, fingerprint } of items) {
    for (let index = 0; index < fingerprint.data.length; index += 3) {
      const key = fingerprint.data[index] >>> 16
      const ids = postings.get(key) ?? new Set<number>()
      if (ids.size <= 128) ids.add(id)
      postings.set(key, ids)
    }
  }
  const votes = new Map<string, number>()
  for (const ids of postings.values()) {
    if (ids.size > 128) continue
    const list = [...ids]
    for (let a = 0; a < list.length; a++)
      for (let b = a + 1; b < list.length; b++) {
        const key = [Math.min(list[a], list[b]), Math.max(list[a], list[b])].join(':')
        votes.set(key, (votes.get(key) ?? 0) + 1)
      }
  }
  return [...votes]
    .filter(([, count]) => count >= 5)
    .map(([key]) => key.split(':').map(Number) as [number, number])
}

export function compareFingerprints(a: AudioFingerprint, b: AudioFingerprint): FingerprintScore {
  return comparePreparedFingerprints(prepareFingerprint(a), prepareFingerprint(b))
}

/** Reuse sorted compact anchors. Tie order matches the original matcher exactly. */
export function comparePreparedFingerprints(
  a: PreparedFingerprint,
  b: PreparedFingerprint
): FingerprintScore {
  const limit = Math.floor(10 / FRAME_SECONDS)
  const votes = new Uint32Array(limit * 2 + 1)
  const firstSeen = new Float64Array(votes.length).fill(Infinity)
  firstSeen[limit] = -1
  let i = 0,
    j = 0
  while (i < a.anchors.length && j < b.anchors.length) {
    const keyA = a.anchors[i] >>> 11,
      keyB = b.anchors[j] >>> 11
    if (keyA < keyB) {
      i++
      continue
    }
    if (keyA > keyB) {
      j++
      continue
    }
    let endA = i + 1,
      endB = j + 1
    while (endA < a.anchors.length && a.anchors[endA] >>> 11 === keyA) endA++
    while (endB < b.anchors.length && b.anchors[endB] >>> 11 === keyB) endB++
    if (endA - i <= 32)
      for (let bi = j; bi < endB; bi++)
        for (let ai = i; ai < endA; ai++) {
          const positionA = a.anchors[ai] & 2047,
            positionB = b.anchors[bi] & 2047
          const offset = positionA - positionB
          if (Math.abs(offset) > limit) continue
          const slot = offset + limit
          votes[slot]++
          firstSeen[slot] = Math.min(firstSeen[slot], positionB * (a.data.length + 1) + positionA)
        }
    i = endA
    j = endB
  }
  const offsets = Array.from(votes.keys()).filter((slot) => Number.isFinite(firstSeen[slot]))
  offsets.sort((a, b) => votes[b] - votes[a] || firstSeen[a] - firstSeen[b])
  let best: FingerprintScore = { score: 0, coverage: 0, offsetSeconds: 0, matched: false }
  for (const slot of offsets.slice(0, 12)) {
    const offset = slot - limit
    const startA = Math.max(0, offset)
    const startB = Math.max(0, -offset)
    const count = Math.min(a.data.length - startA, b.data.length - startB)
    const coverage = count / Math.max(a.data.length, b.data.length)
    if (count < 100 || coverage < 0.85) continue
    let errors = 0
    const maxErrors = Math.floor((1 - best.score) * count * 32 + 1e-7)
    for (let index = 0; index < count; index++) {
      errors += popcount(a.data[startA + index] ^ b.data[startB + index])
      if (errors > maxErrors) break
    }
    if (errors > maxErrors) continue
    const score = 1 - errors / (count * 32)
    if (score > best.score)
      best = { score, coverage, offsetSeconds: offset * FRAME_SECONDS, matched: score >= 0.9 }
  }
  return best
}
