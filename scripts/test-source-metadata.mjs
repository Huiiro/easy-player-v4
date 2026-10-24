/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
import assert from 'node:assert/strict'
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import vm from 'node:vm'
import ts from 'typescript'
import sharp from 'sharp'
import * as Vue from 'vue'
const require = createRequire(import.meta.url)
if (!process.versions.electron) {
  const result = spawnSync(
    require('electron'),
    [path.resolve('scripts/test-source-metadata.mjs')],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  )
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}
function load(file, mocks = {}, globals = {}) {
  const cache = new Map()
  const visit = (filename) => {
    filename = path.resolve(filename)
    if (mocks[filename]) return mocks[filename]
    if (cache.has(filename)) return cache.get(filename)
    const exports = {}
    cache.set(filename, exports)
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true
      }
    }).outputText
    vm.runInNewContext(
      code,
      {
        exports,
        Buffer,
        structuredClone,
        AbortController,
        AbortSignal,
        crypto,
        Error,
        Date,
        URL,
        console,
        ...globals,
        require: (name) => {
          if (mocks[name]) return mocks[name]
          if (name.startsWith('@/'))
            return visit(path.resolve('src/renderer/src', name.slice(2)) + '.ts')
          if (!name.startsWith('.')) return require(name)
          const target = path.resolve(path.dirname(filename), name)
          return visit(existsSync(target + '.ts') ? target + '.ts' : path.join(target, 'index.ts'))
        }
      },
      { filename }
    )
    return exports
  }
  return visit(file)
}
const plain = (value) => JSON.parse(JSON.stringify(value))
const { normalizeSourceGenreName, normalizeSourceGenreNames } = load(
  'plugins/shared/genreNormalization.ts'
)
for (const [original, expected] of [
  ['流行-日本流行', 'Pop-Jpop'],
  [' Pop - J-Pop ', 'Pop-Jpop'],
  ['流行-华语流行', 'Pop-Cpop'],
  ['流行-KPop', 'Pop-Kpop'],
  ['摇滚-流行摇滚', 'Rock-Pop Rock'],
  ['电子-浩室舞曲', 'Electronic-House'],
  ['R&B', 'R&B'],
  ['Jump-Up', 'Jump-Up'],
  ['j-pop', 'Jpop'],
  ['K-POP', 'Kpop'],
  ['另类/独立', 'Alternative & Indie'],
  ['嘻哈说唱', 'Hip Hop'],
  ['原声带', 'OST'],
  ['自定义流派', '自定义流派'],
  ['Future-Custom', 'Future-Custom'],
  ['流行-自定义流派', 'Pop-自定义流派'],
  ['', '']
]) {
  assert.equal(normalizeSourceGenreName(original), expected)
  assert.equal(normalizeSourceGenreName(expected), expected, 'normalization must be idempotent')
}
assert.deepEqual(
  plain(
    normalizeSourceGenreNames([
      '流行-日本流行',
      'Pop-Jpop',
      'Pop-J-Pop',
      'pop',
      '流行',
      '',
      'Unknown'
    ])
  ),
  ['Pop-Jpop', 'Pop', 'Unknown']
)
const genreDictionary = load('plugins/shared/data/neteaseGenreNames.ts').NETEASE_GENRE_NAMES
for (const label of Object.keys(genreDictionary)) {
  const canonical = normalizeSourceGenreName(label)
  assert.equal(normalizeSourceGenreName(canonical), canonical)
  assert.equal(
    /[/,，;；、]/.test(canonical),
    false,
    'canonical names must not introduce a library separator'
  )
}
const sdkCalls = []
let albumFailure = false
let wikiFailure = false
let wikiEmpty = false
let wikiGenreNames = [' Rock ', '摇滚', 'Pop']
const sdk = {
  search: async (request) => {
    sdkCalls.push(['search', request])
    return {
      status: 200,
      body: {
        result: {
          songs: [
            {
              id: 123,
              name: 'Studio',
              artists: [{ name: 'Artist' }],
              album: { name: 'Album' },
              duration: 210000
            },
            { id: 'invalid', name: 'Bad' }
          ]
        }
      }
    }
  },
  song_detail: async (request) => {
    sdkCalls.push(['detail', request])
    return {
      status: 200,
      body: {
        songs: [
          {
            id: 123,
            name: 'Studio',
            ar: [{ name: 'Artist' }],
            al: { id: 456, name: 'Album', picUrl: 'http://image.test/cover' },
            dt: 210000,
            no: 3,
            cd: '2',
            publishTime: Date.UTC(2020, 5, 10)
          }
        ]
      }
    }
  },
  album: async () => {
    if (albumFailure) throw Error('offline')
    return { status: 200, body: { album: { artist: { name: 'Album artist' } } } }
  },
  song_wiki_summary: async (request) => {
    sdkCalls.push(['wiki', request])
    if (wikiFailure) throw Error('wiki offline')
    return {
      status: 200,
      body: {
        code: 200,
        data: {
          blocks: wikiEmpty
            ? []
            : [
                {
                  code: 'SONG_PLAY_ABOUT_SONG_BASIC',
                  creatives: [
                    {
                      creativeType: 'songTag',
                      resources: [
                        ...wikiGenreNames.map((title) => ({
                          resourceType: 'melody_style',
                          uiElement: { mainTitle: { title } }
                        })),
                        {
                          resourceType: 'melody_style',
                          valid: false,
                          uiElement: { mainTitle: { title: 'Invalid' } }
                        },
                        { resourceType: 'other', uiElement: { mainTitle: { title: 'Wrong type' } } }
                      ]
                    },
                    {
                      creativeType: 'songBizTag',
                      resources: [
                        { resourceType: 'melody_style', uiElement: { mainTitle: { title: 'KTV' } } }
                      ]
                    },
                    { creativeType: 'language', uiElement: { mainTitle: { title: 'English' } } }
                  ]
                },
                {
                  code: 'RELATED_PLAYLIST',
                  creatives: [
                    {
                      creativeType: 'songTag',
                      resources: [
                        {
                          resourceType: 'melody_style',
                          uiElement: { mainTitle: { title: 'Not a genre' } }
                        }
                      ]
                    }
                  ]
                }
              ]
        }
      }
    }
  },
  lyric_new: async (request) => {
    sdkCalls.push(['lyrics', request])
    return { status: 200, body: { lrc: { lyric: '[00:01.00]Exact lyrics' } } }
  },
  lyric: async () => assert.fail('unexpected fallback')
}
const metadata = load('plugins/official/netease/metadata.ts', {
  '@neteasecloudmusicapienhanced/api': sdk,
  [path.resolve('src/main/service/playbackMode.ts')]: { requireBackgroundWork() {} }
})
const tracks = await metadata.searchNeteaseTracks('Studio Artist')
assert.equal(tracks.length, 1)
assert.equal(tracks[0].resource.resourceId, '123')
const detail = await metadata.getNeteaseTrack('123')
assert.equal(detail.metadata.trackNumber, 3)
assert.equal(detail.metadata.discNumber, 2)
assert.equal(detail.metadata.albumArtist, 'Album artist')
assert.equal(detail.metadata.year, 2020)
assert.equal(detail.metadata.genre, 'Rock, Pop', 'only deduplicated song genres enter metadata')
assert.equal(sdkCalls.find((call) => call[0] === 'wiki')[1].id, '123')
assert.equal(detail.artwork.imageUrl, 'https://image.test/cover')
assert.equal(detail.releaseDate, '2020-06-10')
wikiGenreNames = ['流行-日本流行', 'Pop-J-Pop', '电子-浩室舞曲', 'Unknown Genre']
assert.equal(
  (await metadata.getNeteaseTrack('123')).metadata.genre,
  'Pop-Jpop, Electronic-House, Unknown Genre'
)
wikiGenreNames = [' Rock ', '摇滚', 'Pop']
await assert.rejects(metadata.getNeteaseTrack('123,456'), /Invalid/)
albumFailure = true
assert.equal((await metadata.getNeteaseTrack('123')).metadata.genre, 'Rock, Pop')
wikiFailure = true
const withoutWiki = await metadata.getNeteaseTrack('123')
assert.equal(withoutWiki.metadata.title, 'Studio')
assert.equal(withoutWiki.metadata.genre, undefined, 'optional wiki failures cannot clear genre')
wikiFailure = false
wikiEmpty = true
assert.equal((await metadata.getNeteaseTrack('123')).metadata.genre, undefined)
wikiEmpty = false
const lyrics = load('plugins/official/netease/lyrics.ts', {
  '@neteasecloudmusicapienhanced/api': sdk,
  [path.resolve('src/main/service/playbackMode.ts')]: { isPlaybackOnly: () => false }
})
const searches = sdkCalls.filter((call) => call[0] === 'search').length
assert.equal((await lyrics.getNeteaseLyrics('123', false)).lrc, '[00:01.00]Exact lyrics')
assert.equal(
  sdkCalls.filter((call) => call[0] === 'search').length,
  searches,
  'exact resource lyrics must not run keyword search'
)
assert.equal(sdkCalls.at(-1)[1].id, '123')
console.log(
  'NetEase metadata: normalized fields, exact genres, optional album/wiki failures, ID validation and exact-resource lyrics passed'
)

const Database = require('better-sqlite3')
const db = new Database(':memory:')
db.exec(load('src/main/database/schema.ts').schemaV1)
db.exec(
  "INSERT INTO folder(id,name,full_path,is_root_path,import_time) VALUES(1,'test','test',1,'now')"
)
const root = mkdtempSync(path.resolve('build/source-metadata-test-'))
try {
  const audio = path.join(root, 'audio.mp3')
  writeFileSync(audio, 'audio bytes')
  db.prepare(
    'INSERT INTO song(id,title,artist,album,audio,folder_id,genre,track_no,disk_no,lrc,translation,lyric_format) VALUES(1,?,?,?,?,1,?,1,1,?,?,?)'
  ).run(
    'Library override',
    'Artist',
    'Old album',
    audio,
    'Jazz',
    'Old lyrics',
    'Old translation',
    'lrc'
  )
  const getSong = () => {
    const row = db.prepare('SELECT * FROM song WHERE id=1').get()
    return {
      ...row,
      sourceId: row.source_id,
      trackNo: row.track_no,
      diskNo: row.disk_no,
      lyricFormat: row.lyric_format,
      romanization: row.romanization
    }
  }
  let fileMetadata = {
    title: 'File title',
    artist: 'Artist',
    album: 'File album',
    year: 2019,
    trackNumber: 1,
    discNumber: 1,
    lyrics: 'File lyrics',
    genre: 'File genre'
  }
  let playbackStatus = null
  const guard = load('src/main/service/metadataWriteGuard.ts', {
    [path.resolve('src/main/i18n/index.ts')]: { t: (key) => key }
  })
  guard.setMetadataPlaybackStatusProvider(() => playbackStatus)
  const writes = []
  let failWrite = false
  const service = load('src/main/service/metadataWriteService.ts', {
    [path.resolve('src/main/service/metadataWriteGuard.ts')]: guard,
    [path.resolve('src/main/i18n/index.ts')]: { t: (key) => key },
    [path.resolve('src/main/database/repository.ts')]: { getSong },
    [path.resolve('src/main/database/index.ts')]: { getDatabase: () => db },
    [path.resolve('src/main/utils/pathUtils.ts')]: { getDataPath: () => root },
    [path.resolve('src/main/service/metadataService.ts')]: {
      readMetadata: async () => ({ ...fileMetadata }),
      writeMetadata: async (_file, _type, patch) => {
        writes.push({ ...patch })
        if (failWrite) return false
        fileMetadata = {
          ...fileMetadata,
          ...patch,
          ...(patch.coverPath ? { cover: readFileSync(patch.coverPath) } : {})
        }
        return true
      }
    }
  })
  const apply = async (patch) =>
    service.applySourceMetadata({
      songId: 1,
      patch,
      expectedRevision: (await service.getSourceMetadataSnapshot(1)).revision
    })
  assert.equal(
    db.prepare("SELECT 1 FROM sqlite_master WHERE name='song_metadata_override'").get(),
    undefined,
    'the existing library has no override table'
  )
  assert.equal((await service.readSongMetadataForEditing(1)).title, 'File title')
  const beforeSkip = plain(getSong())
  for (const state of [2, 3, 4, 5, 0]) {
    playbackStatus = { state, trackInfo: { filePath: audio } }
    await assert.rejects(apply({ title: 'Must skip' }), /metadataPlaybackSkipped/)
    await assert.rejects(
      service.writeSongMetadata(1, { title: 'Must skip' }),
      /metadataPlaybackSkipped/
    )
  }
  playbackStatus = { state: 3, trackInfo: { filePath: audio.toUpperCase() } }
  if (process.platform === 'win32')
    await assert.rejects(apply({ title: 'Must skip alias' }), /metadataPlaybackSkipped/)
  assert.equal(writes.length, 0, 'loaded audio cannot reach a file writer')
  assert.deepEqual(plain(getSong()), beforeSkip, 'skips cannot update the library')
  assert.equal(fileMetadata.title, 'File title')
  const raceCover = await sharp({
    create: { width: 8, height: 8, channels: 3, background: '#336699' }
  })
    .png()
    .toBuffer()
  let guardChecks = 0
  guard.setMetadataPlaybackStatusProvider(() =>
    ++guardChecks === 1 ? null : { trackInfo: { filePath: audio } }
  )
  await assert.rejects(
    service.writeSongMetadata(1, {
      coverDataUrl: 'data:image/png;base64,' + raceCover.toString('base64')
    }),
    /metadataPlaybackSkipped/,
    'playback starting during cover conversion must prevent the write'
  )
  assert.equal(writes.length, 0)
  assert.deepEqual(plain(getSong()), beforeSkip)
  assert.equal(readdirSync(path.join(root, 'covers')).length, 0, 'skips clean temporary covers')
  guard.setMetadataPlaybackStatusProvider(() => playbackStatus)
  playbackStatus = { state: 3, trackInfo: { filePath: path.join(root, 'other.mp3') } }

  await apply({ album: 'New album', albumArtist: 'Album artist' })
  assert.deepEqual(Object.keys(writes.at(-1)).sort(), ['album', 'albumArtist'])
  assert.equal(fileMetadata.album, 'New album')
  assert.equal(fileMetadata.albumArtist, 'Album artist')
  assert.equal(getSong().album, 'New album')
  assert.equal(getSong().title, 'Library override', 'only selected fields are synchronized')
  assert.equal(getSong().genre, 'Jazz')
  for (const patch of [{ duration: 10 }, { title: '' }, { year: NaN }, {}])
    await assert.rejects(apply(patch))
  const stale = await service.getSourceMetadataSnapshot(1)
  fileMetadata.artist = 'External edit'
  await assert.rejects(
    service.applySourceMetadata({
      songId: 1,
      patch: { title: 'Stale' },
      expectedRevision: stale.revision
    }),
    /Conflict/
  )
  await apply({ trackNumber: 3 })
  assert.deepEqual(Object.keys(writes.at(-1)), ['trackNumber'])
  assert.equal(getSong().trackNo, 3)
  const beforeFailure = plain(getSong())
  failWrite = true
  assert.equal((await apply({ title: 'Failed' })).success, false)
  assert.deepEqual(plain(getSong()), beforeFailure, 'failed file writes cannot update the library')
  assert.equal(fileMetadata.title, 'File title')
  failWrite = false
  assert.equal((await service.getSourceMetadataSnapshot(1)).metadata.genre, 'File genre')
  await apply({ genre: detail.metadata.genre })
  assert.equal(fileMetadata.genre, 'Rock, Pop')
  assert.equal(getSong().genre, 'Rock, Pop')
  assert.deepEqual(Object.keys(writes.at(-1)), ['genre'])
  await apply({ genre: normalizeSourceGenreNames(['流行-日本流行', 'J-Pop']).join(', ') })
  assert.equal(fileMetadata.genre, 'Pop-Jpop, Jpop')
  assert.equal(getSong().genre, 'Pop-Jpop, Jpop')
  await apply({ lyrics: '[00:01.00]New lyrics' })
  assert.equal(fileMetadata.lyrics, '[00:01.00]New lyrics')
  assert.equal(getSong().lrc, fileMetadata.lyrics)
  assert.equal(getSong().translation, null, 'replaced lyrics invalidate old translations')
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#336699' } })
    .png()
    .toBuffer()
  await apply({ coverDataUrl: 'data:image/png;base64,' + image.toString('base64') })
  const cover = getSong().cover
  assert(existsSync(cover))
  assert(fileMetadata.cover.length)
  assert.equal(existsSync(writes.at(-1).coverPath), false, 'temporary cover input is removed')
  assert.equal(getSong().cover_analysis_version, null)
  await assert.rejects(apply({ coverDataUrl: 'data:image/png;base64,YmFk' }))
  assert.equal(getSong().cover, cover)
  await apply({ title: 'Persistent file title', year: 2024 })
  assert.equal((await service.readSongMetadataForEditing(1)).title, 'Persistent file title')
  await service.reloadSongMetadata(1)
  assert.equal(getSong().title, 'Persistent file title', 'reload uses the updated file tags')
  assert.equal(getSong().album, 'New album')
  assert.equal(getSong().year, 2024)
  assert.deepEqual(readFileSync(getSong().cover), fileMetadata.cover)
  assert.equal(getSong().genre, 'Pop-Jpop, Jpop')
  fileMetadata.album = 'External file edit'
  await service.reloadSongMetadata(1)
  assert.equal(getSong().album, 'External file edit')
  const schema = load('src/main/database/schema.ts')
  for (const version of [1, 2]) {
    const legacyFile = path.join(root, 'v' + version + '.db')
    const old = new Database(legacyFile)
    old.exec(schema.schemaV1)
    old.exec('CREATE TABLE schema_migration(version INTEGER PRIMARY KEY)')
    old.prepare('INSERT INTO schema_migration VALUES(?)').run(version)
    old.close()
    const migrated = load('src/main/database/index.ts', {
      [path.resolve('src/main/i18n/index.ts')]: { t: (key) => key },
      [path.resolve('src/main/service/operationLogger.ts')]: {
        logOperation: (_name, _context, action) => action()
      },
      [path.resolve('src/main/search/searchTokens.ts')]: {
        normalizeSearchText: (value) => value,
        japaneseSortReading: (value) => value
      }
    })
    const upgraded = migrated.initDatabase(legacyFile)
    assert.equal(
      upgraded.prepare('SELECT MAX(version) AS version FROM schema_migration').get().version,
      2
    )
    assert.equal(
      upgraded.prepare("SELECT 1 FROM sqlite_master WHERE name='song_metadata_override'").get(),
      undefined,
      'initialization must not require or create an override table'
    )
    migrated.closeDatabase()
  }
  const snap = await service.getSourceMetadataSnapshot(1)
  const outcomes = await Promise.allSettled(
    ['A', 'B'].map((title) =>
      service.applySourceMetadata({ songId: 1, patch: { title }, expectedRevision: snap.revision })
    )
  )
  assert.equal(
    outcomes.filter((result) => result.status === 'fulfilled').length,
    1,
    'only one concurrent writer can use a revision'
  )
  console.log(
    'Metadata writes: file-first persistence, selected fields, failure isolation, reload, conflicts, cover and table-free compatibility passed'
  )
} finally {
  db.close()
  assert(root.startsWith(path.resolve('build') + path.sep))
  rmSync(root, { recursive: true, force: true })
}

const helpers = load('src/renderer/src/services/sourceMetadata.ts')
const tick = async () => {
  await new Promise(setImmediate)
  await Vue.nextTick()
}
const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const pending = []
const applied = []
let saved = 0
const failures = []
const cancelledRequests = []
const api = {
  listSources: async () => ({ success: true, data: [{ id: 'netease', displayName: 'NetEase' }] }),
  sourceSnapshot: async (id) => ({
    success: true,
    data: { metadata: { title: 'Local ' + id }, hasCover: false, revision: 'file-' + id }
  }),
  searchTracks: () => {
    const request = deferred()
    pending.push(request)
    return request.promise
  },
  getTrack: async (resource) => {
    structuredClone(resource)
    return { success: true, data: detail }
  },
  getTrackLyrics: async (resource) => {
    structuredClone(resource)
    return { success: true, data: { lrc: '[00:01.00]Lyrics' } }
  },
  downloadCover: async () => ({
    success: true,
    data: { dataUrl: 'data:image/png;base64,Y292ZXI=' }
  }),
  applySource: async (request) => {
    applied.push(plain(request))
    return { success: true }
  }
}
const { useSourceMetadata } = load(
  'src/renderer/src/components/songlist/useSourceMetadata.ts',
  { vue: Vue, '@/services/sourceMetadata': helpers },
  {
    window: {
      api: {
        metadata: api,
        networkSources: {
          cancelRequest: async (id) => {
            cancelledRequests.push(id)
            return { success: true }
          }
        }
      }
    }
  }
)
const scope = Vue.effectScope()
const visible = Vue.ref(true),
  songId = Vue.ref(1)
const state = scope.run(() =>
  useSourceMetadata(
    songId,
    visible,
    (key) => key,
    () => {
      saved++
    },
    (message) => failures.push(message)
  )
)
await tick()
const first = state.search()
const second = state.search()
pending[1].resolve({ success: true, data: [tracks[0]] })
await second
pending[0].resolve({ success: true, data: [] })
await first
assert.equal(state.results.value.length, 1, 'late search results cannot replace the newest results')
assert.equal(cancelledRequests.length, 1, 'replacing a request notifies the host')
const cancelledSearch = state.search()
state.cancelPending()
pending[2].resolve({ success: false, error: 'cancelled' })
await cancelledSearch
assert.equal(state.searching.value, false)
assert.equal(state.error.value, '', 'user cancellation stays quiet')
assert.equal(state.searched.value, false, 'cancellation is not an empty result')
assert.equal(cancelledRequests.length, 2)
state.results.value = [tracks[0]]
await state.choose(state.results.value[0])
assert.equal(
  state.error.value,
  '',
  'reactive search results must cross the IPC serialization boundary'
)
assert(state.detail.value)
assert.equal(applied.length, 0, 'searching and choosing candidates never writes metadata')
assert.equal(state.canSave.value, false, 'fields are not implicitly selected')
assert.equal(state.allSelected.value, false)
state.selectAll()
assert.equal(state.selectedCount.value, state.rows.value.length)
assert.equal(state.allSelected.value, true)
state.selected.value.pop()
assert.equal(state.partiallySelected.value, true)
assert.equal(state.allSelected.value, false)
state.selectAll(false)
assert.equal(state.selectedCount.value, 0)
assert.equal(state.partiallySelected.value, false)
assert.equal(state.canSave.value, false)
state.selectAll()
await state.fetchLyrics()
assert.equal(state.allSelected.value, false, 'newly fetched fields require explicit selection')
assert.equal(state.partiallySelected.value, true)
state.selected.value = ['title', 'albumArtist']
assert.equal(
  state.error.value,
  '',
  'reactive detail references must be serializable when fetching lyrics'
)
await state.fetchCover()
const successfulApply = api.applySource
api.applySource = async () => ({ success: false, error: 'metadataPlaybackSkipped' })
await state.save()
assert.equal(state.error.value, 'metadataPlaybackSkipped')
assert.equal(state.errorTitle.value, 'saveFailed')
assert.equal(failures.at(-1), 'saveFailed: metadataPlaybackSkipped')
assert.equal(saved, 0, 'a skipped write cannot announce a save or close the editor')
assert.deepEqual(plain(state.selected.value), ['title', 'albumArtist'])
assert.equal(
  state.canSave.value,
  true,
  'selection remains available for retry after switching tracks'
)
api.applySource = successfulApply
await state.save()
assert.deepEqual(
  applied[0].patch,
  { title: 'Studio', albumArtist: 'Album artist' },
  'only selected fields enter the file write request'
)
assert.equal('target' in applied[0], false)
assert.equal(applied[0].expectedRevision, 'file-1')
assert.equal(saved, 1)
const successfulSearch = api.searchTracks
api.searchTracks = async () => ({ success: false, error: 'Offline' })
await state.search()
assert.equal(state.errorTitle.value, 'networkSearchFailed')
assert.equal(failures.at(-1), 'networkSearchFailed: Offline')
api.searchTracks = successfulSearch
const old = deferred()
api.getTrack = () => old.promise
const loadingOld = state.choose(tracks[0])
songId.value = 2
await tick()
old.resolve({ success: true, data: detail })
await loadingOld
assert.equal(state.detail.value, undefined, 'old details cannot enter a new song session')
assert.equal(state.query.value, 'Local 2')
visible.value = false
await tick()
scope.stop()
console.log(
  'Metadata editor state: explicit selection, file snapshots, exact assets and stale request isolation passed'
)
