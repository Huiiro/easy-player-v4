/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Isolated Chromium fixture. */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const esbuild = require('esbuild')
const { parse, compileScript, compileStyle } = require('@vue/compiler-sfc')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ep-footer-menu-')))
app.disableHardwareAcceleration()

async function runChecks() {
  const { Vue, Footer, createI18n, createRouter, createMemoryHistory, zh } = window.Fixture
  const { createApp, h, reactive, nextTick } = Vue
  const checks = [],
    errors = []
  const check = (ok, message) => {
    if (!ok) throw Error(message)
    checks.push(message)
  }
  const wait = async (ms = 60) => {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, ms))
  }
  const nativeTimeout = window.setTimeout.bind(window)
  window.setTimeout = (callback, ms, ...args) =>
    nativeTimeout(callback, ms === 5000 ? 100 : ms, ...args)
  const nativeMatchMedia = window.matchMedia.bind(window)
  window.matchMedia = (query) =>
    query.includes('hover: hover')
      ? { matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }
      : nativeMatchMedia(query)
  const song = {
    id: 1,
    title: 'A long song title for the collapsed footer',
    artist: 'Artist',
    album: 'Album',
    cover: null
  }
  window.footerUi = reactive({
    reduceMotion: true,
    autoHideFooter: false,
    showPlayer: false,
    artistSeparator: '/',
    normalizeMetadataSeparator: true,
    footerOpenMode: 'bar',
    useDesktopLyrics: false
  })
  window.footerPlayer = reactive({
    queue: [song],
    currentQueueSong: song,
    currentQueueIndex: 0,
    currentFile: 'fixture.flac',
    volume: 0.5,
    playMode: 0,
    positionMs: 80000,
    durationMs: 240000,
    positionFormatted: '01:20',
    durationFormatted: '04:00',
    isPlaying: false,
    getSongPreference: () => 0,
    getPreviousQueueIndex: () => -1,
    getNextQueueIndex: () => -1,
    setPlayMode(value) {
      this.playMode = value
    },
    setVolume(value) {
      this.volume = value
    },
    play() {
      this.isPlaying = true
    },
    pause() {
      this.isPlaying = false
    }
  })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { render: () => null } }]
  })
  await router.push('/')
  await router.isReady()
  const mounted = createApp({ render: () => h(Footer) })
  mounted.config.errorHandler = (error) => errors.push(String(error))
  mounted
    .use(router)
    .use(createI18n({ legacy: false, locale: 'zh', messages: { zh } }))
    .mount('#app')
  await wait()
  const more = () => document.querySelector('button[aria-label="更多"]')
  const menu = () => document.querySelector('.ep-footer .ep-menu')
  const action = (selector) => menu().querySelector(selector)
  document.querySelector('.ep-footer-toggle').click()
  await wait()
  check(
    !!document.querySelector('.app-footer--collapsed') && !!more(),
    'collapsed footer retains one more-menu trigger'
  )
  more().click()
  await wait()
  check(
    !!menu() && !window.footerUi.showPlayer,
    'collapsed more menu opens without opening the player'
  )
  for (const category of ['volume', 'mode', 'queue', 'secondary'])
    check(
      getComputedStyle(action('.ep-footer-menu-' + category)).display !== 'none',
      'collapsed menu exposes ' + category
    )
  const box = menu().getBoundingClientRect()
  check(
    box.top >= 0 &&
      document.elementFromPoint(box.left + 10, box.top + 10)?.closest('.ep-menu') === menu(),
    'popup extends above the footer without being clipped'
  )
  const text = document
    .querySelector('.collapsed-song-card[aria-hidden="false"] > div')
    .getBoundingClientRect()
  const controls = document.querySelector('.ep-footer-actions').getBoundingClientRect()
  check(
    text.right <= controls.left - 3,
    'song information leaves room for collapsed controls and more'
  )
  document.querySelector('#app').style.width = '360px'
  window.footerPlayer.positionFormatted = '01:20:00'
  window.footerPlayer.durationFormatted = '04:00:00'
  await wait()
  check(
    document
      .querySelector('.collapsed-song-card[aria-hidden="false"] > div')
      .getBoundingClientRect().right <=
      document.querySelector('.ep-footer-actions').getBoundingClientRect().left - 3,
    'narrow collapsed footer reserves space when time labels grow'
  )
  check(
    document.querySelector('.ep-footer-toggle').getBoundingClientRect().right <=
      document.querySelector('.ep-footer').getBoundingClientRect().right,
    'collapsed controls remain inside a narrow footer'
  )
  document.querySelector('#app').style.width = ''
  window.footerPlayer.positionFormatted = '01:20'
  window.footerPlayer.durationFormatted = '04:00'
  await wait()
  action('.ep-footer-menu-mode').click()
  await wait()
  check(
    window.footerPlayer.playMode === 1 && !window.footerUi.showPlayer,
    'collapsed menu playback mode remains actionable'
  )
  const volume = action('#footer-menu-volume')
  volume.value = '65'
  volume.dispatchEvent(new Event('input', { bubbles: true }))
  await wait()
  check(window.footerPlayer.volume === 0.65, 'collapsed menu volume controls the player')
  action('.ep-footer-menu-queue').click()
  await wait()
  check(
    !!document.querySelector('[data-fixture-dialog="PlayQueueDrawer"]') && !menu(),
    'queue action opens the drawer and closes the menu'
  )
  document.querySelector('[data-fixture-dialog="PlayQueueDrawer"] button').click()
  await wait()
  more().click()
  await wait()
  window.footerUi.autoHideFooter = true
  window.dispatchEvent(new PointerEvent('pointermove', { clientY: 0 }))
  await wait(180)
  check(
    !document.querySelector('.app-footer-shell').style.transform.includes('100%'),
    'an open collapsed menu prevents footer auto-hide'
  )
  document.body.click()
  await wait(180)
  check(
    !menu() && document.querySelector('.app-footer-shell').style.transform.includes('100%'),
    'outside click closes the menu and resumes auto-hide'
  )
  window.footerUi.autoHideFooter = false
  await wait()
  more().click()
  await wait()
  document.querySelector('.ep-footer-toggle').click()
  await wait()
  check(
    !!document.querySelector('.app-footer--expanded') && !menu(),
    'expanding closes the collapsed menu and restores the toolbar'
  )
  more().click()
  await wait()
  check(
    !!menu() && document.querySelectorAll('button[aria-label="更多"]').length === 1,
    'expanded footer reuses the same single menu entrance'
  )
  check(errors.length === 0, 'no Vue errors: ' + errors.join('; '))
  mounted.unmount()
  return checks
}

app.whenReady().then(async () => {
  let win
  try {
    const styles = []
    const bundle = await esbuild.build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `export * as Vue from 'vue';export {createI18n} from 'vue-i18n';export {createRouter,createMemoryHistory} from 'vue-router';export {default as Footer} from './src/renderer/src/views/layout/footbar/Index.vue';export {default as zh} from './src/renderer/src/i18n/locales/zh';`
      },
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      globalName: 'Fixture',
      alias: {
        '@': path.resolve('src/renderer/src'),
        vue: require.resolve('vue/dist/vue.esm-bundler.js')
      },
      define: {
        __VUE_OPTIONS_API__: 'true',
        __VUE_PROD_DEVTOOLS__: 'false',
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
        __APP_VERSION__: '"fixture"',
        __APP_BUILD__: '"fixture"'
      },
      plugins: [
        {
          name: 'footer-fixture',
          setup(build) {
            const mocks = {
              '/stores/ui/uiStore': 'export const useUIStore=()=>window.footerUi',
              '/stores/player/playerStore': 'export const usePlayerStore=()=>window.footerPlayer',
              '/components/ui/useMessage':
                'export const useMessage=()=>({error:message=>{throw Error(message)}})',
              '/services/lyricSourceOptions': 'export const loadLyricSourceOptions=async()=>[]'
            }
            build.onResolve({ filter: /.*/ }, (args) => {
              const key = Object.keys(mocks).find((key) => args.path.endsWith(key))
              if (key) return { path: key, namespace: 'fixture' }
            })
            build.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
              contents: mocks[args.path],
              loader: 'js'
            }))
            build.onLoad(
              {
                filter:
                  /(?:BaseDialog|PlayQueueDrawer|SongDetailsDialog|SongTagDialog|AddSongsToPlaylistDialog)\.vue$/
              },
              ({ path: filename }) => ({
                contents: `import {h} from 'vue';export default {inheritAttrs:false,props:['modelValue'],emits:['update:modelValue'],render(){return this.modelValue?h('div',{'data-fixture-dialog':${JSON.stringify(path.basename(filename, '.vue'))}},[h('button',{onClick:()=>this.$emit('update:modelValue',false)},'Close')]):null}}`,
                loader: 'js'
              })
            )
            build.onLoad({ filter: /\.vue$/ }, ({ path: filename }) => {
              const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
              styles.push(
                ...descriptor.styles.map(
                  (style) =>
                    compileStyle({
                      source: style.content,
                      filename,
                      id: 'data-v-footer-fixture',
                      scoped: style.scoped
                    }).code
                )
              )
              return {
                contents:
                  compileScript(descriptor, {
                    id: 'footer-fixture',
                    inlineTemplate: true,
                    genDefaultAs: '__sfc__'
                  }).content +
                  (descriptor.styles.some((style) => style.scoped)
                    ? ';__sfc__.__scopeId="data-v-footer-fixture";'
                    : ';') +
                  'export default __sfc__',
                loader: 'ts',
                resolveDir: path.dirname(filename)
              }
            })
          }
        }
      ]
    })
    win = new BrowserWindow({
      show: false,
      width: 900,
      height: 800,
      webPreferences: { offscreen: true, backgroundThrottling: false }
    })
    win.webContents.on('console-message', (event) => {
      if (!event.message.includes('Security Warning')) console.log(event.message)
    })
    const fixture = path.join(app.getPath('userData'), 'index.html')
    fs.writeFileSync(
      fixture,
      '<html><head></head><body><div id="app" style="position:fixed;inset:auto 0 0;height:auto;min-height:0"></div></body></html>'
    )
    await win.loadFile(fixture)
    const assets = 'out/renderer/assets'
    const css = fs.readFileSync(
      path.join(
        assets,
        fs.readdirSync(assets).find((file) => /^main-.*\.css$/.test(file))
      ),
      'utf8'
    )
    const currentStyles = fs.readFileSync('src/renderer/src/styles/components.css', 'utf8')
    await win.webContents.executeJavaScript(
      `document.documentElement.classList.add('dark','reduce-motion');const style=document.createElement('style');style.textContent=${JSON.stringify(css + '\n' + currentStyles + '\n' + styles.join('\n'))};document.head.append(style)`
    )
    await win.webContents.executeJavaScript(bundle.outputFiles[0].text)
    const checks = await win.webContents.executeJavaScript(
      `(${runChecks.toString()})().catch(error=>{console.error(error.stack);throw error})`
    )
    console.log(JSON.stringify({ passed: checks.length, checks }, null, 2))
    win.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    win?.destroy()
    app.exit(1)
  }
})
