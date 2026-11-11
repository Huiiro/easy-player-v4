import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { build } from 'esbuild'
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- Runtime-only TypeScript test fixture.
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
const playingClock = new LyricClock()
playingClock.sample(1000, 0, true)
assert.equal(playingClock.read(250), 1250, 'playing clock must advance between sparse samples')
assert.equal(playingClock.isMoving(5000), true)
playingClock.sample(1250, 250, false)
assert.equal(playingClock.read(1000), 1250, 'paused clock must remain fixed')
console.log('PASS: spring rebound/convergence at 30/60/144 FPS, interpolation, pause, seeks')
const slowClock = new LyricClock()
slowClock.sample(0, 0)
slowClock.sample(250, 250)
assert.equal(slowClock.read(375), 125)
assert.equal(slowClock.read(450), 200, '250ms inputs must still interpolate after 120ms')
assert(slowClock.isMoving(450))
assert.equal(slowClock.read(500), 250)
const { withLyricInterludes } = await load('lyricInterlude')
const sourceBlank = {
  timeMs: 5000,
  endMs: 11000,
  text: '',
  translation: 'source timing marker'
}
const lines = withLyricInterludes([
  { timeMs: 3000, endMs: 5000, text: 'First' },
  sourceBlank,
  { timeMs: 11000, endMs: 13000, text: 'Next' }
])
assert.deepEqual(
  lines.map((line) => [line.timeMs, line.text]),
  [
    [3000, 'First'],
    [5000, ''],
    [11000, 'Next']
  ]
)
assert.notEqual(
  lines.find((line) => !line.text),
  sourceBlank
)
assert.equal(lines.find((line) => !line.text)?.translation, undefined)
assert.deepEqual(
  withLyricInterludes([
    { timeMs: 0, endMs: 2000, text: 'First' },
    { timeMs: 5000, endMs: 7000, text: 'Next' }
  ]).map((line) => [line.timeMs, line.text]),
  [
    [0, 'First'],
    [5000, 'Next']
  ],
  'an exact three-second gap must not create an interlude'
)
assert.deepEqual(
  withLyricInterludes([
    { timeMs: 0, endMs: 115443, text: 'Previous' },
    { timeMs: 115443, endMs: 115648, text: '' },
    { timeMs: 115648, endMs: 118000, text: '为理云鬓 为簪银钩' }
  ]).map((line) => [line.timeMs, line.text]),
  [
    [0, 'Previous'],
    [115648, '为理云鬓 为簪银钩']
  ],
  'a timestamp-only line less than three seconds before text must stay hidden'
)
assert.equal(
  withLyricInterludes([
    { timeMs: 0, text: 'Long LRC line' },
    { timeMs: 15000, text: 'Next' }
  ]).length,
  2
)
assert.equal(withLyricInterludes([{ timeMs: 0, text: 'Plain', untimed: true }]).length, 1)
const parserBundle = await build({
  entryPoints: ['src/renderer/src/services/lyrics.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser'
})
const { parseLyrics } = await import(
  `data:text/javascript;base64,${Buffer.from(parserBundle.outputFiles[0].text).toString('base64')}`
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

assert.deepEqual(
  withLyricInterludes(
    parseLyrics({
      content: '[186,2336] (2521,1)\n[2522,400](2522,400,0)Hello',
      format: 'yrc',
      source: 'network'
    }).lines
  ).map((line) => line.text),
  ['Hello'],
  'QRC whitespace spacers never become visible lyric rows'
)
console.log('PASS: mixed QRC spacers remain hidden during playback')

assert.deepEqual(
  withLyricInterludes(
    parseLyrics({
      content:
        '[0,9079](0,1297,0)(1297,1297,0)(2594,1297,0)(3891,1297,0)(5188,1297,0)(6485,1297,0)(7782,1297,0)\n[9079,400](9079,400,0)Hello',
      source: 'database'
    }).lines
  ).map(({ timeMs, endMs, text }) => ({ timeMs, endMs, text })),
  [
    { timeMs: 0, endMs: 9079, text: '' },
    { timeMs: 9079, endMs: 9479, text: 'Hello' }
  ],
  'An empty YRC syllable sequence becomes a single leading interlude without visible tags'
)
console.log('PASS: empty YRC syllables retain the leading instrumental interval')
