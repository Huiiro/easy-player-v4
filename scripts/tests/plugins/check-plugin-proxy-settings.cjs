/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const esbuild = require('esbuild')
const { parse, compileScript } = require('@vue/compiler-sfc')
fs.mkdirSync('build', { recursive: true })
app.setPath('userData', fs.mkdtempSync(path.resolve('build/plugin-proxy-ui-')))
app.disableHardwareAcceleration()

async function checkSettings() {
  const { Vue, Settings, createI18n, zh } = window.Fixture
  const { createApp, nextTick } = Vue
  const check = (condition, message) => {
    if (!condition) throw new Error(message)
  }
  const wait = async () => {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
  let stored = { mode: 'direct', url: '' }
  let writes = 0
  let failSave = false
  let releaseSave
  let pendingSave
  window.errors = []
  window.api = {
    plugins: {
      getProxy: async () => ({ success: true, data: structuredClone(stored) }),
      setProxy: async (value) => {
        const next = structuredClone(value)
        writes++
        if (pendingSave) await pendingSave
        if (failSave) return { success: false, error: '模拟保存失败' }
        stored = next
        return { success: true }
      }
    }
  }
  let instance
  const mount = async () => {
    instance?.unmount()
    instance = createApp(Settings).use(
      createI18n({ legacy: false, locale: 'zh', messages: { zh } })
    )
    instance.mount('#app')
    await wait()
  }
  const trigger = () => document.querySelector('button[aria-haspopup="listbox"]')
  const choose = async (label) => {
    trigger().click()
    await wait()
    const option = [...document.querySelectorAll('[role=option]')].find(
      (item) => item.textContent.trim() === label
    )
    check(option, 'mode option must be present: ' + label)
    option.click()
    await wait()
  }
  await mount()
  check(writes === 0 && trigger().textContent.includes('关闭'), 'initial load must not save')
  await choose('使用系统代理')
  check(
    stored.mode === 'system' && writes === 1,
    'selecting system must persist without a save click'
  )
  await mount()
  check(trigger().textContent.includes('使用系统代理'), 'remount must restore saved system mode')
  await choose('关闭')
  check(stored.mode === 'direct', 'turning proxy off must persist immediately')
  await mount()
  check(trigger().textContent.includes('关闭'), 'remount must restore off mode')
  const beforeCustom = writes
  await choose('自定义代理')
  check(
    writes === beforeCustom && stored.mode === 'direct',
    'empty custom address must remain a draft'
  )
  const input = document.querySelector('input')
  input.value = 'http://127.0.0.1:7890'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await wait()
  document.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }))
  await wait()
  check(
    stored.mode === 'custom' && stored.url === input.value,
    'custom address save must persist mode and URL'
  )
  await mount()
  check(
    trigger().textContent.includes('自定义代理') &&
      document.querySelector('input').value === stored.url,
    'remount must restore custom mode and address'
  )
  failSave = true
  await choose('使用系统代理')
  check(
    stored.mode === 'custom' && trigger().textContent.includes('自定义代理'),
    'failed autosave must restore the saved mode'
  )
  check(
    document.querySelector('[role=alert]').textContent.includes('模拟保存失败') &&
      window.errors.length === 1,
    'failed autosave must show an error'
  )
  failSave = false
  pendingSave = new Promise((resolve) => {
    releaseSave = resolve
  })
  await choose('使用系统代理')
  check(trigger().disabled, 'mode changes must be disabled while saving')
  releaseSave()
  await wait()
  pendingSave = undefined
  check(
    stored.mode === 'system' && !trigger().disabled,
    'successful retry must save and unlock controls'
  )
  await choose('自定义代理')
  check(stored.mode === 'custom', 'existing custom address must allow immediate mode persistence')
  await mount()
  check(
    trigger().textContent.includes('自定义代理'),
    'automatic custom mode save must survive remount'
  )
  instance.unmount()
  return 'Plugin proxy UI passed: automatic mode persistence, remount, custom address, failure rollback and busy state'
}

app.whenReady().then(async () => {
  try {
    const bundle = await esbuild.build({
      stdin: {
        contents:
          "export * as Vue from 'vue';export {createI18n} from 'vue-i18n';export {default as Settings} from './src/renderer/src/components/settings/PluginProxySettings.vue';export {default as zh} from './src/renderer/src/i18n/locales/zh';",
        resolveDir: process.cwd()
      },
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      globalName: 'Fixture',
      alias: {
        vue: require.resolve('vue/dist/vue.esm-bundler.js'),
        '@': path.resolve('src/renderer/src')
      },
      define: {
        __VUE_OPTIONS_API__: 'true',
        __VUE_PROD_DEVTOOLS__: 'false',
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false'
      },
      plugins: [
        {
          name: 'fixture',
          setup(build) {
            build.onResolve({ filter: /ui[\\/]useMessage$/ }, () => ({
              path: 'message',
              namespace: 'fixture'
            }))
            build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
              contents:
                'export const useMessage=()=>({success(){},error:message=>window.errors.push(message)})'
            }))
            build.onLoad({ filter: /\.vue$/ }, ({ path: filename }) => {
              const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
              return {
                contents: compileScript(descriptor, { id: filename, inlineTemplate: true }).content,
                loader: 'ts',
                resolveDir: path.dirname(filename)
              }
            })
          }
        }
      ]
    })
    const win = new BrowserWindow({
      show: false,
      width: 1000,
      height: 850,
      webPreferences: { offscreen: true, backgroundThrottling: false }
    })
    const filename = path.join(app.getPath('userData'), 'fixture.html')
    fs.writeFileSync(filename, '<html><body><main id="app"></main></body></html>')
    await win.loadFile(filename)
    await win.webContents.executeJavaScript(bundle.outputFiles[0].text)
    console.log(await win.webContents.executeJavaScript('(' + checkSettings.toString() + ')()'))
    win.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
