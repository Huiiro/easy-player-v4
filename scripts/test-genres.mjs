/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import vm from 'node:vm'
import ts from 'typescript'
import { build } from 'esbuild'
import { parseFile } from 'music-metadata'

const require = createRequire(import.meta.url)
if (!process.versions.electron) {
  const result = spawnSync(require('electron'), [resolve('scripts/test-genres.mjs')], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit'
  })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}

function load(file, mocks = {}, globals = {}) {
  const exports = {}
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true
      }
    }).outputText,
    { exports, Error, Buffer, require: (name) => mocks[name] ?? require(name), ...globals }
  )
  return exports
}
const plain = (value) => JSON.parse(JSON.stringify(value))
const values = load('src/shared/metadataValues.ts')
const separators = values.DEFAULT_GENRE_SEPARATOR
assert.deepEqual(
  plain(values.splitMetadataValues(' Pop / Rock；Jazz;Pop、Metal, Soul，R&B ', separators)),
  ['Pop', 'Rock', 'Jazz', 'Metal', 'Soul', 'R&B']
)
assert.deepEqual(plain(values.splitMetadataValues('Pop/Rock', '')), ['Pop/Rock'])
assert.deepEqual(plain(values.splitMetadataValues(' / ；, ', separators)), [])
assert.equal(values.joinMetadataValues([' Pop ', 'Jazz', 'Pop', '']), 'Pop, Jazz')
assert.deepEqual(plain(values.splitGenres('POP; Pop / pop, R&B; r&b', separators)), ['POP', 'R&B'])
assert.equal(values.genreMatchKey('  POP  '), 'pop')
assert.equal(values.genreMatchKey('E\u0301LECTRO'), values.genreMatchKey('électro'))
const format = load('src/renderer/src/utils/genres.ts', {
  '../../../shared/metadataValues': values
}).formatGenres
assert.equal(format('Pop;Jazz', separators, true), 'Pop / Jazz')
assert.equal(format('Pop;Jazz', separators, false), 'Pop;Jazz')
assert.equal(format('POP;Pop;pop/Jazz', separators, true), 'POP / Jazz')
assert.equal(format('POP;Pop;pop/Jazz', separators, false), 'POP;Pop;pop/Jazz')
const artists = load('src/renderer/src/utils/artists.ts', {
  '../../../shared/metadataValues': values
})
const artistText = 'Singer A;;/ Singer B;Singer A'
assert.equal(artists.formatArtists(artistText, ';/', true), 'Singer A / Singer B')
assert.equal(
  artists
    .artistDisplayTokens(artistText, ';/', true)
    .map((token) => token.text)
    .join(''),
  artists.formatArtists(artistText, ';/', true),
  'clickable artist labels and plain text use the same normalized separator rules'
)
assert.equal(artists.formatArtists(artistText, ';/', false), artistText)

mkdirSync(resolve('node_modules/.cache'), { recursive: true })
const directory = mkdtempSync(resolve('node_modules/.cache/genres-'))
const Database = require('better-sqlite3')
const db = new Database(':memory:')
globalThis.__genreTestDb = db
try {
  await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
      export * from './src/main/database/repository/catalog';
      export * from './src/main/database/schema';
      export * from './src/main/search/schema';
      export * from './src/main/search/searchTokens';
    `
    },
    outfile: join(directory, 'catalog.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    plugins: [
      {
        name: 'isolated-database',
        setup(build) {
          build.onResolve({ filter: /^\.\./ }, (args) =>
            resolve(args.resolveDir, args.path) === resolve('src/main/database/index')
              ? { path: 'database', namespace: 'genre-test' }
              : undefined
          )
          build.onLoad({ filter: /.*/, namespace: 'genre-test' }, () => ({
            contents: 'export const getDatabase=()=>globalThis.__genreTestDb'
          }))
        }
      }
    ]
  })
  const catalog = require(join(directory, 'catalog.cjs'))
  db.function('search_normalize', { deterministic: true }, catalog.normalizeSearchText)
  db.exec(catalog.schemaV1)
  db.exec(catalog.searchSchema)
  db.exec(
    "INSERT INTO folder(id,name,full_path,is_root_path,import_time) VALUES(1,'Music','D:/Music',1,'2026-10-24')"
  )
  const genres = [
    'Pop/Rock;Pop',
    'Jazz，Rock',
    null,
    '',
    ' ; , ',
    'Rockabilly',
    'Pop/Rock',
    'unknown_genre'
  ]
  const insert = db.prepare('INSERT INTO song(id,title,audio,genre,folder_id) VALUES(?,?,?,?,1)')
  genres.forEach((genre, index) =>
    insert.run(index + 1, `Track ${index + 1}`, `file-${index + 1}.mp3`, genre)
  )
  const counts = Object.fromEntries(
    catalog.queryGenres('asc', '', separators).map(({ name, count }) => [name, count])
  )
  assert.equal(counts.Pop, 2, 'repeated genre counts a song once')
  assert.equal(counts.Rock, 3)
  assert.equal(
    counts.__easy_player_unknown_genre__,
    3,
    'null, blank and separator-only share one group'
  )
  assert.equal(counts.unknown_genre, 1, 'literal legacy marker is a valid genre')
  assert.deepEqual(
    catalog.getSongsByGenre('Rock', '', separators).map((song) => song.id),
    [7, 2, 1]
  )
  assert.deepEqual(
    catalog.getSongsByGenre('Rock', 'Track 2', separators).map((song) => song.id),
    [2]
  )
  assert.deepEqual(
    catalog.getSongsByGenre('__easy_player_unknown_genre__', '', separators).map((song) => song.id),
    [5, 4, 3]
  )
  assert.deepEqual(
    catalog.getSongsByGenre('Pop/Rock', '', '').map((song) => song.id),
    [7]
  )
  assert.equal(catalog.queryGenres('asc', 'roc', separators).length, 2)
  assert.deepEqual(
    catalog.queryGenres('desc', '', separators).map((item) => item.name),
    catalog
      .queryGenres('asc', '', separators)
      .map((item) => item.name)
      .reverse()
  )
  assert.equal(catalog.getSongsByGenre('unknown_genre', '', separators)[0].id, 8)

  db.exec('SAVEPOINT genre_case_matching')
  for (const [id, genre] of [
    [9, 'POP'],
    [10, 'pop'],
    [11, ' POP ; pop ;PoP / rock'],
    [12, 'Électro ; e\u0301LECTRO'],
    [13, 'électro'],
    [14, 'Electro'],
    [15, ' pOP/rOCK ']
  ])
    insert.run(id, `Track ${id}`, `file-${id}.mp3`, genre)
  assert.deepEqual(
    catalog.queryGenres('asc', '  pOP ', separators),
    [{ name: 'Pop', count: 6 }],
    'case variants form one group with the earliest spelling and one count per song'
  )
  for (const name of ['POP', 'Pop', 'pop', '  pOp  ']) {
    assert.deepEqual(
      catalog.getSongsByGenre(name, '', separators).map((song) => song.id),
      [15, 11, 10, 9, 7, 1],
      'new and saved detail links match every casing'
    )
  }
  assert.deepEqual(
    catalog.getSongsByGenre('pOP', 'Track 9', separators).map((song) => song.id),
    [9]
  )
  assert.deepEqual(
    catalog.getSongsByGenre(' ÉLECTRO ', '', separators).map((song) => song.id),
    [13, 12]
  )
  assert.deepEqual(
    catalog.queryGenres('asc', 'e\u0301LECTRO', separators),
    [{ name: 'Électro', count: 2 }],
    'canonical Unicode forms match without dropping accents'
  )
  assert.equal(catalog.getSongsByGenre('Electro', '', separators)[0].id, 14)
  assert.deepEqual(
    catalog.getSongsByGenre('pOP/rOCK', '', '').map((song) => song.id),
    [15, 7],
    'case matching also works with splitting disabled'
  )
  assert.equal(
    catalog.queryGenres('asc', 'pop/rock', '').find((item) => item.name === 'Pop/Rock').count,
    2
  )
  assert.ok(
    !catalog.getSongsByGenre('rOCK', '', separators).some((song) => song.id === 6),
    'matching retains full genre boundaries'
  )
  assert.equal(
    db.prepare('SELECT genre FROM song WHERE id=9').get().genre,
    'POP',
    'matching leaves original tags in the database intact'
  )
  db.exec('ROLLBACK TO genre_case_matching; RELEASE genre_case_matching')

  const calls = []
  const api = {
    database: {
      command: async (name, params) => {
        calls.push([name, params])
        if (name === 'queryGenres')
          return {
            success: true,
            data: catalog.queryGenres(params.sort, params.search, params.separator)
          }
        return {
          success: true,
          data: catalog.getSongsByGenre(params.genre, params.search, params.separator)
        }
      }
    }
  }
  const browser = load('src/renderer/src/services/libraryBrowser.ts', {}, { window: { api } })
  const items = await browser.queryLibraryItems('genre', 'asc', '', separators, '未知')
  assert.equal(items.find((item) => item.value === '__easy_player_unknown_genre__').name, '未知')
  assert.equal(items.find((item) => item.value === 'unknown_genre').name, 'unknown_genre')
  const query = load('src/renderer/src/services/songListQuery.ts', {}, { window: { api } })
  const songs = await query.querySongList({
    source: { type: 'genre', genre: 'rOcK' },
    search: 'Track 2',
    tags: [],
    sourceFilter: 'all',
    artistSeparator: '/',
    genreSeparator: separators,
    statistics: { enabled: false, generation: '1' }
  })
  assert.equal(songs[0].id, 2)
  assert.equal(calls.at(-1)[1].separator, separators)

  const logger = { Logger: { warn() {}, debug() {}, error() {} } }
  const operations = {
    logOperation: (_name, _params, action) => action(),
    logError: String,
    logParams: (value) => value,
    logUrl: (value) => value
  }
  const mp3 = load('src/main/service/mp3MetadataService.ts', { '../i18n': { t: (key) => key } })
  let parsed = { common: { genre: ['Pop', 'Jazz'], track: {}, disk: {} }, format: {}, native: {} }
  let nativeWriter = () => true
  const metadata = load('src/main/service/metadataService.ts', {
    './audioMetadataService': { parseAudioFile: async () => parsed },
    './mp3MetadataService': mp3,
    '../audioEngine': { writeNativeMetadata: (...args) => nativeWriter(...args) },
    '../../shared/metadataValues': values,
    './loggerService': logger,
    './operationLogger': operations
  })
  assert.equal(
    (await metadata.readMetadata('test.flac')).genre,
    'Pop, Jazz',
    'read all native genre values'
  )
  parsed.common.genre = []
  assert.equal((await metadata.readMetadata('test.flac')).genre, undefined)
  nativeWriter = () => assert.fail('raw AAC must be rejected before rewriting')
  assert.equal(await metadata.writeMetadata('test.aac', 'AAC', { genre: 'Pop' }), false)

  const handlers = new Map()
  const ipc = load('src/main/ipc/metadataIpcHandlers.ts', {
    '../i18n': { t: (key) => key },
    electron: { ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, dialog: {} },
    'node:fs': { existsSync: () => true },
    '../service/metadataService': {
      writeMetadata: async () => true,
      readMetadata: async () => ({})
    },
    '../database/repository': {
      getSong: () => ({ audio: 'test.mp3', genre: 'Pop', sourceId: null })
    },
    '../database': { getDatabase: () => db },
    '../utils/pathUtils': {},
    '../service/loggerService': logger,
    '../service/operationLogger': operations,
    '@neteasecloudmusicapienhanced/api': {}
  })
  ipc.registerMetadataIpcHandlers()
  assert.equal(
    (await handlers.get('metadata:write')({}, { songId: 1, metadata: { genre: '' } })).success,
    true
  )
  assert.equal(
    db.prepare('SELECT genre FROM song WHERE id=1').get().genre,
    null,
    'cleared file genre clears the database'
  )
  console.log(
    'Genre splitting, case-insensitive grouping/counts/details/search, Unicode equivalence, unknown groups, renderer queries, complete reads and clear synchronization passed'
  )

  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0) {
    const addon = require(resolve('build/native-addon/easy_player_native.node'))
    nativeWriter = addon.writeMetadata
    for (const [extension, codec, type] of [
      ['mp3', 'libmp3lame', 'MPEG'],
      ['flac', 'flac', 'FLAC'],
      ['m4a', 'aac', 'M4A']
    ]) {
      const file = join(directory, `多流派.${extension}`)
      const result = spawnSync(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'anullsrc=r=44100:cl=mono',
          '-t',
          '0.1',
          '-c:a',
          codec,
          '-metadata',
          'genre=Pop',
          '-metadata',
          'title=Keep title',
          ...(extension === 'mp3' ? ['-write_id3v1', '1'] : []),
          '-y',
          file
        ],
        { encoding: 'utf8' }
      )
      assert.equal(result.status, 0, result.stderr)
      const actual = load('src/main/service/metadataService.ts', {
        './audioMetadataService': { parseAudioFile: parseFile },
        './mp3MetadataService': mp3,
        '../audioEngine': { writeNativeMetadata: addon.writeMetadata },
        '../../shared/metadataValues': values,
        './loggerService': logger,
        './operationLogger': operations
      })
      if (extension === 'flac') {
        // Real repeated Vorbis GENRE tags, rather than a single joined text tag.
        const buffer = readFileSync(file)
        let offset = 4
        while ((buffer[offset] & 0x7f) !== 4) offset += 4 + buffer.readUIntBE(offset + 1, 3)
        const length = buffer.readUIntBE(offset + 1, 3)
        const body = buffer.subarray(offset + 4, offset + 4 + length)
        const vendorLength = body.readUInt32LE(0)
        const countOffset = 4 + vendorLength
        const extra = Buffer.from('GENRE=Jazz')
        const entry = Buffer.alloc(4)
        entry.writeUInt32LE(extra.length)
        const replacement = Buffer.concat([body, entry, extra])
        replacement.writeUInt32LE(body.readUInt32LE(countOffset) + 1, countOffset)
        const header = Buffer.from(buffer.subarray(offset, offset + 4))
        header.writeUIntBE(replacement.length, 1, 3)
        writeFileSync(
          file,
          Buffer.concat([
            buffer.subarray(0, offset),
            header,
            replacement,
            buffer.subarray(offset + 4 + length)
          ])
        )
        assert.equal((await actual.readMetadata(file)).genre, 'Pop, Jazz')
        assert.equal(await actual.writeMetadata(file, type, { title: 'Keep title' }), true)
        assert.deepEqual(
          plain(values.splitMetadataValues((await actual.readMetadata(file)).genre, separators)),
          ['Pop', 'Jazz'],
          'unrelated edits retain every existing genre'
        )
      }
      assert.equal(await actual.writeMetadata(file, type, { genre: '摇滚; Jazz / R&B' }), true)
      const read = await actual.readMetadata(file)
      assert.deepEqual(plain(values.splitMetadataValues(read.genre, separators)), [
        '摇滚',
        'Jazz',
        'R&B'
      ])
      assert.equal(read.title, 'Keep title')
      assert.equal(await actual.writeMetadata(file, type, { genre: '' }), true)
      assert.equal(
        (await actual.readMetadata(file)).genre,
        undefined,
        `${extension}: empty genres stay cleared`
      )
      console.log(
        `${extension}: real audio multi-genre write/read, unrelated title preservation and clear passed`
      )
    }
  } else console.log('Real audio round-trip skipped: ffmpeg is not installed')
} finally {
  delete globalThis.__genreTestDb
  db.close()
  rmSync(directory, { recursive: true, force: true })
}
