/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { effectScope, ref, reactive, nextTick } from 'vue'

const directory = await mkdtemp(resolve('node_modules/.cache/song-lyrics-'))
const require = createRequire(import.meta.url)
const file = join(directory, 'library.db')
let database = new DatabaseSync(file)
database.exec(
  'PRAGMA foreign_keys=ON; CREATE TABLE song(id INTEGER PRIMARY KEY, offset_ms INTEGER CHECK(offset_ms BETWEEN -5000 AND 5000), disable_network_lyrics INTEGER NOT NULL DEFAULT 0, instrumental INTEGER NOT NULL DEFAULT 0); INSERT INTO song(id) VALUES(1),(2),(3),(4)'
)
globalThis.songLyricDb = {
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
const aliases = { '@': resolve('src/renderer/src') }
const host = {
  name: 'database',
  setup(builder) {
    builder.onResolve({ filter: /^\.\.\/index$/ }, (args) =>
      args.importer.replaceAll(String.fromCharCode(92), '/').endsWith('repository/songLyrics.ts')
        ? { path: 'db', namespace: 'host' }
        : undefined
    )
    builder.onLoad({ filter: /.*/, namespace: 'host' }, () => ({
      contents: 'export const getDatabase=()=>globalThis.songLyricDb'
    }))
  }
}
try {
  await build({
    stdin: {
      contents:
        "export * from './src/main/database/repository/songLyrics'; export * from './src/main/database/schema'",
      resolveDir: process.cwd()
    },
    outfile: join(directory, 'storage.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [host]
  })
  const storage = require(join(directory, 'storage.cjs'))
  assert.equal(storage.DATABASE_SCHEMA_VERSION, 1)
  assert.deepEqual(storage.getSongLyricSettings(1), {
    songId: 1,
    offsetMs: null,
    disableNetwork: false,
    instrumental: false
  })
  storage.setSongLyricSettings(1, { offsetMs: 1250, disableNetwork: true })
  storage.setSongsLyricFlags([1, 3], { instrumental: true })
  assert.throws(() => storage.setSongsLyricFlags([1, 999], { instrumental: false }))
  assert.equal(
    storage.getSongLyricSettings(1).instrumental,
    true,
    'batch flag failures roll back earlier songs'
  )
  storage.setSongsLyricFlags([3], { instrumental: false })
  assert.equal(
    database.prepare('SELECT disable_network_lyrics FROM song WHERE id=1').get()
      .disable_network_lyrics,
    1,
    'flags live in the song table'
  )
  assert.equal(
    database
      .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'song_lyric_setting'")
      .get().count,
    0
  )

  storage.setSongLyricSettings(1, { instrumental: true })
  database.close()
  database = new DatabaseSync(file)
  database.exec('PRAGMA foreign_keys=ON')
  assert.deepEqual(storage.getSongLyricSettings(1), {
    songId: 1,
    offsetMs: 1300,
    disableNetwork: true,
    instrumental: true
  })
  assert.equal(storage.songAllowsNetworkLyrics(1), false)
  assert.throws(() => storage.setSongLyricSettings(1, { offsetMs: NaN }))
  assert.throws(() => storage.setSongLyricSettings(99, { offsetMs: 0 }))
  storage.setSongLyricSettings(1, { disableNetwork: false, instrumental: false })
  assert.equal(storage.getSongLyricSettings(1).offsetMs, 1300)
  storage.setSongLyricSettings(2, { offsetMs: 0 })
  assert.equal(
    storage.getSongLyricSettings(2).offsetMs,
    0,
    'saved zero is distinct from no saved offset'
  )
  database.prepare('DELETE FROM song WHERE id=2').run()
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM song WHERE id=2').get().count, 0)

  await build({
    stdin: {
      contents:
        "export * from './src/renderer/src/services/songLyricController'; export * from './src/renderer/src/services/lyrics'; export {default as eventBus} from './src/renderer/src/utils/eventBus'",
      resolveDir: process.cwd()
    },
    outfile: join(directory, 'renderer.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    alias: aliases
  })
  const renderer = require(join(directory, 'renderer.cjs'))
  let holdId = null,
    release
  let searches = 0,
    localLoads = 0
  globalThis.window = {
    api: {
      database: {
        command: async (action, params) => {
          if (action === 'getSongLyricSettings') {
            if (params.songId === holdId) {
              holdId = null
              return new Promise((resolve) => {
                release = () =>
                  resolve({ success: true, data: storage.getSongLyricSettings(params.songId) })
              })
            }
            return { success: true, data: storage.getSongLyricSettings(params.songId) }
          }
          if (action === 'setSongLyricSettings')
            return {
              success: true,
              data: storage.setSongLyricSettings(params.songId, params.patch)
            }
          if (action === 'getSong')
            return { success: true, data: { lrc: '[00:01.00]Database lyric' } }
          if (action === 'updateSongLyrics') return { success: true }
          throw Error(action)
        }
      },
      lyrics: {
        loadSource: async () => {
          localLoads++
          return { success: true, data: null }
        },
        searchNetwork: async (query) => {
          searches++
          assert.equal(query.songId, 1)
          return { success: true, data: [{ lrc: '[00:01.00]Network lyric' }] }
        }
      }
    }
  }
  const song = ref({ id: 1 })
  const ui = reactive({ lyricsOffsetMs: 700, lyricsOffsetPerSong: true })
  const scope = effectScope()
  let controller
  scope.run(() => {
    controller = renderer.createSongLyricController(song, ui)
  })
  const settle = async () => {
    await nextTick()
    await new Promise((resolve) => setImmediate(resolve))
  }
  await settle()
  assert.equal(controller.lyricsOffsetMs.value, 1300)
  controller.setLyricsOffset(400)
  song.value = { id: 3 }
  assert.equal(
    controller.lyricsOffsetMs.value,
    0,
    'temporary offset resets synchronously on next song'
  )
  await settle()
  assert.equal(controller.lyricsOffsetMs.value, 0)
  controller.setLyricsOffset(-600)
  await controller.saveLyricsOffset()
  await settle()
  song.value = { id: 1 }
  await settle()
  song.value = { id: 3 }
  await settle()
  assert.equal(controller.lyricsOffsetMs.value, -600, 'saved offset reloads on returning to a song')
  ui.lyricsOffsetPerSong = false
  await settle()
  controller.setLyricsOffset(900)
  song.value = { id: 4 }
  await settle()
  assert.equal(
    controller.lyricsOffsetMs.value,
    900,
    'global mode carries temporary offsets to unconfigured songs'
  )
  song.value = { id: 1 }
  await settle()
  assert.equal(
    controller.lyricsOffsetMs.value,
    1300,
    'saved song offsets take precedence over global mode'
  )
  ui.lyricsOffsetPerSong = true
  await settle()
  holdId = 3
  song.value = { id: 3 }
  await settle()
  song.value = { id: 4 }
  await settle()
  release()
  await settle()
  assert.equal(
    controller.lyricsOffsetMs.value,
    0,
    'late settings from a previous song cannot overwrite the current offset'
  )
  holdId = 3
  song.value = { id: 3 }
  await settle()
  controller.setLyricsOffset(200)
  release()
  await settle()
  assert.equal(
    controller.lyricsOffsetMs.value,
    200,
    'late settings cannot overwrite a user adjustment'
  )
  scope.stop()
  const track = { id: 1, audio: 'song.flac', title: 'Title' }
  storage.setSongLyricSettings(1, { disableNetwork: true })
  assert.equal((await renderer.resolveLyrics(track, ['network'])).lines.length, 0)
  assert.equal(searches, 0)
  storage.setSongLyricSettings(1, { instrumental: true })
  const before = localLoads
  assert.equal(
    (await renderer.resolveLyrics(track, ['embedded', 'database', 'network'])).instrumental,
    true
  )
  assert.equal(localLoads, before, 'instrumental state does not try embedded or network sources')
  storage.setSongLyricSettings(1, { instrumental: false })
  assert.equal(
    (await renderer.resolveLyrics(track, ['database', 'network'])).source,
    'database',
    'disabling network retains database lyrics'
  )
  storage.setSongLyricSettings(1, { disableNetwork: false })
  assert.equal((await renderer.resolveLyrics(track, ['network'])).source, 'network')
  assert.equal(searches, 1)
  storage.setSongLyricSettings(1, { offsetMs: null })
  assert.equal(
    database.prepare('SELECT offset_ms FROM song WHERE id=1').get().offset_ms,
    null,
    'clearing an offset retains the song and resets its saved offset to null'
  )
  const fixtures = {
    [resolve('src/main/sources/runtime')]:
      `export const invokeSource = (_id,_operation,task) => task({lyrics:{search:(...args)=>globalThis.lyricProvider(...args)}},{signal:new AbortController().signal})`,
    [resolve('src/main/sources/errors')]: 'export class SourceCallError extends Error {}',
    [resolve('src/main/sources')]:
      `export const getNetworkSources = () => ({list:()=>[{id:'fixture',displayName:'Fixture',lyrics:{}}]})`,
    [resolve('src/main/service/playbackMode')]: 'export const isPlaybackOnly = () => false',
    [resolve('src/main/service/lyrics/relevance')]: 'export const isRelevantCandidate = () => true'
  }
  await build({
    entryPoints: ['src/main/service/lyrics/network.ts'],
    outfile: join(directory, 'network.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [
      host,
      {
        name: 'network-host',
        setup(builder) {
          builder.onResolve({ filter: /^\./ }, (args) =>
            fixtures[resolve(args.resolveDir, args.path)]
              ? { path: resolve(args.resolveDir, args.path), namespace: 'network' }
              : undefined
          )
          builder.onLoad({ filter: /.*/, namespace: 'network' }, (args) => ({
            contents: fixtures[args.path]
          }))
        }
      }
    ]
  })
  const network = require(join(directory, 'network.cjs'))
  let providerCalls = 0
  globalThis.lyricProvider = async () => {
    providerCalls++
    return [
      {
        resourceId: '1',
        title: 'Title',
        artist: 'Artist',
        lrc: '[00:01]Test',
        supportsWordTiming: true
      }
    ]
  }
  const query = { songId: 1, title: 'Title' }
  storage.setSongLyricSettings(1, { disableNetwork: true })
  assert.deepEqual(await network.searchNetworkLyrics(query), [])
  assert.equal(providerCalls, 0, 'main process rejects blocked songs before invoking providers')
  storage.setSongLyricSettings(1, { disableNetwork: false, instrumental: true })
  assert.deepEqual(await network.searchNetworkLyrics(query), [])
  assert.equal(providerCalls, 0)
  storage.setSongLyricSettings(1, { instrumental: false })
  assert.equal((await network.searchNetworkLyrics(query)).length, 1)
  let finishProvider
  globalThis.lyricProvider = () =>
    new Promise((resolve) => {
      finishProvider = resolve
    })
  const pending = network.searchNetworkLyrics(query)
  storage.setSongLyricSettings(1, { disableNetwork: true })
  finishProvider([{ resourceId: '1', title: 'Title', lrc: '[00:01]Late' }])
  assert.deepEqual(await pending, [], 'enabling the flag discards in-flight network results')
  console.log(
    'Song lyrics: SQLite restart, flags, saved zero, cascade, per-song/global scope, fast switches, late loads, instrumental and network suppression passed'
  )
} finally {
  database.close()
  delete globalThis.window
  delete globalThis.songLyricDb
  await rm(directory, { recursive: true, force: true })
}
