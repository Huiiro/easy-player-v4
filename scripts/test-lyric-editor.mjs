import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { DOMParser } from '@xmldom/xmldom'
const directory = await mkdtemp(resolve('node_modules/.cache/lyric-editor-'))
const require = createRequire(import.meta.url)
globalThis.DOMParser = DOMParser
const database = new DatabaseSync(':memory:')
globalThis.lyricEditorDb = database
try {
  await build({
    stdin: {
      contents:
        "export * from './src/renderer/src/services/lyricEditor';export {updateSongLyrics} from './src/main/database/repository/songs'",
      resolveDir: process.cwd()
    },
    outfile: join(directory, 'editor.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    alias: { '@': resolve('src/renderer/src') },
    plugins: [
      {
        name: 'database-fixture',
        setup(builder) {
          const mocks = {
            '../index': 'export const getDatabase=()=>globalThis.lyricEditorDb',
            '../recommendations': 'export const invalidateDailyRecommendations=()=>{}',
            '../newestSongs': 'export const refreshNewestSongs=()=>{}',
            '../../search/searchQuery': 'export const buildSongSearchFilter=()=>({})',
            '../../utils/pathUtils': 'export const getCoverPath=()=>""',
            './songHelpers':
              'export const attachTags=x=>x,songColumns="",relevanceOrder=()=>"",mapSong=x=>x',
            './playlists': 'export const refreshPlaylistCover=()=>{}'
          }
          builder.onResolve({ filter: /.*/ }, (args) =>
            args.importer.replaceAll('\\', '/').endsWith('/repository/songs.ts') && mocks[args.path]
              ? { path: args.path, namespace: 'fixture' }
              : undefined
          )
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            contents: mocks[args.path],
            loader: 'js'
          }))
        }
      }
    ]
  })
  const editor = require(join(directory, 'editor.cjs'))
  const initial = editor.emptyLyricDraft()
  initial.lyric = editor.editorTrack(
    '[ar:Artist]\r\n[offset:100]\r\n[00:01.00]<00:01.00>Hello <00:01.50>world\r\n[00:03.00]Later',
    'elrc'
  )
  initial.translation = editor.editorTrack('[00:03.00]以后\n[00:01.00]你好', 'lrc')
  initial.romanization = editor.editorTrack('[00:01.00]HELLO', 'lrc')
  const rows = editor.lyricEditorRows(initial)
  assert.equal(rows[0].metadata, true)
  assert.deepEqual(
    rows.filter((row) => !row.metadata).map((row) => row.timeMs),
    [1100, 3100]
  )
  assert.equal(
    rows[1].cells.translation[0].raw,
    '[00:01.00]你好',
    'merge aligns by time instead of source line order'
  )
  assert.equal(rows[1].cells.romanization[0].raw, '[00:01.00]HELLO')
  const record = rows[1].cells.lyric[0]
  const editedTrack = editor.editLyricRecord(
    initial.lyric,
    record,
    record.raw.replace('world', 'friend')
  )
  assert.equal(editedTrack.format, 'elrc')
  assert.equal(
    editedTrack.content,
    initial.lyric.content.replace('world', 'friend'),
    'row editing preserves metadata, word timing and CRLF'
  )
  const matches = editor.findLyricMatches(initial, editor.lyricTracks, 'hello', false)
  assert.equal(matches.length, 2)
  const replaced = editor.replaceLyricMatches(initial, matches, '$&')
  assert(
    replaced.lyric.content.includes('$&'),
    'replacement is literal, including dollar sequences'
  )
  assert(replaced.romanization.content.endsWith('$&'))
  assert.equal(
    editor.findLyricMatches(initial, editor.lyricTracks, '[', true).length,
    7,
    'literal search escapes regex characters'
  )
  const history = new editor.LyricEditorHistory(initial)
  history.commit(replaced)
  assert.deepEqual(history.undo(), initial, 'a cross-track replacement undoes as one operation')
  assert.deepEqual(history.redo(), replaced)
  history.undo()
  history.commit({ ...initial, offsetMs: 1000 })
  assert.equal(history.canRedo, false, 'new edits truncate the redo branch')
  assert.equal(history.undo().offsetMs, null)
  const added = editor.appendLyricLine(editor.editorTrack(''), 3100, 'new')
  assert.equal(added.content, '[00:03.100]new')
  const inserted = editor.insertLyricRow(initial, rows[1], 'Inserted')
  assert.equal(inserted.row.timeMs, 2100)
  assert(
    inserted.draft.lyric.content.includes('world\r\n[00:02.000]Inserted\r\n[00:03.00]Later'),
    'insert below preserves surrounding word timings, metadata and CRLF'
  )
  assert.equal(inserted.draft.translation.content, initial.translation.content)
  assert.deepEqual(
    editor.deleteLyricRow(inserted.draft, inserted.row),
    initial,
    'removing an inserted timed line preserves all original tracks'
  )
  const deleted = editor.deleteLyricRow(initial, rows[1])
  assert(
    !deleted.lyric.content.includes('Hello') &&
      !deleted.translation.content.includes('你好') &&
      !deleted.romanization.content.includes('HELLO'),
    'deleting a sentence removes all matching tracks'
  )
  assert(deleted.lyric.content.includes('[ar:Artist]\r\n[offset:100]'))
  const rowHistory = new editor.LyricEditorHistory(initial)
  rowHistory.commit(deleted)
  assert.deepEqual(
    rowHistory.undo(),
    initial,
    'sentence deletion undoes across all tracks in one action'
  )
  assert.deepEqual(rowHistory.redo(), deleted)
  const firstInserted = editor.insertLyricRow(editor.emptyLyricDraft(), null, 'First')
  assert.equal(firstInserted.row.timeMs, 0)
  assert.equal(
    editor.lyricEditorRows(editor.deleteLyricRow(firstInserted.draft, firstInserted.row)).length,
    0
  )
  const tight = editor.emptyLyricDraft()
  tight.lyric = editor.editorTrack('[00:01.000]A\n[00:01.001]B', 'lrc')
  assert.throws(
    () => editor.insertLyricRow(tight, editor.lyricEditorRows(tight)[0], 'New'),
    /lyric-editor-no-gap/
  )
  assert.equal(tight.lyric.content, '[00:01.000]A\n[00:01.001]B')
  const plain = editor.emptyLyricDraft()
  plain.lyric = editor.editorTrack('first\nsecond', 'plain')
  plain.translation = editor.editorTrack('一\n二', 'plain')
  assert.equal(editor.lyricEditorRows(plain).length, 2)
  const insertedPlain = editor.insertLyricRow(plain, editor.lyricEditorRows(plain)[0], 'middle')
  assert.equal(insertedPlain.draft.lyric.content, 'first\nmiddle\nsecond')
  assert.equal(
    editor.lyricEditorRows(insertedPlain.draft)[2].cells.translation[0].text,
    '二',
    'plain inserts preserve translation line alignment'
  )
  insertedPlain.draft.translation = editor.fillPlainLyricLine(
    insertedPlain.draft.translation,
    1,
    '中'
  )
  assert.equal(editor.lyricEditorRows(insertedPlain.draft)[1].cells.translation[0].text, '中')
  const removedPlain = editor.deleteLyricRow(
    insertedPlain.draft,
    editor.lyricEditorRows(insertedPlain.draft)[1]
  )
  assert.equal(removedPlain.lyric.content, plain.lyric.content)
  assert.equal(removedPlain.translation.content, plain.translation.content)
  const repeated = editor.emptyLyricDraft()
  repeated.lyric = editor.editorTrack('[00:01.00][00:03.00]repeat', 'lrc')
  assert.deepEqual(
    editor.lyricEditorRows(repeated).map((row) => row.timeMs),
    [1000, 3000]
  )
  const removedRepeat = editor.deleteLyricRow(repeated, editor.lyricEditorRows(repeated)[0])
  assert.equal(
    removedRepeat.lyric.content,
    '[00:03.00]repeat',
    'deleting one occurrence keeps the other timestamp on a shared source line'
  )
  assert.equal(
    editor.editLyricRecord(
      repeated.lyric,
      editor.lyricEditorRows(repeated)[1].cells.lyric[0],
      '[00:01.00][00:03.00]changed'
    ).content,
    '[00:01.00][00:03.00]changed'
  )
  const xml =
    '<tt xmlns="http://www.w3.org/ns/ttml"><body begin="1s"><div><p begin="2s" end="4s"><span begin="2s">hello</span></p><p begin="5s">later</p></div></body></tt>'
  const xmlTrack = editor.editorTrack(xml, 'ttml')
  const xmlRecords = editor.lyricEditorRecords('lyric', xmlTrack)
  assert.deepEqual(
    xmlRecords.filter((record) => !record.metadata).map((record) => record.timeMs),
    [3000, 6000]
  )
  const paragraph = xmlRecords.find((record) => !record.metadata)
  assert.equal(
    editor.editLyricRecord(xmlTrack, paragraph, paragraph.raw.replace('hello', 'hi')).content,
    xml.replace('hello', 'hi')
  )
  assert(editor.appendLyricLine(xmlTrack, 7000, 'A & B').content.includes('A &amp; B'))
  const xmlDraft = editor.emptyLyricDraft()
  xmlDraft.lyric = xmlTrack
  const insertedXml = editor.insertLyricRow(
    xmlDraft,
    editor.lyricEditorRows(xmlDraft).find((row) => row.timeMs === 3000),
    'middle'
  )
  assert.equal(insertedXml.row.timeMs, 4500, 'TTML insert accounts for inherited parent timing')
  const deletedXml = editor.deleteLyricRow(insertedXml.draft, insertedXml.row)
  assert.equal(
    new DOMParser()
      .parseFromString(deletedXml.lyric.content, 'application/xml')
      .getElementsByTagNameNS('*', 'p').length,
    2
  )
  assert(deletedXml.lyric.content.includes('<span begin="2s">hello</span>'))

  database.exec(
    'CREATE TABLE song(id INTEGER PRIMARY KEY,lrc TEXT,lyric_format TEXT,translation TEXT,translation_format TEXT,romanization TEXT,romanization_format TEXT,offset_ms INTEGER CHECK(offset_ms BETWEEN -5000 AND 5000));INSERT INTO song(id,offset_ms) VALUES(1,1200)'
  )
  const payload = {
    lrc: initial.lyric.content,
    lyricFormat: 'elrc',
    translation: 'translated',
    translationFormat: 'lrc',
    romanization: 'roman',
    romanizationFormat: 'lrc'
  }
  assert(editor.updateSongLyrics(1, payload))
  assert.equal(
    database.prepare('SELECT offset_ms FROM song WHERE id=1').get().offset_ms,
    1200,
    'legacy saves retain the existing offset'
  )
  editor.updateSongLyrics(1, { ...payload, offsetMs: 1550 })
  assert.equal(database.prepare('SELECT offset_ms FROM song WHERE id=1').get().offset_ms, 1600)
  assert.throws(() => editor.updateSongLyrics(1, { ...payload, lrc: 'bad', offsetMs: NaN }))
  assert.equal(database.prepare('SELECT lrc FROM song WHERE id=1').get().lrc, payload.lrc)
  database.exec(
    "CREATE TRIGGER reject_lyrics BEFORE UPDATE ON song WHEN new.translation='reject' BEGIN SELECT RAISE(ABORT,'fixture failure');END"
  )
  assert.throws(() =>
    editor.updateSongLyrics(1, {
      ...payload,
      lrc: 'changed',
      translation: 'reject',
      offsetMs: -1000
    })
  )
  assert.equal(
    database.prepare('SELECT offset_ms FROM song WHERE id=1').get().offset_ms,
    1600,
    'failed lyric updates cannot partially update the offset'
  )
  editor.updateSongLyrics(1, { lrc: '', offsetMs: null })
  assert.deepEqual(
    { ...database.prepare('SELECT translation,romanization,offset_ms FROM song WHERE id=1').get() },
    { translation: null, romanization: null, offset_ms: null }
  )
  assert.equal(editor.updateSongLyrics(99, payload), false)
  console.log(
    'Lyric editor: timeline alignment, lossless edits, replacement, undo/redo and atomic storage passed.'
  )
} finally {
  database.close()
  delete globalThis.lyricEditorDb
  delete globalThis.DOMParser
  await rm(directory, { recursive: true, force: true })
}
