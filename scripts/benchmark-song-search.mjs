/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve, join, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { cpus } from 'node:os'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
if (!process.versions.electron) {
  const child = spawnSync(
    require('electron'),
    [resolve('scripts/benchmark-song-search.mjs'), ...process.argv.slice(2)],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'inherit'
    }
  )
  if (child.error) throw child.error
  process.exit(child.status ?? 1)
}
const cacheRoot = resolve('node_modules/.cache')
mkdirSync(cacheRoot, { recursive: true })
const directory = mkdtempSync(join(cacheRoot, 'search-benchmark-'))
const argument = (name, fallback) =>
  process.argv
    .find((value) => value.startsWith(`--${name}=`))
    ?.split('=')
    .slice(1)
    .join('=') ?? fallback
const sizes = argument('sizes', '2500,10000').split(',').map(Number)
if (
  sizes.some(
    (size, index) => !Number.isInteger(size) || size < 1 || (index && size <= sizes[index - 1])
  )
)
  throw new Error('Sizes must be increasing positive integers')
const output = resolve(argument('output', 'docs/song-search-performance.json'))
const baseline = argument('baseline', '')
let db
let service
const lag = monitorEventLoopDelay({ resolution: 10 })
const result = {
  environment: {
    cpu: cpus()[0]?.model,
    electron: process.versions.electron,
    node: process.versions.node,
    timestamp: new Date().toISOString()
  },
  datasets: []
}
result.method =
  'Seven samples per query; invalidate match cache before each timed sample using a no-op play-count update; query and JSON serialization included.'
try {
  const mocks = [
    [
      /src[\\/]main[\\/]database[\\/]index\.ts$/,
      'export const getDatabase=()=>globalThis.__benchmarkDb'
    ],
    [
      /src[\\/]main[\\/]service[\\/]loggerService\.ts$/,
      'export const Logger={debug(){},info(){},warn(){},error(){}}'
    ],
    [
      /src[\\/]main[\\/]service[\\/]playbackMode\.ts$/,
      'export const isPlaybackOnly=()=>false; export const onPlaybackModeChanged=()=>()=>{}'
    ],
    [/src[\\/]main[\\/]i18n[\\/]index\.ts$/, 'export const t=(key)=>key'],
    [
      /src[\\/]main[\\/]database[\\/]recommendations\.ts$/,
      'export const getDailyRecommendationGroups=()=>[]; export const getRecentDiscoveryGroups=()=>[]; export const invalidateDailyRecommendations=()=>{}'
    ],
    [/src[\\/]main[\\/]utils[\\/]pathUtils\.ts$/, 'export const getDataPath=()=>"."']
  ]
  const options = {
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    packages: 'external'
  }
  const runtimeOptions = {
    ...options,
    stdin: {
      resolveDir: process.cwd(),
      contents: `
    export * from './src/main/database/schema'; export * from './src/main/search/schema';
    export * from './src/main/search/searchTokens'; export * from './src/main/search/searchIndexService';
    export * as repository from './src/main/database/repository';
  `
    },
    plugins: [
      {
        name: 'isolated-app-services',
        setup(buildContext) {
          for (const [filter, contents] of mocks)
            buildContext.onLoad({ filter }, () => ({ contents, loader: 'ts' }))
        }
      }
    ],
    outfile: join(directory, 'runtime.cjs')
  }
  await build(runtimeOptions)
  let legacy
  if (baseline) {
    const legacySource =
      readFileSync(resolve(baseline), 'utf8').replace(
        'export function buildSongSearchFilter(',
        'function legacySongSearchFilter('
      ) +
      '\nexport function buildSongSearchFilter(_db,search,alias){return legacySongSearchFilter(search,alias)}'
    await build({
      ...runtimeOptions,
      outfile: join(directory, 'baseline.cjs'),
      plugins: [
        {
          name: 'previous-query',
          setup(context) {
            context.onLoad({ filter: /src[\\/]main[\\/]search[\\/]searchQuery\.ts$/ }, () => ({
              contents: legacySource,
              loader: 'ts',
              resolveDir: resolve('src/main/search')
            }))
          }
        },
        ...runtimeOptions.plugins
      ]
    })
    legacy = require(join(directory, 'baseline.cjs'))
  }
  await build({
    ...options,
    entryPoints: ['src/main/search/searchWorker.ts'],
    outfile: join(directory, 'searchWorker.js')
  })
  const runtime = require(join(directory, 'runtime.cjs'))
  const Database = require('better-sqlite3')
  const databasePath = join(directory, 'benchmark.db')
  db = new Database(databasePath)
  db.pragma('foreign_keys=ON')
  db.pragma('journal_mode=WAL')
  db.function('search_normalize', { deterministic: true }, runtime.normalizeSearchText)
  for (const schema of [
    runtime.schemaV1,
    runtime.schemaV2,
    runtime.schemaV3,
    runtime.schemaV4,
    runtime.schemaV5.addSongPreference,
    runtime.searchSchemaV6,
    runtime.searchSchemaV7
  ])
    db.exec(schema)
  db.exec(
    "INSERT INTO folder(id,name,full_path,is_root_path,import_time) VALUES(1,'Benchmark','benchmark',1,'2026-10-16')"
  )
  globalThis.__benchmarkDb = db
  const chinese = [
    '七里香',
    '晴天',
    '稻香',
    '夜曲',
    '青花瓷',
    '一路向北',
    '后来',
    '童话',
    '海阔天空',
    '旅行的意义'
  ]
  const japanese = [
    '月が綺麗ねと言われたい！',
    '君が好き',
    '夜に駆ける',
    'さくら',
    '星の海',
    'ありがとう',
    '風になる',
    '夢のつづき',
    '雨のあと',
    'きみの声'
  ]
  const english = [
    'Northern Lights',
    'Love Story',
    'Morning Rain',
    'A Quiet Place',
    'Blue Sky',
    'Sunrise',
    'The River',
    'Summer Night',
    'Home Again',
    'Far Away'
  ]
  const insert = db.prepare(
    'INSERT INTO song(id,title,artist,album,audio,folder_id,file_name,genre) VALUES(?,?,?,?,?,1,?,?)'
  )
  function addRange(start, end) {
    db.transaction(() => {
      for (let id = start; id <= end; id++) {
        const group = id % 10
        const offset = Math.floor(id / 10) % 10
        const title = `${(group < 4 ? chinese : group < 8 ? japanese : english)[offset]} ${String(id).padStart(5, '0')}`
        const artist = group < 4 ? '周杰伦' : group < 8 ? '柿崎ユウタ' : 'The Northern Band'
        const album = `${group < 4 ? '精选专辑' : group < 8 ? '夜のアルバム' : 'Collected Songs'} ${Math.floor(id / 12)}`
        insert.run(
          id,
          title,
          artist,
          album,
          `benchmark://${id}`,
          `${artist} - ${title}`,
          group < 8 ? 'Pop' : 'Rock'
        )
      }
    })()
  }
  let drain
  let lastPrinted = -1
  service = runtime.startSearchIndexService(
    db,
    () => {},
    (status) => {
      const bucket = Math.floor(status.completed / 1000)
      if (bucket !== lastPrinted || status.phase === 'ready') {
        lastPrinted = bucket
        process.stdout.write(`Index ${status.completed}/${status.total}: ${status.phase}\n`)
      }
      if (status.phase === 'ready') drain?.()
      if (status.phase === 'error' || status.phase === 'retrying')
        throw new Error('Benchmark index preparation failed')
    }
  )
  let cumulativeIndexMs = 0
  let previousSize = 0
  for (const size of sizes) {
    const start = previousSize + 1
    addRange(start, size)
    lag.enable()
    lag.reset()
    const indexStart = performance.now()
    await new Promise((resolveDrain, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Index benchmark exceeded five minutes')),
        300_000
      )
      drain = () => {
        clearTimeout(timeout)
        resolveDrain()
      }
    })
    drain = undefined
    const indexMs = performance.now() - indexStart
    cumulativeIndexMs += indexMs
    const indexLag = {
      p99Ms: +(lag.percentile(99) / 1e6).toFixed(1),
      maxMs: +(lag.max / 1e6).toFixed(1)
    }
    lag.disable()
    const queries = []
    for (const keyword of ['qili', 'qlx zjl', 'kirei', '夜', '周杰伦', 'unmatched', '']) {
      const entry = { keyword }
      for (const [mode, sizeOption] of [
        ['page50', 50],
        ['currentUI', undefined]
      ]) {
        const samples = []
        const legacySamples = []
        let count = 0
        let payloadBytes = 0
        for (let i = 0; i < 7; i++) {
          db.prepare('UPDATE song SET play_times=play_times WHERE id=1').run()
          const began = performance.now()
          const response = runtime.repository.querySongs({ search: keyword, size: sizeOption })
          const json = JSON.stringify(response)
          samples.push(performance.now() - began)
          count = response.total
          payloadBytes = Buffer.byteLength(json)
          if (legacy) {
            const legacyStart = performance.now()
            const previous = legacy.repository.querySongs({ search: keyword, size: sizeOption })
            JSON.stringify(previous)
            legacySamples.push(performance.now() - legacyStart)
            if (
              previous.total !== response.total ||
              previous.data.map((song) => `${song.id}:${song.searchScore}`).join(',') !==
                response.data.map((song) => `${song.id}:${song.searchScore}`).join(',')
            )
              throw new Error(`Query results or order changed: ${keyword}`)
          }
        }
        samples.sort((a, b) => a - b)
        entry[mode] = {
          matches: count,
          medianMs: +samples[3].toFixed(1),
          maxMs: +samples[6].toFixed(1),
          payloadKiB: +(payloadBytes / 1024).toFixed(1)
        }
        if (legacy) {
          legacySamples.sort((a, b) => a - b)
          entry.baseline ??= {}
          entry.baseline[mode] = {
            medianMs: +legacySamples[3].toFixed(1),
            maxMs: +legacySamples[6].toFixed(1)
          }
        }
      }
      queries.push(entry)
      process.stdout.write(`${size} ${keyword}: ${JSON.stringify(entry)}\n`)
    }
    db.pragma('wal_checkpoint(TRUNCATE)')
    result.datasets.push({
      songs: size,
      composition:
        '40% Chinese, 40% Japanese, 20% English; unique numbered titles, shared artists/albums',
      newSongs: size - start + 1,
      indexStageMs: Math.round(indexMs),
      cumulativeIndexMs: Math.round(cumulativeIndexMs),
      mainLoopDuringIndex: indexLag,
      processRssMiB: +(process.memoryUsage().rss / 1024 / 1024).toFixed(1),
      databaseMiB: +(statSync(databasePath).size / 1024 / 1024).toFixed(1),
      queries
    })
    previousSize = size
  }
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
  process.stdout.write(`Benchmark report: ${output}\n`)
} finally {
  lag.disable()
  service?.stop()
  db?.close()
  delete globalThis.__benchmarkDb
  // Only this invocation's freshly created fixture directory may be removed.
  if (directory.startsWith(cacheRoot + sep)) rmSync(directory, { recursive: true, force: true })
}
