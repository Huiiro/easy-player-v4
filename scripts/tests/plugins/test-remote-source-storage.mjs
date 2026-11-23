import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const temporary = await mkdtemp(join(tmpdir(), 'easy-player-source-storage-'))
const databasePath = join(temporary, 'sources.db')
let database = new DatabaseSync(databasePath)
database.exec(`CREATE TABLE music_source (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, type TEXT, server TEXT, base_url TEXT,
  user TEXT, secret TEXT, auth_type TEXT, status TEXT, source_order INTEGER DEFAULT 0,
  imported_count INTEGER DEFAULT 0, song_count INTEGER DEFAULT 0, last_connect TEXT
)`)
const key = randomBytes(32)
globalThis.remoteStorageFixture = {
  available: true,
  db: {
    prepare: (sql) => database.prepare(sql),
    transaction: (task) => () => {
      database.exec('BEGIN')
      try {
        task()
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    }
  },
  safeStorage: {
    isAsyncEncryptionAvailable: async () => globalThis.remoteStorageFixture.available,
    async encryptStringAsync(text) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted])
    },
    async decryptStringAsync(buffer) {
      const cipher = createDecipheriv('aes-256-gcm', key, buffer.subarray(0, 12))
      cipher.setAuthTag(buffer.subarray(12, 28))
      return {
        result: Buffer.concat([cipher.update(buffer.subarray(28)), cipher.final()]).toString(
          'utf8'
        ),
        shouldReEncrypt: false
      }
    }
  }
}
const fixtures = {
  electron: 'export const safeStorage = globalThis.remoteStorageFixture.safeStorage',
  '../index': 'export const getDatabase = () => globalThis.remoteStorageFixture.db',
  '../../i18n': 'export const t = key => key',
  '../recommendations': 'export function invalidateDailyRecommendations() {}',
  '../newestSongs': 'export function refreshNewestSongs() {}',
  '../../service/loggerService': 'export const Logger = { warn(){} }'
}
try {
  const outfile = join(temporary, 'repository.mjs')
  await build({
    entryPoints: ['src/main/database/repository/sources.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'storage-host',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) =>
            fixtures[args.path] ? { path: args.path, namespace: 'fixture' } : undefined
          )
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            contents: fixtures[args.path]
          }))
        }
      }
    ]
  })
  let repository = await import(pathToFileURL(outfile).href)
  const input = {
    name: 'SFTP',
    type: 'sftp',
    baseUrl: 'sftp://nas/music/',
    hostKey: 'SHA256:' + 'A'.repeat(43),
    auth: {
      type: 'private-key',
      username: 'user',
      privateKey: 'synthetic private key',
      passphrase: 'private passphrase'
    }
  }
  const source = await repository.createSource(input)
  assert.deepEqual(source.auth, input.auth)
  await assert.rejects(repository.createSource({ ...input, name: '  SFTP  ' }), /sourceNameExists/)
  const otherInput = { ...input, name: 'Other' }
  const [created, duplicate] = await Promise.allSettled([
    repository.createSource(otherInput),
    repository.createSource(otherInput)
  ])
  assert.equal(created.status, 'fulfilled')
  assert.equal(duplicate.status, 'rejected')
  assert.match(duplicate.reason.message, /sourceNameExists/)
  const another = created.value
  await assert.rejects(repository.updateSource({ ...another, name: ' SFTP ' }), /sourceNameExists/)
  assert.equal((await repository.getSource(another.id)).name, 'Other')
  assert.equal(await repository.updateSource({ ...source, name: ' SFTP ' }), true)

  for (const field of ['user', 'secret', 'authType', 'server'])
    assert.equal(field in source, false, `storage field ${field} must not cross IPC`)
  const stored = database.prepare('SELECT * FROM music_source WHERE id = ?').get(source.id)
  assert(stored.secret.startsWith('safe:v1:'))
  assert.equal(stored.user, null)
  for (const secret of ['synthetic private key', 'private passphrase', 'user'])
    assert.equal(stored.secret.includes(secret), false)
  database.close()
  database = new DatabaseSync(databasePath)
  repository = await import(pathToFileURL(outfile).href + '?restart')
  assert.deepEqual((await repository.getSource(source.id)).auth, input.auth)
  globalThis.remoteStorageFixture.available = false
  const locked = await repository.getSource(source.id)
  assert.equal(locked.credentialError, 'unavailable')
  await repository.updateSource({ ...locked, name: 'Renamed while locked' })
  assert.equal(
    database.prepare('SELECT secret FROM music_source WHERE id = ?').get(source.id).secret,
    stored.secret
  )
  globalThis.remoteStorageFixture.available = true
  assert.deepEqual((await repository.getSource(source.id)).auth, input.auth)
  const safeStorage = globalThis.remoteStorageFixture.safeStorage
  const encrypt = safeStorage.encryptStringAsync
  let started
  let resume
  const encrypting = new Promise((resolve) => (started = resolve))
  const continueEncryption = new Promise((resolve) => (resume = resolve))
  safeStorage.encryptStringAsync = async (value) => {
    started()
    await continueEncryption
    return encrypt(value)
  }
  const editing = await repository.getSource(source.id)
  const saving = repository.updateSource({ ...editing, name: 'Edited connection' })
  await encrypting
  repository.reorderSources([{ id: source.id, sourceOrder: 50 }])
  repository.updateSourceStats(source.id, 77, 82)
  repository.touchSource(source.id)
  const synced = await repository.getSource(source.id)
  resume()
  assert.equal(await saving, true)
  safeStorage.encryptStringAsync = encrypt
  assert.deepEqual(await repository.getSource(source.id), { ...synced, name: 'Edited connection' })
  const token = { type: 'bearer', token: 'secret-token' }
  const dav = await repository.createSource({
    name: 'DAV',
    type: 'webdav',
    baseUrl: 'https://nas/music/',
    auth: token
  })
  assert.deepEqual((await repository.getSource(dav.id)).auth, token)
  const anonymous = await repository.createSource({
    name: 'Anonymous',
    type: 'ftp',
    baseUrl: 'ftp://nas/music/',
    auth: { type: 'anonymous' }
  })
  assert.equal(
    database.prepare('SELECT secret FROM music_source WHERE id = ?').get(anonymous.id).secret,
    null
  )
  await repository.updateSource({ ...dav, auth: { type: 'anonymous' } })
  assert.equal(
    database.prepare('SELECT secret FROM music_source WHERE id = ?').get(dav.id).secret,
    null,
    'changing auth removes unused secrets'
  )
  database
    .prepare(
      "INSERT INTO music_source (name,type,base_url,user,secret) VALUES ('Legacy','navidrome','https://nas','old-user','old-password')"
    )
    .run()
  await repository.migrateSourceSecrets()
  const legacy = (await repository.listSources()).find((source) => source.name === 'Legacy')
  assert.match(
    database.prepare('SELECT secret FROM music_source WHERE id = ?').get(legacy.id).secret,
    /^safe:v1:/
  )
  assert.deepEqual(legacy.auth, {
    type: 'password',
    username: 'old-user',
    password: 'old-password'
  })
  globalThis.remoteStorageFixture.available = false
  const lockedLegacy = await repository.getSource(legacy.id)
  await repository.updateSource({ ...lockedLegacy, name: 'Legacy' })
  assert.equal(
    database.prepare('SELECT user FROM music_source WHERE id = ?').get(legacy.id).user,
    'old-user'
  )
  globalThis.remoteStorageFixture.available = true
  assert.deepEqual((await repository.getSource(legacy.id)).auth, legacy.auth)
  await repository.updateSource(legacy)
  assert.equal(
    database.prepare('SELECT auth_type FROM music_source WHERE id = ?').get(legacy.id).auth_type,
    'v2:password'
  )
  await assert.rejects(
    repository.createSource({ name: 'Bad', type: 'ftp', baseUrl: 'ftp://nas', auth: token })
  )
  database.prepare("UPDATE music_source SET secret = 'safe:v1:damaged' WHERE id = ?").run(source.id)
  assert.equal((await repository.getSource(source.id)).credentialError, 'decrypt-failed')
  console.log(
    'Remote storage passed: real SQLite restart, encrypted auth envelopes, legacy conversion, locked credential retention, auth changes and corrupt secrets'
  )
} finally {
  database.close()
  delete globalThis.remoteStorageFixture
  await rm(temporary, { recursive: true, force: true })
}
