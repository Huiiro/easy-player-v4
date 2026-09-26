const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const extensions = ['mp3', 'aac', 'm4a', 'ogg', 'opus', 'flac', 'wav', 'aiff', 'ape', 'dff', 'dsf']
const root = path.resolve(__dirname, '..')
const listeners = new Map()
const handlers = new Map()
const sent = []
const imported = []
const rows = new Map()
const files = new Set(
  ['音乐 folder/track.MP3', 'second.flac', 'corrupt.wav'].map((file) => path.resolve(root, file))
)
const contents = {
  send: (channel, data) => sent.push({ channel, data })
}
const window = { webContents: contents, isDestroyed: () => false }
const mocks = {
  electron: {
    ipcMain: {
      on: (channel, cb) => listeners.set(channel, cb),
      handle: (channel, cb) => handlers.set(channel, cb)
    },
    shell: {
      openExternal: async (uri) => {
        sent.push({ uri })
      }
    }
  },
  'node:fs': { existsSync: (file) => files.has(file), statSync: () => ({ isFile: () => true }) },
  'node:child_process': { execFile: (_exe, _args, _options, callback) => callback(null, '', '') },
  '../database': { getDatabase: () => ({ prepare: () => ({ get: (file) => rows.get(file) }) }) },
  '../database/repository': {
    getSong: (id) => ({ id, audio: [...rows].find(([, row]) => row.id === id)[0] })
  },
  './scanService': {
    SUPPORTED_EXTENSIONS: extensions.map((ext) => '.' + ext),
    scanMusicDirectory: async (directory, _callback, selected) => {
      imported.push({ directory, selected })
      if (selected[0].endsWith('corrupt.wav')) throw new Error('Invalid audio')
      for (const file of selected) rows.set(file, { id: rows.size + 1 })
    }
  },
  './loggerService': { Logger: { warn: () => {} } }
}
const compiled = ts.transpileModule(
  fs.readFileSync(path.join(root, 'src/main/service/fileAssociationService.ts'), 'utf8'),
  {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }
).outputText
const exportsObject = {}
vm.runInNewContext(compiled, {
  exports: exportsObject,
  require: (name) => mocks[name] || require(name),
  process
})
const tick = () => new Promise((resolve) => setImmediate(resolve))

async function main() {
  exportsObject.registerFileAssociationHandlers(() => window)
  exportsObject.queueAudioFiles(
    ['--inspect', 'missing.mp3', 'not-audio.txt', '音乐 folder/track.MP3', '音乐 folder/track.MP3'],
    root
  )
  assert.equal(handlers.get('system:has-pending-audio-files')(), true)
  assert.equal(sent.length, 0, 'cold launches wait for player initialization')
  listeners.get('system:audio-files-ready')({ sender: {} }, true)
  await tick()
  assert.equal(sent.length, 0, 'auxiliary renderers cannot drain pending files')
  listeners.get('system:audio-files-ready')({ sender: contents }, true)
  await tick()
  assert.equal(sent[0].data.length, 1, 'duplicate arguments are deduplicated')
  assert.equal(imported.length, 1)
  assert.equal(imported[0].selected.length, 1, 'opening one file never scans its directory')
  exportsObject.queueAudioFiles(['second.flac'], root)
  await tick()
  assert.equal(
    sent[1].data[0].audio,
    path.resolve(root, 'second.flac'),
    'warm launches reach the existing renderer'
  )
  exportsObject.resetAudioFileDelivery()
  exportsObject.queueAudioFiles(['音乐 folder/track.MP3'], root)
  await tick()
  assert.equal(sent.length, 2, 'reloads suspend delivery')
  listeners.get('system:audio-files-ready')({ sender: contents }, true)
  await tick()
  assert.equal(sent.length, 3)
  assert.equal(imported.length, 2, 'existing songs are reused')
  exportsObject.queueAudioFiles(['corrupt.wav', 'second.flac'], root)
  await tick()
  assert.equal(sent[3].channel, 'system:open-files-error')
  assert.equal(sent[4].data.length, 1, 'bad files do not prevent valid files from opening')
  // A normal launch followed by router navigation must still accept a file launch.
  exportsObject.resetAudioFileDelivery(true, true)
  exportsObject.resetAudioFileDelivery(false, false)
  exportsObject.queueAudioFiles(['second.flac'], root)
  await tick()
  assert.equal(sent.length, 6, 'same-document and subframe navigation preserve readiness')
  // Installer-started and Explorer-started instances may have different launch contexts.
  // Electron can omit argv; the explicit payload retains the sender's arguments and cwd.
  exportsObject.queueSecondInstanceAudioFiles([], path.dirname(root), {
    args: ['音乐 folder/track.MP3'],
    workingDirectory: root
  })
  await tick()
  assert.equal(sent.length, 7, 'explicit launch data works when Electron omits argv')
  assert.equal(sent[6].data[0].audio, path.resolve(root, '音乐 folder/track.MP3'))
  exportsObject.queueSecondInstanceAudioFiles(
    ['second.flac', 'easy-player.exe', '--original-process-start-time=1'],
    root,
    null
  )
  await tick()
  assert.equal(sent.length, 8, 'fallback preserves audio paths even when argv is reordered')
  exportsObject.queueSecondInstanceAudioFiles(['second.flac'], root, {
    args: [123],
    workingDirectory: root
  })
  await tick()
  assert.equal(sent.length, 9, 'malformed payload uses the command line fallback')
  const installer = fs.readFileSync(path.join(root, 'scripts/file-associations.nsh'), 'utf8')
  for (const ext of extensions) {
    assert.ok(
      installer.includes(`!insertmacro RegisterAudioExtension ${ext} ${ext.toUpperCase()}\n`)
    )
    assert.ok(installer.includes(`!insertmacro UnregisterAudioExtension ${ext}\n`))
  }
  assert.ok(
    installer.includes('".${EXT}" "EasyPlayer.Audio.${EXT}"'),
    'each format has its own file type'
  )
  assert.ok(installer.includes('"${FORMAT} Audio"'), 'file type names describe the format')
  assert.ok(
    installer.includes('"${FORMAT} 音频"'),
    'Chinese installations use Chinese file type names'
  )
  assert.ok(!installer.includes('UserChoice'), 'default selection belongs to Windows')
  assert.ok(
    installer.includes('\"$INSTDIR\\easy-player.exe\" \"%1\"'),
    'paths with spaces are quoted'
  )
  console.log(
    'File association checks passed: cold/warm launch, navigation, explicit launch data, reordered argv, readiness, targeted import, reload, failure recovery and installer formats.'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
