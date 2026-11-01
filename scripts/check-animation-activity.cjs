/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const esbuild = require('esbuild')
const { parse, compileScript } = require('@vue/compiler-sfc')
app.setPath('userData', fs.mkdtempSync(path.resolve('build/animation-activity-')))
app.commandLine.appendSwitch('use-angle', 'swiftshader')
app.commandLine.appendSwitch('enable-unsafe-swiftshader')

async function checkActivity() {
  const {
    Vue,
    createPinia,
    persisted,
    createI18n,
    useUIStore,
    flushPlayerDataStorage,
    Settings,
    Shader,
    zh
  } = window.Fixture
  const { h, createApp, reactive, nextTick } = Vue
  const wait = async (ms = 120) => {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, ms))
  }
  const check = (ok, message) => {
    if (!ok) throw Error(message)
  }
  const settings = new Map()
  window.api = {
    database: {
      getSync: (key) => ({ success: true, data: settings.get(key) }),
      saveSync: (key, value) => {
        settings.set(key, value)
        return { success: true }
      }
    }
  }
  window.fixturePlayer = reactive({
    rhythmVisualConfig: { intensity: 0.6 },
    smartShuffleEnabled: false
  })
  let focused = true,
    hidden = false,
    ui,
    paused = Vue.ref(false)
  document.hasFocus = () => focused
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  const theme = {
    pluginId: 'fixture',
    revision: '1',
    textures: [],
    data: { background: '#101416', shader: { fps: 30 } },
    fragmentShader:
      '#version 300 es\nprecision highp float;uniform float u_time;out vec4 outColor;void main(){outColor=vec4(0.5+0.4*sin(u_time),0.3,0.4,1.0);}'
  }
  function mount() {
    const instance = createApp({
      setup() {
        ui = useUIStore()
        return () =>
          h('main', [
            h(Settings),
            h('div', { style: 'position:relative;width:200px;height:100px' }, [
              h(Shader, { theme, paused: paused.value })
            ])
          ])
      }
    })
      .use(createPinia().use(persisted))
      .use(createI18n({ legacy: false, locale: 'zh', messages: { zh } }))
    instance.mount('#app')
    return instance
  }
  let instance = mount()
  await wait(250)
  const toggle = () => document.querySelector('[role=switch][aria-label="失焦时暂停动效"]')
  check(
    ui.pauseAnimationsOnBlur === true && toggle().getAttribute('aria-checked') === 'true',
    'Preference and setting default to pause on blur'
  )
  const canvas = document.querySelector('.declarative-theme-background canvas')
  check(canvas.classList.contains('ready'), 'Independent shader fixture initializes')
  const gl = canvas.getContext('webgl2')
  const program = gl.getParameter(gl.CURRENT_PROGRAM)
  const location = gl.getUniformLocation(program, 'u_time')
  const time = () => gl.getUniform(program, location)
  check(time() > 0, 'Focused shader animates')
  focused = false
  window.dispatchEvent(new Event('blur'))
  await wait()
  let frozen = time()
  await wait()
  check(time() === frozen, 'Shader pauses on blur by default')
  toggle().click()
  await wait(200)
  check(
    !ui.pauseAnimationsOnBlur && time() > frozen,
    'Setting switch resumes the shader while unfocused'
  )
  hidden = true
  document.dispatchEvent(new Event('visibilitychange'))
  await wait()
  frozen = time()
  await wait()
  check(time() === frozen, 'Hidden shaders pause even with focus pausing disabled')
  hidden = false
  document.dispatchEvent(new Event('visibilitychange'))
  await wait(200)
  check(time() > frozen, 'Visible unfocused shader resumes with the preference off')
  paused.value = true
  await wait()
  frozen = time()
  await wait()
  check(time() === frozen, 'Explicit layer pausing still takes precedence')
  paused.value = false
  await wait(160)
  flushPlayerDataStorage()
  check(
    JSON.parse(settings.get('pinia.ui.preferences.v1')).pauseAnimationsOnBlur === false,
    'Preference is persisted'
  )
  ui.$dispose()
  instance.unmount()
  instance = mount()
  await wait()
  check(
    ui.pauseAnimationsOnBlur === false && toggle().getAttribute('aria-checked') === 'false',
    'Preference survives renderer recreation'
  )
  ui.resetPreferences()
  await wait()
  check(
    ui.pauseAnimationsOnBlur === true && toggle().getAttribute('aria-checked') === 'true',
    'Restore defaults reenables blur pausing'
  )
  ui.$dispose()
  instance.unmount()
  return 'Animation activity passed: default, settings switch, real shader blur/resume, hidden pause, layer pause, persistence, restart and restored defaults.'
}

app.whenReady().then(async () => {
  try {
    const styles = []
    const bundle = await esbuild.build({
      stdin: {
        resolveDir: process.cwd(),
        contents:
          "export * as Vue from 'vue';export {createPinia} from 'pinia';export {default as persisted} from 'pinia-plugin-persistedstate';export {createI18n} from 'vue-i18n';export {useUIStore} from './src/renderer/src/stores/ui/uiStore';export {flushPlayerDataStorage} from './src/renderer/src/stores/persistence';export {default as Settings} from './src/renderer/src/components/settings/PlaybackSettings.vue';export {default as Shader} from './src/renderer/src/components/background/DeclarativeThemeBackground.vue';export {default as zh} from './src/renderer/src/i18n/locales/zh';"
      },
      bundle: true,
      write: false,
      format: 'iife',
      globalName: 'Fixture',
      platform: 'browser',
      loader: { '.glsl': 'text' },
      alias: {
        vue: require.resolve('vue/dist/vue.esm-bundler.js'),
        '@': path.resolve('src/renderer/src')
      },
      define: {
        __APP_VERSION__: '"test"',
        __APP_BUILD__: '"0"',
        __VUE_OPTIONS_API__: 'true',
        __VUE_PROD_DEVTOOLS__: 'false',
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false'
      },
      plugins: [
        {
          name: 'fixture',
          setup(build) {
            build.onResolve({ filter: /stores[\\/]player[\\/]playerStore$/ }, () => ({
              path: 'player',
              namespace: 'fixture'
            }))
            build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
              contents: 'export const usePlayerStore=()=>window.fixturePlayer'
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
      height: 900,
      webPreferences: { offscreen: true, backgroundThrottling: false }
    })
    win.webContents.on('console-message', (event) => {
      if (event.level === 'error' || event.level === 3) console.error(event.message)
    })
    const file = path.join(app.getPath('userData'), 'fixture.html')
    fs.writeFileSync(file, '<html><body><div id="app"></div></body></html>')
    await win.loadFile(file)
    await win.webContents.executeJavaScript(bundle.outputFiles[0].text)
    await win.webContents.insertCSS(styles.join('\n'))
    const result = await win.webContents.executeJavaScript(
      '(' + checkActivity.toString() + ')().catch(error=>({error:error.stack}))'
    )
    if (result.error) throw new Error(result.error)
    console.log(result)
    win.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
