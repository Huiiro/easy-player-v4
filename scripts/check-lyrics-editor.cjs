/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os')
const esbuild = require('esbuild')
const { parse, compileScript } = require('@vue/compiler-sfc')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ep-lyrics-editor-')))
app.disableHardwareAcceleration()
async function run() {
  const { Vue, createI18n, Editor, useSongActions, eventBus, zh } = window.Fixture
  const { h, createApp, reactive, nextTick } = Vue
  const wait = async (ms = 80) => {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, ms))
  }
  const results = [],
    errors = [],
    writes = [],
    events = []
  const check = (ok, name) => {
    if (!ok) throw Error(name)
    results.push(name)
  }
  window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)))
  const source = (id) => ({
    id,
    title: 'Song ' + id,
    artist: 'Artist',
    audio: id + '.flac',
    lrc: '[00:01.00]<00:01.00>Hello <00:01.50>world\n[00:03.00]Later ' + id,
    lyricFormat: 'elrc',
    translation: '[00:03.00]以后\n[00:01.00]Hello 译文',
    translationFormat: 'lrc',
    romanization: '[00:01.00]HELLO roman',
    romanizationFormat: 'lrc',
    offsetMs: null
  })
  const library = new Map([
    [1, source(1)],
    [2, source(2)]
  ])
  let failSave = false,
    holdSave = false,
    finishSave,
    holdRead = false,
    finishRead
  window.fixturePlayer = reactive({ currentQueueSong: source(99), queue: [] })
  window.api = {
    database: {
      command: async (action, params) => {
        if (action === 'getSong') {
          if (holdRead) {
            holdRead = false
            return new Promise((resolve) => (finishRead = resolve))
          }
          return { success: true, data: library.get(params.id) }
        }
        if (action === 'updateSongLyrics') {
          writes.push(JSON.parse(JSON.stringify(params)))
          if (failSave) return { success: false, error: 'fixture save failure' }
          if (holdSave) {
            holdSave = false
            return new Promise((resolve) => (finishSave = resolve))
          }
          library.set(params.id, { ...library.get(params.id), ...params })
          return { success: true, data: true }
        }
        throw Error('Unexpected command ' + action)
      }
    }
  }
  eventBus.on('lyricsUpdated', (id) => events.push(['lyrics', id]))
  eventBus.on('songLyricSettingsChanged', (id) => events.push(['offset', id]))
  let actions
  const actionProps = reactive({
    source: { type: 'songs' },
    songs: [source(1), source(2)],
    selectedIds: new Set([1, 2]),
    refresh: async () => {},
    playSong: async () => {}
  })
  const instance = createApp({
    setup() {
      actions = useSongActions(actionProps, () => {})
      return () =>
        h(Editor, {
          modelValue: actions.lyricsEditorOpen.value,
          songId: actions.lyricsEditorSongId.value,
          'onUpdate:modelValue': (value) => (actions.lyricsEditorOpen.value = value)
        })
    }
  })
  instance.config.errorHandler = (error) => errors.push(String(error))
  instance.use(createI18n({ legacy: false, locale: 'zh', messages: { zh } })).mount('#app')
  const root = () => document.querySelector('[data-lyrics-editor]')
  const button = (text) =>
    [...document.querySelectorAll('button')].find(
      (el) => el.textContent.trim() === text && !el.closest('[inert]')
    )
  const input = (element, value) => {
    element.value = value
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const change = (element) => element.dispatchEvent(new Event('change', { bubbles: true }))
  const track = (name) => root().querySelector('[data-lyric-track="' + name + '"]')
  async function open(id) {
    actions.lyricsEditorOpen.value = false
    await wait()
    actions.lyricsEditorSongId.value = id
    actions.lyricsEditorOpen.value = true
    await wait()
  }
  await actions.openMenu(actionProps.songs[0], 10, 10)
  actions.openLyricsEditor()
  await wait()
  check(
    actions.lyricsEditorSongId.value === 1 &&
      !actions.activeMenuSong.value &&
      track('lyric').value.includes('Later 1'),
    'right-click editor snapshots the chosen song independently of playback and multi-selection'
  )
  check(
    track('translation').value.startsWith('[00:03.00]') &&
      track('romanization').value.includes('HELLO'),
    'separate view loads all three original tracks'
  )
  check(
    [...root().querySelectorAll('[data-lyric-editor-toolbar] button')].every(
      (button) => button.querySelector('svg') && button.textContent.trim()
    ),
    'top toolbar actions combine icons with readable text'
  )
  check(
    !root().querySelector('[data-lyric-search-tools]') &&
      !root().querySelector('[data-lyric-offset-tools]'),
    'find/replace and offset controls start collapsed'
  )
  button('查找替换').click()
  await wait()
  check(
    button('查找替换').getAttribute('aria-expanded') === 'true' &&
      !!root().querySelector('[data-lyric-search-tools]'),
    'the top find/replace action expands its tools'
  )
  input(root().querySelector('[aria-label="查找内容"]'), 'hello')
  input(root().querySelector('[aria-label="替换为"]'), 'Hi')
  await wait()
  button('全部替换').click()
  await wait()
  check(
    ['lyric', 'translation', 'romanization'].every((name) => track(name).value.includes('Hi')),
    'replace all updates every matching track together'
  )
  button('撤回').click()
  await wait()
  check(
    track('lyric').value.includes('Hello') && track('romanization').value.includes('HELLO'),
    'one undo restores a bulk replacement across tracks'
  )
  button('重做').click()
  await wait()
  root().dispatchEvent(
    new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
  )
  await wait()
  check(track('lyric').value.includes('Hello'), 'keyboard undo uses the shared document history')
  button('下一处').click()
  await wait()
  button('下一处').click()
  await wait()
  button('替换当前').click()
  await wait()
  check(
    track('lyric').value.includes('Hello') &&
      track('translation').value.includes('Hi') &&
      track('romanization').value.includes('HELLO'),
    'find next crosses tracks and replace current affects only that match'
  )
  button('撤回').click()
  await wait()
  const before = track('lyric').value
  button('合并').click()
  await wait()
  const row = root().querySelector('[data-timeline-time="1000"]')
  check(
    button('合并').getAttribute('aria-pressed') === 'true' &&
      button('分开').getAttribute('aria-pressed') === 'false',
    'layout controls reflect the displayed timeline'
  )
  check(
    row &&
      row.querySelectorAll('[data-lyric-display]').length === 3 &&
      !root().querySelector('table') &&
      !root().querySelector('textarea'),
    'merged view reads as lyric verses without a table or permanent input boxes'
  )
  const main = row.querySelector('[data-lyric-display][data-track="lyric"]')
  const roman = row.querySelector('[data-lyric-display][data-track="romanization"]')
  const translated = row.querySelector('[data-lyric-display][data-track="translation"]')
  check(
    main.textContent === 'Hello world' &&
      !main.textContent.includes('[00:') &&
      main.getBoundingClientRect().top < roman.getBoundingClientRect().top &&
      roman.getBoundingClientRect().top < translated.getBoundingClientRect().top,
    'original lyrics, romanization and translation stack vertically with timing tags hidden'
  )
  main.click()
  await wait()
  check(
    row.querySelectorAll('textarea[data-lyric-cell]').length === 3 &&
      row.querySelector('textarea[data-track="translation"]').value.includes('Hello 译文') &&
      row.querySelector('textarea[data-track="romanization"]').value.includes('HELLO roman'),
    'selecting a sentence opens its lyrics, translation and romanization together'
  )
  const timeLabel = row.querySelector('[data-lyric-row-time]')
  check(
    timeLabel.textContent.trim() === '00:01.000' &&
      getComputedStyle(timeLabel).opacity === '1' &&
      timeLabel.getBoundingClientRect().right <=
        row.querySelector('textarea').getBoundingClientRect().left,
    'sentence time stays visible in a fixed left column during editing'
  )
  check(
    row.querySelectorAll('button').length === 3 &&
      row.querySelector('[data-lyric-row-actions] button').textContent.trim() === '完成' &&
      row.querySelector('[data-lyric-row-actions]').getBoundingClientRect().left >=
        row.querySelector('textarea').getBoundingClientRect().right,
    'edit, insert and delete actions share a single right-hand column'
  )
  const rowButtons = [...row.querySelectorAll('[data-lyric-row-actions] button')]
  check(
    rowButtons.every((button) => button.querySelector('svg') && button.textContent.trim()) &&
      rowButtons[0].getBoundingClientRect().bottom <= rowButtons[1].getBoundingClientRect().top &&
      rowButtons[1].getBoundingClientRect().bottom <= rowButtons[2].getBoundingClientRect().top,
    'sentence actions use three separate rows with icons and text'
  )
  const cell = row.querySelector('textarea[data-track="lyric"]')
  cell.focus()
  input(cell, cell.value.replace('world', 'friend'))
  await wait()
  check(
    cell.value.includes('friend') && !button('保存').disabled,
    'a pending timeline edit stays visible and enables Save before blur'
  )
  root().dispatchEvent(
    new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
  )
  await wait()
  check(
    root()
      .querySelector('[data-timeline-time="1000"] textarea[data-track="lyric"]')
      .value.includes('world'),
    'undo also captures uncommitted timeline cell edits'
  )
  const edited = root().querySelector('[data-timeline-time="1000"] textarea[data-track="lyric"]')
  input(edited, edited.value.replace('world', 'friend'))
  change(edited)
  await wait()
  const translationEdit = row.querySelector('textarea[data-track="translation"]')
  input(translationEdit, translationEdit.value + ' revised')
  change(translationEdit)
  await wait()
  const romanizationEdit = row.querySelector('textarea[data-track="romanization"]')
  input(romanizationEdit, romanizationEdit.value + ' revised')
  change(romanizationEdit)
  await wait()
  check(
    row.querySelectorAll('textarea').length === 3 &&
      translationEdit.value.includes('revised') &&
      romanizationEdit.value.includes('revised'),
    'editing each field keeps the whole sentence open'
  )
  const laterRow = root().querySelector('[data-timeline-time="3000"]')
  laterRow.querySelector('[data-lyric-row-actions] button').click()
  await wait()
  const missingRoman = laterRow.querySelector('textarea[data-track="romanization"]')
  check(
    laterRow.querySelectorAll('textarea').length === 3 && missingRoman.value === '',
    'selected sentences expose missing tracks as editable empty fields'
  )
  input(missingRoman, 'Added roman')
  change(missingRoman)
  await wait()
  check(
    laterRow.querySelector('textarea[data-track="romanization"]').value.includes('Added roman') &&
      laterRow.querySelectorAll('textarea').length === 3,
    'adding missing romanization preserves sentence selection and timing'
  )
  button('撤回').click()
  await wait()
  row.querySelector('[data-lyric-row-actions] button').click()
  await wait()
  button('完成').click()
  await wait()
  check(
    !root().querySelector('textarea') &&
      row.querySelector('[data-lyric-row-time]').textContent.trim() === '00:01.000' &&
      row.textContent.includes('Hello friend') &&
      row.textContent.includes('revised'),
    'finishing restores the lyric reading layout with its time still visible'
  )
  check(
    !button('新增一行') && !root().querySelector('textarea'),
    'line insertion is offered beside sentences instead of a global add button'
  )
  row.querySelector('[aria-label="在下方插入一行"]').click()
  await wait()
  const insertedRow = root().querySelector('[data-timeline-time="2000"]')
  check(
    !!insertedRow &&
      insertedRow.querySelectorAll('textarea').length === 3 &&
      [...root().querySelectorAll('[data-timeline-time]')]
        .map((el) => el.dataset.timelineTime)
        .join() === '1000,2000,3000',
    'insert below creates a sentence between its neighbors and opens it for editing'
  )
  const insertedMain = insertedRow.querySelector('textarea[data-track="lyric"]')
  input(insertedMain, insertedMain.value.replace('新歌词', 'New verse'))
  change(insertedMain)
  await wait()
  const insertedTranslation = insertedRow.querySelector('textarea[data-track="translation"]')
  input(insertedTranslation, 'New translation')
  change(insertedTranslation)
  await wait()
  const insertedRoman = insertedRow.querySelector('textarea[data-track="romanization"]')
  input(insertedRoman, 'New romanization')
  change(insertedRoman)
  await wait()
  insertedRow.querySelector('[aria-label="删除该行"]').click()
  await wait()
  check(
    !root().querySelector('[data-timeline-time="2000"]') &&
      !root().textContent.includes('New verse'),
    'delete line removes its main lyrics and auxiliary content together'
  )
  button('撤回').click()
  await wait()
  check(
    root().querySelector('[data-timeline-time="2000"]').textContent.includes('New verse') &&
      root().querySelector('[data-timeline-time="2000"]').textContent.includes('New translation') &&
      root().querySelector('[data-timeline-time="2000"]').textContent.includes('New romanization'),
    'one undo restores every track of a deleted sentence'
  )
  button('重做').click()
  await wait()
  check(
    !root().querySelector('[data-timeline-time="2000"]'),
    'redo reapplies the sentence deletion'
  )
  button('分开').click()
  await wait()
  check(
    track('lyric').value === before.replace('world', 'friend'),
    'switching views preserves enhanced word timing and raw source text'
  )
  button('只读查看').click()
  await wait()
  check(
    [...root().querySelectorAll('textarea')].every((el) => el.readOnly),
    'read-only view prevents editing'
  )
  button('继续编辑').click()
  await wait()
  button('调整偏移').click()
  await wait()
  check(
    !!(
      root().querySelector('[data-lyric-offset-tools]').compareDocumentPosition(track('lyric')) &
      Node.DOCUMENT_POSITION_FOLLOWING
    ),
    'the top offset action displays controls above the editor'
  )
  const offset = document.getElementById('song-lyric-editor-offset')
  input(offset, '1500')
  await wait()
  check(offset.value === '1500', 'offset entry can be typed without per-keystroke rounding')
  change(offset)
  await wait()
  button('撤回').click()
  await wait()
  check(offset.value === '', 'offset changes can be undone independently')
  button('重做').click()
  await wait()
  button('调整偏移').click()
  await wait()
  check(
    !root().querySelector('[data-lyric-offset-tools]'),
    'offset tools can collapse while preserving the edited value'
  )
  failSave = true
  button('保存').click()
  await wait()
  check(
    actions.lyricsEditorOpen.value && root().textContent.includes('fixture save failure'),
    'failed saves retain the draft and report the actual error'
  )
  failSave = false
  window.fixturePlayer.currentQueueSong = source(88)
  button('保存').click()
  await wait()
  check(
    !actions.lyricsEditorOpen.value &&
      writes.at(-1).id === 1 &&
      writes.at(-1).offsetMs === 1500 &&
      writes.at(-1).lrc.includes('<00:01.50>friend'),
    'save writes the frozen target, all tracks and song offset in one command'
  )
  check(
    events.some(([kind, id]) => kind === 'lyrics' && id === 1) &&
      events.some(([kind, id]) => kind === 'offset' && id === 1),
    'saving notifies both lyric rendering and the playback offset controller'
  )
  await open(2)
  input(track('lyric'), track('lyric').value + ' extra')
  await wait()
  button('取消').click()
  await wait()
  check(
    document.body.textContent.includes('放弃歌词修改？') && actions.lyricsEditorOpen.value,
    'closing a dirty document requires a discard decision'
  )
  button('放弃修改').click()
  await wait()
  check(!actions.lyricsEditorOpen.value, 'discard closes without saving')
  await open(2)
  input(track('lyric'), track('lyric').value + ' pending save')
  await wait()
  holdSave = true
  button('保存').click()
  await wait()
  await open(1)
  finishSave({ success: true, data: true })
  await wait()
  check(
    actions.lyricsEditorOpen.value && track('lyric').value.includes('friend'),
    'a late save cannot close or overwrite a newer editing session'
  )
  actions.lyricsEditorOpen.value = false
  await wait()
  holdRead = true
  actions.lyricsEditorSongId.value = 2
  actions.lyricsEditorOpen.value = true
  await wait()
  await open(1)
  finishRead({ success: true, data: source(2) })
  await wait()
  check(track('lyric').value.includes('friend'), 'a late load cannot overwrite a reopened editor')
  check(
    !root().querySelector('[data-lyric-search-tools]') &&
      !root().querySelector('[data-lyric-offset-tools]'),
    'reopening the dialog resets both tools to collapsed'
  )
  const longText = Array.from(
    { length: 80 },
    (_, index) =>
      `[00:${String(index).padStart(2, '0')}.00]${[2, 45, 78].includes(index) ? 'NEEDLE' : 'Line'} ${index}`
  ).join('\n')
  input(track('lyric'), longText)
  await wait()
  const middle = longText.indexOf('NEEDLE', longText.indexOf('NEEDLE') + 1)
  track('lyric').focus()
  track('lyric').setSelectionRange(middle, middle + 6)
  track('lyric').dispatchEvent(new Event('select', { bubbles: true }))
  await wait()
  button('查找替换').focus()
  button('查找替换').click()
  await wait()
  const position = () => root().querySelector('[data-lyric-match-status]').textContent.trim()
  check(
    root().querySelector('[aria-label="查找内容"]').value === 'NEEDLE' &&
      position().startsWith('2 / 3') &&
      position().includes('歌词') &&
      position().includes('46'),
    'opening find uses the selected text and displays its match index and line location'
  )
  check(
    track('lyric').selectionStart === middle && track('lyric').scrollTop > 0,
    'finding a distant match reveals its selection inside the textarea'
  )
  button('下一处').click()
  await wait()
  check(position().startsWith('3 / 3'), 'next match advances the current position')
  button('下一处').click()
  await wait()
  check(position().startsWith('1 / 3'), 'next match wraps to the beginning')
  button('上一处').click()
  await wait()
  check(position().startsWith('3 / 3'), 'previous match wraps to the final occurrence')
  track('lyric').setSelectionRange(middle + 6, middle + 6)
  track('lyric').dispatchEvent(new Event('select', { bubbles: true }))
  await wait()
  button('下一处').click()
  await wait()
  check(
    position().startsWith('3 / 3'),
    'navigation starts from the current caret when no match is selected'
  )
  button('上一处').click()
  await wait()
  check(
    position().startsWith('2 / 3'),
    'previous match navigates back from the selected occurrence'
  )
  button('合并').click()
  await wait()
  check(
    document.activeElement?.dataset.track === 'lyric' &&
      document.activeElement.value.slice(
        document.activeElement.selectionStart,
        document.activeElement.selectionEnd
      ) === 'NEEDLE',
    'switching to the merged view keeps and reveals the current match'
  )
  button('上一处').click()
  await wait()
  check(
    position().startsWith('1 / 3') && document.activeElement?.dataset.lyricCell,
    'previous match also selects the corresponding timeline cell'
  )
  check(
    document.activeElement.getBoundingClientRect().top >=
      root().querySelector('[data-lyric-timeline]').getBoundingClientRect().top,
    'the selected lyric match remains visible in the merged reading area'
  )
  button('完成').click()
  await wait()
  check(
    !root().querySelector('textarea') && !root().querySelector('table'),
    'finishing a line restores the normal lyric reading layout'
  )
  await open(2)
  check(
    !root().querySelector('[data-lyric-search-tools]'),
    'row operations do not change the default collapsed tools'
  )
  for (const time of ['1000', '3000']) {
    root().querySelector(`[data-timeline-time="${time}"] [aria-label="删除该行"]`).click()
    await wait()
  }
  check(
    !root().querySelector('[data-timeline-time]') && !!button('插入首行'),
    'deleting all sentences exposes an insert-first-line action'
  )
  button('插入首行').click()
  await wait()
  check(
    root().querySelector('[data-timeline-time="0"]').querySelectorAll('textarea').length === 3,
    'insert first line works after all sentences have been removed'
  )
  button('撤回').click()
  await wait()
  button('撤回').click()
  await wait()
  button('撤回').click()
  await wait()
  check(
    root().querySelectorAll('[data-timeline-time]').length === 2,
    'undo restores the original document after insert and delete operations'
  )
  root().querySelector('[data-timeline-time="1000"] [data-lyric-row-actions] button').click()
  await wait()
  check(errors.length === 0, 'no Vue or unhandled editor errors: ' + errors.join(';'))
  return results
}
app.whenReady().then(async () => {
  let window
  try {
    const styles = []
    const bundle = await esbuild.build({
      stdin: {
        resolveDir: process.cwd(),
        contents:
          "import * as Vue from 'vue';import {createI18n} from 'vue-i18n';import Editor from './src/renderer/src/components/lyrics/LyricsEditorDialog.vue';import {useSongActions} from './src/renderer/src/components/songlist/useSongActions';import eventBus from './src/renderer/src/utils/eventBus';import zh from './src/renderer/src/i18n/locales/zh';export {Vue,createI18n,Editor,useSongActions,eventBus,zh};"
      },
      bundle: true,
      write: false,
      format: 'iife',
      globalName: 'Fixture',
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
          setup(builder) {
            builder.onResolve({ filter: /stores[\\/]player[\\/]playerStore$/ }, () => ({
              path: 'player',
              namespace: 'fixture'
            }))
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
              contents: 'export const usePlayerStore=()=>window.fixturePlayer',
              loader: 'js'
            }))
            builder.onLoad({ filter: /\.vue$/ }, ({ path: filename }) => {
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
    window = new BrowserWindow({
      show: false,
      width: 1280,
      height: 960,
      webPreferences: { offscreen: true, backgroundThrottling: false }
    })
    const html = path.join(app.getPath('userData'), 'fixture.html')
    const iconFiles = [
      'common/layout',
      'common/lyrics2',
      'common/edit',
      'common/search',
      'common/time',
      'common/back-left',
      'common/check',
      'common/plus',
      'common/delete',
      'common/update',
      'common/refresh',
      'menu/display',
      'arrow/arrow-up',
      'arrow/arrow-down',
      'arrow/arrow-left-right'
    ]
    const symbols = iconFiles
      .map((name) => {
        const source = fs.readFileSync(
          path.join('src/renderer/src/assets/svg', name + '.svg'),
          'utf8'
        )
        const svg = source.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/)
        const attrs = svg[1].replace(/\s(?:width|height|version|xmlns(?::xlink)?)="[^"]*"/g, '')
        return `<symbol id="icon-${name.replace('/', '-')}"${attrs}>${svg[2]}</symbol>`
      })
      .join('')
    fs.writeFileSync(
      html,
      `<html><body><svg style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true"><defs>${symbols}</defs></svg><div id="app"></div></body></html>`
    )
    await window.loadFile(html)
    await window.webContents.executeJavaScript(bundle.outputFiles[0].text)
    const css =
      fs.readFileSync(
        path.join(
          'out/renderer/assets',
          fs.readdirSync('out/renderer/assets').find((name) => /^main-.*\.css$/.test(name))
        ),
        'utf8'
      ) + styles.join('\n')
    await window.webContents.executeJavaScript(
      'const style=document.createElement("style");style.textContent=' +
        JSON.stringify(css) +
        ';document.head.append(style);void 0;'
    )
    const results = await window.webContents.executeJavaScript('(' + run.toString() + ')()')
    fs.writeFileSync(
      path.resolve('build/lyrics-editor-preview.png'),
      (await window.capturePage()).toPNG()
    )
    console.log(JSON.stringify({ passed: results.length, checks: results }, null, 2))
    window.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    window?.destroy()
    app.exit(1)
  }
})
