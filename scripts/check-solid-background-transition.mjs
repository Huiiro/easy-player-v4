import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Exercise teardown with DOM retained by Vue's leave transition. Reactive
// updates are deliberately not flushed, as the leaving component is unmounted.
const source = readFileSync(
  new URL('../src/renderer/src/components/background/SolidBackground.vue', import.meta.url),
  'utf8'
).match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
const script = ts.transpileModule(source.replace(/^import .*$/gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText

for (const reducedMotion of [false, true]) {
  let teardown
  let lost = false
  let resized = false
  let cancelled = false
  const canvas = { style: { display: '' } }
  for (const dimension of ['width', 'height']) {
    Object.defineProperty(canvas, dimension, {
      set(value) {
        assert.equal(canvas.style.display, 'none', 'Canvas must be hidden before clearing')
        assert.equal(value, 1)
        resized = true
      }
    })
  }
  canvas.removeEventListener = () => {}
  const context = vm.createContext({
    defineProps: () => ({ primary: '24 30 32', active: true, reducedMotion }),
    ref: (value) => ({ value }),
    computed: (getter) => ({
      get value() {
        return getter()
      }
    }),
    watch: () => {},
    onMounted: () => {},
    onBeforeUnmount: (callback) => {
      teardown = callback
    },
    document: { removeEventListener: () => undefined },
    clearTimeout,
    cancelAnimationFrame: () => {
      cancelled = true
    },
    testCanvas: canvas,
    testGL: {
      deleteBuffer: () => undefined,
      deleteProgram: () => undefined,
      getExtension: () => ({
        loseContext() {
          assert.equal(canvas.style.display, 'none', 'Canvas must be hidden before context loss')
          lost = true
        }
      })
    }
  })
  vm.runInContext(script, context)
  vm.runInContext('canvas.value = testCanvas; gl = testGL; frame = 1', context)
  teardown()
  assert.ok(
    lost && resized && cancelled,
    'GPU resources and scheduled frames must still be released'
  )
}
console.log('Solid background leave-transition teardown passed (normal and reduced motion).')
