/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const esbuild = require('esbuild'),
  { parse, compileScript } = require('@vue/compiler-sfc')
app.setPath('userData', fs.mkdtempSync(path.resolve('build/source-metadata-ui-')))
app.disableHardwareAcceleration()
async function runFixture() {
  const { Vue, createI18n, Dialog, Message, zh } = window.Fixture
  const { h, createApp, reactive, nextTick } = Vue
  const wait = async () => {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const ref = { sourceId: 'netease', resourceType: 'track', resourceId: '123' }
  const detail = {
    resource: ref,
    title: '城市微光（录音室版）',
    artist: '示例歌手',
    album: '夜行',
    durationMs: 213000,
    releaseDate: '2020-06-10',
    metadata: {
      title: '城市微光（录音室版）',
      artist: '示例歌手',
      album: '夜行',
      albumArtist: '示例歌手',
      genre: 'Pop-Jpop',
      year: 2020,
      trackNumber: 3,
      discNumber: 1
    },
    artwork: { imageUrl: 'https://image.test/cover' }
  }
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')
  context.fillStyle = '#23445e'
  context.fillRect(0, 0, 128, 128)
  context.fillStyle = '#9ac1d3'
  context.fillRect(36, 25, 56, 78)
  window.searchQueries = []
  window.searchSources = []
  window.trackRefs = []
  window.applied = []
  window.saved = 0
  window.failWrite = true
  window.cancelledRequests = []
  window.api = {
    networkSources: {
      cancelRequest: async (id) => {
        window.cancelledRequests.push(id)
        return { success: true, cancelled: true }
      }
    },
    metadata: {
      read: async () => ({
        success: true,
        data: {
          title: '本地曲名',
          artist: '示例歌手',
          album: '未命名专辑',
          lyrics: '[00:01.00]原歌词'
        }
      }),
      listSources: async () => ({
        success: true,
        data: [
          { id: 'netease', displayName: '网易云音乐' },
          { id: 'kugou', displayName: 'KuGou' },
          { id: 'qqmusic', displayName: 'QQ Music' }
        ]
      }),
      sourceSnapshot: async () => ({
        success: true,
        data: {
          metadata: { title: '本地曲名', artist: '示例歌手', album: '未命名专辑', year: 2019 },
          hasCover: false,
          revision: 'file-1'
        }
      }),
      searchTracks: async (_source, query) => {
        window.searchQueries.push(query)
        window.searchSources.push(_source)
        if (window.holdNextSearch) {
          window.holdNextSearch = false
          return new Promise((resolve) => {
            window.finishHeldSearch = resolve
          })
        }
        if (window.failNextSearch) {
          window.failNextSearch = false
          return {
            success: false,
            error: '网络来源响应超时，请重试。',
            failure: { code: 'TIMEOUT', retryable: true }
          }
        }
        return {
          success: true,
          data: [{ ...detail, resource: { ...detail.resource, sourceId: _source } }]
        }
      },
      searchCovers: async () => ({ success: true, data: [] }),
      getTrack: async (resource) => {
        window.trackRefs.push(resource)
        await window.sourceTestBridge.check(resource)
        return { success: true, data: { ...detail, resource } }
      },
      getTrackLyrics: async (resource) => {
        await window.sourceTestBridge.check(resource)
        return { success: true, data: { lrc: '[00:01.00]微光照亮归途' } }
      },
      downloadCover: async () => ({ success: true, data: { dataUrl: canvas.toDataURL() } }),
      applySource: async (request) => {
        await window.sourceTestBridge.check(request)
        if (window.failWrite) {
          window.failWrite = false
          return { success: false, error: '音频文件被占用，请切换歌曲后重试。' }
        }
        window.applied.push(request)
        return { success: true }
      }
    }
  }
  const state = reactive({ modelValue: true, songId: 1 })
  createApp({
    render: () =>
      h('div', [
        h(Dialog, {
          ...state,
          'onUpdate:modelValue': (value) => (state.modelValue = value),
          onSaved: () => window.saved++
        }),
        h(Message)
      ])
  })
    .use(createI18n({ legacy: false, locale: 'zh', messages: { zh } }))
    .mount('#app')
  await wait()
  window.uiWait = wait
  window.uiClick = (text) => {
    const button = [...document.querySelectorAll('button')].find(
      (button) => !button.closest('[inert]') && button.textContent.trim() === text
    )
    if (!button) throw Error('Missing button ' + text)
    window.uiUserClick(button)
  }
  window.uiUserClick = (element) => {
    element.scrollIntoView({ block: 'center' })
    if (element.closest('[inert]')) throw Error('Control is inert: ' + element.textContent.trim())
    const rect = element.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    if (!hit || !element.contains(hit))
      throw Error('Control is covered by another layer: ' + element.textContent.trim())
    element.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' })
    )
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
    element.click()
  }
  const tabs = [...document.querySelectorAll('[role=tab]')]
  window.uiUserClick(tabs[1])
  await wait()
  if (tabs[1].getAttribute('aria-selected') !== 'true')
    throw Error('Metadata lyrics tab must be selectable')
  window.uiUserClick(tabs[0])
  await wait()
  const parentTitle = document.querySelector('input')
  parentTitle.focus()
  parentTitle.select()
  await window.sourceTestBridge.typeText('保留中的手动修改')
  await wait()
  if (parentTitle.value !== '保留中的手动修改')
    throw Error('Parent input must accept keyboard editing')
  window.uiClick('网络匹配')
  await wait()
  window.uiClick('取消')
  await wait()
  await new Promise((resolve) => setTimeout(resolve, 200))
  if (document.querySelector('input').value !== '保留中的手动修改')
    throw Error('Closing child dialog must retain the editor draft')
  const coverSearchButton = document.querySelector('button[aria-label="搜索网络封面"]')
  window.uiUserClick(coverSearchButton)
  await wait()
  const coverQuery = document.querySelector('input[placeholder="输入关键词后搜索"]')
  coverQuery.focus()
  coverQuery.select()
  await window.sourceTestBridge.typeText('封面搜索输入')
  await wait()
  if (coverQuery.value !== '封面搜索输入') throw Error('Cover query must accept keyboard editing')
  coverQuery.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  )
  await wait()
  await new Promise((resolve) => setTimeout(resolve, 200))
  window.uiClick('网络匹配')
  await wait()
  const query = document.querySelector('input[placeholder="输入歌曲名、歌手或专辑"]')
  if (!query || query.closest('[inert]')) throw Error('Network query must be interactive')
  query.focus()
  await wait()
  if (document.activeElement !== query) throw Error('Network query cannot retain focus')
  query.select()
  await window.sourceTestBridge.typeText('修改后的搜索词')
  await wait()
  if (query.value !== '修改后的搜索词') throw Error('Network query must accept keyboard editing')
  const source = document.querySelector('button[aria-label="信息来源"]')
  if (!source?.classList.contains('ep-select')) throw Error('Source must use the shared select')
  window.uiUserClick(source)
  await wait()
  const option = [...document.querySelectorAll('[role=option]')].find(
    (item) => item.textContent.trim() === '酷狗音乐'
  )
  if (!option || option.closest('[inert]'))
    throw Error('Source options must be interactive in nested dialogs')
  window.uiUserClick(option)
  await wait()
  if (!source.textContent.includes('酷狗音乐'))
    throw Error('Second metadata source must be selectable')
  window.uiUserClick(source)
  await wait()
  const qqOption = [...document.querySelectorAll('[role=option]')].find(
    (item) => item.textContent.trim() === 'QQ 音乐'
  )
  if (!qqOption) throw Error('QQ metadata source must be available')
  window.uiUserClick(qqOption)
  await wait()
  if (!source.textContent.includes('QQ 音乐'))
    throw Error('Third metadata source must be selectable')
  window.holdNextSearch = true
  window.uiClick('搜索曲目')
  await wait()
  window.uiClick('取消请求')
  await wait()
  if (window.cancelledRequests.length !== 1) throw Error('Cancel must reach the host')
  window.finishHeldSearch({ success: true, data: [detail] })
  await wait()
  if (
    [...document.querySelectorAll('button')].some((button) =>
      button.textContent.includes('城市微光（录音室版）')
    )
  )
    throw Error('Cancelled request cannot publish late candidates')
  if (document.querySelector('.ep-dialog [role=alert]'))
    throw Error('User cancellation must remain quiet')
  window.failNextSearch = true
  window.uiClick('搜索曲目')
  await wait()
  if (!document.querySelector('.ep-dialog [role=alert]')?.textContent.includes('响应超时'))
    throw Error('Timeout must be actionable in the dialog')
  window.uiClick('搜索曲目')
  await wait()
  if (document.querySelector('.ep-dialog [role=alert]'))
    throw Error('Retry must clear the previous failure')
  if (window.searchSources.at(-1) !== 'qqmusic') throw Error('Selected source must reach search')
  if (window.searchQueries.at(-1) !== '修改后的搜索词')
    throw Error('Edited query must reach the search request')
  const candidate = [...document.querySelectorAll('button')].find((button) =>
    button.textContent.includes('城市微光（录音室版）')
  )
  if (!candidate) throw Error('No candidate')
  window.uiUserClick(candidate)
  await wait()
  if (window.trackRefs.at(-1)?.sourceId !== 'qqmusic')
    throw Error('Exact detail must retain the selected source')
  if (window.applied.length) throw Error('Selecting a candidate wrote metadata')
  window.uiClick('获取此曲目歌词')
  window.uiClick('获取此曲目封面')
  await wait()
  const save = [...document.querySelectorAll('button')].find(
    (button) => button.textContent.trim() === '写入所选字段'
  )
  if (!save.disabled) throw Error('Save requires explicit selection')
  const albumArtist = document.querySelector('input[type=checkbox][value=albumArtist]')
  if (!albumArtist || albumArtist.disabled) throw Error('File must allow album artist')
  const genre = document.querySelector('tbody input[value=genre]')
  if (!genre || !genre.closest('tr').textContent.includes('Pop-Jpop'))
    throw Error('Canonical genre must be selectable')
  window.uiUserClick(document.querySelector('input[type=checkbox][value=title]'))
  await wait()
  const header = document.querySelector('thead input[type=checkbox]')
  if (!header.indeterminate || header.checked)
    throw Error('Partial selection must be visible in the header')
  if (save.disabled) throw Error('Selected title should enable saving')
  window.uiUserClick(header)
  await wait()
  if (!header.checked || header.indeterminate) throw Error('Header must select all fields')
  if ([...document.querySelectorAll('tbody input[type=checkbox]')].some((input) => !input.checked))
    throw Error('Select all must include lyrics and artwork')
  window.uiClick('取消全选')
  await wait()
  if (document.querySelector('tbody input:checked'))
    throw Error('Clear selection must uncheck all fields')
  window.uiClick('全选')
  await wait()
  if (!header.checked) throw Error('Select all action must update the header')
}
async function finishFixture() {
  await window.uiWait()
  if (document.documentElement.scrollWidth > innerWidth) throw Error('Horizontal page overflow')
  const header = document.querySelector('thead input[type=checkbox]')
  window.uiUserClick(header)
  await window.uiWait()
  for (const field of ['title', 'albumArtist', 'genre']) {
    window.uiUserClick(document.querySelector('input[type=checkbox][value=' + field + ']'))
    await window.uiWait()
  }
  window.uiClick('写入所选字段')
  await window.uiWait()
  const alert = document.querySelector('.ep-dialog [role=alert]')
  if (
    !alert?.textContent.includes('无法保存元数据') ||
    !alert.textContent.includes('音频文件被占用')
  )
    throw Error('Failed save must show operation and reason in the dialog')
  const rect = alert.getBoundingClientRect()
  if (rect.top < 0 || rect.bottom > innerHeight) throw Error('Failure feedback must remain visible')
  if (!document.querySelector('.ep-messages')?.textContent.includes('音频文件被占用'))
    throw Error('Failed save must show the shared error message')
  if (window.saved || window.applied.length) throw Error('A failed save must not report success')
  if (document.querySelectorAll('tbody input:checked').length !== 3)
    throw Error('Failed save must retain field selection')
}
async function retryFixture() {
  window.uiClick('写入所选字段')
  await window.uiWait()
  return { applied: window.applied, saved: window.saved }
}
app.whenReady().then(async () => {
  try {
    const bundle = await esbuild.build({
      stdin: {
        contents:
          "export * as Vue from 'vue'; export {createI18n} from 'vue-i18n'; export {default as Dialog} from './src/renderer/src/components/songlist/MetadataEditDialog.vue'; export {default as Message} from './src/renderer/src/components/ui/BaseMessage.vue'; export {default as zh} from './src/renderer/src/i18n/locales/zh';",
        resolveDir: process.cwd()
      },
      bundle: true,
      platform: 'browser',
      format: 'iife',
      globalName: 'Fixture',
      write: false,
      loader: { '.css': 'empty' },
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
          name: 'sfc',
          setup(build) {
            build.onResolve({ filter: /stores[\\/]ui[\\/]uiStore$/ }, () => ({
              path: 'ui-store',
              namespace: 'metadata-fixture'
            }))
            build.onLoad({ filter: /.*/, namespace: 'metadata-fixture' }, () => ({
              contents: "export const useUIStore = () => ({ genreSeparator: ';' })",
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
    const cloneRequests = []
    ipcMain.handle('source-metadata:test-clone', (_event, request) => {
      cloneRequests.push(request)
      return true
    })
    ipcMain.handle('source-metadata:test-type', async (event, text) => {
      await event.sender.insertText(text)
      return true
    })
    const preload = path.join(app.getPath('userData'), 'clone-preload.cjs')
    fs.writeFileSync(
      preload,
      "const {contextBridge,ipcRenderer}=require('electron'); contextBridge.exposeInMainWorld('sourceTestBridge',{check:request=>ipcRenderer.invoke('source-metadata:test-clone',request),typeText:text=>ipcRenderer.invoke('source-metadata:test-type',text)});"
    )
    const window = new BrowserWindow({
      show: false,
      width: 1024,
      height: 850,
      webPreferences: {
        preload,
        contextIsolation: true,
        sandbox: true,
        offscreen: true,
        backgroundThrottling: false
      }
    })
    const fixture = path.join(app.getPath('userData'), 'fixture.html')
    fs.writeFileSync(fixture, '<html><body><div id="app"></div></body></html>')
    await window.loadFile(fixture)
    await window.webContents.executeJavaScript(
      'window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()),16); window.cancelAnimationFrame = clearTimeout; void 0;'
    )
    await window.webContents.executeJavaScript(bundle.outputFiles[0].text)
    const cssFile = fs
      .readdirSync('out/renderer/assets')
      .find((file) => /^main-.*\.css$/.test(file))
    const css = fs.readFileSync(path.join('out/renderer/assets', cssFile), 'utf8')
    await window.webContents.executeJavaScript(
      'const style=document.createElement("style");style.textContent=' +
        JSON.stringify(css) +
        ';document.head.append(style);'
    )
    await window.webContents.executeJavaScript('(' + runFixture.toString() + ')()')
    fs.writeFileSync(
      path.resolve('build/source-metadata-dialog.png'),
      (await window.webContents.capturePage()).toPNG()
    )
    window.setSize(640, 780)
    await window.webContents.executeJavaScript('(' + finishFixture.toString() + ')()')
    fs.writeFileSync(
      path.resolve('build/source-metadata-error.png'),
      (await window.webContents.capturePage()).toPNG()
    )
    const result = await window.webContents.executeJavaScript('(' + retryFixture.toString() + ')()')
    assert.equal(cloneRequests.filter((request) => request.resourceId === '123').length, 2)
    assert.equal(cloneRequests.filter((request) => request.songId === 1).length, 2)
    assert.equal(result.saved, 1)
    assert.equal(result.applied.length, 1)
    assert.equal('target' in result.applied[0], false)
    assert.equal(result.applied[0].patch.genre, 'Pop-Jpop')
    assert.deepEqual(Object.keys(result.applied[0].patch).sort(), ['albumArtist', 'genre', 'title'])
    console.log(
      'Source metadata UI: nested dialogs, keyboard input, tabs, shared select, select all, mixed selection, failure feedback, retry and narrow layout passed'
    )
    console.log('Preview: ' + path.resolve('build/source-metadata-dialog.png'))
    window.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
