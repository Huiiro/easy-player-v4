/* eslint-disable @typescript-eslint/no-require-imports -- Electron smoke test uses CommonJS. */
// Run after: electron-vite build --outDir out/theme-validation
// Execute with: electron scripts/check-custom-theme.cjs
const { app, BrowserWindow, protocol } = require('electron')
const { readFileSync, readdirSync, existsSync } = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { parse, compileScript } = require('vue/compiler-sfc')

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function compileComponent(file) {
  const { descriptor } = parse(readFileSync(file, 'utf8'))
  return ts.transpileModule(
    compileScript(descriptor, { id: 'theme-check', inlineTemplate: true }).content,
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }
  ).outputText
}

app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'ep-theme-check-')))
app.disableHardwareAcceleration()
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'easy-player-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
])

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  window.webContents.on('console-message', (event) => console.log(event.message))
  try {
    const fontPath = process.env.EP_THEME_TEST_FONT || 'C:/Windows/Fonts/arial.ttf'
    const hasFont = existsSync(fontPath)
    protocol.handle('easy-player-media', (request) => {
      const url = new URL(request.url)
      const name = url.pathname.split('/').at(-1)
      const data =
        name === 'wall.png'
          ? readFileSync('docs/themes/resource-demo/images/nebula.png')
          : name === 'body.ttf' && hasFont
            ? readFileSync(fontPath)
            : null
      return data
        ? new Response(data, {
            headers: {
              'Content-Type': name === 'wall.png' ? 'image/png' : 'font/ttf',
              'Access-Control-Allow-Origin': '*'
            }
          })
        : new Response(null, { status: 404 })
    })
    const assets = path.resolve('out/renderer/assets')
    const css = readdirSync(assets)
      .filter((file) => file.endsWith('.css'))
      .map((file) => readFileSync(path.join(assets, file), 'utf8'))
      .join('\n')
    const shared = ts.transpileModule(readFileSync('src/shared/themePackage.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText
    const service = ts.transpileModule(
      readFileSync('src/renderer/src/services/customTheme.ts', 'utf8'),
      {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
      }
    ).outputText
    await window.loadURL('data:text/html,<html><head></head><body></body></html>')
    await window.webContents.executeJavaScript(
      readFileSync('node_modules/vue/dist/vue.global.prod.js', 'utf8')
    )
    const rangeComponent = compileComponent('src/renderer/src/components/ui/BaseRange.vue')
    const backgroundComponent = compileComponent(
      'src/renderer/src/components/background/AppBackground.vue'
    )
    const result = await window.webContents.executeJavaScript(`(async () => {
      const style = document.createElement('style'); style.textContent = ${JSON.stringify(css)}; document.head.append(style);
      const shared = {}; (function(exports){ ${shared} })(shared);
      const exports = {}; (function(exports, require){ ${service} })(exports, () => shared);
      const {parseCustomTheme, applyCustomTheme} = exports;
      const root = document.documentElement;
      root.classList.add('reduce-motion');
      document.body.innerHTML = '<aside class="ep-sidebar app-sidebar"><button class="ep-sidebar-item ep-sidebar-item--active">Nav</button></aside><button class="ep-button ep-button--primary">Button</button><section class="ep-dialog-panel">Dialog</section><input class="ep-input"><input class="input-base"><input type="range" class="ep-range">';
      const get = (selector, prop) => getComputedStyle(document.querySelector(selector))[prop];
      const check = (ok, message) => { if (!ok) throw new Error(message) };
      const baseline = get('.ep-button', 'borderRadius');
      const theme = parseCustomTheme(JSON.stringify({version:1,name:'Browser test',tokens:{'--color-primary':'#123456','--ep-button-radius':'20px','--ep-sidebar-bg':'rgb(20, 30, 40)'},rules:{'.ep-dialog-panel':{'border-radius':'30px'}}}));
      root.style.setProperty('--color-primary', '#ff0000');
      for (const dark of [false,true]) {
        root.classList.toggle('dark',dark);
        for (const background of ['none','solid','aurora','rainy']) {
          root.dataset.systemTheme = background;
          applyCustomTheme(theme);
          check(get('.ep-button', 'borderRadius') === '20px','button token');
          check(get('.ep-button', 'backgroundColor') === 'rgb(18, 52, 86)','primary override over runtime token');
          check(get('.ep-sidebar', 'backgroundColor') === 'rgb(20, 30, 40)','sidebar across backgrounds');
          check(get('.ep-dialog-panel', 'borderRadius') === '30px','dialog rule');
          check(get('.ep-input','borderColor') === get('.input-base','borderColor'),'shared input material: '+get('.ep-input','borderColor')+' / '+get('.input-base','borderColor'));
        }
      }
      applyCustomTheme(null);
      check(get('.ep-button','borderRadius') === baseline,'cleanup');
      check(get('.ep-dialog-panel','borderRadius') === '16px','dialog cleanup');
      check(get('.ep-range','appearance') === 'none','range rendering');
      let invalid = false;
      try { parseCustomTheme(JSON.stringify({version:1,name:'Invalid',rules:{'.ep-button':{color:'not-a-color'}}})); } catch { invalid = true; }
      check(invalid,'browser CSS validation');
      const loadComponent = (source, imports) => {
        const output = {};
        new Function('exports', 'require', source)(output, (name) => name === 'vue' ? Vue : imports[name]);
        return output.default;
      };
      const rangeComponent = loadComponent(${JSON.stringify(rangeComponent)}, {});
      const rangeHost = document.createElement('div'); document.body.append(rangeHost);
      const values = Vue.reactive({value:25,max:100});
      let seekValue = 0;
      const rangeApp = Vue.createApp({render: () => Vue.h(rangeComponent, {...values, onInput: (event) => {seekValue = Number(event.target.value)}})});
      rangeApp.mount(rangeHost);
      const range = rangeHost.querySelector('input');
      check(range.style.getPropertyValue('--ep-range-progress') === '0.25','initial filled progress');
      values.value = 75; await Vue.nextTick();
      check(range.style.getPropertyValue('--ep-range-progress') === '0.75','playback filled progress');
      range.value = '40'; range.dispatchEvent(new Event('input', {bubbles:true}));
      check(range.style.getPropertyValue('--ep-range-progress') === '0.4' && seekValue === 40,'drag progress and native seek event');
      values.max = 0; await Vue.nextTick();
      check(range.style.getPropertyValue('--ep-range-progress') === '0','zero duration');
      rangeApp.unmount();
      const ui = Vue.reactive({resolvedAppearance:{background:{type:'preset',id:'rainy'}},customThemeOverridesBackground:false,useCustomBg:false,systemBackground:'rainy',reduceMotion:true,showPlayer:false,customBg:{kind:'image',url:''}});
      const backgroundComponent = loadComponent(${JSON.stringify(backgroundComponent)}, {
        'vue-i18n': {useI18n: () => ({t: (key) => key})},
        './systemBackgroundRegistry': {getSystemBackgroundTheme: () => ({id:'rainy',component:{render: () => Vue.h('div', {id:'legacy-background'})}})},
        '@/stores/ui/uiStore': {useUIStore: () => ui},
        '@/stores/player/playerStore': {usePlayerStore: () => ({currentQueueSong:null})},
        './songThemeColors': {SystemThemeColorAnalyzer:{}},
        '@/components/ui/useMessage': {useMessage: () => ({error: () => {}})}
      });
      const bgHost = document.createElement('div'); document.body.append(bgHost);
      const bgApp = Vue.createApp(backgroundComponent); bgApp.mount(bgHost);
      check(!!bgHost.querySelector('#legacy-background'),'original system background');
      ui.customThemeOverridesBackground = true; ui.resolvedAppearance.background={type:'theme'}; await Vue.nextTick();
      // Transition may retain an outgoing layer briefly; inspect the incoming theme layer.
      const layer = bgHost.querySelector('.ep-app-background');
      check(!!layer,'theme replaces background');
      const backgroundTheme = parseCustomTheme(JSON.stringify({version:1,name:'Background',tokens:{'--ep-app-bg':'linear-gradient(#123456, #654321)'}}));
      applyCustomTheme(backgroundTheme);
      check(getComputedStyle(layer).backgroundImage.includes('linear-gradient'),'theme background material');
      ui.customThemeOverridesBackground = false; ui.resolvedAppearance.background={type:'preset',id:'rainy'}; await Vue.nextTick();
      check(!!bgHost.querySelector('#legacy-background'),'original background restored');
      bgApp.unmount(); applyCustomTheme(null);
      const resourceTheme = parseCustomTheme(JSON.stringify({version:1,name:'Resources',package:{id:'12345678-1234-1234-1234-123456789abc',manifest:{
        version:1,id:'browser-test',theme:'theme.json',
        resources:{wall:{type:'image',path:'images/wall.png'},...(${hasFont} ? {body:{type:'font',path:'fonts/body.ttf'},local:{type:'font',path:'fonts/body.ttf'}} : {})},
        slots:{sidebar:{image:'wall',...(${hasFont} ? {font:'local'} : {})},...(${hasFont} ? {global:{font:'body'}} : {})}
      }}}));
      applyCustomTheme(resourceTheme);
      check(get('.ep-sidebar','backgroundImage').includes('easy-player-media://theme/'),'image assigned to sidebar');
      const picture = new Image(); picture.src = shared.themeResourceURL(resourceTheme.package.id,'images/wall.png'); await picture.decode();
      check(picture.naturalWidth === 960,'package image loaded and decoded');
      if (${hasFont}) {
        const family = 'EPTheme-' + resourceTheme.package.id + '-body';
        const deadline = Date.now() + 3000;
        while (![...document.fonts].some((face) => face.family === family && face.status === 'loaded')) {
          check(Date.now() < deadline,'package font loaded');
          await new Promise((resolve) => setTimeout(resolve,20));
        }
        check(get('.ep-button','fontFamily').includes(family),'global package font applies to controls');
        check(get('.ep-sidebar-item','fontFamily').includes('-local'),'region font overrides global font on nested controls');
        applyCustomTheme(null);
        check(![...document.fonts].some((face) => face.family === family),'package font unloaded');
      }
      applyCustomTheme(null);
      return 'Chromium theme cascade, range, background restoration, package image decode and font loading/cleanup passed';
    })()`)
    console.log(result)
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
