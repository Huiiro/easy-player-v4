/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type, vue/one-component-per-file -- Isolated JavaScript fixture executed in Chromium. */
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
  let remoteSources = []
  let pendingSourceRequests
  window.ui = reactive({
    compactSongList: false,
    musicSource: 'all',
    musicSourceId: 0,
    artistSeparator: '/',
    genreSeparator: ';',
    normalizeMetadataSeparator: true,
    songListColumns: { genre: false, year: false, playTimes: false }
  })
  window.player = { currentQueueSong: null }
  const fixture = [
    {
      id: 1,
      year: 2000,
      playTimes: 2,
      genre: 'Pop;ROCK',
      format: 'flac',
      sampleRate: 44100,
      bitrate: 950
    },
    { id: 2, year: 2020, playTimes: 12, genre: null, format: 'DSF', sampleRate: 2822400 },
    { id: 3, year: null, playTimes: 0, genre: '', sampleRate: 0, bitrate: null },
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
      command: async (action) => {
        if (action === 'listSources') {
          if (pendingSourceRequests)
            return new Promise((resolve) => pendingSourceRequests.push(resolve))
          return { success: true, data: remoteSources.map((source) => ({ ...source })) }
        }
        return { success: true, data: [] }
      }
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
  function menuOption(label) {
    return [...document.querySelectorAll('.ep-menu-item')].find(
      (button) => button.textContent.trim() === label
    )
  }
  function hasTrailingCheck(option) {
    return (
      option?.lastElementChild?.querySelector('use')?.getAttribute('xlink:href') ===
      '#icon-common-check'
    )
  }
  async function menuAction(trigger, label, checked) {
    document.querySelector('header button[aria-label="' + trigger + '"]').click()
    await wait(220)
    const option = menuOption(label)
    check(!!option, 'menu exposes ' + label)
    if (checked !== undefined) {
      check(hasTrailingCheck(option) === checked, 'menu shows the current visibility for ' + label)
      check(
        option.getAttribute('aria-label') === label + (checked ? '，已开启' : '，已关闭'),
        'menu announces the current visibility for ' + label
      )
    }
    if (trigger === '排序' && label === '播放次数') {
      const group = option.parentElement
      check(
        group.querySelectorAll('.ep-menu-item').length === 1 &&
          group.previousElementSibling?.classList.contains('h-px'),
        'play count sort has a separate group after a divider'
      )
    }
    const displayGroup = [
      ['流派', '年份', '播放次数'],
      ['格式', '采样率', '码率'],
      ['不搜索网络歌词', '纯音乐', '喜好', '远程来源']
    ].find((group) => group.includes(label))
    if (trigger === '更多' && displayGroup) {
      const group = option.parentElement
      check(
        [...group.querySelectorAll('.ep-menu-item')]
          .map((item) => item.textContent.trim())
          .join() === displayGroup.join() &&
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
  check(!scroller.querySelector('.song-list-audio-details'), 'audio details are hidden by default')
  aligned('default columns with vertical scrollbar')
  const menuFrames = []
  document.querySelector('header button[aria-label="更多"]').click()
  const menuOpenedAt = performance.now()
  await new Promise((resolve) => {
    function sampleMenu() {
      const menu = document.querySelector('.ep-menu')
      if (
        menu &&
        getComputedStyle(menu).visibility === 'visible' &&
        Number(getComputedStyle(menu).opacity) > 0
      ) {
        const rect = menu.getBoundingClientRect()
        menuFrames.push({
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          dividers: [...menu.querySelectorAll('.h-px')].map((divider) => {
            const box = divider.getBoundingClientRect()
            return { left: box.left, width: box.width, height: box.height }
          })
        })
      }
      if (performance.now() - menuOpenedAt < 360) requestAnimationFrame(sampleMenu)
      else resolve()
    }
    requestAnimationFrame(sampleMenu)
  })
  const finalMenuFrame = menuFrames.at(-1)
  check(
    menuFrames.length > 5 &&
      menuFrames.every((frame) =>
        ['left', 'top', 'width', 'height'].every(
          (key) => Math.abs(frame[key] - finalMenuFrame[key]) < 0.25
        )
      ),
    'more menu keeps its final position and size throughout opening: ' +
      JSON.stringify({ first: menuFrames[0], last: finalMenuFrame })
  )
  check(
    menuFrames.every(
      (frame) =>
        frame.dividers.length === 3 &&
        frame.dividers.every(
          (divider) =>
            Math.abs(divider.height - 1) < 0.01 &&
            Math.abs(divider.left - frame.dividers[0].left) < 0.01 &&
            Math.abs(divider.width - frame.dividers[0].width) < 0.01
        )
    ),
    'group dividers retain the same one-pixel thickness, width and inset throughout opening'
  )
  const expandedMoreMenu = document.querySelector('.ep-menu')
  const displayLabels = [...expandedMoreMenu.querySelectorAll('.ep-menu-item')].map((item) =>
    item.textContent.trim()
  )
  check(
    new Set(displayLabels).size === 14 &&
      displayLabels.every((label) => !/^(显示|隐藏|使用)/.test(label)),
    'More menu gives each display option one fixed label'
  )
  check(
    getComputedStyle(expandedMoreMenu).overflowY === 'visible' &&
      expandedMoreMenu.scrollHeight <= expandedMoreMenu.clientHeight &&
      expandedMoreMenu.getBoundingClientRect().bottom <= innerHeight,
    'More menu fits all options in the viewport without scrolling'
  )
  check(
    hasTrailingCheck(menuOption('封面')) && hasTrailingCheck(menuOption('分割线')),
    'default-visible covers and dividers have trailing check marks'
  )
  document.querySelector('header button[aria-label="更多"]').click()
  await wait(220)
  for (const label of ['流派', '年份', '播放次数']) await menuAction('更多', label)
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
  const queryCountBeforeAudioDetails = queries
  const rowForTrack = (id) =>
    rows().find((row) => row.querySelector('.song-list-name')?.textContent.trim() === `Track ${id}`)
  const detailsForTrack = (id) => rowForTrack(id)?.querySelector('.song-list-audio-details')
  await menuAction('更多', '格式', false)
  check(detailsForTrack(1)?.textContent.trim() === 'FLAC', 'format can be shown independently')
  await menuAction('更多', '采样率', false)
  await menuAction('更多', '码率', false)
  const audioDetails = detailsForTrack(1)
  const firstTag = rowForTrack(1)?.querySelector('[title="Favorite tracks"]')
  check(
    audioDetails?.textContent.trim() === 'FLAC · 44.1 kHz · 950 kbps' &&
      firstTag?.getBoundingClientRect().left >= audioDetails.getBoundingClientRect().right,
    'format, sample rate and bitrate appear together before the tags'
  )
  check(
    detailsForTrack(2)?.textContent.trim() === 'DSF · 2.8224 MHz' && !detailsForTrack(3),
    'high sample rates use MHz and missing or invalid metadata is omitted'
  )
  document.querySelector('header button[aria-label="更多"]').click()
  await wait(220)
  check(
    ['格式', '采样率', '码率'].every((label) => hasTrailingCheck(menuOption(label))),
    'enabled audio details have check marks on the right'
  )
  document.querySelector('header button[aria-label="更多"]').click()
  await wait(220)
  await menuAction('更多', '采样率', true)
  check(
    detailsForTrack(1)?.textContent.trim() === 'FLAC · 950 kbps' &&
      queries === queryCountBeforeAudioDetails,
    'hiding one field updates the list without querying songs again'
  )
  aligned('audio details do not add grid columns')
  await menuAction('更多', '年份', true)
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
  window.ui.songListColumns = {
    genre: true,
    year: true,
    playTimes: true,
    format: true,
    sampleRate: true,
    bitrate: true
  }
  await wait()
  await menuAction('更多', '封面')
  check(
    window.ui.compactSongList &&
      rows().every((row) => row.parentElement.getBoundingClientRect().height === 56),
    'compact mode retains optional columns with 56px rows'
  )
  aligned('compact mode')
  await menuAction('更多', '不搜索网络歌词')
  await menuAction('更多', '纯音乐')
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
  await menuAction('更多', '纯音乐')
  check(
    !window.ui.songListColumns.instrumental && window.ui.songListColumns.disableNetworkLyrics,
    'flag visibility switches are independent'
  )
  aligned('one lyric flag column')
  await menuAction('更多', '紧凑布局')
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
  await menuAction('更多', '封面')
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
  await menuAction('更多', '紧凑布局')
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
  await menuAction('更多', '紧凑布局')
  check(
    cells(rows()[0])[0].textContent.trim() === firstVisibleSong &&
      Math.abs(scroller.scrollTop - (8 * 40 + (17 / 64) * 40)) < 1,
    'shrinking layout preserves the first visible song and relative row offset'
  )
  await menuAction('更多', '紧凑布局')
  check(
    cells(rows()[0])[0].textContent.trim() === firstVisibleSong &&
      Math.abs(scroller.scrollTop - (8 * 64 + 17)) < 2,
    'restoring standard layout keeps the same visible song'
  )
  await menuAction('更多', '封面')
  check(
    cells(rows()[0])[0].textContent.trim() === firstVisibleSong &&
      Math.abs(scroller.scrollTop - (8 * 56 + (17 / 64) * 56)) < 2,
    'cover visibility changes also preserve the visible song'
  )
  check(queries === 1, 'column toggles and local sorting never requery the database')
  const { eventBus } = window.Check
  const sourceTrigger = () => document.querySelector('button[aria-label="歌曲来源"]')
  async function sourceOptions() {
    sourceTrigger().click()
    await wait()
    const labels = [...document.querySelectorAll('[role=menuitem]')].map((option) =>
      option.textContent.trim()
    )
    const groups = [...document.querySelectorAll('.ep-menu .flow-root > div:first-child')].map(
      (group) => group.textContent.trim()
    )
    sourceTrigger().click()
    await wait()
    return { labels, groups }
  }
  remoteSources = [{ id: 1, name: 'NAS A' }]
  eventBus.emit('musicSourcesChanged')
  await wait()
  let options = await sourceOptions()
  check(
    options.labels.includes('NAS A') && options.groups.join() === '自定义远程来源',
    'new remote sources appear in their own header group without remounting'
  )
  window.ui.musicSource = 'remote'
  window.ui.musicSourceId = 1
  await wait()
  remoteSources[0].name = 'Renamed NAS'
  eventBus.emit('musicSourcesChanged')
  await wait()
  check(
    sourceTrigger().textContent.includes('Renamed NAS'),
    'source rename updates the selected label'
  )
  remoteSources = [{ id: 2, name: 'NAS B' }, ...remoteSources]
  eventBus.emit('musicSourcesChanged')
  await wait()
  options = await sourceOptions()
  check(
    options.labels.slice(-2).join() === 'NAS B,Renamed NAS',
    'source ordering and additions synchronize in the existing header'
  )
  const beforeDelete = queries
  remoteSources = [{ id: 2, name: 'NAS B' }]
  eventBus.emit('musicSourcesChanged')
  await wait()
  check(
    window.ui.musicSource === 'remote' &&
      window.ui.musicSourceId === 0 &&
      sourceTrigger().textContent.includes('远程文件') &&
      queries === beforeDelete + 1,
    'deleting the selected source falls back to all remote files and reloads songs once'
  )
  pendingSourceRequests = []
  eventBus.emit('musicSourcesChanged')
  eventBus.emit('musicSourcesChanged')
  pendingSourceRequests[1]({ success: true, data: [{ id: 3, name: 'Newest NAS' }] })
  await wait()
  pendingSourceRequests[0]({ success: true, data: [{ id: 2, name: 'Stale NAS' }] })
  await wait()
  pendingSourceRequests = undefined
  options = await sourceOptions()
  check(
    options.labels.includes('Newest NAS') && !options.labels.includes('Stale NAS'),
    'late source requests cannot restore stale dropdown entries'
  )
  remoteSources = []
  eventBus.emit('musicSourcesChanged')
  await wait()
  options = await sourceOptions()
  check(
    options.groups.length === 0 && options.labels.length === 3,
    'empty remote source group disappears'
  )
  app.unmount()
  const beforeUnmount = queries
  eventBus.emit('musicSourcesChanged')
  await wait()
  check(queries === beforeUnmount, 'unmounted song lists stop reacting to source changes')
  // The server returns membership-time order, deliberately different from song IDs.
  let playlistOrder = [fixture[1], fixture[0], fixture[2], ...fixture.slice(3, 33)].map(
    (song, index) => ({
      ...song,
      playlistPosition: 32 - index,
      playlistAddedAt: '2000-01-01 00:00:00',
      playlistEntryId: fixture.length - index
    })
  )
  const originalCommand = window.api.database.command
  const moves = []
  let rejectMove = false
  window.api.database.command = async (action, params) => {
    if (action !== 'movePlaylistSong') return originalCommand(action, params)
    moves.push(params)
    if (rejectMove) return { success: false, error: 'save failed' }
    const moved = playlistOrder.find((song) => song.id === params.songId)
    playlistOrder = playlistOrder.filter((song) => song.id !== params.songId)
    const targetIndex = playlistOrder.findIndex((song) => song.id === params.targetSongId)
    playlistOrder.splice(targetIndex + (params.before ? 0 : 1), 0, moved)
    playlistOrder = playlistOrder.map((song, index) => ({
      ...song,
      playlistPosition: playlistOrder.length - index - 1
    }))
    return {
      success: true,
      data: playlistOrder.map(({ id, playlistPosition }) => ({ id, position: playlistPosition }))
    }
  }
  window.songQuery = async () => playlistOrder
  const playlistApp = createApp({
    render: () => h(SongListView, { source: { type: 'playlist', id: 1 } })
  })
  playlistApp.config.errorHandler = (error) => errors.push(String(error))
  playlistApp.use(router).use(createI18n({ legacy: false, locale: 'zh', messages: { zh } }))
  playlistApp
    .component('SvgIcon', window.Check.SvgIcon)
    .component('RecycleScroller', RecycleScroller)
  playlistApp.mount('#app')
  await wait(180)
  const playlistRows = () =>
    [...document.querySelectorAll('.vue-recycle-scroller__item-view')]
      .filter((row) => getComputedStyle(row).visibility !== 'hidden')
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
  const playlistTopTitles = () =>
    playlistRows()
      .slice(0, 3)
      .map((row) => row.querySelector('.song-list-name')?.textContent.trim())
      .join(',')
  check(
    playlistTopTitles() === 'Track 2,Track 1,Track 3',
    'Playlist default display preserves newest additions instead of sorting by library song ID'
  )
  const reorderToggle = [...document.querySelectorAll('header button')].find(
    (button) => button.textContent.trim() === zh.songList.toggleDragSort
  )
  const draggableRow = () => document.querySelector('.song-list-row[draggable=true]')
  const firstSongRow = () => playlistRows()[0].querySelector('.song-list-row')
  const firstSequenceCell = () => firstSongRow().firstElementChild
  const icon = (element) => element.querySelector('use')?.getAttribute('xlink:href')
  check(
    icon(reorderToggle) === '#icon-common-drag2' &&
      !draggableRow() &&
      firstSequenceCell().textContent.trim() === '1',
    'Playlist rows show sequence numbers before entering reorder mode'
  )
  await menuAction('排序', zh.songList.title)
  check(
    playlistTopTitles() === 'Track 1,Track 2,Track 3',
    'Explicit playlist title sorting still works'
  )
  check(!draggableRow(), 'Title sorting disables row dragging')
  reorderToggle.click()
  await wait()
  check(
    playlistTopTitles() === 'Track 2,Track 1,Track 3' &&
      reorderToggle.textContent.trim() === zh.songList.exitDragSort &&
      icon(reorderToggle) === '#icon-common-back-left' &&
      icon(firstSequenceCell()) === '#icon-common-drag2' &&
      firstSequenceCell().textContent.trim() === '',
    'Reorder mode replaces row numbers with handles and shows the exit action'
  )
  check(
    firstSongRow().querySelector('.song-list-name').closest('[draggable=true]') ===
      firstSongRow() && !firstSequenceCell().querySelector('[draggable=true]'),
    'The entire song row is draggable, including its title'
  )
  const dragSong = (from, to, before) => {
    const rows = playlistRows()
    const source = rows[from].querySelector('.song-list-row[draggable=true]')
    const target = rows[to].querySelector('.song-list-row')
    const box = target.getBoundingClientRect()
    const dataTransfer = new DataTransfer()
    const send = (element, type, clientY) =>
      element.dispatchEvent(
        new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer, clientY })
      )
    send(source, 'dragstart')
    const y = before ? box.top + 3 : box.bottom - 3
    check(!send(target, 'dragover', y), 'Accepts a drag from its own song row')
    return { drop: () => send(target, 'drop', y), end: () => send(source, 'dragend') }
  }
  const firstDrag = dragSong(0, 2, false)
  await wait()
  check(
    playlistRows()[2].querySelector('.bottom-0.h-0\\.5'),
    'Shows an insertion line under the target'
  )
  firstDrag.drop()
  firstDrag.end()
  await wait()
  check(
    moves.length === 1 &&
      moves[0].playlistId === 1 &&
      moves[0].songId === 2 &&
      moves[0].targetSongId === 3 &&
      !moves[0].before &&
      playlistTopTitles() === 'Track 1,Track 3,Track 2',
    'Drop saves the order and updates the virtual rows'
  )
  reorderToggle.click()
  await wait()
  check(
    !draggableRow() &&
      firstSequenceCell().textContent.trim() === '1' &&
      reorderToggle.textContent.trim() === zh.songList.toggleDragSort &&
      playlistTopTitles() === 'Track 1,Track 3,Track 2',
    'Exiting restores sequence numbers, the entry action, and the saved order'
  )
  reorderToggle.click()
  await wait()
  rejectMove = true
  dragSong(0, 2, true).drop()
  await wait()
  check(
    playlistTopTitles() === 'Track 1,Track 3,Track 2',
    'Failed saves leave the visible order intact'
  )
  rejectMove = false
  const cancelledDrag = dragSong(0, 2, false)
  cancelledDrag.end()
  await wait()
  check(moves.length === 2, 'Cancelling a drag leaves the saved order intact')
  await menuAction('排序', zh.songList.defaultSort)
  check(
    playlistTopTitles() === 'Track 33,Track 32,Track 31',
    'Playlist sort can reverse the saved order'
  )
  dragSong(0, 2, false).drop()
  await wait()
  check(
    moves[2].before && playlistTopTitles() === 'Track 32,Track 31,Track 33',
    'Dragging in reverse order saves the correct relative placement'
  )
  document.querySelector('header button[aria-label="刷新"]').click()
  await wait(180)
  check(
    playlistTopTitles() === 'Track 32,Track 31,Track 33',
    'Refreshing the playlist keeps the saved placement'
  )
  window.songQuery = async () =>
    [
      playlistOrder.find((song) => song.id === 3),
      ...playlistOrder.filter((song) => song.id !== 3)
    ].map((song, index) => ({ ...song, searchScore: 100 - index }))
  const playlistSearch = document.querySelector('header input')
  playlistSearch.value = 'Track'
  playlistSearch.dispatchEvent(new Event('input', { bubbles: true }))
  await wait(360)
  check(
    playlistTopTitles().startsWith('Track 3,'),
    'Playlist search can rank an older addition first by relevance'
  )
  check(!draggableRow() && reorderToggle.disabled, 'A search disables row dragging')
  await menuAction('排序', zh.songList.defaultSort)
  check(
    playlistTopTitles() === 'Track 1,Track 3,Track 2',
    'Default sorting after search follows the saved playlist positions'
  )
  playlistApp.unmount()
  window.api.database.command = originalCommand
  const rowPlays = []
  window.player.playCollection = async (...args) => {
    rowPlays.push(args)
    return true
  }
  window.songQuery = async () => fixture.map((song) => ({ ...song }))
  const selectionApp = createApp({ render: () => h(SongListView) })
  selectionApp.config.errorHandler = (error) => errors.push(String(error))
  selectionApp.use(router).use(createI18n({ legacy: false, locale: 'zh', messages: { zh } }))
  selectionApp
    .component('SvgIcon', window.Check.SvgIcon)
    .component('RecycleScroller', RecycleScroller)
  selectionApp.mount('#app')
  await wait(180)
  const selectButton = (label) =>
    document.querySelector('header button[aria-label="' + label + '"]')
  const visibleSelectableRow = () =>
    [...document.querySelectorAll('.song-list-row')].find((row) => {
      const box = row.getBoundingClientRect(),
        viewport = document.querySelector('.song-list-scroller').getBoundingClientRect()
      return (
        getComputedStyle(row).visibility !== 'hidden' &&
        box.top >= viewport.top &&
        box.bottom <= viewport.bottom &&
        row.children[2].querySelector('button') &&
        row.children[3].querySelector('button')
      )
    })
  const mouse = (element, type, detail = 1, button = 0) =>
    element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, detail, button }))
  const doubleClick = (element) => {
    mouse(element, 'click', 1)
    mouse(element, 'click', 2)
    mouse(element, 'dblclick', 2)
  }
  for (const trigger of ['single', 'double']) {
    window.ui.songPlayTrigger = trigger
    const before = rowPlays.length
    let row = visibleSelectableRow()
    mouse(row.querySelector('.song-list-name'), 'click', 1)
    await wait()
    check(
      rowPlays.length === before + (trigger === 'single' ? 1 : 0),
      trigger + ' playback preference works before selection mode'
    )
    selectButton(zh.songList.select).click()
    await wait()
    row = visibleSelectableRow()
    const checkbox = () => row.querySelector('input[type=checkbox]')
    const baseline = rowPlays.length
    mouse(row.querySelector('.song-list-name'), 'click')
    await wait()
    check(
      checkbox().checked && rowPlays.length === baseline,
      trigger + ' mode: clicking the title selects without playing'
    )
    mouse(row, 'click')
    await wait()
    check(!checkbox().checked, trigger + ' mode: clicking row space deselects')
    doubleClick(row.querySelector('.song-list-name'))
    await wait()
    check(
      checkbox().checked && rowPlays.length === baseline,
      trigger + ' mode: double click selects once and never plays'
    )
    mouse(row, 'click', 1, 2)
    await wait()
    check(checkbox().checked, trigger + ' mode: a secondary click does not toggle selection')
    checkbox().click()
    await wait()
    check(!checkbox().checked, trigger + ' mode: checkbox toggles once without bubbling to the row')
    const path = router.currentRoute.value.fullPath
    doubleClick(row.children[2].querySelector('button'))
    await wait()
    check(
      checkbox().checked && router.currentRoute.value.fullPath === path,
      trigger + ' mode: artist text selects without navigating'
    )
    mouse(row.children[3].querySelector('button'), 'click')
    await wait()
    check(
      !checkbox().checked && router.currentRoute.value.fullPath === path,
      trigger + ' mode: album text selects without navigating'
    )
    check(
      rowPlays.length === baseline,
      trigger + ' mode: all selection gestures keep playback unchanged'
    )
    selectButton(zh.songList.cancelSelection).click()
    await wait()
    check(
      !row.querySelector('input[type=checkbox]'),
      trigger + ' mode: exiting removes selection controls'
    )
    const restored = rowPlays.length
    mouse(row.querySelector('.song-list-name'), 'click', 1)
    await wait()
    check(
      rowPlays.length === restored + (trigger === 'single' ? 1 : 0),
      trigger + ' playback preference is restored after selection'
    )
    if (trigger === 'double') {
      mouse(row.querySelector('.song-list-name'), 'dblclick', 2)
      await wait()
      check(
        rowPlays.length === restored + 1,
        'Double click playback is restored after exiting selection'
      )
    }
    selectButton(zh.songList.select).click()
    await wait()
    check(
      !visibleSelectableRow().querySelector('input[type=checkbox]').checked,
      'Reentering selection starts without stale selected IDs'
    )
    selectButton(zh.songList.cancelSelection).click()
    await wait()
  }
  selectionApp.unmount()
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
          "export {RecycleScroller} from 'vue-virtual-scroller';export * as Vue from 'vue';export {createI18n} from 'vue-i18n';export {createRouter,createMemoryHistory} from 'vue-router';export {default as eventBus} from './src/renderer/src/utils/eventBus';export {default as SongListView} from './src/renderer/src/components/songlist/SongListView.vue';export {default as LibraryBrowserGrid} from './src/renderer/src/components/library/LibraryBrowserGrid.vue';export {default as SvgIcon} from './src/renderer/src/components/svg/SvgIcon.vue';export {default as zh} from './src/renderer/src/i18n/locales/zh';"
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
