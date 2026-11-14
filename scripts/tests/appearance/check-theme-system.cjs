/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const AdmZip = require('adm-zip')
const esbuild = require('esbuild')
const { parse, compileScript, compileStyle } = require('@vue/compiler-sfc')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ep-theme-system-')))
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  try {
    const styles = []
    const bundle = await esbuild.build({
      stdin: {
        contents: `export * as Vue from 'vue';export {createI18n} from 'vue-i18n';
          export {resolveAppearance} from './src/renderer/src/services/appearance';
          export {applyAppearance} from './src/renderer/src/services/appearanceController';
          export {applyCustomTheme} from './src/renderer/src/services/customTheme';
          export {systemBackgroundThemes} from './src/renderer/src/components/background/systemBackgroundRegistry';
          export {default as Button} from './src/renderer/src/components/ui/BaseButton.vue';
          export {default as Input} from './src/renderer/src/components/ui/BaseInput.vue';
          export {default as Select} from './src/renderer/src/components/ui/BaseSelect.vue';
          export {default as Switch} from './src/renderer/src/components/ui/BaseSwitch.vue';
          export {default as Range} from './src/renderer/src/components/ui/BaseRange.vue';
          export {default as Mini} from './src/renderer/src/views/player/mini/Index.vue';`,
        resolveDir: process.cwd()
      },
      bundle: true,
      write: false,
      format: 'iife',
      globalName: 'Audit',
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
          name: 'audit-vue',
          setup(build) {
            build.onResolve({ filter: /windowReady(?:\.ts)?$/ }, () => ({
              path: 'ready',
              namespace: 'fixture'
            }))
            build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
              contents: 'export const notifyWindowReady=async()=>{}',
              loader: 'js'
            }))
            build.onLoad({ filter: /\.glsl$/ }, ({ path: filename }) => ({
              contents: 'export default ' + JSON.stringify(fs.readFileSync(filename, 'utf8')),
              loader: 'js'
            }))
            let index = 0
            build.onLoad({ filter: /\.vue$/ }, ({ path: filename }) => {
              const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
              const id = 'audit-' + ++index
              for (const style of descriptor.styles)
                styles.push(
                  compileStyle({
                    source: style.content,
                    filename,
                    id: 'data-v-' + id,
                    scoped: style.scoped
                  }).code
                )
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
    const catalog = JSON.parse(fs.readFileSync('resources/plugins/catalog.json', 'utf8'))
    const scenes = catalog.plugins
      .filter((plugin) => plugin.kind === 'theme')
      .map((plugin) => {
        const file = path.join('build/plugins', new URL(plugin.url).pathname.split('/').at(-1))
        return {
          id: 'plugin:' + plugin.id,
          ...JSON.parse(new AdmZip(file).readAsText('theme.json'))
        }
      })
    const css = fs.readdirSync('out/renderer/assets').find((name) => /^main-.*\.css$/.test(name))
    const win = new BrowserWindow({
      show: false,
      width: 1180,
      height: 810,
      webPreferences: { sandbox: true, backgroundThrottling: false }
    })
    await win.loadURL('data:text/html,<div id="app"></div>')
    await win.webContents.insertCSS(
      fs.readFileSync(path.join('out/renderer/assets', css), 'utf8') +
        styles.join('\n') +
        `
      #app{height:100vh}.audit-page{height:100%;display:grid;grid-template-rows:62px 1fr 90px;background:var(--color-bg);color:var(--color-text)}
      .audit-header,.audit-footer{padding:16px 28px;display:flex;align-items:center;justify-content:space-between;gap:16px}
      .audit-body{display:grid;grid-template-columns:180px 1fr;min-height:0}.audit-sidebar{padding:28px 16px;border-right:1px solid var(--color-border)}
      .audit-content{padding:28px;display:grid;gap:20px;align-content:start}.audit-card{padding:22px;border:1px solid var(--color-border);border-radius:16px;background:var(--color-bg-l)}
      .audit-row{display:flex;align-items:center;gap:14px;margin-top:16px}.audit-muted{color:var(--color-text-l)}.audit-aux{color:var(--color-text-l2)}
      .audit-business{padding:6px 14px;border-radius:6px;font-size:14px}.audit-status{display:flex;gap:20px;margin-top:18px}.audit-select{width:180px}
    `
    )
    await win.webContents.executeJavaScript(bundle.outputFiles[0].text)
    await win.webContents.executeJavaScript(`window.scenes=${JSON.stringify(scenes)}`)
    const result = await win.webContents.executeJavaScript(`(async()=>{
      const {Vue,createI18n,Button,Input,Select,Switch,Range,resolveAppearance,applyAppearance,applyCustomTheme,systemBackgroundThemes}=Audit;
      const {h,ref,createApp,nextTick}=Vue;const root=document.documentElement;root.classList.add('reduce-motion');
      const appearance=ref();let application;const i18n=createI18n({legacy:false,locale:'zh',messages:{zh:{common:{clear:'清除'},ui:{selectPlaceholder:'选择'}}}});
      const choices=[{label:'默认排序',value:'default'},{label:'按名称',value:'title'}];
      const buttons=()=>[h(Button,{variant:'primary','data-probe':'primary'},()=> '主要操作'),h(Button,{variant:'secondary','data-probe':'secondary'},()=> '次要操作'),h(Button,{variant:'danger','data-probe':'danger'},()=> '删除'),h('button',{class:'ep-button--primary audit-business','data-probe':'business'},'保存')];
      application=createApp({render:()=>h('div',{class:'app-layout audit-page','data-background-contrast':!appearance.value?.dark&&appearance.value?.contentDark?'dark':undefined},[
        h('header',{class:'ep-header audit-header'},[h('strong',{},'Easy Player · 外观检查'),h('div',{class:'audit-row'},buttons())]),
        h('div',{class:'audit-body'},[h('aside',{class:'ep-sidebar audit-sidebar'},[h('p',{class:'ep-sidebar-item ep-sidebar-item--active'},'音乐库'),h('p',{class:'audit-muted'},'歌单与收藏')]),h('main',{class:'audit-content'},[
          h('div',{},[h('h1',{style:'font-size:28px;font-weight:600'},'音乐与日常'),h('p',{class:'audit-muted'},'统一的表面、文字和交互配色')]),
          h('section',{class:'audit-card'},[h('h2',{},'基础组件'),h('p',{class:'audit-muted'},'次级文字 / 歌手与专辑'),h('p',{class:'audit-aux'},'辅助说明 / 年份与播放次数'),h('div',{class:'audit-row'},buttons()),h('div',{class:'audit-row'},[h(Input,{modelValue:'搜索音乐',clearable:false}),h(Select,{class:'audit-select',modelValue:'default',options:choices,teleport:true})]),h('div',{class:'audit-row'},[h(Switch,{modelValue:true}),h(Switch,{modelValue:false}),h(Range,{modelValue:36})]),h('div',{class:'audit-status'},[h('span',{class:'text-success','data-status':'success'},'扫描完成'),h('span',{class:'text-warning','data-status':'warning'},'连接提示'),h('span',{class:'text-danger','data-status':'danger'},'操作失败')])]),
          h('section',{class:'audit-card'},[h('h2',{},'列表与信息'),h('p',{class:'audit-muted'},'弹窗和菜单使用当前明暗模式的配色')])
        ])]),h('footer',{class:'ep-footer audit-footer'},[h('div',{},[h('strong',{},'歌曲名称'),h('p',{class:'audit-muted'},'歌手 · 专辑')]),...buttons()])
      ])}).use(i18n);application.mount('#app');await nextTick();
      const ctx=document.createElement('canvas').getContext('2d');const rgb=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].map((v,i)=>i===3?v/255:v)};
      const over=(fg,bg)=>fg.map((v,i)=>i===3?1:v*fg[3]+bg[i]*(1-fg[3]));
      const surface=node=>{const chain=[];for(let item=node;item;item=item.parentElement)chain.unshift(item);return chain.reduce((bg,item)=>over(rgb(getComputedStyle(item).backgroundColor),bg),[255,255,255,1])};
      const lum=color=>{const c=color.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return c[0]*.2126+c[1]*.7152+c[2]*.0722};
      const contrast=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
      const samples=[],failures=[];const check=(name,node,minimum=4.5,background)=>{const bg=background?over(rgb(background),surface(node.parentElement)):surface(node),ratio=contrast(over(rgb(getComputedStyle(node).color),bg),bg);const sample={scenario:window.scenario,name,ratio:+ratio.toFixed(2)};samples.push(sample);if(ratio<minimum)failures.push(sample)};
      const hover=()=>{for(const node of document.querySelectorAll('[data-probe=primary],[data-probe=business],[data-probe=danger]')){const type=node.dataset.probe==='danger'?'danger':'primary';check(type+' hover',node,4.5,getComputedStyle(node).getPropertyValue('--btn-'+type+'-bg-hover'))}};
      const set=async(mode,scene,material='none',systemDark=mode==='dark',songColor=null)=>{
        window.scenario=mode+'/'+scene.id+'/'+material+'/'+songColor+'/system-'+systemDark;const theme=scene.tokens&&scene.colorMode===mode?{version:1,name:scene.id,background:'inherit',tokens:scene.tokens,rules:scene.rules??{}}:undefined;
        appearance.value=resolveAppearance({colorMode:mode,background:{type:scene.id==='none'?'none':'preset',id:scene.id},accentSource:'auto',accentColor:'#03bb4d',themeBackgroundEnabled:true,customChrome:{header:'#0f1724cc',footer:'#101827d9',border:'#ffffff30'}},{systemDark,material,scene,songColor,theme});
        applyAppearance(appearance.value,root);applyCustomTheme(theme??null);await nextTick();return appearance.value;
      };
      window.auditSet=async(mode,id)=>{await set(mode,[...systemBackgroundThemes,...window.scenes].find(scene=>scene.id===id));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return window.scenario};
      for(const mode of ['light','dark'])for(const scene of [...systemBackgroundThemes,...window.scenes]){
        await set(mode,scene);for(const selector of ['.audit-card h2','.audit-card .audit-muted','.audit-card .audit-aux','.ep-header strong','.ep-footer strong','.ep-footer .audit-muted','[data-status=success]','[data-status=warning]','[data-status=danger]',...['primary','secondary','danger','business'].map(name=>'[data-probe='+name+']')])for(const node of document.querySelectorAll(selector))check(selector,node);
        hover();
        document.querySelector('.ep-select').click();await nextTick();await new Promise(resolve=>requestAnimationFrame(resolve));for(const node of document.querySelectorAll('.ep-select-option'))check('select option',node);document.querySelector('.ep-select').click();await nextTick();
      }
      for(const color of ['rgb(0 0 0)','rgb(255 255 255)','rgb(255 0 0)','rgb(0 255 0)','rgb(0 0 255)'])for(const mode of ['light','dark']){await set(mode,systemBackgroundThemes.find(scene=>scene.id==='solid'),'none',mode==='dark',color);for(const node of document.querySelectorAll('[data-probe],.audit-aux,[data-status]'))check('artwork '+(node.dataset.probe??node.dataset.status??'auxiliary'),node);hover()}
      for(const mode of ['light','dark'])for(const systemDark of [false,true])for(const material of ['mica','acrylic','vibrancy']){await set(mode,systemBackgroundThemes[0],material,systemDark);for(const node of document.querySelectorAll('.audit-card p,[data-probe]'))check('native controls',node)}
      window.auditMini=async()=>{applyCustomTheme(null);application.unmount();root.className='reduce-motion';
      let miniUpdate;window.api={miniPlayer:{onUpdate:callback=>{miniUpdate=callback;return()=>{}},ready(){},action(){},restore(){} }};
      const mini=createApp(Audit.Mini).use(i18n);mini.mount('#app');miniUpdate({title:'歌曲名称',artist:'歌手',theme:{dark:false,background:'solid',accent:'#1d542c',fill:'rgb(32 204 100)',border:null,backgroundSurface:'rgb(171 191 176)'}});await nextTick();
      const miniValid=CSS.supports('color',getComputedStyle(root).getPropertyValue('--color-bg'))&&getComputedStyle(document.querySelector('.mini-surface')).backgroundImage.includes('radial-gradient');
      mini.unmount();return miniValid};
      return {scenarios:new Set(samples.map(sample=>sample.scenario)).size,samples:samples.length,failures,minimums:Object.fromEntries(['light','dark'].map(mode=>[mode,Math.min(...samples.filter(sample=>sample.scenario.startsWith(mode+'/')).map(sample=>sample.ratio))]))};
    })()`)
    for (const [mode, id] of [
      ['light', 'none'],
      ['dark', 'none'],
      ['light', 'solid'],
      ['dark', 'solid'],
      ['light', 'plugin:builtin.theme.rainy'],
      ['dark', 'plugin:builtin.theme.aurora']
    ]) {
      await win.webContents.executeJavaScript(
        `window.auditSet(${JSON.stringify(mode)},${JSON.stringify(id)})`
      )
      fs.writeFileSync(
        'build/theme-system-' + mode + '-' + id.replace('plugin:builtin.theme.', '') + '.png',
        (await win.webContents.capturePage()).toPNG()
      )
    }
    result.miniValid = await win.webContents.executeJavaScript('window.auditMini()')
    if (!result.miniValid)
      result.failures.push({
        scenario: 'mini/light/solid',
        name: 'missing song material',
        ratio: 0
      })
    fs.writeFileSync('build/theme-system-audit.json', JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result, null, 2))
    win.destroy()
    app.exit(result.failures.length ? 1 : 0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
