/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// Exercise the actual SFC cleanup callbacks with a context that checks whether
// its canvas is still visible when resources are released. Vue retains that
// canvas in the DOM throughout the parent's leave transition.
for (const name of ['Solid', 'BlackHole', 'Rainy']) {
  const path = new URL(
    `../src/renderer/src/components/background/${
      name === 'Solid' ? '' : 'themes/'
    }${name}Background.vue`,
    import.meta.url
  )
  const source = readFileSync(path, 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  let unmount
  let released = false
  const canvas = { style: {}, removeEventListener() {}, width: 800, height: 600 }
  const checkHidden = () =>
    assert.equal(canvas.style.display, 'none', `${name}: canvas must be hidden before GPU disposal`)
  const fakeGl = {
    isContextLost: () => false,
    deleteQuery: checkHidden,
    deleteTexture: checkHidden,
    deleteBuffer: checkHidden,
    deleteProgram: checkHidden,
    getExtension: () => ({
      loseContext() {
        checkHidden()
        released = true
      }
    })
  }
  const vue = {
    ref: (value) => ({ value }),
    computed: (getter) => ({
      get value() {
        return getter()
      }
    }),
    watch() {},
    onMounted() {},
    onBeforeUnmount(callback) {
      unmount = callback
    }
  }
  const { outputText } = ts.transpileModule(
    source.replaceAll('import.meta.url', JSON.stringify(path.href)) +
      '\ncanvas.value = fakeCanvas; gl = fakeGl;\n',
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
  )
  const events = { removeEventListener() {} }
  runInNewContext(outputText, {
    exports: {},
    require: (id) => (id === 'vue' ? vue : {}),
    defineProps: () => ({ primary: '60 90 140', active: true, reducedMotion: false }),
    withDefaults: (props, defaults) => ({ ...defaults, ...props }),
    fakeCanvas: canvas,
    fakeGl,
    document: events,
    window: events,
    cancelAnimationFrame() {},
    clearTimeout() {}
  })
  assert.equal(typeof unmount, 'function')
  unmount()
  assert.equal(released, true, `${name}: GPU context must still be released`)
  console.log(`${name}: leaving canvas hidden before GPU disposal`)
}
