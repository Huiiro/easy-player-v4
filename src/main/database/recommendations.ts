import { getDatabase } from './index'

export type RecommendationReason =
  | 'liked'
  | 'replayed'
  | 'finished'
  | 'similarArtist'
  | 'similarAlbum'
  | 'similarGenre'
  | 'similarTag'
  | 'similarEra'
  | 'similarLength'
  | 'unheard'
  | 'skipped'
  | 'activelyChosen'
  | 'recentlyAdded'
  | 'lessRecommended'

export interface RecommendationScore {
  songId: number
  artistKey: string
  discoveryKind?: 'cold'
  weight: number
  preference: -1 | 0 | 1
  plays: number
  engagedPlays: number
  recentEngagedPlays: number
  recentPlays: number
  completions: number
  skips: number
  factors: {
    behavior: number
    artist: number
    album: number
    genre: number
    tag: number
    era: number
    length: number
    feedback: number
    freshness: number
    exploration: number
    recency: number
    variation: number
  }
  behaviorParts: {
    completion: number
    listened: number
    repeat: number
    intent: number
    skips: number
    history: number
  }
  reason: RecommendationReason
}

interface SongSignals {
  id: number
  preference: -1 | 0 | 1
  artist: string | null
  album: string | null
  genre: string | null
  year: number | null
  playTimes: number
  duration: number | null
  songStatus: number
  isNewest: number
  createdAt: string | null
}

interface EventRow {
  songId: number
  startedAt: number
  endedAt: number
  playedMs: number
  durationMs: number
  endReason: string
  startOrigin: string
}

const normalize = (value: string | null): string => value?.trim().toLocaleLowerCase() ?? ''
const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value))
const eraOf = (year: number | null): number | null =>
  year && year >= 1900 && year <= new Date().getFullYear() + 1 ? Math.floor(year / 10) * 10 : null
const lengthOf = (seconds: number | null): string | null =>
  seconds && seconds >= 30 ? (seconds < 180 ? 'short' : seconds < 360 ? 'medium' : 'long') : null
const add = <K>(map: Map<K, number>, key: K, amount: number): void => {
  map.set(key, (map.get(key) ?? 0) + amount)
}
const affinity = <K>(key: K | null, signals: Map<K, number>, catalogue: Map<K, number>): number =>
  key === null ? 0 : clamp((signals.get(key) ?? 0) / ((catalogue.get(key) ?? 0) + 2), 0, 1)
const metadataBoost = (score: RecommendationScore): number =>
  score.factors.artist +
  score.factors.album +
  score.factors.genre +
  score.factors.tag +
  score.factors.era +
  score.factors.length
const importAgeDays = (value: string | null, now: number): number => {
  if (!value) return Infinity
  const timestamp = Date.parse(value.replace(' ', 'T'))
  return Number.isFinite(timestamp) ? Math.max(0, (now - timestamp) / 86400_000) : Infinity
}
const localDateKey = (timestamp: number): string => {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const dailyVariation = (songId: number, now: number): number => {
  const date = new Date(now)
  const day = date.getFullYear() * 372 + (date.getMonth() + 1) * 31 + date.getDate()
  let hash = Math.imul(songId ^ day, 0x45d9f3b)
  hash ^= hash >>> 16
  return 0.96 + ((hash >>> 0) / 0xffffffff) * 0.08
}

/** One shared model for the daily recommendation view and live smart shuffle. */
export function getRecommendationScores(
  asOf = Date.now(),
  dailySnapshot = false
): RecommendationScore[] {
  const db = getDatabase()
  const now = asOf
  const allSongs = db
    .prepare(
      'SELECT id, preference, artist, album, genre, year, play_times AS playTimes, duration, song_status AS songStatus, is_newest AS isNewest, created_at AS createdAt FROM song WHERE song_status != 0'
    )
    .all() as SongSignals[]
  const songs = dailySnapshot
    ? allSongs.filter((song) => {
        const importedAt = Date.parse((song.createdAt ?? '').replace(' ', 'T'))
        return !Number.isFinite(importedAt) || importedAt < asOf
      })
    : allSongs
  if (!songs.length) return []

  const cutoffDate = new Date(now)
  cutoffDate.setDate(cutoffDate.getDate() - 90)
  const cutoff = dailySnapshot ? cutoffDate.getTime() : now - 90 * 86400_000
  const events = db
    .prepare(
      "SELECT song_id AS songId, started_at AS startedAt, COALESCE(ended_at, started_at + played_ms) AS endedAt, played_ms AS playedMs, COALESCE(duration_ms, 0) AS durationMs, COALESCE(end_reason, 'legacy') AS endReason, start_origin AS startOrigin FROM play_history WHERE started_at >= ? AND started_at < ? AND COALESCE(ended_at, started_at + played_ms) < ?"
    )
    .all(cutoff, now, now) as EventRow[]
  const todayStarts = new Map<number, number>(
    dailySnapshot
      ? (
          db
            .prepare(
              'SELECT song_id AS songId, COUNT(*) AS starts FROM play_history WHERE started_at >= ? GROUP BY song_id'
            )
            .all(now) as Array<{ songId: number; starts: number }>
        ).map((row) => [row.songId, row.starts])
      : []
  )
  const datedImports = songs
    .map((song) => Date.parse((song.createdAt ?? '').replace(' ', 'T')))
    .filter(Number.isFinite)
  const latestImportDay = datedImports.length
    ? localDateKey(datedImports.reduce((latest, timestamp) => Math.max(latest, timestamp), 0))
    : null
  const fallbackNewestId = songs.reduce((latest, song) => Math.max(latest, song.id), 0)
  const tags = db
    .prepare('SELECT song_id AS songId, tag_id AS tagId FROM song_tag')
    .all() as Array<{ songId: number; tagId: number }>
  const tagsBySong = new Map<number, number[]>()
  for (const tag of tags) {
    const list = tagsBySong.get(tag.songId) ?? []
    list.push(tag.tagId)
    tagsBySong.set(tag.songId, list)
  }

  const eventsBySong = new Map<number, EventRow[]>()
  for (const event of events) {
    const list = eventsBySong.get(event.songId) ?? []
    list.push(event)
    eventsBySong.set(event.songId, list)
  }

  const artistAffinity = new Map<string, number>()
  const albumAffinity = new Map<string, number>()
  const genreAffinity = new Map<string, number>()
  const tagAffinity = new Map<number, number>()
  const eraAffinity = new Map<number, number>()
  const lengthAffinity = new Map<string, number>()
  const artistCatalogue = new Map<string, number>()
  const albumCatalogue = new Map<string, number>()
  const genreCatalogue = new Map<string, number>()
  const tagCatalogue = new Map<number, number>()
  const eraCatalogue = new Map<number, number>()
  const lengthCatalogue = new Map<string, number>()
  for (const song of songs) {
    const artist = normalize(song.artist)
    const album = normalize(song.album)
    const genre = normalize(song.genre)
    const era = eraOf(song.year)
    const length = lengthOf(song.duration)
    if (artist) add(artistCatalogue, artist, 1)
    if (artist && album) add(albumCatalogue, `${artist}\0${album}`, 1)
    if (genre) add(genreCatalogue, genre, 1)
    if (era !== null) add(eraCatalogue, era, 1)
    if (length) add(lengthCatalogue, length, 1)
    for (const tagId of tagsBySong.get(song.id) ?? []) add(tagCatalogue, tagId, 1)
  }
  const base = songs.map((song) => {
    const recent = eventsBySong.get(song.id) ?? []
    let completions = 0
    let skips = 0
    let listened = 0
    let intent = 0
    let engagedRecent = 0
    let latest = 0
    const activeDays = new Set<string>()
    for (const event of recent) {
      const duration = event.durationMs || (song.duration ?? 0) * 1000
      const ratio = duration > 0 ? event.playedMs / duration : 0
      const ageDays = Math.max(0, (now - event.startedAt) / 86400_000)
      const decay = Math.exp(-ageDays / 90)
      if (duration > 0 ? ratio >= 0.8 : event.endReason === 'ended' && event.playedMs >= 60_000)
        completions += decay
      if (
        ['next', 'previous', 'selected'].includes(event.endReason) &&
        ratio < 0.25 &&
        event.playedMs < 30_000
      )
        skips += decay
      listened += decay * clamp(ratio, 0, 1)
      if (ratio >= 0.35 || event.playedMs >= 60_000) {
        if (event.startOrigin === 'search') intent += decay * 0.8
        else if (event.startOrigin === 'return') intent += decay * 0.65
        else if (event.startOrigin === 'manual' || event.startOrigin === 'recommendation')
          intent += decay * 0.25
      }
      latest = Math.max(latest, event.endedAt)
      if (ratio >= 0.6) activeDays.add(new Date(event.startedAt).toDateString())
      if (
        ratio >= 0.5 ||
        (duration <= 0 && event.endReason === 'ended' && event.playedMs >= 60_000)
      )
        engagedRecent++
    }
    const preference = song.preference
    const playTimes = Math.max(0, song.playTimes - (todayStarts.get(song.id) ?? 0))
    // play_times counts starts. Remove sessions already represented by detailed events.
    const legacyPlays = Math.max(0, playTimes - recent.length)
    const engagedPlays = legacyPlays + engagedRecent
    // An early skip of a familiar song is weak evidence: it may mean the listener wants variety.
    const skipReliability = Math.max(0.25, 1 / (1 + engagedPlays / 3))
    const behaviorParts = {
      completion: completions * 1.2,
      listened: listened * 0.45,
      repeat: Math.min(2, Math.max(0, activeDays.size - 1) * 0.8),
      intent: Math.min(2, intent),
      skips: -skips * 0.85 * skipReliability,
      history: Math.min(1.5, Math.log1p(legacyPlays) * 0.35)
    }
    const evidence = Object.values(behaviorParts).reduce((sum, part) => sum + part, 0)
    const positive = preference === 1 ? 3 : clamp(evidence, -2, 4)
    if (positive > 0.5 && preference !== -1) {
      const contribution = Math.min(2, positive) / 2
      const artist = normalize(song.artist)
      const album = normalize(song.album)
      const genre = normalize(song.genre)
      const era = eraOf(song.year)
      const length = lengthOf(song.duration)
      if (artist) add(artistAffinity, artist, contribution)
      if (artist && album) add(albumAffinity, `${artist}\0${album}`, contribution)
      if (genre) add(genreAffinity, genre, contribution)
      if (era !== null) add(eraAffinity, era, contribution)
      if (length) add(lengthAffinity, length, contribution)
      for (const tagId of tagsBySong.get(song.id) ?? []) add(tagAffinity, tagId, contribution)
    }
    return {
      song,
      playTimes,
      preference,
      completions,
      skips,
      evidence,
      latest,
      engagedPlays,
      recentEngagedPlays: engagedRecent,
      behaviorParts
    }
  })

  return base.map(
    ({
      song,
      playTimes,
      preference,
      completions,
      skips,
      evidence,
      latest,
      engagedPlays,
      recentEngagedPlays,
      behaviorParts
    }) => {
      const plays = Math.max(playTimes, eventsBySong.get(song.id)?.length ?? 0)
      const artist = normalize(song.artist)
      const album = normalize(song.album)
      const genre = normalize(song.genre)
      const era = eraOf(song.year)
      const length = lengthOf(song.duration)
      const artistMatch = affinity(artist || null, artistAffinity, artistCatalogue)
      const albumMatch = affinity(
        artist && album ? `${artist}\0${album}` : null,
        albumAffinity,
        albumCatalogue
      )
      const genreMatch = affinity(genre || null, genreAffinity, genreCatalogue)
      const tagMatch = Math.min(
        1,
        Math.max(
          0,
          ...(tagsBySong.get(song.id) ?? []).map((id) => affinity(id, tagAffinity, tagCatalogue))
        )
      )
      const eraMatch = affinity(era, eraAffinity, eraCatalogue)
      const lengthMatch = affinity(length, lengthAffinity, lengthCatalogue)
      const artistBoost = artistMatch * 0.2
      const albumBoost = albumMatch * 0.18
      const genreBoost = genreMatch * 0.16
      const tagBoost = tagMatch * 0.18
      const eraBoost = eraMatch * 0.08
      const lengthBoost = lengthMatch * 0.06
      const similarity = artistBoost + albumBoost + genreBoost + tagBoost + eraBoost + lengthBoost
      const recentPenalty = latest ? 1 - 0.3 * Math.exp(-(now - latest) / (48 * 3600_000)) : 1
      const exploration = recentEngagedPlays === 0 ? 1.25 : recentEngagedPlays <= 2 ? 1.08 : 1
      const behavior = clamp(evidence, -1.5, 4) * 0.5
      const feedback = preference === 1 ? 1.5 : 0
      const isNewest = dailySnapshot
        ? latestImportDay
          ? localDateKey(Date.parse((song.createdAt ?? '').replace(' ', 'T'))) === latestImportDay
          : song.id === fallbackNewestId
        : song.isNewest === 1
      const freshness = isNewest ? 0.45 * Math.exp(-importAgeDays(song.createdAt, now) / 21) : 0
      const variation = dailyVariation(song.id, now)
      const weight =
        preference === -1
          ? 0.06
          : clamp(
              (1 + behavior + similarity + feedback + freshness) *
                exploration *
                recentPenalty *
                variation,
              0.1,
              6
            )
      let reason: RecommendationReason = 'unheard'
      if (preference === -1) reason = 'lessRecommended'
      else if (preference === 1) reason = 'liked'
      else if (skips >= 1.5 && skips > completions + Math.log1p(engagedPlays) * 0.8)
        reason = 'skipped'
      else if (completions >= 2) reason = 'replayed'
      else if (completions >= 0.8) reason = 'finished'
      else if (behaviorParts.intent >= 0.6) reason = 'activelyChosen'
      else if (freshness >= 0.1) reason = 'recentlyAdded'
      else if (tagBoost >= 0.02) reason = 'similarTag'
      else if (albumBoost >= 0.03) reason = 'similarAlbum'
      else if (genreBoost >= 0.02) reason = 'similarGenre'
      else if (artistBoost >= 0.02) reason = 'similarArtist'
      else if (eraBoost >= 0.015) reason = 'similarEra'
      else if (lengthBoost >= 0.015) reason = 'similarLength'
      return {
        songId: song.id,
        artistKey: artist || `song:${song.id}`,
        weight,
        preference,
        plays,
        engagedPlays,
        recentEngagedPlays,
        recentPlays: eventsBySong.get(song.id)?.length ?? 0,
        completions,
        skips,
        factors: {
          behavior,
          artist: artistBoost,
          album: albumBoost,
          genre: genreBoost,
          tag: tagBoost,
          era: eraBoost,
          length: lengthBoost,
          feedback,
          freshness,
          exploration,
          recency: recentPenalty,
          variation
        },
        behaviorParts,
        reason
      }
    }
  )
}

/** Interleave artists so a high scoring catalogue by one artist cannot fill Discover. */
export function diversifyByArtist<T extends { artistKey: string }>(items: T[], limit: number): T[] {
  const groups = new Map<string, { items: T[]; index: number }>()
  for (const item of items) {
    const group = groups.get(item.artistKey) ?? { items: [], index: 0 }
    group.items.push(item)
    groups.set(item.artistKey, group)
  }
  const result: T[] = []
  while (result.length < limit && groups.size) {
    for (const [artist, group] of groups) {
      const next = group.items[group.index++]
      if (next) result.push(next)
      if (group.index >= group.items.length) groups.delete(artist)
      if (result.length >= limit) break
    }
  }
  return result
}

/** Reserve roughly one in three Discover slots for locally underplayed tracks. */
function mixDiscovery(items: RecommendationScore[], limit: number): RecommendationScore[] {
  const coldTarget = Math.ceil(Math.min(limit, items.length) / 3)
  const coldCandidates = items
    .filter((score) => score.engagedPlays <= 1)
    .sort(
      (a, b) =>
        metadataBoost(a) - metadataBoost(b) ||
        a.engagedPlays - b.engagedPlays ||
        a.recentPlays - b.recentPlays ||
        b.factors.freshness - a.factors.freshness ||
        b.factors.variation - a.factors.variation
    )
    .slice(0, coldTarget)
  const coldIds = new Set(coldCandidates.map((score) => score.songId))
  const cold = diversifyByArtist(coldCandidates, limit)
  const related = diversifyByArtist(
    items.filter((score) => !coldIds.has(score.songId)).sort((a, b) => b.weight - a.weight),
    limit
  )
  const result: RecommendationScore[] = []
  let coldIndex = 0
  let relatedIndex = 0
  while (result.length < limit && (coldIndex < cold.length || relatedIndex < related.length)) {
    if (result.length % 3 === 2 && coldIndex < cold.length)
      result.push({ ...cold[coldIndex++], discoveryKind: 'cold', reason: 'unheard' })
    else if (relatedIndex < related.length) result.push(related[relatedIndex++])
    else result.push({ ...cold[coldIndex++], discoveryKind: 'cold', reason: 'unheard' })
  }
  return result
}

export function selectRecommendationGroups(
  scores: RecommendationScore[],
  limit: number
): {
  recommended: RecommendationScore[]
  discovery: RecommendationScore[]
  lessRecommended: RecommendationScore[]
} {
  const eligible = scores.filter((score) => score.preference !== -1)
  const favorites = eligible
    .filter(
      (score) =>
        score.preference === 1 ||
        (score.reason !== 'skipped' &&
          (score.completions >= 0.8 ||
            score.engagedPlays >= 3 ||
            (score.behaviorParts?.intent ?? 0) >= 1 ||
            (score.engagedPlays > 1 && score.weight > 1)))
    )
    .sort(
      (a, b) =>
        Number(b.preference === 1) - Number(a.preference === 1) ||
        b.weight - a.weight ||
        b.plays - a.plays
    )
  const favoriteIds = new Set(favorites.map((score) => score.songId))
  return {
    recommended: favorites.slice(0, limit),
    discovery: mixDiscovery(
      eligible.filter(
        (score) =>
          score.engagedPlays <= 2 && score.reason !== 'skipped' && !favoriteIds.has(score.songId)
      ),
      limit
    ),
    lessRecommended: scores
      .filter((score) => score.preference === -1 || score.reason === 'skipped')
      .sort((a, b) => a.weight - b.weight)
      .slice(0, limit)
  }
}

export function getDailyRecommendationGroups(at = Date.now()): {
  generatedFor: string
  dataThrough: string
  recommended: RecommendationScore[]
  discovery: RecommendationScore[]
  lessRecommended: RecommendationScore[]
} {
  const date = new Date(at)
  const cutoffAt = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const generatedFor = localDateKey(cutoffAt)
  const dataThrough = localDateKey(cutoffAt - 1)
  const db = getDatabase()
  const oldestDate = localDateKey(
    new Date(date.getFullYear(), date.getMonth(), date.getDate() - 2).getTime()
  )
  db.prepare('DELETE FROM recommendation_daily WHERE local_date < ?').run(oldestDate)
  const cached = db
    .prepare(
      'SELECT cutoff_at AS cutoffAt, groups_json AS groupsJson FROM recommendation_daily WHERE local_date = ?'
    )
    .get(generatedFor) as { cutoffAt: number; groupsJson: string } | undefined
  if (cached?.cutoffAt === cutoffAt) {
    try {
      const groups = JSON.parse(cached.groupsJson) as ReturnType<typeof selectRecommendationGroups>
      if (
        Array.isArray(groups.recommended) &&
        Array.isArray(groups.discovery) &&
        Array.isArray(groups.lessRecommended)
      )
        return { generatedFor, dataThrough, ...groups }
    } catch {
      // Rebuild a corrupt or outdated local snapshot.
    }
  }
  const groups = selectRecommendationGroups(getRecommendationScores(cutoffAt, true), 100)
  db.prepare(
    `INSERT INTO recommendation_daily (local_date, cutoff_at, groups_json, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(local_date) DO UPDATE SET
       cutoff_at = excluded.cutoff_at,
       groups_json = excluded.groups_json,
       created_at = excluded.created_at`
  ).run(generatedFor, cutoffAt, JSON.stringify(groups), at)
  return { generatedFor, dataThrough, ...groups }
}

export function getRecentDiscoveryGroups(at = Date.now()): Array<{
  generatedFor: string
  scores: RecommendationScore[]
}> {
  const today = getDailyRecommendationGroups(at).generatedFor
  const date = new Date(at)
  const oldestDate = localDateKey(
    new Date(date.getFullYear(), date.getMonth(), date.getDate() - 2).getTime()
  )
  const rows = getDatabase()
    .prepare(
      `SELECT local_date AS generatedFor, groups_json AS groupsJson
       FROM recommendation_daily WHERE local_date BETWEEN ? AND ?
       ORDER BY local_date DESC LIMIT 3`
    )
    .all(oldestDate, today) as Array<{ generatedFor: string; groupsJson: string }>
  return rows.flatMap(({ generatedFor, groupsJson }) => {
    try {
      const groups = JSON.parse(groupsJson) as { discovery?: RecommendationScore[] }
      return Array.isArray(groups.discovery)
        ? [
            {
              generatedFor,
              scores: groups.discovery.filter(
                (score) => Number.isInteger(score?.songId) && score.songId > 0
              )
            }
          ]
        : []
    } catch {
      return []
    }
  })
}

export function invalidateDailyRecommendations(): void {
  getDatabase()
    .prepare("DELETE FROM recommendation_daily WHERE local_date = date('now', 'localtime')")
    .run()
}

export function recordPlayEvent(input: {
  songId: number
  startedAt: number
  playedMs: number
  durationMs: number
  endReason: 'ended' | 'next' | 'previous' | 'selected' | 'stopped' | 'closed'
  startOrigin?: 'automatic' | 'manual' | 'search' | 'return' | 'recommendation'
}): void {
  if (!Number.isInteger(input.songId) || input.songId <= 0) return
  if (!Number.isFinite(input.playedMs) || input.playedMs < 1000) return
  if (!Number.isFinite(input.startedAt) || !Number.isFinite(input.durationMs)) return
  if (!['ended', 'next', 'previous', 'selected', 'stopped', 'closed'].includes(input.endReason))
    return
  const origin =
    input.startOrigin &&
    ['automatic', 'manual', 'search', 'return', 'recommendation'].includes(input.startOrigin)
      ? input.startOrigin
      : 'automatic'
  const db = getDatabase()
  const playedMs = Math.round(input.playedMs)
  const durationMs = Math.max(0, Math.round(input.durationMs))
  const endedAt = Date.now()
  db.transaction(() => {
    const updated = db
      .prepare(
        `UPDATE play_history
         SET played_ms = ?, duration_ms = ?, end_reason = ?, start_origin = ?, ended_at = ?
         WHERE id = (
           SELECT id FROM play_history WHERE song_id = ? AND started_at = ?
           ORDER BY id DESC LIMIT 1
         )`
      )
      .run(playedMs, durationMs, input.endReason, origin, endedAt, input.songId, input.startedAt)
    if (updated.changes) return
    // A close event can arrive before the asynchronous start IPC; the start writer
    // checks for this row and will not create a second one.
    db.prepare(
      'INSERT INTO play_history (song_id, started_at, played_ms, duration_ms, end_reason, start_origin, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(input.songId, input.startedAt, playedMs, durationMs, input.endReason, origin, endedAt)
  })()
}

export function setSongPreference(songId: number, preference: -1 | 0 | 1): void {
  if (!Number.isInteger(songId) || songId <= 0) return
  if (preference !== -1 && preference !== 0 && preference !== 1) return
  getDatabase().prepare('UPDATE song SET preference = ? WHERE id = ?').run(preference, songId)
}
