/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Standalone Electron checks use CommonJS and JavaScript callbacks. */
const { app, BrowserWindow, protocol } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const esbuild = require('esbuild')
const { parse, compileScript, compileStyle } = require('@vue/compiler-sfc')
const source = path.resolve('docs/themes/gi-columbina')
const output = path.resolve('build/themes/columbina')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-columbina-'))
app.setPath('userData', path.join(temporary, 'user-data'))
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('force-device-scale-factor', '1')
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'easy-player-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
])

app.whenReady().then(async () => {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'))
    const packageName = fs
      .readdirSync(output)
      .filter((name) => name.startsWith(manifest.id + '-') && name.endsWith('.epp'))
      .sort(
        (a, b) =>
          fs.statSync(path.join(output, b)).mtimeMs - fs.statSync(path.join(output, a)).mtimeMs
      )[0]
    assert(packageName, 'Pack the theme before running this check')
    const packageFile = path.join(output, packageName)
    await esbuild.build({
      stdin: {
        contents:
          "export * from './src/main/plugins/packages';export * from './src/main/plugins/manager';export * from './src/main/sources/registry';export * from './src/main/plugins/themeProtocol'",
        resolveDir: process.cwd()
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      packages: 'external',
      outfile: path.join(output, 'check-host.cjs')
    })
    const {
      OfficialPluginPackages,
      PluginManager,
      SourceRegistry,
      themeResourceResponse
    } = require(path.join(output, 'check-host.cjs'))
    const manager = new PluginManager(new SourceRegistry(), {
      readSetting() {
        return undefined
      },
      writeSetting() {
        /* This isolated fixture does not write application preferences. */
      },
      log() {
        /* Validation failures are reported by assertions below. */
      },
      fetch() {
        throw Error('Unexpected network access')
      }
    })
    const packages = new OfficialPluginPackages(
      path.join(temporary, 'installed'),
      manager,
      {},
      { schemaVersion: 1, plugins: [] }
    )
    packages.initialize()
    await packages.installFile(packageFile, () => true)
    const theme = packages.listThemes().find((item) => item.pluginId === manifest.id)
    assert(theme, 'The third-party package installs and activates')
    assert.deepEqual(
      JSON.parse(JSON.stringify(theme.data)),
      JSON.parse(fs.readFileSync(path.join(source, 'theme.json'), 'utf8')),
      'The package matches its source'
    )
    const original = fs.readFileSync(path.join(source, 'image1.png'))
    const installed = packages.themeResource(theme.pluginId, theme.revision, 'image1.png')
    assert(
      installed && Buffer.from(installed).equals(original),
      'The original artwork and watermark are preserved byte for byte'
    )
    let imageRequests = 0
    protocol.handle('easy-player-media', (request) => {
      const url = new URL(request.url)
      if (url.pathname.endsWith('/image1.png')) imageRequests++
      return themeResourceResponse(url, (id, hash, file) => packages.themeResource(id, hash, file))
    })
    const styles = []
    const bundle = await esbuild.build({
      stdin: {
        contents: `export * as Vue from 'vue';export {createI18n} from 'vue-i18n';export {default as AppBackground} from './src/renderer/src/components/background/AppBackground.vue';export {pluginThemes,getSystemBackgroundTheme} from './src/renderer/src/components/background/systemBackgroundRegistry';export {resolveAppearance} from './src/renderer/src/services/appearance';export {applyAppearance,backgroundAppearanceHandoff} from './src/renderer/src/services/appearanceController';export {applyCustomTheme} from './src/renderer/src/services/customTheme';export {default as Button} from './src/renderer/src/components/ui/BaseButton.vue';export {default as Input} from './src/renderer/src/components/ui/BaseInput.vue';export {default as Select} from './src/renderer/src/components/ui/BaseSelect.vue';export {default as Range} from './src/renderer/src/components/ui/BaseRange.vue';export {default as Dialog} from './src/renderer/src/components/ui/BaseDialog.vue';export {default as zh} from './src/renderer/src/i18n/locales/zh';`,
        resolveDir: process.cwd()
      },
      bundle: true,
      write: false,
      format: 'iife',
      globalName: 'Moonveil',
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
          name: 'theme-check',
          setup(build) {
            build.onResolve({ filter: /stores[\\/]ui[\\/]uiStore(?:\.ts)?$/ }, () => ({
              path: 'ui',
              namespace: 'fixture'
            }))
            build.onResolve({ filter: /stores[\\/]player[\\/]playerStore(?:\.ts)?$/ }, () => ({
              path: 'player',
              namespace: 'fixture'
            }))
            build.onResolve({ filter: /useMessage(?:\.ts)?$/ }, () => ({
              path: 'message',
              namespace: 'fixture'
            }))
            build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: id }) => ({
              contents: {
                ui: 'export const useUIStore=()=>window.themeUI',
                player: 'export const usePlayerStore=()=>({currentQueueSong:null})',
                message:
                  'export const useMessage=()=>({error:message=>window.themeErrors.push(message)})'
              }[id],
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
            let serial = 0
            build.onLoad({ filter: /\.vue$/ }, ({ path: filename }) => {
              const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
              const id = 'moonveil-' + ++serial
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
                  compileScript(descriptor, {
                    id,
                    inlineTemplate: true,
                    genDefaultAs: '__sfc__',
                    fs: {
                      fileExists: fs.existsSync,
                      readFile: (file) => fs.readFileSync(file, 'utf8')
                    }
                  }).content +
                  '\n__sfc__.__scopeId="data-v-' +
                  id +
                  '";export default __sfc__;export const __esModule=true;',
                loader: 'ts',
                resolveDir: path.dirname(filename)
              }
            })
          }
        }
      ]
    })
    const css = fs.readdirSync('out/renderer/assets').find((name) => /^main-.*\.css$/.test(name))
    assert(css, 'Run npm run build first')
    const win = new BrowserWindow({
      show: false,
      width: 1440,
      height: 960,
      webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false }
    })
    const errors = []
    win.webContents.on('console-message', (event) => {
      if (event.level === 'error') {
        errors.push(event.message)
        console.error(event.message)
      }
    })
    const html = path.join(temporary, 'preview.html')
    const csp = fs
      .readFileSync('src/renderer/index.html', 'utf8')
      .match(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/)[0]
    fs.writeFileSync(
      html,
      '<!doctype html><html><head>' + csp + '</head><body><div id="app"></div></body></html>'
    )
    await win.loadFile(html)
    await win.webContents.insertCSS(
      fs.readFileSync(path.join('out/renderer/assets', css), 'utf8') +
        styles.join('\n') +
        `
      #app{height:100vh}.moon-shell{position:relative;height:100%;overflow:hidden;display:grid;grid-template-rows:64px minmax(0,1fr) 104px;color:var(--color-text)}
      .moon-header,.moon-body,.moon-footer{position:relative;z-index:2}.moon-header{display:flex;align-items:center;justify-content:space-between;padding:0 26px;gap:26px;border-bottom:1px solid var(--app-chrome-border)}
      .moon-brand{font-size:16px;font-weight:650;letter-spacing:.03em}.moon-brand small{font-size:12px;font-weight:400;margin-left:12px;color:var(--color-text-l)}.moon-search{width:300px}
      .moon-body{display:flex;min-height:0}.moon-sidebar{width:198px;flex-shrink:0;padding:32px 16px;border-right:1px solid var(--app-chrome-border)}
      .moon-nav{display:flex;align-items:center;gap:13px;margin-bottom:8px;padding:12px 14px;font-size:14px}.moon-nav i{font-style:normal;font-size:17px}
      .moon-sidebar h2{padding:30px 14px 12px;font-size:11px;letter-spacing:.18em;color:var(--color-text-l2)}
      .moon-main{flex:1;min-width:0;overflow:auto;padding:42px 36px}.moon-eyebrow{font-size:11px;letter-spacing:.24em;color:var(--color-primary)}.moon-main h1{font-size:36px;letter-spacing:.02em;font-weight:600;line-height:1.3;margin-top:14px}.moon-description{font-size:13px;line-height:1.9;margin-top:13px;color:var(--color-text-l)}
      .moon-column{width:min(440px,100%)}.moon-toolbar{display:flex;align-items:center;gap:10px;margin:28px 0}.moon-toolbar .ep-select{width:128px}
      .moon-card{padding:21px;border:1px solid color-mix(in srgb,var(--color-border) 54%,transparent);border-radius:18px;background:color-mix(in srgb,var(--color-bg-l) 82%,transparent);box-shadow:0 12px 36px rgb(4 9 24 / 12%)}
      .moon-card h2{font-size:16px;font-weight:600}.moon-note{font-size:12px;line-height:1.7;color:var(--color-text-l2)}.moon-songs{margin-top:16px}.moon-song{display:grid;grid-template-columns:30px 1fr auto;align-items:center;gap:12px;padding:13px 0;border-top:1px solid color-mix(in srgb,var(--color-border) 25%,transparent)}.moon-song-cover{width:30px;height:30px;border-radius:7px;background:linear-gradient(140deg,#61728e,#3b365d)}.moon-song:nth-child(2n) .moon-song-cover{background:linear-gradient(140deg,#829fae,#4f627b)}.moon-song strong{display:block;font-size:13px;font-weight:500}.moon-song p,.moon-time{font-size:11px;margin-top:3px;color:var(--color-text-l2)}
      .moon-bottom-note{margin-top:22px;font-size:11px;letter-spacing:.09em;color:var(--color-text-l2)}.moon-footer{padding:0 18px 16px}.moon-footer .ep-footer{height:88px;border:1px solid var(--app-chrome-border);border-radius:24px;padding:18px 22px;display:grid;grid-template-columns:1fr 1.4fr 1fr;align-items:center;gap:30px}.moon-track{display:flex;gap:14px;align-items:center}.moon-track-cover{width:48px;height:48px;border-radius:12px;background:linear-gradient(140deg,#afb5db,#57587f);display:grid;place-items:center;color:#172137;font-size:24px}.moon-track strong{font-size:13px}.moon-transport{display:flex;align-items:center;justify-content:center;gap:24px}.moon-transport button{border-radius:50%}.moon-progress{width:100%;margin-top:10px;height:10px}.moon-footer-actions{display:flex;justify-content:flex-end;align-items:center;gap:12px}
      .moon-dialog-copy{font-size:14px;line-height:1.8;color:var(--color-text-l)}.moon-dialog-actions{display:flex;gap:10px;justify-content:flex-end}.moon-dialog-preview{padding:16px;border:1px solid var(--color-border);border-radius:12px;background:var(--color-bg-l2);margin-top:16px}
      @media(max-width:1000px){.moon-sidebar{width:160px}.moon-main{padding:30px 24px}.moon-column{width:min(390px,100%)}.moon-footer .ep-footer{grid-template-columns:1fr 1fr;gap:20px}.moon-footer-actions{display:none}.moon-main h1{font-size:29px}.moon-brand small{display:none}}
      @media(max-width:700px){.moon-sidebar{width:68px;padding:24px 8px}.moon-nav{padding:10px;justify-content:center}.moon-nav span,.moon-sidebar h2,.moon-sidebar .moon-playlist{display:none}.moon-search{display:none}.moon-main{padding:26px 18px}.moon-header{padding:0 18px}.moon-header .ep-button--ghost{display:none}.moon-main h1{font-size:25px}.moon-description{font-size:12px}.moon-footer .ep-footer{padding:14px;gap:12px}.moon-track-cover{width:38px;height:38px}.moon-transport{gap:13px}.moon-track{gap:9px}.moon-track .moon-note{font-size:10px}}
    `
    )
    await win.webContents.executeJavaScript(bundle.outputFiles[0].text)
    await win.webContents.executeJavaScript(`window.installedMoonveil=${JSON.stringify(theme)}`)
    await win.webContents.executeJavaScript(`(async()=>{
      const {Vue,createI18n,AppBackground,pluginThemes,getSystemBackgroundTheme,resolveAppearance,applyAppearance,applyCustomTheme,backgroundAppearanceHandoff,Button,Input,Select,Range,Dialog,zh}=Moonveil;
      const {h,ref,reactive,computed,watch,nextTick,createApp}=Vue;window.themeErrors=[];pluginThemes.value=[window.installedMoonveil];
      const dark=ref(true),contrast=ref(true),dialog=ref(false);const id='plugin:'+installedMoonveil.pluginId;
      const preferences=computed(()=>({colorMode:dark.value?'dark':'light',background:{type:'preset',id},accentSource:'auto',accentColor:'#b8b5f6',themeBackgroundEnabled:true,customChrome:{header:'#142135',footer:'#1c283e',border:'#536682'}}));
      const themeStyle=computed(()=>dark.value?{version:1,name:installedMoonveil.displayName,background:'inherit',tokens:installedMoonveil.data.tokens??{},rules:installedMoonveil.data.rules??{},plugin:installedMoonveil}:undefined);
      const appearance=computed(()=>resolveAppearance(preferences.value,{systemDark:dark.value,material:'none',scene:getSystemBackgroundTheme(id),songColor:null,theme:themeStyle.value}));
      window.themeUI=reactive({reduceMotion:true,showPlayer:false,accentSource:'auto',songThemeColor:null,effectiveCustomThemeName:'',customBg:{url:''},getBackgroundStyle:{},getBackgroundFilter:'none',get backgroundTheme(){return themeStyle.value},get activeThemeColor(){return appearance.value.accentColor},get resolvedAppearance(){return appearance.value}});
      watch([appearance,themeStyle],()=>backgroundAppearanceHandoff.stage('preset:'+id+':'+installedMoonveil.revision,()=>{document.documentElement.classList.add('reduce-motion');applyAppearance(appearance.value,document.documentElement);applyCustomTheme(themeStyle.value??null)}),{immediate:true,flush:'post'});
      const probe=(text,role='text',className='')=>h('span',{'data-contrast':role,class:className},text);
      const primary=(label,props={})=>h(Button,{variant:'primary',...props},()=>probe(label,'primary'));
      const navigation=[['⌂','首页'],['♫','歌曲'],['◎','歌手'],['▤','专辑'],['♡','喜欢的歌曲']];
      const songs=[['Moonlit Reverie','Piano · Ambient','04:26'],['Velvet Nocturne','Instrumental · Nightfall','03:48'],['A Feather in the Wind','Orchestra · Reverie','05:12'],['The Quiet Between Stars','Piano · Lullaby','04:03']];
      createApp({render:()=>h('div',{class:'app-layout moon-shell','data-background-contrast':!appearance.value.dark&&contrast.value?'dark':undefined},[
        h(AppBackground,{onContrast:value=>{contrast.value=value}}),
        h('header',{class:'ep-header moon-header'},[h('div',{class:'moon-brand'},[probe('Easy Player','header'),h('small',{},probe('MOONVEIL','header secondary'))]),h('div',{class:'moon-search'},[h(Input,{modelValue:'',placeholder:'搜索音乐、歌手与歌单',clearable:false})]),h(Button,{variant:'ghost',onClick:()=>{dialog.value=true}},()=>probe('主题配色','header action'))]),
        h('div',{class:'moon-body'},[h('aside',{class:'ep-sidebar moon-sidebar'},[...navigation.map(([icon,label],index)=>h('div',{class:'ep-sidebar-item moon-nav'+(!index?' ep-sidebar-item--active':'')},[h('i',{},icon),probe(label,'navigation')])),h('h2',{},probe('MY COLLECTION','sidebar secondary')),...['月光与回声','夜色漫游','纯音乐收藏'].map(name=>h('div',{class:'moon-nav moon-playlist'},[h('i',{},'◈'),probe(name,'playlist')]))]),
        h('main',{class:'ep-home moon-main'},[h('div',{class:'moon-column'},[h('div',{class:'moon-eyebrow'},probe('COLUMBINA / MOONVEIL','eyebrow')),h('h1',{},probe('月色落下，旋律渐起。','heading')),h('p',{class:'moon-description'},probe(installedMoonveil.data.assets.text.homeWelcome,'description')),h('div',{class:'moon-toolbar'},[primary('▶  播放全部'),h(Select,{modelValue:'default',options:[{label:'默认排序',value:'default'},{label:'按名称',value:'title'}],size:'sm',teleport:true})]),h('section',{class:'moon-card'},[h('h2',{},probe('月光与回声','card heading')),h('p',{class:'moon-note'},probe('4 首歌曲 · 留给安静时刻','card auxiliary')),h('div',{class:'moon-songs'},songs.map(([title,artist,time])=>h('div',{class:'moon-song'},[h('div',{class:'moon-song-cover'}),h('div',{},[h('strong',{},probe(title,'song title')),h('p',{},probe(artist,'song auxiliary'))]),h('span',{class:'moon-time'},probe(time,'duration'))])))]),h('p',{class:'moon-bottom-note'},probe('MOONLIGHT IN EVERY NOTE','page auxiliary'))])])]),
        h('footer',{class:'moon-footer'},[h('div',{class:'ep-footer'},[h('div',{class:'moon-track'},[h('div',{class:'moon-track-cover'},'♫'),h('div',{},[h('strong',{},probe('Moonlit Reverie','footer title')),h('p',{class:'moon-note'},probe('Piano · Ambient','footer auxiliary'))])]),h('div',{},[h('div',{class:'moon-transport'},[h(Button,{variant:'ghost',size:'sm'},()=>probe('◀','transport')),primary('Ⅱ',{size:'lg'}),h(Button,{variant:'ghost',size:'sm'},()=>probe('▶','transport'))]),h(Range,{modelValue:36,class:'moon-progress'})]),h('div',{class:'moon-footer-actions'},[probe('01:36 / 04:26','footer time'),h(Button,{variant:'ghost',size:'sm',onClick:()=>{dialog.value=true}},()=>probe('更多','footer action'))])])]),
        h(Dialog,{modelValue:dialog.value,title:'月纱 · 主题配色',width:'max-w-md','onUpdate:modelValue':value=>{dialog.value=value}},{default:()=>[h('p',{class:'moon-dialog-copy'},probe('月白文字、冷蓝表面与淡紫强调色，让旋律与画面保持安静而清晰。','dialog text')),h('div',{class:'moon-dialog-preview'},[h('p',{class:'moon-note'},probe('菜单、弹窗和输入控件使用同一套语义配色。','dialog auxiliary')),h(Input,{modelValue:'Moonveil',clearable:false})])],footer:()=>h('div',{class:'moon-dialog-actions'},[h(Button,{variant:'danger'},()=>probe('危险操作','danger')),primary('继续聆听',{onClick:()=>{dialog.value=false}})])})
      ])}).mixin({errorCaptured(error){console.error(error.stack)}}).use(createI18n({legacy:false,locale:'zh',messages:{zh},missingWarn:false,fallbackWarn:false})).mount('#app');
      const paint=async()=>{await nextTick();await new Promise(resolve=>setTimeout(resolve,80));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))};
      window.previewMode=async(value)=>{dark.value=value;await paint()};
      window.previewDialog=async(value)=>{dialog.value=value;await paint()};window.paintPreview=paint;
      window.getProbes=()=>{const context=document.createElement('canvas').getContext('2d');const selector=dialog.value?'.ep-dialog-panel [data-contrast]':document.querySelector('.ep-select-options')?'.ep-select-options [data-contrast]':'[data-contrast]';return [...document.querySelectorAll(selector)].map(node=>{const style=getComputedStyle(node);context.clearRect(0,0,1,1);context.fillStyle=style.color;context.fillRect(0,0,1,1);const rect=node.getBoundingClientRect();return {role:node.dataset.contrast,text:node.textContent,color:[...context.getImageData(0,0,1,1).data],x:rect.x,y:rect.y,width:rect.width,height:rect.height}}).filter(item=>item.width>0&&item.height>0&&item.x>=0&&item.y>=0&&item.x+item.width<innerWidth&&item.y+item.height<innerHeight)};
      window.hideProbeText=async(hidden)=>{document.getElementById('probe-text-hidden')?.remove();if(hidden){const style=document.createElement('style');style.id='probe-text-hidden';style.textContent='[data-contrast],[data-contrast] *{color:transparent!important}';document.head.append(style)}await paint()};
      await nextTick();const image=new Image();image.src='easy-player-media://plugin-theme/'+installedMoonveil.pluginId+'/'+installedMoonveil.revision+'/image1.png';await image.decode();window.artworkSize={width:image.naturalWidth,height:image.naturalHeight};
      const deadline=performance.now()+5000;while(!document.querySelector('.ep-app-background')){if(performance.now()>deadline)throw Error('Background host did not mount: '+document.querySelector('#app').innerHTML.slice(0,1200));await new Promise(resolve=>requestAnimationFrame(resolve))}
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    })()`)
    const checks = [
      'The .epp installs as a third-party theme',
      'Installed declarations match the source',
      'The supplied PNG remains byte-identical'
    ]
    const contrastSamples = []
    const luminance = (color) =>
      color
        .map((value) => {
          value /= 255
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
        })
        .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
    async function checkContrast(label) {
      const probes = await win.webContents.executeJavaScript('window.getProbes()')
      await win.webContents.executeJavaScript('window.hideProbeText(true)')
      const background = await win.webContents.capturePage()
      const size = background.getSize()
      const pixels = background.toBitmap()
      await win.webContents.executeJavaScript('window.hideProbeText(false)')
      for (const probe of probes) {
        let minimum = Infinity
        const alpha = probe.color[3] / 255
        for (
          let y = Math.ceil(probe.y + 2);
          y < Math.min(size.height, Math.floor(probe.y + probe.height - 2));
          y += 3
        )
          for (
            let x = Math.ceil(probe.x + 1);
            x < Math.min(size.width, Math.floor(probe.x + probe.width - 1));
            x += 3
          ) {
            const offset = (y * size.width + x) * 4
            const bg = [pixels[offset + 2], pixels[offset + 1], pixels[offset]]
            const fg = probe.color
              .slice(0, 3)
              .map((value, index) => value * alpha + bg[index] * (1 - alpha))
            const a = luminance(fg),
              b = luminance(bg)
            minimum = Math.min(minimum, (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05))
          }
        if (Number.isFinite(minimum)) {
          contrastSamples.push({
            view: label,
            role: probe.role,
            text: probe.text,
            ratio: +minimum.toFixed(2)
          })
          assert(
            minimum >= 4.5,
            label +
              ' / ' +
              probe.role +
              ' / ' +
              probe.text +
              ': ' +
              minimum.toFixed(2) +
              ' ' +
              JSON.stringify(probe)
          )
        }
      }
    }
    const background = await win.webContents.executeJavaScript(
      `({image:getComputedStyle(document.querySelector('.ep-app-background')).backgroundImage,size:window.artworkSize,errors:window.themeErrors,dark:document.documentElement.classList.contains('dark')})`
    )
    assert(
      background.image.includes('/image1.png'),
      'The real background host displays the installed illustration'
    )
    assert.deepEqual(background.size, {
      width: original.readUInt32BE(16),
      height: original.readUInt32BE(20)
    })
    assert.equal(background.dark, true)
    checks.push(
      'The original full-resolution image decodes and paints in the real background renderer'
    )
    fs.writeFileSync(
      path.join(output, 'preview-dark.png'),
      (await win.webContents.capturePage()).toPNG()
    )
    await checkContrast('dark')
    await win.webContents.executeJavaScript('window.previewDialog(true)')
    fs.writeFileSync(
      path.join(output, 'preview-dialog.png'),
      (await win.webContents.capturePage()).toPNG()
    )
    await checkContrast('dark dialog')
    await win.webContents.executeJavaScript('window.previewDialog(false)')
    await win.webContents.executeJavaScript(`document.querySelector('.ep-select').click()`)
    // Open Headless UI's real teleported dropdown, then allow its first layout pass.
    await win.webContents.executeJavaScript(
      `new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`
    )
    const menu = await win.webContents.executeJavaScript(
      `({open:!!document.querySelector('.ep-select-options'),background:document.querySelector('.ep-select-options')&&getComputedStyle(document.querySelector('.ep-select-options')).backgroundColor})`
    )
    assert(menu.open, 'The teleported select opens')
    await win.webContents.executeJavaScript(
      `document.querySelectorAll('.ep-select-option').forEach(node=>node.dataset.contrast='select option')`
    )
    await win.webContents.executeJavaScript('window.paintPreview()')
    fs.writeFileSync(
      path.join(output, 'preview-menu.png'),
      (await win.webContents.capturePage()).toPNG()
    )
    await checkContrast('dropdown')
    checks.push('A real dialog and teleported dropdown use the authored component surfaces')
    await win.webContents.executeJavaScript(`document.querySelector('.ep-select').click()`)
    await win.webContents.executeJavaScript('window.previewMode(false)')
    const light = await win.webContents.executeJavaScript(
      `({dark:document.documentElement.classList.contains('dark'),image:getComputedStyle(document.querySelector('.ep-app-background')).backgroundImage,scrim:!!document.querySelector('.app-background-scrim')})`
    )
    assert.equal(light.dark, false)
    assert(!light.image.includes('/image1.png'))
    assert.equal(light.scrim, false)
    fs.writeFileSync(
      path.join(output, 'preview-light-fallback.png'),
      (await win.webContents.capturePage()).toPNG()
    )
    await checkContrast('light fallback')
    checks.push(
      'Light mode keeps its saved mode, drops design-specific assets and uses the declared gradient fallback without a white veil'
    )
    await win.webContents.executeJavaScript('window.previewMode(true)')
    win.setContentSize(680, 900)
    await win.webContents.executeJavaScript(
      `new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`
    )
    fs.writeFileSync(
      path.join(output, 'preview-compact.png'),
      (await win.webContents.capturePage()).toPNG()
    )
    await checkContrast('compact')
    checks.push('Header, sidebar, primary controls and content remain readable in a compact window')
    assert.equal((await win.webContents.executeJavaScript('window.themeErrors')).length, 0)
    assert.equal(errors.length, 0, errors.join('\n'))
    assert(imageRequests > 0)
    const alias = path.join(output, 'Columbina-Moonveil.epp')
    fs.copyFileSync(packageFile, alias)
    const report = {
      passed: checks.length,
      checks,
      package: packageName,
      sha256: createHash('sha256').update(fs.readFileSync(packageFile)).digest('hex'),
      bytes: fs.statSync(packageFile).size,
      contrastSamples: contrastSamples.length,
      minimumContrast: Math.min(...contrastSamples.map((sample) => sample.ratio)),
      samples: contrastSamples,
      imageRequests
    }
    fs.writeFileSync(path.join(output, 'validation.json'), JSON.stringify(report, null, 2) + '\n')
    console.log(
      JSON.stringify(
        {
          passed: report.passed,
          package: report.package,
          bytes: report.bytes,
          contrastSamples: report.contrastSamples,
          minimumContrast: report.minimumContrast,
          previews: output
        },
        null,
        2
      )
    )
    win.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
