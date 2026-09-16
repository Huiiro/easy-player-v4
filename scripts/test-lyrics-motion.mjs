import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
async function load(name) {
  const text = readFileSync(`src/renderer/src/components/lyrics/${name}.ts`, 'utf8')
  const { outputText } = ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
  })
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
}
const { LyricSpring } = await load('lyricSpring')
const { LyricClock } = await load('lyricClock')
for (const fps of [30, 60, 144]) {
  const spring = new LyricSpring()
  spring.target = 200
  let overshoot = false
  for (let frame = 0; frame < fps * 3; frame++) {
    spring.step(1 / fps, 14, 0.82)
    overshoot ||= spring.position > 200
  }
  assert(overshoot, `spring should rebound at ${fps} FPS`)
  assert.equal(spring.position, 200)
  spring.target = -100
  for (let frame = 0; frame < fps * 3; frame++) spring.step(1 / fps, 14, 0.82)
  assert.equal(spring.position, -100)
}
const clock = new LyricClock()
clock.sample(1000, 0)
clock.sample(1100, 100)
assert.equal(clock.read(100), 1000)
assert.equal(clock.read(150), 1050)
assert.equal(clock.read(200), 1100)
assert.equal(clock.read(5000), 1100, 'pause must not extrapolate')
assert.equal(clock.isMoving(5000), false)
clock.sample(45000, 5100)
assert.equal(clock.read(5100), 45000, 'forward seek must be immediate')
clock.sample(500, 5200)
assert.equal(clock.read(5200), 500, 'backward seek must be immediate')
console.log('PASS: spring rebound/convergence at 30/60/144 FPS, interpolation, pause, seeks')
const slowClock = new LyricClock()
slowClock.sample(0, 0)
slowClock.sample(250, 250)
assert.equal(slowClock.read(375), 125)
assert.equal(slowClock.read(450), 200, '250ms inputs must still interpolate after 120ms')
assert(slowClock.isMoving(450))
assert.equal(slowClock.read(500), 250)
const { withLyricInterludes } = await load('lyricInterlude')
const lines = withLyricInterludes([
  { timeMs: 3000, endMs: 5000, text: 'First' },
  { timeMs: 11000, endMs: 13000, text: 'Next' }
])
assert.deepEqual(
  lines.map((line) => [line.timeMs, line.text]),
  [
    [0, ''],
    [3000, 'First'],
    [5000, ''],
    [11000, 'Next']
  ]
)
assert.equal(
  withLyricInterludes([
    { timeMs: 0, text: 'Long LRC line' },
    { timeMs: 15000, text: 'Next' }
  ]).length,
  2
)
assert.equal(withLyricInterludes([{ timeMs: 0, text: 'Plain', untimed: true }]).length, 1)
const parserText = readFileSync('src/renderer/src/services/lyrics.ts', 'utf8')
const parserJs = ts.transpileModule(parserText, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
}).outputText
const { parseLyrics } = await import(
  `data:text/javascript;base64,${Buffer.from(parserJs).toString('base64')}`
)
const parsed = parseLyrics({
  content: '[00:03.000]First\n[00:05.000]\n[00:11.000]Next',
  format: 'lrc',
  source: 'local'
}).lines
assert.equal(parsed.length, 3)
assert.equal(parsed[1].text, '')
assert.equal(parsed[1].endMs, 11000)
console.log('PASS: 250ms continuous interpolation, leading/explicit gaps, timestamp-only LRC')
assert.equal(
  parseLyrics({ content: '[00:03.000]\n[00:05.000]', format: 'lrc', source: 'local' }).lines.length,
  0
)
console.log('PASS: timing-only source remains empty for fallback')
