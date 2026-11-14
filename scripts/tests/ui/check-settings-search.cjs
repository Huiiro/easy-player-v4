/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const esbuild = require('esbuild')
const { parse, compileScript, compileStyle } = require('@vue/compiler-sfc')
fs.mkdirSync('build', { recursive: true })
const root = fs.mkdtempSync(path.resolve('build/settings-search-'))
app.setPath('userData', path.join(root, 'user-data'))
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  try {
    const styles = []
    let scope = 0
    const bundle = await esbuild.build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `import * as Vue from 'vue';import {createPinia} from 'pinia';import {createI18n} from 'vue-i18n';import {useUIStore} from './src/renderer/src/stores/ui/uiStore';import Page from './src/renderer/src/views/settings/Index.vue';import zh from './src/renderer/src/i18n/locales/zh';import en from './src/renderer/src/i18n/locales/en';import {createSettingsSearchTranslator,indexSettings,searchSettings} from './src/renderer/src/utils/settingsSearch';export {Vue,createPinia,createI18n,useUIStore,Page,zh,en,createSettingsSearchTranslator,indexSettings,searchSettings};`
      },
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      globalName: 'SettingsCheck',
      alias: {
        '@': path.resolve('src/renderer/src'),
        vue: require.resolve('vue/dist/vue.esm-bundler.js')
      },
      define: {
        __APP_VERSION__: '"test"',
        __APP_BUILD__: '"0"',
        __VUE_OPTIONS_API__: 'true',
        __VUE_PROD_DEVTOOLS__: 'false',
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false'
      },
      loader: { '.webp': 'dataurl' },
      plugins: [
        {
          name: 'fixtures',
          setup(build) {
            build.onLoad(
              {
                filter:
                  /(PlaybackSettings|LyricsSettings|DesktopLyricsSettings|ThemeSettings|OfficialPluginSettings|PluginProxySettings|NetworkSourceSettings|CacheSettings|LibrarySettings|StatisticsSettings|ResetPreferencesSettings)\.vue$/
              },
              () => ({ contents: 'export default {render(){return null}}', loader: 'js' })
            )

            build.onResolve({ filter: /\?raw$/ }, (args) => ({
              path: args.path.startsWith('@/')
                ? path.resolve('src/renderer/src', args.path.slice(2, -4))
                : path.resolve(args.resolveDir, args.path.slice(0, -4)),
              namespace: 'raw'
            }))
            build.onLoad({ filter: /.*/, namespace: 'raw' }, ({ path: filename }) => ({
              contents: fs.readFileSync(filename, 'utf8'),
              loader: 'text'
            }))
            build.onLoad({ filter: /\.vue$/ }, ({ path: filename }) => {
              const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
              const id = 'update-' + ++scope
              for (const style of descriptor.styles) {
                if (style.src) {
                  styles.push(
                    fs.readFileSync(
                      style.src.startsWith('@/')
                        ? path.resolve('src/renderer/src', style.src.slice(2))
                        : path.resolve(path.dirname(filename), style.src),
                      'utf8'
                    )
                  )
                  continue
                }

                const compiled = compileStyle({
                  source: style.content,
                  filename,
                  id: 'data-v-' + id,
                  scoped: style.scoped
                })
                if (compiled.errors.length) throw compiled.errors[0]
                styles.push(compiled.code)
              }
              return {
                contents:
                  compileScript(descriptor, { id, inlineTemplate: true, genDefaultAs: '__sfc__' })
                    .content +
                  '\n__sfc__.__scopeId="data-v-' +
                  id +
                  '";export default __sfc__;',
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
      width: 1100,
      height: 900,
      webPreferences: { backgroundThrottling: false }
    })
    const errors = []
    win.webContents.on('console-message', (event) => {
      if (event.level === 'error') errors.push(event.message)
    })
    const html = path.join(root, 'test.html')
    fs.writeFileSync(html, '<html><body><div id="app"></div></body></html>')
    await win.loadFile(html)
    await win.webContents.executeJavaScript(bundle.outputFiles[0].text)
    const cssFile = fs
      .readdirSync('out/renderer/assets')
      .find((file) => /^main-.*\.css$/.test(file))
    const css =
      fs.readFileSync(path.join('out/renderer/assets', cssFile), 'utf8') + styles.join('\n')
    await win.webContents.executeJavaScript(
      `const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style);void 0;`
    )
    const result = await win.webContents.executeJavaScript(`(async()=>{
      const {Vue,createPinia,createI18n,useUIStore,Page,zh,en,createSettingsSearchTranslator,indexSettings,searchSettings}=SettingsCheck;
      const checks=[];const check=(ok,message)=>{if(!ok)throw Error(message);checks.push(message)};
      const wait=async(ms=100)=>{await Vue.nextTick();await new Promise(resolve=>setTimeout(resolve,ms));await Vue.nextTick()};
      window.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),16);window.cancelAnimationFrame=clearTimeout;
      window.api={database:{getSync:()=>({success:true}),saveSync:()=>({success:true})},plugins:{themes:async()=>({success:true,data:[]}),onChanged:()=>()=>{}},fonts:{list:async()=>({success:true,data:[]})},system:{getTaskbarControls:async()=>({success:true,data:{available:false}}),setCloseToTray:async()=>({success:true}),setAutoStart:async()=>({success:true})},log:{getLevel:async()=>'info'},appUpdate:{status:async()=>({success:true,data:{state:'available',version:'3.7.0'}}),onStatus:()=>()=>{}}};
      const i18n=createI18n({legacy:false,locale:'zh',messages:{zh,en,fr:{settings:{autoCheckUpdates:'Vérifier les mises à jour au démarrage'}}},missingWarn:false,fallbackWarn:false});
      let ui;const instance=Vue.createApp({setup(){ui=useUIStore();ui.platform='linux';ui.reduceMotion=true;return()=>Vue.h(Page)}}).use(createPinia()).use(i18n);
      document.documentElement.classList.add('dark');document.body.style.cssText='height:100vh;margin:0';document.getElementById('app').style.height='100%';
      instance.mount('#app');await wait(300);
      const effectRow=[...document.querySelectorAll('.setting-row')].find(row=>row.querySelector('h3')?.textContent===zh.settings.playerCoverEffect);
      check(effectRow,'Cover rhythm effect appears in player settings');
      effectRow.scrollIntoView({block:'center'});await wait();
      const effectTrigger=()=>effectRow.querySelector('button[aria-haspopup="listbox"]');
      check(ui.playerCoverEffect==='glow'&&effectTrigger().textContent.includes('辉光'),'Existing users retain glow by default');
      effectTrigger().click();await wait();
      const effectChoices=[...document.querySelectorAll('[role="option"]')];
      check(effectChoices.length===2&&effectChoices.some(option=>option.textContent.trim()==='关闭')&&effectChoices.some(option=>option.textContent.trim()==='辉光'),'Cover effect dropdown offers Off and Glow');
      effectChoices.find(option=>option.textContent.trim()==='关闭').click();await wait();
      check(ui.playerCoverEffect==='none'&&effectTrigger().textContent.includes('关闭'),'Selecting Off updates the player preference');
      effectTrigger().click();await wait();
      [...document.querySelectorAll('[role="option"]')].find(option=>option.textContent.trim()==='辉光').click();await wait();
      check(ui.playerCoverEffect==='glow','Selecting Glow restores the player preference');
      const trigger=()=>document.querySelector('.settings-nav button');
      check(trigger()?.textContent.includes('搜索设置'),'Search is the first settings sidebar entry');
      const open=async()=>{trigger().click();await wait(350)};
      const input=()=>document.querySelector('.ep-dialog input[type=search]');
      const search=async(query)=>{input().value=query;input().dispatchEvent(new Event('input',{bubbles:true}));await wait(150);return [...document.querySelectorAll('.settings-search-result')]};
      await open();check(document.activeElement===input(),'Opening search focuses the input');
      check((await search('封面律动效果')).some(button=>button.textContent.includes('封面律动效果')),'Cover rhythm effect is searchable');
      check((await search('系统 更新 启动')).some(button=>button.textContent.includes('启动时自动检查更新')),'Matches section, group and setting title terms together');
      check((await search('SYSTEM updates startup')).some(button=>button.textContent.includes('启动时自动检查更新')),'English hierarchy queries find Chinese settings');
      check((await search(en.settings.autoCheckUpdatesDescription)).some(button=>button.textContent.includes('启动时自动检查更新')),'Search matches translated descriptions');
      check((await search('VERIFIER LES MISES A JOUR')).some(button=>button.textContent.includes('启动时自动检查更新')),'Registered languages and accent-insensitive matching use the same message keys');
      check((await search(en.settings.brightness)).some(button=>button.textContent.includes(zh.settings.brightness)),'Slider labels remain searchable when their controls are disabled');
      check((await search(en.settings.globalBorder)).some(button=>button.textContent.includes(zh.settings.globalBorder)),'Individual color controls are indexed as settings');
      check((await search(en.settings.shortcutToggle)).some(button=>button.textContent.includes(zh.settings.shortcutToggle)),'Shortcut action labels are indexed independently');
      check((await search('Powered by Easy Player')).some(button=>button.textContent.includes('版本')),'Search includes body content outside headings and descriptions');
      check((await search('version available')).some(button=>button.textContent.includes('应用更新')),'Interpolated translated messages remain searchable');
      check((await search('no-such-setting-918273')).length===0&&document.querySelector('.ep-dialog').textContent.includes('没有找到匹配的设置'),'Empty results are explained');
      await search('asynchronous explanation');
      const note=document.createElement('p');note.textContent='An asynchronous explanation loaded after opening search';document.getElementById('system').append(note);await wait(200);
      check(document.querySelectorAll('.settings-search-result').length>0,'Asynchronous settings body text is indexed while search stays open');
      await search('SYSTEM updates startup');
      input().dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));await wait();
      check(document.activeElement?.classList.contains('settings-search-result'),'Arrow keys move focus into results');
      document.activeElement.click();await wait(400);
      const target=document.querySelector('.settings-search-highlight');
      check(!document.querySelector('.ep-dialog')&&target?.textContent.includes('启动时自动检查更新'),'Choosing a result closes search and highlights the actual setting');
      check(document.activeElement===target&&target.getBoundingClientRect().top>=0&&target.getBoundingClientRect().bottom<=innerHeight,'Result navigation scrolls the setting into view and transfers keyboard focus');
      const active=document.querySelector('.settings-nav-item.active');check(active?.textContent.includes('系统'),'Navigation updates the active settings section');
      await open();i18n.global.locale.value='en';await wait(200);
      check((await search('启动时自动检查更新')).some(button=>button.textContent.includes('Check for updates at startup')),'Chinese queries find settings after switching the UI to English');
      input().dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(350);
      check(!document.querySelector('.ep-dialog'),'Escape closes settings search');
      await wait(2600);check(!document.querySelector('.settings-search-highlight'),'The target highlight clears automatically');
      await open();await search('启动时自动检查更新');window.disposeSettingsSearch=()=>{ui.$dispose();instance.unmount()};return {passed:checks.length,checks};
    })()`)
    fs.writeFileSync(
      path.resolve('build/settings-search.png'),
      (await win.webContents.capturePage()).toPNG()
    )
    await win.webContents.executeJavaScript('window.disposeSettingsSearch()')
    if (errors.length) throw Error(errors.join('\n'))
    console.log(JSON.stringify(result, null, 2))
    win.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
