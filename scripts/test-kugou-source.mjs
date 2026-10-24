import { pluginRequire, pluginPath, projectRequire } from './lib/plugin-require.mjs'
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

function loader(mocks, globals = {}) {
  const cache = new Map()
  function load(file) {
    const filename = path.resolve(file)
    if (mocks[filename]) return mocks[filename]
    if (cache.has(filename)) return cache.get(filename)
    const exports = {}
    cache.set(filename, exports)
    vm.runInNewContext(
      ts.transpileModule(readFileSync(filename, 'utf8'), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true
        }
      }).outputText,
      {
        exports,
        Error,
        URL,
        AbortController,
        AbortSignal,
        Buffer,
        structuredClone,
        ...globals,
        require(name) {
          if (name === '@easy-player/plugin-sdk') return pluginRequire(name)
          if (mocks[name]) return mocks[name]
          if (!name.startsWith('.')) return projectRequire(filename, name)
          const target = path.resolve(path.dirname(filename), name)
          return load(existsSync(target + '.ts') ? target + '.ts' : path.join(target, 'index.ts'))
        }
      },
      { filename }
    )
    return exports
  }
  return load
}
const plain = (value) => JSON.parse(JSON.stringify(value))
const clone = (value) => JSON.parse(JSON.stringify(value))
const tick = () => new Promise(setImmediate)
const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { resolve, promise }
}
const hash1 = 'A'.repeat(32),
  hash2 = 'B'.repeat(32)
// Shapes reflect public SDK responses; names and lyric text are synthetic fixtures.
const searchRows = [
  {
    MixSongID: '101',
    OriSongName: 'Song',
    SingerName: 'Singer',
    Singers: [{ name: 'Singer' }, { name: 'Guest' }],
    AlbumID: '201',
    AlbumName: 'Studio',
    Duration: 210,
    FileHash: hash1,
    Image: 'http://image.test/{size}/studio.jpg',
    Grp: [
      {
        MixSongID: '102',
        OriSongName: 'Song',
        Suffix: '(Live)',
        SingerName: 'Singer',
        AlbumID: '202',
        AlbumName: 'Live album',
        Duration: 230,
        FileHash: hash2,
        Image: 'http://image.test/{size}/live.jpg'
      }
    ]
  },
  { MixSongID: '101', SongName: 'Duplicate', FileHash: hash1 },
  { MixSongID: '0', OriSongName: 'Invalid' },
  { MixSongID: 'unsafe', OriSongName: 'Invalid' }
]
const tracks = {
  101: {
    __status: 1,
    base: {
      album_audio_id: 101,
      songname: 'Song',
      author_name: 'Singer / Guest',
      album_id: 201,
      album_name: 'Studio',
      publish_date: '2020-06-10'
    },
    extra: { sort: 3, disc: 2 },
    audio_info: { hash: hash1, timelength: 210123 },
    album_info: { album_id: 201, cover: 'http://image.test/{size}/studio.jpg' },
    tags: [
      { id: 882, pid: 3, name: '流行' },
      { id: 1541, pid: 882, name: '华语流行' },
      { id: 983, pid: 1541, name: '国语流行' },
      { id: 983, pid: 0, name: '推荐活动' },
      { id: 84, pid: 7, name: '国语' },
      { id: 1701, pid: 4, name: '抒情伤怀' },
      { id: 1806, pid: 6, name: '爱情' },
      { id: 1774, pid: 5, name: '场所' },
      { id: 10, pid: 3, name: '摇滚', is_publish: 0 },
      { id: 66, pid: 67, name: 'Cycle' },
      { id: 67, pid: 66, name: 'Cycle' }
    ]
  },
  102: {
    __status: 1,
    base: {
      album_audio_id: 102,
      songname: 'Song (Live)',
      author_name: 'Singer',
      album_id: 202,
      album_name: 'Live album',
      publish_date: '2021-02-03'
    },
    extra: { suffix_audio_name: 'Live', sort: 4, disc: 1 },
    audio_info: { hash: hash2, timelength: 230000 },
    album_info: { album_id: 202, cover: 'http://image.test/{size}/live.jpg' }
  },
  103: {
    __status: 1,
    base: { album_audio_id: 103, songname: 'Sparse song', publish_date: '0000-00-00' },
    audio_info: { timelength: -1 },
    extra: { sort: 0, disc: 'bad' }
  }
}
const albums = {
  201: {
    album_id: '201',
    author_name: 'Album artist',
    publish_date: '2020-06-10',
    sizable_cover: 'http://image.test/{size}/album.jpg'
  },
  202: { album_id: '202', authors: [{ author_name: 'Concert artist' }] }
}
const calls = []
let albumFailure = false,
  searchFailure,
  malformedSearch = false,
  missingLyrics = false
let holdDetail, holdLyricSearch
const sdk = {
  search: async (params) => {
    calls.push(['search', plain(params)])
    if (searchFailure) return { status: 200, body: searchFailure }
    return {
      status: 200,
      body: { status: 1, error_code: 0, data: malformedSearch ? {} : { lists: clone(searchRows) } }
    }
  },
  krm_audio: async (params) => {
    calls.push(['detail', plain(params)])
    if (holdDetail) return holdDetail.promise
    return {
      status: 200,
      body: {
        status: 1,
        error_code: 0,
        data: tracks[params.album_audio_id] ? [clone(tracks[params.album_audio_id])] : []
      }
    }
  },
  album_detail: async (params) => {
    calls.push(['album', plain(params)])
    if (albumFailure) throw new Error('Optional album unavailable')
    return { status: 200, body: { status: 1, error_code: 0, data: [clone(albums[params.id])] } }
  },
  search_lyric: async (params) => {
    calls.push(['lyric-search', plain(params)])
    if (holdLyricSearch) return holdLyricSearch.promise
    return {
      status: 200,
      body: {
        status: 200,
        errcode: 200,
        candidates: missingLyrics
          ? []
          : [
              {
                id: params.hash === hash2 ? 'live-lyric' : 'studio-lyric',
                accesskey: 'fixture-key',
                song: 'Song',
                singer: 'Singer'
              }
            ]
      }
    }
  },
  lyric: async (params) => {
    calls.push(['lyric', { id: params.id, fmt: params.fmt }])
    return {
      status: 200,
      body: {
        status: 200,
        errcode: 200,
        decodeContent:
          params.fmt === 'krc' ? '[1000,500]<0,500,0>Fixture' : '[00:01.00]' + params.id
      }
    }
  }
}
let paused = false
const policy = {
  requireBackgroundWork() {
    if (paused) throw new Error('Paused')
  },
  isPlaybackOnly: () => paused,
  onPlaybackModeChanged: () => () => {}
}
const mocks = {
  kugoumusicapi: sdk,
  [path.resolve('src/main/i18n/index.ts')]: { t: (key) => key },
  [path.resolve('src/main/service/playbackMode.ts')]: policy,
  [path.resolve(pluginPath('official/netease/lyrics.ts'))]: {
    searchNeteaseLyrics: async () => []
  },
  [path.resolve(pluginPath('official/qqmusic/lyrics.ts'))]: {
    searchQQMusicLyrics: async () => []
  },
  [path.resolve(pluginPath('official/netease/artwork.ts'))]: {
    searchNeteaseArtwork: async () => []
  },
  [path.resolve(pluginPath('official/media/adapter.ts'))]: {
    biliSource: { id: 'bili', apiVersion: 1 },
    youtubeSource: { id: 'youtube', apiVersion: 1 }
  }
}
const load = loader(mocks)
const shared = load(pluginPath('official/kugou/shared.ts'))
assert.equal(shared.trackTitle({ OriSongName: 'Olive', Suffix: '(Live)' }), 'Olive (Live)')
assert.equal(shared.trackTitle({ SongName: 'Song Live', Suffix: 'Live' }), 'Song Live')
const registry = load('src/main/sources/index.ts').getNetworkSources()
// Explicit fixture activation: production startup contributes no sources.
for (const plugin of load(pluginPath('official/index.ts')).officialPlugins) {
  plugin.activate({ registerSource: (source) => registry.register(source) })
}
const metadata = load('src/main/sources/metadata.ts')
const kugou = load(pluginPath('official/kugou/metadata.ts'))
const lyrics = load(pluginPath('official/kugou/lyrics.ts'))
assert.equal(calls.length, 0, 'registration remains lazy')
assert.deepEqual(
  Array.from(metadata.listMetadataSources(), (source) => source.id),
  ['netease', 'kugou', 'qqmusic']
)
assert.equal(typeof registry.get('kugou').lyrics.get, 'function')
assert.equal(typeof registry.get('kugou').artwork.search, 'function')
const results = await metadata.searchSourceTracks('kugou', 'Song')
assert.deepEqual(
  plain(results).map((item) => [item.resource.resourceId, item.title]),
  [
    ['101', 'Song'],
    ['102', 'Song (Live)']
  ]
)
assert.equal(results[0].artist, 'Singer / Guest')
assert.equal(results[0].durationMs, 210000)
const detail = await metadata.getSourceTrack(results[0].resource)
assert.deepEqual(plain(detail.metadata), {
  title: 'Song',
  artist: 'Singer / Guest',
  album: 'Studio',
  albumArtist: 'Album artist',
  genre: 'Pop-Cpop',
  year: 2020,
  trackNumber: 3,
  discNumber: 2
})
assert.equal(detail.releaseDate, '2020-06-10')
assert.equal(detail.durationMs, 210123, 'detail duration is already milliseconds')
assert.equal(detail.artwork.imageUrl, 'https://image.test/500/studio.jpg')
assert.equal(detail.artwork.resource.resourceType, 'album')
assert.equal(detail.artwork.resource.resourceId, '201')
structuredClone(detail)
const live = await metadata.getSourceTrack(results[1].resource)
assert.equal(live.title, 'Song (Live)', 'do not append the version suffix twice')
assert.equal(live.metadata.albumArtist, 'Concert artist')
assert.equal(live.metadata.genre, undefined, 'absent genre never clears local tags')

const beforeCover = calls.length
const covers = await kugou.searchKugouArtwork({ title: 'Song' })
assert.equal(covers.length, 2)
assert.equal(calls.length, beforeCover + 1, 'artwork search uses search image descriptors directly')
assert.equal(covers[1].resource.resourceId, '202')

albumFailure = true
const partial = await kugou.getKugouTrack('101')
assert.equal(partial.metadata.albumArtist, undefined)
assert.equal(partial.metadata.trackNumber, 3)
assert(partial.artwork, 'optional album failure retains exact-track artwork')
albumFailure = false
const sparse = await kugou.getKugouTrack('103')
assert.deepEqual(plain(sparse.metadata), { title: 'Sparse song' })
assert.equal(sparse.releaseDate, undefined)
assert.equal(sparse.artwork, undefined)
const beforeInvalid = calls.length
for (const id of ['0', '-1', '1,2', '9007199254740992', 'NaN', 'https://evil.test'])
  await assert.rejects(kugou.getKugouTrack(id), (error) => error.code === 'INVALID_REQUEST')
assert.equal(calls.length, beforeInvalid, 'invalid IDs never reach the SDK')
await assert.rejects(kugou.getKugouTrack('999'), (error) => error.code === 'RESOURCE_NOT_FOUND')

const beforeLyrics = calls.length
const exact = await metadata.getSourceTrackLyrics(results[1].resource)
assert.equal(exact.lrc, '[00:01.00]live-lyric')
assert.equal(exact.title, 'Song (Live)')
assert.equal(exact.resource.resourceId, '102')
assert.deepEqual(
  calls.slice(beforeLyrics).map(([name]) => name),
  ['detail', 'lyric-search', 'lyric']
)
assert.equal(calls.at(-2)[1].hash, hash2)
assert.equal(calls.at(-2)[1].album_audio_id, '102')
assert.equal(
  (await lyrics.getKugouLyrics(hash1.toLowerCase(), true)).format,
  'krc',
  'old hash references remain supported'
)
missingLyrics = true
assert.equal(await metadata.getSourceTrackLyrics(results[0].resource), null)
missingLyrics = false

searchFailure = { status: 0, error_code: 403 }
await assert.rejects(
  metadata.searchSourceTracks('kugou', 'Song'),
  (error) => error.code === 'AUTH_REQUIRED'
)
searchFailure = { status: 0, error_code: 429 }
await assert.rejects(
  metadata.searchSourceTracks('kugou', 'Song'),
  (error) => error.code === 'RATE_LIMITED'
)
searchFailure = undefined
malformedSearch = true
await assert.rejects(
  metadata.searchSourceTracks('kugou', 'Song'),
  (error) => error.code === 'INVALID_RESPONSE'
)
malformedSearch = false
registry.setEnabled('kugou', false)
await assert.rejects(
  metadata.searchSourceTracks('kugou', 'Song'),
  (error) => error.code === 'SOURCE_DISABLED'
)
assert.equal(
  metadata.listMetadataSources().some((source) => source.id === 'kugou'),
  false
)
registry.setEnabled('kugou', true)

// Cancelling a delayed exact-track lookup cannot start optional album or lyric work.
holdDetail = deferred()
const controller = new AbortController()
const pending = metadata.getSourceTrackLyrics(results[0].resource, { signal: controller.signal })
await tick()
const beforeCancel = calls.length
controller.abort()
await assert.rejects(pending, (error) => error.code === 'CANCELLED')
holdDetail.resolve({ body: { status: 1, data: [clone(tracks[101])] } })
await tick()
assert.equal(calls.length, beforeCancel)
holdDetail = undefined
holdLyricSearch = deferred()
const nextController = new AbortController()
const pendingLyric = metadata.getSourceTrackLyrics(results[0].resource, {
  signal: nextController.signal
})
await tick()
const beforeLyricCancel = calls.length
nextController.abort()
await assert.rejects(pendingLyric, (error) => error.code === 'CANCELLED')
holdLyricSearch.resolve({
  body: { status: 200, errcode: 200, candidates: [{ id: 'late', accesskey: 'key' }] }
})
await tick()
assert.equal(calls.length, beforeLyricCancel, 'late lyric candidates must not trigger a download')
holdLyricSearch = undefined
console.log(
  'Kugou source: album-specific versions, metadata/genre mapping, optional album fallback, exact lyrics, artwork, failures, disable and cancellation passed'
)
