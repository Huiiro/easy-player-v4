/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const db = new DatabaseSync(':memory:')
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE folder (
    id INTEGER PRIMARY KEY, pid INTEGER REFERENCES folder(id), name TEXT NOT NULL,
    full_path TEXT NOT NULL UNIQUE, is_root_path INTEGER NOT NULL, import_time TEXT NOT NULL
  );
  CREATE TABLE song (
    id INTEGER PRIMARY KEY, audio TEXT NOT NULL UNIQUE,
    folder_id INTEGER NOT NULL REFERENCES folder(id), source_id INTEGER, title TEXT
  );
  CREATE TABLE playlist_item (song_id INTEGER REFERENCES song(id));
`)
const database = {
  prepare: (sql) => db.prepare(sql),
  transaction: (task) => () => {
    db.exec('BEGIN')
    try {
      const result = task()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}
const exports = {}
const mocks = {
  '../index': { getDatabase: () => database },
  '../../search/searchQuery': {},
  './songHelpers': {},
  './songs': {}
}
vm.runInNewContext(
  ts.transpileModule(readFileSync('src/main/database/repository/folders.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText,
  { exports, require: (name) => (name in mocks ? mocks[name] : require(name)) }
)
const { rebuildLocalFolders, listLocalFolders } = exports
const music = path.resolve('rebuild-fixture', 'Song')
const chinese = path.join(music, 'song_zh')
const artist = path.join(chinese, '周杰伦')
const album = path.join(artist, 'ALBUM', '八度空间')
const empty = path.join(chinese, 'empty')
const insert = db.prepare('INSERT INTO folder VALUES (?, ?, ?, ?, ?, ?)')
const folder = (fullPath) => db.prepare('SELECT * FROM folder WHERE full_path = ?').get(fullPath)
const snapshot = () => ({
  folders: db.prepare('SELECT * FROM folder ORDER BY id').all(),
  songs: db.prepare('SELECT * FROM song ORDER BY id').all()
})

try {
  assert.equal(rebuildLocalFolders(), 0, 'An empty library stays empty')
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM folder').get().count, 0)

  // Independent imports leave the artist and an album as roots. The parent
  // library is imported later; an empty row also has an incorrect parent/name.
  insert.run(1, null, '周杰伦', artist, 1, 'original-time')
  insert.run(2, null, '八度空间', album, 1, 'original-time')
  insert.run(3, null, 'Song', music, 1, 'original-time')
  insert.run(4, 3, 'song_zh', chinese, 0, 'original-time')
  insert.run(5, 1, 'wrong-name', empty, 1, 'original-time')
  insert.run(6, null, 'Remote', 'remote://source/1', 1, 'remote-time')
  db.prepare('INSERT INTO song VALUES (?, ?, ?, ?, ?)').run(
    1,
    path.join(album, 'song.flac'),
    2,
    null,
    'Local song'
  )
  // Simulate a recovered song whose folder_id still points at its old folder.
  const moved = path.join(music, 'new-location', 'moved.flac')
  db.prepare('INSERT INTO song VALUES (?, ?, ?, ?, ?)').run(2, moved, 1, null, 'Moved song')
  db.prepare('INSERT INTO song VALUES (?, ?, ?, ?, ?)').run(
    3,
    'https://example.test/audio',
    6,
    1,
    'Remote song'
  )
  db.exec('INSERT INTO playlist_item VALUES (1)')
  const remoteFolder = { ...folder('remote://source/1') }
  const remoteSong = { ...db.prepare('SELECT * FROM song WHERE id = 3').get() }

  assert.equal(rebuildLocalFolders(), 2, 'Only local songs contribute to the result count')
  assert.equal(folder(artist).id, 1, 'Existing directory IDs stay stable')
  assert.equal(folder(artist).pid, 4, 'The artist belongs under song_zh')
  assert.equal(folder(album).pid, folder(path.dirname(album)).id, 'Missing ancestors are created')
  assert.equal(folder(empty).pid, 4, 'Empty directories are repaired too')
  assert.equal(folder(empty).name, 'empty')
  assert.equal(folder(artist).import_time, 'original-time')
  assert.equal(
    db.prepare('SELECT folder_id FROM song WHERE id = 2').get().folder_id,
    folder(path.dirname(moved)).id,
    'Song folders follow their current audio paths'
  )
  assert.equal(db.prepare('SELECT song_id FROM playlist_item').get().song_id, 1)
  assert.deepEqual({ ...folder('remote://source/1') }, remoteFolder)
  assert.deepEqual({ ...db.prepare('SELECT * FROM song WHERE id = 3').get() }, remoteSong)

  const localFolders = listLocalFolders()
  for (const item of localFolders) {
    const parentPath = path.dirname(item.fullPath)
    assert.equal(item.pid, parentPath === item.fullPath ? null : folder(parentPath).id)
    assert.equal(item.isRootPath, parentPath === item.fullPath, 'Only filesystem roots stay roots')
  }
  assert.equal(localFolders.find((item) => item.id === 3).songCount, 2)
  assert.equal(localFolders.find((item) => item.id === 4).songCount, 1)
  assert.equal(localFolders.find((item) => item.id === 1).songCount, 1)
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
  const first = snapshot()
  assert.equal(rebuildLocalFolders(), 2)
  assert.deepEqual(snapshot(), first, 'Repeated rebuilding does not add rows or change IDs')
  console.log(
    'Folder rebuild tests passed: hierarchy repair, missing ancestors, empty folders, moved songs, stable IDs, remote isolation, counts and repeatability.'
  )
} finally {
  db.close()
}
