import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { build } from 'esbuild'

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

const language = Buffer.from(
  JSON.stringify({
    content: [
      {
        type: 0,
        lyricContent: [
          ['ni', 'hao'],
          ['shi', 'jie']
        ]
      },
      { type: 1, lyricContent: [['Hello'], ['World']] }
    ]
  })
).toString('base64')
const krc = [
  '[ti:Test]',
  '[offset:120]',
  `[language:${language}]`,
  '[1000,1000]<0,300,0>你<300,400,0>好',
  '[2200,800]<0,500,0>世<500,300,0>界'
].join('\n')
const parsedKrc = parseLyrics({ content: krc, source: 'network' })
assert.equal(parsedKrc.format, 'krc')
assert.equal(parsedKrc.lines.length, 2)
assert.equal(parsedKrc.lines[0].text, '你好')
assert.deepEqual(
  parsedKrc.lines[0].words?.map(({ startMs, endMs }) => [startMs, endMs]),
  [
    [1120, 1420],
    [1420, 1820]
  ]
)
assert.equal(parsedKrc.lines[0].translation, 'Hello')
assert.equal(parsedKrc.lines[0].romanization, 'nihao')
assert.deepEqual(
  parsedKrc.lines[0].romanizationWords?.map(({ startMs, endMs }) => [startMs, endMs]),
  [
    [1120, 1420],
    [1420, 1820]
  ]
)
assert.equal(parsedKrc.lines[0].rubySegments?.length, 2)
assert.equal(parsedKrc.lines[1].translation, 'World')

const malformedKrc = parseLyrics({
  content: '[language:invalid]\n[1000,500]<0,500,0>test',
  format: 'krc',
  source: 'network'
})
assert.equal(malformedKrc.lines[0].text, 'test')

const yrc = parseLyrics({
  content: '[1000,800](1000,400,0)你(1400,400,0)好',
  format: 'yrc',
  translation: { content: '[00:01.060]Hello', format: 'lrc' },
  source: 'network'
})
assert.equal(yrc.lines[0].translation, 'Hello')
assert.equal(yrc.lines[0].words?.length, 2)

// Empty YRC syllables are timing markers, not visible lyric text.
const emptyYrc =
  '[0,9079](0,1297,0)(1297,1297,0)(2594,1297,0)(3891,1297,0)(5188,1297,0)(6485,1297,0)(7782,1297,0)'
for (const format of [undefined, 'yrc']) {
  const parsed = parseLyrics({ content: emptyYrc, format, source: 'database' })
  assert.equal(parsed.format, 'yrc')
  assert.equal(parsed.lines.length, 1)
  assert.equal(parsed.lines[0].text, '', 'Consecutive empty syllables must not leak timing tags')
  assert.equal(parsed.lines[0].timeMs, 0)
  assert.equal(parsed.lines[0].endMs, 9079)
  assert.equal(parsed.lines[0].words, undefined)
}
const whitespaceYrc = parseLyrics({ content: '[0,200](0,100,0) (100,100,0)', source: 'local' })
assert.equal(whitespaceYrc.lines[0].text, ' ')
assert.equal(
  whitespaceYrc.lines[0].words,
  undefined,
  'Whitespace-only syllables are not sung words'
)
const mixedEmptyYrc = parseLyrics({
  content:
    emptyYrc + '\n[9079,900](9079,100,0)(9179,300,0)你(9479,100,0)(9579,200,0)(好)(9779,200,0)',
  source: 'network'
})
assert.deepEqual(
  mixedEmptyYrc.lines.map((line) => line.text),
  ['', '你(好)']
)
assert.deepEqual(
  mixedEmptyYrc.lines[1].words.map(({ text, startMs, endMs }) => [text, startMs, endMs]),
  [
    ['你', 9179, 9479],
    ['(好)', 9579, 9779]
  ],
  'Empty syllables do not consume the text or timing of neighboring words'
)
assert.equal(
  parseLyrics({ content: '[186,2336](186,2336,0)(2521,1)', format: 'yrc', source: 'local' })
    .lines[0].text,
  '(2521,1)',
  'Two-field numeric parentheses inside a YRC word remain literal text'
)

// QQ can leave suffix-style QRC spacers among normalized YRC lines.
const mixedQrcSpacer = '[186,2336] (2521,1)\n[2522,400](2522,400,0)Hello'
for (const format of [undefined, 'yrc']) {
  const parsed = parseLyrics({ content: mixedQrcSpacer, format, source: 'network' })
  assert.equal(parsed.format, 'yrc')
  assert.equal(parsed.lines[0].text, ' ', 'A timed QRC spacer remains whitespace, not a timestamp')
  assert.equal(parsed.lines[0].timeMs, 186)
  assert.equal(parsed.lines[0].endMs, 2522)
  assert.equal(parsed.lines[0].words, undefined, 'Do not invent sung words for a blank spacer')
  assert.equal(parsed.lines[1].text, 'Hello')
  assert.equal(parsed.lines[1].words[0].startMs, 2522)
}
for (const content of ['[186,2336] (2521,1)', '[186,2336](2521,1)']) {
  const parsed = parseLyrics({ content, source: 'database' })
  assert.equal(parsed.format, 'yrc', 'Standalone spacers are recognized without a format hint')
  assert.equal(parsed.lines[0].text.trim(), '')
}
assert.equal(
  parseLyrics({ content: '[186,2336]Literal (2521,1)', format: 'yrc', source: 'local' }).lines[0]
    .text,
  'Literal (2521,1)',
  'Numeric parentheses in ordinary text are preserved'
)

const lrc = parseLyrics({ content: '[00:01.00]Hello', format: 'lrc', source: 'network' })
assert.equal(lrc.lines[0].text, 'Hello')
console.log('Network lyric parser fixtures passed')

const normalizerSource = readFileSync('src/main/service/networkLyricNormalizer.ts', 'utf8')
const normalizerJs = ts.transpileModule(normalizerSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
}).outputText
const { cleanNetworkLyric, normalizeKrc } = await import(
  `data:text/javascript;base64,${Buffer.from(normalizerJs).toString('base64')}`
)
const cleanKrc = normalizeKrc(krc)
assert(!cleanKrc.lrc.includes('[language:'))
assert(!cleanKrc.lrc.includes('[ti:'))
assert(!cleanKrc.lrc.includes('[offset:'))
const cleanParsed = parseLyrics({
  content: cleanKrc.lrc,
  format: 'krc',
  translation: { content: cleanKrc.translation, format: cleanKrc.translationFormat },
  romanization: { content: cleanKrc.romanization, format: cleanKrc.romanizationFormat },
  source: 'network'
})
assert.deepEqual(cleanParsed.lines, parsedKrc.lines)
assert.equal(
  cleanNetworkLyric('[ti:Test]\n{"t":0,"c":[]}\n[by:Someone]\n[00:01.000]Hello', 'lrc'),
  '[00:01.000]Hello'
)
assert.equal(
  cleanNetworkLyric('[offset:100]\n[ti:Test]\n[1000,800](1000,400,0)你(1400,400,0)好', 'yrc'),
  '[1100,800](1100,400,0)你(1500,400,0)好'
)
assert.equal(
  normalizeKrc('[language:invalid]\n[1000,500]<0,500,0>test').lrc,
  '[1000,500]<0,500,0>test'
)
console.log('Network lyric cleanup fixtures passed')
