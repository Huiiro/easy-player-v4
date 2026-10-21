/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { parseBuffer } from 'music-metadata'

const require = createRequire(import.meta.url)
const root = path.resolve('test-music')
const durations = [0, 4.999, 5, 5.001, undefined]
const files = durations.map((_, index) => path.join(root, `${index}.mp3`))
let imported = []
let covers = 0
const mocks = {
  '../i18n': { t: (key) => key },
  './playbackMode': { waitForBackgroundWork: async () => {} },
  './operationLogger': { logOperation: (_name, _context, action) => action(), logError: String },
  './loggerService': { Logger: { debug() {}, warn() {} } },
  '../utils/pathUtils': { getDataPath: () => root },
  '../database/newestSongs': { refreshNewestSongs() {} },
  '../database': {
    getDatabase: () => ({
      prepare: (sql) => ({
        get: () => (sql.includes('FROM folder') ? { id: 1 } : undefined),
        run: (song) => {
          assert.ok(sql.includes('INSERT OR IGNORE INTO song'))
          imported.push(song.audio)
          return { changes: 1 }
        }
      })
    })
  },
  'node:fs': {
    promises: {
      stat: async () => ({ isDirectory: () => true, size: 100 }),
      readdir: async () =>
        files.map((file) => ({
          name: path.basename(file),
          isFile: () => true,
          isDirectory: () => false
        })),
      mkdir: async () => {},
      writeFile: async () => {
        covers++
      }
    }
  },
  './audioMetadataService': {
    parseAudioFile: async (file) => ({
      common: { track: {}, disk: {}, picture: [{ data: new Uint8Array() }] },
      format: { duration: durations[files.indexOf(file)] }
    })
  }
}
const exports = {}
vm.runInNewContext(
  ts.transpileModule(readFileSync('src/main/service/scanService.ts', 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  }).outputText,
  { exports, require: (name) => mocks[name] ?? require(name) }
)
const progress = []
const result = await exports.scanMusicDirectory(root, (...args) => progress.push(args))
assert.deepEqual(imported, files.slice(2), 'Default scan retains 5s, longer and unknown durations')
assert.equal(covers, 3, 'Skipped songs must not create cover files')
assert.equal(result.added, 3)
assert.equal(result.duplicates, 0)
assert.equal(result.skipped, 2)
assert.deepEqual(progress.at(-1), [5, 5, 3, 0], 'Skipped songs still advance scan progress')

imported = []
covers = 0
await exports.scanMusicDirectory(root, undefined, undefined, false)
assert.deepEqual(imported, files, 'Disabling the switch imports short songs')

imported = []
const filteredSingle = await exports.scanMusicDirectory(root, undefined, [files[1]])
assert.deepEqual(imported, [], 'Single-song imports must honor the short-song filter')
assert.equal(filteredSingle.skipped, 1)
await exports.scanMusicDirectory(root, undefined, [files[1]], false)
assert.deepEqual(imported, [files[1]], 'Disabling the filter allows short single-song imports')
console.log('Short-song scan tests passed')

// IR files are commonly PCM or IEEE float WAV. Test real metadata parsing at subsecond durations.
function wav(seconds, float) {
  const sampleRate = 48000
  const bytesPerSample = float ? 4 : 2
  const dataSize = Math.round(seconds * sampleRate) * bytesPerSample
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF')
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(float ? 3 : 1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28)
  buffer.writeUInt16LE(bytesPerSample, 32)
  buffer.writeUInt16LE(bytesPerSample * 8, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  return buffer
}
const wavDurations = [0.01, 0.5, 1, 4.999, 5]
for (const float of [false, true]) {
  mocks['./audioMetadataService'].parseAudioFile = (file, options) => {
    assert.equal(options.duration, true)
    return parseBuffer(
      wav(wavDurations[files.indexOf(file)], float),
      { mimeType: 'audio/wav' },
      options
    )
  }
  imported = []
  const wavResult = await exports.scanMusicDirectory(root)
  assert.deepEqual(imported, [files[4]], 'Short PCM and float WAV IR files must be skipped')
  assert.equal(wavResult.skipped, 4)
  imported = []
  await exports.scanMusicDirectory(root, undefined, undefined, false)
  assert.deepEqual(imported, files, 'Disabling the filter allows WAV IR files')
}
console.log('PCM and float WAV duration tests passed')

// Exercise the single-file picker and ensure it never starts a directory-wide scan.
const handlers = new Map()
let selection = { canceled: true, filePaths: [] }
let parentWindow = {}
let dialogArgs
const scanCalls = []
const ipcExports = {}
const ipcMocks = {
  '../i18n': mocks['../i18n'],
  '../service/operationLogger': mocks['./operationLogger'],
  electron: {
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    BrowserWindow: { fromWebContents: () => parentWindow },
    dialog: {
      showOpenDialog: async (...args) => {
        dialogArgs = args
        return selection
      }
    }
  },
  '../service/scanService': {
    SUPPORTED_EXTENSIONS: exports.SUPPORTED_EXTENSIONS,
    scanMusicDirectory: async (...args) => {
      scanCalls.push(args)
      return exports.scanMusicDirectory(...args)
    }
  }
}
vm.runInNewContext(
  ts.transpileModule(readFileSync('src/main/ipc/scanIpcHandlers.ts', 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  }).outputText,
  { exports: ipcExports, require: (name) => ipcMocks[name] ?? require(name) }
)
ipcExports.registerScanIpcHandlers()
const importFile = handlers.get(ipcExports.IMPORT_LOCAL_MUSIC_FILE_CHANNEL)
assert.equal(await importFile({ sender: {} }), null)
assert.equal(scanCalls.length, 0, 'Canceling the picker must not scan')
selection = { canceled: false, filePaths: [files[1]] }
const singleResult = await importFile({ sender: {} })
assert.equal(dialogArgs[0], parentWindow)
const options = dialogArgs[1]
assert.deepEqual(Array.from(options.properties), ['openFile'])
assert.deepEqual(
  Array.from(options.filters[0].extensions),
  Array.from(exports.SUPPORTED_EXTENSIONS, (ext) => ext.slice(1))
)
assert.equal(scanCalls[0][0], root)
assert.equal(scanCalls[0][1], undefined)
assert.deepEqual(Array.from(scanCalls[0][2]), [files[1]])
assert.equal(scanCalls[0][3], true)
assert.equal(singleResult.result.added, 0)
assert.equal(singleResult.result.skipped, 1)
const unfilteredResult = await importFile({ sender: {} }, false)
assert.equal(scanCalls[1][3], false)
assert.equal(unfilteredResult.result.added, 1)
assert.equal(unfilteredResult.result.skipped, 0)
parentWindow = null
selection = { canceled: false, filePaths: [] }
assert.equal(await importFile({ sender: {} }), null)
assert.equal(dialogArgs.length, 1, 'Picker works without a parent window')
assert.equal(scanCalls.length, 2, 'Empty selections must not scan')
console.log('Single-song import tests passed')
