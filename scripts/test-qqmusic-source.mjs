/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
const require = createRequire(import.meta.url)
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
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
      }).outputText,
      {
        exports,
        Error,
        URL,
        URLSearchParams,
        AbortController,
        AbortSignal,
        Buffer,
        structuredClone,
        ...globals,
        require(name) {
          if (mocks[name]) return mocks[name]
          if (!name.startsWith('.')) return require(name)
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
const tick = () => new Promise(setImmediate)
const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const studioMid = '000StudioSong1',
  liveMid = '000LiveSong001',
  sparseMid = '000SparseSong1'
const albumMid = '000StudioAlbum',
  liveAlbumMid = '000LiveAlbum01'
assert.equal(studioMid.length, 14)
// Synthetic values using shapes observed in QQ's real responses.
const studio = {
  mid: studioMid,
  id: 101,
  name: 'Song',
  title: 'Song',
  interval: 210,
  singer: [{ name: 'Singer' }, { name: 'Guest' }],
  album: { mid: albumMid, name: 'Studio', pmid: albumMid + '_5' },
  index_album: 3,
  index_cd: 0,
  time_public: '2020-06-10',
  genre: 1
}
const live = {
  mid: liveMid,
  id: 102,
  name: 'Song',
  title: 'Song (Live)',
  interval: 230,
  singer: [{ name: 'Singer' }],
  album: { mid: liveAlbumMid, name: 'Live album' },
  index_album: 4,
  index_cd: 1,
  time_public: '2021-07-08',
  genre: 1
}
const tracks = {
  [studioMid]: {
    track_info: studio,
    info: {
      genre: { content: [{ value: '流行-日本流行' }, { value: 'Pop-Jpop' }] },
      lan: { content: [{ value: '国语' }] },
      intro: { content: [{ value: 'Not a genre' }] }
    }
  },
  [liveMid]: { track_info: live, info: {} },
  [sparseMid]: {
    track_info: {
      mid: sparseMid,
      title: 'Sparse song',
      index_album: 0,
      time_public: '0000-00-00',
      genre: 1
    }
  }
}
const qrc = require('qrc-decoder').encryptQrc('[1000,500]Word(1000,500)')
const calls = []
let searchMode = 'normal',
  albumMode = 'normal',
  lyricMode = 'normal',
  detailMode = 'normal',
  paused = false
let holdSearch, holdDetail
const response = (value, status = 200) => ({
  ok: status === 200,
  status,
  text: async () => JSON.stringify(value)
})
const rpc = (data) => response({ code: 0, req_1: { code: 0, data } })
const mocks = {
  [path.resolve('src/main/i18n/index.ts')]: { t: (key) => key },
  [path.resolve('src/main/service/playbackMode.ts')]: {
    isPlaybackOnly: () => paused,
    onPlaybackModeChanged: () => () => undefined
  },
  [path.resolve('plugins/official/netease/lyrics.ts')]: {
    searchNeteaseLyrics: async () => []
  },
  [path.resolve('plugins/official/kugou/lyrics.ts')]: {
    searchKugouLyrics: async () => []
  },
  [path.resolve('plugins/official/netease/artwork.ts')]: {
    searchNeteaseArtwork: async () => []
  },
  [path.resolve('plugins/official/media/adapter.ts')]: {
    biliSource: { id: 'bili', apiVersion: 1 },
    youtubeSource: { id: 'youtube', apiVersion: 1 }
  }
}
const load = loader(mocks, {
  fetch: async (url, options) => {
    assert(options.signal instanceof AbortSignal, 'all QQ transports have a deadline')
    const request = options.body ? JSON.parse(options.body).req_1 : undefined
    const operation =
      request?.method ?? (url.includes('client_search_cp') ? 'legacy-search' : 'lrc')
    calls.push({ operation, param: request?.param, url, signal: options.signal })
    if (operation === 'DoSearchForQQMusicDesktop') {
      if (holdSearch) return holdSearch.promise
      if (searchMode === 'fallback') throw new Error('Desktop endpoint unavailable')
      if (searchMode === 'denied') return response({}, 403)
      if (searchMode === 'limited') return response({ code: 0, req_1: { code: 429 } })
      if (searchMode === 'empty') return rpc({ body: { song: { list: [] } } })
      if (searchMode === 'malformed') return response([])
      return rpc({
        body: {
          song: { list: [{ ...studio, grp: [live] }, studio, { mid: 'bad', title: 'Invalid' }] }
        }
      })
    }
    if (operation === 'legacy-search') {
      if (searchMode === 'malformed') return response({ code: 0, data: {} })
      return response({
        code: 0,
        data: {
          song: {
            list: [
              {
                songmid: studioMid,
                songname: 'Legacy song',
                singer: [{ name: 'Singer' }],
                albumname: 'Legacy album',
                albummid: albumMid,
                interval: 210
              }
            ]
          }
        }
      })
    }
    if (operation === 'get_song_detail_yqq') {
      if (holdDetail) return holdDetail.promise
      if (detailMode === 'wrong') return rpc(tracks[liveMid])
      if (!tracks[request.param.song_mid]) return response({ code: 0, req_1: { code: 404 } })
      return rpc(tracks[request.param.song_mid])
    }
    if (operation === 'GetAlbumDetail') {
      if (albumMode === 'failed') return response({}, 500)
      return rpc({
        basicInfo: {
          albumMid: albumMode === 'wrong' ? liveAlbumMid : request.param.albumMId,
          genreNew: 'Rap',
          publishDate: '1999-01-01'
        },
        singer: { singerList: [{ name: 'Album artist' }] }
      })
    }
    if (operation === 'GetPlayLyricInfo') {
      assert.equal(request.param.songMID, liveMid)
      assert.equal(request.param.songID, 102)
      return rpc({ lyric: qrc, trans: Buffer.from('[00:01.00]Translation').toString('base64') })
    }
    assert.equal(operation, 'lrc')
    if (lyricMode === 'denied') return response({ code: 403 })
    const mid = new URL(url).searchParams.get('songmid')
    return response({
      code: 0,
      lyric:
        lyricMode === 'empty'
          ? ''
          : Buffer.from('[00:01.00]' + (mid === liveMid ? 'Live' : 'Studio')).toString('base64')
    })
  }
})
const registry = load('src/main/sources/index.ts').getNetworkSources()
// Explicit fixture activation: production startup contributes no sources.
for (const plugin of load('plugins/official/index.ts').officialPlugins) {
  plugin.activate({ registerSource: (source) => registry.register(source) })
}
const metadata = load('src/main/sources/metadata.ts')
const qq = load('plugins/official/qqmusic/metadata.ts')
const lyrics = load('plugins/official/qqmusic/lyrics.ts')
const shared = load('plugins/official/qqmusic/shared.ts')
assert.equal(calls.length, 0, 'registration never performs a lookup')
assert.deepEqual(
  Array.from(metadata.listMetadataSources(), (source) => source.id),
  ['netease', 'kugou', 'qqmusic']
)
assert.equal(typeof registry.get('qqmusic').lyrics.get, 'function')
assert.equal(typeof registry.get('qqmusic').artwork.search, 'function')
const results = await metadata.searchSourceTracks('qqmusic', 'Song')
assert.deepEqual(
  plain(results).map((song) => [song.resource.resourceId, song.title]),
  [
    [studioMid, 'Song'],
    [liveMid, 'Song (Live)']
  ]
)
assert.equal(results[0].durationMs, 210000)
const detail = await metadata.getSourceTrack(results[0].resource)
assert.deepEqual(plain(detail.metadata), {
  title: 'Song',
  artist: 'Singer / Guest',
  album: 'Studio',
  albumArtist: 'Album artist',
  genre: 'Pop-Jpop',
  year: 2020,
  trackNumber: 3,
  discNumber: 1
})
assert.equal(detail.releaseDate, '2020-06-10')
assert.equal(detail.artwork.resource.resourceId, albumMid)
assert(
  detail.artwork.imageUrl.endsWith(albumMid + '_5.jpg'),
  'cover revision belongs to this album'
)
structuredClone(detail)
const liveDetail = await metadata.getSourceTrack(results[1].resource)
assert.equal(liveDetail.title, 'Song (Live)', 'title retains the version when name omits it')
assert.equal(liveDetail.metadata.discNumber, 2, 'QQ disc index is zero-based')
assert.equal(
  liveDetail.metadata.genre,
  undefined,
  'never infer song genre from its enum, language or album genre'
)
const sparse = await qq.getQQMusicTrack(sparseMid)
assert.deepEqual(plain(sparse.metadata), { title: 'Sparse song' })
assert.equal(sparse.artwork, undefined)
albumMode = 'failed'
assert.equal((await qq.getQQMusicTrack(studioMid)).metadata.albumArtist, undefined)
albumMode = 'wrong'
assert.equal((await qq.getQQMusicTrack(studioMid)).metadata.albumArtist, undefined)
albumMode = 'normal'
const beforeCovers = calls.length
assert.equal((await qq.searchQQMusicArtwork({ title: 'Song' })).length, 2)
assert.equal(calls.length, beforeCovers + 1, 'gallery does not fetch each track again')
assert(shared.albumCover({ mid: albumMid, pmid: liveAlbumMid + '_5' }).endsWith(albumMid + '.jpg'))

const beforeExact = calls.length
const exact = await metadata.getSourceTrackLyrics(results[1].resource)
assert.equal(exact.lrc, '[00:01.00]Live')
assert.equal(exact.title, 'Song (Live)')
assert.equal(exact.resource.resourceId, liveMid)
assert.deepEqual(
  calls.slice(beforeExact).map((call) => call.operation),
  ['get_song_detail_yqq', 'lrc']
)
assert.equal((await lyrics.getQQMusicLyrics(liveMid, true)).format, 'yrc')
lyricMode = 'empty'
assert.equal(await metadata.getSourceTrackLyrics(results[0].resource), null)
lyricMode = 'denied'
await assert.rejects(
  metadata.getSourceTrackLyrics(results[0].resource),
  (error) => error.code === 'AUTH_REQUIRED'
)
lyricMode = 'normal'
const beforeInvalid = calls.length
for (const mid of ['bad', '../escape', 'https://evil.test', '1,2', 'a'.repeat(15)])
  await assert.rejects(qq.getQQMusicTrack(mid), (error) => error.code === 'INVALID_REQUEST')
assert.equal(calls.length, beforeInvalid)
await assert.rejects(
  metadata.getSourceTrack({
    sourceId: 'qqmusic',
    resourceType: 'track',
    resourceId: '00000000000000'
  }),
  (error) => error.code === 'RESOURCE_NOT_FOUND'
)
detailMode = 'wrong'
await assert.rejects(
  metadata.getSourceTrack(results[0].resource),
  (error) => error.code === 'RESOURCE_NOT_FOUND'
)
detailMode = 'normal'

for (const [mode, code] of [
  ['denied', 'AUTH_REQUIRED'],
  ['limited', 'RATE_LIMITED'],
  ['malformed', 'INVALID_RESPONSE']
]) {
  searchMode = mode
  const before = calls.length
  await assert.rejects(
    metadata.searchSourceTracks('qqmusic', 'Song'),
    (error) => error.code === code
  )
  if (mode !== 'malformed')
    assert.equal(calls.length, before + 1, 'explicit denials never trigger a second endpoint')
}
searchMode = 'empty'
const beforeEmpty = calls.length
assert.equal((await metadata.searchSourceTracks('qqmusic', 'Absent song')).length, 0)
assert.equal(calls.length, beforeEmpty + 1, 'valid empty results are not failures')
searchMode = 'fallback'
assert.equal((await metadata.searchSourceTracks('qqmusic', 'Song'))[0].title, 'Legacy song')
searchMode = 'normal'
registry.setEnabled('qqmusic', false)
await assert.rejects(
  metadata.searchSourceTracks('qqmusic', 'Song'),
  (error) => error.code === 'SOURCE_DISABLED'
)
registry.setEnabled('qqmusic', true)
paused = true
await assert.rejects(
  metadata.searchSourceTracks('qqmusic', 'Song'),
  (error) => error.code === 'BACKGROUND_PAUSED'
)
paused = false

holdSearch = deferred()
const controller = new AbortController()
const searching = metadata.searchSourceTracks('qqmusic', 'Song', { signal: controller.signal })
await tick()
const beforeCancel = calls.length,
  lastSignal = calls.at(-1).signal
controller.abort()
await assert.rejects(searching, (error) => error.code === 'CANCELLED')
assert.equal(lastSignal.aborted, true, 'the actual fetch signal is aborted')
holdSearch.resolve(response({ code: 0, req_1: { code: 0, data: {} } }))
await tick()
assert.equal(calls.length, beforeCancel, 'cancelled searches do not start legacy fallback')
holdSearch = undefined
holdDetail = deferred()
const next = new AbortController()
const exactPending = metadata.getSourceTrackLyrics(results[1].resource, { signal: next.signal })
await tick()
const beforeDetailCancel = calls.length
next.abort()
await assert.rejects(exactPending, (error) => error.code === 'CANCELLED')
holdDetail.resolve(rpc(tracks[liveMid]))
await tick()
assert.equal(calls.length, beforeDetailCancel, 'late details do not trigger lyric requests')
holdDetail = undefined
console.log(
  'QQ Music source: MID identity, version titles, metadata/genre, optional album, exact LRC/QRC, covers, fallback, errors, disable and physical cancellation passed'
)
