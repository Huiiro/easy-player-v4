import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync('src/renderer/src/services/lyrics.ts', 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
})
const { parseLyrics } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
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
