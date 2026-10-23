/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const esbuild = require('esbuild')
const { parse, compileScript } = require('@vue/compiler-sfc')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ep-appearance-check-')))
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  try {
    const styles = []
    const bundle = await esbuild.build({
      stdin: {
        contents: `import * as Vue from 'vue'; import {createPinia} from 'pinia'; import persisted from 'pinia-plugin-persistedstate'; import {createI18n} from 'vue-i18n';
        import {useUIStore} from './src/renderer/src/stores/ui/uiStore';
        import {flushPlayerDataStorage} from './src/renderer/src/stores/persistence';
        import ThemeSettings from './src/renderer/src/components/settings/ThemeSettings.vue';
        import AppBackground from './src/renderer/src/components/background/AppBackground.vue';
        import {systemBackgroundThemes} from './src/renderer/src/components/background/systemBackgroundRegistry';
        import zh from './src/renderer/src/i18n/locales/zh';
        export {Vue,createPinia,persisted,createI18n,useUIStore,flushPlayerDataStorage,ThemeSettings,AppBackground,systemBackgroundThemes,zh};`,
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
            build.onLoad(
              { filter: /components[\\/]background[\\/](?:themes[\\/].+|SolidBackground)\.vue$/ },
              () => ({
                contents:
                  "import {h} from 'vue';export default {render(){return h('div',{style:'position:absolute;inset:0;background:#000'},'Scene background')}}",
                loader: 'js'
              })
            )
            build.onLoad({ filter: /\.vue$/ }, ({ path: filename }) => {
              const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
              descriptor.styles.forEach((style) => styles.push(style.content))
              return {
                contents: compileScript(descriptor, {
                  id: filename,
                  inlineTemplate: true,
                  fs: {
                    fileExists: fs.existsSync,
                    readFile: (file) => fs.readFileSync(file, 'utf8')
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
      width: 1100,
      height: 1000,
      webPreferences: { sandbox: true, offscreen: true, backgroundThrottling: false }
    })
    const errors = []
    window.webContents.on('console-message', (event) => {
      if (event.level === 'error') {
        errors.push(event.message)
        console.error(event.message)
      }
    })
    const fixture = path.join(app.getPath('userData'), 'appearance.html')
    fs.writeFileSync(fixture, '<html><body><div id="app"></div></body></html>')
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
    const result = await window.webContents.executeJavaScript(`(async()=>{
      const {Vue,createPinia,persisted,createI18n,useUIStore,flushPlayerDataStorage,ThemeSettings,AppBackground,systemBackgroundThemes,zh}=AppearanceCheck;
      const {h,createApp,nextTick}=Vue;
      const checks=[];const check=(ok,message)=>{if(!ok)throw new Error(message);checks.push(message)};
      const wait=async()=>{await nextTick();await nextTick();await nextTick();await new Promise(resolve=>setTimeout(resolve,30))};
      const settings=new Map([['pinia.ui.preferences.v1',JSON.stringify({reduceMotion:true,useDarkMode:true,followSystemTheme:true,useMica:true,systemBackground:'none',themeBeforeMica:{useDarkMode:false,followSystemTheme:false,useCustomBg:false,systemBackground:'rainy'}})]]);
      let material='acrylic',failMaterial=false;const removed=[];
      let systemDark=false;const mediaListeners=new Set();
      window.matchMedia=query=>({matches:query==='(prefers-color-scheme: dark)'?systemDark:false,addEventListener:(_event,fn)=>{if(query==='(prefers-color-scheme: dark)')mediaListeners.add(fn)},removeEventListener:(_event,fn)=>mediaListeners.delete(fn)});
      window.api={fonts:{list:async()=>({success:true,data:[]})},themes:{removePackage:async id=>removed.push(id)},system:{getWindowMaterialState:async()=>({success:true,data:{available:['none','mica','acrylic'],material,enabled:material!=='none'}}),setWindowMaterial:async value=>{if(failMaterial)return {success:false,error:'fixture failure'};material=value;return {success:true,data:{material,enabled:material!=='none'}}}},database:{getSync:key=>({success:true,data:settings.get(key)}),saveSync:(key,value)=>{settings.set(key,value);return {success:true}}}};
      let ui;
      const mount=()=>{const pinia=createPinia().use(persisted);const instance=createApp({setup(){ui=useUIStore();return()=>h('main',{class:'settings-page',style:'position:relative;min-height:100vh;padding:20px'},[h(AppBackground),h('section',{style:'position:relative;z-index:2'},[h(ThemeSettings)])])}}).use(pinia).use(createI18n({legacy:false,locale:'zh',messages:{zh},missingWarn:false,fallbackWarn:false}));instance.mount('#app');return instance};
      let mounted=mount();await ui.initializeTheme();await wait();
      check(ui.colorMode==='light'&&ui.appearancePreferences.background.id==='rainy','Legacy native-material snapshots migrate back to the saved user preferences');
      check(ui.nativeMaterialEnabled&&ui.resolvedAppearance.background.type==='none'&&!document.querySelector('.app-background-layer,.ep-app-background'),'Native material suppresses all renderer backgrounds');
      check(document.querySelector('[role=status]').textContent.includes('Acrylic'),'Settings show the actual background source');
      await ui.setNativeWindowMaterial('none');await wait();
      check(document.querySelector('.app-background-layer')&&ui.resolvedAppearance.background.id==='rainy','Turning material off restores the original scene without rewriting preferences');
      ui.setColorMode('system');await wait();
      check(ui.appearancePreferences.background.id==='rainy','Following system appearance keeps the selected scene');
      systemDark=true;for(const listener of mediaListeners)listener();await wait();
      check(ui.resolvedAppearance.dark&&document.documentElement.classList.contains('dark')&&ui.appearancePreferences.background.id==='rainy','System color-mode changes update the DOM while retaining the selected scene');
      ui.setColorMode('light');await wait();
      check(!document.documentElement.classList.contains('dark'),'Explicit light mode is applied independently of the dark scene');
      ui.customThemes.push({version:1,name:'Fixture theme',background:'replace',tokens:{'--color-primary':'#123456'},rules:{}});
      ui.selectCustomTheme('Fixture theme');await wait();
      check(document.querySelector('.ep-app-background')&&ui.resolvedAppearance.accentSource==='theme','Selected theme applies its background and palette');
      ui.selectThemeBackground('aurora');await wait();
      check(ui.effectiveCustomThemeName==='Fixture theme'&&ui.resolvedAppearance.background.id==='aurora'&&ui.resolvedAppearance.accentColor==='#123456'&&getComputedStyle(document.documentElement).getPropertyValue('--color-primary').includes('18, 52, 86'),'Selecting a scene retains theme colors and replaces only its background');
      ui.themeBackgroundEnabled=true;await wait();
      check(!!document.querySelector('.ep-app-background'),'Theme background can be restored explicitly');
      ui.setCustomBackground({kind:'image',url:'',path:'fixture.png'});await wait();
      check(ui.resolvedAppearance.background.type==='image'&&!ui.themeBackgroundEnabled&&ui.effectiveCustomThemeName==='Fixture theme','Media import follows the same background-selection rule');
      ui.customBg.chromeBorder='#abcdef';await wait();
      check(document.documentElement.style.getPropertyValue('--app-chrome-border')==='#abcdef'&&!document.documentElement.style.getPropertyValue('--color-border'),'Background chrome does not overwrite component borders');
      ui.importCustomTheme(JSON.stringify({version:1,name:'Preview',tokens:{'--color-primary':'#ff00ff'}}));await wait();
      check(ui.customThemePreviewActive&&ui.resolvedAppearance.background.type==='theme','Import preview uses the staged theme background');
      ui.cancelCustomThemePreview();await wait();
      check(ui.resolvedAppearance.background.type==='image'&&!ui.themeBackgroundEnabled&&ui.effectiveCustomThemeName==='Fixture theme','Cancelling preview restores both palette and saved background policy');
      ui.selectCustomTheme('');ui.accentSource='song';await wait();
      check(ui.resolvedAppearance.reasons.includes('songUnavailable')&&document.querySelector('[role=status]').textContent.includes('暂无可用封面颜色'),'Missing artwork reports its accent fallback in settings');
      ui.setColorMode('dark');ui.setColorMode('light');ui.setColorMode('dark');ui.selectThemeBackground('rainy');ui.setColorMode('light');await wait();
      check(!document.documentElement.classList.contains('dark')&&document.documentElement.dataset.systemTheme==='rainy','Rapid consecutive changes apply the final color mode and background');
      ui.playerBgType='liquid';ui.playerCoverStyle='vinyl';await ui.setNativeWindowMaterial('mica');await wait();failMaterial=true;
      let failed=false;try{await ui.resetTheme()}catch{failed=true}await wait();
      check(failed&&ui.nativeMaterialEnabled&&ui.appearancePreferences.background.id==='rainy','Failed native reset leaves saved appearance intact');
      failMaterial=false;await ui.resetTheme();await wait();
      check(!ui.nativeMaterialEnabled&&ui.resolvedAppearance.background.type==='none'&&ui.playerBgType==='liquid'&&ui.playerCoverStyle==='vinyl','Theme reset turns off material and leaves player appearance intact');
      ui.setColorMode('system');ui.selectThemeBackground('aurora');ui.accentSource='song';ui.themeBackgroundEnabled=false;await wait();flushPlayerDataStorage();
      ui.$dispose();mounted.unmount();mounted=mount();await ui.initializeTheme();await wait();
      check(ui.colorMode==='system'&&ui.appearancePreferences.background.id==='aurora'&&ui.accentSource==='song'&&!ui.themeBackgroundEnabled,'Independent appearance choices survive a fresh store and renderer initialization');
      const selectors=[document.querySelector('.ep-select[aria-label="外观模式"]')];
      selectors[0].click();await wait();const light=[...document.querySelectorAll('[role=option]')].find(option=>option.textContent.includes('浅色'));light.click();await wait();
      check(ui.colorMode==='light'&&ui.appearancePreferences.background.id==='aurora','The real settings control changes color mode without clearing the scene');
      const rgb=value=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data]};
      const lum=channels=>channels.slice(0,3).map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
      const contrast=(a,b)=>(Math.max(lum(a),lum(b))+0.05)/(Math.min(lum(a),lum(b))+0.05);
      ui.setColorMode('light');ui.accentSource='auto';ui.reduceMotion=false;
      for(const scene of systemBackgroundThemes.filter(scene=>scene.id!=='none')) {
        ui.selectThemeBackground(scene.id);await wait();
        const scrim=document.querySelector('.app-background-scrim');
        check(!!scrim,'Light '+scene.id+' has a readability layer including the song background');
        const overlay=rgb(getComputedStyle(scrim).backgroundColor);const surface=overlay.map((value,i)=>i<3?value*overlay[3]/255:value);
        const primary=rgb(getComputedStyle(document.documentElement).getPropertyValue('--color-primary'));
        const text=rgb(getComputedStyle(document.querySelector('.setting-row h3')).color);
        const secondary=rgb(getComputedStyle(document.querySelector('.setting-row p')).color);
        check(contrast(text,surface)>=7&&contrast(secondary,surface)>=4.5&&contrast(primary,surface)>=4.5,'Light '+scene.id+' keeps readable text and accent against its darkest backdrop');
        const layer=document.querySelector('.app-background-layer');ui.setColorMode('dark');await wait();ui.setColorMode('light');await wait();
        const rootStyle=getComputedStyle(document.documentElement);
        check(document.querySelector('.app-background-layer')===layer&&!document.querySelector('[class*=app-theme-background-leave]')&&contrast(rgb(rootStyle.getPropertyValue('--color-text')),rgb(rootStyle.getPropertyValue('--color-bg')))>=7,'Switching '+scene.id+' light/dark preserves its canvas host and avoids a fading cleared layer');
      }
      ui.setCustomBackground({kind:'image',url:'',path:'contrast.png'});await wait();
      const rootStyle=getComputedStyle(document.documentElement);
      for(const token of ['--app-header-bg','--app-footer-bg']) {const chrome=rgb(rootStyle.getPropertyValue(token));const composite=chrome.map((v,i)=>i<3?v*chrome[3]/255:v);check(contrast(rgb(rootStyle.getPropertyValue('--color-text')),composite)>=7,'Light custom media uses readable '+token);}
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
      ui.selectCustomTheme('');ui.selectThemeBackground('aurora');await wait();
      document.querySelector('[role=status]').scrollIntoView({block:'start'});await wait();
      return {passed:checks.length,checks};
    })()`)
    await new Promise((resolve) => setTimeout(resolve, 200))
    fs.writeFileSync(
      'build/appearance-settings.png',
      (await window.webContents.capturePage()).toPNG()
    )
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
    if (errors.length) throw new Error(errors.join('\n'))
    console.log(JSON.stringify(result, null, 2))
    window.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
