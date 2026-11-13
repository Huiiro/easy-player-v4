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
  const {
    Vue,
    Footer,
    createI18n,
    createRouter,
    createMemoryHistory,
    zh,
    mountLiquidGlassStudio,
    STUDIO_BLUR_RADIUS,
    studioBlurSigma
  } = window.Fixture
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
  const footer = document.querySelector('.ep-footer')
  const playback = () => footer.querySelector('.playback-button')
  const sample = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  const channels = (color) => {
    sample.clearRect(0, 0, 1, 1)
    sample.fillStyle = color
    sample.fillRect(0, 0, 1, 1)
    return [...sample.getImageData(0, 0, 1, 1).data].slice(0, 3)
  }
  for (const [surface, expected] of [
    ['#101416', 255],
    ['#ffffff', 0],
    ['#f5f5f5', 0],
    ['#e0e0e0', 0],
    ['#f0e8df', 0],
    ['#e8eef7', 0],
    ['#b0b0b0', 255],
    ['#28b5f0', 255],
    ['#ffdf67', 255]
  ]) {
    playback().style.setProperty('--btn-primary-bg', surface)
    playback().style.setProperty('--btn-primary-bg-hover', surface)
    footer.style.setProperty('--app-footer-bg', expected ? '#fff' : '#101416')
    await wait()
    const style = getComputedStyle(playback())
    check(
      channels(style.backgroundColor).every(
        (value, index) => Math.abs(value - channels(surface)[index]) < 2
      ),
      'Theme playback fill remains ' + surface
    )
    check(
      channels(style.color).every((value) => Math.abs(value - expected) < 2),
      'Contrasting playback icon on ' + surface
    )
  }
  footer.style.removeProperty('--app-footer-bg')
  playback().style.removeProperty('--btn-primary-bg')
  playback().style.removeProperty('--btn-primary-bg-hover')
  const initialButton = playback().getBoundingClientRect()
  const initialIcon = playback().querySelector('svg').getBoundingClientRect()
  check(
    playback().querySelector('use')?.getAttribute('xlink:href') === '#icon-play-play',
    'Playback reuses the existing play SVG'
  )
  for (let index = 0; index < 12; index++) {
    playback().click()
    await wait(20)
    check(
      playback().querySelector('use')?.getAttribute('xlink:href') ===
        (window.footerPlayer.isPlaying ? '#icon-play-pause' : '#icon-play-play'),
      'Playback state selects the existing SVG asset'
    )
    check(!window.footerUi.showPlayer, 'Playback click does not open the player')
    for (const [rect, initial] of [
      [playback().getBoundingClientRect(), initialButton],
      [playback().querySelector('svg').getBoundingClientRect(), initialIcon]
    ])
      check(
        ['x', 'y', 'width', 'height'].every((key) => Math.abs(rect[key] - initial[key]) < 0.1),
        'Footer playback geometry stays fixed while toggling'
      )
  }
  const more = () => document.querySelector('button[aria-label="更多"]')
  const menu = () => document.querySelector('.ep-footer-more-menu')
  const action = (selector) => menu().querySelector(selector)
  const expandedHeight = document.querySelector('.ep-footer').getBoundingClientRect().height
  document.querySelector('.ep-footer-toggle').click()
  await wait()
  check(
    !!document.querySelector('.app-footer--collapsed') && !!more(),
    'collapsed footer retains one more-menu trigger'
  )
  check(
    playback()?.classList.contains('playback-button--compact'),
    'Collapsed footer uses the same themed playback control'
  )
  check(
    document.querySelector('.ep-footer').getBoundingClientRect().height === expandedHeight,
    'collapsed and expanded Footer keep the same height'
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
  const naturalMenuHeight = menu().querySelector('.ep-footer-more-list').scrollHeight + 2
  check(
    Math.abs(box.height - Math.min(naturalMenuHeight, 480, innerHeight * 0.7)) < 1,
    'more menu is filled by its content up to the viewport height limit'
  )
  check(
    Math.abs(document.querySelector('.ep-footer').getBoundingClientRect().top - box.bottom - 6) < 1,
    'menu clears the Footer top edge by a stable gap'
  )
  check(
    box.top >= 0 &&
      document.elementFromPoint(box.left + 10, box.top + 10)?.closest('.ep-menu') === menu(),
    'popup extends above the footer without being clipped'
  )
  check(
    menu().closest('.ep-floating').parentElement === document.body,
    'more menu is outside the footer backdrop root'
  )
  const glass = mountLiquidGlassStudio()
  await wait(200)
  const blurRadius = () => {
    const value = getComputedStyle(menu()).backdropFilter
    const id = value.match(/#([^"')]+)/)?.[1]
    return id
      ? Number(
          document.getElementById(id)?.querySelector('feGaussianBlur')?.getAttribute('stdDeviation')
        )
      : Number(value.match(/blur\(([\d.]+)px\)/)?.[1])
  }
  check(
    Math.abs(blurRadius() - studioBlurSigma(STUDIO_BLUR_RADIUS, devicePixelRatio)) < 1e-4,
    'more menu uses the configured floating glass blur'
  )
  check(
    !menu().parentElement.closest('[data-ep-studio-surface]'),
    'menu blur can sample the page without an enclosing glass surface'
  )
  document.documentElement.style.setProperty('--ep-glass-floating-blur-radius', '24')
  await wait(150)
  check(
    Math.abs(blurRadius() - studioBlurSigma(24, devicePixelRatio)) < 1e-4,
    'plugin floating blur token also updates the footer menu'
  )
  document.documentElement.style.removeProperty('--ep-glass-floating-blur-radius')
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
  const expandedMenu = menu().getBoundingClientRect()
  check(
    expandedMenu.height < box.height && Math.abs(expandedMenu.bottom - box.bottom) < 1,
    'menu naturally shrinks with fewer items while its bottom stays aligned'
  )
  document.body.click()
  await wait()
  const toolbar = document.querySelector('.ep-footer-actions')
  const categories = ['volume', 'queue', 'mode', 'like', 'lyrics', 'dislike']
  const thresholds = { volume: 72, queue: 112, mode: 152, like: 192, lyrics: 232, dislike: 272 }
  const visible = (element) => getComputedStyle(element).display !== 'none'
  check(
    categories.every((category) =>
      visible(document.querySelector('.ep-footer-action-' + category))
    ),
    'default layout exposes all action icons at 1280px, including likes and desktop lyrics'
  )
  more().click()
  await wait()
  for (const width of [71, 72, 111, 112, 151, 152, 191, 192, 231, 232, 271, 272]) {
    toolbar.style.maxWidth = width + 'px'
    await wait()
    const available = toolbar.clientWidth
    for (const category of categories) {
      const shown = visible(document.querySelector('.ep-footer-action-' + category))
      check(
        shown === available >= thresholds[category],
        category + ' fits its own width threshold at ' + width
      )
      check(
        visible(action('.ep-footer-menu-' + category)) === !shown,
        category + ' remains available exactly once across toolbar and menu at ' + width
      )
    }
    const boxes = [...toolbar.children]
      .filter(visible)
      .map((e) => e.getBoundingClientRect())
      .sort((a, b) => a.left - b.left)
    const bounds = toolbar.getBoundingClientRect()
    check(
      boxes.every(
        (box, index) =>
          box.left >= bounds.left - 1 &&
          box.right <= bounds.right + 1 &&
          (!index || boxes[index - 1].right <= box.left)
      ),
      'toolbar icons fit without overlap at ' + width
    )
    check(
      boxes.length === Math.min(7, Math.floor((available + 8) / 40)),
      'toolbar uses every available icon slot at ' + width
    )
  }
  toolbar.style.maxWidth = ''
  document.body.click()
  await wait()
  const volumeTrigger = document.querySelector('.ep-footer-action-volume button')
  const actions = document.querySelector('.ep-footer-actions')
  actions.style.maxWidth = '60px'
  await wait()
  check(
    getComputedStyle(volumeTrigger.parentElement).display === 'none',
    'narrow toolbar still hides the tooltip trigger in favor of the menu'
  )
  actions.style.maxWidth = ''
  await wait()
  volumeTrigger.focus()
  await wait()
  const tooltip = document.querySelector('.ep-tooltip')
  check(
    !!tooltip && tooltip.closest('.ep-floating').parentElement === document.body,
    'expanded volume uses the shared teleported tooltip'
  )
  const slider = tooltip.querySelector('input')
  slider.value = '75'
  slider.dispatchEvent(new Event('input', { bubbles: true }))
  await wait()
  check(window.footerPlayer.volume === 0.75, 'tooltip volume updates the actual player')
  slider.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, bubbles: true, cancelable: true }))
  await wait()
  check(window.footerPlayer.volume === 0.8, 'tooltip wheel retains the volume step')
  window.footerUi.autoHideFooter = true
  window.dispatchEvent(new PointerEvent('pointermove', { clientY: 0 }))
  await wait(180)
  check(
    !document.querySelector('.app-footer-shell').style.transform.includes('100%'),
    'open volume tooltip prevents footer auto-hide outside the footer'
  )
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await wait(200)
  check(
    !document.querySelector('.ep-tooltip') &&
      document.querySelector('.app-footer-shell').style.transform.includes('100%'),
    'closing volume tooltip resumes footer auto-hide'
  )
  window.footerUi.autoHideFooter = false
  check(errors.length === 0, 'no Vue errors: ' + errors.join('; '))
  window.finishFooterChecks = () => {
    mounted.unmount()
    glass.dispose()
  }
  return checks
}

app.whenReady().then(async () => {
  let win
  try {
    const styles = []
    const bundle = await esbuild.build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `export * as Vue from 'vue';export {createI18n} from 'vue-i18n';export {createRouter,createMemoryHistory} from 'vue-router';export {default as Footer} from './src/renderer/src/views/layout/footbar/Index.vue';export {default as zh} from './src/renderer/src/i18n/locales/zh';export {mountLiquidGlassStudio} from './src/renderer/src/services/liquidGlassStudio';export {STUDIO_BLUR_RADIUS,studioBlurSigma} from './src/renderer/src/services/liquidGlassProfile';`
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
            build.onResolve({ filter: /\.glsl\?raw$/ }, (args) => ({
              path: path.resolve(args.resolveDir, args.path.slice(0, -4)),
              namespace: 'raw-glsl'
            }))
            build.onLoad({ filter: /.*/, namespace: 'raw-glsl' }, (args) => ({
              contents: fs.readFileSync(args.path, 'utf8'),
              loader: 'text'
            }))
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
      width: 1280,
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
    win.webContents.debugger.attach('1.3')
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
      enabled: true
    })
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
    win.setContentSize(900, 600)
    await new Promise((resolve) => setTimeout(resolve, 100))
    await win.webContents.executeJavaScript(`(async()=>{
      document.querySelector('.ep-footer-toggle').click();await new Promise(r=>setTimeout(r,100));
      document.querySelector('button[aria-label="更多"]').click();await new Promise(r=>setTimeout(r,100));
      const library=document.createElement('div');library.id='wheel-library';library.style.cssText='position:fixed;inset:0 0 110px;overflow:auto';library.innerHTML='<div style="height:6000px"></div>';document.body.append(library);
      window.footerAnchorReads=0;const anchor=document.querySelector('button[aria-label="更多"]').parentElement,read=anchor.getBoundingClientRect;anchor.getBoundingClientRect=function(){footerAnchorReads++;return read.call(this)};
    })()`)
    const readMenu = () =>
      win.webContents.executeJavaScript(
        `(()=>{const e=document.querySelector('.ep-footer-more-menu'),r=e.getBoundingClientRect(),list=e.querySelector('.ep-footer-more-list');return {top:r.top,left:r.left,width:r.width,height:r.height,scroll:list.scrollTop,scrollHeight:list.scrollHeight,clientHeight:list.clientHeight,footerHeight:document.querySelector('.ep-footer').getBoundingClientRect().height}})()`
      )
    const beforeWheel = await readMenu()
    if (beforeWheel.scrollHeight <= beforeWheel.clientHeight)
      throw Error('wheel fixture needs overflowing menu content')
    const wheelChecks = []
    for (let index = 0; index < 6; index++) {
      win.webContents.sendInputEvent({
        type: 'mouseWheel',
        x: Math.round(beforeWheel.left + 80),
        y: Math.round(beforeWheel.top + 100),
        deltaX: 0,
        deltaY: -90,
        canScroll: true,
        hasPreciseScrollingDeltas: false
      })
      await new Promise((resolve) => setTimeout(resolve, 40))
      wheelChecks.push(await readMenu())
    }
    if (!wheelChecks.some((r) => r.scroll > 0)) throw Error('real wheel input must scroll the menu')
    await win.webContents.executeJavaScript('footerAnchorReads=0;void 0')
    for (let index = 0; index < 5; index++) {
      win.webContents.sendInputEvent({
        type: 'mouseWheel',
        x: 20,
        y: 100,
        deltaX: 0,
        deltaY: -120,
        canScroll: true,
        hasPreciseScrollingDeltas: false
      })
      await new Promise((resolve) => setTimeout(resolve, 40))
      wheelChecks.push(await readMenu())
    }
    for (const state of wheelChecks)
      for (const key of ['top', 'left', 'width', 'height'])
        if (Math.abs(state[key] - beforeWheel[key]) > 0.1)
          throw Error('wheel moved the menu: ' + JSON.stringify({ beforeWheel, state }))
    if ((await win.webContents.executeJavaScript('footerAnchorReads')) !== 0)
      throw Error('sibling scrolling must not remeasure the fixed Footer anchor')
    checks.push(
      'real menu wheel scrolls only the list; menu position and height stay fixed',
      'sibling page wheel neither repositions nor remeasures the Footer menu'
    )
    win.setContentSize(540, 480)
    await new Promise((resolve) => setTimeout(resolve, 180))
    const small = await readMenu()
    if (
      small.top < 7 ||
      small.left < 7 ||
      small.top + small.height > 480 ||
      small.height > 480 * 0.7 + 1 ||
      small.footerHeight !== beforeWheel.footerHeight
    )
      throw Error(
        'small viewport must constrain the menu while keeping Footer height: ' +
          JSON.stringify(small)
      )
    checks.push('small viewport bounds the menu while preserving Footer height')
    fs.writeFileSync(
      path.resolve('build/footer-fixed-height.png'),
      (await win.webContents.capturePage()).toPNG()
    )
    await win.webContents.executeJavaScript('finishFooterChecks();void 0')
    console.log(JSON.stringify({ passed: checks.length, checks }, null, 2))
    win.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    win?.destroy()
    app.exit(1)
  }
})
