/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Isolated JavaScript fixture executed in Chromium. */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs'),
  path = require('node:path'),
  esbuild = require('esbuild')
const { parse, compileScript, compileStyle } = require('@vue/compiler-sfc')
app.setPath('userData', fs.mkdtempSync(path.resolve('build/scroll-position-ui-')))
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
    AppPageOutlet,
    createI18n,
    createRouter,
    createMemoryHistory,
    useRoute,
    zh,
    RecycleScroller
  } = window.Check
  const { createApp, h, reactive, nextTick } = Vue
  const checks = [],
    errors = []
  const check = (ok, message) => {
    if (!ok) throw Error(message)
    checks.push(message)
  }
  const wait = async (ms = 80) => {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, ms))
  }
  const until = async (test, message) => {
    for (let i = 0; i < 120; i++) {
      if (test()) return
      await wait(20)
    }
    throw Error(message)
  }
  sessionStorage.clear()
  window.ui = reactive({
    compactSongList: false,
    smallSongList: false,
    musicSource: 'all',
    musicSourceId: 0,
    artistSeparator: '/',
    genreSeparator: '/',
    albumGroupByName: false,
    songListColumns: { genre: true, year: true, playTimes: true },
    librarySortOrder: { artist: 'asc', album: 'asc', genre: 'asc' },
    librarySortBy: { artist: 'name', album: 'name', genre: 'name' },
    libraryCardSize: { artist: 176, album: 176, genre: 176 }
  })
  window.player = { currentQueueSong: null }
  const songs = Array.from({ length: 240 }, (_, i) => ({
    id: i + 1,
    title: 'Track ' + i,
    artist: 'Artist',
    album: 'Album',
    duration: 180,
    audio: i + '.flac',
    sourceId: null,
    songStatus: 1
  }))
  const gridRows = Array.from({ length: 150 }, (_, i) => ({
    artistName: 'Artist ' + i,
    albumName: 'Album ' + i,
    name: 'Genre ' + i,
    songCount: 3,
    count: 3,
    albumCover: null,
    artistCover: null
  }))
  let hold = false,
    songCount = songs.length
  const pending = [],
    mounts = {},
    requests = []
  window.songQuery = (options) => {
    requests.push(options.source)
    return hold
      ? new Promise((resolve) => pending.push(() => resolve(songs.slice(0, songCount))))
      : Promise.resolve(songs.slice(0, songCount))
  }
  window.api = {
    database: {
      onSearchIndexChanged: () => () => {},
      command: async (action) => {
        if (action === 'listSources') return { success: true, data: [] }
        return hold
          ? new Promise((resolve) => pending.push(() => resolve({ success: true, data: gridRows })))
          : { success: true, data: gridRows }
      }
    }
  }
  const listPage = (source) => ({
    setup() {
      mounts[JSON.stringify(source)] = (mounts[JSON.stringify(source)] || 0) + 1
      return () =>
        h(SongListView, {
          source,
          'data-page':
            source.type === 'songs'
              ? '/song'
              : ['artist', 'album', 'genre'].includes(source.type)
                ? '/' + source.type + '/detail'
                : '/' + source.type
        })
    }
  })
  const routes = [
    { path: '/song', name: 'Song', component: listPage({ type: 'songs' }) },
    ...['artist', 'album', 'genre'].map((kind) => ({
      path: '/' + kind,
      name: kind,
      component: {
        setup() {
          mounts[kind] = (mounts[kind] || 0) + 1
          return () => h(LibraryBrowserGrid, { kind, 'data-page': '/' + kind })
        }
      }
    })),
    ...['liked', 'history'].map((type) => ({
      path: '/' + type,
      name: type,
      component: listPage({ type })
    })),
    {
      path: '/playlist/:id',
      name: 'Playlist',
      meta: { keepAlive: false },
      component: {
        setup() {
          const route = useRoute()
          return () =>
            h(SongListView, {
              source: { type: 'playlist', id: Number(route.params.id) },
              'data-page': '/playlist/' + route.params.id
            })
        }
      }
    },
    ...['artist', 'album', 'genre'].map((kind) => ({
      path: '/' + kind + '/detail',
      name: kind + 'Detail',
      meta: { keepAlive: false },
      component: listPage(
        kind === 'artist'
          ? { type: kind, artist: 'A' }
          : kind === 'album'
            ? { type: kind, album: 'A', artist: 'B' }
            : { type: kind, genre: 'Rock' }
      )
    }))
  ]
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/song')
  await router.isReady()
  const app = createApp({ render: () => h(AppPageOutlet, { transition: 'none', cacheMax: 3 }) })
  app.config.errorHandler = (error) => errors.push(String(error))
  app.use(router).use(createI18n({ legacy: false, locale: 'zh', messages: { zh } }))
  app.component('SvgIcon', window.Check.SvgIcon).component('RecycleScroller', RecycleScroller)
  app.mount('#app')
  const container = () =>
    document.querySelector('.song-list-scroller') ||
    document.querySelector('section .custom-scrollbar')
  const ready = () =>
    document.querySelector('section[data-page]')?.getAttribute('data-page') ===
      router.currentRoute.value.path &&
    document.querySelector('section[data-page]')?.getAttribute('aria-busy') === 'false'
  const go = async (path) => {
    await router.push(path)
    await until(ready, 'Page did not load: ' + path)
    await wait(65)
  }
  const move = (top, left = 0) => {
    const el = container()
    el.scrollTo({ top, left, behavior: 'auto' })
    el.dispatchEvent(new Event('scroll'))
    return { top: el.scrollTop, left: el.scrollLeft }
  }
  const matches = (position) =>
    Math.abs(container()?.scrollTop - position.top) < 1 &&
    Math.abs(container()?.scrollLeft - position.left) < 1
  await until(ready, 'Initial song list loads')
  await wait(65)
  const initialSongElement = container(),
    songPosition = move(1333, 120)
  check(songPosition.left > 0, 'Narrow song list records horizontal scrolling too')
  check(Math.abs(songPosition.top - 1333) < 1, 'Song virtual list has a measurable scroll range')
  await go('/artist') // Leave before the throttled session-storage write.
  const artistPosition = move(777)
  await go('/album')
  const albumPosition = move(1234)
  await go('/genre')
  const genrePosition = move(456)
  await go('/song')
  check(
    container() !== initialSongElement && mounts['{"type":"songs"}'] === 2,
    'Fourth page evicts the original three-entry cached song page'
  )
  check(
    matches(songPosition),
    'Evicted song virtual list restores its vertical and horizontal position'
  )
  await go('/artist')
  check(matches(artistPosition), 'Artist grid restores after cache eviction')
  await go('/album')
  check(matches(albumPosition), 'Album grid has its own saved position')
  await go('/genre')
  check(matches(genrePosition), 'Genre grid has its own saved position')
  await go('/album')
  check(matches(albumPosition), 'Cached grid reactivation also preserves its position')
  function visibleCardAnchor() {
    const grid = container(),
      top = grid.getBoundingClientRect().top
    const element = Array.from(grid.children).find(
      (child) => child.getBoundingClientRect().bottom > top
    )
    const rect = element.getBoundingClientRect()
    return { element, fraction: (top - rect.top) / rect.height }
  }
  function anchoredNear(anchor) {
    const viewport = container().getBoundingClientRect(),
      rect = anchor.element.getBoundingClientRect()
    return (
      rect.bottom > viewport.top &&
      rect.top < viewport.bottom &&
      Math.abs((viewport.top - rect.top) / rect.height - anchor.fraction) < 0.02
    )
  }
  for (const kind of ['artist', 'album', 'genre']) {
    await go('/' + kind)
    move(2200)
    await wait()
    for (const size of [224, 176]) {
      const anchor = visibleCardAnchor()
      // Exercise the actual layout menu, including the column-count change.
      document.querySelector('header button[aria-label="' + zh.library.more + '"]').click()
      await wait(35)
      const label = size === 224 ? zh.library.largerLayout : zh.library.defaultLayout
      Array.from(document.querySelectorAll('[role=menuitem]'))
        .find((item) => item.textContent.includes(label))
        .click()
      await wait(80)
      await until(ready, 'Layout change completes')
      check(
        window.ui.libraryCardSize[kind] === size &&
          container().scrollTop > 1000 &&
          anchoredNear(anchor),
        kind + ' ' + size + ' layout keeps the visible card and partial-row offset'
      )
    }
    const retained = { top: container().scrollTop, left: container().scrollLeft }
    await go('/song')
    await go('/' + kind)
    check(matches(retained), kind + ' layout anchor is also saved for navigation')
    move(1500)
    await wait()
    const rapidAnchor = visibleCardAnchor()
    window.ui.libraryCardSize[kind] = 224
    await nextTick()
    window.ui.libraryCardSize[kind] = 176
    await nextTick()
    await wait(80)
    await until(ready, 'Rapid layout changes complete')
    check(
      container().scrollTop > 500 && anchoredNear(rapidAnchor),
      kind + ' rapid layout changes preserve the original anchor'
    )
  }
  for (const kind of ['artist', 'album', 'genre']) {
    await go('/' + kind)
    const position = move(600 + kind.length * 13)
    await go('/' + kind + '/detail')
    const detailPosition = move(900 + kind.length)
    await go('/' + kind)
    check(matches(position), kind + ' detail return restores the parent grid')
    await go('/' + kind + '/detail')
    check(matches(detailPosition), kind + ' detail song list restores after being unmounted')
  }
  await go('/playlist/1')
  const playlistOne = move(875)
  await go('/playlist/2')
  check(container().scrollTop === 0, 'A new playlist starts at its own position')
  const playlistTwo = move(1500)
  await go('/playlist/1')
  check(matches(playlistOne), 'Playlist identities do not share scroll state')
  await go('/playlist/2')
  check(matches(playlistTwo), 'Returning to the second playlist restores its position')
  for (const type of ['liked', 'history']) {
    await go('/' + type)
    const position = move(1100 + type.length)
    await go('/song')
    await go('/' + type)
    check(matches(position), type + ' song list retains independent state')
  }
  await go('/song')
  const savedSong = move(2048)
  // Force a full remount and hold its data: empty loading DOM must not erase saved positions.
  await go('/artist')
  await go('/album')
  await go('/genre')
  hold = true
  await router.push('/song')
  await wait(80)
  check(!ready() && container().scrollTop === 0, 'Remounted song page waits for asynchronous data')
  check(pending.length > 0, 'Delayed song request is held')
  hold = false
  pending.splice(0).forEach((resolve) => resolve())
  const restoredFrames = []
  for (let i = 0; i < 10; i++) {
    await new Promise(requestAnimationFrame)
    const viewport = container().getBoundingClientRect()
    const visibleRows = [...document.querySelectorAll('.vue-recycle-scroller__item-view')].filter(
      (row) => {
        const box = row.getBoundingClientRect()
        return (
          getComputedStyle(row).visibility !== 'hidden' &&
          box.bottom > viewport.top &&
          box.top < viewport.bottom
        )
      }
    ).length
    restoredFrames.push({ ready: ready(), top: container().scrollTop, visibleRows })
  }
  check(
    restoredFrames.every(
      (frame) => !frame.ready || (Math.abs(frame.top - savedSong.top) < 1 && frame.visibleRows >= 6)
    ),
    'Restored virtual rows are populated from the first visible frame'
  )
  await until(ready, 'Delayed data resolves')
  await wait(65)
  check(matches(savedSong), 'Delayed data restores the original position before revealing content')
  await go('/artist')
  await go('/album')
  await go('/genre')
  hold = true
  await router.push('/song')
  await wait(80)
  hold = false
  await go('/artist')
  pending.splice(0).forEach((resolve) => resolve())
  await wait(80)
  await go('/song')
  check(matches(savedSong), 'Loading completed on an inactive page preserves its saved viewport')

  const search = document.querySelector('header input')
  search.value = 'Track'
  search.dispatchEvent(new Event('input', { bubbles: true }))
  await wait(320)
  await until(ready, 'Search resolves')
  check(container().scrollTop === 0, 'A changed search resets its own scroll position')
  move(500)
  await go('/artist')
  await go('/album')
  await go('/genre')
  await go('/song')
  check(matches(savedSong), 'Search positions cannot overwrite the unfiltered song page')
  songCount = 5
  document.querySelector('header button[aria-label="刷新"]').click()
  await until(ready, 'Refresh after deletion completes')
  await wait(80)
  check(container().scrollTop === 0, 'Restoration clamps safely when the collection shrinks')
  check(errors.length === 0, 'No Vue errors: ' + errors.join('; '))
  app.unmount()
  await wait()
  check(
    requests.some((source) => source.type === 'playlist' && source.id === 2),
    'Tests use real source-specific song list instances'
  )
  return checks
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
          "export {default as AppPageOutlet} from './src/renderer/src/components/layout/AppPageOutlet.vue';export {useScrollPosition} from './src/renderer/src/hooks/useScrollPosition';export {useRoute} from 'vue-router';export {RecycleScroller} from 'vue-virtual-scroller';export * as Vue from 'vue';export {createI18n} from 'vue-i18n';export {createRouter,createMemoryHistory} from 'vue-router';export {default as SongListView} from './src/renderer/src/components/songlist/SongListView.vue';export {default as LibraryBrowserGrid} from './src/renderer/src/components/library/LibraryBrowserGrid.vue';export {default as SvgIcon} from './src/renderer/src/components/svg/SvgIcon.vue';export {default as zh} from './src/renderer/src/i18n/locales/zh';"
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
            let componentId = 0
            const mocks = {
              '/stores/ui/uiStore': 'export const useUIStore=()=>window.ui',
              '/stores/player/playerStore': 'export const usePlayerStore=()=>window.player',
              '/stores/statistics/statisticsStore':
                'export const useStatisticsStore=()=>({generation:0,enabled:false})',
              '/services/songListQuery':
                'export const querySongList=options=>window.songQuery(options)',
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
              const id = 'scroll-fixture-' + ++componentId
              styles.push(
                ...descriptor.styles.map(
                  (style) =>
                    compileStyle({
                      source: style.content,
                      id: 'data-v-' + id,
                      filename,
                      scoped: style.scoped
                    }).code
                )
              )
              return {
                contents:
                  compileScript(descriptor, { id, inlineTemplate: true, genDefaultAs: '__sfc__' })
                    .content +
                  ";__sfc__.__scopeId='data-v-" +
                  id +
                  "';export default __sfc__",
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
      width: 760,
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
