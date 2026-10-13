import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import Database from 'better-sqlite3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function loadTypeScript(file, imports = {}) {
  const source = fs.readFileSync(file, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const moduleRef = { exports: {} }
  vm.runInNewContext(compiled, {
    module: moduleRef,
    exports: moduleRef.exports,
    require: (name) => {
      if (name in imports) return imports[name]
      throw new Error(`Unexpected import: ${name}`)
    },
    Date,
    Math,
    Map,
    Set
  })
  return moduleRef.exports
}

const db = new Database(':memory:')
db.pragma('foreign_keys = ON')
db.exec(`
  CREATE TABLE song (id INTEGER PRIMARY KEY, artist TEXT, album TEXT, genre TEXT, year INTEGER,
    play_times INTEGER, duration INTEGER, song_status INTEGER, is_newest INTEGER DEFAULT 0,
    created_at TEXT DEFAULT '2020-01-01 00:00:00');
  CREATE TABLE song_list (id INTEGER PRIMARY KEY);
  CREATE TABLE song_tag (song_id INTEGER, tag_id INTEGER);
  CREATE TABLE play_history (
    id INTEGER PRIMARY KEY, song_id INTEGER NOT NULL, playlist_id INTEGER, playlist_name TEXT,
    played_seconds INTEGER DEFAULT 0, started_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(song_id) REFERENCES song(id) ON DELETE CASCADE,
    FOREIGN KEY(playlist_id) REFERENCES song_list(id) ON DELETE SET NULL
  );
`)
const schema = loadTypeScript(path.join(__dirname, '../src/main/database/schema.ts'))
const { migratePlayHistory } = loadTypeScript(
  path.join(__dirname, '../src/main/database/playHistoryMigration.ts')
)
const freshDb = new Database(':memory:')
freshDb.exec(schema.schemaV1)
freshDb.exec(schema.schemaV2)
freshDb.exec(schema.schemaV3)
freshDb.exec(schema.schemaV4)
assert.equal(
  freshDb.pragma('table_info(play_history)').some((column) => column.name === 'played_seconds'),
  true,
  'v1 retains the historical play_history layout until v5'
)
freshDb.exec(schema.schemaV5.addSongPreference)
migratePlayHistory(freshDb, schema.schemaV5)
assert.equal(
  freshDb.pragma('table_info(song)').some((column) => column.name === 'preference'),
  true,
  'v5 stores feedback on song'
)
assert.equal(
  freshDb.pragma('table_info(play_history)').find((column) => column.name === 'started_at').type,
  'INTEGER'
)
assert.equal(
  freshDb.pragma('table_info(play_history)').some((column) => column.name === 'played_seconds'),
  false
)
assert.ok(freshDb.prepare("SELECT 1 FROM sqlite_master WHERE name = 'recommendation_daily'").get())
freshDb.close()
const songs = db.prepare(
  'INSERT INTO song (id, artist, album, genre, year, play_times, duration, song_status) VALUES (?, ?, ?, ?, ?, ?, ?, 1)'
)
songs.run(1, 'Artist A', 'Album X', 'Rock', 2002, 4, 180)
songs.run(2, null, null, null, null, 3, 180)
songs.run(3, null, null, null, null, 0, 180)
songs.run(4, null, null, null, null, 1, 180)
songs.run(5, 'Artist A', 'Album Y', 'Rock', 1995, 20, 240)
songs.run(6, 'Artist A', 'Album X', 'Rock', 2003, 0, 180)
songs.run(7, null, null, null, null, 2, 180)
songs.run(8, null, null, null, null, 1, 180)
songs.run(9, null, null, null, null, 1, 180)
songs.run(10, null, null, null, null, 1, 180)
songs.run(11, null, null, null, null, 1, 180)
db.prepare('INSERT INTO song_list (id) VALUES (1)').run()
const legacyStartedAt = Date.parse('2025-01-01T00:00:00Z')
db.prepare(
  'INSERT INTO play_history (song_id, playlist_id, playlist_name, played_seconds, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?)'
).run(11, 1, 'Saved list', 170, String(legacyStartedAt), '2025-01-01 00:03:00')
db.prepare(
  'INSERT INTO play_history (song_id, played_seconds, started_at, created_at) VALUES (?, ?, ?, ?)'
).run(10, 45, '2025-01-02 00:00:00', '2025-01-02 00:01:00')
db.exec(schema.schemaV5.addSongPreference)
const migration = migratePlayHistory(db, schema.schemaV5)
assert.equal(migration.historyRows, 2)
const migrated = db.prepare('SELECT * FROM play_history WHERE song_id = 11').get()
assert.equal(migrated.started_at, legacyStartedAt)
assert.equal(migrated.created_at, Date.parse('2025-01-01T00:03:00Z'))
assert.equal(migrated.played_ms, 170_000)
assert.equal(migrated.playlist_id, 1)
assert.equal(migrated.playlist_name, 'Saved list')
assert.equal(migrated.duration_ms, null)
assert.equal(migrated.end_reason, null)
assert.equal(migrated.start_origin, 'automatic')
assert.equal(migrated.ended_at, null)
assert.equal(Object.hasOwn(migrated, 'played_seconds'), false)
assert.equal(
  db.prepare('SELECT started_at FROM play_history WHERE song_id = 10').get().started_at,
  Date.parse('2025-01-02T00:00:00Z')
)
assert.equal(
  db.prepare('SELECT played_ms FROM play_history WHERE song_id = 10').get().played_ms,
  45_000
)
const startWriteDb = new Database(':memory:')
startWriteDb.exec(`
  CREATE TABLE song (id INTEGER PRIMARY KEY, play_times INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE history (song_id INTEGER PRIMARY KEY, play_time TEXT NOT NULL);
  CREATE TABLE play_history (
    id INTEGER PRIMARY KEY, song_id INTEGER NOT NULL, started_at INTEGER NOT NULL,
    played_ms INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER, end_reason TEXT,
    start_origin TEXT NOT NULL DEFAULT 'automatic', ended_at INTEGER
  );
  INSERT INTO song (id) VALUES (1);
`)
const { savePlayHistory } = loadTypeScript(
  path.join(__dirname, '../src/main/database/repository.ts'),
  {
    '../i18n': { t: (key) => key },
    'node:fs': fs,
    electron: { safeStorage: {} },
    'node:path': path,
    'node:crypto': { randomUUID: () => 'test-id' },
    './index': { getDatabase: () => startWriteDb },
    './recommendations': {},
    '../service/loggerService': { Logger: {} },
    './newestSongs': {},
    './listeningStats': {},
    './libraryQuality': {},
    '../utils/pathUtils': {}
  }
)
const { recordPlayEvent: finishStart } = loadTypeScript(
  path.join(__dirname, '../src/main/database/recommendations.ts'),
  { './index': { getDatabase: () => startWriteDb } }
)
const firstStartAt = new Date(2026, 0, 1, 12).getTime()
savePlayHistory(1, firstStartAt, 'search')
assert.equal(startWriteDb.prepare('SELECT play_times FROM song WHERE id = 1').get().play_times, 1)
assert.equal(
  startWriteDb.prepare('SELECT played_ms FROM play_history WHERE started_at = ?').get(firstStartAt)
    .played_ms,
  0,
  'a play start is recorded before the session ends'
)
finishStart({
  songId: 1,
  startedAt: firstStartAt,
  playedMs: 60_000,
  durationMs: 180_000,
  endReason: 'ended',
  startOrigin: 'search'
})
const secondStartAt = firstStartAt + 3600_000
finishStart({
  songId: 1,
  startedAt: secondStartAt,
  playedMs: 30_000,
  durationMs: 180_000,
  endReason: 'closed',
  startOrigin: 'automatic'
})
savePlayHistory(1, secondStartAt, 'automatic')
assert.equal(startWriteDb.prepare('SELECT play_times FROM song WHERE id = 1').get().play_times, 2)
assert.equal(
  startWriteDb.prepare('SELECT COUNT(*) AS count FROM play_history').get().count,
  2,
  'a close event arriving first and its late start share one history row'
)
startWriteDb.close()
const insertHistory = db.prepare(
  'INSERT INTO play_history (song_id, started_at, played_ms, duration_ms, end_reason) VALUES (?, ?, ?, ?, ?)'
)
const now = Date.now()
db.prepare('UPDATE song SET created_at = ? WHERE id = 3').run(new Date(now).toISOString())
const { refreshNewestSongs } = loadTypeScript(
  path.join(__dirname, '../src/main/database/newestSongs.ts')
)
refreshNewestSongs(db)
assert.equal(db.prepare('SELECT is_newest FROM song WHERE id = 3').get().is_newest, 1)
assert.equal(db.prepare('SELECT is_newest FROM song WHERE id = 1').get().is_newest, 0)
insertHistory.run(1, now - 86400_000, 170_000, 180_000, 'ended')
insertHistory.run(1, now - 172800_000, 175_000, 180_000, 'ended')
insertHistory.run(2, now - 86400_000, 4000, 180_000, 'next')
insertHistory.run(2, now - 172800_000, 3000, 180_000, 'next')
insertHistory.run(4, now - 86400_000, 3000, 180_000, 'ended')
insertHistory.run(7, now - 86400_000, 3000, 180_000, 'selected')
insertHistory.run(7, now - 172800_000, 3000, 180_000, 'previous')
insertHistory.run(5, now - 86400_000, 3000, 240_000, 'next')
insertHistory.run(5, now - 172800_000, 3000, 240_000, 'next')
insertHistory.run(11, now - 100 * 86400_000, 170_000, 180_000, 'ended')
const insertHistoryWithOrigin = db.prepare(
  'INSERT INTO play_history (song_id, started_at, played_ms, duration_ms, end_reason, start_origin) VALUES (?, ?, ?, ?, ?, ?)'
)
insertHistoryWithOrigin.run(8, now - 86400_000, 100_000, 180_000, 'selected', 'search')
insertHistoryWithOrigin.run(9, now - 86400_000, 100_000, 180_000, 'selected', 'automatic')
insertHistoryWithOrigin.run(10, now - 86400_000, 100_000, 180_000, 'selected', 'return')

const {
  getRecommendationScores,
  getDailyRecommendationGroups,
  getRecentDiscoveryGroups,
  recordPlayEvent,
  setSongPreference,
  diversifyByArtist,
  selectRecommendationGroups
} = loadTypeScript(path.join(__dirname, '../src/main/database/recommendations.ts'), {
  './index': { getDatabase: () => db }
})
const { selectSmartNext } = loadTypeScript(
  path.join(__dirname, '../src/renderer/src/stores/player/smartShuffle.ts')
)
let scores = new Map(getRecommendationScores().map((score) => [score.songId, score]))
assert.ok(
  scores.get(3).factors.variation >= 0.96 && scores.get(3).factors.variation <= 1.04,
  'daily variation stays small and visible'
)
assert.ok(scores.get(1).weight > scores.get(3).weight, 'repeated listening should outrank unplayed')
assert.ok(scores.get(3).weight > scores.get(2).weight, 'repeated early skips should lower weight')
assert.equal(scores.get(2).reason, 'skipped')
assert.equal(
  scores.get(7).reason,
  'skipped',
  'choosing a song or previous also counts as early skip'
)
assert.equal(scores.get(7).engagedPlays, 0, 'quick starts are not engaged listens')
assert.ok(scores.get(3).weight > 0, 'a track without tags remains eligible')
assert.ok(scores.get(3).factors.freshness > 0.4, 'the newest import receives a dated boost')
assert.ok(scores.get(8).behaviorParts.intent > scores.get(9).behaviorParts.intent)
assert.ok(scores.get(10).behaviorParts.intent > 0, 'returning to a song adds intent')
assert.ok(scores.get(8).weight > scores.get(9).weight, 'searched listening outranks auto play')
assert.equal(scores.get(11).recentPlays, 0, 'events older than 90 days are excluded')
assert.equal(scores.get(5).recentEngagedPlays, 0, 'legacy starts are not recent engaged listens')
assert.equal(scores.get(5).factors.exploration, 1.25, 'exploration uses recent engagement')
assert.equal(scores.get(8).factors.exploration, 1.08)
assert.ok(scores.get(8).factors.recency > 0.7 && scores.get(8).factors.recency < 1)
assert.notEqual(scores.get(5).reason, 'skipped', 'familiar tracks tolerate occasional skips')
assert.ok(
  scores.get(5).behaviorParts.skips > scores.get(2).behaviorParts.skips,
  'a familiar track receives a softer early skip penalty'
)
assert.equal(scores.get(4).completions, 0, 'seeking near the end does not count as a full listen')
assert.ok(
  scores.get(5).weight > scores.get(2).weight,
  'older play counts should retain value despite occasional skips'
)
assert.equal(scores.get(5).recentPlays, 2, 'recent skips remain separate from older play counts')
assert.equal(scores.get(5).engagedPlays, 18, 'older plays remain in the familiarity estimate')
assert.ok(scores.get(5).factors.behavior > 0, 'the visible behavior factor explains the weight')
assert.equal(scores.get(2).engagedPlays, 1, 'recent starts are not double-counted as legacy plays')
assert.ok(scores.get(1).behaviorParts.repeat > 0, 'replays on different days add evidence')
assert.ok(scores.get(6).factors.album > 0, 'album affinity helps unplayed tracks')
assert.ok(scores.get(6).factors.era > 0, 'release era helps unplayed tracks')
assert.ok(scores.get(6).factors.length > 0, 'duration preferences help unplayed tracks')
let groups = selectRecommendationGroups(Array.from(scores.values()), 20)
assert.ok(
  groups.recommended.some((song) => song.songId === 5),
  'older favorites remain in Favorites'
)
assert.ok(
  !groups.recommended.some((song) => song.songId === 2),
  'early skips do not become favorites just from play count'
)

const diverse = diversifyByArtist(
  [
    { artistKey: 'a', id: 1 },
    { artistKey: 'a', id: 2 },
    { artistKey: 'a', id: 3 },
    { artistKey: 'b', id: 4 },
    { artistKey: 'c', id: 5 }
  ],
  4
)
assert.deepEqual(
  Array.from(diverse, (song) => song.id),
  [1, 4, 5, 2],
  'discovery interleaves artists without losing high-ranked songs'
)
const manyFavorites = Array.from({ length: 300 }, (_, index) => ({
  songId: index + 100,
  artistKey: `artist-${index}`,
  preference: 0,
  completions: 0,
  skips: 0,
  plays: 10,
  engagedPlays: 10,
  weight: 2,
  reason: 'replayed'
}))
assert.equal(
  selectRecommendationGroups(manyFavorites, 100).recommended.length,
  100,
  'the displayed group respects its 100-song limit'
)

const discoveryCandidates = Array.from({ length: 12 }, (_, index) => ({
  songId: index + 400,
  artistKey: index < 6 ? 'familiar-artist' : `rare-artist-${index}`,
  preference: 0,
  completions: 0,
  skips: 0,
  plays: index < 6 ? 1 : 0,
  engagedPlays: index < 6 ? 1 : 0,
  recentPlays: 0,
  weight: index < 6 ? 2 : 1,
  reason: index < 6 ? 'similarArtist' : 'unheard',
  factors: {
    artist: index < 6 ? 0.25 : 0,
    album: 0,
    genre: 0,
    tag: 0,
    era: 0,
    length: 0
  }
}))
const mixedDiscovery = selectRecommendationGroups(discoveryCandidates, 12).discovery
assert.equal(
  mixedDiscovery.filter((song) => song.discoveryKind === 'cold').length,
  4,
  'one third of Discover is reserved for underplayed songs when available'
)
assert.equal(mixedDiscovery[2].discoveryKind, 'cold')
assert.ok(
  new Set(mixedDiscovery.map((song) => song.artistKey)).size > 3,
  'Discover spreads the first page across artists'
)

setSongPreference(3, 1)
setSongPreference(1, -1)
scores = new Map(getRecommendationScores().map((score) => [score.songId, score]))
assert.ok(scores.get(3).weight > scores.get(1).weight, 'explicit feedback outweighs history')
assert.equal(scores.get(1).preference, -1)
assert.equal(db.prepare('SELECT preference FROM song WHERE id = 1').get().preference, -1)
groups = selectRecommendationGroups(Array.from(scores.values()), 20)
assert.equal(groups.recommended[0].songId, 3, 'explicitly liked tracks lead Favorites')
setSongPreference(1, 0)
scores = new Map(getRecommendationScores().map((score) => [score.songId, score]))
assert.equal(scores.get(1).preference, 0, 'feedback can be undone')
assert.equal(db.prepare('SELECT preference FROM song WHERE id = 1').get().preference, 0)
const today = new Date(now)
const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
db.prepare('UPDATE song SET play_times = play_times + 1 WHERE id = 9').run()
insertHistoryWithOrigin.run(9, todayMidnight + 1000, 100_000, 180_000, 'ended', 'automatic')
const activeStartedAt = todayMidnight + 2000
db.prepare('UPDATE song SET play_times = play_times + 1 WHERE id = 9').run()
db.prepare('INSERT INTO play_history (song_id, started_at, start_origin) VALUES (?, ?, ?)').run(
  9,
  activeStartedAt,
  'automatic'
)
db.prepare(
  'INSERT INTO play_history (song_id, started_at, played_ms, duration_ms, end_reason, start_origin, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
).run(10, todayMidnight - 10_000, 90_000, 180_000, 'ended', 'automatic', todayMidnight + 80_000)
const dailyScores = new Map(
  getRecommendationScores(todayMidnight, true).map((score) => [score.songId, score])
)
assert.equal(dailyScores.has(3), false, 'songs imported today wait until tomorrow')
assert.equal(dailyScores.get(9).recentPlays, 1, 'today’s completed play is excluded')
assert.equal(dailyScores.get(9).plays, 1, 'today’s play start is excluded from legacy counts')
assert.equal(dailyScores.get(10).recentPlays, 1, 'a session ending today is excluded')
recordPlayEvent({
  songId: 9,
  startedAt: activeStartedAt,
  playedMs: 120_000,
  durationMs: 180_000,
  endReason: 'ended',
  startOrigin: 'automatic'
})
const finalizedStart = db
  .prepare(
    'SELECT played_ms, end_reason, ended_at FROM play_history WHERE song_id = 9 AND started_at = ?'
  )
  .get(activeStartedAt)
assert.equal(finalizedStart.played_ms, 120_000, 'the start row is completed in place')
assert.equal(finalizedStart.end_reason, 'ended')
assert.ok(finalizedStart.ended_at)
assert.equal(
  db
    .prepare('SELECT COUNT(*) AS count FROM play_history WHERE song_id = 9 AND started_at = ?')
    .get(activeStartedAt).count,
  1,
  'finishing a session does not duplicate its start row'
)
const daily = getDailyRecommendationGroups(now)
assert.ok(daily.generatedFor && daily.dataThrough)
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM recommendation_daily').get().count, 1)
const firstSnapshot = JSON.stringify(daily)
insertHistory.run(9, todayMidnight - 3600_000, 175_000, 180_000, 'ended')
assert.equal(
  JSON.stringify(getDailyRecommendationGroups(now)),
  firstSnapshot,
  'the saved daily list does not change when play events arrive'
)
setSongPreference(9, 1)
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM recommendation_daily').get().count, 1)
assert.equal(
  JSON.stringify(getDailyRecommendationGroups(now)),
  firstSnapshot,
  'feedback does not change today’s membership, order, or saved scores'
)
const dailySong = [...daily.recommended, ...daily.discovery, ...daily.lessRecommended].find(
  (song) => song.songId !== 9
)
assert.ok(dailySong)
setSongPreference(dailySong.songId, -1)
assert.equal(
  db.prepare('SELECT preference FROM song WHERE id = ?').get(dailySong.songId).preference,
  -1,
  'the button reads current feedback from song'
)
assert.equal(
  getRecommendationScores().find((song) => song.songId === dailySong.songId).weight,
  0.06,
  'smart shuffle receives the reduced weight immediately'
)
assert.equal(JSON.stringify(getDailyRecommendationGroups(now)), firstSnapshot)
setSongPreference(dailySong.songId, dailySong.preference)
const tomorrowNoon = new Date(
  today.getFullYear(),
  today.getMonth(),
  today.getDate() + 1,
  12
).getTime()
const tomorrowDaily = getDailyRecommendationGroups(tomorrowNoon)
assert.notEqual(tomorrowDaily.generatedFor, daily.generatedFor, 'the next day gets a new snapshot')
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const localDate = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
const dayBeforeYesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 2)
const insertSnapshot = db.prepare(
  'INSERT INTO recommendation_daily (local_date, cutoff_at, groups_json, created_at) VALUES (?, ?, ?, ?)'
)
const historicalGroups = JSON.stringify({
  recommended: [],
  discovery: [{ songId: 1 }],
  lessRecommended: []
})
insertSnapshot.run(localDate(yesterday), yesterday.getTime(), historicalGroups, now)
insertSnapshot.run(
  localDate(dayBeforeYesterday),
  dayBeforeYesterday.getTime(),
  historicalGroups,
  now
)
assert.deepEqual(
  getRecentDiscoveryGroups(tomorrowNoon).map((group) => group.generatedFor),
  [tomorrowDaily.generatedFor, daily.generatedFor, localDate(yesterday)],
  'discovery keeps at most three calendar days of fixed lists'
)
assert.equal(
  db.prepare('SELECT COUNT(*) AS count FROM recommendation_daily').get().count,
  3,
  'older daily snapshots are removed'
)
assert.ok(
  tomorrowDaily.recommended.some((song) => song.songId === 9),
  'today’s like affects tomorrow’s recommendation'
)
assert.ok(
  [...tomorrowDaily.recommended, ...tomorrowDaily.discovery].some((song) => song.songId === 3),
  'today’s imported song becomes eligible tomorrow'
)
setSongPreference(9, 0)
db.prepare('UPDATE song SET created_at = ? WHERE id = 8').run(
  new Date(now + 86400_000).toISOString()
)
refreshNewestSongs(db)
assert.equal(db.prepare('SELECT is_newest FROM song WHERE id = 8').get().is_newest, 1)
assert.equal(db.prepare('SELECT is_newest FROM song WHERE id = 3').get().is_newest, 0)

const queue = [
  { id: 1, artist: null, album: null, songStatus: 1 },
  { id: 2, artist: null, album: null, songStatus: 1 },
  { id: 3, artist: null, album: null, songStatus: 1 }
]
const played = new Set([1, 3])
const shuffleScores = new Map([
  [1, { weight: 1, plays: 1, preference: 0 }],
  [2, { weight: 0.06, plays: 4, preference: -1 }],
  [3, { weight: 4, plays: 4, preference: 1 }]
])
assert.equal(
  selectSmartNext(queue, 0, played, shuffleScores, () => 0.5),
  1,
  'the unplayed candidate is selected despite low preference'
)
played.add(2)
assert.equal(
  selectSmartNext(queue, 1, played, shuffleScores, () => 0.5),
  2,
  'a new round avoids immediately repeating the current song'
)
let seed = 17
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
let likedPicks = 0
let reducedPicks = 0
for (let i = 0; i < 1000; i++) {
  const index = selectSmartNext(queue, 0, new Set([1]), shuffleScores, random)
  if (index === 2) likedPicks++
  if (index === 1) reducedPicks++
}
assert.ok(likedPicks > reducedPicks * 10, 'reduced preference should lower exposure')

db.prepare('DELETE FROM song WHERE id = 1').run()
assert.equal(
  db.prepare('SELECT COUNT(*) AS count FROM play_history WHERE song_id = 1').get().count,
  0
)
db.prepare('UPDATE song SET created_at = NULL').run()
refreshNewestSongs(db)
assert.equal(
  db.prepare('SELECT COUNT(*) AS count FROM song WHERE is_newest = 1').get().count,
  1,
  'an undated nonempty library still has a newest song'
)
db.close()
console.log('Recommendation behavior fixtures passed')
