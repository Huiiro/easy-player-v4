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
let pendingSourceWrite: Promise<unknown> = Promise.resolve()

function enqueueSourceWrite<T>(write: () => Promise<T>): Promise<T> {
  const operation = pendingSourceWrite.then(write)
  pendingSourceWrite = operation.catch(() => {})
  return operation
}

export async function listSources(): Promise<MusicSource[]> {
  const sources = getDatabase()
    .prepare(`SELECT ${SOURCE_COLUMNS} FROM music_source ORDER BY source_order, id`)
    .all() as StoredMusicSource[]
  return Promise.all(sources.map(readSourceCredentials))
}

const SOURCE_SECRET_PREFIX = 'safe:v1:'

async function encryptSourceSecret(secret: string): Promise<string> {
  const encrypted = await safeStorage.encryptStringAsync(secret)
  return `${SOURCE_SECRET_PREFIX}${encrypted.toString('base64')}`
}

async function decryptSourceCredentials(source: StoredMusicSource): Promise<StoredMusicSource> {
  const secret = source.secret
  if (!secret || !secret.startsWith(SOURCE_SECRET_PREFIX)) {
    sourceCredentialWarnings.delete(source.id)
    return source
  }
  let credentialError: MusicSource['credentialError'] = 'unavailable'
  try {
    if (await safeStorage.isAsyncEncryptionAvailable()) {
      credentialError = 'decrypt-failed'
      const { result: plaintext } = await safeStorage.decryptStringAsync(
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
async function readSourceCredentials(row: StoredMusicSource): Promise<MusicSource> {
  const source = await decryptSourceCredentials(row)
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

async function storedConnection(input: MusicSourceInput): Promise<{
  type: string
  baseUrl: string
  server: string | null
  secret: string | null
  authType: string
}> {
  const config = normalizeRemoteConnection(input)
  let secret: string | null = null
  if (config.auth.type !== 'anonymous' && config.auth.type !== 'system') {
    if (!(await safeStorage.isAsyncEncryptionAvailable()))
      throw new Error(t('credentialEncryptUnavailable'))
    secret = await encryptSourceSecret(JSON.stringify(config.auth))
  }
  return {
    type: config.type,
    baseUrl: config.baseUrl,
    server: config.hostKey || null,
    secret,
    authType: `v2:${config.auth.type}`
  }
}

/** Encrypt legacy plaintext credentials after the app's key store is available. */
export async function migrateSourceSecrets(): Promise<void> {
  const db = getDatabase()
  const rows = db
    .prepare(
      'SELECT id, secret FROM music_source WHERE secret IS NOT NULL AND substr(secret, 1, ?) <> ?'
    )
    .all(SOURCE_SECRET_PREFIX.length, SOURCE_SECRET_PREFIX) as Array<{ id: number; secret: string }>
  if (!rows.length || !(await safeStorage.isAsyncEncryptionAvailable())) return
  const encrypted = await Promise.all(
    rows.map((row) => (row.secret ? encryptSourceSecret(row.secret) : null))
  )
  const update = db.prepare('UPDATE music_source SET secret = ? WHERE id = ? AND secret = ?')
  db.transaction(() => {
    rows.forEach((row, index) => update.run(encrypted[index], row.id, row.secret))
  })()
}

export function createSource(input: MusicSourceInput): Promise<MusicSource> {
  return enqueueSourceWrite(() => insertSource(input))
}

async function insertSource(input: MusicSourceInput): Promise<MusicSource> {
  if (!input.name?.trim()) throw new Error(t('invalidSourceConfig'))
  const name = input.name.trim()
  const db = getDatabase()
  if (db.prepare('SELECT id FROM music_source WHERE name = ?').get(name))
    throw new Error(t('sourceNameExists'))
  const connection = await storedConnection(input)
  const result = db
    .prepare(
      `INSERT INTO music_source (name, type, server, base_url, user, secret, auth_type, status, source_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(source_order), 0) + 1 FROM music_source))`
    )
    .run(
      name,
      connection.type,
      connection.server,
      connection.baseUrl,
      null,
      connection.secret,
      connection.authType,
      input.status ?? null
    )
  return (await getSource(Number(result.lastInsertRowid)))!
}

export function updateSource(source: MusicSource): Promise<boolean> {
  return enqueueSourceWrite(() => writeSource(source))
}

async function writeSource(source: MusicSource): Promise<boolean> {
  if (!source.name?.trim()) throw new Error(t('invalidSourceConfig'))
  const name = source.name.trim()
  const db = getDatabase()
  if (db.prepare('SELECT id FROM music_source WHERE name = ? AND id <> ?').get(name, source.id))
    throw new Error(t('sourceNameExists'))
  const row = db
    .prepare(`SELECT ${SOURCE_COLUMNS} FROM music_source WHERE id = ?`)
    .get(source.id) as StoredMusicSource | undefined
  if (!row) return false
  const current = await readSourceCredentials(row)
  const keepCredential =
    current.credentialError &&
    source.credentialError &&
    current.type === source.type &&
    current.baseUrl === source.baseUrl &&
    current.hostKey === source.hostKey &&
    JSON.stringify(current.auth) === JSON.stringify(source.auth)
  const connection = keepCredential ? row : await storedConnection(source)
  return (
    db
      .prepare(
        'UPDATE music_source SET name = ?, type = ?, server = ?, base_url = ?, user = ?, secret = ?, auth_type = ? WHERE id = ?'
      )
      .run(
        name,
        connection.type,
        connection.server,
        connection.baseUrl,
        keepCredential ? row.user : null,
        connection.secret,
        connection.authType,
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

export async function getSource(id: number): Promise<MusicSource | null> {
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
