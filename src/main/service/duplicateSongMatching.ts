import type {
  DuplicateFileEntry,
  DuplicateFileGroup,
  AudioDuplicatePair
} from '../../shared/duplicateFiles'
import { createHash } from 'node:crypto'

function metadataKey(file: DuplicateFileEntry): string | null {
  const normalize = (value: string): string =>
    value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\p{P}\p{Z}\s]/gu, '')
  const title = normalize(file.title)
  const artist = file.artist?.trim()
  if (
    !title ||
    !artist ||
    /^(unknown(?: artist)?|未知(?:歌手|艺术家)?)$/i.test(artist) ||
    !file.duration ||
    !Number.isFinite(file.duration) ||
    file.duration <= 0
  )
    return null
  const artists = [
    ...new Set(
      artist
        .split(/[,，;；/／&＆、|]+/)
        .map(normalize)
        .filter(Boolean)
    )
  ].sort()
  return artists.length ? JSON.stringify([title, artists]) : null
}

/** Metadata suggests a candidate, never establishes identical audio. Keep version qualifiers. */
export function similarSongCandidates(files: DuplicateFileEntry[]): DuplicateFileEntry[][] {
  const byMetadata = new Map<string, DuplicateFileEntry[]>()
  for (const file of files) {
    const key = metadataKey(file)
    if (!key) continue
    const bucket = byMetadata.get(key) ?? []
    bucket.push(file)
    byMetadata.set(key, bucket)
  }
  const groups: DuplicateFileEntry[][] = []
  for (const bucket of byMetadata.values()) {
    bucket.sort((a, b) => a.duration! - b.duration! || a.id - b.id)
    let cluster: DuplicateFileEntry[] = []
    for (const file of bucket) {
      if (cluster.length && file.duration! - cluster[0].duration! > 3) {
        if (cluster.length > 1) groups.push(cluster)
        cluster = []
      }
      cluster.push(file)
    }
    if (cluster.length > 1) groups.push(cluster)
  }
  return groups
}

/** Make disjoint report groups so retaining a file cannot conflict across overlapping groups. */
export function buildDuplicateGroups(
  files: DuplicateFileEntry[],
  audioPairs: AudioDuplicatePair[] = []
): DuplicateFileGroup[] {
  const valid = files.filter((file) => file.sha256)
  const parents = new Map(valid.map((file) => [file.id, file.id]))
  const find = (id: number): number => {
    let root = id
    while (parents.get(root) !== root) root = parents.get(root)!
    while (parents.get(id) !== id) {
      const next = parents.get(id)!
      parents.set(id, root)
      id = next
    }
    return root
  }
  const merge = (group: DuplicateFileEntry[]): void => {
    for (const file of group.slice(1)) parents.set(find(file.id), find(group[0].id))
  }
  const byHash = new Map<string, DuplicateFileEntry[]>()
  for (const file of valid) {
    const group = byHash.get(file.sha256!) ?? []
    group.push(file)
    byHash.set(file.sha256!, group)
  }
  for (const group of byHash.values()) merge(group)
  for (const group of similarSongCandidates(valid)) merge(group)
  const byId = new Map(valid.map((file) => [file.id, file]))
  const pairKey = (a: number, b: number): string => [Math.min(a, b), Math.max(a, b)].join(':')
  const pairScores = new Map(audioPairs.map((pair) => [pairKey(pair.a, pair.b), pair]))
  for (const pair of audioPairs) {
    const a = byId.get(pair.a)
    const b = byId.get(pair.b)
    if (a && b) merge([a, b])
  }
  const merged = new Map<number, DuplicateFileEntry[]>()
  for (const file of valid) {
    const key = find(file.id)
    const group = merged.get(key) ?? []
    group.push(file)
    merged.set(key, group)
  }
  return [...merged.values()]
    .filter((group) => group.length > 1)
    .map((group): DuplicateFileGroup => {
      group.sort((a, b) => a.id - b.id)
      const exact = group.every((file) => file.sha256 === group[0].sha256)
      const evidence: AudioDuplicatePair[] = []
      let audioVerified = !exact
      for (let a = 0; a < group.length && audioVerified; a++)
        for (let b = a + 1; b < group.length; b++) {
          if (group[a].sha256 === group[b].sha256) continue
          const pair = pairScores.get(pairKey(group[a].id, group[b].id))
          if (!pair) {
            audioVerified = false
            break
          }
          evidence.push(pair)
        }
      const durations = group
        .map((file) => file.duration)
        .filter((value): value is number => value != null && Number.isFinite(value))
      return {
        id: createHash('sha256')
          .update(group.map((file) => file.id).join(','))
          .digest('hex'),
        kind: exact ? 'exact' : audioVerified ? 'audio' : 'similar',
        audioMatch: audioVerified
          ? {
              score: Math.min(...evidence.map((pair) => pair.score)),
              coverage: Math.min(...evidence.map((pair) => pair.coverage)),
              offsetSeconds: Math.max(...evidence.map((pair) => Math.abs(pair.offsetSeconds)))
            }
          : undefined,
        hash: exact ? group[0].sha256 : undefined,
        durationSpread: durations.length ? Math.max(...durations) - Math.min(...durations) : 0,
        files: group
      }
    })
    .sort(
      (a, b) =>
        a.kind.localeCompare(b.kind) ||
        b.files.reduce((sum, file) => sum + file.size, 0) -
          a.files.reduce((sum, file) => sum + file.size, 0)
    )
}
