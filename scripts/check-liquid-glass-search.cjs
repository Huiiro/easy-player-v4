/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Real Chromium paint regression fixture. */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  assert = require('node:assert/strict')
const esbuild = require('esbuild')
const { parse, compileScript, compileStyle } = require('@vue/compiler-sfc')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ep-glass-search-')))
app.commandLine.appendSwitch('force-device-scale-factor', process.env.EP_GLASS_DPR || '1')
app.whenReady().then(async () => {
  let win
  try {
    const styles = []
    const bundle = await esbuild.build({
      stdin: {
        contents: `export * as Vue from 'vue';export {createI18n} from 'vue-i18n';export {createRouter,createMemoryHistory} from 'vue-router';export {mountLiquidGlassStudio} from './src/renderer/src/services/liquidGlassStudio';export {default as Search} from './src/renderer/src/components/search/GlobalSearchDialog.vue';export {default as Actions} from './src/renderer/src/components/songlist/SongListActions.vue';export {default as zh} from './src/renderer/src/i18n/locales/zh';`,
        resolveDir: process.cwd()
      },
      bundle: true,
      write: false,
      format: 'iife',
      globalName: 'Fixture',
      alias: {
        '@': path.resolve('src/renderer/src'),
        vue: require.resolve('vue/dist/vue.esm-bundler.js')
      },
      define: {
        __VUE_OPTIONS_API__: 'true',
        __VUE_PROD_DEVTOOLS__: 'false',
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false'
      },
      plugins: [
        {
          name: 'fixture',
          setup(build) {
            let sequence = 0
            const mocks = {
              '/stores/ui/uiStore': 'export const useUIStore=()=>window.searchUi',
              '/stores/player/playerStore':
                'export const usePlayerStore=()=>({currentQueueSong:null,queue:[]})',
              '/stores/statistics/statisticsStore':
                'export const useStatisticsStore=()=>({enabled:true,generation:0})',
              '/services/songListQuery':
                'export const querySongList=async options=>window.searchQuery(options)',
              '/components/ui/useMessage':
                'export const useMessage=()=>({error:message=>window.fixtureErrors.push(message)})'
            }
            build.onResolve({ filter: /.*/ }, (args) => {
              const key = Object.keys(mocks).find((key) => args.path.endsWith(key))
              if (key) return { path: key, namespace: 'mock' }
            })
            build.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({
              contents: mocks[args.path],
              loader: 'js'
            }))
            build.onResolve({ filter: /\.glsl\?raw$/ }, (args) => ({
              path: path.resolve(args.resolveDir, args.path.slice(0, -4)),
              namespace: 'glsl'
            }))
            build.onLoad({ filter: /.*/, namespace: 'glsl' }, (args) => ({
              contents: fs.readFileSync(args.path, 'utf8'),
              loader: 'text'
            }))
            build.onLoad({ filter: /\.css$/ }, (args) => {
              styles.push(fs.readFileSync(args.path, 'utf8'))
              return { contents: '', loader: 'js' }
            })
            build.onLoad({ filter: /\.vue$/ }, ({ path: filename }) => {
              if (
                [
                  'SongTagDialog',
                  'BatchTagDialog',
                  'SongDetailsDialog',
                  'DeleteSongsDialog',
                  'AddSongsToPlaylistDialog',
                  'MetadataEditDialog',
                  'LyricsEditorDialog',
                  'LyricsSearchDialog'
                ].includes(path.basename(filename, '.vue'))
              )
                return { contents: 'export default {render:()=>null}', loader: 'js' }
              const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename }),
                id = 'glass-search-' + ++sequence
              styles.push(
                ...descriptor.styles.map(
                  (s) =>
                    compileStyle({
                      source: s.content,
                      id: 'data-v-' + id,
                      filename,
                      scoped: s.scoped
                    }).code
                )
              )
              return {
                contents:
                  compileScript(descriptor, {
                    id,
                    inlineTemplate: true,
                    genDefaultAs: '__sfc__',
                    fs: {
                      fileExists: fs.existsSync,
                      readFile: (file) => fs.readFileSync(file, 'utf8')
                    }
                  }).content + `;__sfc__.__scopeId='data-v-${id}';export default __sfc__`,
                loader: 'ts',
                resolveDir: path.dirname(filename)
              }
            })
          }
        }
      ]
    })
    const output = path.resolve('build/themes/liquid-glass-search')
    fs.mkdirSync(output, { recursive: true })
    const assets = path.resolve('out/renderer/assets'),
      css = fs.readFileSync(
        path.join(
          assets,
          fs.readdirSync(assets).find((f) => /^main-.*\.css$/.test(f))
        ),
        'utf8'
      )
    const html = path.join(output, 'fixture.html')
    fs.writeFileSync(
      html,
      `<!doctype html><html><head><style>${css}\n${styles.join('\n')}\nbody{margin:0}:root{--color-primary:#666!important;--color-bg:#f0f0f0!important;--color-text:#202020!important;--color-border:#888!important}:root.dark{--color-bg:#161616!important;--color-text:#eee!important} .app-background-stage{position:fixed;inset:0;background:#606060}.page-pattern{position:fixed;inset:0;background:conic-gradient(#242424 25%,#888888 0 50%,#242424 0 75%,#888888 0) 0 0 / 160px 160px}.ep-footer{position:fixed;left:20px;bottom:20px;width:1060px;height:84px;border-radius:24px}</style></head><body><div class="app-background-stage"></div><div class="page-pattern"></div><div class="ep-footer"></div><div id="app"></div></body></html>`
    )
    win = new BrowserWindow({
      show: false,
      width: 1100,
      height: 900,
      webPreferences: { offscreen: true, backgroundThrottling: false }
    })
    win.webContents.setFrameRate(60)
    const errors = []
    win.webContents.on('console-message', (event) => {
      if (event.level === 'error' && !event.message.includes('Security Warning')) {
        errors.push(event.message)
        console.error(event.message)
      }
    })
    await win.loadFile(html)
    const run = (code) => win.webContents.executeJavaScript(code),
      wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    await run(
      `(()=>{const stage=document.querySelector('.app-background-stage');const frame=document.createElement('iframe');frame.className='ready';const wrapper=document.createElement('div');wrapper.className='sandboxed-theme-background';wrapper.append(frame);stage.append(wrapper);frame.srcdoc='<script>onmessage=e=>{const port=e.ports[0];if(!port)return;setTimeout(async()=>{const c=new OffscreenCanvas(1100,900),x=c.getContext("2d");x.fillStyle="#606060";x.fillRect(0,0,1100,900);const b=c.transferToImageBitmap();port.postMessage(b,[b])},180)}<\\/script>';void 0})()`
    )
    await run(bundle.outputFiles[0].text)
    await run(`(async()=>{window.fixtureErrors=[];window.searchUi={artistSeparator:'/',genreSeparator:'/',normalizeMetadataSeparator:true};window.searchQuery=async options=>options.search==='missing'?[]:Array.from({length:20},(_,i)=>({id:i+1,title:'Track '+i,artist:'Artist',album:'Album',songStatus:1,duration:200,sourceId:null,audio:i+'.flac'}));window.api={database:{onSearchIndexChanged:()=>()=>{}}};
    window.searchState=Fixture.Vue.reactive({open:true});window.router=Fixture.createRouter({history:Fixture.createMemoryHistory(),routes:[{path:'/',component:{render:()=>null}}]});await router.push('/');
    window.searchApp=Fixture.Vue.createApp({render:()=>Fixture.Vue.h(Fixture.Search,{modelValue:searchState.open,'onUpdate:modelValue':value=>searchState.open=value})}).use(router).use(Fixture.createI18n({legacy:false,locale:'zh',messages:{zh:Fixture.zh}}));searchApp.config.errorHandler=error=>fixtureErrors.push(String(error));searchApp.mount('#app');window.glass=Fixture.mountLiquidGlassStudio();})()`)
    await wait(1200)
    const rect = await run(
      `(()=>{const r=document.querySelector('.global-search-panel').getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()`
    )
    const samples = [],
      bad = []
    let phase = '',
      capture = false
    win.webContents.on('paint', (_event, _dirty, image) => {
      if (!capture) return
      if (image.getSize().width !== 1100) image = image.resize({ width: 1100, height: 900 })
      const size = image.getSize(),
        bytes = image.toBitmap()
      const pixel = (x, y) => {
        const i = (Math.round(y) * size.width + Math.round(x)) * 4
        return [bytes[i + 2], bytes[i + 1], bytes[i]]
      }
      const header = pixel((rect.left + rect.right) / 2, rect.top + 37),
        footer = pixel(550, 838)
      const centre = pixel(rect.right - 100, rect.top + 210)
      const greenSpread = (y, left, right) => {
        const values = []
        for (let x = left; x < right; x += 12) values.push(pixel(x, y)[1])
        return Math.max(...values) - Math.min(...values)
      }
      const headerSpread = greenSpread(rect.top + 37, rect.left + 60, rect.right - 60),
        footerSpread = greenSpread(838, 100, 1000)
      let maxInteriorChroma = 0
      for (let x = rect.left + 300; x < rect.right - 50; x += 3) {
        const rgb = pixel(x, rect.top + 37)
        maxInteriorChroma = Math.max(maxInteriorChroma, Math.max(...rgb) - Math.min(...rgb))
      }
      const sample = {
        phase,
        header,
        footer,
        centre,
        headerSpread,
        footerSpread,
        maxInteriorChroma
      }
      samples.push(sample)
      if (maxInteriorChroma > 5 || footerSpread < 25) {
        bad.push(sample)
        if (bad.length <= 5)
          fs.writeFileSync(path.join(output, 'bad-' + bad.length + '.png'), image.toPNG())
      }
    })
    await run(
      `window.cssFrames=[];window.collectCss=true;(function sample(){if(!collectCss)return;const p=document.querySelector('.global-search-panel'),f=document.querySelector('.ep-footer');cssFrames.push({t:performance.now(),height:p?.offsetHeight,colour:p&&getComputedStyle(p).backgroundColor,filter:p&&getComputedStyle(p).backdropFilter,footerFilter:getComputedStyle(f).backdropFilter,canvas:p?.querySelector('canvas')?.hidden});requestAnimationFrame(sample)})();void 0`
    )
    await run(
      `window.staleLayouts=[];window.layoutObserver=new ResizeObserver(()=>{const e=document.querySelector('.global-search-panel'),id=getComputedStyle(e).backdropFilter.match(/#([^"')]+)/)?.[1],image=id&&document.getElementById(id)?.querySelector('feImage');if(image&&Number(image.getAttribute('height'))!==e.offsetHeight)staleLayouts.push({height:e.offsetHeight,mapHeight:image.getAttribute('height')})});layoutObserver.observe(document.querySelector('.global-search-panel'));void 0`
    )
    await run(
      `window.initialResultRoot=document.querySelector('.global-search-results');window.initialScroller=initialResultRoot.querySelector('.vue-recycle-scroller');window.glassStyles=document.querySelector('#ep-studio-backdrop-style');window.footerRule=[...glassStyles.sheet.cssRules].find(r=>r.selectorText?.includes(document.querySelector('.ep-footer').getAttribute('data-ep-studio-backdrop-surface')));window.styleReplacements=0;window.styleObserver=new MutationObserver(records=>styleReplacements+=records.length);styleObserver.observe(glassStyles,{childList:true});void 0`
    )
    const transitions = []
    // HTMLImageElement.decode() and the SVG/GPU image consumer are independent.
    // Exercise the latter's transparent first frame instead of only delaying
    // the promise used by the host's normal initialization path.
    phase = 'svg-image-not-ready'
    capture = true
    await run(
      `(()=>{const e=document.querySelector('.global-search-panel'),id=getComputedStyle(e).backdropFilter.match(/#([^"')]+)/)?.[1];window.normalImage=id&&document.getElementById(id)?.querySelector('feImage[result="normal"]');if(!normalImage)throw Error('Search filter must be ready for the missing SVG image check');window.normalHref=normalImage.getAttribute('href');normalImage.setAttribute('href',document.createElement('canvas').toDataURL());void 0})()`
    )
    await wait(180)
    await run('normalImage.setAttribute("href",normalHref);void 0')
    await wait(100)
    capture = false
    for (const variant of ['light:gated', 'dark:gated', 'light:live', 'dark:live']) {
      const dark = variant.startsWith('dark'),
        delayed = variant.endsWith('gated')
      await run(`document.documentElement.classList.toggle('dark',${dark});void 0`)
      await wait(350)
      // Keep old maps alive while a real replacement image deliberately decodes late.
      await run(
        `window.mapGates=[];window.decodeImage=HTMLImageElement.prototype.decode;HTMLImageElement.prototype.decode=function(){const decoded=decodeImage.call(this);return ${delayed}&&this.src.startsWith('data:image/png')?decoded.then(()=>new Promise(resolve=>mapGates.push(resolve))):decoded};void 0`
      )
      capture = true
      for (let cycle = 0; cycle < 2; cycle++)
        for (const text of ['missing', 'found', '']) {
          phase = variant + ':' + cycle + ':' + (text || 'clear')
          await run(
            `{const input=document.querySelector('.global-search-input input');input.value=${JSON.stringify(text)};input.dispatchEvent(new Event('input',{bubbles:true}));void 0}`
          )
          await wait(400)
          const transition = await run(
            `(()=>{const root=document.querySelector('.global-search-results'),scroller=root.querySelector('.vue-recycle-scroller');return {sameRoot:root===initialResultRoot,sameScroller:scroller===initialScroller,filter:getComputedStyle(document.querySelector('.global-search-panel')).backdropFilter,visible:getComputedStyle(root).display!=='none',rows:document.querySelectorAll('.global-search-result').length,inert:scroller.inert,gates:mapGates.length}})()`
          )
          transitions.push({ phase, ...transition })
          assert(
            transition.sameRoot && transition.sameScroller,
            'Empty/results/clear states reuse the same compositor subtree'
          )
          assert(
            transition.filter.includes('url(') || /blur\([1-9]/.test(transition.filter),
            'Pending geometry retains decoded transmission or the same neutral blur until its replacement is ready'
          )
          assert.equal(transition.visible, !!text)
          if (text === 'found')
            assert(transition.rows > 0 && !transition.inert, 'Results remain interactive')
          if (text === 'missing')
            assert(transition.inert, 'Empty result scroller cannot receive input')
        }
      await run(
        `HTMLImageElement.prototype.decode=decodeImage;for(const resolve of mapGates.splice(0))resolve();void 0`
      )
      await wait(200)
      capture = false
    }
    capture = false
    const state = await run(
      `collectCss=false;layoutObserver.disconnect();({cssFrames,staleLayouts,scrollerReused:document.querySelector('.global-search-results .vue-recycle-scroller')===initialScroller,errors:fixtureErrors,styleReplacements,footerRuleStable:[...glassStyles.sheet.cssRules].includes(footerRule),filters:document.querySelectorAll('#ep-studio-backdrop-svg filter').length,glErrors:[...document.querySelectorAll('.ep-studio-canvas')].map(c=>c.getContext('webgl2').getError())})`
    )
    fs.writeFileSync(
      path.join(output, 'verification.json'),
      JSON.stringify({ rect, samples, bad, state, transitions, errors }, null, 2)
    )
    console.log(
      JSON.stringify(
        {
          frames: samples.length,
          bad: bad.length,
          examples: bad.slice(0, 5),
          errors,
          state: {
            filters: state.filters,
            glErrors: state.glErrors,
            errors: state.errors,
            styleReplacements: state.styleReplacements,
            footerRuleStable: state.footerRuleStable,
            scrollerReused: state.scrollerReused
          }
        },
        null,
        2
      )
    )
    assert(samples.length > 10, 'Capture actual compositor paint frames across search states')
    assert.deepEqual(
      state.staleLayouts,
      [],
      'A resized search must never reach paint with an old-size SVG map'
    )
    assert.deepEqual(errors, [])
    assert.deepEqual(state.errors, [])
    assert.equal(
      state.footerRuleStable,
      true,
      'Unchanged Footer keeps its stylesheet rule across search geometry updates'
    )
    assert.equal(
      state.styleReplacements,
      0,
      'Search changes must not replace the shared glass stylesheet'
    )
    assert.equal(
      bad.length,
      0,
      'Neutral page detail must not flash coloured normal-map bands or lose transmission; report: ' +
        path.join(output, 'verification.json')
    )
    const menuFrames = [],
      menuFailures = [],
      menuSnapshotTasks = []
    await run(
      `window.menuCanvases=new Set();window.originalContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(type==='webgl2'&&this.classList.contains('ep-studio-canvas'))menuCanvases.add(this);return originalContext.call(this,type,...args)};void 0`
    )
    // Bright detail outside the popup makes an incorrect large displacement
    // visible as a white flash, rather than merely shifting a dark checker.
    // Delay the SVG consumer only; the HTML preload still decodes normally.
    await run(
      `(()=>{const marker=document.createElement('div');marker.style.cssText='position:fixed;left:100px;top:0;width:160px;height:250px;background:white';document.querySelector('.page-pattern').append(marker);window.svgImageAttribute=SVGFEImageElement.prototype.setAttribute;SVGFEImageElement.prototype.setAttribute=function(name,value){svgImageAttribute.call(this,name,value);if(name==='result'&&value==='normal'){const href=this.getAttribute('href');svgImageAttribute.call(this,'href',document.createElement('canvas').toDataURL());setTimeout(()=>{if(this.isConnected)svgImageAttribute.call(this,'href',href)},120)}};void 0})()`
    )
    let captureMenus = false,
      hoverPhase = ''
    win.webContents.on('paint', (_event, _dirty, image) => {
      if (!captureMenus) return
      if (image.getSize().width !== 1100) image = image.resize({ width: 1100, height: 900 })
      const { width } = image.getSize(),
        bytes = image.toBitmap()
      let white = 0,
        total = 0
      for (let y = 90; y < 550; y += 2)
        for (let x = 275; x < 550; x += 2) {
          const i = (y * width + x) * 4
          total++
          if (bytes[i] > 220 && bytes[i + 1] > 220 && bytes[i + 2] > 220) white++
        }
      const sample = { hoverPhase, whiteFraction: white / total }
      menuFrames.push(sample)
      if (sample.whiteFraction > 0.05) {
        menuFailures.push(sample)
        menuSnapshotTasks.push(
          run(
            `([...document.querySelectorAll('.ep-floating .ep-menu')].map(e=>({filter:getComputedStyle(e).backdropFilter,bg:getComputedStyle(e).backgroundColor,canvas:e.querySelector('canvas')?.hidden,html:e.outerHTML.slice(0,400)})))`
          ).then((surfaces) => (sample.surfaces = surfaces))
        )
        if (menuFailures.length <= 3)
          fs.writeFileSync(
            path.join(output, 'menu-flash-' + menuFailures.length + '.png'),
            image.toPNG()
          )
      }
    })
    await run(
      `collectCss=false;searchApp.unmount();document.documentElement.classList.remove('dark');window.menuRef=Fixture.Vue.ref();window.fixtureSong={id:1,title:'Track',artist:'Artist',album:'Album',audio:'one.flac',songStatus:1};window.menuApp=Fixture.Vue.createApp({render:()=>Fixture.Vue.h(Fixture.Actions,{ref:menuRef,source:{type:'songs'},songs:[fixtureSong],selectedIds:new Set(),refresh:async()=>{},playSong:async()=>{}})}).use(router).use(Fixture.createI18n({legacy:false,locale:'zh',messages:{zh:Fixture.zh}}));menuApp.config.errorHandler=error=>fixtureErrors.push(String(error));menuApp.mount('#app');void 0`
    )
    await run('menuRef.value.openMenu(fixtureSong,40,70)')
    await wait(150)
    const triggers = await run(
      `[...document.querySelectorAll('.ep-menu button[aria-haspopup="menu"]')].map(e=>{const r=e.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})`
    )
    assert.equal(triggers.length, 2, 'Use the real song actions marks/edit submenus')
    await run(
      String.raw`window.earlyMenus=[];window.earlyObserver=new MutationObserver(()=>{for(const e of document.querySelectorAll('.ep-floating .ep-menu')){const s=getComputedStyle(e);if(s.visibility!=='visible')continue;const alpha=Number(s.backgroundColor.match(/\/\s*([\d.]+)/)?.[1]??s.backgroundColor.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)/)?.[1]??1);earlyMenus.push({alpha,bg:s.backgroundColor,filter:s.backdropFilter,isolation:s.isolation,transition:s.transitionProperty,positioned:!!e.closest('.ep-floating').style.left})}});earlyObserver.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class']});void 0`
    )
    captureMenus = true
    for (const dark of [false, true]) {
      await run(`document.documentElement.classList.toggle('dark',${dark});void 0`)
      await wait(200)
      for (let i = 0; i < 48; i++) {
        hoverPhase = (dark ? 'dark:' : 'light:') + i
        win.webContents.sendInputEvent({ type: 'mouseMove', ...triggers[i % 2] })
        await wait(65)
      }
    }
    await wait(150)
    captureMenus = false
    await Promise.all(menuSnapshotTasks)
    const menuState = await run(
      `earlyObserver.disconnect();({earlyMenus,errors:fixtureErrors,contextCount:menuCanvases.size,menuCount:document.querySelectorAll('.ep-floating .ep-menu').length})`
    )
    fs.writeFileSync(
      path.join(output, 'submenu-verification.json'),
      JSON.stringify({ menuFrames, menuFailures, menuState }, null, 2)
    )
    assert(menuFrames.length > 10, 'Capture actual paint frames from rapid native hover switching')
    assert.equal(menuFailures.length, 0, 'Real song submenus never paint an opaque white frame')
    assert(
      menuState.earlyMenus.length > 0 &&
        menuState.earlyMenus.every(
          (m) =>
            m.alpha < 0.2 &&
            m.filter !== 'none' &&
            m.isolation === 'isolate' &&
            !m.transition.includes('backdrop-filter') &&
            !m.transition.split(',').includes('all')
        ),
      'Every positioned submenu starts with a translucent blurred material'
    )
    assert(
      menuState.contextCount <= 4,
      'Rapid submenu switching reuses GPU contexts instead of allocating one for every hover: ' +
        menuState.contextCount
    )
    assert.deepEqual(menuState.errors, [])
    console.log(
      JSON.stringify({
        menuFrames: menuFrames.length,
        whiteFrames: menuFailures.length,
        hoverSwitches: 96,
        contextCount: menuState.contextCount,
        maxInitialTint: Math.max(...menuState.earlyMenus.map((m) => m.alpha))
      })
    )
    await run(
      'HTMLCanvasElement.prototype.getContext=originalContext;SVGFEImageElement.prototype.setAttribute=svgImageAttribute;menuApp.unmount();void 0'
    )
    await run('styleObserver.disconnect();glass.dispose();searchApp.unmount();void 0')
    await wait(50)
    assert(
      await run(`[...menuCanvases].every(c=>c.getContext('webgl2')?.isContextLost())`),
      'Disabling glass releases both active and cached menu GPU contexts'
    )
    assert.equal(
      await run(
        `document.querySelectorAll('#ep-studio-backdrop-svg,#ep-studio-backdrop-style,.ep-studio-canvas,[data-ep-studio-surface]').length`
      ),
      0,
      'Disposal removes current, pending, retired filters and all surface resources'
    )
    win.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    win?.destroy()
    app.exit(1)
  }
})
