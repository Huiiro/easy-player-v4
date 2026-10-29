/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type, vue/one-component-per-file */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const esbuild = require('esbuild')
const { parse, compileScript } = require('@vue/compiler-sfc')

app.setPath('userData', fs.mkdtempSync(path.resolve('build/lyrics-manager-ui-')))
app.disableHardwareAcceleration()

async function runFixture() {
  const { Vue, createI18n, Manager, PlayerLyrics, PlayerLyricsV2, zh, eventBus } = window.Fixture
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
  const databaseLyrics = (id) => ({ lrc: '[00:01.00]Database ' + id, lyricFormat: 'lrc' })
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
  check(fileWrites === 0, 'lyric management never writes embedded audio metadata')
  return checks
}

app.whenReady().then(async () => {
  try {
    const bundle = await esbuild.build({
      stdin: {
        resolveDir: process.cwd(),
        contents:
          "export * as Vue from 'vue';export {createI18n} from 'vue-i18n';export {default as Manager} from './src/renderer/src/components/lyrics/LyricsManagerDialog.vue';export {default as PlayerLyrics} from './src/renderer/src/components/lyrics/PlayerLyrics.vue';export {default as PlayerLyricsV2} from './src/renderer/src/components/lyrics/PlayerLyricsV2.vue';export {default as zh} from './src/renderer/src/i18n/locales/zh';export {default as eventBus} from './src/renderer/src/utils/eventBus';"
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
    const results = await window.webContents.executeJavaScript('(' + runFixture.toString() + ')()')
    console.log(JSON.stringify(results, null, 2))
    window.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
