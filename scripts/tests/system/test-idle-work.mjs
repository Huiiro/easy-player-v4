/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as Vue from 'vue'

function evaluate(source, mocks, globals = {}) {
  const exports = {}
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    {
      exports,
      require: (name) => {
        assert.ok(name in mocks, name)
        return mocks[name]
      },
      ...globals
    }
  )
  return exports
}
function lifecycle() {
  const hooks = { mounted: [], activated: [], deactivated: [], unmounted: [] }
  return {
    hooks,
    api: {
      onMounted: (fn) => hooks.mounted.push(fn),
      onActivated: (fn) => hooks.activated.push(fn),
      onDeactivated: (fn) => hooks.deactivated.push(fn),
      onBeforeUnmount: (fn) => hooks.unmounted.push(fn)
    },
    run: (name) => hooks[name].forEach((fn) => fn())
  }
}
function environment() {
  const jobs = new Map(),
    listeners = new Map()
  let id = 0
  return {
    jobs,
    listeners,
    document: {
      hidden: false,
      addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: (name) => listeners.delete(name)
    },
    schedule: (fn) => {
      jobs.set(++id, fn)
      return id
    },
    cancel: (key) => jobs.delete(key),
    frame: () => {
      const pending = [...jobs.values()]
      jobs.clear()
      pending.forEach((fn) => fn())
    }
  }
}
const life = lifecycle(),
  env = environment()
const { useVisibleInterval } = evaluate(
  readFileSync('src/renderer/src/hooks/useVisibleInterval.ts', 'utf8'),
  { vue: life.api },
  { document: env.document, setTimeout: env.schedule, clearTimeout: env.cancel }
)
let ticks = 0
useVisibleInterval(() => ticks++, 1000)
life.run('mounted')
life.run('activated')
assert.equal(ticks, 1, 'mounted plus activated starts only once')
assert.equal(env.jobs.size, 1)
env.frame()
assert.equal(ticks, 2)
env.document.hidden = true
env.listeners.get('visibilitychange')()
assert.equal(env.jobs.size, 0)
env.document.hidden = false
env.listeners.get('visibilitychange')()
assert.equal(ticks, 3, 'visible pages update immediately on return')
life.run('deactivated')
assert.equal(env.jobs.size, 0)
env.listeners.get('visibilitychange')()
assert.equal(env.jobs.size, 0, 'cached page cannot resume')
life.run('activated')
assert.equal(ticks, 4)
life.run('unmounted')
assert.equal(env.jobs.size, 0)
assert.equal(env.listeners.size, 0)

const spectrumLife = lifecycle(),
  frames = environment()
const props = Vue.reactive({ spectrum: [], color: '77 136 220', active: true })
const ui = Vue.reactive({ reduceMotion: false, playerSpectrumStyle: 'bars' })
let paints = 0
const context = {
  clearRect() {
    paints++
  },
  createLinearGradient: () => ({ addColorStop() {} }),
  fillRect() {}
}
const canvas = { width: 1, height: 1, getContext: () => context }
const scope = Vue.effectScope()
const source = readFileSync('src/renderer/src/components/player/PlayerSpectrum.vue', 'utf8').match(
  /<script setup lang="ts">([\s\S]*?)<\/script>/
)[1]
scope.run(() =>
  evaluate(
    source,
    {
      vue: {
        ...Vue,
        ...spectrumLife.api,
        ref: (...args) => (args.length ? Vue.ref(...args) : Vue.shallowRef(canvas))
      },
      '@/stores/ui/uiStore': { useUIStore: () => ui }
    },
    {
      defineProps: () => props,
      document: frames.document,
      window: { devicePixelRatio: 1 },
      requestAnimationFrame: frames.schedule,
      cancelAnimationFrame: frames.cancel,
      ResizeObserver: class {
        constructor(fn) {
          this.fn = fn
        }
        observe() {
          this.fn([{ contentRect: { width: 200, height: 64 } }])
        }
        disconnect() {}
      }
    }
  )
)
spectrumLife.run('mounted')
frames.frame()
assert.equal(frames.jobs.size, 0, 'empty spectrum must stop drawing')
props.spectrum = [0.5, 0.8]
await Vue.nextTick()
assert.equal(frames.jobs.size, 1, 'new data restarts drawing')
for (let i = 0; i < 100 && frames.jobs.size; i++) frames.frame()
assert.equal(frames.jobs.size, 0, 'stable spectrum converges and stops')
const settledPaints = paints
frames.frame()
assert.equal(paints, settledPaints)
props.spectrum = [0.9, 0.2]
await Vue.nextTick()
assert.equal(frames.jobs.size, 1)
frames.document.hidden = true
frames.listeners.get('visibilitychange')()
assert.equal(frames.jobs.size, 0)
frames.document.hidden = false
frames.listeners.get('visibilitychange')()
assert.equal(frames.jobs.size, 1)
props.active = false
await Vue.nextTick()
assert.equal(frames.jobs.size, 0)
spectrumLife.run('unmounted')
scope.stop()
assert.equal(frames.jobs.size, 0)
assert.equal(frames.listeners.size, 0)
console.log('Visible task lifecycle and event-driven spectrum rendering passed.')
