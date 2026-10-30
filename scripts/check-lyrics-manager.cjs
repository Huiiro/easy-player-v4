/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type, vue/one-component-per-file */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const esbuild = require('esbuild')
const { parse, compileScript } = require('@vue/compiler-sfc')

app.setPath('userData', fs.mkdtempSync(path.resolve('build/lyrics-manager-ui-')))
app.disableHardwareAcceleration()

async function runFixture() {
  const { Vue, createI18n, Manager, SongListActions, PlayerLyrics, PlayerLyricsV2, zh, eventBus } =
    window.Fixture
  const { h, createApp, reactive, nextTick } = Vue
  window.requestAnimationFrame = (callback) => setTimeout(() => callback(performance.now()), 16)
  window.cancelAnimationFrame = clearTimeout
  const wait = async (ms = 100) => {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, ms))
  }
  const checks = []
  const check = (value, message) => {
    if (!value) throw Error(message)
    checks.push(message)
  }
  const song = (id) => ({
    id,
    title: 'Song ' + id,
    artist: 'Artist ' + id,
    album: 'Album ' + id,
    audio: 'song-' + id + '.flac'
  })
  const policies = new Map()
  const defaultPolicy = (songId) => ({
    songId,
    offsetMs: null,
    disableNetwork: false,
    instrumental: false
  })
  const databaseLyrics = (id) => {
    if (id === 4)
      return {
        lrc: '[00:00.00]<00:00.00>First <00:00.50>line\n[00:02.00]Second line\n[00:05.00]Third line',
        lyricFormat: 'elrc',
        translation: '[00:00.00]First translation\n[00:02.00]Second translation',
        romanization: '[00:00.00]First romanization\n[00:02.00]Second romanization'
      }
    if (id === 5) return { lrc: 'Untimed first line\nUntimed second line', lyricFormat: 'plain' }
    return { lrc: '[00:01.00]Database ' + id, lyricFormat: 'lrc' }
  }
  const writes = [],
    reads = [],
    queries = [],
    updates = []
  let holdRead = false,
    finishRead,
    holdSave = false,
    finishSave,
    saved = 0,
    fileWrites = 0
  window.managerUi = reactive({
    lyricSourceMode: 'database',
    lyricSourceOrder: ['embedded', 'database'],
    autoSearchNetworkLyrics: false,
    preferWordTimedNetworkLyrics: false
  })
  window.managerPlayer = reactive({
    currentQueueSong: song(1),
    trackInfo: {
      filePath: 'song-99.flac',
      metadata: { title: 'Stale native title', artist: 'Stale artist' }
    }
  })
  eventBus.on('lyricsUpdated', (id) => updates.push(id))
  window.api = {
    networkSources: { cancelRequest: async () => ({ success: true }) },
    metadata: {
      write: async () => {
        fileWrites++
        throw Error('Audio file writes forbidden')
      }
    },
    lyrics: {
      loadSource: async () => {
        return { success: true, data: { content: '[00:01.00]Embedded', format: 'lrc' } }
      },
      searchNetwork: async (query) => {
        queries.push({ ...query })
        return {
          success: true,
          data: [
            {
              id: 'candidate',
              provider: 'netease',
              title: query.title,
              artist: query.artist,
              lrc: '[00:01.00]Network',
              format: 'lrc',
              supportsWordTiming: false
            }
          ]
        }
      }
    },
    database: {
      command: async (action, params) => {
        if (action === 'getSongLyricSettings')
          return {
            success: true,
            data: policies.get(params.songId) || defaultPolicy(params.songId)
          }
        if (action === 'setSongLyricSettings') {
          const data = {
            ...(policies.get(params.songId) || defaultPolicy(params.songId)),
            ...params.patch
          }
          policies.set(params.songId, data)
          return { success: true, data }
        }
        if (action === 'getSong') {
          reads.push(params.id)
          if (holdRead) {
            holdRead = false
            return new Promise((resolve) => {
              finishRead = resolve
            })
          }
          return { success: true, data: databaseLyrics(params.id) }
        }
        if (action === 'updateSongLyrics') {
          writes.push(JSON.parse(JSON.stringify(params)))
          if (holdSave) {
            holdSave = false
            return new Promise((resolve) => {
              finishSave = resolve
            })
          }
          return { success: true }
        }
        throw Error('Unexpected database action ' + action)
      }
    }
  }
  const state = reactive({ open: true })
  createApp({
    render: () =>
      h(Manager, {
        modelValue: state.open,
        'onUpdate:modelValue': (value) => (state.open = value),
        onSaved: () => saved++
      })
  })
    .use(createI18n({ legacy: false, locale: 'zh', messages: { zh } }))
    .mount('#app')
  const button = (text) =>
    [...document.querySelectorAll('button')].find(
      (el) => !el.closest('[inert]') && el.textContent.trim() === text
    )
  const editor = () => document.querySelector('textarea')
  const edit = async (text) => {
    editor().value = text
    editor().dispatchEvent(new Event('input', { bubbles: true }))
    await wait()
  }
  const close = async () => {
    state.open = false
    await wait(250)
  }
  await wait()
  check(
    reads[0] === 1 && editor().value.includes('Database 1'),
    'initially open manager captures and loads its target'
  )
  await edit('[00:01.00]Draft for song 1')
  const originalSong = window.managerPlayer.currentQueueSong
  window.managerPlayer.currentQueueSong = song(2)
  originalSong.title = 'Mutated queue metadata'
  await wait()
  check(
    editor().value.includes('Draft for song 1') && reads.length === 1,
    'switching playback retains the editing draft without reloading'
  )
  const queryTitle = document.querySelector('input[placeholder="歌曲名"]')
  check(
    queryTitle.value === 'Song 1' && document.body.textContent.includes('Song 1'),
    'search defaults and displayed target retain the plain opening snapshot'
  )
  check(
    ![...document.querySelectorAll('button')].some(
      (el) => el.textContent.trim() === '内嵌歌词' || el.textContent.trim() === '数据库歌词'
    ),
    'search dialog does not contain playback source controls'
  )
  window.managerUi.lyricSourceMode = 'embedded'
  await wait()
  check(
    editor().value.includes('Draft for song 1') && reads.length === 1 && !editor().readOnly,
    'playback source changes do not reload or lock the search draft'
  )
  button('搜索网络歌词').click()
  await wait()
  check(
    queries[0].title === 'Song 1' && queries[0].artist === 'Artist 1',
    'network searches keep the original song metadata'
  )
  check(
    window.managerUi.lyricSourceMode === 'embedded',
    'selecting a search result never changes playback source'
  )
  check(
    !!document.querySelector('[data-lyric-search-sidebar] [data-lyric-search-results]') &&
      !document.querySelector('[data-lyric-search-editor] [data-lyric-search-results]'),
    'search results appear in the upper-left sidebar instead of the editor column'
  )
  await edit('[00:01.00]Saved for song 1')
  button(zh.playerPanel.lyricSaveDatabase).click()
  await wait(250)
  check(
    writes[0].id === 1 &&
      writes[0].lrc.includes('Saved for song 1') &&
      updates[0] === 1 &&
      !state.open,
    'saving after a track switch writes and notifies only the original song'
  )
  state.open = true
  await wait()
  check(editor().value.includes('Database 2'), 'reopening captures the newly playing song')
  holdSave = true
  await edit('[00:01.00]Pending song 2')
  button(zh.playerPanel.lyricSaveDatabase).click()
  await wait()
  await close()
  window.managerPlayer.currentQueueSong = song(3)
  state.open = true
  await wait()
  finishSave({ success: true })
  await wait()
  check(
    state.open && editor().value.includes('Database 3') && saved === 1,
    'an earlier save completion cannot close or alter a reopened dialog'
  )
  check(
    updates.at(-1) === 2 && !button(zh.playerPanel.lyricSaveDatabase).disabled,
    'late saves notify their own target without changing the new session'
  )
  await edit('[00:01.00]Saved song 3')
  button(zh.playerPanel.lyricSaveDatabase).click()
  await wait(250)
  check(
    writes.at(-1).id === 3 && !state.open,
    'a reopened dialog saves to its own snapshotted target'
  )
  state.open = true
  await wait()
  const queryCount = queries.length
  check(
    !document.querySelector('[role=switch]'),
    'search dialog no longer contains song flag switches'
  )
  await window.api.database.command('setSongLyricSettings', {
    songId: 3,
    patch: { disableNetwork: true }
  })
  eventBus.emit('songLyricSettingsChanged', 3)
  await wait()
  check(
    policies.get(3).disableNetwork && !button('搜索网络歌词').disabled,
    'network marker does not disable manual searches'
  )
  button('搜索网络歌词').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await wait()
  check(
    queries.length === queryCount + 1 && queries.at(-1).searchMode === 'manual',
    'manual searches send an explicit intent even when automatic matching is disabled'
  )
  await window.api.database.command('setSongLyricSettings', {
    songId: 3,
    patch: { instrumental: true }
  })
  eventBus.emit('songLyricSettingsChanged', 3)
  await wait()
  check(
    policies.get(3).instrumental &&
      editor().value.includes('Network') &&
      !button('搜索网络歌词').disabled,
    'instrumental marker does not clear manual search results or disable searching'
  )
  await close()
  state.open = true
  await wait()
  check(
    editor().value.includes('Database 3') && !button('搜索网络歌词').disabled,
    'reopening an instrumental song still allows manual lyric search and editing'
  )
  button('搜索网络歌词').click()
  await wait()
  button(zh.playerPanel.lyricSaveDatabase).click()
  await wait(250)
  check(
    writes.at(-1).id === 3 &&
      writes.at(-1).lrc.includes('Network') &&
      policies.get(3).instrumental &&
      policies.get(3).disableNetwork,
    'manual results can be saved without clearing either song marker'
  )

  await close()
  window.managerPlayer.currentQueueSong = song(1)
  holdRead = true
  state.open = true
  await wait()
  await close()
  window.managerPlayer.currentQueueSong = song(2)
  state.open = true
  await wait()
  finishRead({ success: true, data: databaseLyrics(1) })
  await wait()
  check(
    editor().value.includes('Database 2'),
    'late drafts from a closed session cannot overwrite the reopened target'
  )
  await close()
  window.managerPlayer.currentQueueSong = null
  state.open = true
  await wait()
  window.managerPlayer.currentQueueSong = song(3)
  await wait()
  check(
    button(zh.playerPanel.lyricSaveDatabase).disabled,
    'opening without a song never adopts a later playback target'
  )
  await close()
  Object.assign(window.managerUi, {
    reduceMotion: true,
    autoAdjustLyricsDisplay: false,
    lyricsStyle: 'word',
    getPlayerLyricsFontStyle: {}
  })
  for (const component of [PlayerLyrics, PlayerLyricsV2]) {
    const host = document.createElement('div')
    document.body.append(host)
    const pureApp = createApp(component, {
      song: song(3),
      sourceOrder: ['database', 'network'],
      currentTime: 0
    }).use(createI18n({ legacy: false, locale: 'zh', messages: { zh } }))
    pureApp.mount(host)
    await wait()
    check(
      !!host.querySelector('[data-instrumental]') && host.textContent.includes('纯音乐'),
      'lyric renderer displays the dedicated instrumental state'
    )
    pureApp.unmount()
    host.remove()
  }
  Object.assign(window.managerUi, {
    lyricsStyle: 'follow',
    showLyricsTranslation: true,
    showLyricsRomanization: true
  })
  for (const [index, component] of [PlayerLyrics, PlayerLyricsV2].entries()) {
    const host = document.createElement('div')
    host.style.cssText =
      'position:relative;height:300px;--lrc-size:24px;--lrc-padding:8px;--lrc-height:1.5;--lrc-highlight:#fff;--lrc-default:#888;--lrc-translate:#aaa'
    document.body.append(host)
    const style = document.createElement('style')
    style.textContent = window.fixtureLyricStyles[index]
    document.head.append(style)
    const lyricState = reactive({ song: song(4), currentTime: 0 })
    const seeks = []
    const lyricApp = createApp({
      render: () =>
        h(component, {
          ...lyricState,
          sourceOrder: ['database'],
          autoSearchNetwork: false,
          onSeek: (time) => seeks.push(time)
        })
    }).use(createI18n({ legacy: false, locale: 'zh', messages: { zh } }))
    lyricApp.mount(host)
    await wait()
    const rows = [...host.querySelectorAll('.lyric-line')]
    const second = rows.find((row) => row.textContent.includes('Second line'))
    check(!!second && !host.querySelector('button'), 'lyric rows replace separate seek buttons')
    second.querySelector('.lyric-translation').click()
    check(seeks.join() === '2000', 'clicking a translation seeks its sentence immediately once')
    second.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    )
    second.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    )
    check(
      seeks.join() === '2000,2000,2000',
      'Enter and Space seek the focused lyric without scrolling'
    )
    const first = rows.find((row) => row.textContent.includes('First'))
    first.click()
    check(seeks.at(-1) === 0, 'clicking the opening line can seek to zero')
    first.setAttribute('data-fixture-inspect', '')
    const inspect = (active) =>
      new Promise((resolve, reject) => {
        window.finishLyricHover = (error) => (error ? reject(Error(error)) : resolve())
        window.fixtureLyricHover(active ? 'on' : 'off')
      })
    await inspect(true)
    await wait(450)
    const characters = [...first.querySelectorAll('.lyric-karaoke-char')]
    check(
      characters.length > 0 &&
        getComputedStyle(first).opacity === '1' &&
        getComputedStyle(first).filter === 'none' &&
        characters.every(
          (char) =>
            getComputedStyle(char).color === 'rgb(255, 255, 255)' &&
            getComputedStyle(char).opacity === '1' &&
            getComputedStyle(char).backgroundImage === 'none'
        ) &&
        getComputedStyle(first.querySelector('.lyric-translation')).color === 'rgb(255, 255, 255)',
      'hovering a row highlights all timed characters and its translation'
    )
    await inspect(false)
    first.removeAttribute('data-fixture-inspect')
    await wait(450)
    check(
      characters.some((char) => getComputedStyle(char).backgroundImage !== 'none'),
      'leaving a lyric restores its timed word highlighting'
    )
    lyricState.song = song(5)
    await wait()
    const beforeUntimed = seeks.length
    const untimed = host.querySelector('.lyric-line')
    untimed.click()
    untimed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    check(
      seeks.length === beforeUntimed && !host.querySelector('[role=button]'),
      'untimed lyrics never seek or expose a false button role'
    )
    lyricApp.unmount()
    style.remove()
    host.remove()
  }
  const target = reactive({ open: true, song: song(6) })
  window.managerPlayer.currentQueueSong = song(4)
  window.managerPlayer.trackInfo = {
    filePath: song(6).audio,
    metadata: { title: 'Wrong playback title', artist: 'Wrong playback artist' }
  }
  const explicitHost = document.createElement('div')
  document.body.append(explicitHost)
  const explicitApp = createApp({
    render: () =>
      h(Manager, {
        modelValue: target.open,
        song: target.song,
        'onUpdate:modelValue': (value) => (target.open = value)
      })
  }).use(createI18n({ legacy: false, locale: 'zh', messages: { zh } }))
  explicitApp.mount(explicitHost)
  await wait()
  check(
    editor().value.includes('Database 6') &&
      document.querySelector('[data-lyric-search-form] input').value === 'Song 6',
    'an explicit search target supplies its own lyrics and metadata instead of playback'
  )
  target.song = song(7)
  window.managerPlayer.currentQueueSong = song(8)
  await wait()
  button(zh.playerPanel.lyricSearch).click()
  await wait()
  check(
    queries.at(-1).songId === 6 && queries.at(-1).title === 'Song 6',
    'changing playback or target props does not retarget an open manual search'
  )
  button(zh.playerPanel.lyricSaveDatabase).click()
  await wait()
  check(writes.at(-1).id === 6, 'an explicit search saves lyrics to its original target')
  target.song = null
  target.open = true
  await wait()
  check(
    button(zh.playerPanel.lyricSaveDatabase).disabled,
    'an explicit null search target never falls back to the playing song'
  )
  target.open = false
  await wait()
  explicitApp.unmount()
  explicitHost.remove()

  const menuHost = document.createElement('div')
  document.body.append(menuHost)
  const menu = Vue.ref(null)
  const menuSongs = [
    { ...song(6), sourceId: null, preference: 0 },
    { ...song(7), sourceId: 12, preference: 0 }
  ]
  Object.assign(window.managerPlayer, { queue: [], currentQueueSong: song(8) })
  const menuApp = createApp({
    render: () =>
      h(SongListActions, {
        ref: menu,
        source: { type: 'all' },
        songs: menuSongs,
        selectedIds: new Set([6, 7]),
        refresh: async () => {},
        playSong: async () => {}
      })
  }).use(createI18n({ legacy: false, locale: 'zh', messages: { zh } }))
  menuApp.mount(menuHost)
  const openMenu = async (index = 0, x = 300) => {
    await menu.value.openMenu(menuSongs[index], x, 100)
    await wait()
  }
  const editSubmenu = () => document.querySelector('[role=menu][aria-label="编辑歌曲"]')
  await openMenu()
  check(
    !!button(zh.songList.editSong) &&
      !editSubmenu() &&
      ![...document.querySelectorAll('[data-song-context-menu] button')].some((element) =>
        [zh.songList.editMetadata, zh.lyricEditor.title, zh.playerPanel.lyricSearchTitle].includes(
          element.textContent.trim()
        )
      ),
    'song editing actions are grouped under one collapsed submenu'
  )
  const editTrigger = button(zh.songList.editSong)
  editTrigger.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
  )
  await wait()
  check(
    editSubmenu()?.querySelectorAll('button').length === 3 &&
      document.activeElement === editSubmenu().querySelector('button'),
    'keyboard opens the edit submenu and focuses its first action'
  )
  const panelRect = editSubmenu().getBoundingClientRect()
  check(
    panelRect.left >= editTrigger.getBoundingClientRect().right,
    'edit submenu opens beside its trigger'
  )
  document.activeElement.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  )
  await wait()
  check(
    !editSubmenu() && document.activeElement === editTrigger,
    'Escape closes only the submenu and returns focus'
  )
  editTrigger.dispatchEvent(new PointerEvent('pointerenter'))
  await wait()
  button(zh.songList.marksAndPreference).dispatchEvent(new PointerEvent('pointerenter'))
  await wait()
  check(
    !editSubmenu() && !!document.querySelector('[role=menu][aria-label="标记与喜好"]'),
    'only one song submenu stays open'
  )
  editTrigger.dispatchEvent(new PointerEvent('pointerenter'))
  await wait()
  editTrigger.dispatchEvent(new PointerEvent('pointerleave'))
  editSubmenu()?.dispatchEvent(new PointerEvent('pointerenter'))
  await wait(180)
  check(!!editSubmenu(), 'moving through the submenu gap keeps the edit menu open')
  await openMenu(0, 950)
  check(!editSubmenu(), 'reopening the same row clears the previous submenu')
  button(zh.songList.editSong).click()
  await wait()
  check(
    editSubmenu().getBoundingClientRect().right <=
      button(zh.songList.editSong).getBoundingClientRect().left,
    'edit submenu flips at the viewport edge'
  )
  button(zh.songList.editMetadata).click()
  await wait()
  check(
    document.querySelector('[data-fixture-dialog="MetadataEditDialog"]')?.dataset.songId === '6' &&
      !editSubmenu(),
    'metadata editing targets the right-clicked song and closes the menu'
  )
  button('Close fixture').click()
  await wait()
  await openMenu(1)
  button(zh.songList.editSong).click()
  await wait()
  button(zh.lyricEditor.title).click()
  await wait()
  check(
    document.querySelector('[data-fixture-dialog="LyricsEditorDialog"]')?.dataset.songId === '7',
    'lyric editing keeps the right-click target during multi-selection'
  )
  button('Close fixture').click()
  await wait()
  await openMenu(1)
  button(zh.songList.editSong).click()
  await wait()
  button(zh.playerPanel.lyricSearchTitle).click()
  await wait()
  check(
    editor().value.includes('Database 7') && !document.querySelector('[data-song-context-menu]'),
    'the remote row opens the real lyric search independently of selection and playback'
  )
  window.managerPlayer.currentQueueSong = song(9)
  button(zh.playerPanel.lyricSearch).click()
  await wait()
  check(
    queries.at(-1).songId === 7 && queries.at(-1).searchMode === 'manual',
    'context-menu lyric search uses the selected song and manual search policy'
  )
  button(zh.playerPanel.lyricSaveDatabase).click()
  await wait()
  check(writes.at(-1).id === 7, 'context-menu lyric search saves to the selected remote song')

  const footer = document.createElement('footer')
  footer.innerHTML = '<button><svg><path /></svg></button><img alt="Cover">'
  let footerClicks = 0
  footer.addEventListener('click', (event) => {
    event.stopPropagation()
    footerClicks++
  })
  footer.addEventListener('contextmenu', (event) => event.stopPropagation())
  document.body.append(footer)
  for (const selector of ['button', 'svg path', 'img']) {
    await openMenu()
    button(zh.songList.editSong).click()
    await wait()
    footer.querySelector(selector).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wait()
    check(
      !document.querySelector('[data-song-context-menu]') && !editSubmenu(),
      'outside clicks close both menus despite stopped footer bubbling: ' + selector
    )
  }
  check(footerClicks === 3, 'closing the context menu preserves footer control actions')
  await openMenu()
  document
    .querySelector('[data-song-context-menu]')
    .dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await wait()
  check(
    !!document.querySelector('[data-song-context-menu]'),
    'clicking the main menu surface does not dismiss it'
  )
  button(zh.songList.editSong).click()
  await wait()
  for (const type of ['click', 'contextmenu']) {
    editSubmenu().dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }))
    await wait()
    check(!!editSubmenu(), 'a teleported submenu remains open for internal ' + type)
  }
  footer.querySelector('img').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
  await wait()
  check(
    !document.querySelector('[data-song-context-menu]'),
    'outside context menus dismiss song menus despite stopped bubbling'
  )
  footer.addEventListener('contextmenu', () => void menu.value.openMenu(menuSongs[1], 300, 100))
  await openMenu()
  footer.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  await wait()
  button(zh.songList.editSong).click()
  await wait()
  button(zh.lyricEditor.title).click()
  await wait()
  check(
    document.querySelector('[data-fixture-dialog="LyricsEditorDialog"]')?.dataset.songId === '7',
    'a new row context menu can reopen after capture closes the old menu'
  )
  footer.remove()
  menuApp.unmount()
  menuHost.remove()
  check(fileWrites === 0, 'lyric management never writes embedded audio metadata')
  return checks
}

app.whenReady().then(async () => {
  try {
    const bundle = await esbuild.build({
      stdin: {
        resolveDir: process.cwd(),
        contents:
          "export * as Vue from 'vue';export {createI18n} from 'vue-i18n';export {default as SongListActions} from './src/renderer/src/components/songlist/SongListActions.vue';export {default as Manager} from './src/renderer/src/components/lyrics/LyricsSearchDialog.vue';export {default as PlayerLyrics} from './src/renderer/src/components/lyrics/PlayerLyrics.vue';export {default as PlayerLyricsV2} from './src/renderer/src/components/lyrics/PlayerLyricsV2.vue';export {default as zh} from './src/renderer/src/i18n/locales/zh';export {default as eventBus} from './src/renderer/src/utils/eventBus';"
      },
      bundle: true,
      platform: 'browser',
      format: 'iife',
      globalName: 'Fixture',
      write: false,
      define: {
        __VUE_OPTIONS_API__: 'true',
        __VUE_PROD_DEVTOOLS__: 'false',
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false'
      },
      alias: {
        vue: require.resolve('vue/dist/vue.esm-bundler.js'),
        '@': path.resolve('src/renderer/src')
      },
      plugins: [
        {
          name: 'isolated-stores',
          setup(build) {
            build.onResolve({ filter: /stores[\\/]ui[\\/]uiStore$/ }, () => ({
              path: 'ui',
              namespace: 'fixture'
            }))
            build.onResolve({ filter: /stores[\\/]player[\\/]playerStore$/ }, () => ({
              path: 'player',
              namespace: 'fixture'
            }))
            build.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
              contents:
                args.path === 'ui'
                  ? 'export const useUIStore=()=>window.managerUi'
                  : 'export const usePlayerStore=()=>window.managerPlayer',
              loader: 'js'
            }))
            build.onLoad({ filter: /\.vue$/ }, ({ path: filename }) => {
              const kind = path.basename(filename, '.vue')
              if (
                [
                  'SongTagDialog',
                  'BatchTagDialog',
                  'SongDetailsDialog',
                  'DeleteSongsDialog',
                  'AddSongsToPlaylistDialog',
                  'MetadataEditDialog',
                  'LyricsEditorDialog'
                ].includes(kind)
              )
                return {
                  contents: `import {h} from 'vue';export default {inheritAttrs:false,props:['modelValue','songId'],emits:['update:modelValue','saved','changed','deleted'],render(){return this.modelValue?h('div',{'data-fixture-dialog':${JSON.stringify(kind)},'data-song-id':this.songId},[h('button',{onClick:()=>this.$emit('update:modelValue',false)},'Close fixture')]):null}}`,
                  loader: 'js',
                  resolveDir: path.dirname(filename)
                }
              const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
              return {
                contents: compileScript(descriptor, {
                  id: filename,
                  inlineTemplate: true,
                  fs: {
                    fileExists: fs.existsSync,
                    readFile: (name) => fs.readFileSync(name, 'utf8')
                  }
                }).content,
                loader: 'ts',
                resolveDir: path.dirname(filename)
              }
            })
          }
        }
      ]
    })
    const window = new BrowserWindow({
      show: false,
      width: 1024,
      height: 850,
      webPreferences: { offscreen: true, backgroundThrottling: false }
    })
    window.webContents.on('console-message', (event) => {
      if (!event.message.includes('Security Warning')) console.log(event.message)
    })
    const fixture = path.join(app.getPath('userData'), 'fixture.html')
    fs.writeFileSync(fixture, '<html><body><div id="app"></div></body></html>')
    await window.loadFile(fixture)
    await window.webContents.executeJavaScript(bundle.outputFiles[0].text)
    const css = fs.readFileSync(
      path.join(
        'out/renderer/assets',
        fs.readdirSync('out/renderer/assets').find((file) => /^main-.*\.css$/.test(file))
      ),
      'utf8'
    )
    await window.webContents.executeJavaScript(
      'const style=document.createElement("style");style.textContent=' +
        JSON.stringify(css) +
        ';document.head.append(style);void 0;'
    )
    await window.webContents.executeJavaScript(
      'window.fixtureLyricStyles=' +
        JSON.stringify(
          ['PlayerLyrics.vue', 'PlayerLyricsV2.vue'].map((name) =>
            parse(fs.readFileSync(path.join('src/renderer/src/components/lyrics', name), 'utf8'))
              .descriptor.styles.map((style) => style.content)
              .join('\n')
          )
        )
    )
    window.webContents.debugger.attach('1.3')
    await window.webContents.debugger.sendCommand('DOM.enable')
    await window.webContents.debugger.sendCommand('CSS.enable')
    await window.webContents.debugger.sendCommand('Runtime.addBinding', {
      name: 'fixtureLyricHover'
    })
    let inspectedNodeId
    window.webContents.debugger.on('message', async (_event, method, params) => {
      if (method !== 'Runtime.bindingCalled' || params.name !== 'fixtureLyricHover') return
      let failure = null
      try {
        if (params.payload === 'on') {
          const { root } = await window.webContents.debugger.sendCommand('DOM.getDocument')
          const { nodeId } = await window.webContents.debugger.sendCommand('DOM.querySelector', {
            nodeId: root.nodeId,
            selector: '[data-fixture-inspect]'
          })
          inspectedNodeId = nodeId
        }
        await window.webContents.debugger.sendCommand('CSS.forcePseudoState', {
          nodeId: inspectedNodeId,
          forcedPseudoClasses: params.payload === 'on' ? ['hover'] : []
        })
      } catch (error) {
        failure = String(error)
      }
      await window.webContents.executeJavaScript(
        'window.finishLyricHover(' + JSON.stringify(failure) + ')'
      )
    })
    const results = await window.webContents.executeJavaScript('(' + runFixture.toString() + ')()')
    console.log(JSON.stringify(results, null, 2))
    window.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
