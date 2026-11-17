/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, protocol } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const sharp = require('sharp')
const assert = require('node:assert/strict')
const esbuild = require('esbuild')
const { parse, compileScript, compileStyle } = require('@vue/compiler-sfc')
const baseline = process.argv.includes('--baseline')
const mesh = process.argv.includes('--mesh')
const particles = process.argv.includes('--particles')
const ambient = process.argv.includes('--ambient')
const bottomControls = process.argv.includes('--bottom-controls')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ep-panel-switch-')))
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'easy-player-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
])
app.whenReady().then(async () => {
  try {
    const covers = await Promise.all(
      ['#cf729a', '#557bca', '#57b89e', '#c6a248'].map((background) =>
        sharp({ create: { width: 1024, height: 1024, channels: 3, background } })
          .jpeg()
          .toBuffer()
      )
    )
    protocol.handle(
      'easy-player-media',
      (request) =>
        new Response(
          covers[Number(new URL(request.url).searchParams.get('path')) % covers.length],
          { headers: { 'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*' } }
        )
    )
    const styles = []
    let scope = 0
    const bundle = await esbuild.build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
    import * as Vue from 'vue';import {createPinia} from 'pinia';import {createI18n} from 'vue-i18n';
    import {createRouter,createMemoryHistory} from 'vue-router';
    import Panel from './src/renderer/src/views/layout/playerPanel/Index.vue';
    import {useUIStore} from './src/renderer/src/stores/ui/uiStore';
    import {CoverAnalyzer} from './src/renderer/src/hooks/useImageColors';
    import zh from './src/renderer/src/i18n/locales/zh';export {Vue,createPinia,createI18n,createRouter,createMemoryHistory,Panel,useUIStore,CoverAnalyzer,zh};
   `
      },
      bundle: true,
      platform: 'browser',
      format: 'iife',
      globalName: 'PanelCheck',
      write: false,
      loader: { '.webp': 'dataurl' },
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
          name: 'panel-fixture',
          setup(build) {
            build.onResolve({ filter: /stores[\\/]player[\\/]playerStore$/ }, () => ({
              path: 'player',
              namespace: 'fixture'
            }))
            build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
              contents: 'export const usePlayerStore=()=>window.panelPlayer',
              loader: 'js'
            }))
            build.onResolve({ filter: /\.glsl\?raw$/ }, (args) => ({
              path: args.path.startsWith('@/')
                ? path.resolve('src/renderer/src', args.path.slice(2).split('?')[0])
                : path.resolve(args.resolveDir, args.path.split('?')[0]),
              namespace: 'shader'
            }))
            build.onLoad({ filter: /.*/, namespace: 'shader' }, (args) => ({
              contents: fs.readFileSync(args.path, 'utf8'),
              loader: 'text'
            }))
            build.onLoad(
              { filter: /components[\\/]background[\\/](?:themes[\\/].+|CoverAuraCanvas)\.vue$/ },
              ({ path: filename }) => ({
                contents: filename.includes('CoverAuraCanvas')
                  ? "import {h} from 'vue';export default {render(){return h('canvas',{'data-cover-aura-fixture':''})}}"
                  : 'export default {render(){return null}}',
                loader: 'js'
              })
            )
            build.onLoad(
              {
                filter:
                  /(PlayQueueDrawer|PlayerSpectrum|LyricsManagerDialog|LyricsColorDialog|AddSongsToPlaylistDialog)\.vue$/
              },
              () => ({ contents: 'export default {render(){return null}}', loader: 'js' })
            )
            build.onLoad({ filter: /\.vue$/ }, ({ path: filename }) => {
              const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
              const id = 'panel-' + ++scope
              descriptor.styles.forEach((style) => {
                const compiled = compileStyle({
                  source: style.content,
                  filename,
                  id: 'data-v-' + id,
                  scoped: style.scoped
                })
                if (compiled.errors.length) throw compiled.errors[0]
                styles.push(compiled.code)
              })
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
    const window = new BrowserWindow({
      show: false,
      width: 1600,
      height: 900,
      webPreferences: { offscreen: true, backgroundThrottling: false }
    })
    window.webContents.on('console-message', (event) => {
      if (!event.message.includes('Security Warning')) console.log(event.message)
    })
    const fixture = path.join(app.getPath('userData'), 'panel.html')
    const svgRoot = path.resolve('src/renderer/src/assets/svg')
    const symbols = fs
      .readdirSync(svgRoot, { recursive: true })
      .filter((file) => file.endsWith('.svg'))
      .map((file) => {
        const svg = fs
          .readFileSync(path.join(svgRoot, file), 'utf8')
          .match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/)
        if (!svg) return ''
        const attrs = svg[1].replace(/\s(?:width|height|xmlns(?::\w+)?)=(["']).*?\1/g, '')
        return `<symbol id="icon-${file.replaceAll(path.sep, '-').replace(/\.svg$/, '')}" ${attrs}>${svg[2]}</symbol>`
      })
      .join('')
    fs.writeFileSync(
      fixture,
      `<html><body><svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true">${symbols}</svg><div id="app"></div></body></html>`
    )
    await window.loadFile(fixture)
    await window.webContents.executeJavaScript(bundle.outputFiles[0].text)
    const css =
      fs.readFileSync(
        path.join(
          'out/renderer/assets',
          fs.readdirSync('out/renderer/assets').find((file) => /^main-.*\.css$/.test(file))
        ),
        'utf8'
      ) + styles.join('\n')
    await window.webContents.executeJavaScript(`(async()=>{
   const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style);
   const {Vue,createPinia,createI18n,createRouter,createMemoryHistory,Panel,useUIStore,CoverAnalyzer,zh}=PanelCheck;
   const nativeMatchMedia=window.matchMedia.bind(window),hoverListeners=new Set();
   const fineHover={matches:true,addEventListener:(_event,handler)=>hoverListeners.add(handler),removeEventListener:(_event,handler)=>hoverListeners.delete(handler)};
   window.matchMedia=query=>query==='(hover: hover) and (pointer: fine)'?fineHover:nativeMatchMedia(query);
   window.panelSetHover=value=>{fineHover.matches=value;hoverListeners.forEach(handler=>handler({matches:value}))};
   const nativeSetTimeout=window.setTimeout.bind(window),nativeClearTimeout=window.clearTimeout.bind(window);
   window.panelIdleTimers=new Map();
   window.setTimeout=(callback,delay,...args)=>{let id;const run=()=>{window.panelIdleTimers.delete(id);callback(...args)};id=nativeSetTimeout(run,delay);if(delay===5000)window.panelIdleTimers.set(id,()=>{nativeClearTimeout(id);run()});return id};
   window.clearTimeout=id=>{window.panelIdleTimers.delete(id);nativeClearTimeout(id)};
   window.panelWait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
   window.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),16);window.cancelAnimationFrame=clearTimeout;
   window.panelAnalysis=[];const analyze=CoverAnalyzer.analyze;CoverAnalyzer.analyze=function(...args){const start=performance.now();const result=analyze.apply(this,args);window.panelAnalysis.push(performance.now()-start);return result};
   const lyric=Array.from({length:100},(_,index)=>'['+String(Math.floor(index*2/60)).padStart(2,'0')+':'+String(index*2%60).padStart(2,'0')+'.000]第'+index+'行切歌测试歌词 Beautiful music').join('\\n');
   window.panelPlayer=Vue.reactive({lyricsOffsetMs:0,lyricsSettingsReady:true,songLyricSettings:{songId:0,offsetMs:null,disableNetwork:false,instrumental:false},currentQueueSong:{id:0,title:'Initial',artist:'Artist',audio:'0.flac',cover:'0'},trackInfo:null,positionMs:0,durationMs:180000,durationFormatted:'3:00',playbackSpeedConfig:{enabled:false,speed:1},volume:0.5,isPlaying:true,playMode:0,queue:[],getSongPreference:()=>0,setAudioAnalysisPollingRate(){},rhythmVisualConfig:{enabled:false,reducedMotion:false,intensity:1},audioAnalysis:{rms:0,lowEnergy:0,onsetStrength:0,beatSequence:0}});
   const policies=new Map(),songRequests=[];
   window.api={database:{command:async(action,params)=>{
    songRequests.push({action,params});
    if(action==='listTags')return {success:true,data:[{id:1,name:'Fixture tag',color:null,isIncluded:false}]};
    if(action==='toggleSongTag')return {success:true,data:true};
    if(action==='setSongLyricSettings'){
     const settings={songId:params.songId,offsetMs:null,disableNetwork:false,instrumental:false,...policies.get(params.songId),...params.patch};
     policies.set(params.songId,settings);
     if(window.panelPlayer.currentQueueSong?.id===params.songId)window.panelPlayer.songLyricSettings=settings;
     return {success:true,data:settings};
    }
    if(action==='getSongLyricSettings')return {success:true,data:policies.get(params.songId)||{songId:params.songId,offsetMs:null,disableNetwork:false,instrumental:false}};
    return {success:true,data:action==='getSong'?{...window.panelPlayer.currentQueueSong,id:params.id,duration:180,fileSize:1000,sourceId:null,lrc:lyric,lyricFormat:'lrc'}:[]};
   }},fonts:{list:async()=>({success:true,data:[]})}};
   const app=Vue.createApp({render:()=>Vue.h(Panel)});app.use(createPinia());app.use(createI18n({legacy:false,locale:'zh',messages:{zh},missingWarn:false,fallbackWarn:false}));
   const router=createRouter({history:createMemoryHistory(),routes:['/','/artist/detail','/album/detail'].map(path=>({path,component:{render:()=>null}}))});app.use(router);await router.push('/');await router.isReady();
   const ui=useUIStore();ui.showPlayer=true;ui.playerBgType=${JSON.stringify(ambient ? 'ambient' : particles ? 'particles' : mesh ? 'mesh' : 'album')};ui.lyricSourceOrder=['database'];ui.autoSearchNetworkLyrics=false;ui.showPlayerSpectrum=false;
   app.mount('#app');await window.panelWait(700);
   if(${bottomControls}){
    const cover=document.querySelector('.cover-frame img'),lyrics=document.querySelector('.lyric-viewport'),play=document.querySelector('.playback-button');
    ui.playerLayout='bottom';await Vue.nextTick();await window.panelWait(600);
    const area=document.querySelector('.panel-controls').getBoundingClientRect(),art=document.querySelector('.panel-artwork').getBoundingClientRect(),text=document.querySelector('.panel-lyrics').getBoundingClientRect(),progress=document.querySelector('.ep-playback-progress').getBoundingClientRect();
    if(art.right>text.left+1||area.top<Math.max(art.bottom,text.bottom)-1||progress.width<innerWidth*0.8)throw Error('Bottom layout keeps artwork and lyrics side by side above full-width controls');
    if(!document.querySelector('.panel-controls .panel-tools')||document.querySelector('.panel-tools').getBoundingClientRect().top<progress.top)throw Error('Modern layout keeps utility buttons at the bottom right');
    if(parseFloat(getComputedStyle(document.querySelector('.panel-controls')).borderTopWidth)!==0)throw Error('The progress track is the only divider in Modern layout');
    const playRect=play.getBoundingClientRect();
    if(playRect.width!==44||playRect.height!==44||play.querySelector('svg').getBoundingClientRect().width!==document.querySelector('.panel-control-button svg').getBoundingClientRect().width)throw Error('Modern play retains its original button size with an icon matching adjacent controls');
    if(Math.abs((playRect.top-progress.bottom)-(area.bottom-playRect.bottom))>1)throw Error('Modern control padding is balanced below the progress divider');
    if(parseFloat(getComputedStyle(document.querySelector('.panel-time')).fontSize)<14)throw Error('Modern time uses the larger text size');
    if(document.querySelectorAll('.playback-button').length!==1||cover!==document.querySelector('.cover-frame img')||lyrics!==document.querySelector('.lyric-viewport')||play!==document.querySelector('.playback-button'))throw Error('Switching layout must preserve artwork, lyrics and playback controls');
    const collapse=document.querySelector('header button[aria-expanded]');collapse.click();await Vue.nextTick();await window.panelWait(600);
    if(getComputedStyle(play).pointerEvents==='none'||play.getBoundingClientRect().width===0)throw Error('Bottom playback controls remain usable with the artwork collapsed');
    collapse.click();ui.playerLayout='classic';await Vue.nextTick();await window.panelWait(600);
    if(getComputedStyle(document.querySelector('.panel-controls')).display!=='contents')throw Error('Classic layout restores controls below the cover');
    ui.playerLayout='bottom';await Vue.nextTick();await window.panelWait(600);
   }
   const moreTrigger=document.querySelector('.panel-transport button[aria-label="'+zh.songList.more+'"]');
   if(!moreTrigger||document.querySelectorAll('button[aria-label="'+zh.songList.more+'"]').length!==1)throw Error('The single More button stays beside the queue in the transport');
   const volumeButton=document.querySelector('button[aria-label="'+zh.footer.volume+'"]'),modeButton=document.querySelector('.panel-transport > button');
   if(volumeButton.getBoundingClientRect().width!==modeButton.getBoundingClientRect().width||volumeButton.querySelector('svg').getBoundingClientRect().width!==modeButton.querySelector('svg').getBoundingClientRect().width)throw Error('Volume matches the other control button and icon sizes');
   const details=document.querySelector('.panel-artwork dl');
   if(!details||getComputedStyle(details).backgroundColor==='rgba(0, 0, 0, 0)')throw Error('Song parameters keep their original background');
   for(const visible of [false,true]){
    moreTrigger.click();await Vue.nextTick();await window.panelWait(100);
    const toggle=[...document.querySelectorAll('.ep-menu-item')].find(button=>button.textContent.trim()===zh.playerPanel.showAudioDetails);
    if(!toggle)throw Error('More includes the song parameter visibility toggle');
    toggle.click();await Vue.nextTick();await window.panelWait(160);
    if(!!document.querySelector('.panel-artwork dl')!==visible)throw Error('Parameter visibility follows the More menu toggle');
   }
   for(const label of [zh.footer.volume,zh.playerPanel.speed,zh.playerPanel.lyricTiming,zh.playerPanel.lyricFontSize,zh.playerPanel.lyricSpacing]){
    const trigger=[...document.querySelectorAll('.ep-tooltip-trigger button')].find(button=>button.getAttribute('aria-label')===label);
    if(!trigger||trigger.title!==label)throw Error('Player control must expose a visible hover hint: '+label);
    const anchor=trigger.closest('.ep-tooltip-trigger');
    anchor.dispatchEvent(new PointerEvent('pointerenter'));await Vue.nextTick();await window.panelWait(180);
    const tooltip=document.querySelector('.ep-tooltip');
    if(!tooltip||!tooltip.querySelector('input[type="range"]')||getComputedStyle(tooltip).visibility!=='visible')throw Error('Hover hint must preserve the interactive control popup: '+label);
    anchor.dispatchEvent(new PointerEvent('pointerleave'));
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    await Vue.nextTick();await window.panelWait(200);
   }
   if(${mesh} && (ui.playerBgType!=='mesh'||!document.querySelector('.mesh-flow-background')))throw Error('Mesh background must remain selected and render inside the player');
   if(${particles} && (ui.playerBgType!=='particles'||!document.querySelector('.particle-flow-background')))throw Error('Particle background must remain selected and render inside the player');
   if(${ambient}) {
    const layer=document.querySelector('.ambient-bubble-layer');
    if(!layer)throw Error('Ambient background must render inside the player');
    const colors=layer.__vueParentComponent.props;
    if(colors.primary!==colors.secondary||colors.primary!==colors.tertiary)throw Error('All three ambient glows must use the single-color fixture artwork, without fallback hues');
    ui.playerBgType='album';await Vue.nextTick();await window.panelWait(150);
    ui.playerBgType='ambient';await Vue.nextTick();await window.panelWait(750);
    const restored=document.querySelector('.ambient-bubble-layer').__vueParentComponent.props;
    if(restored.primary!==restored.secondary||restored.primary!==restored.tertiary)throw Error('Switching from album to ambient must restore the complete artwork palette');
   }
   let moreMenuMotionChecked=false;
   const coverImage=document.querySelector('.cover-frame img');
   const originalReduced=ui.reduceMotion,originalPauseOnBlur=ui.pauseAnimationsOnBlur;ui.reduceMotion=false;ui.pauseAnimationsOnBlur=false;
   window.panelPlayer.rhythmVisualConfig.enabled=true;window.panelPlayer.audioAnalysis.rms=0.6;
   ui.setPlayerCoverEffect('glow');await Vue.nextTick();await window.panelWait(100);
   if(!document.querySelector('.cover-aura')||document.querySelectorAll('.beat-particle').length!==24||document.querySelector('.player-cover-glow').style.transform==='scale(1)')throw Error('Glow mounts independent aura, particles and audio scaling');
   const playback=document.querySelector('.playback-button');
   const playbackRect=playback.getBoundingClientRect(),iconRect=playback.querySelector('svg').getBoundingClientRect();
   for(let state=0;state<16;state++){
    window.panelPlayer.isPlaying=state%2===0;window.panelPlayer.audioAnalysis.rms=state%3/3;
    await Vue.nextTick();await new Promise(requestAnimationFrame);
    for(const [rect,initial] of [[playback.getBoundingClientRect(),playbackRect],[playback.querySelector('svg').getBoundingClientRect(),iconRect]])
      if(['x','y','width','height'].some(key=>Math.abs(rect[key]-initial[key])>0.1))throw Error('Player playback button must stay fixed across playback and rhythm changes');
   }
   window.panelPlayer.isPlaying=true;await Vue.nextTick();
   ui.setPlayerCoverEffect('none');await Vue.nextTick();
   if(document.querySelector('.cover-aura')||document.querySelector('.beat-particle')||document.querySelector('.player-cover-glow').style.transform!=='scale(1)')throw Error('Off removes glow, particles and scaling immediately');
   if(document.querySelector('.cover-frame img')!==coverImage)throw Error('Effect switching must preserve the loaded artwork');
   ui.setPlayerCoverEffect('glow');ui.reduceMotion=true;await Vue.nextTick();
   if(!document.querySelector('.cover-aura')||document.querySelector('.beat-particle')||document.querySelector('.player-cover-glow').style.transform!=='scale(1)')throw Error('Reduced motion keeps static glow without particles or scaling');
   ui.setPlayerCoverEffect('invalid');await Vue.nextTick();if(ui.playerCoverEffect!=='glow')throw Error('Invalid effect preference must recover to the default');
   window.panelPlayer.rhythmVisualConfig.enabled=false;ui.reduceMotion=originalReduced;ui.pauseAnimationsOnBlur=originalPauseOnBlur;await Vue.nextTick();
   async function chooseLyricOption(prefix,label,verify){
    const trigger=[...document.querySelectorAll('button[aria-label]')].find(button=>button.getAttribute('aria-label').startsWith(prefix));
    if(!trigger)throw Error('Missing lyric option trigger: '+prefix);
    trigger.click();await Vue.nextTick();await window.panelWait(80);
    if(prefix==='更多'){
      const menu=document.querySelector('.ep-menu');
      if(menu.scrollHeight>menu.clientHeight+1)throw Error('More menu must show all actions without scrolling when space is available');
      if(!moreMenuMotionChecked){
        const icons=[...menu.querySelectorAll('svg')];
        if(!icons.length)throw Error('More menu motion check requires real option icons');
        const initial=icons.map(icon=>icon.getBoundingClientRect());
        for(let frame=0;frame<16;frame++){
          await window.panelWait(16);
          icons.forEach((icon,index)=>{
            const rect=icon.getBoundingClientRect();
            for(const key of ['x','y','width','height'])if(Math.abs(rect[key]-initial[index][key])>0.1)throw Error('More menu option icons must stay fixed throughout the opening fade');
          });
        }
        moreMenuMotionChecked=true;
      }
    }
    const option=[...document.querySelectorAll('.ep-menu-item')].find(button=>button.textContent.trim()===label);
    if(!option)throw Error('Missing lyric option: '+label);
    option.click();await Vue.nextTick();await window.panelWait(220);
    if(!verify())throw Error('Lyric option did not apply: '+label);
    if(document.querySelector('.ep-menu'))throw Error('Lyric menu did not close after selection');
   }
   await chooseLyricOption('歌词对齐：','右对齐',()=>ui.lyricsAlignment==='right');
   await chooseLyricOption('歌词效果：','跟随',()=>ui.lyricsStyle==='follow');
   await chooseLyricOption('歌词来源：','数据库歌词',()=>ui.lyricSourceMode==='database');
   if(!document.querySelector('button[aria-label="搜索歌词"]'))throw Error('Missing search lyrics action');
   await chooseLyricOption('更多','标记不搜索网络歌词',()=>window.panelPlayer.songLyricSettings.disableNetwork===true);
   await chooseLyricOption('更多','取消不搜索网络歌词标记',()=>window.panelPlayer.songLyricSettings.disableNetwork===false);
   await chooseLyricOption('更多','标记为纯音乐',()=>window.panelPlayer.songLyricSettings.instrumental===true);
   await chooseLyricOption('更多','取消纯音乐标记',()=>window.panelPlayer.songLyricSettings.instrumental===false);
   if(document.querySelector('button[aria-label="添加到歌单"]'))throw Error('Playlist action should only appear inside More');
   window.panelPlayer.currentQueueSong.artist='Artist A;Artist B';window.panelPlayer.currentQueueSong.album='Album';ui.artistSeparator=';';await Vue.nextTick();
   await chooseLyricOption('更多','查看歌手 · Artist B',()=>router.currentRoute.value.path==='/artist/detail'&&router.currentRoute.value.query.name==='Artist B'&&router.currentRoute.value.query.cover==='0'&&!ui.showPlayer);
   ui.showPlayer=true;await Vue.nextTick();
   await chooseLyricOption('更多','查看专辑',()=>router.currentRoute.value.path==='/album/detail'&&router.currentRoute.value.query.name==='Album'&&router.currentRoute.value.query.artist==='Artist A;Artist B'&&router.currentRoute.value.query.cover==='0'&&!ui.showPlayer);
   ui.showPlayer=true;
   ui.lyricsAlignment='center';ui.lyricsStyle='none';
   const actionSong={...window.panelPlayer.currentQueueSong,id:21,title:'Action song',artist:'Artist',album:'Album'};
   window.panelPlayer.currentQueueSong=actionSong;await Vue.nextTick();
   const dialogTitle=()=>document.querySelector('.ep-dialog-title')?.textContent.trim();
   async function closeActionDialog(){document.querySelector('.ep-dialog button[aria-label="关闭"]').click();await window.panelWait(300);if(document.querySelector('.ep-dialog'))throw Error('Song action dialog did not close');}
   await chooseLyricOption('更多','歌曲详情',()=>dialogTitle()==='歌曲详情'&&document.querySelector('[data-song-summary]')?.textContent.includes('Action song'));
   window.panelPlayer.currentQueueSong={...actionSong,id:22,title:'Next song'};await Vue.nextTick();
   if(!document.querySelector('[data-song-summary]')?.textContent.includes('Action song'))throw Error('Details target changed with playback');
   await closeActionDialog();
   window.panelPlayer.currentQueueSong=actionSong;await Vue.nextTick();
   await chooseLyricOption('更多','编辑歌词',()=>dialogTitle()?.startsWith('编辑歌词')&&songRequests.some(request=>request.action==='getSong'&&request.params.id===21));
   await closeActionDialog();
   await chooseLyricOption('更多','编辑标签',()=>dialogTitle()==='编辑歌曲标签');
   window.panelPlayer.currentQueueSong={...actionSong,id:22,title:'Next song'};await Vue.nextTick();
   [...document.querySelectorAll('.ep-dialog button')].find(button=>button.textContent.trim()==='Fixture tag').click();await Vue.nextTick();
   if(!songRequests.some(request=>request.action==='toggleSongTag'&&request.params.songId===21))throw Error('Tag editor must retain the action target after playback switches');
   await closeActionDialog();
   window.panelPlayer.currentQueueSong=actionSong;await Vue.nextTick();
   let copiedName;
   Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{copiedName=text}}});
   await chooseLyricOption('更多','复制名称',()=>copiedName==='Action song - Artist - Album');
   window.panelPlayer.currentQueueSong=null;await Vue.nextTick();
   if(document.querySelector('button[aria-label="更多"]').disabled===${bottomControls})throw Error('Modern More remains available for playback tools without a song; Classic song actions require a current song');
   window.panelPlayer.currentQueueSong=actionSong;await Vue.nextTick();
   if(${bottomControls}){
    const controls=document.querySelector('.panel-controls'),progress=document.querySelector('.ep-playback-progress');
    const wait=async()=>{await Vue.nextTick();await window.panelWait(370)};
    const idle=async()=>{await Vue.nextTick();[...window.panelIdleTimers.values()].forEach(run=>run());await wait()};
    const outside=()=>window.dispatchEvent(new PointerEvent('pointermove',{clientY:10}));
    const reveal=()=>window.dispatchEvent(new PointerEvent('pointermove',{clientY:innerHeight-1}));
    document.activeElement?.blur();outside();await Vue.nextTick();
    const lyricsHeight=document.querySelector('.panel-lyrics').getBoundingClientRect().height;
    window.panelPlayer.positionMs=45000;await idle();
    if(!controls.classList.contains('panel-controls--idle')||getComputedStyle(progress).visibility!=='hidden'||!document.querySelector('.panel-transport').inert||!document.querySelector('.panel-tools').inert)throw Error('Idle Modern controls hide buttons, native slider and unused track access');
    const fill=document.querySelector('.panel-idle-progress span'),track=fill.parentElement;
    if(Math.abs(fill.getBoundingClientRect().width/track.getBoundingClientRect().width-0.25)>0.01||!document.querySelector('.panel-time').textContent.includes('0:45'))throw Error('Idle view retains time and only the completed progress segment');
    window.panelPlayer.positionMs=90000;await Vue.nextTick();
    if(Math.abs(fill.getBoundingClientRect().width/track.getBoundingClientRect().width-0.5)>0.01||!document.querySelector('.panel-time').textContent.includes('1:30'))throw Error('Idle progress and time keep updating during playback');
    if(document.querySelector('.panel-lyrics').getBoundingClientRect().height!==lyricsHeight)throw Error('Auto-hide preserves the lyric viewport height');
    reveal();await wait();if(controls.classList.contains('panel-controls--idle')||getComputedStyle(progress).visibility!=='visible'||document.querySelector('.panel-transport').inert)throw Error('Moving to the bottom restores playback controls and seeking');
    controls.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));outside();await idle();
    if(controls.classList.contains('panel-controls--idle'))throw Error('A dragging gesture prevents auto-hide');
    window.dispatchEvent(new PointerEvent('pointerup'));await idle();
    if(!controls.classList.contains('panel-controls--idle'))throw Error('Releasing outside the controls resumes auto-hide');
    reveal();await wait();
    document.querySelector('.panel-transport button[aria-label="'+zh.songList.more+'"]').click();await Vue.nextTick();outside();await idle();
    if(controls.classList.contains('panel-controls--idle'))throw Error('An open More menu prevents auto-hide');
    document.querySelector('.ep-menu').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait();
    if(!ui.showPlayer||document.querySelector('.ep-menu'))throw Error('Closing More keeps the page open');
    document.activeElement?.blur();await Vue.nextTick();await idle();
    if(!controls.classList.contains('panel-controls--idle'))throw Error('Closing More resumes the idle countdown');
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}));await wait();
    if(controls.classList.contains('panel-controls--idle'))throw Error('Keyboard use reveals hidden controls');
    document.activeElement?.blur();outside();window.panelSetHover(false);await idle();
    if(controls.classList.contains('panel-controls--idle'))throw Error('Touch pointers keep the controls visible');
    window.panelSetHover(true);ui.playerLayout='classic';await idle();
    if(controls.classList.contains('panel-controls--idle'))throw Error('Classic layout does not auto-hide its playback controls');
    ui.playerLayout='bottom';window.panelPlayer.positionMs=0;reveal();await wait();
   }

  })()`)
    if (bottomControls) {
      await window.webContents.executeJavaScript(`(async()=>{
        document.activeElement?.blur();window.dispatchEvent(new PointerEvent('pointermove',{clientY:10}));
        window.panelPlayer.positionMs=60000;await PanelCheck.Vue.nextTick();
        [...window.panelIdleTimers.values()].forEach(run=>run());await PanelCheck.Vue.nextTick();await window.panelWait(370);
        if(!document.querySelector('.panel-controls--idle')||document.querySelector('.ep-menu'))throw Error('Idle screenshot must show controls fully hidden with no open menu');
      })()`)
      fs.writeFileSync(
        path.resolve('build/player-modern-idle.png'),
        (await window.webContents.capturePage()).toPNG()
      )
      await window.webContents.executeJavaScript(`(async()=>{
        window.panelPlayer.positionMs=0;window.dispatchEvent(new PointerEvent('pointermove',{clientY:innerHeight-1}));
        await PanelCheck.Vue.nextTick();await window.panelWait(370);
      })()`)
    }
    const result = await window.webContents.executeJavaScript(`(async()=>{
   const durations=[],gaps=[],longTasks=[];window.panelAnalysis=[];
   const observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(task=>task.duration)));observer.observe({type:'longtask'});
   let active=true,last=performance.now();function frame(){const now=performance.now();gaps.push(now-last);last=now;if(active)setTimeout(frame,16)};frame();
   for(let id=1;id<=3;id++){
    const start=performance.now();window.panelPlayer.currentQueueSong={id,title:'Track '+id,artist:'Artist',audio:id+'.flac',cover:String(id)};
    await PanelCheck.Vue.nextTick();durations.push(performance.now()-start);await window.panelWait(550);
   }
   active=false;observer.disconnect();return {switchRenderMs:durations,maxFrameSchedulingGapMs:Math.max(...gaps),longTasksMs:longTasks,coverAnalysisMs:window.panelAnalysis,lyricRows:document.querySelectorAll('.lyric-line').length};
  })()`)
    const report = {
      scope: `Actual playback panel, cover analysis, ${ambient ? 'ambient' : particles ? 'particles' : mesh ? 'mesh' : 'album'} background and 100 lyric lines; isolated reactive player, no decoder or persistence`,
      ...result
    }
    if (bottomControls) {
      for (const [width, height] of [
        [1600, 900],
        [1000, 700],
        [760, 600],
        [640, 600]
      ]) {
        window.setSize(width, height)
        await new Promise((resolve) => setTimeout(resolve, 650))
        const bounds = await window.webContents.executeJavaScript(`(()=>{
          const controls=document.querySelector('.panel-controls').getBoundingClientRect(),play=document.querySelector('.playback-button').getBoundingClientRect(),lyrics=document.querySelector('.panel-lyrics').getBoundingClientRect(),art=document.querySelector('.panel-artwork').getBoundingClientRect(),time=document.querySelector('.panel-time').getBoundingClientRect(),tools=document.querySelector('.panel-tools').getBoundingClientRect();
          return {visible:controls.bottom<=innerHeight+1&&play.top>=controls.top&&play.bottom<=controls.bottom,split:art.right<=lyrics.left+1,leftTime:time.left<play.left&&document.querySelector('.panel-time span:last-child').getBoundingClientRect().right<=play.left+1,toolsFit:(tools.left>=play.right||tools.top>=play.bottom)&&tools.right<=innerWidth+1&&tools.top>=controls.top&&tools.bottom<=controls.bottom+1,overflow:document.querySelector('.panel-controls').scrollWidth>controls.width+1||document.querySelector('.panel-tools').scrollWidth>document.querySelector('.panel-tools').clientWidth+1};
        })()`)
        assert.ok(
          bounds.visible && bounds.split && bounds.leftTime && bounds.toolsFit && !bounds.overflow,
          `Bottom controls fit ${width}x${height}`
        )
        if (width === 760) {
          await window.webContents.executeJavaScript(`(async()=>{
            const {Vue,zh}=PanelCheck;
            const more=()=>document.querySelector('.panel-transport button[aria-label="'+zh.songList.more+'"]');
            const toolbar=document.querySelector('.panel-tools');toolbar.style.maxWidth='140px';toolbar.style.justifySelf='end';await Vue.nextTick();await window.panelWait(80);
            const hiddenSlider=[{key:'size',label:zh.playerPanel.lyricFontSize,value:'1.5',reset:'1'},{key:'spacing',label:zh.playerPanel.lyricSpacing,value:'45',reset:'30'}].find(tool=>getComputedStyle(document.querySelector('[data-panel-tool="'+tool.key+'"]')).display==='none');
            if(!hiddenSlider)throw Error('Narrow layout retains a slider in More');
            more().click();await Vue.nextTick();await window.panelWait(100);
            const item=[...document.querySelectorAll('.ep-menu-item')].find(button=>button.textContent.trim()===hiddenSlider.label);
            if(!item)throw Error('Hidden font size control must be available in More');
            item.click();await Vue.nextTick();await window.panelWait(200);
            const range=document.querySelector('.ep-tooltip input[aria-label="'+hiddenSlider.label+'"]');
            if(!range||getComputedStyle(range).visibility!=='visible')throw Error('Overflow action opens the original font size control');
            range.value=hiddenSlider.value;range.dispatchEvent(new Event('input',{bubbles:true}));await Vue.nextTick();
            range.value=hiddenSlider.reset;range.dispatchEvent(new Event('input',{bubbles:true}));await Vue.nextTick();
            document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await Vue.nextTick();await window.panelWait(200);
            if(document.querySelector('[data-overflow-anchor]'))throw Error('Closing overflow control releases its temporary anchor');
            const translation=document.querySelector('[data-panel-tool="translation"] button')||document.querySelector('button[data-panel-tool="translation"]');
            const initial=translation.classList.contains('active');
            more().click();await Vue.nextTick();await window.panelWait(100);
            [...document.querySelectorAll('.ep-menu-item')].find(button=>button.textContent.trim()===zh.playerPanel.showTranslation).click();await Vue.nextTick();await window.panelWait(80);
            if(translation.classList.contains('active')===initial)throw Error('Overflow toggles retain their original behavior');
            more().click();await Vue.nextTick();await window.panelWait(100);
            [...document.querySelectorAll('.ep-menu-item')].find(button=>button.textContent.trim().startsWith(zh.playerPanel.lyricAlignment.split('{')[0])).click();await Vue.nextTick();await window.panelWait(150);
            const alignment=[...document.querySelectorAll('.ep-menu-item')].find(button=>button.textContent.trim()===zh.playerPanel.alignCenter);
            if(!alignment)throw Error('Overflow alignment opens the original option menu');
            alignment.click();await Vue.nextTick();await window.panelWait(250);
            if(!document.querySelector('[data-panel-tool="alignment"] button').title.includes(zh.playerPanel.alignCenter))throw Error('Overflow alignment updates the preference');
            toolbar.style.removeProperty('max-width');toolbar.style.removeProperty('justify-self');await Vue.nextTick();await window.panelWait(100);
          })()`)
        }
        fs.writeFileSync(
          path.resolve('build', `player-bottom-${width}.png`),
          (await window.webContents.capturePage()).toPNG()
        )
      }
    }
    assert.equal(
      result.lyricRows,
      100,
      'the real lyric list finishes loading after repeated switches'
    )
    assert.ok(result.coverAnalysisMs.length >= 3, 'new covers are actually decoded and analyzed')
    fs.writeFileSync(
      path.resolve('build', baseline ? 'panel-switch-before.json' : 'panel-switch-after.json'),
      JSON.stringify(report, null, 2)
    )
    console.log(JSON.stringify(report, null, 2))
    window.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
