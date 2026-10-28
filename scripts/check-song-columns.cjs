/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Isolated JavaScript fixture executed in Chromium. */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs'),
  path = require('node:path'),
  esbuild = require('esbuild')
const { parse, compileScript, compileStyle } = require('@vue/compiler-sfc')
app.setPath('userData', fs.mkdtempSync(path.resolve('build/song-columns-ui-')))
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
  const { Vue, SongListView, createI18n, createRouter, createMemoryHistory, zh, RecycleScroller } =
    window.Check
  const { createApp, h, reactive, nextTick } = Vue
  const checks = [],
    errors = [],
    check = (ok, name) => {
      if (!ok) throw Error(name)
      checks.push(name)
    }
  const wait = async (ms = 70) => {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, ms))
  }
  let queries = 0
  window.ui = reactive({
    compactSongList: false,
    musicSource: 'all',
    artistSeparator: '/',
    genreSeparator: ';',
    normalizeMetadataSeparator: true,
    songListColumns: { genre: false, year: false, playTimes: false }
  })
  window.player = { currentQueueSong: null }
  const fixture = [
    { id: 1, year: 2000, playTimes: 2, genre: 'Pop;ROCK' },
    { id: 2, year: 2020, playTimes: 12, genre: null },
    { id: 3, year: null, playTimes: 0, genre: '' },
    { id: 4, year: 1980, playTimes: 100, genre: 'Jazz' },
    { id: 5, year: 0, playTimes: 10, genre: null },
    ...Array.from({ length: 30 }, (_, index) => ({
      id: index + 6,
      year: null,
      playTimes: 0,
      genre: null
    }))
  ].map((song) => ({
    ...song,
    title: 'Track ' + song.id,
    ...(song.id === 1
      ? {
          playTime: '2026-10-29 10:00:00',
          tags: [{ id: 1, name: 'Favorite tracks', color: '#7c3aed' }]
        }
      : {}),
    disableNetworkLyrics: true,
    instrumental: true,
    artist: 'Artist',
    album: 'Album',
    duration: 180,
    sourceId: null,
    songStatus: 1,
    audio: song.id + '.flac'
  }))
  Object.assign(
    fixture.find((song) => song.id === 35),
    {
      title: ' ',
      artist: null,
      album: '',
      duration: null,
      playTimes: undefined
    }
  )
  Object.assign(
    fixture.find((song) => song.id === 34),
    { duration: 0 }
  )
  window.songQuery = async () => {
    queries++
    return fixture.map((song) => ({ ...song }))
  }
  window.api = {
    database: {
      onSearchIndexChanged: () => () => {},
      command: async () => ({ success: true, data: [] })
    }
  }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { render: () => null } }]
  })
  await router.push('/')
  await router.isReady()
  const app = createApp({ render: () => h(SongListView) })
  app.config.errorHandler = (error) => errors.push(String(error))
  app.use(router).use(createI18n({ legacy: false, locale: 'zh', messages: { zh } }))
  app.component('SvgIcon', window.Check.SvgIcon).component('RecycleScroller', RecycleScroller)
  app.mount('#app')
  await wait(180)
  const scroller = document.querySelector('.vue-recycle-scroller')
  const rows = () =>
    [...document.querySelectorAll('.song-list-row')]
      .filter((row) => {
        const box = row.getBoundingClientRect(),
          viewport = scroller.getBoundingClientRect()
        return (
          getComputedStyle(row).visibility !== 'hidden' &&
          box.bottom > viewport.top &&
          box.top < viewport.bottom
        )
      })
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
  const cells = (row) => [...row.children]
  function aligned(name) {
    const header = document.querySelector('.song-list-columns'),
      row = rows()[0],
      headings = cells(header),
      values = cells(row)
    check(headings.length === values.length, name + ': header and item have same column count')
    check(
      headings.every(
        (heading, index) =>
          Math.abs(
            heading.getBoundingClientRect().left - values[index].getBoundingClientRect().left
          ) < 1 &&
          Math.abs(
            heading.getBoundingClientRect().width - values[index].getBoundingClientRect().width
          ) < 1
      ),
      name + ': header and data tracks align'
    )
  }
  async function menuAction(trigger, label) {
    document.querySelector('header button[aria-label="' + trigger + '"]').click()
    await wait(220)
    const option = [...document.querySelectorAll('.ep-menu-item')].find(
      (button) => button.textContent.trim().replace(/ [↑↓]$/, '') === label
    )
    check(!!option, 'menu exposes ' + label)
    if (label === '播放次数') {
      const group = option.parentElement
      check(
        group.querySelectorAll('.ep-menu-item').length === 1 &&
          group.previousElementSibling?.classList.contains('h-px'),
        'play count sort has a separate group after a divider'
      )
    }
    if (label.includes('列')) {
      const group = option.parentElement
      check(
        group.querySelectorAll('.ep-menu-item').length === (label.includes('标记') ? 4 : 3) &&
          group.previousElementSibling?.classList.contains('h-px'),
        'column toggles are grouped by information or flags after a divider'
      )
    }
    if (label === '默认') {
      check(
        ![...document.querySelectorAll('.ep-menu-item')].some((item) =>
          item.textContent.includes('编号')
        ),
        'ID sorting is labeled default'
      )
    }
    option.click()
    await wait(220)
  }
  check(
    cells(document.querySelector('.song-list-columns')).length === 5,
    'new columns are hidden by default'
  )
  aligned('default columns with vertical scrollbar')
  for (const label of ['显示流派列', '显示年份列', '显示播放次数列'])
    await menuAction('更多', label)
  check(
    ['genre', 'year', 'playTimes'].every((column) => window.ui.songListColumns[column]),
    'more menu toggles all three persisted preference fields'
  )
  aligned('all optional columns')
  check(
    cells(rows()[0])
      .slice(1)
      .every((cell) => cell.textContent.trim() === '-'),
    'missing title, artist, album, genre, year, count and duration use a short dash'
  )
  check(
    cells(rows()[1])[6].textContent.trim() === '0' &&
      cells(rows()[1])[7].textContent.trim() === '0:00',
    'real numeric zero values remain visible'
  )
  check(
    scroller.scrollWidth > scroller.clientWidth,
    'narrow viewport scrolls horizontally for added columns'
  )
  scroller.scrollLeft = 120
  scroller.dispatchEvent(new Event('scroll'))
  await wait()
  check(scroller.scrollLeft > 0, 'horizontal scroll moves data viewport')
  aligned('horizontal scrolling')
  scroller.scrollLeft = 0
  await menuAction('排序', '年份')
  check(
    cells(rows()[0])[1].textContent.includes('Track 4') &&
      cells(rows()[0])[5].textContent.trim() === '1980',
    'year sort starts at oldest known year'
  )
  await menuAction('排序', '年份')
  check(
    cells(rows()[0])[1].textContent.includes('Track 2') &&
      cells(rows()[0])[5].textContent.trim() === '2020',
    'year sort can reverse'
  )
  await menuAction('排序', '播放次数')
  check(
    cells(rows()[0])[1].textContent.includes('Track 4') &&
      cells(rows()[0])[6].textContent.trim() === '100',
    'play count sorts numerically, highest first'
  )
  await menuAction('排序', '播放次数')
  check(
    rows().some(
      (row) => cells(row)[5].textContent.trim() === '-' && cells(row)[6].textContent.trim() === '0'
    ),
    'unknown year and zero play count render correctly'
  )
  await menuAction('排序', '默认')
  check(
    cells(rows()[0])[1].textContent.includes('Track 1') &&
      cells(rows()[0])[4].textContent.trim() === 'Pop / ROCK',
    'genre column uses the shared separator formatting rule'
  )
  await menuAction('更多', '隐藏年份列')
  check(
    !window.ui.songListColumns.year &&
      ![...document.querySelector('.song-list-columns').children].some(
        (cell) => cell.textContent === '年份'
      ),
    'hide action removes only the selected column'
  )
  await menuAction('排序', '年份')
  check(
    document.querySelector('button[aria-label="排序"]').textContent.includes('年份'),
    'year sorting remains available while year column is hidden'
  )
  for (let mask = 0; mask < 8; mask++) {
    window.ui.songListColumns = { genre: !!(mask & 1), year: !!(mask & 2), playTimes: !!(mask & 4) }
    await wait()
    aligned('column combination ' + mask)
  }
  window.ui.songListColumns = { genre: true, year: true, playTimes: true }
  await wait()
  await menuAction('更多', '隐藏封面')
  check(
    window.ui.compactSongList &&
      rows().every((row) => row.parentElement.getBoundingClientRect().height === 56),
    'compact mode retains optional columns with 56px rows'
  )
  aligned('compact mode')
  await menuAction('更多', '显示禁用网络歌词标记')
  await menuAction('更多', '显示纯音乐标记')
  aligned('lyric flag columns')
  const headers = [...document.querySelector('.song-list-columns').children].map(
    (cell) => cell.getAttribute('aria-label') || cell.textContent.trim()
  )
  check(
    headers.includes('不搜索网络歌词') && headers.includes('纯音乐'),
    'more menu exposes both lyric flag columns'
  )
  check(
    cells(rows()[0]).at(-2).querySelector('use')?.getAttribute('xlink:href') ===
      '#icon-common-music-notes' &&
      cells(rows()[0]).at(-3).querySelector('use')?.getAttribute('xlink:href') ===
        '#icon-common-no-internet',
    'song rows render persisted lyric flags'
  )
  await menuAction('更多', '隐藏纯音乐标记')
  check(
    !window.ui.songListColumns.instrumental && window.ui.songListColumns.disableNetworkLyrics,
    'flag visibility switches are independent'
  )
  aligned('one lyric flag column')
  await menuAction('更多', '使用紧凑布局')
  check(
    window.ui.smallSongList &&
      rows().every((row) => row.parentElement.getBoundingClientRect().height === 40),
    'small layout switches virtualized rows to 40px'
  )
  check(
    rows().every((row) => getComputedStyle(cells(row)[2]).fontSize === '12px'),
    'small layout uses smaller text throughout the row'
  )
  aligned('small layout without covers')
  await menuAction('更多', '显示封面')
  check(
    window.ui.smallSongList &&
      !window.ui.compactSongList &&
      rows()[0].querySelector('.song-list-cover').getBoundingClientRect().width === 28,
    'small layout supports 28px covers independently of cover visibility'
  )
  const taggedRow = rows().find((row) => cells(row)[1].textContent.includes('Track 1'))
  check(
    !!taggedRow &&
      [...cells(taggedRow)[1].querySelectorAll('[title]')].every(
        (element) =>
          element.getBoundingClientRect().bottom <= taggedRow.getBoundingClientRect().bottom
      ),
    'history and tags stay inside a small row'
  )
  aligned('small layout with covers')
  await menuAction('更多', '使用标准布局')
  check(
    !window.ui.smallSongList &&
      rows().every((row) => row.parentElement.getBoundingClientRect().height === 64),
    'standard layout restores 64px rows after size switching'
  )
  aligned('restored standard layout')
  scroller.scrollTop = 8 * 64 + 17
  scroller.dispatchEvent(new Event('scroll'))
  await wait()
  const firstVisibleSong = cells(rows()[0])[0].textContent.trim()
  await menuAction('更多', '使用紧凑布局')
  check(
    cells(rows()[0])[0].textContent.trim() === firstVisibleSong &&
      Math.abs(scroller.scrollTop - (8 * 40 + (17 / 64) * 40)) < 1,
    'shrinking layout preserves the first visible song and relative row offset'
  )
  await menuAction('更多', '使用标准布局')
  check(
    cells(rows()[0])[0].textContent.trim() === firstVisibleSong &&
      Math.abs(scroller.scrollTop - (8 * 64 + 17)) < 2,
    'restoring standard layout keeps the same visible song'
  )
  await menuAction('更多', '隐藏封面')
  check(
    cells(rows()[0])[0].textContent.trim() === firstVisibleSong &&
      Math.abs(scroller.scrollTop - (8 * 56 + (17 / 64) * 56)) < 2,
    'cover visibility changes also preserve the visible song'
  )
  check(queries === 1, 'column toggles and local sorting never requery the database')
  check(errors.length === 0, 'no Vue errors: ' + errors.join('; '))
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
              styles.push(
                ...descriptor.styles.map(
                  (style) =>
                    compileStyle({
                      source: style.content,
                      id: 'data-v-fixture',
                      filename,
                      scoped: style.scoped
                    }).code
                )
              )
              return {
                contents:
                  compileScript(descriptor, {
                    id: 'fixture',
                    inlineTemplate: true,
                    genDefaultAs: '__sfc__'
                  }).content +
                  (descriptor.styles.some((style) => style.scoped)
                    ? ";__sfc__.__scopeId='data-v-fixture';"
                    : '') +
                  ';export default __sfc__',
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
      width: 780,
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
    fs.writeFileSync(
      path.resolve('build/song-columns.png'),
      (await win.webContents.capturePage()).toPNG()
    )
    win.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
