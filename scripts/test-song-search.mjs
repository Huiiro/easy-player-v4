/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { Worker } from 'node:worker_threads'
import { build, buildSync } from 'esbuild'

// Use the app's Electron ABI without rebuilding the installed SQLite addon.
const require = createRequire(import.meta.url)
if (!process.versions.electron) {
  const result = spawnSync(
    require('electron'),
    [resolve('scripts/test-song-search.mjs'), ...process.argv.slice(2)],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'inherit'
    }
  )
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}

const cacheRoot = resolve('node_modules/.cache')
mkdirSync(cacheRoot, { recursive: true })
const directory = mkdtempSync(join(cacheRoot, 'song-search-'))
const buildOptions = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  packages: 'external'
}
const Database = require('better-sqlite3')
let db
let worker
let stopIndex
try {
  buildSync({
    ...buildOptions,
    stdin: {
      resolveDir: process.cwd(),
      contents: `
    export * from './src/main/search/searchTokens';
    export * from './src/main/search/japaneseReadings';
    export * from './src/main/search/searchQuery';
    export * from './src/main/search/searchIndexStore';
    export * from './src/main/search/schema';
    export * from './src/main/database/schema';
  `
    },
    outfile: join(directory, 'helpers.cjs')
  })
  const helpers = require(join(directory, 'helpers.cjs'))
  const {
    buildBasicSearchTerms,
    buildSearchTerms,
    normalizeSearchText,
    japaneseSortReading,
    buildSongSearchFilter,
    commitSearchTerms,
    pendingSearchRows,
    queueOutdatedSearchIndexes
  } = helpers
  db = new Database(':memory:')
  db.pragma('foreign_keys=ON')
  db.function('search_normalize', { deterministic: true }, normalizeSearchText)
  db.function('search_japanese_sort', { deterministic: true }, japaneseSortReading)
  // Initialize the same schemas as the application.
  db.exec(helpers.schemaV1)
  db.exec(helpers.searchSchema)
  db.prepare(
    `INSERT INTO folder(id,name,full_path,is_root_path,import_time) VALUES(1,'Music','D:/Music',1,'2026-10-16')`
  ).run()
  const insert =
    db.prepare(`INSERT INTO song(id,title,artist,album,audio,folder_id,file_name,genre,source_id,preference)
    VALUES(@id,@title,@artist,@album,@audio,@folderId,@fileName,@genre,@sourceId,@preference)`)
  const add = (id, title, extra = {}) =>
    insert.run({
      id,
      title,
      artist: '周杰伦',
      album: '测试专辑',
      audio: `D:/Music/${id}.flac`,
      folderId: 1,
      fileName: title,
      genre: 'Pop',
      sourceId: null,
      preference: 0,
      ...extra
    })
  add(1, '七里香')
  // New songs enter the indexing queue through the insert trigger.
  assert.equal(pendingSearchRows(db).length, 1)
  const pendingBeforeReopen = db.prepare('SELECT * FROM song_search_pending').all()
  db.exec(helpers.schemaV1)
  db.exec(helpers.searchSchema)
  assert.deepEqual(db.prepare('SELECT * FROM song_search_pending').all(), pendingBeforeReopen)
  const search = (text) => {
    const filter = buildSongSearchFilter(db, text)
    return db
      .prepare(`SELECT id FROM song ${filter.sql ? `WHERE ${filter.sql}` : ''} ORDER BY id`)
      .all(filter.params)
      .map((row) => row.id)
  }
  assert.deepEqual(search('里香'), [1], 'original search works before backfill')
  for (const row of pendingSearchRows(db)) {
    const result = await buildSearchTerms({
      title: row.title,
      artist: row.artist,
      album: row.album,
      fileName: row.fileName
    })
    assert.equal(result.complete, true, 'real Japanese dictionary initializes')
    assert.equal(commitSearchTerms(db, row, result.terms, result.complete), true)
  }
  for (const text of ['qili', 'qilixiang', 'lixiang', 'qlx', '里香', 'ＱＬＸ', 'qlx zjl'])
    assert.deepEqual(search(text), [1], text)
  const cases = [
    [2, '君が好き', ['kimigasuki', 'suki', 'kgs', 'きみ', 'キミ']],
    [3, '東京', ['tokyo', 'とうきょう', 'トウキョウ']],
    [4, 'きょうは君へ', ['kyowakimie', 'kwke']],
    [5, '新一', ['shinichi', "shin'ichi", 'shin’ichi']],
    [6, '愛與夢', ['爱与梦']],
    [7, '100%_Mix OR "Live"', ['%', '_', 'OR', '"Live"']],
    [9, '裏面', ['里面', '裡面']],
    [
      11,
      '月が綺麗ねと言われたい！',
      ['kirei', 'きれい', '月が綺麗'],
      {
        artist: '柿崎ユウタ',
        fileName: '柿崎ユウタ - 月が綺麗ねと言われたい！'
      }
    ],
    [12, '綺麗', ['qili', 'kirei']]
  ]
  for (const [id, title, queries, extra = {}] of cases) {
    add(id, title, extra)
    const row = pendingSearchRows(db).find((item) => item.id === id)
    const result = await buildSearchTerms({
      title: row.title,
      artist: row.artist,
      album: row.album,
      fileName: row.fileName
    })
    assert.equal(result.complete, true)
    commitSearchTerms(db, row, result.terms, true)
    for (const query of queries) assert.ok(search(query).includes(id), `${title}: ${query}`)
  }
  assert.ok(
    !search('qili').includes(11),
    'Japanese 綺麗 must not get Mandarin qili aliases in title or filename'
  )
  const sortReading = (id) =>
    db.prepare('SELECT title FROM song_sort_reading WHERE song_id=?').get(id)?.title
  assert.equal(
    sortReading(2),
    'kimigasuki',
    'persist the complete romaji, not a partial search alias'
  )
  assert.equal(sortReading(3), 'tokyo', 'Han-only Japanese reading excludes the Mandarin alias')
  assert.ok(sortReading(11).startsWith('tsuki'))
  const indexesBeforeReopen = db.prepare('SELECT * FROM song_search ORDER BY song_id').all()
  const readingsBeforeReopen = db.prepare('SELECT * FROM song_sort_reading ORDER BY song_id').all()
  db.exec(helpers.schemaV1)
  db.exec(helpers.searchSchema)
  assert.deepEqual(
    db.prepare('SELECT * FROM song_search ORDER BY song_id').all(),
    indexesBeforeReopen
  )
  assert.deepEqual(
    db.prepare('SELECT * FROM song_sort_reading ORDER BY song_id').all(),
    readingsBeforeReopen
  )
  assert.equal(pendingSearchRows(db).length, 0, 'initialization does not requeue indexed songs')
  assert.ok(
    search('qili').includes(1) && search('qili').includes(12),
    'Chinese pinyin prefixes and ambiguous Han-only names remain searchable'
  )
  const mixedFields = buildBasicSearchTerms({
    title: '綺麗ﾈ',
    artist: '周杰伦',
    album: '七里香',
    fileName: '月が綺麗ね'
  })
  assert.ok(
    !mixedFields.title.includes(helpers.READING_TOKEN + 'qili'),
    'halfwidth kana is detected after normalization'
  )
  assert.ok(!mixedFields.fileName.includes(helpers.READING_TOKEN + 'qili'))
  assert.ok(mixedFields.artist.includes(helpers.READING_TOKEN + 'zhoujielun'))
  assert.ok(
    mixedFields.album.includes(helpers.READING_TOKEN + 'qilixiang'),
    'language routing is field-specific'
  )
  db.prepare('UPDATE song_search SET title=title || ?, version=? WHERE song_id=11').run(
    ' ' + helpers.READING_TOKEN + 'qili',
    helpers.SEARCH_INDEX_VERSION - 1
  )
  assert.ok(
    search('qili').includes(11),
    'fixture reproduces a stale index from the previous version'
  )
  queueOutdatedSearchIndexes(db)
  assert.ok(!search('qili').includes(11), 'startup discards stale Mandarin aliases')
  const japaneseRow = pendingSearchRows(db).find((row) => row.id === 11)
  const japaneseResult = await buildSearchTerms({
    title: japaneseRow.title,
    artist: japaneseRow.artist,
    album: japaneseRow.album,
    fileName: japaneseRow.fileName
  })
  assert.equal(japaneseResult.complete, true)
  commitSearchTerms(db, japaneseRow, japaneseResult.terms, true)
  assert.ok(
    !search('qili').includes(11) && search('kirei').includes(11),
    'rebuilt index retains the Japanese reading only'
  )
  assert.deepEqual(search('%'), [7], 'SQL wildcard is literal')
  assert.deepEqual(search('_'), [7], 'underscore is literal')
  for (const query of ['*', '"', 'AND OR NOT', "'); DROP TABLE song;--", 'あ OR qlx']) search(query)

  // Updating a song immediately removes old aliases and invalidates in-flight jobs.
  db.prepare('UPDATE song SET title=?, file_name=? WHERE id=1').run('晴天', '晴天')
  assert.deepEqual(search('qlx'), [])
  const stale = pendingSearchRows(db).find((row) => row.id === 1)
  const staleTerms = buildBasicSearchTerms({
    title: '晴天',
    artist: null,
    album: null,
    fileName: null
  })
  db.prepare('UPDATE song SET title=?,file_name=? WHERE id=1').run('稻香', '稻香')
  assert.equal(commitSearchTerms(db, stale, staleTerms, true), false)
  const fresh = pendingSearchRows(db).find((row) => row.id === 1)
  const freshTerms = buildBasicSearchTerms({
    title: '稻香',
    artist: '周杰伦',
    album: '测试专辑',
    fileName: '稻香'
  })
  commitSearchTerms(db, fresh, freshTerms, false, 1000)
  assert.equal(
    db.prepare('SELECT retry_at FROM song_search_pending WHERE song_id=1').get().retry_at,
    31000
  )
  assert.deepEqual(search('daoxiang'), [1], 'basic index usable while Japanese conversion retries')
  commitSearchTerms(db, fresh, freshTerms, true)
  assert.equal(db.prepare('SELECT 1 FROM song_search_pending WHERE song_id=1').get(), undefined)
  db.prepare('UPDATE song_search SET version=0 WHERE song_id=1').run()
  queueOutdatedSearchIndexes(db)
  assert.ok(pendingSearchRows(db).some((row) => row.id === 1))
  commitSearchTerms(
    db,
    pendingSearchRows(db).find((row) => row.id === 1),
    freshTerms,
    true
  )
  db.prepare('DELETE FROM song WHERE id=2').run()
  assert.deepEqual(search('kimigasuki'), [])
  assert.equal(db.prepare('SELECT 1 FROM song_fts WHERE rowid=2').get(), undefined)
  add(8, '旧名字')
  const deletedTask = pendingSearchRows(db).find((row) => row.id === 8)
  db.prepare('DELETE FROM song WHERE id=8').run()
  add(8, '新名字')
  assert.equal(
    commitSearchTerms(db, deletedTask, staleTerms, true),
    false,
    'delete/reinsert cannot reuse a revision'
  )
  const unchanged = pendingSearchRows(db).find((row) => row.id === 8)
  db.prepare('UPDATE song SET title=title WHERE id=8').run()
  assert.equal(pendingSearchRows(db).find((row) => row.id === 8).revision, unchanged.revision)
  await db.backup(join(directory, 'resume.db'))
  const resumed = new Database(join(directory, 'resume.db'))
  let external
  try {
    resumed.function('search_normalize', { deterministic: true }, normalizeSearchText)
    resumed.function('search_japanese_sort', { deterministic: true }, japaneseSortReading)
    assert.ok(
      pendingSearchRows(resumed).some((row) => row.id === 8),
      'pending work survives reopening the database'
    )
    const resumedSearch = (query) => {
      const filter = buildSongSearchFilter(resumed, query)
      return resumed
        .prepare(`SELECT id FROM song WHERE ${filter.sql} ORDER BY id`)
        .all(filter.params)
        .map((row) => row.id)
    }
    assert.ok(resumedSearch('新名字').includes(8))
    external = new Database(join(directory, 'resume.db'))
    external.function('search_normalize', { deterministic: true }, normalizeSearchText)
    external.function('search_japanese_sort', { deterministic: true }, japaneseSortReading)
    external.prepare('UPDATE song SET title=?, file_name=? WHERE id=8').run('外部新名', '外部新名')
    assert.ok(
      !resumedSearch('新名字').includes(8),
      'another connection invalidates the cache via data_version'
    )
    assert.ok(resumedSearch('外部新名').includes(8))
  } finally {
    external?.close()
    resumed.close()
  }
  search('稻香')
  assert.throws(
    () =>
      db.transaction(() => {
        db.prepare('UPDATE song SET title=? WHERE id=1').run('回滚测试')
        assert.ok(search('回滚测试').includes(1))
        throw new Error('rollback fixture')
      })(),
    /rollback fixture/
  )
  assert.ok(!search('回滚测试').includes(1), 'rollback cannot reuse rolled-back TEMP results')
  assert.ok(search('稻香').includes(1))
  add(14, 'ＣＡＦÉ 100%_Mix "Quoted" 🎵🎵🎵')
  for (const query of ['café', 'CAFÉ', '100%_Mix', '"Quoted"', '🎵🎵🎵'])
    assert.ok(search(query).includes(14), `normalized original/trigram match: ${query}`)
  add(15, 'NUL\0literal')
  assert.ok(search('nul\0literal').includes(15), 'NUL remains literal original input')

  // Exercise the actual repository query paths with isolated application services.
  const mocks = {
    'search-test-database': 'export const getDatabase=()=>globalThis.__searchTestDb',
    'search-test-i18n': 'export const t=(key)=>key',
    'search-test-logger': 'export const Logger={debug(){},info(){},warn(){},error(){}}',
    'search-test-recommendations':
      'export const getDailyRecommendationGroups=()=>[]; export const getRecentDiscoveryGroups=()=>[]; export const invalidateDailyRecommendations=()=>{}',
    'search-test-path': 'export const getDataPath=()=>"."'
  }
  const alias = {}
  for (const [name, content] of Object.entries(mocks)) {
    const path = join(directory, name + '.js')
    writeFileSync(path, content)
    alias[name] = path
  }
  const mockModules = new Map([
    [resolve('src/main/database/index'), 'search-test-database'],
    [resolve('src/main/i18n'), 'search-test-i18n'],
    [resolve('src/main/service/loggerService'), 'search-test-logger'],
    [resolve('src/main/database/recommendations'), 'search-test-recommendations'],
    [resolve('src/main/utils/pathUtils'), 'search-test-path']
  ])
  await build({
    ...buildOptions,
    entryPoints: ['src/main/database/repository.ts'],
    plugins: [
      {
        name: 'repository-test-services',
        setup(build) {
          build.onResolve({ filter: /^\./ }, (args) => {
            const name = mockModules.get(resolve(args.resolveDir, args.path).replace(/\.ts$/, ''))
            return name ? { path: name, namespace: 'test-service' } : undefined
          })
          build.onLoad({ filter: /.*/, namespace: 'test-service' }, (args) => ({
            contents: mocks[args.path],
            loader: 'js'
          }))
        }
      }
    ],
    outfile: join(directory, 'repository.cjs')
  })
  globalThis.__searchTestDb = db
  const repo = require(join(directory, 'repository.cjs'))
  db.prepare(`INSERT INTO music_source(id,name) VALUES(1,'Remote')`).run()
  add(10, '稻香', { sourceId: 1, preference: 1 })
  for (const row of pendingSearchRows(db))
    commitSearchTerms(
      db,
      row,
      buildBasicSearchTerms({
        title: row.title,
        artist: row.artist,
        album: row.album,
        fileName: row.fileName
      }),
      true
    )
  db.exec(`INSERT INTO song_list(id,name) VALUES(1,'Playlist'); INSERT INTO song_list_item(song_list_id,song_id) VALUES(1,1);
    INSERT INTO tag(id,name) VALUES(1,'Tag'); INSERT INTO song_tag(song_id,tag_id) VALUES(1,1);
    INSERT INTO history(song_id,play_time) VALUES(1,'2026-10-16 00:00:00')`)
  assert.equal(repo.querySongs({ search: 'dx', source: 'local' }).total, 1)
  assert.deepEqual(
    repo.querySongs({ search: 'dx', preference: 1 }).data.map((song) => song.id),
    [10]
  )
  assert.deepEqual(
    repo.querySongs({ search: 'dx', tags: [1] }).data.map((song) => song.id),
    [1]
  )
  const page = repo.querySongs({ search: 'dx', size: 1, page: 2, sortBy: 'id', sortOrder: 'asc' })
  assert.equal(page.total, 2)
  assert.equal(page.data[0].id, 10)
  assert.deepEqual(
    repo.queryPlaylistSongs(1, { search: 'dx' }).data.map((song) => song.id),
    [1]
  )
  assert.deepEqual(
    repo.queryRecentPlayedSongs({ search: 'dx' }).data.map((song) => song.id),
    [1]
  )
  assert.deepEqual(
    repo.getLocalFolderSongs(1, 'dx').map((song) => song.id),
    [1]
  )
  assert.equal(repo.getSongsByAlbum('测试专辑', undefined, 'dx').length, 2)
  assert.equal(repo.getSongsByArtist('周杰伦', '', 'dx').length, 2)
  assert.equal(repo.getSongsByGenre('Pop', 'dx').length, 2)
  assert.equal(repo.getSongsByAlbum('__easy_player_unknown_album__', undefined, 'dx').length, 0)
  const rankingFixtures = [
    [30, '七里香', {}],
    [31, '清凉夏夜', {}],
    [32, 'Love', {}],
    [34, 'Other Track', { artist: '七里香' }],
    [35, 'Other Track', { album: '七里香' }],
    [36, 'Other Track', { fileName: '七里香' }],
    [37, '七里香 (Live)', {}]
  ]
  for (const [id, title, extra] of rankingFixtures)
    add(id, title, { artist: 'Other', album: 'Other Album', ...extra })
  for (const row of pendingSearchRows(db))
    commitSearchTerms(
      db,
      row,
      buildBasicSearchTerms({
        title: row.title,
        artist: row.artist,
        album: row.album,
        fileName: row.fileName
      }),
      true
    )
  assert.ok(!search('qlx').includes(31), 'qlx must not match the longer qlxy abbreviation')
  assert.ok(!search('q').includes(30), 'single letters do not match generated initials/readings')
  assert.deepEqual(
    repo.querySongs({ search: '七里香', size: 1 }).data.map((song) => song.id),
    [30]
  )
  assert.deepEqual(
    repo.querySongs({ search: '七里香', size: 1, page: 2 }).data.map((song) => song.id),
    [37]
  )
  const relevanceResults = repo.querySongs({ search: 'qlx' }).data
  const position = (id) => relevanceResults.findIndex((song) => song.id === id)
  assert.ok(
    position(30) >= 0 && position(30) < position(37),
    'whole title reading precedes version suffix'
  )
  assert.ok(
    position(37) < position(34) && position(34) < position(35) && position(35) < position(36),
    'title, artist, album and filename have different weights'
  )
  assert.equal(
    repo.querySongs({ search: '七里香', sortBy: 'id', sortOrder: 'desc', size: 1 }).data[0].id,
    37,
    'explicit sort overrides relevance'
  )
  assert.equal(
    repo.querySongs({ search: '七里香', sortBy: 'relevance', sortOrder: 'asc', size: 1 }).data[0]
      .id,
    36
  )
  assert.equal(repo.getLocalFolderSongs(1, 'qlx')[0].id, 30)
  assert.equal(repo.getSongsByGenre('Pop', 'qlx')[0].id, 30)
  assert.equal(repo.getSongsByAlbum('Other Album', undefined, 'qlx')[0].id, 30)
  assert.equal(repo.getSongsByArtist('Other', '', 'qlx')[0].id, 30)
  db.exec(
    "INSERT INTO song_list_item(song_list_id,song_id) VALUES(1,30),(1,37); INSERT INTO history(song_id,play_time) VALUES(30,'2026-10-16 00:00:00'),(37,'2026-10-16 00:01:00')"
  )
  assert.equal(repo.queryPlaylistSongs(1, { search: 'qlx', size: 1 }).data[0].id, 30)
  assert.equal(repo.queryRecentPlayedSongs({ search: 'qlx', size: 1 }).data[0].id, 30)

  // Launch a real built worker and read the packaged-style request protocol.
  buildSync({
    ...buildOptions,
    entryPoints: ['src/main/search/searchWorker.ts'],
    outfile: join(directory, 'searchWorker.js')
  })
  worker = new Worker(join(directory, 'searchWorker.js'))
  const response = await new Promise((resolveResult, reject) => {
    const timeout = setTimeout(() => reject(new Error('Worker timeout')), 30_000)
    worker.once('error', reject)
    worker.once('message', (result) => {
      clearTimeout(timeout)
      resolveResult(result)
    })
    worker.postMessage({
      requestId: 1,
      fields: { title: '君が好き', artist: null, album: null, fileName: null }
    })
  })
  assert.equal(response.complete, true)
  assert.ok(response.terms.title.split(' ').includes(helpers.READING_TOKEN + 'kimigasuki'))
  await worker.terminate()
  worker = undefined

  const serviceSource = require('node:fs')
    .readFileSync('src/main/search/searchIndexService.ts', 'utf8')
    .replace("from '../service/loggerService'", "from 'search-test-logger'")
    .replace("from '../service/playbackMode'", "from 'search-test-policy'")
  const policyPath = join(directory, 'policy.js')
  writeFileSync(
    policyPath,
    'export const isPlaybackOnly=()=>globalThis.__searchPaused === true; export const onPlaybackModeChanged=()=>()=>{}'
  )
  buildSync({
    ...buildOptions,
    stdin: { contents: serviceSource, loader: 'ts', resolveDir: resolve('src/main/search') },
    alias: { 'search-test-logger': alias['search-test-logger'], 'search-test-policy': policyPath },
    outfile: join(directory, 'service.cjs')
  })
  const { startSearchIndexService } = require(join(directory, 'service.cjs'))
  const waitUntil = async (predicate) => {
    const deadline = Date.now() + 10_000
    while (!predicate()) {
      assert.ok(Date.now() < deadline, 'background index deadline')
      await new Promise((resolveWait) => setTimeout(resolveWait, 50))
    }
  }
  add(20, '君が好き')
  globalThis.__searchPaused = true
  let changed = 0
  const statuses = []
  stopIndex = startSearchIndexService(
    db,
    () => changed++,
    (status) => statuses.push(status)
  )
  assert.equal(stopIndex.getStatus().phase, 'paused')
  assert.equal(stopIndex.getStatus().pending, 1)
  await new Promise((resolveWait) => setTimeout(resolveWait, 1100))
  assert.equal(db.prepare('SELECT 1 FROM song_search WHERE song_id=20').get(), undefined)
  globalThis.__searchPaused = false
  await waitUntil(() => !db.prepare('SELECT 1 FROM song_search_pending WHERE song_id=20').get())
  assert.ok(search('kimigasuki').includes(20))
  assert.ok(changed > 0)
  assert.equal(stopIndex.getStatus().phase, 'ready')
  assert.equal(stopIndex.getStatus().completed, stopIndex.getStatus().total)
  assert.ok(
    statuses.some((status) => status.phase === 'indexing' && status.currentTitle === '君が好き')
  )
  assert.ok(
    statuses.every((status, index) => !index || status.revision > statuses[index - 1].revision)
  )
  stopIndex.stop()
  stopIndex = undefined

  // A broken worker saves a usable basic index and retains a deferred retry.
  writeFileSync(join(directory, 'searchWorker.js'), "throw new Error('fixture worker failure')")
  add(21, '安静')
  stopIndex = startSearchIndexService(db, () => {})
  await waitUntil(() =>
    Boolean(db.prepare('SELECT 1 FROM song_search_pending WHERE song_id=21 AND attempts>0').get())
  )
  assert.ok(search('anjing').includes(21))
  const retryStatus = stopIndex.getStatus()
  assert.equal(retryStatus.phase, 'retrying')
  assert.equal(retryStatus.retrying, 1)
  assert.equal(retryStatus.completed, retryStatus.total - 1)
  assert.equal(
    retryStatus.indexed,
    retryStatus.total,
    'a usable basic index is not reported as fully complete'
  )
  assert.ok(retryStatus.nextRetryAt > Date.now())
  stopIndex.stop()
  stopIndex = undefined
  delete globalThis.__searchPaused

  if (process.argv.includes('--built-worker')) {
    worker = new Worker(resolve('out/main/searchWorker.js'))
    const result = await new Promise((resolveResult, reject) => {
      const timeout = setTimeout(() => reject(new Error('Built worker timeout')), 30_000)
      worker.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      worker.once('message', (message) => {
        clearTimeout(timeout)
        resolveResult(message)
      })
      worker.postMessage({
        requestId: 2,
        fields: {
          title: '月が綺麗ねと言われたい！',
          artist: '柿崎ユウタ',
          album: null,
          fileName: '柿崎ユウタ - 月が綺麗ねと言われたい！'
        }
      })
    })
    assert.equal(result.complete, true)
    assert.ok(result.terms.title.split(' ').includes(helpers.READING_TOKEN + 'kirei'))
    for (const field of ['title', 'fileName'])
      assert.ok(
        !result.terms[field]
          .split(' ')
          .some((term) => term.startsWith(helpers.READING_TOKEN + 'qili'))
      )
    process.stdout.write('Production worker: dictionary loading passed\n')
  }
  if (process.argv.includes('--benchmark')) {
    const terms = buildBasicSearchTerms({
      title: '七里香',
      artist: '周杰伦',
      album: '测试专辑',
      fileName: '七里香'
    })
    const writeIndex = db.prepare(
      `INSERT INTO song_search(song_id,title,artist,album,file_name,version) VALUES(?,?,?,?,?,${helpers.SEARCH_INDEX_VERSION})`
    )
    const started = performance.now()
    db.transaction(() => {
      for (let id = 1000; id < 11000; id++) {
        add(id, '七里香')
        writeIndex.run(id, terms.title, terms.artist, terms.album, terms.fileName)
      }
    })()
    const sizes = db
      .prepare(
        'SELECT SUM(length(title)+length(artist)+length(album)+length(file_name)) AS bytes FROM song_search'
      )
      .get()
    const timings = {}
    for (const keyword of ['qlx', '里香', 'qlx zjl', 'unmatched']) {
      const samples = []
      for (let attempt = 0; attempt < 3; attempt++) {
        const before = performance.now()
        repo.querySongs({ search: keyword, size: 50 })
        samples.push(performance.now() - before)
      }
      timings[keyword] = Math.round(Math.max(...samples))
    }
    process.stdout.write(
      `Synthetic 10k rows: insert/index ${Math.round(performance.now() - started)}ms, terms ${Math.round(sizes.bytes / 1024)}KiB, max of 3 paged searches ${JSON.stringify(timings)}ms\n`
    )
  }
  process.stdout.write(
    'Song search: real readings, FTS, repository scopes, queue races and worker passed\n'
  )
} finally {
  stopIndex?.stop()
  await worker?.terminate()
  db?.close()
  delete globalThis.__searchTestDb
  // Only remove this test's newly created directory inside node_modules/.cache.
  if (directory.startsWith(cacheRoot + require('node:path').sep))
    rmSync(directory, { recursive: true, force: true })
}
