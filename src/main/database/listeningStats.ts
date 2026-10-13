import type Database from 'better-sqlite3'

export type ListeningPeriodId =
  'lateNight' | 'morning' | 'noon' | 'earlyAfternoon' | 'afternoon' | 'evening'

export interface ListeningPeriod {
  id: ListeningPeriodId
  playedSeconds: number
  plays: number
}

export interface ListeningInsights {
  eligiblePlays: number
  completedPlays: number
  timePeriods: ListeningPeriod[]
}

export function getListeningInsights(db: Database.Database): ListeningInsights {
  const completion = db
    .prepare(
      `WITH eligible AS (
         SELECT ph.played_ms AS playedMs,
                COALESCE(NULLIF(ph.duration_ms, 0), NULLIF(s.duration, 0) * 1000) AS durationMs
         FROM play_history ph LEFT JOIN song s ON s.id = ph.song_id
         WHERE ph.played_ms >= 5000
       )
       SELECT COUNT(*) AS eligiblePlays,
              COALESCE(SUM(CASE WHEN playedMs >= durationMs * 0.9 THEN 1 ELSE 0 END), 0) AS completedPlays
       FROM eligible WHERE durationMs > 0`
    )
    .get() as { eligiblePlays: number; completedPlays: number }

  const periods: ListeningPeriod[] = [
    { id: 'lateNight', playedSeconds: 0, plays: 0 },
    { id: 'morning', playedSeconds: 0, plays: 0 },
    { id: 'noon', playedSeconds: 0, plays: 0 },
    { id: 'earlyAfternoon', playedSeconds: 0, plays: 0 },
    { id: 'afternoon', playedSeconds: 0, plays: 0 },
    { id: 'evening', playedSeconds: 0, plays: 0 }
  ]
  const hours = db
    .prepare(
      `SELECT CAST(strftime('%H', started_at / 1000.0, 'unixepoch', 'localtime') AS INTEGER) AS hour,
              SUM(played_ms) AS playedMs, COUNT(*) AS plays
       FROM play_history WHERE played_ms > 0 GROUP BY hour`
    )
    .all() as Array<{ hour: number | null; playedMs: number; plays: number }>
  for (const { hour, playedMs, plays } of hours) {
    if (hour === null) continue
    const index = hour < 6 ? 0 : hour < 11 ? 1 : hour < 13 ? 2 : hour < 15 ? 3 : hour < 18 ? 4 : 5
    periods[index].playedSeconds += playedMs / 1000
    periods[index].plays += plays
  }
  return { ...completion, timePeriods: periods }
}
