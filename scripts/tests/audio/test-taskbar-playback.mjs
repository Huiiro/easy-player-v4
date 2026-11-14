/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import vm from 'node:vm'
import ts from 'typescript'

function load(file, mocks = {}, globals = {}) {
  const exports = {}
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    { exports, require: (name) => mocks[name], Buffer, ...globals }
  )
  return exports
}
const zh = load('src/main/i18n/locales/zh.ts')
const en = load('src/main/i18n/locales/en.ts')
function harness(platform = 'win32', exists = true) {
  const nativeTheme = Object.assign(new EventEmitter(), { shouldUseDarkColors: false })
  const i18n = load('src/main/i18n/index.ts', { './locales/zh': zh, './locales/en': en })
  const actions = [],
    children = [],
    timers = new Set()
  const { createTaskbarPlaybackControls } = load(
    'src/main/service/taskbarPlaybackService.ts',
    {
      electron: { nativeTheme },
      'node:child_process': {
        spawn(command, args, options) {
          assert.equal(command, 'helper.exe')
          assert.equal(options.windowsHide, true, 'helper never opens a console')
          const child = Object.assign(new EventEmitter(), {
            stdin: new PassThrough(),
            stdout: new PassThrough(),
            stderr: new PassThrough(),
            writes: [],
            killed: false,
            kill() {
              this.killed = true
            }
          })
          child.stdin.on('data', (data) => child.writes.push(data.toString()))
          children.push(child)
          return child
        }
      },
      'node:fs': { existsSync: () => exists },
      'node:readline': {
        createInterface: ({ input }) => {
          const reader = new EventEmitter()
          input.on('data', (data) =>
            data
              .toString()
              .trim()
              .split('\n')
              .forEach((line) => reader.emit('line', line))
          )
          reader.close = () => reader.removeAllListeners()
          return reader
        }
      },
      '../i18n': i18n,
      './loggerService': {
        Logger: {
          warn() {
            /* Expected diagnostics are ignored in this harness. */
          }
        }
      }
    },
    {
      setTimeout: (callback) => {
        const timer = {
          callback,
          unref() {
            /* Fake timers do not keep a process alive. */
          }
        }
        timers.add(timer)
        return timer
      },
      clearTimeout: (timer) => timers.delete(timer)
    }
  )
  const controls = createTaskbarPlaybackControls({
    platform,
    command: 'helper.exe',
    onAction: (action) => actions.push(action)
  })
  return { controls, children, actions, timers, i18n, nativeTheme }
}
const h = harness()
assert.equal(h.controls.state().enabled, false)
h.controls.update({ isPlaying: true, hasTrack: true })
h.controls.setEnabled(true)
const first = h.children[0]
let fields = first.writes.at(-1).trim().split('|')
assert.deepEqual(fields.slice(0, 4), ['S', '1', '1', '0'])
assert.deepEqual(
  fields.slice(4, 8).map((hex) => Buffer.from(hex, 'hex').toString()),
  ['上一首', '播放', '暂停', '下一首']
)
assert.equal(Buffer.from(fields[8], 'hex').toString(), '未知歌曲')
h.controls.update({
  isPlaying: true,
  hasTrack: true,
  title: '春|めく & A\nB 😀',
  artist: 'Hana Hope',
  album: '专辑'
})
fields = first.writes.at(-1).trim().split('|')
assert.equal(fields.length, 11)
assert.deepEqual(
  fields.slice(8).map((hex) => (hex === '-' ? '' : Buffer.from(hex, 'hex').toString())),
  ['春|めく & A B 😀', 'Hana Hope', '专辑']
)
h.controls.update({
  isPlaying: true,
  hasTrack: true,
  title: '😀'.repeat(600),
  artist: '',
  album: ''
})
fields = first.writes.at(-1).trim().split('|')
assert.equal(Array.from(Buffer.from(fields[8], 'hex').toString()).length, 512)
assert.equal(fields[8].length, 4096, 'metadata stays within the native field limit')
first.stdout.write('previous\ntoggle\nnext\ninvalid\n')
assert.deepEqual(h.actions, ['previous', 'toggle', 'next'])
h.i18n.setMainLocale('en')
h.controls.update()
fields = first.writes.at(-1).trim().split('|')
assert.equal(Buffer.from(fields[4], 'hex').toString(), 'Previous')
h.nativeTheme.shouldUseDarkColors = true
h.nativeTheme.emit('updated')
assert.equal(first.writes.at(-1).split('|')[3], '1')
h.controls.update({ isPlaying: false, hasTrack: false })
fields = first.writes.at(-1).trim().split('|')
assert.equal(Buffer.from(fields[8], 'hex').toString(), 'No track playing')
assert.deepEqual(fields.slice(9), ['-', '-'], 'clearing playback removes stale artist and album')
first.stdout.write('toggle\n')
assert.equal(h.actions.length, 3, 'empty playback disables commands')
h.controls.setEnabled(false)
assert.equal(first.killed, true)
assert.equal(first.stdin.writableEnded, true)
first.emit('close', 0)
assert.equal(h.timers.size, 0, 'explicit disable never restarts the helper')
h.controls.setEnabled(true)
assert.equal(h.children.length, 2)
first.stdout.write('next\n')
assert.equal(h.actions.length, 3, 'stale processes cannot control playback')
for (let i = 0; i < 4; i++) {
  h.children.at(-1).emit('close', 1)
  for (const timer of [...h.timers]) {
    h.timers.delete(timer)
    timer.callback()
  }
}
assert.equal(h.children.length, 5, 'unexpected exits get at most three retries')
h.controls.dispose()
assert.equal(h.nativeTheme.listenerCount('updated'), 0)
h.controls.setEnabled(true)
assert.equal(h.children.length, 5, 'disposed controllers never restart')
for (const [platform, exists] of [
  ['darwin', true],
  ['linux', true],
  ['win32', false]
]) {
  const other = harness(platform, exists)
  assert.equal(other.controls.state().available, false)
  assert.throws(() => other.controls.setEnabled(true))
  assert.equal(other.children.length, 0)
  other.controls.dispose()
}
console.log(
  'Taskbar strip passed: host lifecycle, actions, locale, theme, disabled state, stale processes, bounded recovery and platform isolation'
)
