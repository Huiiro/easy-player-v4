import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import Database from 'better-sqlite3'

const source = readFileSync(resolve('src/main/database/listeningStats.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const moduleRef = { exports: {} }
vm.runInNewContext(compiled, { module: moduleRef, exports: moduleRef.exports })
const { getListeningInsights } = moduleRef.exports

const db = new Database(':memory:')
db.exec(`
  CREATE TABLE song (id INTEGER PRIMARY KEY, duration INTEGER);
  CREATE TABLE play_history (
    song_id INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    played_ms INTEGER NOT NULL,
    duration_ms INTEGER
  );
  INSERT INTO song (id, duration) VALUES (1, 100), (2, NULL);
`)
const insert = db.prepare(
  'INSERT INTO play_history (song_id, started_at, played_ms, duration_ms) VALUES (?, ?, ?, ?)'
)
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const atHour = (hour) => new Date(2026, 0, 1, hour).getTime()
insert.run(1, atHour(0), 4000, 100_000)
insert.run(1, atHour(6), 5000, 100_000)
insert.run(1, atHour(11), 90_000, 100_000)
insert.run(1, atHour(13), 89_999, 100_000)
insert.run(1, atHour(15), 100_000, null)
insert.run(2, atHour(18), 120_000, null)

const insights = getListeningInsights(db)
assert.equal(insights.eligiblePlays, 4, 'only plays of at least 5 seconds with a duration count')
assert.equal(insights.completedPlays, 2, '90% and legacy duration fallback count as complete')
assert.equal(
  JSON.stringify(insights.timePeriods.map(({ id, plays }) => [id, plays])),
  JSON.stringify([
    ['lateNight', 1],
    ['morning', 1],
    ['noon', 1],
    ['earlyAfternoon', 1],
    ['afternoon', 1],
    ['evening', 1]
  ])
)
assert.equal(Math.round(insights.timePeriods[3].playedSeconds * 1000), 89_999)
db.exec('DELETE FROM play_history')
assert.equal(getListeningInsights(db).eligiblePlays, 0)
db.close()
process.stdout.write('Listening statistics fixtures passed\n')
