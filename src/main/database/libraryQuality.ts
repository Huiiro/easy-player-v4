import type Database from 'better-sqlite3'

const MIB = 1024 * 1024
export const HIGH_QUALITY_MIN_MIB = 10
export const LOSSLESS_QUALITY_MIN_MIB = 30

export interface QualityBucket {
  count: number
  bytes: number
}

export interface LibraryQualityStats {
  standard: QualityBucket
  high: QualityBucket
  lossless: QualityBucket
  unknownCount: number
  thresholds: { highMiB: number; losslessMiB: number }
}

/** File size is only a proxy for quality; missing sizes remain unclassified. */
export function getLibraryQualityStats(db: Database.Database): LibraryQualityStats {
  const highMin = HIGH_QUALITY_MIN_MIB * MIB
  const losslessMin = LOSSLESS_QUALITY_MIN_MIB * MIB
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN file_size > 0 AND file_size < @highMin THEN 1 ELSE 0 END), 0) AS standardCount,
         COALESCE(SUM(CASE WHEN file_size > 0 AND file_size < @highMin THEN file_size ELSE 0 END), 0) AS standardBytes,
         COALESCE(SUM(CASE WHEN file_size >= @highMin AND file_size < @losslessMin THEN 1 ELSE 0 END), 0) AS highCount,
         COALESCE(SUM(CASE WHEN file_size >= @highMin AND file_size < @losslessMin THEN file_size ELSE 0 END), 0) AS highBytes,
         COALESCE(SUM(CASE WHEN file_size >= @losslessMin THEN 1 ELSE 0 END), 0) AS losslessCount,
         COALESCE(SUM(CASE WHEN file_size >= @losslessMin THEN file_size ELSE 0 END), 0) AS losslessBytes,
         COALESCE(SUM(CASE WHEN file_size IS NULL OR file_size <= 0 THEN 1 ELSE 0 END), 0) AS unknownCount
       FROM song`
    )
    .get({ highMin, losslessMin }) as {
    standardCount: number
    standardBytes: number
    highCount: number
    highBytes: number
    losslessCount: number
    losslessBytes: number
    unknownCount: number
  }
  return {
    standard: { count: row.standardCount, bytes: row.standardBytes },
    high: { count: row.highCount, bytes: row.highBytes },
    lossless: { count: row.losslessCount, bytes: row.losslessBytes },
    unknownCount: row.unknownCount,
    thresholds: { highMiB: HIGH_QUALITY_MIN_MIB, losslessMiB: LOSSLESS_QUALITY_MIN_MIB }
  }
}
