/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'

const cache = resolve('node_modules/.cache')
await mkdir(cache, { recursive: true })
const directory = await mkdtemp(join(cache, 'recover-moved-'))
const database = new DatabaseSync(':memory:')
database.exec(`
  PRAGMA foreign_keys=ON;
  CREATE TABLE song (
    id INTEGER PRIMARY KEY, audio TEXT NOT NULL UNIQUE, file_name TEXT,
    file_size INTEGER, source_id INTEGER, song_status INTEGER DEFAULT 1,
    play_times INTEGER DEFAULT 0
  );
  CREATE TABLE song_list_item (song_id INTEGER REFERENCES song(id), position INTEGER);
  CREATE TABLE song_tag (song_id INTEGER REFERENCES song(id), tag_id INTEGER);
`)
globalThis.recoveryDatabase = {
  prepare: (sql) => database.prepare(sql),
  transaction: (task) => () => {
    database.exec('BEGIN')
    try {
      const result = task()
      database.exec('COMMIT')
      return result
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
}
const fixtures = {
  '../database': 'export const getDatabase=()=>globalThis.recoveryDatabase',
  '../database/newestSongs': 'export const refreshNewestSongs=()=>{}',
  '../i18n': 'export const t=key=>key',
  './operationLogger': 'export const logOperation=(_name,_context,task)=>task()',
  './audioMetadataService': 'export const parseAudioFile=async()=>null',
  '../utils/pathUtils': 'export const getCoverPath=()=>"",getExportTempPath=()=>""',
  'node:fs': `export * from 'node:fs';import {promises as native} from 'node:fs';
    export const promises={...native,readdir:async(...args)=>{
      const result=await native.readdir(...args);
      const hook=globalThis.onRecoveryRead;delete globalThis.onRecoveryRead;
      if(hook)await hook();return result;
    }}`
}
const insert = database.prepare(
  'INSERT INTO song(id,audio,file_name,file_size,source_id,play_times) VALUES(?,?,?,?,?,?)'
)
const song = (id) => ({ ...database.prepare('SELECT * FROM song WHERE id=?').get(id) })
let scenario = 0
async function reset() {
  database.exec('DELETE FROM song_list_item; DELETE FROM song_tag; DELETE FROM song')
  delete globalThis.onRecoveryRead
  const root = join(directory, `files-${++scenario}`)
  await mkdir(root)
  return root
}
async function file(root, name, size = 10) {
  const path = join(root, name)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, Buffer.alloc(size))
  return path
}
function missing(id, name, size = 10) {
  const audio = join(directory, 'missing', `${id}`, name)
  insert.run(id, audio, name, size, null, 7)
  return audio
}
try {
  const outfile = join(directory, 'recovery.cjs')
  await build({
    stdin: {
      contents: "export {recoverMovedSongs} from './src/main/service/fileService'",
      resolveDir: process.cwd()
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['adm-zip'],
    plugins: [
      {
        name: 'recovery-host',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) =>
            args.importer.replaceAll('\\', '/').endsWith('/service/fileService.ts') &&
            fixtures[args.path]
              ? { path: args.path, namespace: 'fixture' }
              : undefined
          )
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            contents: fixtures[args.path]
          }))
        }
      }
    ]
  })
  const { recoverMovedSongs } = createRequire(import.meta.url)(outfile)

  let root = await reset()
  const occupied = await file(root, 'occupied.flac')
  const available = await file(root, 'available.flac')
  const original = missing(1, 'occupied.flac')
  missing(2, 'available.flac')
  insert.run(3, occupied, 'occupied.flac', 10, null, 23)
  database.exec('INSERT INTO song_list_item VALUES(1,4); INSERT INTO song_tag VALUES(1,8)')
  assert.deepEqual(await recoverMovedSongs(root), { total: 2, recovered: 1 })
  assert.equal(song(1).audio, original, 'Occupied paths never overwrite or replace library records')
  assert.equal(song(1).song_status, 0)
  assert.equal(song(2).audio, available, 'A conflict does not prevent other files from recovering')
  assert.equal(song(2).song_status, 1)
  assert.equal(song(3).play_times, 23)
  assert.equal(database.prepare('SELECT song_id FROM song_list_item').get().song_id, 1)
  assert.equal(database.prepare('SELECT song_id FROM song_tag').get().song_id, 1)

  root = await reset()
  const shared = await file(root, 'shared.flac')
  missing(1, 'shared.flac')
  missing(2, 'shared.flac')
  assert.deepEqual(await recoverMovedSongs(root), { total: 2, recovered: 1 })
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM song WHERE audio=?').get(shared).n, 1)
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM song WHERE song_status=0').get().n, 1)

  root = await reset()
  const exact = await file(root, 'a/version.flac')
  await file(root, 'b/version.flac', 20)
  const oldVersion = missing(1, 'version.flac')
  insert.run(2, exact, 'version.flac', 10, null, 0)
  assert.deepEqual(await recoverMovedSongs(root), { total: 1, recovered: 0 })
  assert.equal(
    song(1).audio,
    oldVersion,
    'An occupied exact match does not fall back to another recording'
  )

  root = await reset()
  await file(root, 'a/ambiguous.flac')
  await file(root, 'b/ambiguous.flac')
  missing(1, 'ambiguous.flac')
  assert.deepEqual(await recoverMovedSongs(root), { total: 1, recovered: 0 })

  root = await reset()
  const concurrent = await file(root, 'concurrent.flac')
  missing(1, 'concurrent.flac')
  const results = await Promise.all([recoverMovedSongs(root), recoverMovedSongs(root)])
  assert.equal(
    results.reduce((sum, result) => sum + result.recovered, 0),
    1
  )
  assert.equal(song(1).audio, concurrent)

  root = await reset()
  const late = await file(root, 'late.flac')
  missing(1, 'late.flac')
  globalThis.onRecoveryRead = () => insert.run(2, late, 'late.flac', 10, null, 0)
  assert.deepEqual(await recoverMovedSongs(root), { total: 1, recovered: 0 })

  root = await reset()
  await file(root, 'changed.flac')
  const manual = await file(root, 'manual.flac')
  missing(1, 'changed.flac')
  globalThis.onRecoveryRead = () =>
    database.prepare('UPDATE song SET audio=? WHERE id=1').run(manual)
  assert.deepEqual(await recoverMovedSongs(root), { total: 1, recovered: 0 })
  assert.equal(
    song(1).audio,
    manual,
    'A stale recovery snapshot cannot overwrite an intervening path change'
  )

  if (process.platform === 'win32') {
    root = await reset()
    const path = await file(root, 'Case.flac')
    missing(1, 'Case.flac')
    insert.run(2, path.toUpperCase().replaceAll('\\', '/'), 'Case.flac', 10, null, 0)
    assert.deepEqual(await recoverMovedSongs(root), { total: 1, recovered: 0 })
  }
  console.log(
    'Moved-song recovery passed: occupied/shared paths, partial success, ambiguity, concurrent imports/recovery, stale snapshots and Windows path aliases.'
  )
} finally {
  database.close()
  delete globalThis.recoveryDatabase
  delete globalThis.onRecoveryRead
  assert(directory.startsWith(cache + sep), 'Cleanup stays inside the fixture cache')
  await rm(directory, { recursive: true, force: true })
}
