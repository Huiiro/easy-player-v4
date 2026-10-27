/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Isolated JavaScript fixture executed in Chromium. */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs'),
  path = require('node:path'),
  esbuild = require('esbuild')
const { parse, compileScript } = require('@vue/compiler-sfc')
app.setPath('userData', fs.mkdtempSync(path.resolve('build/list-loading-ui-')))
app.disableHardwareAcceleration()
const styles = []
const { protocol } = require('electron')
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'easy-player-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true }
  }
])
async function runChecks() {
  const {
    Vue,
    SongListView,
    LibraryBrowserGrid,
    createI18n,
    createRouter,
    createMemoryHistory,
    zh,
    RecycleScroller
  } = window.Check
  const { createApp, h, reactive, nextTick } = Vue
  const results = [],
    errors = [],
    check = (ok, message) => {
      if (!ok) throw Error(message)
      results.push(message)
    }
  const wait = async (ms = 80) => {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, ms))
  }
  window.ui = reactive({
    compactSongList: false,
    musicSource: 'all',
    artistSeparator: '/',
    genreSeparator: '/',
    librarySortOrder: { artist: 'asc', album: 'asc', genre: 'asc' },
    libraryCardSize: { artist: 176, album: 176, genre: 176 }
  })
  window.player = { currentQueueSong: null }
  let resolveSong, resolveGrid, activeApp
  window.songQuery = () =>
    new Promise((resolve) => {
      resolveSong = resolve
    })
  window.api = {
    database: {
      onSearchIndexChanged: () => () => {},
      command: async (action) =>
        action === 'listSources'
          ? { success: true, data: [] }
          : new Promise((resolve) => {
              resolveGrid = resolve
            })
    }
  }
  async function mount(component, props = {}) {
    activeApp?.unmount()
    document.querySelector('#app').innerHTML = ''
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { render: () => null } }]
    })
    await router.push('/')
    await router.isReady()
    activeApp = createApp({ render: () => h(component, props) })
    activeApp.config.errorHandler = (error) => errors.push(String(error))
    activeApp.use(router).use(createI18n({ legacy: false, locale: 'zh', messages: { zh } }))
    activeApp
      .component('SvgIcon', window.Check.SvgIcon)
      .component('RecycleScroller', RecycleScroller)
    activeApp.mount('#app')
    await wait()
  }
  function songFrame() {
    const scroller = document.querySelector('.vue-recycle-scroller'),
      box = scroller?.getBoundingClientRect()
    const rows = [...document.querySelectorAll('.vue-recycle-scroller__item-view')].filter(
      (row) => {
        const rect = row.getBoundingClientRect()
        return (
          getComputedStyle(row).visibility !== 'hidden' &&
          rect.bottom > box.top &&
          rect.top < box.bottom
        )
      }
    )
    return {
      loading: document.querySelector('section').getAttribute('aria-busy') === 'true',
      rows: rows.length,
      top: scroller?.scrollTop,
      ready: scroller?.classList.contains('ready')
    }
  }
  async function sampleFrames(read, action) {
    const frames = []
    let complete
    const done = new Promise((resolve) => {
      complete = resolve
    })
    const tick = () => {
      frames.push(read())
      if (frames.length < 8) requestAnimationFrame(tick)
      else complete()
    }
    tick()
    action()
    await done
    return frames
  }
  const songs = Array.from({ length: 200 }, (_, index) => ({
    id: index + 1,
    title: '歌曲 ' + index,
    artist: 'Artist',
    album: 'Album',
    duration: 180,
    audio: index + '.flac',
    sourceId: null,
    songStatus: 1
  }))
  await mount(SongListView)
  const scroller = document.querySelector('.vue-recycle-scroller')
  check(
    !!scroller && scroller.clientHeight > 500 && scroller.classList.contains('ready'),
    'real virtual scroller mounts and measures during blank loading'
  )
  check(
    !document.querySelector('[role=status]') &&
      !document.querySelector('.ep-skeleton') &&
      getComputedStyle(scroller).visibility === 'hidden',
    'initial song loading stays blank without skeleton or empty message'
  )
  const initialFrames = await sampleFrames(songFrame, () => resolveSong(songs))
  check(
    initialFrames.every((frame) => frame.loading || frame.rows >= 10),
    'completed loading reveals a fully rendered virtual viewport'
  )
  check(
    document.querySelector('.vue-recycle-scroller') === scroller,
    'song result handoff preserves scroller instance'
  )
  scroller.scrollTop = 640
  scroller.dispatchEvent(new Event('scroll'))
  await wait()
  document.querySelector('header button[aria-label="刷新"]').click()
  await wait()
  check(
    !document.querySelector('[role=status]') &&
      getComputedStyle(scroller).visibility === 'hidden' &&
      scroller.inert &&
      scroller.scrollTop === 640,
    'song refresh stays blank while retaining rows and scroll'
  )
  const refreshedFrames = await sampleFrames(songFrame, () =>
    resolveSong(songs.map((song) => ({ ...song, title: '更新 ' + song.id })))
  )
  check(
    refreshedFrames.every((frame) => (frame.loading || frame.rows > 0) && frame.top === 640),
    'song refresh reveals retained viewport without remount or scroll reset'
  )
  const search = document.querySelector('header input')
  search.value = '更新'
  search.dispatchEvent(new Event('input', { bubbles: true }))
  await wait(260)
  resolveSong(songs)
  await wait()
  check(
    scroller.scrollTop === 0 && !scroller.inert,
    'new song query resets scroll before becoming interactive'
  )
  search.value = 'none'
  search.dispatchEvent(new Event('input', { bubbles: true }))
  await wait(260)
  resolveSong([])
  await wait()
  check(
    document.querySelector('[role=status]').textContent.includes('暂无歌曲') &&
      getComputedStyle(scroller).visibility === 'hidden',
    'empty song result replaces content once after query completion'
  )
  document.querySelector('header button[aria-label="刷新"]').click()
  await wait()
  check(
    !document.querySelector('[role=status]') &&
      !document.querySelector('.ep-skeleton') &&
      scroller.clientHeight > 500 &&
      getComputedStyle(scroller).visibility === 'hidden',
    'empty list refresh stays blank while retaining measurable scroller'
  )
  resolveSong(songs)
  await wait()
  window.ui.compactSongList = true
  await wait()
  check(
    [...document.querySelectorAll('.vue-recycle-scroller__item-view')]
      .filter((row) => getComputedStyle(row).visibility !== 'hidden')
      .every((row) => row.getBoundingClientRect().height === 56),
    'retained virtual scroller still adapts to compact rows'
  )

  const artistData = Array.from({ length: 100 }, (_, index) => ({
    artistName: '歌手 ' + index,
    songCount: 2,
    artistCover: 'fixture-cover.svg'
  }))
  await mount(LibraryBrowserGrid, { kind: 'artist' })
  const grid = document.querySelector('section .custom-scrollbar'),
    firstGrid = grid
  check(
    grid.clientHeight > 500 &&
      !document.querySelector('[role=status]') &&
      !document.querySelector('.ep-skeleton') &&
      getComputedStyle(grid).visibility === 'hidden',
    'artist loading stays blank while keeping grid measurable'
  )
  const gridFrame = () => ({
    loading: document.querySelector('section').getAttribute('aria-busy') === 'true',
    visible:
      getComputedStyle(document.querySelector('section .custom-scrollbar')).visibility !== 'hidden',
    cards: document.querySelectorAll('.ep-library-artwork').length,
    top: document.querySelector('section .custom-scrollbar').scrollTop
  })
  const gridFrames = await sampleFrames(gridFrame, () =>
    resolveGrid({ success: true, data: artistData })
  )
  check(
    gridFrames.every((frame) => frame.loading || (frame.cards === 100 && frame.visible)),
    'artist loading reveals complete grid after data is ready'
  )
  grid.scrollTop = 500
  grid.dispatchEvent(new Event('scroll'))
  await wait(180)
  const image = grid.querySelector('img'),
    imageSource = image?.getAttribute('src'),
    firstCard = grid.firstElementChild
  check(!!image, 'visible artwork is observed and loaded')
  document.querySelector('header button[aria-label="刷新"]').click()
  await wait()
  check(
    !document.querySelector('[role=status]') &&
      getComputedStyle(grid).visibility === 'hidden' &&
      document.querySelector('section .custom-scrollbar') === firstGrid &&
      grid.firstElementChild === firstCard,
    'artist refresh stays blank while retaining mounted grid and cards'
  )
  check(
    grid.querySelector('img') === image && image.getAttribute('src') === imageSource,
    'artist refresh retains visible artwork instead of flashing placeholders'
  )
  const refreshFrames = await sampleFrames(gridFrame, () =>
    resolveGrid({ success: true, data: artistData.map((item) => ({ ...item })) })
  )
  check(
    refreshFrames.every(
      (frame) => frame.cards === 100 && frame.top === 500 && (frame.loading || frame.visible)
    ),
    'artist refresh reveals retained cards at the same scroll position'
  )
  check(
    grid.querySelector('img') === image && grid.firstElementChild === firstCard,
    'unchanged card and image nodes survive refresh completion'
  )
  await mount(LibraryBrowserGrid, { kind: 'artist' })
  const restored = await sampleFrames(gridFrame, () =>
    resolveGrid({ success: true, data: artistData })
  )
  check(
    restored.filter((frame) => !frame.loading).every((frame) => frame.top === 500 && frame.visible),
    'saved artist scroll is restored before the first content frame'
  )
  const librarySearch = document.querySelector('header input')
  librarySearch.value = 'none'
  librarySearch.dispatchEvent(new Event('input', { bubbles: true }))
  await wait()
  resolveGrid({ success: true, data: [] })
  await wait()
  check(
    document.querySelector('[role=status]')?.textContent.trim() === zh.library.empty &&
      document.querySelector('section .custom-scrollbar').scrollTop === 0,
    'new library query resets scroll and shows empty state after completion'
  )
  check(errors.length === 0, 'no Vue errors: ' + errors.join('; '))
  activeApp.unmount()
  return results
}

app.whenReady().then(async () => {
  try {
    protocol.handle(
      'easy-player-media',
      () =>
        new Response(
          '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#497eb1"/></svg>',
          { headers: { 'Content-Type': 'image/svg+xml' } }
        )
    )
    const bundle = await esbuild.build({
      stdin: {
        resolveDir: process.cwd(),
        contents:
          "export {RecycleScroller} from 'vue-virtual-scroller';export * as Vue from 'vue';export {createI18n} from 'vue-i18n';export {createRouter,createMemoryHistory} from 'vue-router';export {default as SongListView} from './src/renderer/src/components/songlist/SongListView.vue';export {default as LibraryBrowserGrid} from './src/renderer/src/components/library/LibraryBrowserGrid.vue';export {default as SvgIcon} from './src/renderer/src/components/svg/SvgIcon.vue';export {default as zh} from './src/renderer/src/i18n/locales/zh';"
      },
      bundle: true,
      write: false,
      format: 'iife',
      globalName: 'Check',
      platform: 'browser',
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
            const mocks = {
              '/stores/ui/uiStore': 'export const useUIStore=()=>window.ui',
              '/stores/player/playerStore': 'export const usePlayerStore=()=>window.player',
              '/stores/statistics/statisticsStore':
                'export const useStatisticsStore=()=>({generation:0,enabled:false})',
              '/services/songListQuery': 'export const querySongList=()=>window.songQuery()',
              '/services/searchPlayback': 'export const playSearchResult=()=>{}',
              '/components/ui/useMessage':
                'export const useMessage=()=>({success(){},warning(){},error(){}})'
            }
            build.onResolve({ filter: /.*/ }, (args) => {
              const key = Object.keys(mocks).find((key) => args.path.endsWith(key))
              if (key) return { path: key, namespace: 'mock' }
            })
            build.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({
              contents: mocks[args.path],
              loader: 'js'
            }))
            build.onLoad({ filter: /(?:SongListActions|TagManagerDialog)\.vue$/ }, () => ({
              contents:
                'export default {setup(_,{expose}){expose({closeMenu(){}});return()=>null}}',
              loader: 'js'
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
      width: 1120,
      height: 780,
      webPreferences: { sandbox: true, offscreen: true, backgroundThrottling: false }
    })
    win.webContents.on('console-message', (event) => {
      if (!event.message.includes('Security Warning')) console.log(event.message)
    })
    const fixture = path.join(app.getPath('userData'), 'index.html')
    fs.writeFileSync(fixture, '<html><body><div id="app" style="height:100vh"></div></body></html>')
    await win.loadFile(fixture)
    await win.webContents.executeJavaScript(bundle.outputFiles[0].text)
    const css = fs.readFileSync(
      path.join(
        'out/renderer/assets',
        fs.readdirSync('out/renderer/assets').find((file) => /^main-.*\.css$/.test(file))
      ),
      'utf8'
    )
    await win.webContents.executeJavaScript(
      'const style=document.createElement("style");style.textContent=' +
        JSON.stringify(
          css +
            '\n' +
            fs.readFileSync(
              'node_modules/vue-virtual-scroller/dist/vue-virtual-scroller.css',
              'utf8'
            ) +
            '\n' +
            styles.join('\n')
        ) +
        ';document.head.append(style);window.requestAnimationFrame=fn=>setTimeout(()=>fn(performance.now()),16);window.cancelAnimationFrame=clearTimeout;void 0'
    )
    const checks = await win.webContents.executeJavaScript('(' + runChecks.toString() + ')()')
    console.log(JSON.stringify({ passed: checks.length, checks }, null, 2))
    win.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
