import { normalizeRemoteConnection, emptyRemoteAuth } from '../../../shared/remoteSources'
import { t } from '../../i18n'
import { safeStorage } from 'electron'
import { getDatabase } from '../index'
import { invalidateDailyRecommendations } from '../recommendations'
import { Logger } from '../../service/loggerService'
import { refreshNewestSongs } from '../newestSongs'
import type { RemoteAuthType } from '../../../shared/remoteSources'
import type { MusicSource, MusicSourceInput } from '../types'

/** Existing SQLite row, kept private to this compatibility boundary. */
interface StoredMusicSource {
  id: number
  name: string
  type: string | null
  server: string | null
  baseUrl: string | null
  user: string | null
  secret: string | null
  authType: string | null
  status: string | null
  sourceOrder: number
  importedCount: number
  songCount: number
  lastConnect: string | null
  credentialError?: MusicSource['credentialError']
}

const SOURCE_COLUMNS =
  'id, name, type, server, base_url AS baseUrl, user, secret, auth_type AS authType, status, source_order AS sourceOrder, imported_count AS importedCount, song_count AS songCount, last_connect AS lastConnect'

const sourceCredentialWarnings = new Map<number, MusicSource['credentialError']>()

export function listSources(): MusicSource[] {
  const sources = getDatabase()
    .prepare(`SELECT ${SOURCE_COLUMNS} FROM music_source ORDER BY source_order, id`)
    .all() as StoredMusicSource[]
  return sources.map(readSourceCredentials)
}

const SOURCE_SECRET_PREFIX = 'safe:v1:'

function encryptSourceSecret(secret: string | null | undefined): string | null {
  if (!secret) return null
  if (!safeStorage.isEncryptionAvailable()) throw new Error(t('credentialEncryptUnavailable'))
  return `${SOURCE_SECRET_PREFIX}${safeStorage.encryptString(secret).toString('base64')}`
}

function decryptSourceCredentials(source: StoredMusicSource): StoredMusicSource {
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

/** v2 stores the complete auth union as one encrypted envelope in the existing secret column. */
function readSourceCredentials(row: StoredMusicSource): MusicSource {
  const source = decryptSourceCredentials(row)
  const versioned = source.authType?.startsWith('v2:')
  const type = (
    versioned
      ? source.authType!.slice(3)
      : source.type === 'smb'
        ? 'system'
        : source.type === 'webdav'
          ? source.user || source.secret
            ? 'basic'
            : 'anonymous'
          : 'password'
  ) as RemoteAuthType
  const { id, name, status, sourceOrder, importedCount, songCount, lastConnect } = source
  const stats = { id, name, status, sourceOrder, importedCount, songCount, lastConnect }
  try {
    if (source.credentialError) throw new Error('Credential unavailable')
    const config = normalizeRemoteConnection(
      versioned
        ? {
            ...source,
            auth: source.secret ? JSON.parse(source.secret) : emptyRemoteAuth(type),
            hostKey: source.server || undefined
          }
        : source
    )
    return { ...stats, ...config }
  } catch {
    return {
      ...stats,
      type: source.type as MusicSource['type'],
      baseUrl: source.baseUrl || '',
      auth: emptyRemoteAuth(type),
      hostKey: versioned ? source.server || undefined : undefined,
      credentialError: source.credentialError || 'invalid-config'
    }
  }
}

function storedConnection(input: MusicSourceInput): {
  type: string
  baseUrl: string
  server: string | null
  secret: string | null
  authType: string
} {
  const config = normalizeRemoteConnection(input)
  return {
    type: config.type,
    baseUrl: config.baseUrl,
    server: config.hostKey || null,
    secret:
      config.auth.type === 'anonymous' || config.auth.type === 'system'
        ? null
        : encryptSourceSecret(JSON.stringify(config.auth)),
    authType: `v2:${config.auth.type}`
  }
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
  if (!input.name?.trim()) throw new Error(t('invalidSourceConfig'))
  const connection = storedConnection(input)
  const db = getDatabase()
  const result = db
    .prepare(
      `INSERT INTO music_source (name, type, server, base_url, user, secret, auth_type, status, source_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(source_order), 0) + 1 FROM music_source))`
    )
    .run(
      input.name,
      connection.type,
      connection.server,
      connection.baseUrl,
      null,
      connection.secret,
      connection.authType,
      input.status ?? null
    )
  return getSource(Number(result.lastInsertRowid))!
}

export function updateSource(source: MusicSource): boolean {
  if (!source.name?.trim()) throw new Error(t('invalidSourceConfig'))
  const current = getSource(source.id)
  const keepCredential =
    current?.credentialError &&
    source.credentialError &&
    current.type === source.type &&
    current.baseUrl === source.baseUrl &&
    current.hostKey === source.hostKey &&
    JSON.stringify(current.auth) === JSON.stringify(source.auth)
  const saved = keepCredential
    ? (getDatabase()
        .prepare(`SELECT ${SOURCE_COLUMNS} FROM music_source WHERE id = ?`)
        .get(source.id) as StoredMusicSource)
    : null
  const connection = saved || storedConnection(source)
  return (
    getDatabase()
      .prepare(
        'UPDATE music_source SET name = ?, type = ?, server = ?, base_url = ?, user = ?, secret = ?, auth_type = ?, status = ?, source_order = ?, imported_count = ?, song_count = ?, last_connect = ? WHERE id = ?'
      )
      .run(
        source.name,
        connection.type,
        connection.server,
        connection.baseUrl,
        saved ? saved.user : null,
        connection.secret,
        connection.authType,
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
    .get(id) as StoredMusicSource | undefined
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
