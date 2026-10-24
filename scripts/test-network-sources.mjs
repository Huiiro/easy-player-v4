/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function load(file, mocks = {}) {
  const cache = new Map()
  const visit = (filename) => {
    filename = path.resolve(filename)
    if (mocks[filename]) return mocks[filename]
    if (cache.has(filename)) return cache.get(filename)
    const exports = {}
    cache.set(filename, exports)
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText
    vm.runInNewContext(
      code,
      {
        exports,
        URL,
        Error,
        Buffer,
        structuredClone,
        AbortController,
        AbortSignal,
        crypto,
        require: (name) => {
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
const { SourceRegistry } = load('src/main/sources/registry.ts')
const registry = new SourceRegistry()
const source = { id: 'test', displayName: 'Test', apiVersion: 1 }
const dispose = registry.register(source)
assert.throws(() => registry.register(source), /already registered/)
assert.throws(() => registry.requireDownload('test'), /does not support/)
assert.throws(() => registry.register({ ...source, id: 'future', apiVersion: 2 }), /Invalid/)
dispose()
const removeReplacement = registry.register({ ...source })
dispose()
assert.equal(registry.list().length, 1, 'an old disposer must not remove a newer registration')
removeReplacement()
assert.equal(registry.list().length, 0)

const mocked = Object.fromEntries(
  [
    ['plugins/official/netease/lyrics.ts', { searchNeteaseLyrics: async () => [] }],
    ['plugins/official/kugou/lyrics.ts', { searchKugouLyrics: async () => [] }],
    ['plugins/official/qqmusic/lyrics.ts', { searchQQMusicLyrics: async () => [] }],
    ['plugins/official/netease/artwork.ts', { searchNeteaseArtwork: async () => [] }],
    ['src/main/i18n/index.ts', { t: (key) => key }],
    [
      'src/main/service/mediaDownloadRuntime.ts',
      {
        runYtDlp: async () =>
          JSON.stringify({
            entries: [{ id: 'video', title: 'Title', url: 'https://youtu.be/video' }]
          }),
        fetchMediaImage() {},
        backgroundRequest() {
          throw new Error('Unexpected HTTP request')
        }
      }
    ]
  ].map(([file, value]) => [path.resolve(file), value])
)
const sources = load('src/main/sources/index.ts', mocked).getNetworkSources()
// Explicit fixture activation: production startup contributes no sources.
for (const plugin of load('plugins/official/index.ts', mocked).officialPlugins) {
  plugin.activate({ registerSource: (source) => sources.register(source) })
}
assert.equal(sources.list().length, 5)
assert(sources.get('netease').lyrics && sources.get('netease').artwork)
assert.equal(sources.get('netease').download, undefined)
assert.equal(sources.get('bili').lyrics, undefined)
assert.equal(sources.findDownload('https://www.bilibili.com/video/BVtest').id, 'bili')
assert.equal(sources.findDownload('https://youtu.be/video').id, 'youtube')
assert.throws(() => sources.findDownload('file:///video'), /Unsupported/)
assert.throws(() => sources.findDownload('https://youtube.com.evil.test/video'), /Unsupported/)
const youtube = sources.requireDownload('youtube')
const result = await youtube.search('query')
assert.equal(result[0].resource.resourceId, 'video')
assert.equal(result[0].resource.sourceId, 'youtube')
const plan = await youtube.resolve({
  url: result[0].url,
  resourceId: 'video',
  downloadType: 'audio',
  quality: 'high'
})
assert.equal(plan.transport, 'yt-dlp')
assert.equal(plan.resource.resourceId, 'video')
assert.equal(plan.directory, undefined, 'providers do not select host file paths')

let playbackOnly = false
const custom = new SourceRegistry()
custom.register({
  id: 'down',
  displayName: 'Down',
  apiVersion: 1,
  artwork: {
    search: async () => {
      throw new Error('provider offline')
    }
  }
})
const removeGood = custom.register({
  id: 'good',
  displayName: 'Good',
  apiVersion: 1,
  artwork: {
    search: async () => [
      {
        id: 'cover',
        resource: { sourceId: 'spoof', resourceType: 'album', resourceId: 'album' },
        imageUrl: 'https://image.test/cover',
        title: 'Album',
        album: 'Album',
        artist: 'Artist'
      }
    ]
  }
})
const artwork = load('src/main/sources/artwork.ts', {
  [path.resolve('src/main/sources/index.ts')]: { getNetworkSources: () => custom },
  [path.resolve('src/main/service/playbackMode.ts')]: {
    isPlaybackOnly: () => playbackOnly,
    onPlaybackModeChanged: () => () => {},
    requireBackgroundWork: () => {
      if (playbackOnly) throw new Error('Lightweight mode')
    }
  }
})
const covers = await artwork.searchSourceArtwork({ title: 'Title' })
assert.equal(
  (await artwork.searchSourceArtwork({ title: '', album: 'Album' })).length,
  1,
  'album-only cover searches remain supported'
)
assert.equal(covers.length, 1, 'one failed source must not hide successful artwork results')
assert.equal(covers[0].resource.sourceId, 'good', 'host stamps the registered source identity')
removeGood()
await assert.rejects(
  artwork.searchSourceArtwork({ title: 'Title' }),
  (error) => error.code === 'PROVIDER_ERROR' && error.sourceId === 'down'
)
playbackOnly = true
await assert.rejects(
  artwork.searchSourceArtwork({ title: 'Title' }),
  (error) => error.code === 'BACKGROUND_PAUSED'
)
console.log(
  'Network sources: registration lifecycle, capabilities, routing, download plans and artwork isolation passed'
)
