import { t } from '../../i18n'
import { safeStorage } from 'electron'
import { getDatabase } from '../index'
import { invalidateDailyRecommendations } from '../recommendations'
import { Logger } from '../../service/loggerService'
import { refreshNewestSongs } from '../newestSongs'
import type { MusicSource, MusicSourceInput } from '../types'

const SOURCE_COLUMNS =
  'id, name, type, server, base_url AS baseUrl, user, secret, auth_type AS authType, status, source_order AS sourceOrder, imported_count AS importedCount, song_count AS songCount, last_connect AS lastConnect'

const sourceCredentialWarnings = new Map<number, MusicSource['credentialError']>()

export function listSources(): MusicSource[] {
  const sources = getDatabase()
    .prepare(`SELECT ${SOURCE_COLUMNS} FROM music_source ORDER BY source_order, id`)
    .all() as MusicSource[]
  return sources.map(readSourceCredentials)
}

const SOURCE_SECRET_PREFIX = 'safe:v1:'

function encryptSourceSecret(secret: string | null | undefined): string | null {
  if (!secret) return null
  if (!safeStorage.isEncryptionAvailable()) throw new Error(t('credentialEncryptUnavailable'))
  return `${SOURCE_SECRET_PREFIX}${safeStorage.encryptString(secret).toString('base64')}`
}

function readSourceCredentials(source: MusicSource): MusicSource {
  const secret = source.secret
  if (!secret || !secret.startsWith(SOURCE_SECRET_PREFIX)) {
    sourceCredentialWarnings.delete(source.id)
    return source
  }
  let credentialError: MusicSource['credentialError'] = 'unavailable'
  try {
    if (safeStorage.isEncryptionAvailable()) {
      credentialError = 'decrypt-failed'
      const plaintext = safeStorage.decryptString(
        Buffer.from(secret.slice(SOURCE_SECRET_PREFIX.length), 'base64')
      )
      sourceCredentialWarnings.delete(source.id)
      return { ...source, secret: plaintext }
    }
  } catch {
    // The ciphertext may belong to another OS key store or be damaged. Listing
    // sources must not erase it or prevent unrelated sources from loading.
  }
  if (sourceCredentialWarnings.get(source.id) !== credentialError) {
    Logger.warn('[Remote source] saved credential unavailable', {
      sourceId: source.id,
      type: source.type,
      credentialError,
      action:
        credentialError === 'decrypt-failed' ? 're-enter password' : 'restore system key store'
    })
    sourceCredentialWarnings.set(source.id, credentialError)
  }
  return { ...source, secret: null, credentialError }
}

/** Encrypt legacy plaintext credentials after the app's key store is available. */
export function migrateSourceSecrets(): void {
  if (!safeStorage.isEncryptionAvailable()) return
  const db = getDatabase()
  const rows = db
    .prepare('SELECT id, secret FROM music_source WHERE secret IS NOT NULL')
    .all() as Array<{
    id: number
    secret: string
  }>
  const update = db.prepare('UPDATE music_source SET secret = ? WHERE id = ?')
  db.transaction(() => {
    for (const row of rows) {
      if (!row.secret.startsWith(SOURCE_SECRET_PREFIX))
        update.run(encryptSourceSecret(row.secret), row.id)
    }
  })()
}

export function createSource(input: MusicSourceInput): MusicSource {
  const db = getDatabase()
  const result = db
    .prepare(
      `INSERT INTO music_source (name, type, server, base_url, user, secret, auth_type, status, source_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(source_order), 0) + 1 FROM music_source))`
    )
    .run(
      input.name,
      input.type ?? null,
      input.server ?? null,
      input.baseUrl ?? null,
      input.user ?? null,
      encryptSourceSecret(input.secret),
      input.authType ?? null,
      input.status ?? null
    )
  return getSource(Number(result.lastInsertRowid))!
}

export function updateSource(source: MusicSource): boolean {
  // A null password returned after a failed read is not a request to erase the
  // saved ciphertext. Keep it when updating other source fields.
  const retained =
    source.credentialError && !source.secret
      ? (getDatabase().prepare('SELECT secret FROM music_source WHERE id = ?').get(source.id) as
          { secret: string | null } | undefined)
      : undefined
  const storedSecret = retained ? retained.secret : encryptSourceSecret(source.secret)
  return (
    getDatabase()
      .prepare(
        'UPDATE music_source SET name = ?, type = ?, server = ?, base_url = ?, user = ?, secret = ?, auth_type = ?, status = ?, source_order = ?, imported_count = ?, song_count = ?, last_connect = ? WHERE id = ?'
      )
      .run(
        source.name,
        source.type,
        source.server,
        source.baseUrl,
        source.user,
        storedSecret,
        source.authType,
        source.status,
        source.sourceOrder,
        source.importedCount,
        source.songCount,
        source.lastConnect,
        source.id
      ).changes > 0
  )
}

export function deleteSource(id: number): boolean {
  sourceCredentialWarnings.delete(id)
  const db = getDatabase()
  const deleted = db.prepare('DELETE FROM music_source WHERE id = ?').run(id).changes > 0
  if (deleted) {
    refreshNewestSongs(db)
    invalidateDailyRecommendations()
  }
  return deleted
}

export function getSource(id: number): MusicSource | null {
  const source = getDatabase()
    .prepare(`SELECT ${SOURCE_COLUMNS} FROM music_source WHERE id = ?`)
    .get(id) as MusicSource | undefined
  return source ? readSourceCredentials(source) : null
}

export function reorderSources(items: Array<{ id: number; sourceOrder: number }>): void {
  const stmt = getDatabase().prepare('UPDATE music_source SET source_order = ? WHERE id = ?')
  getDatabase().transaction(() => items.forEach((item) => stmt.run(item.sourceOrder, item.id)))()
}

export function touchSource(id: number): boolean {
  return (
    getDatabase()
      .prepare("UPDATE music_source SET last_connect = datetime('now', 'localtime') WHERE id = ?")
      .run(id).changes > 0
  )
}

export function updateSourceStats(id: number, importedCount: number, songCount: number): boolean {
  return (
    getDatabase()
      .prepare('UPDATE music_source SET imported_count = ?, song_count = ? WHERE id = ?')
      .run(importedCount, songCount, id).changes > 0
  )
}
