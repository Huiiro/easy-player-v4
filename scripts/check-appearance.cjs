/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-empty-function */
const { app, BrowserWindow, protocol } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const esbuild = require('esbuild')
const { parse, compileScript } = require('@vue/compiler-sfc')
const catalog = JSON.parse(fs.readFileSync('resources/plugins/catalog.json', 'utf8'))
const blackhole = catalog.plugins.find((entry) => entry.id === 'builtin.theme.blackhole')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ep-appearance-check-')))
app.commandLine.appendSwitch('use-angle', 'swiftshader')
app.commandLine.appendSwitch('enable-unsafe-swiftshader')
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'easy-player-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
])
app.whenReady().then(async () => {
  try {
    const hostDirectory = fs.mkdtempSync(path.resolve('build/theme-resource-check-'))
    const hostFile = path.join(hostDirectory, 'host.cjs')
    await esbuild.build({
      stdin: {
        contents:
          "export * from './src/main/plugins/packages'; export * from './src/main/plugins/manager'; export * from './src/main/sources/registry'; export * from './src/main/plugins/themeProtocol'",
        resolveDir: process.cwd()
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      packages: 'external',
      outfile: hostFile
    })
    const {
      OfficialPluginPackages,
      PluginManager,
      SourceRegistry,
      themeResourceResponse
    } = require(hostFile)
    const manager = new PluginManager(new SourceRegistry(), {
      readSetting() {},
      writeSetting() {},
      log() {},
      fetch() {
        throw new Error('Unexpected network request')
      }
    })
    const packages = new OfficialPluginPackages(
      path.join(hostDirectory, 'installed'),
      manager,
      {},
      catalog
    )
    packages.initialize()
    await packages.install(
      blackhole.id,
      true,
      fs.readFileSync(path.join('build/plugins', new URL(blackhole.url).pathname.split('/').at(-1)))
    )
    const themeFixture = packages.listThemes()[0]
    const rainy = catalog.plugins.find((entry) => entry.id === 'builtin.theme.rainy')
    await packages.install(
      rainy.id,
      true,
      fs.readFileSync(path.join('build/plugins', new URL(rainy.url).pathname.split('/').at(-1)))
    )
    const rainyFixture = packages.listThemes().find((theme) => theme.pluginId === rainy.id)
    const rendererEntries = catalog.plugins.filter(
      (entry) =>
        entry.kind === 'theme' &&
        !['builtin.theme.blackhole', 'builtin.theme.rainy'].includes(entry.id)
    )
    for (const entry of rendererEntries)
      await packages.install(
        entry.id,
        true,
        fs.readFileSync(path.join('build/plugins', new URL(entry.url).pathname.split('/').at(-1)))
      )
    const rendererFixtures = packages.listThemes().filter((theme) => theme.data.renderer)
    const nyanFile = path.join(hostDirectory, 'nyan.epp')
    require('./theme-plugin-fixture.cjs')(nyanFile)
    await packages.installFile(nyanFile, () => true)
    const nyanFixture = packages.listThemes().find((theme) => theme.pluginId === 'example.nyan-cat')
    const resourceRequests = []
    protocol.handle('easy-player-media', async (request) => {
      const url = new URL(request.url)
      if (url.hostname !== 'plugin-theme') return new Response('Not Found', { status: 404 })
      if (/\/paths.bin$|\/ends.bin$/.test(url.pathname))
        await new Promise((resolve) => setTimeout(resolve, 250))
      if (url.pathname.endsWith('/__frame.html'))
        await new Promise((resolve) => setTimeout(resolve, 160))
      const response = themeResourceResponse(url, (id, hash, file) =>
        packages.themeResource(id, hash, file)
      )
      resourceRequests.push({ url: request.url, status: response.status })
      return response
    })
    const styles = []
    const bundle = await esbuild.build({
      stdin: {
        contents: `import * as Vue from 'vue'; import {createPinia} from 'pinia'; import persisted from 'pinia-plugin-persistedstate'; import {createI18n} from 'vue-i18n';
        import {useUIStore} from './src/renderer/src/stores/ui/uiStore';
        import {flushPlayerDataStorage} from './src/renderer/src/stores/persistence';
        import ThemeSettings from './src/renderer/src/components/settings/ThemeSettings.vue';
        import {useMessage} from './src/renderer/src/components/ui/useMessage';
        import OfficialPluginSettings from './src/renderer/src/components/settings/OfficialPluginSettings.vue';
        import AppBackground from './src/renderer/src/components/background/AppBackground.vue';
        import {systemBackgroundThemes} from './src/renderer/src/components/background/systemBackgroundRegistry';
        import zh from './src/renderer/src/i18n/locales/zh';
        export {Vue,createPinia,persisted,createI18n,useUIStore,flushPlayerDataStorage,ThemeSettings,OfficialPluginSettings,useMessage,AppBackground,systemBackgroundThemes,zh};`,
        resolveDir: process.cwd()
      },
      bundle: true,
      platform: 'browser',
      format: 'iife',
      globalName: 'AppearanceCheck',
      write: false,
      define: {
        __APP_VERSION__: '"test"',
        __APP_BUILD__: '"0"',
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
          name: 'vue',
          setup(build) {
            build.onResolve({ filter: /[\\/]stores[\\/]player[\\/]playerStore(?:\.ts)?$/ }, () => ({
              path: 'player',
              namespace: 'fixture'
            }))
            build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
              contents: 'export const usePlayerStore=()=>({currentQueueSong:null})',
              loader: 'js'
            }))
            build.onResolve({ filter: /\.glsl\?raw$/ }, ({ path: filename, resolveDir }) => ({
              path: filename.startsWith('@/')
                ? path.resolve('src/renderer/src', filename.slice(2).replace('?raw', ''))
                : path.resolve(resolveDir, filename.replace('?raw', '')),
              namespace: 'shader'
            }))
            build.onLoad({ filter: /.*/, namespace: 'shader' }, ({ path: filename }) => ({
              contents: 'export default ' + JSON.stringify(fs.readFileSync(filename, 'utf8')),
              loader: 'js'
            }))
            build.onLoad({ filter: /\.vue$/ }, ({ path: filename }) => {
              const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
              descriptor.styles.forEach((style) => styles.push(style.content))
              return {
                contents:
                  compileScript(descriptor, {
                    id: filename,
                    inlineTemplate: true,
                    fs: {
                      fileExists: fs.existsSync,
                      readFile: (file) => fs.readFileSync(file, 'utf8')
                    }
                  }).content + '\nexport const __esModule = true;',
                loader: 'ts',
                resolveDir: path.dirname(filename)
              }
            })
          }
        }
      ]
    })
    const probePreload = path.join(hostDirectory, 'probe-preload.cjs')
    fs.writeFileSync(
      probePreload,
      "require('electron').contextBridge.exposeInMainWorld('__hostProbe',{value:'host-only'})"
    )
    const window = new BrowserWindow({
      show: false,
      width: 1100,
      height: 1000,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        preload: probePreload,
        offscreen: true,
        backgroundThrottling: false
      }
    })
    const errors = []
    window.webContents.on('console-message', (event) => {
      if (event.level === 'error') {
        errors.push(event.message)
        console.error(event.message)
      }
    })
    const fixture = path.join(app.getPath('userData'), 'appearance.html')
    const csp = fs
      .readFileSync('src/renderer/index.html', 'utf8')
      .match(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/)[0]
    const playbackCsp = fs
      .readFileSync('src/renderer/extreme.html', 'utf8')
      .match(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/)[0]
    if (csp.match(/connect-src[^;]+/)[0] !== playbackCsp.match(/connect-src[^;]+/)[0])
      throw new Error('Main and playback-only windows must share the tested connection policy')
    fs.writeFileSync(
      fixture,
      '<html><head>' + csp + '</head><body><div id="app"></div></body></html>'
    )
    await window.loadFile(fixture)
    const mainCss = fs
      .readdirSync('out/renderer/assets')
      .find((file) => /^main-.*\.css$/.test(file))
    const css =
      fs.readFileSync(path.join('out/renderer/assets', mainCss), 'utf8') +
      fs.readFileSync('src/renderer/src/styles/settings.css', 'utf8') +
      styles.join('\n')
    await window.webContents.executeJavaScript(
      `const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style);void 0;`
    )
    await window.webContents.executeJavaScript(bundle.outputFiles[0].text)
    await window.webContents.executeJavaScript(
      'window.__themeFixture = ' +
        JSON.stringify(themeFixture) +
        ';window.__nyanFixture = ' +
        JSON.stringify(nyanFixture) +
        ';window.__rainyFixture = ' +
        JSON.stringify(rainyFixture) +
        ';window.__rendererFixtures = ' +
        JSON.stringify(rendererFixtures) +
        ';void 0'
    )
    const result = await window.webContents.executeJavaScript(`(async()=>{
      const {Vue,createPinia,persisted,createI18n,useUIStore,flushPlayerDataStorage,ThemeSettings,OfficialPluginSettings,useMessage,AppBackground,systemBackgroundThemes,zh}=AppearanceCheck;
      const {h,createApp,nextTick}=Vue;
      const checks=[];const check=(ok,message)=>{if(!ok)throw new Error(message);checks.push(message)};
      const wait=async()=>{await nextTick();await nextTick();await nextTick();await new Promise(resolve=>setTimeout(resolve,30))};
      const settings=new Map([['pinia.ui.preferences.v1',JSON.stringify({reduceMotion:true,useDarkMode:true,followSystemTheme:true,useMica:true,systemBackground:'none',themeBeforeMica:{useDarkMode:false,followSystemTheme:false,useCustomBg:false,systemBackground:'plugin:builtin.theme.rainy'}})]]);
      let material='acrylic',failMaterial=false;const removed=[];
      let systemDark=false;const mediaListeners=new Set();
      window.matchMedia=query=>({matches:query==='(prefers-color-scheme: dark)'?systemDark:false,addEventListener:(_event,fn)=>{if(query==='(prefers-color-scheme: dark)')mediaListeners.add(fn)},removeEventListener:(_event,fn)=>mediaListeners.delete(fn)});
      window.api={fonts:{list:async()=>({success:true,data:[]})},themes:{removePackage:async id=>removed.push(id)},system:{getWindowMaterialState:async()=>({success:true,data:{available:['none','mica','acrylic'],material,enabled:material!=='none'}}),setWindowMaterial:async value=>{if(failMaterial)return {success:false,error:'fixture failure'};material=value;return {success:true,data:{material,enabled:material!=='none'}}}},database:{getSync:key=>({success:true,data:settings.get(key)}),saveSync:(key,value)=>{settings.set(key,value);return {success:true}}}};
      let activeThemes=[window.__rainyFixture,...window.__rendererFixtures];
      const themeListeners=new Set();const themeListener=()=>{for(const callback of themeListeners)callback()};
      window.api.plugins={themes:async()=>({success:true,data:activeThemes}),onChanged:callback=>{themeListeners.add(callback);return()=>themeListeners.delete(callback)}};
      let ui;
      const mount=()=>{const pinia=createPinia().use(persisted);const instance=createApp({setup(){ui=useUIStore();const contentDark=Vue.ref(ui.resolvedAppearance.contentDark);return()=>h('main',{class:'app-layout settings-page','data-background-contrast':!ui.resolvedAppearance.dark&&contentDark.value?'dark':undefined,style:'position:relative;min-height:100vh;padding:20px'},[h(AppBackground,{onContrast:value=>{contentDark.value=value}}),h('section',{style:'position:relative;z-index:2'},[h(ThemeSettings)])])}}).use(pinia).use(createI18n({legacy:false,locale:'zh',messages:{zh},missingWarn:false,fallbackWarn:false}));instance.mount('#app');return instance};
      let mounted=mount();await ui.initializeTheme();await wait();
      check(ui.colorMode==='light'&&ui.appearancePreferences.background.id==='plugin:builtin.theme.rainy','Legacy native-material snapshots migrate back to the saved user preferences');
      check(ui.nativeMaterialEnabled&&ui.resolvedAppearance.background.type==='none'&&!document.querySelector('.app-background-layer,.ep-app-background'),'Native material suppresses all renderer backgrounds');
      check(document.body.textContent.includes('Acrylic'),'Settings show the actual background source');
      check(!document.querySelector('input[type=file]')&&!document.body.textContent.includes('导入主题')&&!document.body.textContent.includes('下载示例'),'Appearance settings have no legacy JSON/ZIP import entry');
      await ui.setNativeWindowMaterial('none');await wait();
      check(document.querySelector('.app-background-layer')&&ui.resolvedAppearance.background.id==='plugin:builtin.theme.rainy','Turning material off restores the original scene without rewriting preferences');
      ui.setColorMode('system');await wait();
      check(ui.appearancePreferences.background.id==='plugin:builtin.theme.rainy','Following system appearance keeps the selected scene');
      systemDark=true;for(const listener of mediaListeners)listener();await wait();
      check(ui.resolvedAppearance.dark&&document.documentElement.classList.contains('dark')&&ui.appearancePreferences.background.id==='plugin:builtin.theme.rainy','System color-mode changes update the DOM while retaining the selected scene');
      ui.setColorMode('light');await wait();
      check(!document.documentElement.classList.contains('dark'),'Explicit light mode is applied independently of the dark scene');
      ui.customThemes.push({version:1,name:'Fixture theme',background:'replace',tokens:{'--color-primary':'#123456','--color-border':'#334455','--color-border-l':'#556677'},rules:{}});
      ui.selectCustomTheme('Fixture theme');await wait();
      check(document.body.textContent.includes('已导入的旧主题')&&!document.querySelector('input[type=file]')&&!document.body.textContent.includes('下载示例'),'Existing theme management has no legacy import or example action');
      check(document.querySelector('.ep-app-background')&&ui.resolvedAppearance.accentSource==='theme','Selected theme applies its background and palette');
      ui.selectThemeBackground('plugin:builtin.theme.aurora');await wait();
      check(ui.effectiveCustomThemeName==='Fixture theme'&&ui.resolvedAppearance.background.id==='plugin:builtin.theme.aurora'&&ui.resolvedAppearance.accentColor==='#123456'&&getComputedStyle(document.documentElement).getPropertyValue('--color-primary').includes('18, 52, 86'),'Selecting a scene retains theme colors and replaces only its background');
      ui.themeBackgroundEnabled=true;await wait();
      check(!!document.querySelector('.ep-app-background'),'Theme background can be restored explicitly');
      ui.setCustomBackground({kind:'image',url:'',path:'fixture.png'});await wait();
      check(ui.resolvedAppearance.background.type==='image'&&!ui.themeBackgroundEnabled&&ui.effectiveCustomThemeName==='Fixture theme','Media import follows the same background-selection rule');
      ui.customBg.chromeBorder='#abcdef';await wait();
      const borderProbe=document.createElement('div');borderProbe.style.cssText='border:1px solid var(--color-border)';document.body.append(borderProbe);
      const lightBorderProbe=document.createElement('div');lightBorderProbe.style.cssText='border:1px solid var(--color-border-l)';document.body.append(lightBorderProbe);
      check(document.documentElement.style.getPropertyValue('--app-chrome-border')==='#abcdef'&&getComputedStyle(borderProbe).borderTopColor==='rgb(171, 205, 239)'&&getComputedStyle(lightBorderProbe).borderTopColor==='rgb(171, 205, 239)','Custom background global border updates chrome and both component border tokens over imported theme colors');
      ui.customBg.chromeBorder='#12345680';await wait();
      check(getComputedStyle(borderProbe).borderTopColor==='rgba(18, 52, 86, 0.5)','Global border opacity changes apply immediately');
      ui.customBg.kind='video';ui.customBg.chromeBorder='transparent';await wait();
      check(ui.resolvedAppearance.background.type==='video'&&getComputedStyle(borderProbe).borderTopColor==='rgba(0, 0, 0, 0)','Video backgrounds also support fully transparent global borders');
      ui.selectThemeBackground('plugin:builtin.theme.aurora');await wait();
      check(!document.documentElement.style.getPropertyValue('--color-border')&&!document.documentElement.style.getPropertyValue('--color-border-l')&&getComputedStyle(borderProbe).borderTopColor==='rgb(51, 68, 85)'&&getComputedStyle(lightBorderProbe).borderTopColor==='rgb(85, 102, 119)','Leaving a custom background restores the selected theme component borders');
      ui.setCustomBackground({kind:'image',url:'',path:'fixture.png'});ui.customBg.chromeBorder='#abcdef';await wait();
      check(getComputedStyle(borderProbe).borderTopColor==='rgb(171, 205, 239)','Returning to a custom background restores its saved global border');
      borderProbe.remove();lightBorderProbe.remove();
      ui.importCustomTheme(JSON.stringify({version:1,name:'Preview',tokens:{'--color-primary':'#ff00ff'}}));await wait();
      check(ui.customThemePreviewActive&&ui.resolvedAppearance.background.type==='theme','Import preview uses the staged theme background');
      ui.cancelCustomThemePreview();await wait();
      check(ui.resolvedAppearance.background.type==='image'&&!ui.themeBackgroundEnabled&&ui.effectiveCustomThemeName==='Fixture theme','Cancelling preview restores both palette and saved background policy');
      ui.selectCustomTheme('');ui.accentSource='song';await wait();
      check(ui.resolvedAppearance.reasons.includes('songUnavailable'),'Missing artwork reports its accent fallback in settings');
      ui.setColorMode('dark');ui.setColorMode('light');ui.setColorMode('dark');ui.selectThemeBackground('plugin:builtin.theme.rainy');ui.setColorMode('light');await wait();
      check(!document.documentElement.classList.contains('dark')&&document.documentElement.dataset.systemTheme==='plugin:builtin.theme.rainy','Rapid consecutive changes apply the final color mode and background');
      ui.playerBgType='liquid';ui.playerCoverStyle='vinyl';await ui.setNativeWindowMaterial('mica');await wait();failMaterial=true;
      let failed=false;try{await ui.resetTheme()}catch{failed=true}await wait();
      check(failed&&ui.nativeMaterialEnabled&&ui.appearancePreferences.background.id==='plugin:builtin.theme.rainy','Failed native reset leaves saved appearance intact');
      failMaterial=false;await ui.resetTheme();await wait();
      check(!ui.nativeMaterialEnabled&&ui.resolvedAppearance.background.type==='none'&&ui.playerBgType==='liquid'&&ui.playerCoverStyle==='vinyl','Theme reset turns off material and leaves player appearance intact');
      ui.setColorMode('system');ui.selectThemeBackground('plugin:builtin.theme.aurora');ui.accentSource='song';ui.themeBackgroundEnabled=false;await wait();flushPlayerDataStorage();
      ui.$dispose();mounted.unmount();mounted=mount();await ui.initializeTheme();await wait();
      check(ui.colorMode==='system'&&ui.appearancePreferences.background.id==='plugin:builtin.theme.aurora'&&ui.accentSource==='song'&&!ui.themeBackgroundEnabled,'Independent appearance choices survive a fresh store and renderer initialization');
      const selectors=[document.querySelector('.ep-select[aria-label="外观模式"]')];
      selectors[0].click();await wait();const light=[...document.querySelectorAll('[role=option]')].find(option=>option.textContent.includes('浅色'));light.click();await wait();
      check(ui.colorMode==='light'&&ui.appearancePreferences.background.id==='plugin:builtin.theme.aurora','The real settings control changes color mode without clearing the scene');
      const rgb=value=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data]};
      const lum=channels=>Array.from(channels).slice(0,3).map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
      const contrast=(a,b)=>(Math.max(lum(a),lum(b))+0.05)/(Math.min(lum(a),lum(b))+0.05);
      ui.setColorMode('light');ui.selectCustomTheme('');
      const delayedScene=systemBackgroundThemes.find(scene=>scene.id==='solid');const originalScene={...delayedScene};
      let resolveDelayedScene;const delayedSceneModule=new Promise(resolve=>{resolveDelayedScene=resolve});
      Object.assign(delayedScene,{pluginTheme:{pluginId:'fixture.pending',revision:'pending',data:{background:'#152535'}},component:Vue.defineAsyncComponent(()=>delayedSceneModule)});
      ui.selectThemeBackground(delayedScene.id);await nextTick();
      const pendingFrames=[];
      for(let frame=0;frame<3;frame++) {const layer=document.querySelector('.app-background-layer');pendingFrames.push(layer&&rgb(getComputedStyle(layer).backgroundColor));await new Promise(resolve=>requestAnimationFrame(resolve))}
      check(pendingFrames.every(color=>color&&color[0]===21&&color[1]===37&&color[2]===53)&&!document.querySelector('.async-scene-ready'),'Light theme switching paints its authored fallback on every frame while an async component loads: '+JSON.stringify(pendingFrames));
      resolveDelayedScene({emits:['ready'],mounted(){this.$emit('ready')},render:()=>h('div',{class:'async-scene-ready',style:'position:absolute;inset:0;background:#152535'})});await wait();
      check(!!document.querySelector('.async-scene-ready'),'Ready async scenes replace the loading fallback');
      const rendererFallback=window.__rendererFixtures.at(-1);
      ui.selectThemeBackground('plugin:'+rendererFallback.pluginId);await wait();
      const frameHost=document.querySelector('.sandboxed-theme-background');
      check(!!frameHost&&!frameHost.querySelector('iframe').classList.contains('ready')&&rgb(getComputedStyle(frameHost).backgroundColor).slice(0,3).join(',')===rgb(rendererFallback.data.background).slice(0,3).join(','),'Pending sandbox frames keep their theme color instead of the global light background');
      for(let retry=0;retry<80&&!frameHost.querySelector('iframe.ready');retry++)await new Promise(resolve=>setTimeout(resolve,30));
      check(!!frameHost.querySelector('iframe.ready'),'Sandbox frames become visible after their ready handshake and initial paint opportunity');
      ui.selectThemeBackground('plugin:builtin.theme.rainy');await wait();
      const pendingShader=document.querySelector('.declarative-theme-background');
      check(!!pendingShader&&rgb(getComputedStyle(pendingShader).backgroundColor).slice(0,3).join(',')===rgb(window.__rainyFixture.data.background).slice(0,3).join(','),'Shader loading fallback is not overwritten by the global background default');
      Object.assign(delayedScene,originalScene);delete delayedScene.pluginTheme;
      ui.setColorMode('light');ui.accentSource='auto';ui.reduceMotion=true;
      for(const scene of [...systemBackgroundThemes.filter(scene=>scene.id!=='none'),{id:'plugin:builtin.theme.rainy'}]) {
        ui.selectThemeBackground(scene.id);await wait();
        const scrim=document.querySelector('.app-background-scrim');
        check(!scrim,'Light '+scene.id+' preserves the background without a global veil');
        const pageStyle=getComputedStyle(document.querySelector('.app-layout'));
        const surface=rgb(scene.id==='solid'?getComputedStyle(document.querySelector('.solid-background')).backgroundColor:pageStyle.getPropertyValue('--color-bg'));
        const primary=rgb(pageStyle.getPropertyValue('--color-primary'));
        const text=rgb(getComputedStyle(document.querySelector('.setting-row h3')).color);
        const secondary=rgb(getComputedStyle(document.querySelector('.setting-row p')).color);
        const auxiliary=rgb(pageStyle.getPropertyValue('--color-text-l2'));
        check(contrast(text,surface)>=7&&contrast(secondary,surface)>=4.5&&contrast(auxiliary,surface)>=4.5&&contrast(primary,surface)>=4.5,'Light '+scene.id+' keeps readable foregrounds on component surfaces: '+JSON.stringify({text:contrast(text,surface),secondary:contrast(secondary,surface),auxiliary:contrast(auxiliary,surface),accent:contrast(primary,surface)}));
        if(scene.id==='solid') {
          const canvas=document.querySelector('.solid-background canvas');const gl=canvas.getContext('webgl');
          check(!!gl&&gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM),gl.getUniformLocation(gl.getParameter(gl.CURRENT_PROGRAM),'u_light'))===1,'Real song-background shader renders its light palette without a white overlay');
          ui.reduceMotion=true;ui.accentSource='user';
          for(const color of ['rgb(0 0 0)','rgb(255 255 255)','rgb(255 0 0)','rgb(0 255 0)','rgb(0 0 255)']) {
            ui.songThemeColor=color;await wait();
            gl.drawArrays(gl.TRIANGLES,0,3);const pixel=new Uint8Array(4);gl.readPixels(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
            check(lum(pixel)>0.35&&lum(pixel)<0.56&&contrast(auxiliary,pixel)>=4.5&&contrast(text,pixel)>=7,'Light artwork material stays muted and readable for '+color+': '+JSON.stringify([...pixel]));
            const material=rgb(getComputedStyle(document.documentElement).getPropertyValue('--color-bg'));
            check(material.slice(0,3).every((channel,i)=>Math.abs(channel-pixel[i])<=1),'Song material, root palette and async fallback stay aligned when only artwork changes: '+color);
            for(const token of ['--app-header-bg','--app-footer-bg']) {
              const chrome=rgb(getComputedStyle(document.documentElement).getPropertyValue(token));const composite=chrome.map((v,i)=>i<3?v*chrome[3]/255+pixel[i]*(1-chrome[3]/255):v);
              check(lum(composite)<0.62&&Math.abs(lum(composite)-lum(pixel))<0.08&&contrast(auxiliary,composite)>=4.5,'Song '+token+' shares the muted artwork palette without a bright white surface: '+color);
            }
            if(!['rgb(0 0 0)','rgb(255 255 255)'].includes(color)) check(Math.max(...pixel.slice(0,3))-Math.min(...pixel.slice(0,3))>=18,'Light artwork preserves a visible color tint for '+color);
          }
          ui.songThemeColor=null;ui.accentSource='auto';await wait();
        }
        const layer=document.querySelector('.app-background-layer');ui.setColorMode('dark');await wait();ui.setColorMode('light');await wait();
        const rootStyle=getComputedStyle(document.documentElement);
        check(document.querySelector('.app-background-layer')===layer&&!document.querySelector('[class*=app-theme-background-leave]')&&contrast(rgb(rootStyle.getPropertyValue('--color-text')),rgb(rootStyle.getPropertyValue('--color-bg')))>=7,'Switching '+scene.id+' light/dark preserves its canvas host and avoids a fading cleared layer');
      }
      ui.setCustomBackground({kind:'image',url:'',path:'contrast.png'});await wait();
      const rootStyle=getComputedStyle(document.documentElement);
      const baseSurface=rgb(rootStyle.getPropertyValue('--color-bg'));const cardSurface=rgb(rootStyle.getPropertyValue('--color-bg-l'));const insetSurface=rgb(rootStyle.getPropertyValue('--color-bg-l2'));
      check(lum(baseSurface)<0.85&&lum(baseSurface)>0.65&&lum(cardSurface)>lum(baseSurface)&&lum(insetSurface)<lum(baseSurface),'Light surfaces have a soft base, raised cards and recessed controls without a near-white page');
      check(!document.querySelector('.app-background-scrim'),'Light custom images retain their original colors without a global veil');
      const savedFilter=ui.getBackgroundFilter;
      ui.setCustomBackground({kind:'video',url:'',path:'contrast.mp4'});await wait();
      check(!document.querySelector('.app-background-scrim')&&ui.getBackgroundFilter===savedFilter,'Light custom videos retain their original colors and user filters');
      for(const surface of [baseSurface,cardSurface,insetSurface]) for(const token of ['--color-text','--color-text-l','--color-text-l2','--color-primary']) check(contrast(rgb(rootStyle.getPropertyValue(token)),surface)>=4.5,'Light component '+token+' remains readable on '+JSON.stringify(surface));
      const label=rgb(rootStyle.getPropertyValue('--btn-primary-text'));
      for(const token of ['--btn-primary-bg','--btn-primary-bg-hover']) check(contrast(label,rgb(rootStyle.getPropertyValue(token)))>=4.5,'Light primary button retains label contrast for '+token);
      check(ui.resolvedAppearance.chrome.header===ui.customBg.headerBackground&&ui.resolvedAppearance.chrome.footer===ui.customBg.footerBackground,'Light custom chrome preserves the authored header and footer colors without white mixing');
      const chromeHost=document.createElement('div');chromeHost.style.cssText='position:fixed;left:-10000px;top:0';
      chromeHost.innerHTML='<header class="ep-header"><span class="text-text">Header</span><span class="text-primary">Accent</span></header><footer class="ep-footer"><span class="text-text">Song</span><span class="text-text-l">Artist</span><span class="ep-progress-fill">Progress</span></footer>';
      document.body.append(chromeHost);
      const footerFade=document.createElement('div');footerFade.className='app-footer-shell bg-gradient-to-t from-bg/30';chromeHost.append(footerFade);
      const chromeSnapshot=()=>[...chromeHost.querySelectorAll('.ep-header,.ep-footer')].map(bar=>({background:getComputedStyle(bar).backgroundColor,text:getComputedStyle(bar.querySelector('.text-text')).color,accent:getComputedStyle(bar).getPropertyValue('--color-primary'),hover:getComputedStyle(bar).getPropertyValue('--color-hover-bg'),progress:getComputedStyle(bar).getPropertyValue('--ep-progress-fill'),fade:getComputedStyle(footerFade).backgroundImage}));
      const lightChrome=chromeSnapshot();
      check(!document.documentElement.classList.contains('dark')&&document.documentElement.dataset.chromeDark==='true'&&contrast(rgb(getComputedStyle(chromeHost.querySelector('.text-text')).color),baseSurface)<2,'Dark chrome foregrounds are scoped to the bars while the page remains light');
      for(const bar of chromeHost.querySelectorAll('.ep-header,.ep-footer')) {
        const background=rgb(getComputedStyle(bar).backgroundColor);const composite=background.map((v,i)=>i<3?v*background[3]/255+255*(1-background[3]/255):v);
        check(contrast(rgb(getComputedStyle(bar.querySelector('.text-text')).color),composite)>=4.5,'Authored '+bar.tagName+' keeps readable foregrounds over a bright backdrop');
      }
      ui.setColorMode('dark');await wait();
      check(JSON.stringify(chromeSnapshot())===JSON.stringify(lightChrome),'Custom chrome backgrounds, labels, accents, hover and progress colors match dark-mode styling');
      ui.setColorMode('light');ui.selectThemeBackground('plugin:builtin.theme.rainy');await wait();
      check(ui.resolvedAppearance.chrome.header===window.__rainyFixture.data.headerBackground&&ui.resolvedAppearance.chrome.footer===window.__rainyFixture.data.footerBackground&&ui.resolvedAppearance.chrome.dark,'Light plugin chrome retains its scene palette and dark foreground treatment');
      for(const [selector,color] of [['.ep-header',window.__rainyFixture.data.headerBackground],['.ep-footer',window.__rainyFixture.data.footerBackground]]) {
        const source=rgb(color);const bar=chromeHost.querySelector(selector);const lifted=rgb(getComputedStyle(bar).backgroundColor);
        check(lum(lifted)>lum(source)&&lum(lifted)-lum(source)<0.03&&Math.abs(lifted[3]-source[3])<=1,'Theme '+selector+' gets a restrained brightness lift while preserving opacity');
        const composite=lifted.map((v,i)=>i<3?v*lifted[3]/255+255*(1-lifted[3]/255):v);
        check(contrast(rgb(getComputedStyle(bar.querySelector('.text-text')).color),composite)>=4.5,'Raised theme '+selector+' keeps readable labels');
      }
      ui.setColorMode('dark');await wait();
      check(document.documentElement.dataset.chromeRaised==='false','Dark theme chrome keeps its original brightness');
      ui.setColorMode('light');await wait();
      ui.selectThemeBackground('none');await wait();
      check(document.documentElement.dataset.chromeDark==='false'&&document.documentElement.dataset.chromeRaised==='false'&&contrast(rgb(getComputedStyle(chromeHost.querySelector('.text-text')).color),baseSurface)>=7,'Leaving authored backgrounds restores ordinary light chrome without stale colors');
      await ui.setNativeWindowMaterial('mica');await wait();
      const micaFooter=chromeHost.querySelector('.ep-footer');const page=document.querySelector('.app-layout');
      const contrastProbe=document.createElement('div');contrastProbe.style.cssText='position:fixed;left:-10000px';contrastProbe.innerHTML='<span class="text-text">Page</span><span class="text-text-l">Secondary</span><label class="plain-label">Caption</label><aside class="ep-sidebar-item">Sidebar</aside><button class="ep-button ep-button--primary">Play</button>';page.append(contrastProbe);
      const dialogProbe=document.createElement('div');dialogProbe.className='ep-dialog-panel';dialogProbe.style.cssText='position:fixed;left:-10000px';dialogProbe.innerHTML='<span class="text-text">Dialog</span>';document.body.append(dialogProbe);
      for(const nativeDark of [false,true]) {
        systemDark=nativeDark;for(const listener of mediaListeners)listener();await wait();
        const micaStyle=getComputedStyle(micaFooter);const micaSurface=rgb(micaStyle.backgroundColor);const backdrop=nativeDark?[24,28,26]:[225,229,224];
        const composite=micaSurface.map((v,i)=>i<3?v*micaSurface[3]/255+backdrop[i]*(1-micaSurface[3]/255):v);
        check(micaSurface[3]/255<=0.18&&lum(micaSurface)<0.05,'Light Mica footer uses only a subtle dark tint instead of covering the native material');
        for(const token of ['--color-text','--color-text-l','--color-text-l2','--color-primary']) check(contrast(rgb(micaStyle.getPropertyValue(token)),composite)>=4.5,'Light Mica footer keeps '+token+' readable on its '+(nativeDark?'dark':'light')+' native backdrop');
        check(ui.colorMode==='light'&&!document.documentElement.classList.contains('dark')&&ui.resolvedAppearance.contentDark===nativeDark&&(page.dataset.backgroundContrast==='dark')===nativeDark,'Native backdrop contrast changes the page foreground without rewriting the selected light mode');
        for(const selector of ['.text-text','.text-text-l','.plain-label','.ep-sidebar-item']) check(contrast(rgb(getComputedStyle(contrastProbe.querySelector(selector)).color),backdrop)>=4.5,'Page '+selector+' stays readable on a '+(nativeDark?'dark':'light')+' Mica backdrop');
        const buttonStyle=getComputedStyle(contrastProbe.querySelector('button'));check(contrast(rgb(buttonStyle.color),rgb(buttonStyle.backgroundColor))>=4.5,'Primary labels retain contrast in the adaptive content palette');
        check(contrast(rgb(getComputedStyle(dialogProbe.querySelector('span')).color),rgb(getComputedStyle(dialogProbe).backgroundColor))>=7&&lum(rgb(getComputedStyle(dialogProbe).backgroundColor))>0.85,'Body-teleported dialogs keep their independent light surface and dark labels');
      }
      contrastProbe.remove();dialogProbe.remove();
      check(getComputedStyle(footerFade).backgroundImage==='none'&&getComputedStyle(micaFooter).boxShadow!=='none'&&rgb(getComputedStyle(document.body).backgroundColor)[3]===0,'Light Mica removes the outer white gradient, softens its shadow and preserves native transparency');
      await ui.setNativeWindowMaterial('none');await wait();
      check(getComputedStyle(footerFade).backgroundImage!=='none','Leaving Mica restores the ordinary footer gradient');
      chromeHost.remove();
      ui.selectThemeBackground('none');ui.reduceMotion=false;await wait();
      ui.setColorMode('dark');await wait();await new Promise(resolve=>setTimeout(resolve,350));
      const modeSamples=[];ui.setColorMode('light');
      for(let sample=0;sample<8;sample++) {await new Promise(resolve=>setTimeout(resolve,32));const rootStyle=getComputedStyle(document.documentElement);modeSamples.push(contrast(rgb(rootStyle.getPropertyValue('--color-text')),rgb(rootStyle.getPropertyValue('--color-bg'))));}
      check(Math.min(...modeSamples)>=7,'Light/dark changes never cross a low-contrast interpolation frame: '+Math.min(...modeSamples).toFixed(2));
      ui.customThemes.push({version:1,name:'Bright palette',tokens:{'--color-bg':'#ffffff','--color-text':'#101010','--color-primary':'#123456'},rules:{}},{version:1,name:'Dark palette',tokens:{'--color-bg':'#101010','--color-text':'#ffffff','--color-primary':'#abcdef'},rules:{}});
      ui.selectCustomTheme('Bright palette');await wait();await new Promise(resolve=>setTimeout(resolve,350));ui.selectCustomTheme('Dark palette');
      const themeSamples=[];for(let sample=0;sample<8;sample++){await new Promise(resolve=>setTimeout(resolve,32));const style=getComputedStyle(document.documentElement);themeSamples.push(contrast(rgb(style.getPropertyValue('--color-text')),rgb(style.getPropertyValue('--color-bg'))));}
      check(Math.min(...themeSamples)>=7,'Imported surface palettes switch without an intermediate gray-on-gray frame');
      ui.selectCustomTheme('');ui.reduceMotion=true;await wait();
      ui.customThemes.push({version:1,name:'Stable sheet',tokens:{'--color-primary':'#123456'},rules:{}});ui.selectCustomTheme('Stable sheet');await wait();
      const themeStyle=document.getElementById('ep-custom-theme');const sheet=themeStyle.sheet;
      ui.setColorMode('dark');await wait();ui.setColorMode('light');await wait();
      check(document.getElementById('ep-custom-theme')===themeStyle&&themeStyle.sheet===sheet,'Unchanged theme stylesheets survive appearance changes without resource churn');
      ui.selectCustomTheme('');ui.selectThemeBackground('plugin:builtin.theme.aurora');await wait();
      document.querySelector('[role=radiogroup]').scrollIntoView({block:'start'});await wait();
      const blackhole=window.__themeFixture;
      const midnight={pluginId:'example.midnight',version:'1.0.0',revision:'midnight-fixture',displayName:'Midnight',names:{zh:'午夜',en:'Midnight'},data:{version:1,colorMode:'dark',accentColor:'#a5b4fc',headerBackground:'#14152b',footerBackground:'#101122',chromeBorder:'#34365a',background:'#0d0e1c',tokens:{'--color-bg':'#101122','--color-text':'#edf0ff'}},textures:[]};
      activeThemes=[blackhole,midnight];themeListener();await wait();
      check([...document.querySelectorAll('[role=radio]')].some(button=>button.textContent.includes('黑洞')),'Enabled theme plugins appear in the existing appearance choices');
      ui.setColorMode('dark');check(!ui.selectThemeBackground('blackhole'),'Old scene names are rejected by selection');ui.systemBackground='blackhole';await wait();check(ui.resolvedAppearance.background.type==='none','Old scene names fall back to the default even when a matching plugin is installed');ui.systemBackground='plugin:builtin.theme.blackhole';ui.reduceMotion=true;await wait();
      check(ui.resolvedAppearance.background.id==='plugin:builtin.theme.blackhole','Explicit Black Hole plugin selection resolves to the installed theme');
      const pendingCanvas=document.querySelector('.declarative-theme-background canvas');
      check(!!pendingCanvas&&!pendingCanvas.classList.contains('ready'),'Black Hole waits for its delayed textures');
      pendingCanvas.dispatchEvent(new Event('webglcontextrestored'));await nextTick();
      check(!pendingCanvas.classList.contains('ready'),'Early context restoration waits for validated texture data');
      for(let retry=0;retry<80&&!document.querySelector('.declarative-theme-background canvas.ready');retry++) await new Promise(resolve=>setTimeout(resolve,50));
      check(!!document.querySelector('.declarative-theme-background canvas.ready'),'Black Hole fragment shader and precomputed textures render through the generic WebGL host');
      activeThemes=[midnight];themeListener();await wait();
      check(ui.systemBackground==='plugin:builtin.theme.blackhole'&&ui.resolvedAppearance.background.type==='none','Disabling a selected theme falls back without overwriting its saved choice');
      check(document.querySelector('[role=status]')?.textContent.includes('主题插件'),'Missing theme explains the fallback in Appearance');
      activeThemes=[blackhole,midnight];themeListener();await wait();
      check(ui.resolvedAppearance.background.id==='plugin:builtin.theme.blackhole','Re-enabling a theme restores the saved background automatically');
      [...document.querySelectorAll('[role=radio]')].find(button=>button.textContent.includes('午夜')).click();await wait();
      check(ui.systemBackground==='plugin:example.midnight'&&rgb(getComputedStyle(document.documentElement).getPropertyValue('--color-bg')).slice(0,3).join(',')==='16,17,34','Third-party theme selection applies its palette through the real UI');
      midnight.author={name:'Fixture Author'};
      const sameName={...midnight,pluginId:'other.midnight',author:{name:'Fixture Author'}};
      activeThemes=[blackhole,midnight,sameName];themeListener();await wait();
      const duplicates=[...document.querySelectorAll('[role=radio]')].filter(button=>button.textContent.includes('午夜'));
      check(duplicates.length===2&&duplicates.every(button=>button.title.includes('Fixture Author')),'Duplicate theme names retain their author in the tooltip');
      check(duplicates.some(button=>button.textContent.includes('example.midnight'))&&duplicates.some(button=>button.textContent.includes('other.midnight')),'Same-name same-author themes show their distinct IDs');
      duplicates.find(button=>button.textContent.includes('other.midnight')).click();await wait();
      check(ui.systemBackground==='plugin:other.midnight','A duplicate display name still selects its own plugin ID');
      duplicates.find(button=>button.textContent.includes('example.midnight')).click();await wait();
      activeThemes=[blackhole,midnight];themeListener();await wait();
      ui.selectCustomTheme('Bright palette');ui.selectThemeBackground('plugin:example.midnight');await wait();
      check(rgb(getComputedStyle(document.documentElement).getPropertyValue('--color-bg')).slice(0,3).join(',')==='255,255,255','Explicit custom palette retains precedence over theme plugin colors');
      ui.selectCustomTheme('');ui.selectThemeBackground('plugin:builtin.theme.aurora');await wait();
      check(rgb(getComputedStyle(document.documentElement).getPropertyValue('--color-bg')).slice(0,3).join(',')!=='16,17,34','Switching away removes plugin color tokens');
      const nyan=window.__nyanFixture;activeThemes=[blackhole,midnight,nyan];themeListener();await wait();
      ui.selectThemeBackground('plugin:example.nyan-cat');await wait();
      check(ui.customThemeText.appTitle==='Nyan Player'&&ui.customThemeText.homeWelcome.includes('Nyan~'),'Nyan text slots apply through the real store');
      const family='EPTheme-'+nyan.pluginId+'-'+nyan.revision+'-cute';
      for(let retry=0;retry<100&&![...document.fonts].some(font=>font.family===family&&font.status==='loaded');retry++)await new Promise(resolve=>setTimeout(resolve,50));
      check([...document.fonts].some(font=>font.family===family&&font.status==='loaded'),'Declared Nyan font loads through the real theme plugin protocol');
      const background=document.querySelector('.declarative-theme-background');
      check(getComputedStyle(background).backgroundImage.includes('/images/starfield.png'),'Nyan background slot overrides its fallback background');
      ui.customThemes.push({version:1,name:'Background rule precedence',background:'inherit',tokens:{},rules:{'.ep-app-background':{background:'#112233'}}});
      ui.selectCustomTheme('Background rule precedence');ui.selectThemeBackground('plugin:example.nyan-cat');await wait();
      check(getComputedStyle(document.querySelector('.declarative-theme-background')).backgroundImage==='none','Author background shorthand retains the established ability to replace a slot image');
      ui.selectCustomTheme('');await wait();
      check(getComputedStyle(document.querySelector('.declarative-theme-background')).backgroundImage.includes('/images/starfield.png'),'Removing the custom background rule restores the plugin image');
      for(const resource of ['cat','sky']){const image=new Image();image.src='easy-player-media://plugin-theme/'+nyan.pluginId+'/'+nyan.revision+'/'+nyan.data.assets.resources[resource].path;await image.decode()}
      check(getComputedStyle(document.documentElement).getPropertyValue('--ep-range-thumb-width').trim()==='60px','Nyan preserves non-color component tokens');
      const sample=document.createElement('div');sample.className='ep-playback-progress';document.body.append(sample);
      check(getComputedStyle(sample).getPropertyValue('--ep-range-thumb-image').includes('/images/nyan-cat.png')&&getComputedStyle(sample).height==='36px','Nyan playback thumb slot and scoped CSS rules apply');sample.remove();
      ui.setColorMode('light');await wait();check(!ui.customThemeText.appTitle&&![...document.fonts].some(font=>font.family===family),'Mode mismatch removes Nyan text and fonts');
      ui.setColorMode('dark');await wait();
      activeThemes=[blackhole,midnight];themeListener();await wait();
      check(!ui.customThemeText.appTitle&&!document.getElementById('ep-custom-theme')&&![...document.fonts].some(font=>font.family===family),'Disabling Nyan removes text, styles and fonts');
      activeThemes=[blackhole,midnight,nyan];themeListener();await wait();
      check(ui.customThemeText.appTitle==='Nyan Player','Re-enabling Nyan restores its saved selection');
      const rainy=window.__rainyFixture;
      activeThemes=[blackhole,midnight,nyan,rainy];themeListener();await wait();
      const originalBitmap=window.createImageBitmap.bind(window);let closedBitmaps=0;
      window.createImageBitmap=async(...args)=>{const image=await originalBitmap(...args);const close=image.close.bind(image);image.close=()=>{closedBitmaps++;close()};return image};
      ui.setColorMode('dark');ui.systemBackground='plugin:builtin.theme.rainy';ui.reduceMotion=true;await wait();
      check(ui.systemBackground==='plugin:builtin.theme.rainy'&&ui.resolvedAppearance.background.id==='plugin:builtin.theme.rainy','Explicit Rainy plugin selection resolves to the installed theme');
      for(let retry=0;retry<100&&!document.querySelector('.declarative-theme-background canvas.ready');retry++)await new Promise(resolve=>setTimeout(resolve,50));
      let rainyCanvas=document.querySelector('.declarative-theme-background canvas.ready');
      check(!!rainyCanvas,'Rain shader loads its street-image texture through the production protocol');
      check(getComputedStyle(document.querySelector('.declarative-theme-background')).backgroundImage.includes('rainy-night-cool.webp'),'Rainy preserves its street image as the shader fallback');
      const gl=rainyCanvas.getContext('webgl2');
      rainyCanvas.dispatchEvent(new Event('webglcontextrestored'));
      const pixels=new Uint8Array(rainyCanvas.width*rainyCanvas.height*4);gl.readPixels(0,0,rainyCanvas.width,rainyCanvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      let maximum=0,minimum=255;for(let index=0;index<pixels.length;index+=400){maximum=Math.max(maximum,pixels[index],pixels[index+1],pixels[index+2]);minimum=Math.min(minimum,pixels[index],pixels[index+1],pixels[index+2])}
      check(maximum>40&&maximum-minimum>20,'Rain shader produces nonblank image pixels after context restoration');
      check(gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER)===gl.LINEAR_MIPMAP_LINEAR,'Image texture retains mipmaps for the rain blur');
      const oldFocus=document.hasFocus;const oldHidden=Object.getOwnPropertyDescriptor(document,'hidden');
      document.hasFocus=()=>true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});window.dispatchEvent(new Event('focus'));
      ui.reduceMotion=false;await wait();await new Promise(resolve=>setTimeout(resolve,220));
      const program=gl.getParameter(gl.CURRENT_PROGRAM),time=gl.getUniformLocation(program,'u_time');
      check(gl.getUniform(program,time)>0,'Rain animation advances when its window is active');
      ui.reduceMotion=true;await wait();const frozen=gl.getUniform(program,time);await new Promise(resolve=>setTimeout(resolve,120));
      check(gl.getUniform(program,time)===frozen,'Reduced motion freezes rain animation');
      document.hasFocus=oldFocus;if(oldHidden)Object.defineProperty(document,'hidden',oldHidden);else delete document.hidden;window.dispatchEvent(new Event('blur'));
      ui.setColorMode('light');await wait();
      check(document.querySelector('.declarative-theme-background canvas')===rainyCanvas&&ui.resolvedAppearance.dark===false,'Rainy light mode preserves its canvas while applying the light appearance policy');
      ui.setColorMode('dark');await wait();
      activeThemes=[blackhole,midnight,nyan];themeListener();await wait();
      check(ui.systemBackground==='plugin:builtin.theme.rainy'&&ui.resolvedAppearance.background.type==='none'&&closedBitmaps>0&&gl.isContextLost(),'Disabling Rainy retains selection and releases image/GPU resources');
      activeThemes=[blackhole,midnight,nyan,rainy];themeListener();await wait();
      check(ui.resolvedAppearance.background.id==='plugin:builtin.theme.rainy','Re-enabling Rainy restores the saved selection');
      const badImage={...rainy,revision:'wrong-image-dimensions',textures:rainy.textures.map(texture=>({...texture,width:texture.width+1}))};
      useMessage().clear();activeThemes=[blackhole,midnight,nyan,badImage];themeListener();await wait();
      for(let retry=0;retry<100&&!useMessage().messages.value.some(message=>message.message===zh.plugins.themeRenderFailed);retry++)await new Promise(resolve=>setTimeout(resolve,30));
      check(useMessage().messages.value.some(message=>message.message===zh.plugins.themeRenderFailed)&&!document.querySelector('.declarative-theme-background canvas.ready'),'Invalid image dimensions trigger the visible static fallback');
      activeThemes=[blackhole,midnight,nyan,rainy];themeListener();await wait();
      window.previewRainy=async()=>{ui.selectThemeBackground('plugin:builtin.theme.rainy');await wait();for(let retry=0;retry<100&&!document.querySelector('.declarative-theme-background canvas.ready');retry++)await new Promise(resolve=>setTimeout(resolve,50))};
      const brokenFrame={...window.__rendererFixtures[0],revision:'invalid-frame-url',rendererUrl:'https://example.invalid/renderer'};
      activeThemes=[blackhole,midnight,nyan,rainy,brokenFrame];themeListener();await wait();
      ui.selectThemeBackground('plugin:builtin.theme.aurora');useMessage().clear();await wait();
      check(!document.querySelector('.sandboxed-theme-background iframe')&&useMessage().messages.value.some(message=>message.message===zh.plugins.themeRenderFailed),'Invalid official renderer URLs stay on the host fallback and report failure');
      activeThemes=[blackhole,midnight,nyan,rainy,...window.__rendererFixtures];themeListener();await wait();
      window.previewOfficialScene=async(id,paused=true)=>{
        document.hasFocus=()=>true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});window.dispatchEvent(new Event('focus'));
        ui.selectCustomTheme('');ui.setColorMode('dark');ui.reduceMotion=paused;ui.selectThemeBackground('plugin:builtin.theme.'+id);await wait();
        for(let retry=0;retry<200&&(!document.querySelector('.sandboxed-theme-background iframe.ready')||!document.documentElement.classList.contains('dark'));retry++)await new Promise(resolve=>setTimeout(resolve,30));
        const iframe=document.querySelector('.sandboxed-theme-background iframe');
        return {selected:ui.systemBackground,resolved:ui.resolvedAppearance.background.id,ready:!!iframe?.classList.contains('ready'),sandbox:iframe?.getAttribute('sandbox'),parentProbe:window.__hostProbe?.value}
      };
      window.pauseOfficialScene=async(paused)=>{ui.reduceMotion=paused;await wait()};
      window.showOfficialSceneLight=async()=>{ui.setColorMode('light');await wait();for(let retry=0;retry<40&&document.documentElement.classList.contains('dark');retry++)await new Promise(resolve=>setTimeout(resolve,30));return !document.documentElement.classList.contains('dark')};
      window.previewLightAppearance=async(id)=>{ui.selectCustomTheme('');ui.setColorMode('light');ui.reduceMotion=true;ui.selectThemeBackground(id);document.querySelector('#app main section').scrollIntoView({block:'start'});await wait();return {dark:ui.resolvedAppearance.dark,background:ui.resolvedAppearance.background,scrim:ui.resolvedAppearance.backgroundScrim}};
      window.toggleOfficialScene=async(id,available)=>{activeThemes=available?[blackhole,midnight,nyan,rainy,...window.__rendererFixtures]:activeThemes.filter(theme=>theme.pluginId!=='builtin.theme.'+id);themeListener();await wait();return {selected:ui.systemBackground,type:ui.resolvedAppearance.background.type,resolved:ui.resolvedAppearance.background.id}};
      const pluginHost=document.createElement('div');document.body.append(pluginHost);
      window.api.plugins.list=async()=>({success:true,data:[
        {id:'alice.midnight',displayName:'Midnight',version:'1.0.0',apiVersion:2,sources:[],kind:'theme',theme:{displayName:'Midnight'},author:{name:'Alice'},origin:'third-party',enabled:true,state:'active'},
        {id:'bob.midnight',displayName:'Midnight',version:'1.0.0',apiVersion:2,sources:[],kind:'theme',theme:{displayName:'Midnight'},author:{name:'Bob'},origin:'third-party',enabled:true,state:'active'},
        {id:'legacy.midnight',displayName:'Midnight',version:'1.0.0',apiVersion:2,sources:[],kind:'theme',theme:{displayName:'Midnight'},origin:'third-party',enabled:true,state:'active'}
      ]});
      const pluginView=createApp(OfficialPluginSettings).use(createI18n({legacy:false,locale:'zh',messages:{zh},missingWarn:false,fallbackWarn:false}));pluginView.mount(pluginHost);await wait();
      check(pluginHost.textContent.includes('Alice')&&pluginHost.textContent.includes('Bob')&&pluginHost.textContent.includes('alice.midnight')&&pluginHost.textContent.includes('bob.midnight'),'Plugin manager displays both authors and IDs for same-name plugins');
      check(pluginHost.textContent.includes('作者未提供'),'Legacy packages retain an explicit missing-author fallback');
      const logListeners=new Set();
      const logHistory=[
        {id:1,timestamp:Date.now(),level:'info',source:'main',message:'ALICE_INITIAL',plugin:{pluginId:'alice.midnight',version:'1.0.0',operation:'install'}},
        {id:2,timestamp:Date.now(),level:'error',source:'main',message:'BOB_FAILURE',plugin:{pluginId:'bob.midnight',version:'1.0.0',operation:'theme.render'}}
      ];
      window.api.log={onEntry:callback=>{logListeners.add(callback);return()=>logListeners.delete(callback)},openDirectory:async()=>({success:true})};
      window.api.plugins.logs=async()=>({success:true,data:logHistory});
      const aliceRow=[...pluginHost.querySelectorAll('.setting-row')].find(row=>row.textContent.includes('alice.midnight'));
      [...aliceRow.querySelectorAll('button')].find(button=>button.textContent.includes('插件日志')).click();await wait();
      let logDialog=document.querySelector('[role=dialog]');
      check(!!logDialog&&logDialog.textContent.includes('ALICE_INITIAL')&&!logDialog.textContent.includes('BOB_FAILURE'),'Per-plugin logs isolate same-name plugins by ID');
      const live={id:3,timestamp:Date.now(),level:'error',source:'main',message:'ALICE_LIVE',plugin:{pluginId:'alice.midnight',version:'1.0.0',operation:'metadata.get',elapsedMs:25,code:'NETWORK'}};
      for(const listener of logListeners){listener(live);listener(live)}await wait();
      check(logDialog.textContent.split('ALICE_LIVE').length===2&&logDialog.textContent.includes('25ms'),'Live logs retain call metadata and deduplicate events');
      const logSearch=logDialog.querySelector('input[aria-label="搜索日志"]');logSearch.value='LIVE';logSearch.dispatchEvent(new Event('input',{bubbles:true}));await wait();
      check(logDialog.textContent.includes('ALICE_LIVE')&&!logDialog.textContent.includes('ALICE_INITIAL'),'Plugin log search filters entries');
      const levelControl=logDialog.querySelector('[aria-label="筛选级别"]');levelControl.click();await wait();
      [...document.querySelectorAll('[role=option]')].find(option=>option.textContent==='INFO').click();await wait();
      check(!logDialog.textContent.includes('ALICE_LIVE'),'Plugin log level filter is independent of recording level');
      check(logListeners.size===1,'An open log dialog owns one subscription');
      window.pluginLogsPreview=async()=>{
        const host=document.createElement('div');document.body.append(host);
        const view=createApp(OfficialPluginSettings).use(createI18n({legacy:false,locale:'zh',messages:{zh},missingWarn:false,fallbackWarn:false}));view.mount(host);await wait();
        [...host.querySelectorAll('button')].find(button=>button.textContent.includes('插件日志')).click();await wait();
        window.closePluginLogsPreview=()=>{view.unmount();host.remove()};
      };
      pluginView.unmount();pluginHost.remove();await wait();
      check(logListeners.size===0,'Closing plugin settings releases its log subscription');
      window.previewNyan=async()=>{ui.selectThemeBackground('plugin:example.nyan-cat');await wait()};
      window.previewBlackhole=async()=>{ui.selectThemeBackground('plugin:builtin.theme.blackhole');await wait()};
      ui.selectThemeBackground('plugin:builtin.theme.blackhole');await wait();
      return {passed:checks.length,checks};
    })()`)
    await window.webContents.executeJavaScript('window.pluginLogsPreview()')
    await new Promise((resolve) => setTimeout(resolve, 300))
    const logPreview = await window.webContents.executeJavaScript(
      `(()=>{const dialog=document.querySelector('[role=dialog]');return dialog ? {text:dialog.textContent,opacity:getComputedStyle(dialog).opacity,rect:dialog.getBoundingClientRect().toJSON()} : null})()`
    )
    if (!logPreview || !logPreview.text.includes('ALICE_INITIAL'))
      throw new Error('Plugin log preview must be visible and contain its history')
    fs.writeFileSync(
      'build/plugin-logs-dialog.png',
      (await window.webContents.capturePage()).toPNG()
    )
    await window.webContents.executeJavaScript('window.closePluginLogsPreview()')
    result.officialScenes = []
    for (const theme of rendererFixtures) {
      const id = theme.pluginId.replace('builtin.theme.', '')
      const state = await window.webContents.executeJavaScript(
        'window.previewOfficialScene(' + JSON.stringify(id) + ')'
      )
      if (
        !state.ready ||
        state.resolved !== 'plugin:' + theme.pluginId ||
        state.selected !== 'plugin:' + theme.pluginId ||
        state.sandbox !== 'allow-scripts' ||
        state.parentProbe !== 'host-only'
      )
        throw new Error('Official theme did not load: ' + id + ' ' + JSON.stringify(state))
      const child = window.webContents.mainFrame.frames.find(
        (frame) => frame.url === theme.rendererUrl
      )
      if (!child) throw new Error('Missing background frame: ' + id)
      const isolated = await child.executeJavaScript(`(()=>{
        let parentBlocked=false;try{void window.parent.document.body}catch{parentBlocked=true}
        const original=requestAnimationFrame.bind(window);window.__frameCalls=0;window.requestAnimationFrame=callback=>original(time=>{window.__frameCalls++;callback(time)});
        const canvases=[...document.querySelectorAll('canvas')];
        let painted=false;for(const canvas of canvases){const ctx=canvas.getContext('2d');if(ctx){const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;for(let i=3;i<pixels.length;i+=4){if(pixels[i]){painted=true;break}}}}
        return {api:typeof window.api,preload:typeof window.__hostProbe,node:typeof window.require,process:typeof window.process,parentBlocked,paused:document.documentElement.classList.contains('theme-paused'),canvas:canvases.length,svg:document.querySelectorAll('svg path').length,painted,hidden:document.hidden,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches}
      })()`)
      if (
        isolated.api !== 'undefined' ||
        isolated.preload !== 'undefined' ||
        isolated.node !== 'undefined' ||
        isolated.process !== 'undefined' ||
        !isolated.parentBlocked ||
        !isolated.paused ||
        !(isolated.painted || isolated.svg > 0)
      )
        throw new Error(
          'Official theme isolation/graphics failure: ' + id + ' ' + JSON.stringify(isolated)
        )
      await window.webContents.executeJavaScript('window.pauseOfficialScene(false)')
      await new Promise((resolve) => setTimeout(resolve, 420))
      const running = await child.executeJavaScript(
        `({raf:window.__frameCalls,animations:document.getAnimations().filter(animation=>animation.playState==='running').length,paused:document.documentElement.classList.contains('theme-paused'),hidden:document.hidden})`
      )
      if (!isolated.reduced && (running.paused || !(running.raf > 0 || running.animations > 0)))
        throw new Error('Official theme failed to animate: ' + id + ' ' + JSON.stringify(running))
      await window.webContents.executeJavaScript('window.pauseOfficialScene(true)')
      await new Promise((resolve) => setTimeout(resolve, 80))
      const before = await child.executeJavaScript('window.__frameCalls')
      await new Promise((resolve) => setTimeout(resolve, 120))
      const paused = await child.executeJavaScript(
        `({raf:window.__frameCalls,animations:document.getAnimations().filter(animation=>animation.playState==='running').length,paused:document.documentElement.classList.contains('theme-paused')})`
      )
      if (paused.raf !== before || paused.animations || !paused.paused)
        throw new Error('Official theme failed to pause: ' + id + ' ' + JSON.stringify(paused))
      if (!(await window.webContents.executeJavaScript('window.showOfficialSceneLight()')))
        throw new Error('Light mode failed: ' + id)
      if (child.detached) throw new Error('Changing color mode recreated the background: ' + id)
      await window.webContents.executeJavaScript(
        'window.previewOfficialScene(' + JSON.stringify(id) + ')'
      )
      await window.webContents.executeJavaScript(
        "document.querySelector('#app main section').style.visibility='hidden'"
      )
      await new Promise((resolve) => setTimeout(resolve, 150))
      fs.writeFileSync(
        'build/official-theme-' + id + '.png',
        (await window.webContents.capturePage()).toPNG()
      )
      await window.webContents.executeJavaScript(
        "document.querySelector('#app main section').style.visibility=''"
      )
      const missing = await window.webContents.executeJavaScript(
        'window.toggleOfficialScene(' + JSON.stringify(id) + ',false)'
      )
      if (
        missing.selected !== 'plugin:builtin.theme.' + id ||
        missing.type !== 'none' ||
        !child.detached
      )
        throw new Error(
          'Disabling failed to remove the frame and retain the saved selection: ' + id
        )
      await window.webContents.executeJavaScript(
        'window.toggleOfficialScene(' + JSON.stringify(id) + ',true)'
      )
      const restored = await window.webContents.executeJavaScript(
        'window.previewOfficialScene(' + JSON.stringify(id) + ')'
      )
      if (!restored.ready) throw new Error('Official theme failed to restore: ' + id)
      result.officialScenes.push({ id, isolated, running, paused: true, restore: true })
    }
    await window.webContents.executeJavaScript('window.previewRainy()')
    fs.writeFileSync(
      'build/rainy-plugin-settings.png',
      (await window.webContents.capturePage()).toPNG()
    )
    await window.webContents.executeJavaScript(
      "document.querySelector('#app main section').style.visibility='hidden'"
    )
    fs.writeFileSync(
      'build/rainy-plugin-background.png',
      (await window.webContents.capturePage()).toPNG()
    )
    await window.webContents.executeJavaScript(
      "document.querySelector('#app main section').style.visibility=''"
    )
    await window.webContents.executeJavaScript('window.previewNyan()')
    fs.writeFileSync(
      'build/nyan-plugin-settings.png',
      (await window.webContents.capturePage()).toPNG()
    )
    await window.webContents.executeJavaScript('window.previewBlackhole()')
    await new Promise((resolve) => setTimeout(resolve, 200))
    fs.writeFileSync(
      'build/appearance-settings.png',
      (await window.webContents.capturePage()).toPNG()
    )
    for (const [name, background] of [
      ['plain', 'none'],
      ['song', 'solid'],
      ['scene', 'plugin:builtin.theme.rainy']
    ]) {
      await window.webContents.executeJavaScript(
        'window.previewLightAppearance(' + JSON.stringify(background) + ')'
      )
      fs.writeFileSync(
        'build/light-appearance-' + name + '.png',
        (await window.webContents.capturePage()).toPNG()
      )
    }
    window.setContentSize(620, 900)
    await new Promise((resolve) => setTimeout(resolve, 200))
    result.compact = await window.webContents.executeJavaScript(
      `({width:innerWidth,scrollWidth:document.documentElement.scrollWidth})`
    )
    if (result.compact.scrollWidth > result.compact.width)
      throw new Error('Appearance settings overflow the compact window')
    fs.writeFileSync(
      'build/appearance-settings-compact.png',
      (await window.webContents.capturePage()).toPNG()
    )
    if (
      !resourceRequests.some(
        (request) => request.status === 200 && request.url.endsWith('/paths.bin')
      ) ||
      !resourceRequests.some(
        (request) => request.status === 200 && request.url.endsWith('/ends.bin')
      )
    )
      throw new Error('Black Hole must load its textures through the real application protocol')
    result.themeResourceRequests = resourceRequests.length
    if (errors.length) throw new Error(errors.join('\n'))
    console.log(JSON.stringify(result, null, 2))
    window.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
