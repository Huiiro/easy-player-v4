/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const esbuild = require('esbuild'),
  { parse, compileScript } = require('@vue/compiler-sfc')
app.setPath('userData', fs.mkdtempSync(path.resolve('build/network-sources-ui-')))
app.disableHardwareAcceleration()
async function runFixture() {
  const { Vue, createI18n, Settings, Plugins, Downloads, Message, zh } = window.Fixture
  const { createApp, h, nextTick, ref } = Vue
  window.api = {
    networkSources: window.sourceBridge,
    plugins: window.pluginBridge,
    database: { command: async () => ({ success: true, data: null }) },
    downloads: { history: async () => [], onProgress: () => () => {}, thumbnail: async () => null }
  }
  const page = ref('settings')
  const instance = createApp({
    render: () =>
      h('div', [
        h(
          'nav',
          { class: 'flex gap-3 p-4' },
          ['settings', 'plugins', 'downloads'].map((id) =>
            h('button', { 'data-page': id, onClick: () => (page.value = id) }, id)
          )
        ),
        h(
          'main',
          {
            id: 'settings',
            class: 'settings-page mx-auto max-w-3xl p-5',
            style: { display: page.value === 'settings' ? '' : 'none' }
          },
          [
            h('h2', { class: 'mb-2 text-xl font-semibold text-text' }, zh.networkSources.title),
            h('p', { class: 'mb-5 text-sm text-text-l' }, zh.networkSources.description),
            h('div', { class: 'settings-card' }, [h(Settings)])
          ]
        ),
        h(
          'main',
          {
            id: 'plugins',
            class: 'settings-page mx-auto max-w-3xl p-5',
            style: { display: page.value === 'plugins' ? '' : 'none' }
          },
          [
            h('h2', { class: 'mb-4 text-xl font-semibold text-text' }, zh.plugins.title),
            h('div', { class: 'settings-card' }, [h(Plugins)])
          ]
        ),
        h(
          'div',
          { id: 'downloads', style: { display: page.value === 'downloads' ? '' : 'none' } },
          [h(Downloads)]
        ),
        h(Message)
      ])
  }).use(createI18n({ legacy: false, locale: 'zh', messages: { zh } }))
  instance.mount('#app')
  window.showPage = (id) => {
    page.value = id
  }
  window.unmountFixture = () => instance.unmount()
  window.uiWait = async () => {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
  window.switchFor = (name) =>
    [...document.querySelectorAll('#settings .setting-row')]
      .find((row) => row.querySelector('h3').textContent.trim() === name)
      ?.querySelector('[role=switch]')
  await window.uiWait()
  if (!document.querySelector('#settings [role=alert]'))
    throw Error('Initial load failures must be visible')
  document.querySelector('#settings [role=alert] button').click()
  await window.uiWait()
  if (document.querySelectorAll('#settings [role=switch]').length !== 5)
    throw Error('All sources must be listed')
  const netease = window.switchFor('网易云音乐')
  if (netease.getAttribute('aria-checked') !== 'true')
    throw Error('Sources must default to enabled')
  const row = netease.closest('.setting-row')
  if (
    !row.textContent.includes('元数据') ||
    !row.textContent.includes('封面') ||
    !row.textContent.includes('v1.0.0')
  )
    throw Error('Capabilities and versions must be visible')
  netease.click()
  await window.uiWait()
  if (netease.getAttribute('aria-checked') !== 'true')
    throw Error('Failed persistence must retain the switch state')
  if (!document.querySelector('#settings [role=alert]')?.textContent.includes('模拟保存失败'))
    throw Error('Save failure must be visible')
  netease.click()
  await window.uiWait()
  if (netease.getAttribute('aria-checked') !== 'false')
    throw Error('Retry must apply the switch state')
  window.switchFor('YouTube').click()
  await window.uiWait()
  if (
    [...document.querySelectorAll('#downloads button')].some(
      (button) => button.textContent.trim() === 'YouTube'
    )
  )
    throw Error('Disabled source must disappear from download choices')
  window.switchFor('哔哩哔哩').click()
  await window.uiWait()
  if (!document.querySelector('#downloads').textContent.includes('没有可用的下载来源'))
    throw Error('All disabled must have an empty state')
  const search = [...document.querySelectorAll('#downloads button')].find(
    (button) => button.textContent.trim() === '搜索'
  )
  if (!search?.disabled) throw Error('Search must be disabled without an available source')
  await window.sourceBridge.setEnabled('youtube', true)
  await window.uiWait()
  if (window.switchFor('YouTube').getAttribute('aria-checked') !== 'true')
    throw Error('External updates must refresh settings')
  if (
    ![...document.querySelectorAll('#downloads button')].some(
      (button) => button.textContent.trim() === 'YouTube'
    )
  )
    throw Error('External updates must refresh download choices')
  if (window.sourceBridge.listeners() !== 2)
    throw Error('Each mounted consumer must have one subscription')
  page.value = 'plugins'
  await window.uiWait()
  if (!document.querySelector('#plugins [role=alert]'))
    throw Error('Plugin load failure must be visible')
  document.querySelector('#plugins [role=alert] button').click()
  await window.uiWait()
  const pluginSwitch = (name) =>
    [...document.querySelectorAll('#plugins .setting-row')]
      .find((row) => row.querySelector('h3').textContent.trim() === name)
      ?.querySelector('[role=switch]')
  if (document.querySelectorAll('#plugins [role=switch]').length !== 5)
    throw Error('Five plugins must be listed')
  const kugou = pluginSwitch('酷狗音乐')
  kugou.click()
  await window.uiWait()
  if (kugou.getAttribute('aria-checked') !== 'false' || !window.switchFor('酷狗音乐').disabled)
    throw Error('Stopping a plugin must suspend its source')
  if (!window.switchFor('酷狗音乐').closest('.setting-row').textContent.includes('所属插件未运行'))
    throw Error('Source must explain why it is unavailable')
  kugou.click()
  await window.uiWait()
  await window.sourceBridge.setEnabled('kugou', false)
  await window.uiWait()
  kugou.click()
  await window.uiWait()
  kugou.click()
  await window.uiWait()
  if (window.switchFor('酷狗音乐').getAttribute('aria-checked') !== 'false')
    throw Error('Plugin restart must retain individual source preferences')
  await window.pluginBridge.failNext('save')
  kugou.click()
  await window.uiWait()
  if (kugou.getAttribute('aria-checked') !== 'true')
    throw Error('Persistence failure must retain the plugin state')
  if (!document.querySelector('#plugins [role=alert]')?.textContent.includes('模拟插件保存失败'))
    throw Error('Plugin save failure must remain visible')
  kugou.click()
  await window.uiWait()
  await window.pluginBridge.failNext('activate')
  kugou.click()
  await window.uiWait()
  const pluginRow = kugou.closest('.setting-row')
  if (
    !pluginRow.textContent.includes('插件启动失败') ||
    kugou.getAttribute('aria-checked') !== 'false'
  )
    throw Error('Failed activation must show its actual state')
  ;[...pluginRow.querySelectorAll('button')]
    .find((button) => button.textContent.trim() === '重试启动')
    .click()
  await window.uiWait()
  if (
    kugou.getAttribute('aria-checked') !== 'true' ||
    pluginRow.textContent.includes('插件启动失败')
  )
    throw Error('Retry must recover the plugin')
  const youtube = pluginSwitch('YouTube')
  youtube.click()
  await window.uiWait()
  if (
    [...document.querySelectorAll('#downloads button')].some(
      (button) => button.textContent.trim() === 'YouTube'
    )
  )
    throw Error('Stopping a download plugin removes its choices')
  youtube.click()
  await window.uiWait()
  if (
    ![...document.querySelectorAll('#downloads button')].some(
      (button) => button.textContent.trim() === 'YouTube'
    )
  )
    throw Error('Restarting the plugin restores its sources')
  if (window.pluginBridge.listeners() !== 1)
    throw Error('Plugin settings must own one subscription')
  const action = (text) =>
    [...document.querySelectorAll('#plugins button')].find(
      (button) => button.textContent.trim() === text
    )
  action('官方源').click()
  await window.uiWait()
  if (document.querySelectorAll('#plugins .setting-row').length !== 5)
    throw Error('Official catalog must list five optional packages')
  action('刷新官方源').click()
  await window.uiWait()
  if (!document.querySelector('#plugins [role=alert]')?.textContent.includes('模拟官方源刷新失败'))
    throw Error('Official source refresh failures must be visible')
  if (document.querySelectorAll('#plugins .setting-row').length !== 5)
    throw Error('Failed refresh must retain catalog')
  action('已安装').click()
  await window.uiWait()
  const qqRow = [...document.querySelectorAll('#plugins .setting-row')].find(
    (row) => row.querySelector('h3').textContent.trim() === 'QQ 音乐'
  )
  ;[...qqRow.querySelectorAll('button')]
    .find((button) => button.textContent.trim() === '卸载')
    .click()
  await window.uiWait()
  if (
    document.querySelectorAll('#plugins [role=switch]').length !== 4 ||
    window.switchFor('QQ 音乐')
  )
    throw Error('Uninstall removes plugin and contributed source')
  action('官方源').click()
  await window.uiWait()
  await window.pluginBridge.failNext('install')
  action('安装').click()
  await window.uiWait()
  if (!document.querySelector('#plugins [role=alert]')?.textContent.includes('模拟插件安装失败'))
    throw Error('Install failures must remain visible')
  action('安装').click()
  await window.uiWait()
  if (action('安装')) throw Error('Installed catalog entries must change to installed state')
  action('导入本地包').click()
  await window.uiWait()
  if ((await window.api.plugins.list()).data.length !== 5)
    throw Error('Cancelling import must preserve installed plugins')
  for (const plugin of (await window.api.plugins.list()).data)
    await window.api.plugins.uninstall(plugin.id)
  await window.uiWait()
  action('已安装').click()
  await window.uiWait()
  if (!document.querySelector('#plugins').textContent.includes('尚未安装插件'))
    throw Error('Empty application needs an install entry point')
  action('浏览官方插件').click()
  await window.uiWait()
  for (const plugin of (await window.api.plugins.catalog(false)).data)
    await window.api.plugins.install(plugin.id)
  await window.uiWait()
  action('已安装').click()
  await window.uiWait()
}
app.whenReady().then(async () => {
  try {
    const definitions = [
      ['netease', 'NetEase', ['lyrics', 'artwork', 'metadata']],
      ['kugou', 'KuGou', ['lyrics', 'artwork', 'metadata']],
      ['qqmusic', 'QQ Music', ['lyrics', 'artwork', 'metadata']],
      ['bili', 'Bilibili', ['download']],
      ['youtube', 'YouTube', ['download']]
    ].map(([id, displayName, capabilities]) => ({
      id,
      displayName,
      capabilities,
      apiVersion: 1,
      version: '1.0.0',
      origin: 'builtin',
      enabled: true
    }))
    const plugins = definitions.map((source) => ({
      id: 'builtin.' + source.id,
      displayName: source.displayName,
      version: '1.0.0',
      apiVersion: 1,
      origin: 'builtin',
      enabled: true,
      state: 'active',
      sources: [
        { id: source.id, displayName: source.displayName, capabilities: source.capabilities }
      ]
    }))
    const catalog = plugins.map((plugin) => ({
      ...plugin,
      size: 4096,
      sha256: 'a'.repeat(64),
      url: 'https://github.com/Huiiro/easy-player-v4/releases/download/plugins/fixture.epp'
    }))
    let catalogRequests = 0
    ipcMain.handle('plugins:catalog', (_event, refresh) => {
      catalogRequests++
      if (refresh) return { success: false, error: '模拟官方源刷新失败' }
      return { success: true, data: catalog }
    })
    ipcMain.handle('plugins:install', (event, id) => {
      if (pluginFault === 'install') {
        pluginFault = ''
        return { success: false, error: '模拟插件安装失败' }
      }
      const entry = catalog.find((plugin) => plugin.id === id)
      plugins.push({ ...entry, enabled: true, state: 'active' })
      event.sender.send('plugins:changed')
      event.sender.send('network-sources:changed')
      return { success: true }
    })
    ipcMain.handle('plugins:uninstall', (event, id) => {
      plugins.splice(
        plugins.findIndex((plugin) => plugin.id === id),
        1
      )
      event.sender.send('plugins:changed')
      event.sender.send('network-sources:changed')
      return { success: true }
    })
    ipcMain.handle('plugins:import', () => ({ success: true, cancelled: true }))
    const sourceView = () =>
      definitions
        .filter((source) => plugins.some((plugin) => plugin.id === 'builtin.' + source.id))
        .map((source) => {
          const plugin = plugins.find((entry) => entry.id === 'builtin.' + source.id)
          return {
            ...source,
            enabled: source.enabled && plugin.state === 'active',
            pluginId: plugin.id,
            pluginState: plugin.state
          }
        })
    let pluginLoadFailure = true,
      pluginFault = ''
    ipcMain.handle('plugins:list', () => {
      if (pluginLoadFailure) {
        pluginLoadFailure = false
        return { success: false, error: '模拟插件读取失败' }
      }
      return { success: true, data: plugins }
    })
    ipcMain.handle('plugins:fixture-failure', (_event, fault) => {
      pluginFault = fault
    })
    ipcMain.handle('plugins:set-enabled', (event, request) => {
      const plugin = plugins.find((entry) => entry.id === request.pluginId)
      if (pluginFault === 'save') {
        pluginFault = ''
        return { success: false, error: '模拟插件保存失败' }
      }
      if (pluginFault === 'activate' && request.enabled) {
        pluginFault = ''
        plugin.state = 'failed'
        plugin.enabled = false
        plugin.error = 'ACTIVATION_FAILED'
        event.sender.send('plugins:changed')
        event.sender.send('network-sources:changed')
        return { success: false, error: '模拟插件启动失败' }
      }
      plugin.enabled = request.enabled
      plugin.state = request.enabled ? 'active' : 'inactive'
      delete plugin.error
      event.sender.send('plugins:changed')
      event.sender.send('network-sources:changed')
      return { success: true }
    })
    let failLoad = true,
      failSave = true
    const changes = []
    ipcMain.handle('network-sources:list', () => {
      if (failLoad) {
        failLoad = false
        return { success: false, error: '模拟读取失败' }
      }
      return { success: true, data: sourceView() }
    })
    ipcMain.handle('network-sources:set-enabled', (event, request) => {
      if (failSave) {
        failSave = false
        return { success: false, error: '模拟保存失败' }
      }
      definitions.find((source) => source.id === request.sourceId).enabled = request.enabled
      changes.push(request)
      event.sender.send('network-sources:changed')
      return { success: true }
    })
    const bundle = await esbuild.build({
      stdin: {
        contents:
          "export * as Vue from 'vue'; export {createI18n} from 'vue-i18n'; export {default as Settings} from './src/renderer/src/components/settings/NetworkSourceSettings.vue'; export {default as Plugins} from './src/renderer/src/components/settings/OfficialPluginSettings.vue'; export {default as Downloads} from './src/renderer/src/views/download/Index.vue'; export {default as Message} from './src/renderer/src/components/ui/BaseMessage.vue'; export {useMessage} from './src/renderer/src/components/ui/useMessage'; export {default as zh} from './src/renderer/src/i18n/locales/zh';",
        resolveDir: process.cwd()
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
          name: 'sfc',
          setup(build) {
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
    const preload = path.join(app.getPath('userData'), 'source-preload.cjs')
    fs.writeFileSync(
      preload,
      "const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('sourceBridge',{list:()=>ipcRenderer.invoke('network-sources:list'),setEnabled:(sourceId,enabled)=>ipcRenderer.invoke('network-sources:set-enabled',{sourceId,enabled}),onChanged:callback=>{const listener=()=>callback();ipcRenderer.on('network-sources:changed',listener);return()=>ipcRenderer.removeListener('network-sources:changed',listener)},listeners:()=>ipcRenderer.listenerCount('network-sources:changed')});contextBridge.exposeInMainWorld('pluginBridge',{catalog:refresh=>ipcRenderer.invoke('plugins:catalog',refresh),install:id=>ipcRenderer.invoke('plugins:install',id),uninstall:id=>ipcRenderer.invoke('plugins:uninstall',id),importPackage:()=>ipcRenderer.invoke('plugins:import'),list:()=>ipcRenderer.invoke('plugins:list'),setEnabled:(pluginId,enabled)=>ipcRenderer.invoke('plugins:set-enabled',{pluginId,enabled}),onChanged:callback=>{const listener=()=>callback();ipcRenderer.on('plugins:changed',listener);return()=>ipcRenderer.removeListener('plugins:changed',listener)},listeners:()=>ipcRenderer.listenerCount('plugins:changed'),failNext:fault=>ipcRenderer.invoke('plugins:fixture-failure',fault)});"
    )
    const window = new BrowserWindow({
      show: false,
      width: 1040,
      height: 900,
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
    await window.webContents.executeJavaScript(bundle.outputFiles[0].text)
    const cssFile = fs
      .readdirSync('out/renderer/assets')
      .find((file) => /^main-.*\.css$/.test(file))
    const settingsCss = fs
      .readdirSync('out/renderer/assets')
      .filter((file) => file.endsWith('.css'))
      .map((file) => fs.readFileSync(path.join('out/renderer/assets', file), 'utf8'))
      .find((content) => content.includes('settings-card'))
    assert(settingsCss, 'load the real settings page stylesheet')
    const css = fs.readFileSync(path.join('out/renderer/assets', cssFile), 'utf8') + settingsCss
    await window.webContents.executeJavaScript(
      'const style=document.createElement("style");style.textContent=' +
        JSON.stringify(css) +
        ';document.head.append(style);'
    )
    assert.equal(
      catalogRequests,
      0,
      'rendering installed settings must not fetch the official source'
    )
    await window.webContents.executeJavaScript('(' + runFixture.toString() + ')()')
    assert(catalogRequests > 0, 'catalog is read only after browsing')
    await window.webContents.executeJavaScript(
      'window.Fixture.useMessage().clear(); document.querySelector("nav").style.display="none"; window.uiWait()'
    )
    await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 400))')
    fs.writeFileSync(
      path.resolve('build/official-plugins-settings.png'),
      (await window.webContents.capturePage()).toPNG()
    )
    await window.webContents.executeJavaScript("window.showPage('settings'); window.uiWait()")
    fs.writeFileSync(
      path.resolve('build/network-sources-settings.png'),
      (await window.webContents.capturePage()).toPNG()
    )
    await window.webContents.executeJavaScript(
      "window.showPage('plugins'); [...document.querySelectorAll('#plugins button')].find(button => button.textContent.trim() === '官方源').click(); window.uiWait()"
    )
    fs.writeFileSync(
      path.resolve('build/official-plugin-catalog.png'),
      (await window.webContents.capturePage()).toPNG()
    )
    window.setSize(520, 900)
    await window.webContents.executeJavaScript("window.showPage('plugins'); window.uiWait()")
    await window.webContents.executeJavaScript('window.uiWait()')
    assert.equal(
      await window.webContents.executeJavaScript(
        'document.documentElement.scrollWidth <= innerWidth'
      ),
      true
    )
    await window.webContents.executeJavaScript('window.unmountFixture(); window.uiWait()')
    assert.equal(await window.webContents.executeJavaScript('window.sourceBridge.listeners()'), 0)
    assert.equal(await window.webContents.executeJavaScript('window.pluginBridge.listeners()'), 0)
    assert.deepEqual(
      changes.map((entry) => [entry.sourceId, entry.enabled]),
      [
        ['netease', false],
        ['youtube', false],
        ['bili', false],
        ['youtube', true],
        ['kugou', false]
      ]
    )
    console.log(
      'Plugin/source management UI: lifecycle, plugin retry, independent source preferences, live download changes, capabilities, shared controls, load/save failures, state preservation, download filtering, empty state, live updates, narrow layout and subscription cleanup passed'
    )
    console.log('Preview: ' + path.resolve('build/network-sources-settings.png'))
    window.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
