import type Database from 'better-sqlite3'

const MIB = 1024 * 1024
export const HIGH_QUALITY_MIN_KBPS = 320
export const ULTRA_QUALITY_MIN_KBPS = 500
export const LOSSLESS_QUALITY_MIN_KBPS = 800
export const HIGH_QUALITY_MIN_MIB = 10
export const ULTRA_QUALITY_MIN_MIB = 20
export const LOSSLESS_QUALITY_MIN_MIB = 30

export interface QualityBucket {
  count: number
  bytes: number
}

export interface LibraryQualityStats {
  standard: QualityBucket
  high: QualityBucket
  ultra: QualityBucket
  lossless: QualityBucket
  bitrateCount: number
  sizeFallbackCount: number
  unknownCount: number
  thresholds: {
    highKbps: number
    ultraKbps: number
    losslessKbps: number
    highMiB: number
    ultraMiB: number
    losslessMiB: number
  }
}

/** Bitrate takes precedence; file size is an estimate only when bitrate is missing. */
export function getLibraryQualityStats(db: Database.Database): LibraryQualityStats {
  const params = {
    highKbps: HIGH_QUALITY_MIN_KBPS,
    ultraKbps: ULTRA_QUALITY_MIN_KBPS,
    losslessKbps: LOSSLESS_QUALITY_MIN_KBPS,
    highBytes: HIGH_QUALITY_MIN_MIB * MIB,
    ultraBytes: ULTRA_QUALITY_MIN_MIB * MIB,
    losslessBytes: LOSSLESS_QUALITY_MIN_MIB * MIB
  }
  const row = db
    .prepare(
      `WITH classified AS (
         SELECT file_size,
           CASE
             WHEN bitrate > 0 THEN CASE
               WHEN bitrate < @highKbps THEN 'standard'
               WHEN bitrate < @ultraKbps THEN 'high'
               WHEN bitrate < @losslessKbps THEN 'ultra'
               ELSE 'lossless' END
             WHEN file_size > 0 THEN CASE
               WHEN file_size < @highBytes THEN 'standard'
               WHEN file_size < @ultraBytes THEN 'high'
               WHEN file_size < @losslessBytes THEN 'ultra'
               ELSE 'lossless' END
           END AS tier,
           CASE WHEN bitrate > 0 THEN 'bitrate'
                WHEN file_size > 0 THEN 'size' END AS basis
         FROM song
       )
       SELECT
         COALESCE(SUM(CASE WHEN tier = 'standard' THEN 1 ELSE 0 END), 0) AS standardCount,
         COALESCE(SUM(CASE WHEN tier = 'standard' AND file_size > 0 THEN file_size ELSE 0 END), 0) AS standardBytes,
         COALESCE(SUM(CASE WHEN tier = 'high' THEN 1 ELSE 0 END), 0) AS highCount,
         COALESCE(SUM(CASE WHEN tier = 'high' AND file_size > 0 THEN file_size ELSE 0 END), 0) AS highBytes,
         COALESCE(SUM(CASE WHEN tier = 'ultra' THEN 1 ELSE 0 END), 0) AS ultraCount,
         COALESCE(SUM(CASE WHEN tier = 'ultra' AND file_size > 0 THEN file_size ELSE 0 END), 0) AS ultraBytes,
         COALESCE(SUM(CASE WHEN tier = 'lossless' THEN 1 ELSE 0 END), 0) AS losslessCount,
         COALESCE(SUM(CASE WHEN tier = 'lossless' AND file_size > 0 THEN file_size ELSE 0 END), 0) AS losslessBytes,
         COALESCE(SUM(CASE WHEN basis = 'bitrate' THEN 1 ELSE 0 END), 0) AS bitrateCount,
         COALESCE(SUM(CASE WHEN basis = 'size' THEN 1 ELSE 0 END), 0) AS sizeFallbackCount,
         COALESCE(SUM(CASE WHEN tier IS NULL THEN 1 ELSE 0 END), 0) AS unknownCount
       FROM classified`
    )
    .get(params) as {
    standardCount: number
    standardBytes: number
    highCount: number
    highBytes: number
    ultraCount: number
    ultraBytes: number
    losslessCount: number
    losslessBytes: number
    bitrateCount: number
    sizeFallbackCount: number
    unknownCount: number
  }
  return {
    standard: { count: row.standardCount, bytes: row.standardBytes },
    high: { count: row.highCount, bytes: row.highBytes },
    ultra: { count: row.ultraCount, bytes: row.ultraBytes },
    lossless: { count: row.losslessCount, bytes: row.losslessBytes },
    bitrateCount: row.bitrateCount,
    sizeFallbackCount: row.sizeFallbackCount,
    unknownCount: row.unknownCount,
    thresholds: {
      highKbps: HIGH_QUALITY_MIN_KBPS,
      ultraKbps: ULTRA_QUALITY_MIN_KBPS,
      losslessKbps: LOSSLESS_QUALITY_MIN_KBPS,
      highMiB: HIGH_QUALITY_MIN_MIB,
      ultraMiB: ULTRA_QUALITY_MIN_MIB,
      losslessMiB: LOSSLESS_QUALITY_MIN_MIB
    }
  }
}
