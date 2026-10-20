/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { buildSync } from 'esbuild'

const require = createRequire(import.meta.url)
if (!process.versions.electron) {
  const child = spawnSync(require('electron'), [resolve('scripts/test-legacy-migration.mjs')], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit'
  })
  if (child.error) throw child.error
  process.exit(child.status ?? 1)
}
const cache = resolve('node_modules/.cache')
mkdirSync(cache, { recursive: true })
const directory = mkdtempSync(join(cache, 'migration-test-'))
const Database = require('better-sqlite3')
let db
try {
  buildSync({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
      export * from './scripts/lib/migrate-legacy-library';
      export * from './src/main/search/searchTokens';
      export * from './src/main/search/searchIndexStore';
      export * from './src/main/utils/pathUtils';
    `
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    outfile: join(directory, 'helpers.cjs')
  })
  const h = require(join(directory, 'helpers.cjs'))
  process.env.EASY_PLAYER_DATA_DIR = join(directory, 'isolated')
  assert.equal(h.getDataPath(), join(directory, 'isolated/player_data'))
  const seed = (version, path = ':memory:') => {
    const database = new Database(path)
    database.pragma('foreign_keys=ON')
    database.function('search_normalize', h.normalizeSearchText)
    database.function('search_japanese_sort', h.japaneseSortReading)
    database.exec(readFileSync('tests/fixtures/legacy-v5.sql', 'utf8'))
    database.exec(`
      CREATE TABLE schema_migration(version INTEGER PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO schema_migration(version) VALUES(${version});
      INSERT INTO folder(id,name,full_path,is_root_path,import_time) VALUES(1,'Music','/Music',1,'2026-01-01');
      INSERT INTO song(id,title,audio,folder_id,preference) VALUES(1,'测试歌曲','/Music/测试.flac',1,1);
      INSERT INTO song_list(id,name) VALUES(1,'Favorites');
      INSERT INTO song_list_item(song_list_id,song_id) VALUES(1,1);
      INSERT INTO play_history(song_id,playlist_id,started_at,played_ms) VALUES(1,1,1700000000000,12345);
      INSERT INTO app_setting(key,value_json) VALUES('test.setting','"preserve me"');
    `)
    for (let v = 6; v <= version; v++)
      database.exec(readFileSync(`tests/fixtures/legacy-v${v}-search.sql`, 'utf8'))
    return database
  }
  const snapshot = (database) =>
    ['song', 'song_list', 'song_list_item', 'play_history', 'app_setting'].map((table) =>
      database.prepare(`SELECT * FROM ${table}`).all()
    )
  for (const version of [5, 6, 7, 8]) {
    db = seed(version)
    const before = snapshot(db)
    assert.equal(h.migrateLegacyLibrary(db), true)
    assert.deepEqual(snapshot(db), before, 'User data must be unchanged')
    h.queueOutdatedSearchIndexes(db) // Same startup path that failed before migration.
    assert.equal(h.pendingSearchRows(db).length, 1)
    assert.equal(
      db.prepare("SELECT rowid FROM song_original_fts WHERE song_original_fts MATCH '测试歌'").get()
        .rowid,
      1
    )
    assert.equal(h.migrateLegacyLibrary(db), false, 'Second run must be a no-op')
    db.prepare("UPDATE song SET title='新的歌曲' WHERE id=1").run()
    assert.equal(
      db.prepare("SELECT rowid FROM song_original_fts WHERE song_original_fts MATCH '新的歌'").get()
        .rowid,
      1
    )
    assert.deepEqual(db.pragma('foreign_key_check'), [])
    db.close()
    db = undefined
  }
  db = seed(5)
  // Fail after the index rebuild, verifying that DDL and version changes roll back together.
  db.exec(
    "CREATE TRIGGER fail_migration BEFORE DELETE ON schema_migration BEGIN SELECT RAISE(ABORT,'injected failure'); END;"
  )
  assert.throws(() => h.migrateLegacyLibrary(db), /injected failure/)
  assert.equal(db.prepare('SELECT version FROM schema_migration').get().version, 5)
  assert.equal(
    db.prepare("SELECT name FROM sqlite_master WHERE name='song_search'").get(),
    undefined
  )
  db.close()
  db = seed(5, join(directory, 'legacy.db'))
  db.pragma('journal_mode=WAL')
  db.prepare("UPDATE song SET title='WAL committed' WHERE id=1").run()
  const before = snapshot(db)
  const cli = spawnSync(
    process.execPath,
    [resolve('scripts/migrate-legacy-library.mjs'), join(directory, 'legacy.db')],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8'
    }
  )
  assert.equal(cli.status, 0, cli.stderr)
  const backups = readdirSync(directory).filter((name) => name.includes('.backup-'))
  assert.equal(backups.length, 1)
  const backup = new Database(join(directory, backups[0]), { readonly: true })
  try {
    assert.deepEqual(snapshot(backup), before, 'Backup must include committed WAL data')
    assert.equal(backup.prepare('SELECT version FROM schema_migration').get().version, 5)
  } finally {
    backup.close()
  }
  assert.deepEqual(snapshot(db), before)
  db.close()
  db = seed(5)
  db.exec('UPDATE schema_migration SET version=99')
  assert.throws(() => h.migrateLegacyLibrary(db), /Unsupported database/)
  console.log(
    'Legacy V5–V8 migration, data preservation, search, idempotence, rollback, WAL backup and data isolation passed.'
  )
} finally {
  db?.close()
  rmSync(directory, { recursive: true, force: true })
}
