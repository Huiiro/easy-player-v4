/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)

function load(file, mocks = {}, globals = {}, cache = new Map()) {
  const filename = resolve(file)
  if (cache.has(filename)) return cache.get(filename)
  const exports = {}
  cache.set(filename, exports)
  const source = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  vm.runInNewContext(
    source,
    {
      exports,
      Buffer,
      URLSearchParams,
      AbortSignal,
      Date,
      require: (name) => {
        if (name in mocks) return mocks[name]
        if (name.startsWith('.'))
          return load(resolve(dirname(filename), `${name}.ts`), mocks, globals, cache)
        return require(name)
      },
      ...globals
    },
    { filename }
  )
  return exports
}

let playbackOnly = false
const policy = { isPlaybackOnly: () => playbackOnly }
const query = { title: 'Test song', artist: 'Singer', album: 'Album' }
const qqFile = 'src/main/service/lyrics/providers/qqmusic.ts'
const calls = []
const encoded = (value) => Buffer.from(value).toString('base64')
const qq = load(
  qqFile,
  { '../../playbackMode': policy },
  {
    fetch: async (url, options) => {
      calls.push({ url, options })
      assert(options.signal instanceof AbortSignal, 'QQ requests have a timeout')
      const parsed = new URL(url)
      if (parsed.hostname === 'u.y.qq.com') {
        assert.equal(JSON.parse(options.body).req_1.param.query, 'Test song Singer Album')
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              code: 0,
              req_1: {
                code: 0,
                data: {
                  body: {
                    song: {
                      list: [
                        {
                          mid: 'one',
                          name: 'Test song',
                          singer: [{ name: 'Singer' }],
                          album: { name: 'Album' }
                        },
                        { mid: 'one', name: 'duplicate' },
                        { mid: 'failed', name: 'Test song (Live)' },
                        { mid: 'empty', name: 'Test song' },
                        { mid: 'denied', name: 'Test song' },
                        { mid: 'unrelated', name: 'Another song' },
                        { name: 'missing ID' }
                      ]
                    }
                  }
                }
              }
            })
        }
      }
      const mid = parsed.searchParams.get('songmid')
      if (mid === 'failed') throw new Error('one lyric request failed')
      const data =
        mid === 'empty'
          ? { code: 0, lyric: '[ti:Metadata only]' }
          : mid === 'denied'
            ? { code: 1, lyric: '[00:01.00]ignored' }
            : {
                code: 0,
                lyric: encoded('[offset:100]\n[00:01.00]A &amp; B &#x4f60;'),
                trans: encoded('[00:01.10]Translation'),
                roma: '[00:01.10]ni'
              }
      return { ok: true, text: async () => `MusicJsonCallback(${JSON.stringify(data)});` }
    }
  }
)
const results = await qq.searchQQMusicLyrics(query, false)
assert.equal(results.length, 1, 'deduplicate songs and isolate invalid or failed lyrics')
assert.equal(results[0].provider, 'qqmusic')
assert.equal(results[0].lrc, '[00:01.100]A & B 你')
assert.equal(results[0].translation, '[00:01.10]Translation')
assert.equal(results[0].romanization, '[00:01.10]ni')
assert.equal(results[0].supportsWordTiming, false)
assert.equal(results[0].format, 'lrc')
assert.equal(results[0].artist, 'Singer')
assert.equal(results[0].album, 'Album')
assert.equal(calls.length, 5)
await qq.searchQQMusicLyrics({ title: ' ' }, false)
playbackOnly = true
await qq.searchQQMusicLyrics(query, false)
assert.equal(calls.length, 5, 'skip requests for empty queries and playback-only mode')
playbackOnly = false

const fallbackCalls = []
const fallbackQQ = load(
  qqFile,
  { '../../playbackMode': policy },
  {
    fetch: async (url) => {
      fallbackCalls.push(url)
      if (url.includes('musicu.fcg')) throw new Error('desktop search unavailable')
      if (url.includes('client_search_cp'))
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              code: 0,
              data: {
                song: {
                  list: [
                    {
                      songmid: 'legacy',
                      songname: 'Old song',
                      singer: [{ name: 'Old singer' }],
                      albumname: 'Old album'
                    }
                  ]
                }
              }
            })
        }
      return {
        ok: true,
        text: async () =>
          JSON.stringify({ code: 0, lyric: '[00:02.00]Legacy lyric', trans: 'untimed translation' })
      }
    }
  }
)
const fallback = await fallbackQQ.searchQQMusicLyrics({ ...query, title: 'Old song' }, false)
assert.equal(fallback[0].title, 'Old song')
assert.equal(fallback[0].album, 'Old album')
assert.equal(fallback[0].translation, undefined, 'do not attach untimed text as an LRC track')
assert.equal(fallbackCalls.length, 3, 'desktop search falls back to the referenced legacy endpoint')

const candidate = (provider, title = query.title) => ({
  id: provider,
  provider,
  title,
  artist: query.artist,
  album: query.album,
  lrc: '[00:01.00]Lyrics',
  format: 'lrc',
  supportsWordTiming: false
})
const { encryptQrc } = require('qrc-decoder')
const qrcSource =
  '<?xml version="1.0"?><QrcInfos><Lyric_1 LyricContent="[offset:100]\n[1000,800]你(1000,300)好(1300,500)\n[2200,600]世(2200,200)界(2400,400)\n"/></QrcInfos>'
const encryptedQrc = encryptQrc(qrcSource)
const qrc = load('src/main/service/lyrics/qrc.ts')
const convertedQrc = qrc.qrcToYrc(qrc.decodeQQMusicLyric(encryptedQrc))
assert.equal(
  convertedQrc,
  '[1100,800](1100,300,0)你(1400,500,0)好\n[2300,600](2300,200,0)世(2500,400,0)界'
)
assert.equal(qrc.decodeQQMusicLyric('0123456789abcdef'), '', 'isolate malformed encrypted QRC')
assert.equal(qrc.qrcToYrc('[1000,800]No word timestamps'), '', 'do not invent word timings')
assert.equal(qrc.normalizeQQMusicTrack(encryptQrc('[00:01.100]Hello')).format, 'lrc')
const { parseLyrics } = load('src/renderer/src/services/lyrics.ts')
const parsedQrc = parseLyrics({ content: convertedQrc, format: 'yrc', source: 'network' })
assert.equal(parsedQrc.lines[0].text, '你好')
assert.equal(parsedQrc.lines[0].words[0].startMs, 1100)
assert.equal(parsedQrc.lines[0].words[1].endMs, 1900)

let wordAvailable = true
const qrcQQ = load(
  qqFile,
  { '../../playbackMode': policy },
  {
    fetch: async (url, options) => {
      if (url.includes('musicu.fcg')) {
        const request = JSON.parse(options.body).req_1
        if (request.method === 'DoSearchForQQMusicDesktop')
          return {
            ok: true,
            text: async () =>
              JSON.stringify({
                code: 0,
                req_1: {
                  code: 0,
                  data: {
                    body: {
                      song: {
                        list: [{ id: 123, mid: 'word', name: query.title }]
                      }
                    }
                  }
                }
              })
          }
        assert.equal(request.module, 'music.musichallSong.PlayLyricInfo')
        assert.equal(request.method, 'GetPlayLyricInfo')
        assert.equal(request.param.songID, 123)
        assert.equal(request.param.qrc, 1)
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              code: 0,
              req_1: {
                code: 0,
                data: {
                  lyric: wordAvailable ? encryptedQrc : encryptQrc('[00:01.100]普通歌词'),
                  trans: encryptQrc('[00:01.100]Hello'),
                  roma: encryptedQrc
                }
              }
            })
        }
      }
      return {
        ok: true,
        text: async () => JSON.stringify({ code: 0, lyric: '[00:01.100]普通歌词' })
      }
    }
  }
)
const qqWordResults = await qrcQQ.searchQQMusicLyrics(query, true)
assert.equal(qqWordResults[0].supportsWordTiming, true)
assert.equal(qqWordResults[0].format, 'yrc')
assert.equal(qqWordResults[0].lrc, convertedQrc)
assert.equal(qqWordResults[0].translation, '[00:01.100]Hello')
assert.equal(qqWordResults[0].translationFormat, 'lrc')
assert.equal(qqWordResults[0].romanizationFormat, 'yrc')
wordAvailable = false
const qqFallbackNetwork = load('src/main/service/lyrics/network.ts', {
  '../playbackMode': policy,
  './providers/netease': { searchNeteaseLyrics: async () => [] },
  './providers/kugou': { searchKugouLyrics: async () => [] },
  './providers/qqmusic': qrcQQ
})
const qqLineFallback = await qqFallbackNetwork.searchNetworkLyrics(query)
assert.equal(qqLineFallback[0].supportsWordTiming, false)
assert.equal(
  qqLineFallback[0].format,
  'lrc',
  'fall back to the older LRC endpoint when QRC is absent'
)

const searches = []
let wordResults = false
const network = load('src/main/service/lyrics/network.ts', {
  '../playbackMode': policy,
  './providers/netease': {
    searchNeteaseLyrics: async (_, word) => {
      searches.push(['netease', word])
      return word && wordResults
        ? [{ ...candidate('netease'), format: 'yrc', supportsWordTiming: true }]
        : []
    }
  },
  './providers/kugou': {
    searchKugouLyrics: async () => {
      throw new Error('provider down')
    }
  },
  './providers/qqmusic': {
    searchQQMusicLyrics: async (_, word) => {
      searches.push(['qqmusic', word])
      return word ? [] : [candidate('qqmusic', 'unrelated'), candidate('qqmusic')]
    }
  }
})
const ranked = await network.searchNetworkLyrics(query)
assert.equal(ranked[0].title, query.title, 'rank QQ candidates by the existing match rules')
assert.equal(ranked.length, 1, 'exclude unrelated QQ titles from merged results')
assert(
  searches.some(([provider, word]) => provider === 'qqmusic' && !word),
  'fall back to QQ LRC if no word-timed source succeeds'
)
searches.length = 0
wordResults = true
const preferred = await network.searchNetworkLyrics(query)
assert.equal(preferred[0].format, 'yrc')
assert(
  preferred.some((item) => item.provider === 'qqmusic'),
  'keep QQ LRC results when another provider returns word-timed lyrics'
)
searches.length = 0
playbackOnly = true
assert.equal((await network.searchNetworkLyrics(query)).length, 0)
assert.equal(searches.length, 0)
playbackOnly = false

const mixedSearches = []
const mixedNetwork = load('src/main/service/lyrics/network.ts', {
  '../playbackMode': policy,
  './providers/netease': {
    searchNeteaseLyrics: async (_, word) => {
      mixedSearches.push(['netease', word])
      return word
        ? [{ ...candidate('netease', 'unrelated word result'), supportsWordTiming: true }]
        : [candidate('netease')]
    }
  },
  './providers/kugou': {
    searchKugouLyrics: async (_, word) => {
      mixedSearches.push(['kugou', word])
      if (!word) throw new Error('LRC unavailable')
      return [{ ...candidate('kugou'), format: 'krc', supportsWordTiming: true }]
    }
  },
  './providers/qqmusic': {
    searchQQMusicLyrics: async (_, word) => {
      mixedSearches.push(['qqmusic', word])
      return word ? [] : [candidate('qqmusic')]
    }
  }
})
const mixed = await mixedNetwork.searchNetworkLyrics(query)
assert.equal(mixed.length, 3, 'return all three sources even when only Kugou has word timing')
assert.equal(mixed[0].provider, 'kugou', 'rank word-timed lyrics first when preferred')
assert.deepEqual(
  new Set(mixed.map((item) => item.provider)),
  new Set(['netease', 'kugou', 'qqmusic'])
)
assert(mixedSearches.some(([provider, word]) => provider === 'netease' && !word))
assert(mixedSearches.some(([provider, word]) => provider === 'qqmusic' && !word))
mixedSearches.length = 0
const linePreferred = await mixedNetwork.searchNetworkLyrics({ ...query, preferWordTimed: false })
assert.equal(linePreferred.length, 3, 'a failed preferred format falls back within that source')
assert.equal(
  linePreferred[0].supportsWordTiming,
  false,
  'rank LRC first when word timing is disabled'
)
assert.equal(linePreferred.at(-1).provider, 'kugou')
assert(mixedSearches.some(([provider, word]) => provider === 'kugou' && word))
mixedSearches.length = 0
assert.equal((await mixedNetwork.searchNetworkLyrics({ title: ' ' })).length, 0)
assert.equal(mixedSearches.length, 0, 'skip all sources for empty searches')

const { isRelevantCandidate } = load('src/main/service/lyrics/relevance.ts')
for (const item of [
  candidate('qqmusic'),
  { ...candidate('netease'), artist: 'Singer / Guest', album: 'Compilation album' },
  { ...candidate('kugou'), artist: 'Singer (辛格)' },
  { ...candidate('qqmusic'), title: 'Test song (Remastered 2024)' }
])
  assert.equal(isRelevantCandidate(item, query), true, JSON.stringify(item))
for (const item of [
  { ...candidate('qqmusic'), artist: 'Other singer' },
  { ...candidate('qqmusic'), artist: 'Singer Two' },
  { ...candidate('netease'), title: 'Test song (Live)' },
  { ...candidate('kugou'), title: 'Test song (伴奏版)' },
  { ...candidate('qqmusic'), title: 'Test song (Cover)' },
  { ...candidate('qqmusic'), title: 'Test song - Acoustic' },
  { ...candidate('qqmusic'), title: 'Test song (钢琴版)' },
  { ...candidate('qqmusic'), title: 'Test song (女声版)' }
])
  assert.equal(isRelevantCandidate(item, query), false, JSON.stringify(item))
assert.equal(
  isRelevantCandidate({ ...candidate('qqmusic'), artist: 'Guest' }, { title: query.title }),
  true
)
assert.equal(
  isRelevantCandidate(
    { ...candidate('qqmusic'), artist: 'Guest' },
    { ...query, artist: 'Unknown Artist' }
  ),
  true
)
assert.equal(
  isRelevantCandidate(candidate('qqmusic'), { ...query, artist: 'Singer / Guest' }),
  false
)
assert.equal(
  isRelevantCandidate(
    { ...candidate('qqmusic'), title: 'Test song (Live)' },
    { ...query, title: 'Test song (Live)' }
  ),
  true
)
assert.equal(
  isRelevantCandidate(candidate('qqmusic'), { ...query, title: 'Test song (Live)' }),
  false
)

const relevanceCalls = []
const relevantNetwork = load('src/main/service/lyrics/network.ts', {
  '../playbackMode': policy,
  './providers/netease': {
    searchNeteaseLyrics: async (_, word) => {
      relevanceCalls.push(['netease', word])
      return word
        ? [{ ...candidate('netease'), artist: 'Cover artist', supportsWordTiming: true }]
        : [candidate('netease')]
    }
  },
  './providers/kugou': { searchKugouLyrics: async () => [] },
  './providers/qqmusic': {
    searchQQMusicLyrics: async (_, word) => {
      relevanceCalls.push(['qqmusic', word])
      return word
        ? [{ ...candidate('qqmusic'), title: 'Test song (Live)', supportsWordTiming: true }]
        : [candidate('qqmusic'), { ...candidate('qqmusic'), artist: 'Unrelated artist' }]
    }
  }
})
const relevantResults = await relevantNetwork.searchNetworkLyrics(query)
assert.equal(
  relevantResults.length,
  2,
  'remove wrong singers and unrequested versions from final results'
)
assert.deepEqual(
  new Set(relevantResults.map((item) => item.provider)),
  new Set(['netease', 'qqmusic'])
)
assert(relevantResults.every((item) => item.artist === query.artist && !item.supportsWordTiming))
assert(
  relevanceCalls.some(([provider, word]) => provider === 'netease' && !word),
  'irrelevant word-timed results must not block relevant LRC'
)
assert(relevanceCalls.some(([provider, word]) => provider === 'qqmusic' && !word))

const netease = load('src/main/service/lyrics/providers/netease.ts', {
  '../../playbackMode': policy,
  '@neteasecloudmusicapienhanced/api': {
    default: {
      search: async (params) => {
        assert.equal(
          params.keywords,
          'Test song Singer',
          'do not constrain Netease search by album'
        )
        return {
          status: 200,
          body: {
            result: {
              songs: [{ id: 1, name: query.title, ar: [{ name: 'Singer' }], al: { name: 'Album' } }]
            }
          }
        }
      },
      lyric_new: async () => ({ status: 500 }),
      lyric: async () => ({ status: 200, body: { lrc: { lyric: '[00:01.00]Netease' } } })
    }
  }
})
const neteaseResults = await netease.searchNeteaseLyrics(query, false)
assert.equal(neteaseResults[0].lrc, '[00:01.00]Netease')
assert.equal(neteaseResults[0].artist, 'Singer')
assert.equal(neteaseResults[0].album, 'Album')
const { isRelatedTitle } = load('src/main/service/lyrics/utils.ts')
for (const [actual, expected] of [
  ['晴天', '晴天'],
  ['晴天（Live）', '晴天'],
  ['晴天 (伴奏版)', '晴天'],
  ['Test Song (Remastered 2024)', 'test song'],
  ['Test song - Acoustic', 'test song'],
  ['Ｈｅｌｌｏ！', 'hello'],
  ['晴天 周杰伦', '晴天'],
  ['周杰伦 - 晴天', '晴天']
])
  assert.equal(isRelatedTitle(actual, expected, '周杰伦'), true, actual)
for (const [actual, expected] of [
  ['晴天', '晴'],
  ['晴天以外的故事', '晴天'],
  ['Love Story', 'Love'],
  ['The Song', 'Song'],
  ['Song Test', 'Test Song'],
  ['', '晴天']
])
  assert.equal(isRelatedTitle(actual, expected), false, actual)
const kugou = load('src/main/service/lyrics/providers/kugou.ts', {
  '../../playbackMode': policy,
  kugoumusicapi: {
    default: {
      search: async () => ({
        body: { data: { lists: [{ FileHash: 'hash', SongName: query.title }] } }
      }),
      search_lyric: async () => ({ body: { candidates: [{ id: 1, accesskey: 'key' }] } }),
      lyric: async () => ({ body: { decodeContent: '[1000,500]<0,500,0>Kugou' } })
    }
  }
})
assert.equal((await kugou.searchKugouLyrics(query, true))[0].format, 'krc')

const local = load('src/main/service/lyrics/local.ts', {
  'node:fs': {
    existsSync: (path) => path.endsWith('track.lrc'),
    readFileSync: () => '[00:01.00]Local'
  }
})
assert.equal(local.readLocalLyrics('/music/track.flac').content, '[00:01.00]Local')
const embedded = load('src/main/service/lyrics/embedded.ts', {
  'music-metadata': {
    parseFile: async () => ({
      common: { lyrics: [{ syncText: [{ timestamp: 1250, text: 'Embedded' }] }] }
    })
  }
})
assert.equal((await embedded.readEmbeddedLyrics('/music/track.flac')).content, '[0:01.25]Embedded')
console.log('Lyric provider, fallback, ranking and source separation fixtures passed')
