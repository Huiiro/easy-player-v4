/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import * as Vue from 'vue'
import * as Pinia from 'pinia'

const require = createRequire(import.meta.url)
function load(file, mocks = {}, globals = {}) {
  const exports = {}
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    { exports, require: (name) => mocks[name] ?? require(name), console, ...globals }
  )
  return exports
}
let seed = 17
const math = Object.create(Math)
math.random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 2 ** 32
}
const smart = load('src/renderer/src/stores/player/smartShuffle.ts', {}, { Math: math })
let saved
let prepared = ''
let ended
let stateChanged
let positionChanged
const transportCalls = []
let restoreSession
let restoreCheckpoint = null
let nativeDecoderPath = ''
let repeatedNativeTargets = 0
const remoteFailures = new Set()
let remoteResolver
let holdRemote = false
let holdStatus = false
let statusResolver
let holdNextTrackResponse = false
const nextTrackResponses = []
const openedPaths = []
const broken = new Set()
const bridge = new Proxy(
  {
    stop: async () => {
      transportCalls.push('stop')
      prepared = ''
      return true
    },
    play: async () => {
      transportCalls.push('play')
      return true
    },
    pause: async () => {
      transportCalls.push('pause')
      return true
    },
    seek: async () => {
      transportCalls.push('seek')
      return true
    },
    onStateChanged: (callback) => {
      stateChanged = callback
      return () => {}
    },
    onPositionChanged: (callback) => {
      positionChanged = callback
      return () => {}
    },
    open: async (path) => {
      openedPaths.push(path)
      return !broken.has(path)
    },
    getStatus: async () => {
      if (holdStatus)
        return new Promise((resolve) => {
          statusResolver = resolve
        })
      return { trackInfo: null, durationMs: 180000 }
    },
    setNextTrack: async (path) => {
      if (path && path === nativeDecoderPath) repeatedNativeTargets++
      prepared = path
      if (path && holdNextTrackResponse)
        return new Promise((resolve) => nextTrackResponses.push(resolve))
      return true
    },
    onTrackEnded: (callback) => {
      ended = callback
      return () => {}
    }
  },
  { get: (target, key) => target[key] ?? (async () => true) }
)
const api = {
  remoteSource: {
    cacheSong: async (id) => {
      if (holdRemote)
        await new Promise((resolve) => {
          remoteResolver = resolve
        })
      if (remoteFailures.has(id)) throw new Error('remote unavailable')
      return { success: true, data: `/cached-${id}` }
    }
  },
  database: {
    getSync: (key) => ({
      success: true,
      data: key === 'player.playback-session' ? restoreSession : restoreCheckpoint
    }),
    saveSync: (_key, data) => {
      saved = JSON.parse(JSON.stringify(data))
      return { success: true }
    },
    command: async () => ({ success: true, data: [] })
  },
  miniPlayer: { update() {}, onAction: () => () => {}, onRequestState: () => () => {} },
  system: { updateTray() {}, onTrayAction: () => () => {} }
}
const module = load(
  'src/renderer/src/stores/player/playerStore.ts',
  {
    vue: Vue,
    pinia: Pinia,
    '@/stores/persistence': { flushPlayerDataStorage() {} },
    '@/services/audioBridge': { audioBridge: bridge },
    './smartShuffle': smart,
    '@/stores/log/logStore': { useLogStore: () => ({ addEntry() {} }) },
    '@/stores/ui/uiStore': {
      useUIStore: () => ({
        extremePlayback: false,
        customBg: {},
        resolvedAppearance: { dark: false, chrome: {} }
      })
    },
    '@/stores/statistics/statisticsStore': {
      useStatisticsStore: () => ({ enabled: true, generation: 'test', ready: true })
    },
    '@/components/ui/useMessage': { useMessage: () => ({ warning() {}, success() {}, info() {} }) },
    '@/i18n': { t: (key) => key },
    '@/consts': { PlayMode: { List: 0, Random: 1, Single: 2 } },
    '@/utils/eventBus': { default: { emit() {} } }
  },
  {
    window: { api },
    Math: math,
    setTimeout: () => 1,
    clearTimeout() {},
    document: { hidden: false, addEventListener() {} }
  }
)
const songs = Array.from({ length: 8 }, (_, i) => ({
  id: i + 1,
  audio: `/song-${i + 1}`,
  title: `Song ${i + 1}`,
  songStatus: 1,
  artist: null,
  album: null
}))
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve()
  await Vue.nextTick()
}
function player() {
  Pinia.setActivePinia(Pinia.createPinia())
  return module.usePlayerStore()
}

for (const weighted of [false, true]) {
  const p = player()
  p.state = 'playing'
  p.setPlayMode(1)
  p.smartShuffleEnabled = weighted
  assert.equal(await p.playCollection(songs, null), true)
  const sequence = [p.currentQueueSong.id]
  const firstRound = new Set([p.currentQueueSong.id])
  for (let step = 0; step < 100; step++) {
    await settle()
    const current = p.currentQueueSong.id
    p.savePlaybackSessionSync()
    const before = JSON.stringify(saved.shufflePlayedSongIds)
    const next = p.getNextQueueIndex()
    for (let i = 0; i < 20; i++) assert.equal(p.getNextQueueIndex(), next)
    p.savePlaybackSessionSync()
    assert.equal(JSON.stringify(saved.shufflePlayedSongIds), before, 'previews cannot reset rounds')
    assert.notEqual(songs[next].id, current)
    assert.equal(await p.playNext(), true)
    assert.equal(p.currentQueueIndex, next, 'manual next must use the preview reservation')
    sequence.push(p.currentQueueSong.id)
    if (step < songs.length - 1) {
      assert.ok(
        !firstRound.has(p.currentQueueSong.id),
        'no repeats before the first round completes'
      )
      firstRound.add(p.currentQueueSong.id)
    }
  }
  assert.equal(firstRound.size, songs.length)
  if (!weighted) {
    for (let i = 0; i + songs.length <= sequence.length; i += songs.length) {
      assert.equal(
        new Set(sequence.slice(i, i + songs.length)).size,
        songs.length,
        'every complete shuffled round contains each song exactly once'
      )
    }
    await settle()
    p.savePlaybackSessionSync()
    const order = [...saved.normalShuffleOrder]
    assert.equal(songs[p.getNextQueueIndex()].id, order[0])
    const randomSeed = seed
    for (let i = 0; i < 10; i++) p.getNextQueueIndex()
    assert.equal(seed, randomSeed, 'previews do not reshuffle the permutation')
    p.moveQueueItem(0, songs.length - 1)
    assert.equal(
      p.queue[p.getNextQueueIndex()].id,
      order[0],
      'queue reordering preserves the permutation'
    )
    restoreSession = JSON.parse(JSON.stringify(saved))
    const copy = player()
    await copy.restorePlaybackSession()
    assert.equal(
      copy.queue[copy.getNextQueueIndex()].id,
      order[0],
      'restore preserves the permutation'
    )
  }
  const current = p.currentQueueIndex
  assert.equal(await p.playPrevious(), true)
  assert.equal(await p.playNext(), true)
  assert.equal(p.currentQueueIndex, current, 'forward returns through playback history')
}
// Cover multiple sizes, complete rounds, native transitions and manual advances.
for (const weighted of [false, true]) {
  for (const gaplessMode of [false, true]) {
    for (const size of [1, 2, 3, 8, 13]) {
      const p = player()
      p.state = 'playing'
      p.smartShuffleEnabled = weighted
      p.transitionConfig.gaplessEnabled = gaplessMode
      p.setPlayMode(1)
      p.subscribeToEvents()
      const list = Array.from({ length: size }, (_, i) => ({
        ...songs[i % songs.length],
        id: i + 1000,
        audio: `/matrix-${i}`
      }))
      await p.playCollection(list, list[0].id)
      const sequence = [p.currentQueueSong.id]
      for (let step = 1; step < size * 20; step++) {
        await settle()
        const next = p.getNextQueueIndex()
        const expectedId = p.queue[next].id
        if (gaplessMode)
          ended({
            reason: 'transition',
            filePath: p.currentFile,
            nextFilePath: p.queue[next].audio
          })
        else await p.playNext()
        await settle()
        assert.equal(p.currentQueueSong.id, expectedId)
        if (size > 1) assert.notEqual(p.currentQueueSong.id, sequence.at(-1))
        sequence.push(p.currentQueueSong.id)
      }
      for (let i = 0; i < sequence.length; i += size) {
        assert.equal(
          new Set(sequence.slice(i, i + size)).size,
          size,
          `each song once: smart=${weighted}, gapless=${gaplessMode}, size=${size}`
        )
      }
    }
  }
}

for (const weighted of [false, true]) {
  const p = player()
  p.state = 'playing'
  p.smartShuffleEnabled = weighted
  p.setPlayMode(1)
  await p.playCollection(songs, songs[0].id)
  await settle()
  const reservedId = p.queue[p.getNextQueueIndex()].id
  await p.setPreference(songs[3].id, 1)
  assert.equal(
    p.queue[p.getNextQueueIndex()].id,
    reservedId,
    'score refresh keeps the current reservation'
  )
  p.moveQueueItem(0, songs.length - 1)
  assert.equal(
    p.queue[p.getNextQueueIndex()].id,
    reservedId,
    'smart and normal reservations follow song IDs'
  )
  p.addToQueue([
    { ...songs[0], id: 500 },
    { ...songs[0], id: 500 }
  ])
  assert.equal(p.queue.filter((song) => song.id === 500).length, 1)
  assert.equal(
    p.queue[p.getNextQueueIndex()].id,
    reservedId,
    'queue additions preserve the prepared target'
  )
  await p.playPrevious()
  await p.playNext()
}

const failingRemote = player()
failingRemote.setPlayMode(1)
remoteFailures.add(901)
assert.equal(
  await failingRemote.playCollection(
    [{ ...songs[0], id: 901, sourceId: 1 }, songs[1], songs[2]],
    901
  ),
  true
)
for (let i = 0; i < 10; i++) {
  assert.notEqual(failingRemote.queue[failingRemote.getNextQueueIndex()].id, 901)
  assert.equal(await failingRemote.playNext(), true)
}
remoteFailures.clear()

const pendingRemote = player()
pendingRemote.setPlayMode(1)
holdRemote = true
const selectedRemote = { ...songs[0], id: 902, sourceId: 1 }
const pendingPlay = pendingRemote.playCollection([selectedRemote, songs[1], songs[2]], 902)
await settle()
pendingRemote.moveQueueItem(0, 2)
holdRemote = false
remoteResolver()
assert.equal(await pendingPlay, true)
assert.equal(
  pendingRemote.currentQueueSong.id,
  902,
  'queue reordering during caching must not play or consume a different song'
)
const canceledRemote = player()
canceledRemote.setPlayMode(1)
holdRemote = true
const canceledPlay = canceledRemote.playCollection([selectedRemote, songs[1]], 902)
await settle()
canceledRemote.clearQueue()
holdRemote = false
remoteResolver()
assert.equal(await canceledPlay, false)
assert.equal(
  canceledRemote.queue.length,
  0,
  'a late remote response cannot resurrect a cleared queue'
)

// Clearing must stop the decoder as well as removing the queue metadata.
for (const initialState of ['playing', 'paused']) {
  const cleared = player()
  cleared.subscribeToEvents()
  await cleared.playCollection(songs, songs[0].id)
  await settle()
  cleared.state = initialState
  cleared.positionMs = 12000
  cleared.trackInfo = { filePath: songs[0].audio }
  cleared.setStopAfterCurrent(true)
  const stopsBefore = transportCalls.filter((call) => call === 'stop').length
  await cleared.clearQueue()
  await settle()
  assert.equal(transportCalls.filter((call) => call === 'stop').length, stopsBefore + 1)
  assert.equal(prepared, '', 'clearing cancels the prepared native transition')
  assert.equal(cleared.queue.length, 0)
  assert.equal(cleared.currentQueueIndex, -1)
  assert.equal(cleared.currentQueueSong, null)
  assert.equal(cleared.currentFile, null)
  assert.equal(cleared.trackInfo, null)
  assert.equal(cleared.state, 'stopped')
  assert.equal(cleared.positionMs, 0)
  assert.equal(cleared.durationMs, 0)
  assert.equal(cleared.stopAfterCurrent, false)
  assert.equal(saved.queue.length, 0, 'the empty session is persisted immediately')
  assert.equal(saved.trackInfo, null)
  assert.equal(saved.durationMs, 0)
  const callsBefore = transportCalls.length
  assert.equal(await cleared.play(), false)
  assert.equal(await cleared.pause(), false)
  assert.equal(await cleared.seek(9000), false)
  assert.equal(transportCalls.length, callsBefore, 'empty controls cannot reach the old decoder')
  stateChanged({ state: 'playing', trackInfo: { filePath: songs[0].audio } })
  positionChanged({ positionMs: 15000, durationMs: 180000 })
  ended({ reason: 'transition', nextFilePath: songs[1].audio })
  await settle()
  assert.equal(cleared.state, 'stopped', 'late native events cannot revive the cleared track')
  assert.equal(cleared.trackInfo, null)
  assert.equal(cleared.currentFile, null)
  assert.equal(cleared.positionMs, 0)
  assert.equal(cleared.durationMs, 0)
  assert.equal(await cleared.playCollection(songs, songs[1].id), true)
  assert.equal(cleared.currentQueueSong.id, songs[1].id, 'new playback still works after clearing')
}

const clearingOpen = player()
holdStatus = true
const opening = clearingOpen.playCollection(songs, songs[0].id)
await settle()
await clearingOpen.clearQueue()
holdStatus = false
statusResolver({ trackInfo: { filePath: songs[0].audio }, durationMs: 180000 })
assert.equal(await opening, false)
assert.equal(clearingOpen.trackInfo, null, 'a late open response cannot restore metadata')
assert.equal(clearingOpen.durationMs, 0)
assert.equal(clearingOpen.currentFile, null)

restoreSession = { queue: [], currentQueueIndex: -1, durationMs: 0, trackInfo: null }
restoreCheckpoint = { currentFile: songs[0].audio, positionMs: 12000, wasPlaying: true }
const emptyRestore = player()
const callsBeforeRestore = transportCalls.length
await emptyRestore.restorePlaybackSession(true)
assert.equal(emptyRestore.currentFile, null, 'an old checkpoint cannot revive an empty queue')
assert.equal(emptyRestore.positionMs, 0)
assert.equal(await emptyRestore.play(), false)
assert.equal(transportCalls.length, callsBeforeRestore)
restoreSession = undefined
restoreCheckpoint = null

for (const weighted of [false, true]) {
  const p = player()
  p.state = 'playing'
  p.setPlayMode(1)
  await p.setSmartShuffleEnabled(weighted)
  p.transitionConfig.gaplessEnabled = false
  p.subscribeToEvents()
  await p.playCollection(songs, songs[0].id)
  for (let i = 0; i < 20; i++) {
    const previousFile = p.currentFile
    const expected = p.queue[p.getNextQueueIndex()].id
    ended({ reason: 'eof', filePath: previousFile })
    await settle()
    assert.equal(
      p.currentQueueSong.id,
      expected,
      'EOF for a different short track must not be throttled'
    )
    ended({ reason: 'eof', filePath: previousFile })
    await settle()
    assert.equal(p.currentQueueSong.id, expected, 'duplicate EOF must not skip a track')
  }
  const removedNext = p.queue[p.getNextQueueIndex()].id
  await p.removeQueueItem(p.queue.findIndex((song) => song.id === removedNext))
  assert.notEqual(p.queue[p.getNextQueueIndex()].id, removedNext)
  const removedCurrent = p.currentQueueSong.id
  await p.removeQueueItem(p.currentQueueIndex)
  assert.notEqual(p.currentQueueSong.id, removedCurrent)
  const stableId = p.currentQueueSong.id
  await p.setSmartShuffleEnabled(!weighted)
  assert.notEqual(
    p.queue[p.getNextQueueIndex()].id,
    stableId,
    'switching shuffle algorithms cannot repeat the current song'
  )
  p.savePlaybackSessionSync()
  restoreSession = JSON.parse(JSON.stringify(saved))
  const restored = player()
  restored.smartShuffleEnabled = !weighted
  await restored.restorePlaybackSession()
  const nextId = restored.queue[restored.getNextQueueIndex()].id
  await restored.restorePlaybackSession()
  assert.equal(
    restored.queue[restored.getNextQueueIndex()].id,
    nextId,
    'restoring twice does not append history or change the reserved target'
  )
}

const gapless = player()
gapless.state = 'playing'
gapless.setPlayMode(1)
gapless.subscribeToEvents()
await gapless.playCollection(songs, songs[0].id)
const recent = [gapless.currentQueueSong.id]
for (let i = 0; i < 100; i++) {
  await settle()
  const next = gapless.getNextQueueIndex()
  assert.equal(prepared, songs[next].audio)
  const oldFile = gapless.currentFile
  ended({ reason: 'transition', filePath: oldFile })
  await settle()
  assert.equal(gapless.currentQueueIndex, next)
  assert.notEqual(
    recent.at(-1),
    gapless.currentQueueSong.id,
    'round boundaries avoid immediate repeats'
  )
  recent.push(gapless.currentQueueSong.id)
}
for (let i = 0; i + songs.length <= recent.length; i += songs.length) {
  assert.equal(
    new Set(recent.slice(i, i + songs.length)).size,
    songs.length,
    'gapless playback consumes every song exactly once per round'
  )
}
await gapless.playPrevious()
await gapless.playPrevious()
const forward = gapless.getNextQueueIndex()
await settle()
ended({ reason: 'transition', filePath: gapless.currentFile })
await settle()
assert.equal(gapless.currentQueueIndex, forward)
assert.equal(
  gapless.getNextQueueIndex(),
  songs.findIndex((song) => song.id === recent.at(-1))
)

restoreSession = {
  queue: songs,
  playMode: 1,
  currentQueueIndex: 0,
  shuffleHistory: [...songs.map((song) => song.id), songs[0].id],
  shuffleHistoryIndex: songs.length,
  shufflePlayedSongIds: [songs[0].id]
}
const restored = player()
await restored.restorePlaybackSession()
restored.savePlaybackSessionSync()
assert.deepEqual(
  saved.shufflePlayedSongIds,
  [songs[0].id],
  'restore preserves the active round separately from history'
)
assert.notEqual(restored.getNextQueueIndex(), 0)

const p = player()
p.setPlayMode(1)
broken.add(songs[1].audio)
broken.add(songs[2].audio)
assert.equal(await p.playCollection([songs[1], songs[2], songs[3]], songs[1].id), true)
assert.equal(
  p.currentQueueSong.id,
  songs[3].id,
  'failed candidates are each attempted before giving up'
)
broken.clear()
await p.playCollection([songs[0], { ...songs[1], songStatus: 0 }], songs[0].id)
assert.equal(p.getNextQueueIndex(), 0, 'only playable song may repeat')
await p.playCollection([], null)
assert.equal(p.getNextQueueIndex(), -1)
p.setPlayMode(0)
await p.playCollection(songs, null)
assert.equal(p.currentQueueIndex, 0, 'list playback starts at the first song')
p.setPlayMode(1)
await p.playCollection(songs, songs[4].id)
assert.equal(p.currentQueueIndex, 4, 'explicit song selection is preserved')
const starts = new Set()
for (let i = 0; i < 30; i++) {
  await p.playCollection(songs, null)
  starts.add(p.currentQueueIndex)
}
assert.ok(starts.size > 1, 'random play all does not always start at index zero')
for (const size of [2, 3]) {
  await p.playCollection(songs.slice(0, size), null)
  for (let i = 0; i < 20; i++) {
    const previous = p.currentQueueSong.id
    await p.playNext()
    assert.notEqual(p.currentQueueSong.id, previous, 'small queues avoid immediate repeats')
  }
}
// Decoding runs ahead of audible output. The next decoder has already been
// consumed, but its transition event has not reached the renderer yet.
const racing = player()
racing.state = 'playing'
racing.setPlayMode(1)
racing.subscribeToEvents()
await racing.playCollection(songs, songs[0].id)
await settle()
const incoming = racing.queue[racing.getNextQueueIndex()]
nativeDecoderPath = incoming.audio
const outgoingFile = racing.currentFile
racing.moveQueueItem(0, songs.length - 1)
await settle()
assert.equal(
  repeatedNativeTargets,
  0,
  'queue updates must not requeue an already consumed next decoder'
)
ended({ reason: 'transition', filePath: outgoingFile, nextFilePath: incoming.audio })
await settle()
assert.equal(racing.currentQueueSong.id, incoming.id)
assert.notEqual(
  prepared,
  incoming.audio,
  'the native target after transition must differ from the playing song'
)
nativeDecoderPath = ''
// The native transition can also beat the IPC acknowledgement for preloading.
const lateResponse = player()
lateResponse.state = 'playing'
lateResponse.setPlayMode(1)
lateResponse.subscribeToEvents()
holdNextTrackResponse = true
await lateResponse.playCollection(songs, songs[0].id)
await settle()
const actualIncoming = lateResponse.queue[lateResponse.getNextQueueIndex()]
const openedBeforeTransition = openedPaths.length
const endedSource = lateResponse.currentFile
// Reorder without giving the queue watcher time to refresh its stored index.
lateResponse.moveQueueItem(0, songs.length - 1)
ended({ reason: 'transition', filePath: endedSource, nextFilePath: actualIncoming.audio })
await settle()
assert.equal(
  lateResponse.currentQueueSong.id,
  actualIncoming.id,
  'native path takes precedence over stale preparation indices'
)
assert.equal(
  openedPaths.length,
  openedBeforeTransition,
  'an early transition must not reopen and restart its target'
)
ended({ reason: 'transition', filePath: endedSource, nextFilePath: actualIncoming.audio })
assert.equal(
  lateResponse.currentQueueSong.id,
  actualIncoming.id,
  'duplicate old transition events are ignored'
)
holdNextTrackResponse = false
for (const resolve of nextTrackResponses.splice(0)) resolve(true)
await settle()
assert.notEqual(
  prepared,
  actualIncoming.audio,
  'late preload replies cannot restore a consumed target'
)
for (const weighted of [false, true]) {
  for (const roundStart of [false, true]) {
    for (const remote of [false, true]) {
      const list = songs.slice(0, 3).map((song) => ({ ...song, sourceId: remote ? 1 : undefined }))
      restoreSession = {
        queue: list,
        currentQueueIndex: 0,
        playMode: 1,
        shuffleHistory: [list[0].id],
        shuffleHistoryIndex: 0,
        shufflePlayedSongIds: roundStart ? list.map((song) => song.id) : [list[0].id],
        normalShuffleOrder: roundStart
          ? [list[1].id, list[0].id, list[2].id]
          : [list[1].id, list[2].id],
        normalShuffleStartsRound: roundStart,
        shuffleReservation: {
          songId: list[1].id,
          sourceSongId: list[0].id,
          startsRound: roundStart
        },
        resolvedQueuePaths: remote ? list.map((song) => [song.id, `/cached-${song.id}`]) : []
      }
      restoreCheckpoint = { currentFile: remote ? `/cached-${list[1].id}` : list[1].audio }
      const p = player()
      p.smartShuffleEnabled = weighted
      await p.restorePlaybackSession()
      assert.equal(p.currentQueueSong.id, list[1].id, 'checkpoint advances stale queue snapshots')
      assert.notEqual(
        p.queue[p.getNextQueueIndex()].id,
        list[1].id,
        'restoring a consumed transition must not replay the incoming track'
      )
      p.savePlaybackSessionSync()
      assert.ok(saved.shufflePlayedSongIds.includes(list[1].id))
      assert.equal(saved.shuffleHistory.at(-1), list[1].id)
    }
  }
}
restoreCheckpoint = null
for (const weighted of [false, true]) {
  const p = player()
  p.state = 'playing'
  p.setPlayMode(1)
  p.smartShuffleEnabled = weighted
  p.subscribeToEvents()
  await p.playCollection(songs, songs[0].id)
  await settle()
  const sourceFile = p.currentFile
  const consumed = p.queue[p.getNextQueueIndex()]
  await p.removeQueueItem(p.queue.findIndex((song) => song.id === consumed.id))
  ended({ reason: 'transition', filePath: sourceFile, nextFilePath: consumed.audio })
  await settle()
  assert.ok(p.currentQueueSong, 'removed native targets must advance to a valid queue item')
  assert.notEqual(p.currentQueueSong.id, consumed.id)
  assert.notEqual(
    p.currentFile,
    sourceFile,
    'removed target transitions cannot leave playback on the outgoing UI state'
  )
}
const playedBefore = new Set(songs.map((song) => song.id))
smart.selectSmartNext(songs, 0, playedBefore, new Map(), () => 0.5)
assert.equal(playedBefore.size, songs.length, 'pure smart previews do not clear caller round state')
assert.equal(smart.selectSmartNext([], -1, new Set(), new Map()), -1)
const stoppedPending = player()
stoppedPending.setPlayMode(1)
holdRemote = true
const stopPendingPlay = stoppedPending.playCollection([selectedRemote, songs[1]], 902)
await settle()
await stoppedPending.stop()
const opensAtStop = openedPaths.length
holdRemote = false
remoteResolver()
assert.equal(await stopPendingPlay, false)
assert.equal(
  openedPaths.length,
  opensAtStop,
  'stopping while caching prevents a late playback start'
)

const staleStatus = player()
staleStatus.state = 'playing'
staleStatus.setPlayMode(1)
staleStatus.subscribeToEvents()
await staleStatus.playCollection(songs, songs[0].id)
await settle()
const nativeNext = staleStatus.queue[staleStatus.getNextQueueIndex()]
holdStatus = true
ended({ reason: 'transition', filePath: staleStatus.currentFile, nextFilePath: nativeNext.audio })
await settle()
holdStatus = false
const manual = songs.find((song) => song.id !== nativeNext.id && song.id !== songs[0].id)
await staleStatus.playQueueItem(staleStatus.queue.findIndex((song) => song.id === manual.id))
statusResolver({ trackInfo: { filePath: '/outdated' }, durationMs: 1 })
await settle()
assert.equal(staleStatus.currentQueueSong.id, manual.id)
assert.equal(
  staleStatus.trackInfo,
  null,
  'late status from the previous transition cannot overwrite a manual selection'
)
console.log(
  'Shuffle reservations, rounds, gapless, history, unavailable tracks and collection starts passed.'
)
