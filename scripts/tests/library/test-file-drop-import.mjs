/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function load(file, mocks = {}, globals = {}) {
  const exports = {}
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
        target: ts.ScriptTarget.ES2022
      }
    }).outputText,
    {
      exports,
      Error,
      ...globals,
      require: (name) =>
        mocks[name] ??
        (name.startsWith('.')
          ? load(path.resolve(path.dirname(file), name + '.ts'), mocks, globals)
          : require(name))
    },
    { filename: file }
  )
  return exports
}
const formats = load('src/shared/audioFormats.ts')
for (const extension of formats.SUPPORTED_AUDIO_EXTENSIONS)
  assert.equal(formats.importFileKind('track' + extension.toUpperCase()), 'audio')
assert.equal(formats.importFileKind('theme.EPP'), 'plugin')
assert.equal(formats.importFileKind('backup.EPB'), 'backup')
assert.equal(formats.importFileKind('unknown.mp3.exe'), null)

const handlers = new Map(),
  calls = [],
  trackedDirectories = [],
  changes = [],
  messages = [],
  listeners = new Map()
let mount, unmount, releaseAudio
let pauseAudio = true
const ui = { ignoreShortSongs: true }
const sender = { isDestroyed: () => false, send: (channel) => changes.push(channel) }
const event = { sender }
const dropMessages = load('src/renderer/src/i18n/locales/zh.ts').default.dropImport
const t = (key, args) => {
  const message = key.startsWith('dropImport.') ? dropMessages[key.slice(11)] : undefined
  return message?.replace(/\{(\w+)\}/g, (_match, name) => String(args?.[name])) ?? key
}
const mocks = {
  electron: {
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), on() {} },
    BrowserWindow: { fromWebContents: () => null, getAllWindows: () => [] },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }
  },
  '../i18n': { t },
  '../service/operationLogger': { logOperation: (_name, _args, run) => run() },
  '../service/libraryAutoImport': {
    trackMusicDirectory: (directory) => trackedDirectories.push(directory)
  },
  '../service/applicationShutdown': { isApplicationShuttingDown: () => false },
  '../service/scanService': {
    SUPPORTED_EXTENSIONS: formats.SUPPORTED_AUDIO_EXTENSIONS,
    async scanMusicDirectory(directory, _callback, files, ignoreShortSongs) {
      if (files === undefined) {
        calls.push({ kind: 'folder', directory, ignoreShortSongs })
        if (path.basename(directory) === 'unreadable') throw Error('Folder inaccessible')
        const count = path.basename(directory) === 'empty' ? 0 : 2
        _callback?.(count, count, count, 0)
        return { added: count, duplicates: 0, skipped: 0, total: count }
      }
      calls.push({ kind: 'audio', directory, files: Array.from(files), ignoreShortSongs })
      if (pauseAudio) {
        pauseAudio = false
        await new Promise((resolve) => {
          releaseAudio = resolve
        })
      }
      const duplicates = files.filter((file) => path.basename(file) === 'duplicate.mp3').length
      const skipped = ignoreShortSongs
        ? files.filter((file) => path.basename(file) === 'short.wav').length
        : 0
      const failed = files.filter((file) => path.basename(file) === 'invalid.wav').length
      return {
        added: files.length - duplicates - skipped - failed,
        duplicates,
        skipped,
        total: files.length
      }
    }
  },
  '../plugins/proxy': {},
  '../service/loggerService': {},
  '../plugins/management': {
    initializePlugins() {},
    async importManagedPlugin(file) {
      calls.push({ kind: 'plugin', file })
      if (file.endsWith('bad.epp')) throw Error('pluginPackageInvalid')
    }
  },
  '../utils/pathUtils': {},
  '../service/fileService': {
    async importLibrary(file, progress) {
      calls.push({ kind: 'backup', file })
      progress(1, 1)
      return { added: 1, skipped: 0 }
    }
  }
}
for (const file of ['scanIpcHandlers', 'pluginIpcHandlers', 'fileIpcHandlers']) {
  const module = load('src/main/ipc/' + file + '.ts', mocks)
  module[Object.keys(module).find((key) => key.startsWith('register'))]()
}
const invoke = (channel, ...args) => handlers.get(channel)(event, ...args)
const document = {
  addEventListener(type, callback, capture) {
    assert.equal(capture, true)
    listeners.set(type, callback)
  },
  removeEventListener(type, callback, capture) {
    assert.equal(capture, true)
    assert.equal(listeners.get(type), callback)
    listeners.delete(type)
  }
}
const api = {
  audio: { getFilePath: (file) => file.path },
  library: {
    importLocalMusicFiles: (files, ignore) => invoke('library:import-local-files', files, ignore),
    scanLocalMusicFolder: (directory, ignore) =>
      invoke('library:scan-local-folder', directory, ignore)
  },
  plugins: { importPackage: (file) => invoke('plugins:import', file) },
  files: { importLibrary: (file) => invoke('files:import-library', file) }
}
const hook = load(
  'src/renderer/src/hooks/useFileDropImport.ts',
  {
    vue: {
      onMounted: (callback) => {
        mount = callback
      },
      onBeforeUnmount: (callback) => {
        unmount = callback
      }
    },
    'vue-i18n': { useI18n: () => ({ t }) },
    '@/stores/ui/uiStore': { useUIStore: () => ui },
    '@/utils/eventBus': { emit: (name) => changes.push(name) },
    '@/components/ui/useMessage': {
      useMessage: () =>
        Object.fromEntries(
          ['success', 'warning', 'info', 'error'].map((kind) => [
            kind,
            (message) => messages.push({ kind, message })
          ])
        )
    }
  },
  { document, window: { api } }
)
hook.useFileDropImport()
mount()
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve))
}
function drop(names, types = ['Files'], directories = []) {
  const files = names.map((name) => ({ name, path: path.resolve('build/drop-fixture', name) }))
  const event = {
    dataTransfer: {
      types,
      files,
      items: files.map((file) => ({
        kind: 'file',
        getAsFile: () => file,
        webkitGetAsEntry: () => ({ isDirectory: directories.includes(file.name) })
      }))
    },
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true
    },
    stopPropagation() {
      this.stopped = true
    }
  }
  listeners.get('drop')(event)
  return event
}
const internal = drop([], ['text/plain'])
assert.equal(internal.prevented, false, 'Internal sorting remains untouched')
const external = drop([
  'track.MP3',
  'track.MP3',
  'theme.EPP',
  'backup.EPB',
  'bad.epp',
  'good.epp',
  'notes.txt'
])
assert(external.prevented && external.stopped, 'External drop is handled before nested targets')
const next = drop(['next.FLAC'])
await flush()
assert.equal(calls.length, 1, 'Concurrent drops wait for the current batch')
assert.equal(messages.length, 0, 'No import-start or per-file notifications')
assert.equal(calls[0].files.length, 1, 'Repeated files in a drop are deduplicated')
releaseAudio()
await flush()
assert.deepEqual(
  calls.map((call) => call.kind),
  ['audio', 'plugin', 'backup', 'plugin', 'plugin', 'audio']
)
assert(calls[0].ignoreShortSongs, 'Drops honor the short-audio setting')
assert.deepEqual(
  messages,
  [
    {
      kind: 'warning',
      message: '成功导入 4 项，导入失败 1 项（格式不支持），导入失败 1 项（pluginPackageInvalid）'
    },
    { kind: 'success', message: '成功导入 1 项' }
  ],
  'Each drop reports only aggregated success/failure counts'
)
assert(
  changes.includes('scanFinished') &&
    changes.includes('playlistsChanged') &&
    changes.includes('tagsChanged')
)
assert(changes.includes('files:import-progress'), 'Dropped backups keep the progress channel')
ui.ignoreShortSongs = false
drop(['short.wav'])
await flush()
assert.equal(calls.at(-1).ignoreShortSongs, false)
const beforeFolders = calls.length
const messagesBeforeFolders = messages.length
const folders = drop(
  ['Album', 'Album', 'unreadable', 'empty', 'named.wav', 'bonus.MP3', 'theme.EPP'],
  ['Files'],
  ['Album', 'unreadable', 'empty', 'named.wav']
)
// The queued import must use folder identity captured during the synchronous drop.
folders.dataTransfer.files = []
folders.dataTransfer.items = []
await flush()
assert.deepEqual(
  calls.slice(beforeFolders).map((call) => call.kind),
  ['folder', 'folder', 'folder', 'folder', 'audio', 'plugin']
)
assert.equal(
  calls.slice(beforeFolders).filter((call) => call.kind === 'folder').length,
  4,
  'Repeated folder paths are deduplicated'
)
assert(
  calls
    .slice(beforeFolders)
    .filter((call) => call.kind === 'folder')
    .every((call) => call.ignoreShortSongs === false)
)
assert(
  trackedDirectories.includes(path.resolve('build/drop-fixture/Album')),
  'Dropped folders reuse watched-directory tracking'
)
assert(
  trackedDirectories.includes(path.resolve('build/drop-fixture/empty')),
  'Empty folders use the same folder import flow'
)
assert(!trackedDirectories.includes(path.resolve('build/drop-fixture/unreadable')))
assert.deepEqual(
  messages.slice(messagesBeforeFolders),
  [{ kind: 'warning', message: '成功导入 6 项，导入失败 1 项（Folder inaccessible）' }],
  'Folder and mixed-file results share one summary; empty folders are not failures'
)
const messagesBeforeFailure = messages.length
drop(['bad.epp', 'notes.txt'])
await flush()
assert.deepEqual(
  messages.slice(messagesBeforeFailure),
  [
    { kind: 'error', message: '导入失败 1 项（格式不支持），导入失败 1 项（pluginPackageInvalid）' }
  ],
  'A completely failed drop produces only a failure count'
)
const resultMessageCount = messages.length
ui.ignoreShortSongs = true
drop(['new.mp3', 'duplicate.mp3', 'short.wav', 'invalid.wav'])
await flush()
assert.deepEqual(
  messages.slice(resultMessageCount),
  [{ kind: 'warning', message: '成功导入 1 项，重复 1 项，跳过 1 项（不足 5 秒），导入失败 1 项' }],
  'Added, duplicate, filtered and failed audio have distinct results'
)
const emptyMessageCount = messages.length
drop(['empty'], ['Files'], ['empty'])
await flush()
assert.deepEqual(
  messages.slice(emptyMessageCount),
  [{ kind: 'info', message: '未找到可导入的音频' }],
  'An empty folder must not claim a successful zero-item import'
)
const duplicateMessageCount = messages.length
drop(['duplicate.mp3'])
await flush()
assert.deepEqual(
  messages.slice(duplicateMessageCount),
  [{ kind: 'info', message: '重复 1 项' }],
  'Duplicate-only drops do not claim success or failure'
)
assert(changes.includes('library:scan-progress'), 'Folder imports reuse scan progress')
await assert.rejects(invoke('library:import-local-files', ['relative.mp3']))
await assert.rejects(invoke('library:import-local-files', [path.resolve('not-audio.epp')]))
assert.equal((await invoke('plugins:import', path.resolve('bad.txt'))).success, false)
assert.equal((await invoke('files:import-library', path.resolve('bad.txt'))).success, false)
assert.equal(
  (await invoke('plugins:import')).cancelled,
  true,
  'Existing package picker remains available'
)
assert.equal(
  (await invoke('files:import-library')).cancelled,
  true,
  'Existing backup picker remains available'
)
assert(next.prevented)
unmount()
assert.equal(listeners.size, 0, 'Global drop listeners are cleaned up')
console.log(
  'File drop import passed: audio, folders, mixed packages, progress, invalid files, queueing, filtering, refresh, internal sorting and cleanup.'
)
