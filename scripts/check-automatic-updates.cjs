/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const esbuild = require('esbuild')
const { parse, compileScript, compileStyle } = require('@vue/compiler-sfc')
fs.mkdirSync('build', { recursive: true })
const root = fs.mkdtempSync(path.resolve('build/automatic-updates-'))
app.setPath('userData', path.join(root, 'user-data'))
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  try {
    const styles = []
    let scope = 0
    const bundle = await esbuild.build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `import * as Vue from 'vue';import {createPinia} from 'pinia';import persisted from 'pinia-plugin-persistedstate';import {createI18n} from 'vue-i18n';import {createRouter,createMemoryHistory} from 'vue-router';import {useUIStore} from './src/renderer/src/stores/ui/uiStore';import {flushPlayerDataStorage} from './src/renderer/src/stores/persistence';import Notification from './src/renderer/src/components/settings/AppUpdateNotification.vue';import HeaderUpdate from './src/renderer/src/components/settings/AppUpdateStatus.vue';import {useAppUpdateStore} from './src/renderer/src/stores/appUpdate';import Settings from './src/renderer/src/components/settings/SystemSettings.vue';import zh from './src/renderer/src/i18n/locales/zh';export {Vue,createPinia,persisted,createI18n,createRouter,createMemoryHistory,useUIStore,flushPlayerDataStorage,Notification,HeaderUpdate,useAppUpdateStore,Settings,zh};`
      },
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      globalName: 'UpdateCheck',
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
      const {Vue,createPinia,persisted,createI18n,createRouter,createMemoryHistory,useUIStore,flushPlayerDataStorage,Notification,HeaderUpdate,useAppUpdateStore,Settings,zh}=UpdateCheck;
      const check=(ok,message)=>{if(!ok)throw Error(message)};
      const wait=async(ms=100)=>{await Vue.nextTick();await new Promise(resolve=>setTimeout(resolve,ms));await Vue.nextTick()};
      const nativeTimer=window.setTimeout;
      window.requestAnimationFrame=callback=>nativeTimer(()=>callback(performance.now()),16);window.cancelAnimationFrame=clearTimeout;
      const saved=new Map();let calls=0,downloads=0,installs=0,available='3.4.0';let status={state:'idle',version:'3.3.1'};const listeners=new Set();let finishDownload;let installError='';const publish=next=>{status=next;for(const listener of listeners)listener(next)};
      window.api={database:{getSync:key=>({success:true,data:saved.get(key)}),saveSync:(key,value)=>{saved.set(key,value);return {success:true}}},plugins:{themes:async()=>({success:true,data:[]}),onChanged:()=>()=>{}},fonts:{list:async()=>({success:true,data:[]})},system:{getTaskbarControls:async()=>({success:true,data:{available:false}}),setCloseToTray:async()=>({success:true}),setAutoStart:async()=>({success:true})},log:{getLevel:async()=>'info'},appUpdate:{status:async()=>({success:true,data:status}),check:async()=>{calls++;status={state:'available',version:available};return {success:true,data:status}},download:()=>{downloads++;return new Promise(resolve=>{finishDownload=resolve})},install:async()=>{installs++;return installError?{success:false,error:installError}:{success:true}},onStatus:callback=>{listeners.add(callback);return()=>listeners.delete(callback)}}};
      let ui,instance,pinia,router;
      async function mount(){
        pinia=createPinia().use(persisted);router=createRouter({history:createMemoryHistory(),routes:[{path:'/',component:{render:()=>null}},{path:'/settings',component:{render:()=>null}}]});
        instance=Vue.createApp({setup(){ui=useUIStore();ui.platform='linux';return()=>Vue.h('main',{},[Vue.h('header',{class:'ep-header flex h-[42px] items-center'},[Vue.h(HeaderUpdate)]),Vue.h(Settings),Vue.h(Notification)])}}).use(pinia).use(createI18n({legacy:false,locale:'zh',messages:{zh},missingWarn:false,fallbackWarn:false})).use(router);
        await router.push('/');await router.isReady();instance.mount('#app');await wait(300);
      }
      const dialog=()=>document.querySelector('.ep-dialog');
      const action=label=>[...document.querySelectorAll('.ep-dialog button')].find(button=>button.textContent.trim()===label);
      await mount();
      check(calls===1&&dialog()?.textContent.includes('3.4.0'),'Startup discovers a release and renders its version in the global dialog');
      const checkbox=dialog().querySelector('input[type=checkbox]');checkbox.click();await wait();action('稍后').click();await wait(300);flushPlayerDataStorage();
      check(ui.ignoredUpdateVersions.includes('3.4.0')&&!dialog(),'Checkbox and dismiss save the ignored version: '+JSON.stringify({ignored:ui.ignoredUpdateVersions,dialog:!!dialog()}));
      useAppUpdateStore(pinia).$dispose();ui.$dispose();instance.unmount();await mount();
      check(calls===2&&!dialog()&&ui.ignoredUpdateVersions.includes('3.4.0'),'Ignored versions survive a fresh store and renderer mount');
      const updateRow=[...document.querySelectorAll('.setting-row')].find(row=>row.textContent.includes('自动检查更新'));
      check(updateRow,'System settings exposes the automatic check switch');
      updateRow.querySelector('button[role=switch]').click();await wait();
      check(ui.autoCheckUpdates===false,'Real settings switch disables automatic checks');
      available='3.5.0';status={state:'idle',version:'3.3.1'};ui.autoCheckUpdates=true;await wait(300);
      check(calls===2&&!dialog(),'Re-enabling automatic checks does not trigger a runtime request');
      flushPlayerDataStorage();useAppUpdateStore(pinia).$dispose();ui.$dispose();instance.unmount();await mount();
      check(dialog()?.textContent.includes('3.5.0'),'Ignoring one version does not suppress a newer release');
      ui.showPlayer=true;action('立即更新').click();await wait(300);
      check(!dialog()&&!ui.showPlayer&&router.currentRoute.value.path==='/'&&downloads===1,'Update now starts a download directly without navigating to settings');
      const header=()=>document.querySelector('header .app-update-status');
      check(header()?.querySelector('progress')?.value===0,'Header shows download progress immediately');
      await useAppUpdateStore(pinia).downloadUpdate();check(downloads===1,'Repeated activation cannot start overlapping downloads');
      publish({state:'downloading',version:'3.5.0',percent:42.4});await wait();
      check(header()?.querySelector('progress')?.value===42&&header().textContent.includes('42%'),'Header updates progress from updater events');
      finishDownload({success:false,error:'Download unavailable'});await wait();
      check(header()?.textContent.includes('更新失败，重试')&&header().querySelector('button').title==='Download unavailable','Download failures expose a retry action in the header');
      header().querySelector('button').click();await wait();check(downloads===2&&header().querySelector('progress'),'Header retry starts a new download');
      publish({state:'downloaded',version:'3.5.0'});finishDownload({success:true,data:status});await wait();
      check(!header().querySelector('progress')&&header().textContent.includes('重启并安装')&&installs===0,'Completed downloads become a header install action without restarting automatically');
      installError='Installer unavailable';header().querySelector('button').click();await wait();
      check(installs===1&&header().querySelector('button').title==='Installer unavailable'&&!header().querySelector('button').disabled,'Install failure preserves a usable header retry action');
      installError='';header().querySelector('button').click();await wait();check(installs===2,'Header restart action invokes installation directly');
      ui.autoCheckUpdates=false;await wait();flushPlayerDataStorage();const before=calls;useAppUpdateStore(pinia).$dispose();ui.$dispose();instance.unmount();available='3.4.0';status={state:'idle',version:'3.3.1'};await mount();
      check(!ui.autoCheckUpdates&&calls===before&&!dialog(),'Disabled preference survives reload and performs no automatic request: '+JSON.stringify({enabled:ui.autoCheckUpdates,calls,before,dialog:!!dialog()}));
      ui.autoCheckUpdates=true;await wait(300);
      check(calls===before&&!dialog(),'Enabling after a disabled startup waits until the next launch');
      // Manual checking remains available, even for a version ignored automatically.
      available='3.4.0';status={state:'idle',version:'3.3.1'};const manual=[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='检查更新');
      check(manual,'Manual check remains available with automatic checks disabled');manual.click();await wait();
      check(calls===before+1&&document.body.textContent.includes('发现新版本 3.4.0'),'Manual checks can still find an ignored version');
      useAppUpdateStore(pinia).$dispose();ui.$dispose();instance.unmount();check(listeners.size===0,'Update subscriptions are released');return 'Automatic update UI: startup prompt, checkbox persistence, settings toggle, later release, direct download, header progress, retry, install and manual checks passed';
    })()`)
    if (errors.length) throw Error(errors.join('\n'))
    console.log(result)
    win.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
