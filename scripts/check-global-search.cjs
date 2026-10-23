/* eslint-disable @typescript-eslint/no-require-imports */
// Exercise the real header, search host, dialog, results and shortcut handler.
// IPC and stores use isolated fixtures; no user library or playback is modified.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const esbuild = require('esbuild')
const { parse, compileScript } = require('@vue/compiler-sfc')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ep-global-search-')))
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  try {
    const styles = []
    const bundle = await esbuild.build({
      stdin: {
        contents: `import * as Vue from 'vue'; import {createI18n} from 'vue-i18n';
          import {createRouter,createMemoryHistory} from 'vue-router'; import Scroller from 'vue-virtual-scroller';
          import Header from './src/renderer/src/views/layout/header/Index.vue';
          import Host from './src/renderer/src/components/search/GlobalSearchHost.vue';
          import SvgIcon from './src/renderer/src/components/svg/SvgIcon.vue';
          import {useShortcuts} from './src/renderer/src/hooks/useShortcuts';
          import {DEFAULT_LOCAL_SHORTCUTS,DEFAULT_GLOBAL_SHORTCUTS} from './src/shared/shortcuts';
          import zh from './src/renderer/src/i18n/locales/zh';
          export {Vue,createI18n,createRouter,createMemoryHistory,Scroller,Header,Host,SvgIcon,useShortcuts,zh,DEFAULT_LOCAL_SHORTCUTS,DEFAULT_GLOBAL_SHORTCUTS};`,
        resolveDir: process.cwd()
      },
      bundle: true,
      platform: 'browser',
      format: 'iife',
      globalName: 'SearchCheck',
      write: false,
      define: {
        __VUE_OPTIONS_API__: 'true',
        __VUE_PROD_DEVTOOLS__: 'false',
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
        __APP_VERSION__: '"test"',
        __APP_BUILD__: '"0"'
      },
      alias: {
        vue: require.resolve('vue/dist/vue.esm-bundler.js'),
        '@': path.resolve('src/renderer/src')
      },
      plugins: [
        {
          name: 'search-fixtures',
          setup(build) {
            build.onResolve({ filter: /[\\/]router(?:[\\/]index(?:\.ts)?)?$/ }, () => ({
              path: 'router',
              namespace: 'fixture-router'
            }))
            build.onLoad({ filter: /.*/, namespace: 'fixture-router' }, () => ({
              contents: 'export default {push:(...args)=>window.searchRouter.push(...args)}',
              loader: 'js'
            }))
            build.onResolve(
              {
                filter:
                  /[\\/]stores[\\/](?:ui[\\/]uiStore|player[\\/]playerStore|statistics[\\/]statisticsStore)(?:\.ts)?$/
              },
              ({ path: file }) => ({ path: file, namespace: 'fixture-store' })
            )
            build.onLoad({ filter: /.*/, namespace: 'fixture-store' }, ({ path: file }) => ({
              contents: /uiStore/.test(file)
                ? 'export const useUIStore=()=>window.searchUi;'
                : /playerStore/.test(file)
                  ? 'export const usePlayerStore=()=>window.searchPlayer;'
                  : 'export const useStatisticsStore=()=>({enabled:true,generation:0});',
              loader: 'js'
            }))
            build.onResolve(
              { filter: /(?:SearchIndexStatus|ScanProgress|AudioControlPanelV2)\.vue$/ },
              ({ path: file }) => ({ path: file, namespace: 'unrelated-feature' })
            )
            build.onLoad({ filter: /.*/, namespace: 'unrelated-feature' }, () => ({
              contents: 'export default {render:()=>null}',
              loader: 'js'
            }))
            build.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }))
            build.onLoad({ filter: /\.vue$/ }, ({ path: file }) => {
              const { descriptor } = parse(fs.readFileSync(file, 'utf8'), { filename: file })
              descriptor.styles.forEach((style) => styles.push(style.content))
              return {
                contents: compileScript(descriptor, {
                  id: file,
                  inlineTemplate: true,
                  fs: {
                    fileExists: fs.existsSync,
                    readFile: (filename) => fs.readFileSync(filename, 'utf8')
                  }
                  // Esbuild's IIFE namespace lacks the native ESM marker that Vue's
                  // async loader uses to unwrap a default export in production.
                }).content.replace(
                  "import('./GlobalSearchDialog.vue')",
                  "import('./GlobalSearchDialog.vue').then(module => module.default)"
                ),
                loader: 'ts',
                resolveDir: path.dirname(file)
              }
            })
          }
        }
      ]
    })
    const window = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: { sandbox: true, offscreen: true, backgroundThrottling: false }
    })
    const errors = []
    window.webContents.on('console-message', (event) => {
      if (event.level === 'error') {
        errors.push(event.message)
        console.error(event.message)
      } else if (event.message.includes('[Vue warn]')) console.warn(event.message)
    })
    const fixture = path.join(app.getPath('userData'), 'search.html')
    fs.writeFileSync(fixture, '<html><body><div id="app"></div></body></html>')
    await window.loadFile(fixture)
    const sprite = fs
      .readdirSync('src/renderer/src/assets/svg', { recursive: true })
      .filter((file) => file.endsWith('.svg'))
      .map((file) =>
        fs
          .readFileSync(path.join('src/renderer/src/assets/svg', file), 'utf8')
          .replace(/\s(?:width|height)="[^"]*"/g, '')
          .replace(
            /<svg\b([^>]*)>/,
            `<symbol $1 id="icon-${file
              .replace(/\\/g, '/')
              .replace(/\.svg$/, '')
              .replace(/\//g, '-')}">`
          )
          .replace('</svg>', '</symbol>')
      )
      .join('')
    await window.webContents.executeJavaScript(
      `document.body.insertAdjacentHTML('beforeend',${JSON.stringify('<svg style="display:none">' + sprite + '</svg>')});void 0;`
    )
    const cssFile = fs
      .readdirSync('out/renderer/assets')
      .find((file) => /^main-.*\.css$/.test(file))
    const css =
      fs.readFileSync(path.join('out/renderer/assets', cssFile), 'utf8') +
      fs.readFileSync(
        require.resolve('vue-virtual-scroller/dist/vue-virtual-scroller.css'),
        'utf8'
      ) +
      styles.join('\n')
    await window.webContents.executeJavaScript(
      `const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style);window.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),16);window.cancelAnimationFrame=clearTimeout;void 0;`
    )
    await window.webContents.executeJavaScript(bundle.outputFiles[0].text)
    const results = await window.webContents.executeJavaScript(`(async()=>{
      const {Vue,createI18n,createRouter,createMemoryHistory,Scroller,Header,Host,SvgIcon,useShortcuts,zh,DEFAULT_LOCAL_SHORTCUTS,DEFAULT_GLOBAL_SHORTCUTS}=SearchCheck;
      const {h,createApp,reactive,nextTick}=Vue;
      const checks=[];const check=(value,message)=>{if(!value)throw new Error(message);checks.push(message)};
      const wait=async(ms=100)=>{await nextTick();await new Promise(resolve=>setTimeout(resolve,ms))};
      window.searchUi=reactive({shortcutKeys:{...DEFAULT_LOCAL_SHORTCUTS},globalShortcutKeys:{...DEFAULT_GLOBAL_SHORTCUTS},useGlobalShortcutKeys:false,useMica:false,useCardView:false,sidebarExpanded:true,customThemeText:{},logoText:'Easy Player',musicSource:'local',musicSourceId:0,artistSeparator:' / ',normalizeArtistSeparator:true,compactSongList:false});
      const songs=[{id:1,title:'稻香',artist:'周杰伦',album:'魔杰座',audio:'one.wav',songStatus:1,sourceId:null,duration:220,searchScore:900},{id:2,title:'稻香现场',artist:'周杰伦',album:'演唱会',audio:'two.wav',songStatus:1,sourceId:null,duration:240,searchScore:100},{id:3,title:'Remote song',artist:'Artist',album:'Album',audio:'remote.wav',songStatus:1,sourceId:7,duration:200,searchScore:50}];
      const original={id:99,title:'Current song',audio:'current.wav',songStatus:1};
      const playback=[];const requests=[];let indexListeners=0;
      window.searchPlayer=reactive({queue:[original],currentQueueSong:original,currentQueueIndex:0,queuePlaylistId:42,isPlaying:true,volume:0.5,addToQueue:(items)=>window.searchPlayer.queue.push(...items),playQueueItem:async(...args)=>{playback.push(args);window.searchPlayer.currentQueueIndex=args[0];window.searchPlayer.currentQueueSong=window.searchPlayer.queue[args[0]];return true},playCollection:async()=>{throw new Error('Search must preserve the active queue')}});
      window.api={library:{onScanProgress:()=>()=>{}},window:{onState:()=>()=>{}},shortcuts:{onAction:()=>()=>{},unregisterGlobal:async()=>{},registerGlobal:async()=>({success:true})},database:{onSearchIndexChanged:()=>{indexListeners++;return()=>indexListeners--},command:async(action,params)=>{
        requests.push({action,params});if(action==='listSources')return {success:true,data:[{id:7,name:'Remote fixture'}]};
        if(action==='querySongs'){
          if(params.search==='late')return new Promise(resolve=>{window.resolveLate=()=>resolve({success:true,data:{data:[songs[2]],total:1}})});
          let data=params.search==='dx'?[songs[1],songs[0]]:params.search==='missing'?[]:params.search==='remote'?[songs[2]]:songs;
          if(params.source==='local')data=data.filter(song=>!song.sourceId);
          if(params.source==='remote')data=data.filter(song=>!!song.sourceId);
          return {success:true,data:{data,total:data.length}};
        }
        return {success:true,data:[]};
      }}};
      const router=createRouter({history:createMemoryHistory(),routes:[{path:'/home',component:{render:()=>h('p','Home')}},{path:'/artist/detail',component:{render:()=>h('p','Artist')}}]});
      window.searchRouter=router;
      await router.push('/home');await router.isReady();
      const mounted=createApp({setup(){useShortcuts();return()=>[h(Header),h('main',{style:'padding:30px'},'Underlying home page'),h(Host)]}}).use(createI18n({legacy:false,locale:'zh',messages:{zh}})).use(router).use(Scroller).component('SvgIcon',SvgIcon);
      mounted.mount('#app');await wait();
      const trigger=document.querySelector('[aria-label="全局搜索"]');
      check(trigger&&trigger.title.includes('CTRL + K'),'Header exposes search and its configured shortcut');
      check(indexListeners===0,'Search does not load the song list before opening');
      trigger.click();await wait(450);
      let input=document.querySelector('.global-search-panel .global-search-input input');
      check(input&&document.activeElement===input,'Header opens the dialog and focuses the real song search');
      const initialInputTop=input.getBoundingClientRect().top;
      check(!document.querySelector('.global-search-results')&&document.querySelector('.global-search-panel').getBoundingClientRect().height<120,'Opening displays only the search box without an empty results area');
      check(indexListeners===1,'Only one search index subscription is active');
      check(!document.querySelector('.global-search-panel .ep-select,.global-search-panel [aria-haspopup="menu"],.global-search-panel [type="checkbox"]'),'Search contains no source, sorting or bulk-action controls');
      check(!requests.some(request=>request.action==='querySongs'||request.action==='listSources'),'An empty search never loads the library or its source options');
      const type=async text=>{input.value=text;input.dispatchEvent(new Event('input',{bubbles:true}));await wait(280)};
      await type('remote');
      check(!!document.querySelector('.global-search-results')&&Math.abs(input.getBoundingClientRect().top-initialInputTop)<1,'Typing expands results below the stationary search box');
      check(document.querySelector('.global-search-panel').textContent.includes('Remote song')&&requests.at(-1).params.source==='all'&&window.searchUi.musicSource==='local','Basic search covers all sources without changing songs-page filters');
      await type('dx');
      check(requests.some(request=>request.action==='querySongs'&&request.params.search==='dx'),'Modal uses the same indexed querySongs search as the songs page');
      check(document.querySelector('.global-search-panel').textContent.includes('稻香'),'Search results render in the compact result list');
      const row=[...document.querySelectorAll('.global-search-result')].filter(element=>element.textContent.includes('稻香')&&element.textContent.includes('周杰伦')).sort((left,right)=>left.getBoundingClientRect().top-right.getBoundingClientRect().top)[0];
      check(row&&row.textContent.indexOf('稻香现场')<0,'The highest relevance result is displayed first');
      row.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));await wait();
      check(playback.length===0,'Search keeps double click playback by default');
      row.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));await wait();
      check(playback.length===1&&playback[0][3]==='search'&&window.searchPlayer.queue[0].id===99&&window.searchPlayer.queuePlaylistId===42,'Playing a result preserves the active queue and records search origin');
      row.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));await wait();
      check(window.searchPlayer.queue.filter(song=>song.id===1).length===1,'Repeated search playback reuses the queued song');
      row.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await wait();
      check(playback.length===3&&window.searchPlayer.queue.filter(song=>song.id===1).length===1,'Keyboard activation uses the same queue-preserving playback');
      window.searchUi.songPlayTrigger='single';await wait();
      row.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));await wait();
      row.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:2}));await wait();
      row.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,detail:2}));await wait();
      check(playback.length===4,'Switching to single click takes effect immediately and a double click plays only once');
      window.searchUi.songPlayTrigger='double';await wait();
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true,cancelable:true}));await wait();
      check(document.querySelectorAll('.global-search-panel').length===1&&input.selectionStart===0&&input.selectionEnd===2,'Shortcut refocuses and selects the query without opening a second dialog');
      await type('late');const stale=window.resolveLate;await type('dx');stale();await wait();
      check(!document.querySelector('.global-search-panel').textContent.includes('Remote song'),'A stale query cannot overwrite newer search results');
      const beforeClear=requests.length;document.querySelector('.global-search-input button').click();await wait(280);
      check(!input.value&&!document.querySelector('.global-search-results')&&document.querySelector('.global-search-panel').getBoundingClientRect().height<120&&requests.length===beforeClear,'Clearing the query collapses results without loading the library');
      input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));input.value='dao';input.dispatchEvent(new Event('input',{bubbles:true}));await wait(260);
      check(!requests.some(request=>request.params?.search==='dao'),'IME input does not send incomplete searches');
      input.value='missing';input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));await wait(280);
      check(document.querySelector('.global-search-panel').textContent.includes(zh.songList.empty),'Empty search feedback matches the songs page');
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait(300);
      check(!document.querySelector('.global-search-panel')&&indexListeners===0,'Escape closes the modal and cleans up its search subscription');
      window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true,cancelable:true}));await wait(350);
      input=document.querySelector('.global-search-panel .global-search-input input');
      check(document.activeElement===input&&input.value==='','Keyboard reopens the search with focus and a fresh query');
      await type('late');
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait(300);window.resolveLate();await wait();
      check(!document.querySelector('.global-search-panel')&&indexListeners===0,'A late search response cannot revive a closed dialog');
      trigger.click();await wait(350);await router.push('/artist/detail?name=周杰伦');await wait(300);
      check(!document.querySelector('.global-search-panel'),'Navigating from search closes the overlay instead of hiding the destination');
      window.searchUi.useCardView=true;await wait();document.querySelector('[aria-label="全局搜索"]').click();await wait(350);
      check(!!document.querySelector('.global-search-panel'),'Search remains available in card view');
      input=document.querySelector('.global-search-panel .global-search-input input');
      await type('dx');
      window.searchCheck={mounted,router,checks};return checks;
    })()`)
    assert.equal(errors.length, 0, errors.join('\n'))
    fs.writeFileSync(
      path.resolve('build/global-search-desktop.png'),
      (await window.webContents.capturePage()).toPNG()
    )
    window.setSize(620, 780)
    await new Promise((resolve) => setTimeout(resolve, 150))
    const compact = await window.webContents.executeJavaScript(
      `(()=>{const rect=document.querySelector('.global-search-panel').getBoundingClientRect();return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom}})()`
    )
    assert.ok(
      compact.left >= 0 && compact.right <= 620 && compact.top >= 0 && compact.bottom <= 780,
      'Search modal fits a compact viewport'
    )
    fs.writeFileSync(
      path.resolve('build/global-search-compact.png'),
      (await window.webContents.capturePage()).toPNG()
    )
    await window.webContents.executeJavaScript('window.searchCheck.mounted.unmount();void 0;')
    console.log(JSON.stringify({ passed: results.length, checks: results, compact }, null, 2))
    window.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
