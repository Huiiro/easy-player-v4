/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const esbuild = require('esbuild')
const { parse, compileScript } = require('@vue/compiler-sfc')
app.setPath('userData', fs.mkdtempSync(path.resolve('build/library-settings-ui-')))
app.disableHardwareAcceleration()

async function checkSettings() {
  const { Vue, Settings, createI18n, zh, eventBus } = window.Fixture
  const { createApp, reactive, nextTick } = Vue
  const wait = async () => {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const check = (condition, message) => {
    if (!condition) throw new Error(message)
  }
  window.fixtureUI = reactive({ autoImportLocalMusic: true, showAutoImportNotifications: true })
  window.errors = []
  let folders = [{ path: 'D:\\Music', enabled: true }]
  let selected = 'D:\\Music Archive'
  let failSave = false
  let pendingSave
  let fileProgress
  const unhandled = []
  const onUnhandled = (event) => unhandled.push(String(event.reason))
  window.addEventListener('unhandledrejection', onUnhandled)
  window.api = {
    files: {
      onImportProgress: (callback) => {
        fileProgress = callback
        return () => {}
      }
    },
    library: {
      getWatchedFolders: async () => structuredClone(folders),
      selectLocalMusicFolder: async () => selected,
      setWatchedFolders: async (value) => {
        const plain = structuredClone(value) // Real IPC also rejects Vue proxies.
        if (failSave) throw new Error('save failed')
        if (pendingSave) await pendingSave
        folders = plain
        return structuredClone(folders)
      }
    }
  }
  const component = createApp(Settings)
  component.config.errorHandler = (error) => {
    throw error
  }
  component.use(createI18n({ legacy: false, locale: 'zh', messages: { zh } }))
  component.mount('#app')
  await wait()
  const rows = () => document.querySelectorAll('.watch-folder')
  const add = () =>
    [...document.querySelectorAll('button')].find(
      (button) => button.textContent.trim() === '添加文件夹'
    )
  check(rows().length === 1, 'saved folders must load')
  rows()[0].querySelector('[role=switch]').click()
  await wait()
  check(folders[0].enabled === false, 'folder switch must save disabled state')
  add().click()
  await wait()
  check(rows().length === 2 && folders[1].enabled, 'folder picker must add an enabled folder')
  selected = null
  add().click()
  await wait()
  check(rows().length === 2, 'canceling picker must preserve configuration')
  failSave = true
  rows()[0].querySelector('[role=switch]').click()
  await wait()
  check(
    folders[0].enabled === false && window.errors.length === 1,
    'failed save must preserve saved state and show error'
  )
  failSave = false
  let finish
  pendingSave = new Promise((resolve) => {
    finish = resolve
  })
  rows()[0].querySelector('button:not([role=switch])').click()
  await wait()
  check(
    add().disabled && [...rows()].every((row) => row.querySelector('button').disabled),
    'saving must disable competing changes'
  )
  finish()
  await wait()
  pendingSave = undefined
  check(
    rows().length === 1 && folders[0].path === 'D:\\Music Archive',
    'remove must save remaining folders'
  )
  rows()[0].querySelector('button:not([role=switch])').click()
  await wait()
  check(rows().length === 0 && folders.length === 0, 'last removal must persist an empty list')
  check(
    document.querySelector('.watch-folders').textContent.includes('尚未选择'),
    'empty list must show guidance'
  )
  folders = [{ path: 'D:\\Downloads', enabled: true }]
  eventBus.emit('scanFinished')
  await wait()
  check(
    rows().length === 1 && rows()[0].textContent.includes('Downloads'),
    'completed folder imports must refresh the open settings page'
  )
  const previousErrors = window.errors.length
  for (const [action, label] of [
    ['recoverMovedSongs', zh.settings.recover],
    ['importLibrary', zh.settings.importLibrary],
    ['exportLibrary', zh.settings.exportLibrary]
  ]) {
    window.api.files[action] = async () => {
      throw new Error('IPC recovery fixture failure')
    }
    fileProgress({ current: 1, total: 3 })
    await wait()
    check(document.querySelector('.progress'), 'Import progress starts before a file operation')
    const button = [...document.querySelectorAll('button')].find(
      (button) => button.textContent.trim() === label
    )
    check(button, 'A real settings button invokes ' + action)
    button.click()
    await wait()
    check(!document.querySelector('.progress'), 'Rejected IPC clears progress for ' + action)
  }
  check(
    window.errors.length === previousErrors + 3,
    'Every rejected file operation shows a localized failure'
  )
  check(
    unhandled.length === 0,
    'File operation IPC errors never escape as unhandled promises: ' + unhandled
  )
  window.api.files.recoverMovedSongs = async () => ({
    success: true,
    data: { total: 2, recovered: 1 }
  })
  const recovery = [...document.querySelectorAll('button')].find(
    (button) => button.textContent.trim() === zh.settings.recover
  )
  recovery.click()
  await wait()
  check(
    window.errors.length === previousErrors + 3,
    'Partial recovery remains a successful operation'
  )
  window.removeEventListener('unhandledrejection', onUnhandled)
  component.unmount()
  return 'Library settings UI passed: watched folders, file operation rejection handling, progress cleanup and partial recovery.'
}

app.whenReady().then(async () => {
  try {
    const styles = []
    const bundle = await esbuild.build({
      stdin: {
        contents:
          "export * as Vue from 'vue';export {createI18n} from 'vue-i18n';export {default as Settings} from './src/renderer/src/components/settings/LibrarySettings.vue';export {default as zh} from './src/renderer/src/i18n/locales/zh';export {default as eventBus} from './src/renderer/src/utils/eventBus';",
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
            build.onResolve({ filter: /stores[\\/]ui[\\/]uiStore$/ }, () => ({
              path: 'ui',
              namespace: 'fixture'
            }))
            build.onResolve({ filter: /ui[\\/]useMessage$/ }, () => ({
              path: 'message',
              namespace: 'fixture'
            }))
            build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({
              contents:
                name === 'ui'
                  ? 'export const useUIStore=()=>window.fixtureUI'
                  : 'export const useMessage=()=>({success(){},info(){},error:message=>window.errors.push(message)})'
            }))
            build.onLoad({ filter: /\.vue$/ }, ({ path: filename }) => {
              const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
              styles.push(...descriptor.styles.map((style) => style.content))
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
    await win.webContents.insertCSS(styles.join('\n'))
    console.log(await win.webContents.executeJavaScript('(' + checkSettings.toString() + ')()'))
    win.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
