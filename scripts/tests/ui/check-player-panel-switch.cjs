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
const liquid = process.argv.includes('--liquid')
const cheerGeometry = process.argv.includes('--cheer-geometry')
const cheer = process.argv.includes('--cheer')
const background =
  cheer || cheerGeometry
    ? 'cheer'
    : ambient
      ? 'ambient'
      : particles
        ? 'particles'
        : mesh
          ? 'mesh'
          : liquid
            ? 'liquid'
            : 'album'
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
    import * as Vue from 'vue';import {createPinia} from 'pinia';import {createI18n} from 'vue-i18n';import persisted from 'pinia-plugin-persistedstate';
    import {createRouter,createMemoryHistory} from 'vue-router';
    import Panel from './src/renderer/src/views/layout/playerPanel/Index.vue';
    import {useUIStore} from './src/renderer/src/stores/ui/uiStore';
    import {CoverAnalyzer} from './src/renderer/src/hooks/useImageColors';
    export {StageDirector,stageProjection} from './src/renderer/src/components/background/player/stageCamera';
    export {mainScreen,wingScreens,stageDeckHeight,stageLightColumns} from './src/renderer/src/components/background/player/stageScenery';
    export {createFaceOcclusion,createStageOcclusion,beginStageClip} from './src/renderer/src/components/background/player/stageOcclusion';
    export {createArenaGeometry,createArenaOcclusion,isInsideArenaFloor} from './src/renderer/src/components/background/player/stageArena';
    export {StageMusic} from './src/renderer/src/components/background/player/stageMusic';
    export {CheerBeatClock,cheerReach} from './src/renderer/src/components/background/player/stageCheer';
    export {deserializeUIPreferences} from './src/renderer/src/stores/ui/uiPreferences';
    export {mountGlassComponentEffects} from './src/renderer/src/services/liquidGlassComponents';
    export {default as eventBus} from './src/renderer/src/utils/eventBus';
    export {getAutomaticLyricsMetrics} from './src/renderer/src/utils/lyricsDisplay';
    export {flushPlayerDataStorage} from './src/renderer/src/stores/persistence';
    export {spotlightCue,markerIntensity} from './src/renderer/src/components/background/player/stageLighting';
    import zh from './src/renderer/src/i18n/locales/zh';export {Vue,createPinia,createI18n,createRouter,createMemoryHistory,Panel,persisted,useUIStore,CoverAnalyzer,zh};
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
                  /(PlayQueueDrawer|PlayerSpectrum|LyricsManagerDialog|AddSongsToPlaylistDialog)\.vue$/
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
   const {Vue,createPinia,createI18n,createRouter,createMemoryHistory,Panel,persisted,useUIStore,CoverAnalyzer,zh}=PanelCheck;
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
   window.panelPolling={rate:0,spectrum:false};
   window.panelPlayer=Vue.reactive({lyricsOffsetMs:0,lyricsSettingsReady:true,songLyricSettings:{songId:0,offsetMs:null,disableNetwork:false,instrumental:false},currentQueueSong:{id:0,title:'Initial',artist:'Artist',audio:'0.flac',cover:'0'},trackInfo:null,positionMs:0,durationMs:180000,durationFormatted:'3:00',playbackSpeedConfig:{enabled:false,speed:1},volume:0.5,isPlaying:true,playMode:0,queue:[],getSongPreference:()=>0,setAudioAnalysisPollingRate(rate,spectrum){window.panelPolling={rate,spectrum}},rhythmVisualConfig:{enabled:false,reducedMotion:false,intensity:1},audioAnalysis:{rms:0,lowEnergy:0,onsetStrength:0,beatSequence:0,bpm:0,spectrum:Array(64).fill(0)}});
   window.panelPlayer.setPlayMode=mode=>{window.panelPlayer.playMode=mode};
   const policies=new Map(),settingsData=new Map(),songRequests=[];
   window.api={database:{
    saveSync:(key,value)=>{settingsData.set(key,value);return {success:true}},
    getSync:key=>({success:settingsData.has(key),data:settingsData.get(key)}),
    command:async(action,params)=>{
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
   const app=Vue.createApp({render:()=>Vue.h(Panel)});
   const pinia=createPinia();if(${cheer})pinia.use(persisted);
   app.use(pinia);app.use(createI18n({legacy:false,locale:'zh',messages:{zh},missingWarn:false,fallbackWarn:false}));
   const router=createRouter({history:createMemoryHistory(),routes:['/','/artist/detail','/album/detail'].map(path=>({path,component:{render:()=>null}}))});app.use(router);await router.push('/');await router.isReady();
   const ui=useUIStore();ui.showPlayer=true;if(${cheer})ui.setPlayerBgType('ambient');ui.setPlayerBgType(${JSON.stringify(background)});ui.lyricSourceOrder=['database'];ui.autoSearchNetworkLyrics=false;ui.showPlayerSpectrum=false;
   app.mount('#app');await window.panelWait(700);
   const appearanceButton=document.querySelector('header button[aria-haspopup=dialog]');
   if(appearanceButton?.getAttribute('aria-label')!==zh.settings.playerBackground||appearanceButton.title!==zh.settings.playerBackground||
    appearanceButton.textContent.trim()||appearanceButton.querySelector('use')?.getAttribute('xlink:href')!=='#icon-common-settings')
    throw Error('The appearance drawer entry shows only the settings icon and has an accessible label');
   const volumeButton=document.querySelector('button[aria-label="'+zh.footer.volume+'"]');
   const previousButton=document.querySelector('.panel-transport > button[title="'+zh.playerPanel.previous+'"]');
   const measureIconArtwork=async(icon)=>{
    const symbol=document.querySelector(icon.querySelector('use').getAttribute('xlink:href'));
    const button=icon.closest('button').getBoundingClientRect(),box=icon.getBoundingClientRect();
    const ratio=4,canvas=document.createElement('canvas');
    canvas.width=Math.round(button.width*ratio);canvas.height=Math.round(button.height*ratio);
    const ctx=canvas.getContext('2d');
    const artwork=new Image();
    artwork.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="'+symbol.getAttribute('viewBox')+'" fill="'+(symbol.getAttribute('fill')??'currentColor')+'">'+symbol.innerHTML+'</svg>');
    await artwork.decode();
    ctx.drawImage(artwork,(box.left-button.left)*ratio,(box.top-button.top)*ratio,box.width*ratio,box.height*ratio);
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let left=canvas.width,right=0,top=canvas.height,bottom=0;
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
      if(pixels[(y*canvas.width+x)*4+3]<128)continue;
      left=Math.min(left,x);right=Math.max(right,x+1);top=Math.min(top,y);bottom=Math.max(bottom,y+1);
    }
    const extent=Math.max(right-left,bottom-top)/ratio;
    const offset=Math.max(Math.abs((left+right)/2-canvas.width/2),Math.abs((top+bottom)/2-canvas.height/2))/ratio;
    return {icon:symbol.id,extent,offset,height:(bottom-top)/ratio};
   };
   const checkToolArtwork=async(icon)=>{
    const button=icon.closest('button').getBoundingClientRect();
    const artwork=await measureIconArtwork(icon);
    const {extent,offset}=artwork;
    const modern=ui.playerLayout==='bottom';
    if(modern&&(button.width!==28||button.height!==28))throw Error('Modern tools retain their 28 pixel hit areas');
    if(extent<(modern?15.5:12.25)||extent>(modern?18.5:15)||offset>1.25)
      throw Error('Tool artwork should be consistently sized and centered in '+ui.playerLayout+': '+JSON.stringify(artwork));
   };
   const checkControlIcons=async()=>{
    const toolIcons=[...document.querySelectorAll('.panel-tools .panel-tool svg')];
    if(!toolIcons.length||toolIcons.some(icon=>icon.getBoundingClientRect().width===0))throw Error('Wide layouts show all tool icons');
    await Promise.all(toolIcons.map(checkToolArtwork));
    const transportIcons=[...document.querySelectorAll('.panel-transport .panel-control-button svg')];
    const colors=new Set([...transportIcons,...toolIcons].map(icon=>getComputedStyle(icon).color));
    if(colors.size!==1)throw Error('Transport and utility icons share their default color: '+[...colors]);
    const initialVolume=window.panelPlayer.volume;
    for(const [value,level] of [[0,'mute'],[0.25,'low'],[0.5,'middle'],[1,'high']]){
      window.panelPlayer.volume=value;await Vue.nextTick();
      const artwork=await measureIconArtwork(volumeButton.querySelector('svg'));
      if(artwork.icon!=='icon-volume-volume-'+level||artwork.height<14||artwork.height>16)
        throw Error('All volume states use the larger speaker artwork: '+JSON.stringify(artwork));
    }
    window.panelPlayer.volume=initialVolume;await Vue.nextTick();
   };
   await checkControlIcons();
   if(${bottomControls}){
    const cover=document.querySelector('.cover-frame img'),lyrics=document.querySelector('.lyric-viewport'),play=document.querySelector('.playback-button');
    ui.playerLayout='bottom';await Vue.nextTick();await window.panelWait(600);
    const area=document.querySelector('.panel-controls').getBoundingClientRect(),art=document.querySelector('.panel-artwork').getBoundingClientRect(),text=document.querySelector('.panel-lyrics').getBoundingClientRect(),progress=document.querySelector('.ep-playback-progress').getBoundingClientRect();
    if(art.right>text.left+1||area.top<Math.max(art.bottom,text.bottom)-1||progress.width<innerWidth*0.8)throw Error('Bottom layout keeps artwork and lyrics side by side above full-width controls');
    if(!document.querySelector('.panel-controls .panel-tools')||document.querySelector('.panel-tools').getBoundingClientRect().top<progress.top)throw Error('Modern layout keeps utility buttons at the bottom right');
    await checkControlIcons();
    if(parseFloat(getComputedStyle(document.querySelector('.panel-controls')).borderTopWidth)!==0)throw Error('The progress track is the only divider in Modern layout');
    const playRect=play.getBoundingClientRect();
    if(playRect.width!==44||playRect.height!==44||play.querySelector('svg').getBoundingClientRect().width!==previousButton.querySelector('svg').getBoundingClientRect().width)throw Error('Modern play retains its original button size with an icon matching previous and next');
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
   if(!moreTrigger||document.querySelectorAll('button[aria-label="'+zh.songList.more+'"]').length!==1)throw Error('The single More button stays in the transport');
   if(volumeButton.getBoundingClientRect().width!==previousButton.getBoundingClientRect().width)throw Error('Volume uses the same hit area as the other transport controls');
   const modeButton=document.querySelector('.panel-tools button[data-panel-tool=play-mode]'),queueButton=document.querySelector('.panel-tools button[data-panel-tool=queue]');
   if(!modeButton?.getBoundingClientRect().width||!queueButton?.getBoundingClientRect().width||document.querySelector('.panel-transport button[title="'+zh.queue.title+'"],.panel-transport button[title="'+zh.queue.sequential+'"]'))
    throw Error('Playback mode and queue are both visible in the tools row');
   for(const [mode,label] of [[1,zh.queue.list],[2,zh.queue.single],[3,zh.queue.random],[0,zh.queue.sequential]]){
    modeButton.click();await Vue.nextTick();
    if(window.panelPlayer.playMode!==mode||modeButton.getAttribute('aria-label')!==label)throw Error('The moved button still cycles through every playback mode');
    await checkToolArtwork(modeButton.querySelector('svg'));
   }
   queueButton.click();await Vue.nextTick();
   if(queueButton.getAttribute('aria-expanded')!=='true')throw Error('The moved queue button opens the queue');
   queueButton.click();await Vue.nextTick();
   const audioButtons=document.querySelectorAll('button[aria-label="'+zh.footer.audioControls+'"]');
   const audioButton=audioButtons[0];
   if(audioButtons.length!==1||audioButton.title!==zh.footer.audioControls||!audioButton.closest('.panel-tools'))
    throw Error('Both layouts show audio controls in the tools row');
   let audioOpens=0;const recordAudioOpen=()=>audioOpens++;
   PanelCheck.eventBus.on('openAudioControls',recordAudioOpen);audioButton.click();PanelCheck.eventBus.off('openAudioControls',recordAudioOpen);
   if(audioOpens!==1)throw Error('The audio button uses the shared audio controls entry point');
   const details=document.querySelector('.panel-artwork dl');
   if(!details||getComputedStyle(details).backgroundColor==='rgba(0, 0, 0, 0)')throw Error('Song parameters keep their original background');
   if(['rhythm','spectrum','size','spacing','alignment','effect','colors','translation','romanization'].some(tool=>document.querySelector('[data-panel-tool="'+tool+'"]')))
    throw Error('Appearance settings are no longer duplicated in the toolbar');
   moreTrigger.click();await Vue.nextTick();await window.panelWait(100);
   if([...document.querySelectorAll('.ep-menu-item')].some(button=>[zh.playerPanel.showAudioDetails,zh.footer.audioControls,zh.ap.rhythmVisuals].includes(button.textContent.trim())))
    throw Error('Moved controls no longer appear in More');
   moreTrigger.click();await Vue.nextTick();await window.panelWait(200);
   if(document.querySelector('.ep-menu')||!ui.showPlayer)throw Error('Closing More keeps the player open');
   for(const label of [zh.footer.volume,zh.playerPanel.speed,zh.playerPanel.lyricTiming]){
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
   if(${liquid}) {
    const canvas=document.querySelector('canvas.brightness-80');
    const gl=canvas?.getContext('webgl');
    if(ui.playerBgType!=='liquid'||!gl?.getParameter(gl.CURRENT_PROGRAM))throw Error('Liquid background must remain selected and render inside the player');
   }
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
   if(${cheer}) {
    let canvas=document.querySelector('.stage-background canvas');
    if(!canvas||ui.playerCheerColor!=='#FF532D')throw Error('The cheer background opens with the red show palette');
    const {CheerBeatClock,cheerReach,StageDirector,flushPlayerDataStorage}=PanelCheck;
    const clock=new CheerBeatClock();
    const drum={bpm:120,beatSequence:1,rms:0.2,lowEnergy:0.1,onsetStrength:0.18};
    clock.sample(drum,1,0);
    const reach=time=>cheerReach(clock.frame(time).beat);
    if(reach(0)!==1||reach(40)!==1||reach(315)>0.001||reach(500)!==1)
      throw Error('At 120 BPM each half second completes one lift and return without jumping');
    if(cheerReach(0.2)<0.8||cheerReach(0.83)<0.55||Math.abs(cheerReach(-0.001)-cheerReach(0.001))>0.001)
      throw Error('The seated gesture lowers slowly, pushes upward and joins smoothly across beats');
    const before=clock.frame(535);
    clock.sample({...drum,beatSequence:2},1,535);
    const after=clock.frame(535);
    if(before.beat!==after.beat||before.strength!==after.strength)throw Error('A late drum event cannot jump the arm or change its amplitude');
    clock.sample({...drum,beatSequence:3},1,750);
    if(reach(1000)<0.98||reach(1500)<0.96)throw Error('Off-beat events and missed beats cannot restart the gesture');
    clock.sample({...drum,rms:0,lowEnergy:0,beatSequence:3},1,1500);
    if(clock.frame(1550).strength<0.8||clock.frame(3500).strength>0.04)throw Error('A quiet passage lets the motion settle gradually');
    clock.reset(0);
    clock.sample({...drum,bpm:0},1,0);clock.sample({...drum,bpm:0,beatSequence:2},1,600);
    if(reach(978)>0.001||reach(1200)!==1)throw Error('Drum intervals supply the tempo before BPM is available');
    const compareSections=volume=>{
      const motion=new CheerBeatClock();let time=0;
      const play=(rms,duration,gain=0.6)=>{
        const until=time+duration;
        for(;time<until;time+=50)motion.sample({bpm:120,rms:rms*volume,lowEnergy:0,onsetStrength:0,beatSequence:0},gain,time);
        return motion.frame(time);
      };
      const quiet=play(0.07,6000);
      play(0.65,50);
      const afterHit=play(0.07,300);
      const loud=play(0.16,3650);
      const softAgain=play(0.07,2500);
      const disabled=play(0.16,2500,0);
      if(quiet.strength<0.06||quiet.strength>0.24||afterHit.strength>quiet.strength+0.07||loud.strength<0.5||loud.strength<2.4*quiet.strength||softAgain.strength>0.25||disabled.strength>0.01)
        throw Error('Sustained sections should swing at different heights across listening volumes: '+[volume,quiet.strength,afterHit.strength,loud.strength,softAgain.strength,disabled.strength]);
      const phaseError=Math.abs(quiet.beat-loud.beat);
      if(Math.min(phaseError,4-phaseError)>0.001)throw Error('Section energy should change amplitude without changing the beat grid');
    };
    compareSections(1);compareSections(1/3);
    if(cheerReach(1,2)!==1||cheerReach(3,2)!==1||cheerReach(0.5,2)<0.45||cheerReach(0,2)>0.12)
      throw Error('The two-beat gesture rises through beat 1 and peaks on beat 2');
    if(cheerReach(3,4)!==1||cheerReach(0,4)<0.2||cheerReach(1,4)<0.08||cheerReach(2,4)<0.55||cheerReach(2.5,4)<0.85)
      throw Error('The four-beat gesture passes smoothly through lowering, preparation and lift');
    const patterns=new CheerBeatClock();
    let elapsed=0,beatSequence=0,lastPattern=patterns.frame(0);
    const section=(rms,lowEnergy,onsetStrength,hasDrums=true)=>{
      const until=elapsed+6000;
      for(;elapsed<until;elapsed+=20){
        const hit=hasDrums&&elapsed%500===0;
        if(hit)beatSequence++;
        patterns.sample({bpm:120,rms,lowEnergy,onsetStrength:hit?onsetStrength:0,beatSequence},0.6,elapsed);
        const current=patterns.frame(elapsed);
        if(current.period!==lastPattern.period){
          if(current.beat<2.999||current.beat>3.05||cheerReach(current.beat,current.period,current.previousPeriod,current.periodBlend)<0.99)
            throw Error('Switching periods should share the top of the gesture on beat 4');
        }
        lastPattern=current;
      }
      return lastPattern.period;
    };
    const periods=[section(0.035,0.011,0.01),section(0.075,0.024,0.02),section(0.18,0.09,0.13),section(0.18,0.002,0,false),section(0.035,0.011,0.01)];
    if(periods.join(',')!=='4,2,1,2,4')throw Error('Quiet, steady, and rhythmically intense sections should choose distinct gestures: '+periods);
    const director=new StageDirector();director.advance(5.6);director.onBeat(1);
    if(director.pose().eye[1]!==33)throw Error('The cheer camera cuts to the stands after the establishing shot');
    director.advance(12);
    const balcony=director.pose(),balconyProject=PanelCheck.stageProjection(balcony,960,540);
    const stageCenter=balconyProject([0,13,18]), farSection=balconyProject([70,16,-64]);
    if(!(balcony.eye[0]<-115&&stageCenter?.x>0&&farSection?.x<960&&stageCenter.x<farSection.x))
      throw Error('The high cheer camera looks past the crowd toward the stage and the opposite stands');
    const rearCenter=[0,23,-136];
    const inFrame=(p,width,height)=>p&&p.x>0&&p.x<width&&p.y>0&&p.y<height;
    for(const [width,height] of [[960,540],[640,600]]){
      if(!inFrame(PanelCheck.stageProjection(balcony,width,height)(rearCenter),width,height))
        throw Error('The existing high overlook frames the completed rear stands');
    }
    director.advance(12);
    const sweepStart=director.pose();
    director.advance(4.5);
    const sweepMove=director.pose();
    if(sweepStart.eye[0]===sweepMove.eye[0]||!inFrame(PanelCheck.stageProjection(sweepMove,960,540)(rearCenter),960,540))
      throw Error('The new upper-stand sweep travels while keeping the rear seats in frame');
    director.advance(5.2);
    const reverse=director.pose(),reverseProject=PanelCheck.stageProjection(reverse,960,540);
    if(reverse.eye[2]>-132||!inFrame(reverseProject([0,13,18]),960,540)||!inFrame(reverseProject([0,20,-119]),960,540))
      throw Error('The reverse camera looks over the rear crowd toward the stage');
    const pixels=document.createElement('canvas');pixels.width=canvas.width;pixels.height=Math.floor(canvas.height*0.38);
    const pixelContext=pixels.getContext('2d',{willReadFrequently:true});
    const colorPixels=(isWarm)=>{
      pixelContext.drawImage(canvas,0,Math.floor(canvas.height*0.61),pixels.width,pixels.height,0,0,pixels.width,pixels.height);
      const image=pixelContext.getImageData(0,0,pixels.width,pixels.height).data;
      let count=0;
      for(let index=0;index<image.length;index+=4){
        const [r,g,b]=[image[index],image[index+1],image[index+2]];
        if(isWarm==='red'?r>113&&r>g+45&&g>b+12:isWarm?r>95&&r>g+35&&b>g+10:g>86&&g>r+24&&b>r+19)count++;
      }
      return count;
    };
    if(colorPixels('red')<500)throw Error('The default red lightsticks and their glow must appear throughout the crowd');
    ui.setPlayerCheerColor('#53E5D2');await Vue.nextTick();await window.panelWait(80);
    if(colorPixels(false)<200)throw Error('An existing custom cheer color still renders throughout the crowd');
    appearanceButton.click();await Vue.nextTick();await window.panelWait(360);
    if(appearanceButton.getAttribute('aria-expanded')!=='true')throw Error('The settings icon opens the combined appearance drawer');
    const settings=document.querySelector('.ep-drawer');
    const drawer=settings?.querySelector('.player-appearance-drawer');
    const bounds=drawer?.getBoundingClientRect();
    if(!bounds||Math.abs(bounds.right-innerWidth)>2||bounds.width>421||bounds.height<innerHeight-2)
      throw Error('Appearance opens as a full-height right drawer: '+JSON.stringify({bounds,width:innerWidth,height:innerHeight}));
    const cards=[...drawer.querySelectorAll('.theme-options button')].map(card=>card.getBoundingClientRect());
    if(cards.length!==8||cards.some(card=>Math.abs(card.width-cards[0].width)>0.1||Math.abs(card.height-cards[0].height)>0.1))
      throw Error('Cover and background previews use the same card dimensions');
    const drawerBody=drawer.querySelector('.ep-drawer-body'),tabs=drawer.querySelector('.appearance-tabs');
    if(tabs.querySelectorAll('button').length!==2)throw Error('Cheer settings share the cover and background tab');
    if(drawerBody.contains(tabs))throw Error('The group selector is outside the scroll area');
    const tabTop=tabs.getBoundingClientRect().top;
    drawerBody.style.maxHeight='240px';drawerBody.scrollTop=120;
    if(drawerBody.scrollTop<100||Math.abs(tabs.getBoundingClientRect().top-tabTop)>0.1)
      throw Error('The group selector stays below the title while content scrolls');
    drawerBody.scrollTop=0;drawerBody.style.removeProperty('max-height');
    const activateTab=async(label)=>{
      const tab=[...drawer.querySelectorAll('.appearance-tabs button')].find(item=>item.textContent.trim()===label);
      tab.click();await Vue.nextTick();
    };
    const selectValue=async(label,value)=>{
      const trigger=drawer.querySelector('button[aria-haspopup=listbox][aria-label="'+label+'"]');
      if(!trigger)throw Error('Missing moved selector: '+label);
      trigger.click();await Vue.nextTick();await window.panelWait(110);
      const option=[...drawer.querySelectorAll('[role=option]')].find(item=>item.textContent.trim()===value);
      if(!option)throw Error('Missing moved choice: '+value);
      option.click();await Vue.nextTick();
    };
    const chosen=(label)=>[...drawer.querySelectorAll('button[role=radio]')].find(item=>item.textContent.trim()===label);
    if(drawer.querySelectorAll('.player-background-options [role=radio]').length!==6||chosen(zh.settings.playerBackgroundCheer)?.getAttribute('aria-checked')!=='true')
      throw Error('The drawer includes every supported background and shows the active theme');
    chosen(zh.settings.playerCoverStyleVinyl).click();await Vue.nextTick();
    if(ui.playerCoverStyle!=='vinyl')throw Error('The cover style applies in the open player');
    chosen(zh.settings.playerCoverStyleStandard).click();await Vue.nextTick();
    await selectValue(zh.settings.playerCoverEffect,zh.settings.playerCoverEffectNone);
    if(ui.playerCoverEffect!=='none')throw Error('The cover effect can be disabled from the player');
    await selectValue(zh.settings.playerCoverEffect,zh.settings.playerCoverEffectGlow);
    await selectValue(zh.settings.playerLayout,zh.settings.playerLayoutBottom);
    if(ui.playerLayout!=='bottom'||!drawer.isConnected)throw Error('Changing layout keeps the settings drawer open');
    await selectValue(zh.settings.playerLayout,zh.settings.playerLayoutClassic);
    const switchState=async(label,key)=>{
      const toggle=drawer.querySelector('button[role=switch][aria-label="'+label+'"]');
      if(!toggle)throw Error('Missing moved switch: '+label);
      const initial=ui[key];toggle.click();await Vue.nextTick();
      if(ui[key]===initial)throw Error('Moved switch did not update: '+label);
      if(key==='showPlayerAudioDetails'&&!!document.querySelector('.panel-artwork dl')!==ui[key])
        throw Error('The details switch applies immediately in the open player');
      if(key==='showPlayerSpectrum'&&(!window.panelPolling.spectrum||window.panelPolling.rate!==20))
        throw Error('The spectrum switch controls the analysis subscription');
      toggle.click();await Vue.nextTick();
    };
    await switchState(zh.playerPanel.showAudioDetails,'showPlayerAudioDetails');
    await activateTab(zh.settings.groups.lyricVisuals);
    await selectValue(zh.playerPanel.lyricSource,zh.lyrics.source.database);
    if(ui.lyricSourceMode!=='database')throw Error('The appearance drawer updates the playback lyrics source');
    await selectValue(zh.playerPanel.lyricSource,zh.playerPanel.lyricSourceAuto);
    if(ui.lyricSourceMode!=='auto')throw Error('The drawer can restore the configured source priority');
    const rhythmSwitch=drawer.querySelector('button[role=switch][aria-label="'+zh.ap.rhythmVisuals+'"]');
    const wasRhythmEnabled=window.panelPlayer.rhythmVisualConfig.enabled;
    if(!rhythmSwitch||rhythmSwitch.getAttribute('aria-checked')!==String(wasRhythmEnabled))
      throw Error('The appearance panel reflects the existing rhythm visuals preference');
    rhythmSwitch.click();await Vue.nextTick();
    if(window.panelPlayer.rhythmVisualConfig.enabled===wasRhythmEnabled)throw Error('The new switch updates rhythm visuals');
    rhythmSwitch.click();await Vue.nextTick();
    const checkSliderRow=(input)=>{
      const row=input?.closest('.appearance-slider');
      const label=row?.querySelector('h3').getBoundingClientRect();
      const track=input?.getBoundingClientRect();
      const value=row?.querySelector('[aria-hidden=true]').getBoundingClientRect();
      if(!label||!track||!value||track.width<32||label.right>track.left||track.right>value.left||
         Math.abs(label.top+label.height/2-track.top-track.height/2)>2)
        throw Error('Slider labels, tracks and values stay on the same row: '+input?.getAttribute('aria-label'));
    };
    const setAppearanceRange=async(label,value)=>{
      const slider=drawer.querySelector('input[type=range][aria-label="'+label+'"]');
      checkSliderRow(slider);
      slider.value=value;slider.dispatchEvent(new Event('input',{bubbles:true}));await Vue.nextTick();
    };
    await setAppearanceRange(zh.playerPanel.lyricFontSize,'1.5');
    await setAppearanceRange(zh.playerPanel.lyricSpacing,'45');
    if(Math.abs(ui.lyricsFontSize-3.6)>0.001||ui.lyricsFontPadding!==45)
      throw Error('Lyrics sliders retain the original value ranges and update the player');
    await setAppearanceRange(zh.playerPanel.lyricFontSize,'1');
    await setAppearanceRange(zh.playerPanel.lyricSpacing,'30');
    await selectValue(zh.playerPanel.lyricAlignment,zh.playerPanel.alignRight);
    if(ui.lyricsAlignment!=='right')throw Error('Lyric alignment applies from the drawer');
    await selectValue(zh.playerPanel.lyricAlignment,zh.playerPanel.alignCenter);
    await selectValue(zh.playerPanel.lyricEffect,zh.playerPanel.lyricEffectFollow);
    if(ui.lyricsStyle!=='follow')throw Error('Lyric style applies from the drawer');
    await selectValue(zh.playerPanel.lyricEffect,zh.playerPanel.lyricEffectNone);
    await switchState(zh.playerPanel.showTranslation,'showLyricsTranslation');
    await switchState(zh.playerPanel.showRomanization,'showLyricsRomanization');
    const pauseOnBlur=ui.pauseAnimationsOnBlur;ui.pauseAnimationsOnBlur=false;
    await switchState(zh.playerPanel.showSpectrum,'showPlayerSpectrum');
    ui.pauseAnimationsOnBlur=pauseOnBlur;
    await selectValue(zh.settings.playerLyricsFont,zh.settings.fontMiSans);
    if(ui.playerLyricsFontFamily!=='MiSans')throw Error('The lyrics font applies in the player');
    await selectValue(zh.settings.playerLyricsFont,zh.settings.playerLyricsFontInherit);
    await selectValue(zh.settings.playerLyricsFontWeight,zh.settings.lyricsFontWeightRegular);
    if(ui.playerLyricsFontWeight!==400)throw Error('The lyrics weight applies in the player');
    await selectValue(zh.settings.playerLyricsFontWeight,zh.settings.lyricsFontWeightBold);
    await selectValue(zh.settings.karaokeAnimation,zh.settings.karaokeAnimationFloat);
    if(ui.karaokeAnimation!=='float')throw Error('Karaoke animation is configurable in the drawer');
    await selectValue(zh.settings.karaokeAnimation,zh.settings.karaokeAnimationWave);
    await selectValue(zh.settings.playerSpectrumStyle,zh.settings.playerSpectrumDots);
    if(ui.playerSpectrumStyle!=='dots')throw Error('Spectrum style is configurable in the drawer');
    await selectValue(zh.settings.playerSpectrumStyle,zh.settings.playerSpectrumBars);
    await switchState(zh.settings.autoAdjustLyricsDisplay,'autoAdjustLyricsDisplay');
    const autoSwitch=drawer.querySelector('button[role=switch][aria-label="'+zh.settings.autoAdjustLyricsDisplay+'"]');
    const resetProportions=autoSwitch.closest('.setting-row').querySelector('button[aria-label="'+zh.playerPanel.resetLyricsProportions+'"]');
    if(autoSwitch.closest('.setting-row')?.querySelector('h3')?.textContent.trim()!==zh.settings.autoAdjustLyricsDisplay||
      autoSwitch.querySelector('use')?.getAttribute('xlink:href')!=='#icon-common-size')
      throw Error('The automatic lyrics sizing row shows its label and icon switch');
    if(!resetProportions||Math.abs(resetProportions.getBoundingClientRect().y+resetProportions.offsetHeight/2-autoSwitch.getBoundingClientRect().y-autoSwitch.offsetHeight/2)>2)
      throw Error('Reset proportions appears beside the automatic lyrics switch');
    const autoMode=ui.autoAdjustLyricsDisplay,alignmentBeforeReset=ui.lyricsAlignment;
    await setAppearanceRange(zh.playerPanel.lyricFontSize,'0.7');
    await setAppearanceRange(zh.playerPanel.lyricSpacing,'6');
    resetProportions.click();await Vue.nextTick();
    const metrics=PanelCheck.getAutomaticLyricsMetrics(outerWidth,outerHeight,screen.availWidth,screen.availHeight);
    if(ui.lyricsFontSize!==metrics.fontSize||ui.lyricsFontPadding!==metrics.padding||ui.autoAdjustLyricsDisplay!==autoMode||ui.lyricsAlignment!==alignmentBeforeReset)
      throw Error('Reset proportions recomputes size and spacing for the window while preserving the auto switch and alignment');
    const expandDisclosure=async(details)=>{
      const summary=details.querySelector('summary'),chevron=summary.querySelector('svg');
      if(chevron?.querySelector('use')?.getAttribute('xlink:href')!=='#icon-arrow-arrow-down'||getComputedStyle(chevron).rotate!=='none')
        throw Error('Collapsed settings show the shared down arrow');
      summary.click();await Vue.nextTick();
      if(!details.open||getComputedStyle(chevron).rotate!=='180deg')throw Error('Settings expand and turn the arrow up');
    };
    const colors=drawer.querySelector('details.lyrics-colors');
    await expandDisclosure(colors);
    const preview=colors.querySelector('.lyrics-color-preview');
    const colorPicker=colors.querySelector('button[aria-label="'+zh.playerPanel.lyricColorHighlight+'"]');
    if(!preview||preview!==preview.parentElement.firstElementChild||preview.getBoundingClientRect().bottom>colorPicker.getBoundingClientRect().top)
      throw Error('The lyrics preview appears before the color controls');
    const contrastSwitch=colors.querySelector('button[role=switch][aria-label="'+zh.playerPanel.lyricColorOverrideAuto+'"]');
    const colorReset=contrastSwitch.closest('.setting-row').querySelector('button[aria-label="'+zh.playerPanel.lyricColorsReset+'"]');
    const contrastHint=document.getElementById(contrastSwitch.getAttribute('aria-describedby'));
    if(contrastHint?.textContent.trim()!==zh.playerPanel.lyricColorOverrideAutoHint||!colorReset?.querySelector('svg')||
      contrastSwitch.offsetWidth!==autoSwitch.offsetWidth||contrastSwitch.offsetHeight!==autoSwitch.offsetHeight)
      throw Error('The contrast row uses the same icon controls as automatic sizing and keeps its hint');
    const oldContrast=ui.lyricsColors.overrideAutoContrast;
    contrastSwitch.click();await Vue.nextTick();
    if(ui.lyricsColors.overrideAutoContrast===oldContrast||contrastSwitch.getAttribute('aria-checked')!==String(!oldContrast))
      throw Error('The icon switch toggles the contrast override');
    contrastSwitch.click();await Vue.nextTick();
    const oldColor=ui.lyricsColors.highlight;
    colorPicker.click();
    await Vue.nextTick();await window.panelWait(180);
    const hex=colors.querySelector('input[aria-label="'+zh.ui.colorValue+'"]');
    hex.value='#66aaff';hex.dispatchEvent(new Event('input',{bubbles:true}));await Vue.nextTick();
    hex.dispatchEvent(new FocusEvent('blur'));await Vue.nextTick();
    if(!ui.lyricsColors.highlight.toLowerCase().startsWith('#66aaff'))throw Error('Editing a lyrics color changes the stored value');
    colorReset.click();
    await Vue.nextTick();
    if(ui.lyricsColors.highlight!==oldColor)throw Error('Reset restores the default lyric colors');
    await activateTab(zh.settings.groups.artwork);
    const cheerDisclosure=()=>drawer.querySelector('details.player-cheer-settings');
    const expandCheerSettings=async()=>{
      const details=cheerDisclosure();
      if(!details?.previousElementSibling?.classList.contains('player-background-options')||details.open)
        throw Error('The selected cheer background shows collapsed settings below the background cards');
      await expandDisclosure(details);
    };
    await expandCheerSettings();
    cheerDisclosure().querySelector('summary').click();await Vue.nextTick();
    if(cheerDisclosure().open)throw Error('The cheer settings can be collapsed again');
    await expandCheerSettings();
    settings.querySelector('.ep-color-trigger').click();await Vue.nextTick();await window.panelWait(180);
    const colorInput=document.querySelector('input[aria-label="'+zh.ui.colorValue+'"]');
    if(!colorInput)throw Error('The cheer theme offers a custom color picker');
    colorInput.value='#ff3d92';colorInput.dispatchEvent(new Event('input',{bubbles:true}));await Vue.nextTick();
    colorInput.dispatchEvent(new FocusEvent('blur'));
    await Vue.nextTick();await window.panelWait(80);
    const customPixels=colorPixels(true), tealPixels=colorPixels(false);
    if(ui.playerCheerColor!=='#FF3D92'||customPixels<200||customPixels<tealPixels*2)
      throw Error('Editing a custom color immediately recolors the actual lightsticks: '+[ui.playerCheerColor,customPixels,tealPixels]);
    const range=(label)=>settings.querySelector('input[type=range][aria-label="'+label+'"]');
    const {cheerDensity,cheerUniformity,cheerBrightness}=zh.playerPanel;
    const paintStage=async()=>{await Vue.nextTick();await new Promise(requestAnimationFrame)};
    const changeLight=async(label,value)=>{
      const input=range(label);input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));
      await paintStage();
    };
    if(range(cheerDensity)?.value!=='65'||range(cheerUniformity)?.value!=='50'||range(cheerBrightness)?.value!=='100')
      throw Error('Existing cheer preferences use the original light defaults');
    for(const label of [cheerDensity,cheerUniformity,cheerBrightness])checkSliderRow(range(label));
    await changeLight(cheerDensity,0);
    if(colorPixels(true)>customPixels/3)throw Error('Zero density turns off the lightsticks');
    await changeLight(cheerDensity,100);
    if(colorPixels(true)<=customPixels)throw Error('Full density lights more occupied seats');
    await changeLight(cheerBrightness,0);
    if(colorPixels(true)>customPixels/3)throw Error('Zero brightness turns off the lightsticks and spill');
    await changeLight(cheerDensity,39);await changeLight(cheerBrightness,120);
    const looserLights=canvas.toDataURL();
    await changeLight(cheerUniformity,87);
    if(looserLights===canvas.toDataURL())throw Error('Uniformity updates the lightstick positions in the rendered scene');
    if(range(cheerBrightness).getAttribute('aria-valuetext')!=='120%')throw Error('The slider exposes its live percentage');
    flushPlayerDataStorage();
    const saved=JSON.parse(settingsData.get('pinia.ui.preferences.v1'));
    if(saved.playerBgType!=='cheer'||saved.playerBgTypeBeforeCheer!=='ambient'||saved.playerCheerColor!=='#FF3D92')throw Error('The cheer theme, original background and custom color are persisted');
    const restore=PanelCheck.deserializeUIPreferences;
    const restored=restore(JSON.stringify(saved)).playerCheerLights;
    if(restored.density!==39||restored.uniformity!==87||restored.brightness!==120)throw Error('Light controls persist and restore independently');
    const clamped=restore(JSON.stringify({playerCheerLights:{density:-30,uniformity:'80',brightness:180}})).playerCheerLights;
    if(clamped.density!==0||clamped.uniformity!==50||clamped.brightness!==150)throw Error('Restored light controls use defaults and clamp invalid values');
    const legacy=restore(JSON.stringify({playerBgType:'stage',playerBgTypeBeforeCheer:'stage',playerCheerColor:'#123456'}));
    if(legacy.playerBgType!=='cheer'||legacy.playerBgTypeBeforeCheer!=='album'||legacy.playerCheerColorMode!=='single'||legacy.playerCheerColor!=='#123456')
      throw Error('Legacy Stage moves to single-color cheer, using the album background when cheer is turned off');
    const selectMode=async(label)=>{
      const option=[...settings.querySelectorAll('button[aria-pressed]')].find(button=>button.textContent.trim()===label);
      if(!option)throw Error('Missing color mode: '+label);
      option.click();await paintStage();
      if(option.getAttribute('aria-pressed')!=='true')throw Error('The selected color mode is reflected in the control');
    };
    const {cheerSingleColor,cheerMixedColors,cheerAddColor}=zh.playerPanel;
    await selectMode(cheerMixedColors);
    if(colorPixels('red')<150||colorPixels(false)<150)throw Error('Mixed mode draws warm and teal lightsticks simultaneously');
    const addColor=[...settings.querySelectorAll('button')].find(button=>button.textContent.trim()===cheerAddColor);
    if(!addColor)throw Error('Missing add-color control');
    addColor.click();await Vue.nextTick();
    if(ui.playerCheerColors.length!==4||!addColor.disabled)throw Error('The palette accepts at most four colors');
    const removePrefix=zh.playerPanel.cheerRemoveColor.split('{number}')[0];
    const removeButtons=()=>[...settings.querySelectorAll('button[aria-label]')].filter(button=>button.getAttribute('aria-label').startsWith(removePrefix));
    if(removeButtons().length!==4)throw Error('Each palette slot has a remove control');
    removeButtons()[3].click();await Vue.nextTick();removeButtons()[2].click();await Vue.nextTick();
    if(ui.playerCheerColors.length!==2||removeButtons().some(button=>!button.disabled))throw Error('Mixed mode keeps at least two colors');
    const secondPicker=settings.querySelectorAll('.ep-color-trigger')[1];
    secondPicker.click();await Vue.nextTick();await window.panelWait(180);
    const mixedInput=document.querySelector('input[aria-label="'+zh.ui.colorValue+'"]');
    mixedInput.value='#35ffa0';mixedInput.dispatchEvent(new Event('input',{bubbles:true}));await Vue.nextTick();
    mixedInput.dispatchEvent(new FocusEvent('blur'));await Vue.nextTick();
    if(ui.playerCheerColors.join(',')!=='#FF532D,#35FFA0')throw Error('Each color can be edited independently');
    flushPlayerDataStorage();
    const mixedSaved=restore(settingsData.get('pinia.ui.preferences.v1'));
    if(mixedSaved.playerCheerColorMode!=='mixed'||mixedSaved.playerCheerColors.join(',')!=='#FF532D,#35FFA0')
      throw Error('Mixed mode and its custom colors restore from persisted preferences');
    await selectMode(cheerSingleColor);
    if(ui.playerCheerColor!=='#FF3D92'||colorPixels(true)<150)throw Error('Switching to single color restores its independent color');
    chosen(zh.settings.playerBackgroundAmbient).click();await Vue.nextTick();
    if(ui.playerBgType!=='ambient'||cheerDisclosure())throw Error('Selecting another background hides the cheer settings');
    for(let i=0;i<24&&document.querySelector('.stage-background');i++)await window.panelWait(45);
    if(document.querySelector('.stage-background'))throw Error('The arena unmounts when the background transition ends');
    if(canvas.width||canvas.height)throw Error('Unmounting the arena releases its canvas backing store');
    chosen(zh.settings.playerBackgroundCheer).click();await Vue.nextTick();await window.panelWait(180);
    await expandCheerSettings();
    canvas=document.querySelector('.stage-background canvas');
    if(ui.playerCheerColor!=='#FF3D92'||!canvas)throw Error('Returning to cheer restores the custom color');
    if(range(cheerDensity).value!=='39'||range(cheerUniformity).value!=='87'||range(cheerBrightness).value!=='120')
      throw Error('Returning to cheer keeps all light controls');
    const {rhythmVisualConfig,audioAnalysis}=window.panelPlayer;
    ui.reduceMotion=false;ui.pauseAnimationsOnBlur=false;rhythmVisualConfig.enabled=true;
    await Vue.nextTick();await window.panelWait(80);
    if(window.panelPolling.rate!==20||!window.panelPolling.spectrum)throw Error('Cheer follows the native beat without displaying the spectrum');
    const idle=canvas.toDataURL();
    Object.assign(audioAnalysis,{beatSequence:1,bpm:120,rms:0.4,lowEnergy:0.3,onsetStrength:0.2});
    await window.panelWait(140);
    if(cheerDisclosure().querySelector('dd')?.textContent.trim()!=='120')throw Error('The playback settings display detected BPM');
    cheerDisclosure().querySelector('summary').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    await window.panelWait(300);
    if(document.querySelector('.ep-drawer')||!ui.showPlayer)throw Error('Escape dismisses the appearance drawer without closing the player');
    if(canvas.toDataURL()===idle)throw Error('The crowd should move on the beat');
    ui.reduceMotion=true;await paintStage();
    const still=canvas.toDataURL();
    audioAnalysis.beatSequence++;await window.panelWait(120);
    if(window.panelPolling.rate!==0||canvas.toDataURL()!==still)throw Error('Reduced motion holds a still cheer scene');
    ui.reduceMotion=false;rhythmVisualConfig.enabled=false;
   }
   if(${cheerGeometry}) {
    const canvas=document.querySelector('.stage-background canvas');
    if(ui.playerBgType!=='cheer'||!canvas||canvas.width<=300)throw Error('The arena renders through the cheer background preference');
    const {StageMusic,spotlightCue,markerIntensity}=PanelCheck;
    const isolated=[[0,24],[24,47],[47,64]].map(([start,end])=>({
      rms:0.23,lowEnergy:0,onsetStrength:0,bpm:120,beatSequence:0,
      spectrum:Array.from({length:64},(_,index)=>index>=start&&index<end?0.7:0)
    }));
    const cues=isolated.map(sample=>{
      const music=new StageMusic();music.sample(sample,1);
      for(let frame=0;frame<30;frame++)music.advance(1/30);
      return music.levels;
    });
    [[27,false],[15,true],[45,true]].forEach(([x,hanging],index)=>{
      const matching=spotlightCue(x,hanging,cues[index]);
      const other=spotlightCue(x,hanging,cues[(index+1)%cues.length]);
      if(matching.opacity-other.opacity<0.09||Math.hypot(...matching.aim.map((value,axis)=>value-other.aim[axis]))<2)
        throw Error('At equal RMS, each frequency band must change its own lights and projected targets');
    });
    const music=new StageMusic();
    music.sample({...isolated[0],onsetStrength:0.2,beatSequence:1},1);
    const chaseDifference=()=>markerIntensity(0,false,music.levels)-markerIntensity(1,false,music.levels);
    if(chaseDifference()<0.2)throw Error('The runway chase starts on the detected beat');
    const before=spotlightCue(27,false,music.levels).aim[0];
    for(let frame=0;frame<15;frame++)music.advance(1/30);
    if(chaseDifference()>-0.07||Math.abs(spotlightCue(27,false,music.levels).aim[0]-before)<1)
      throw Error('The runway chase reaches the thrust tip while the moving fixtures pan');
    music.reset(1);
    music.sample({...isolated[0],beatSequence:1},1);
    if(music.levels.pulse!==0||music.levels.kick!==0)throw Error('Reset must not replay the previous beat');
    const director=new PanelCheck.StageDirector();
    const project=PanelCheck.stageProjection(director.pose(),canvas.width,canvas.height);
    const {mainScreen,wingScreens,stageDeckHeight}=PanelCheck;
    const wingDepth=wingScreens[0][0][2];
    const centerDepth=mainScreen[0][2];
    if(!wingScreens.every(panel=>panel.every(point=>point[2]===wingDepth))||
      !mainScreen.every(point=>point[2]===centerDepth)||centerDepth<=wingDepth)throw Error('The three screen housings keep the main panel recessed');
    const centerOf=([first,,opposite])=>first.map((value,index)=>(value+opposite[index])/2);
    const screen=project(centerOf(mainScreen));
    const wings=wingScreens.map(wing=>project(centerOf(wing)));
    const pixelSample=document.createElement('canvas');pixelSample.width=pixelSample.height=1;
    const pixelContext=pixelSample.getContext('2d',{willReadFrequently:true});
    const pixel=(point)=>{
      pixelContext.drawImage(canvas,Math.round(point.x),Math.round(point.y),1,1,0,0,1,1);
      return pixelContext.getImageData(0,0,1,1).data;
    };
    const waitForWings=async(check,message)=>{
      for(let i=0;i<20;i++){
        if(wings.every(wing=>check(pixel(wing))))return;
        await window.panelWait(40);
      }
      throw Error(message+': '+wings.map(wing=>[...pixel(wing)].join(',')).join(' | '));
    };
    const blank=([r,g,b])=>Math.max(r,g,b)<125;
    const pink=([r,g])=>r>150&&r>g*1.35;
    await waitForWings(pink,'Both wing screens must center the current cover');
    if(!blank(pixel(screen)))throw Error('The main panel must stay blank while the wing screens show artwork');
    const song=window.panelPlayer.currentQueueSong;
    window.panelPlayer.currentQueueSong={...song,cover:'2'};
    await waitForWings(([r,g])=>g>140&&g>r*1.45,'Both wing screens must replace artwork after switching tracks');
    if(!blank(pixel(screen)))throw Error('The main panel must stay blank after changing covers');
    window.panelPlayer.currentQueueSong={...song,cover:''};
    await waitForWings(blank,'A song without a cover must clear both wing screens');
    window.panelPlayer.currentQueueSong=song;
    await waitForWings(pink,'The wing screens must restore artwork when it is available');
    director.advance(5);
    director.onBeat(1);
    const center=PanelCheck.stageProjection(director.pose(),960,540);
    if(director.pose().eye[0]!==0||director.pose().eye[2]<=-110||center([0,stageDeckHeight,-46]).x!==center([0,17.5,24]).x)throw Error('The front shot moves along the central aisle and holds for at least 5.5 seconds');
    director.advance(0.6);
    director.onBeat(0.4);
    if(director.pose().eye[0]!==0)throw Error('A weaker beat off the four-beat count holds the shot');
    director.onBeat(0.83);
    const sidePose=director.pose();
    if(sidePose.eye[1]!==33)throw Error('A strong beat cuts to the side camera');
    for(let cut=0;cut<4;cut++)director.advance(12);
    const floorView=director.pose();
    if(floorView.eye[1]!==9)throw Error('The floor camera follows the rear stands');
    director.advance(10.5);
    const tracking=director.pose();
    const trackFrame=PanelCheck.stageProjection(tracking,960,540);
    const runwayHead=trackFrame([0,stageDeckHeight,-46]);
    if(tracking.eye[0]<15||runwayHead.x<=0||runwayHead.x>=960||runwayHead.y<=0||runwayHead.y>=540)throw Error('The tracking shot keeps the lit thrust platform in frame');
    director.advance(10.5);
    const nearStart=director.pose();
    const assertNearStage=()=>{
      const pose=director.pose();
      for(const [width,height] of [[960,540],[640,600]]){
        const camera=PanelCheck.stageProjection(pose,width,height);
        const floorCamera=PanelCheck.stageProjection(floorView,width,height);
        const keys=[[-14,stageDeckHeight+1.93,16.7],[14,stageDeckHeight+1.93,16.7]];
        const subjects=[...keys,[0,stageDeckHeight,5],[0,34.8,14]].map(camera);
        if(subjects.some(p=>!p||p.x<=0||p.x>=width||p.y<=0||p.y>=height))throw Error('The stage close-up frames both keyboards, deck and lighting rig');
        const [leftKey,rightKey]=subjects;
        const [floorLeft,floorRight]=keys.map(floorCamera);
        if(rightKey.x-leftKey.x<(floorRight.x-floorLeft.x)*1.32)throw Error('The stage close-up reads closer than the arena floor camera');
      }
    };
    assertNearStage();
    director.advance(3.9);
    director.onBeat(1);
    assertNearStage();
    if(director.pose().eye[0]<=nearStart.eye[0]||director.pose().eye[2]<=nearStart.eye[2])throw Error('The stage close-up drifts diagonally before its next eligible cut');
    director.advance(0.3);
    director.onBeat(1);
    const side=PanelCheck.stageProjection(sidePose,960,540);
    if(side([0,17.5,24]).x>=side([0,stageDeckHeight,-46]).x)throw Error('The elevated side shot frames the stage and opposite stands');
    const {createArenaGeometry,createArenaOcclusion,isInsideArenaFloor}=PanelCheck;
    if([-58,58].some(x=>isInsideArenaFloor(x,-68))||isInsideArenaFloor(16,-96)||!isInsideArenaFloor(49,-65))
      throw Error('The floor seats must stop at the clear aisle inside the lowest tier');
    const arenaOcclusion=createArenaOcclusion(createArenaGeometry(),side,960,540);
    const occludeAt=world=>{
      const point=side(world);
      return arenaOcclusion([point.x-1,point.y-1,2,2],point.depth);
    };
    if(occludeAt([58,1.2,-68])!==null||occludeAt([49,1.2,-65])?.length!==0)
      throw Error('The opposite tier must hide seats beneath its wall and leave the floor in front visible');
    const behind=side([58,1.2,-68]);
    if(arenaOcclusion([behind.x-1,behind.y-1,2,2],behind.depth-35)?.length!==0)
      throw Error('The stand must not mask a foreground sprite at the same screen position');
    const wingCenter=centerOf(wingScreens[1]);
    const assertWingFrame=()=>{
      const view=director.pose();
      for(const [width,height] of [[960,540],[640,600]]){
        const framed=PanelCheck.stageProjection(view,width,height)(wingCenter);
        if(!framed||framed.x<width*.3||framed.x>width*.68||framed.y<0||framed.y>height)throw Error('The wing camera frames the cover screen on wide and compact players');
      }
      const column=PanelCheck.stageLightColumns;
      const [right,,depth]=wingScreens[1][1];
      const [x,,z]=view.eye;
      const coverRay=x+(right-x)*(column.back-z)/(depth-z);
      if(coverRay>=column.centers[1]-column.halfWidth)throw Error('The wing camera keeps the light column off the cover screen');
    };
    assertWingFrame();
    director.advance(8.7);
    assertWingFrame();
    director.advance(0.2);
    if(director.pose().eye[2]!==-110)throw Error('The cheer camera program loops back to the establishing shot');
    const clipCanvas=document.createElement('canvas');clipCanvas.width=800;clipCanvas.height=520;
    const clipContext=clipCanvas.getContext('2d',{willReadFrequently:true});
    const cameraFor=eye=>PanelCheck.stageProjection({eye,target:[0,1.8,-30],lens:0.75},800,520);
    const paintSprite=(camera,eye,rect,depth)=>{
      clipContext.clearRect(0,0,800,520);
      const cutouts=PanelCheck.createStageOcclusion(camera,eye,[800,520])(rect,depth);
      if(cutouts===null)return;
      const clipped=PanelCheck.beginStageClip(clipContext,rect,cutouts);
      clipContext.fillRect(...rect);
      if(clipped)clipContext.restore();
    };
    const alpha=(x,y)=>clipContext.getImageData(Math.round(x),Math.round(y),1,1).data[3];
    const canSee=(eye,world)=>{
      const camera=cameraFor(eye),p=camera(world);
      if(!p||p.x<1||p.x>=799||p.y<1||p.y>=519)throw Error('Occlusion fixture must be in frame');
      paintSprite(camera,eye,[p.x-3,p.y-3,6,6],p.depth);
      return alpha(p.x,p.y)>200;
    };
    if(canSee([14,4.1,-56],[-9.2,1.3,-13]))throw Error('The runway must obscure a spectator on the opposite side');
    if(canSee([0,4.2,-51],[10.7,1.2,-34.8]))throw Error('The thrust platform must obscure a low spectator behind it');
    if(!canSee([0,4.2,-51],[10.7,2.15,-34.8]))throw Error('A spectator above the thrust platform remains visible');
    if(!canSee([12,6,-57],[15,1.7,-39]))throw Error('An unobstructed spectator stays visible next to the thrust platform');
    const edgeEye=[0,5.5,-65],edgeCamera=cameraFor(edgeEye),edge=edgeCamera([10,0.8,-46]);
    const crossing=[edge.x-6,edge.y-4,14,8];
    paintSprite(edgeCamera,edgeEye,crossing,edgeCamera([0,1,-32]).depth);
    if(alpha(edge.x-3,edge.y)!==0||alpha(edge.x+4,edge.y)!==255)throw Error('A rear sprite must be clipped to the thrust outline even when its center lies outside');
    paintSprite(edgeCamera,edgeEye,crossing,edge.depth-2);
    if(alpha(edge.x-3,edge.y)!==255)throw Error('The thrust must not clip the same sprite when it is in front of the platform');
    const boundaryCamera=PanelCheck.stageProjection({eye:[0,0,0],target:[0,0,1],lens:0.75},768,520);
    const slopedFace=[[[-4,-2,8],[4,-2,24],[4,2,24],[-4,2,8]]];
    const boundary=boundaryCamera([-2,0,12]);
    const boundaryRect=[boundary.x-4,boundary.y-4,8,8];
    const boundaryCutouts=PanelCheck.createFaceOcclusion(boundaryCamera,slopedFace,[768,520])(boundaryRect,12);
    clipContext.clearRect(0,0,800,520);
    if(!PanelCheck.beginStageClip(clipContext,boundaryRect,boundaryCutouts))throw Error('A small sprite crossing a cell edge still finds its occluder');
    clipContext.fillRect(...boundaryRect);
    clipContext.restore();
    if(alpha(boundary.x-2,boundary.y)!==0||alpha(boundary.x+2,boundary.y)!==255)
      throw Error('Projective depth clipping masks only the near side of the sloped face');
    const sample=document.createElement('canvas');sample.width=48;sample.height=30;
    const context=sample.getContext('2d',{willReadFrequently:true});
    const brightness=()=>{
      context.drawImage(canvas,0,0,48,30);
      const pixels=context.getImageData(0,0,48,30).data;
      let total=0;
      for(let i=0;i<pixels.length;i+=4)total+=pixels[i]+pixels[i+1]+pixels[i+2];
      return total;
    };
    const {audioAnalysis,rhythmVisualConfig}=window.panelPlayer;
    const reduceMotion=ui.reduceMotion,pauseOnBlur=ui.pauseAnimationsOnBlur;
    ui.reduceMotion=false;ui.pauseAnimationsOnBlur=false;rhythmVisualConfig.enabled=true;
    await Vue.nextTick();await window.panelWait(80);
    if(ui.showPlayerSpectrum||window.panelPolling.rate!==20||!window.panelPolling.spectrum)throw Error('Stage requests spectrum data with the spectrum display hidden');
    ui.showPlayerSpectrum=true;await Vue.nextTick();
    if(window.panelPolling.rate!==20||!window.panelPolling.spectrum)throw Error('Spectrum can opt in without changing the analysis rate');
    ui.showPlayerSpectrum=false;await Vue.nextTick();
    const idle=brightness();
    audioAnalysis.rms=0.55;audioAnalysis.lowEnergy=0.4;audioAnalysis.bpm=120;audioAnalysis.spectrum=Array(64).fill(0.6);
    audioAnalysis.beatSequence++;
    await Vue.nextTick();await window.panelWait(600);
    if(brightness()<idle*1.02)throw Error('Sustained music energy must brighten the scene between beats');
    for(const stop of ['pause','reduced motion']){
      if(stop==='pause')window.panelPlayer.isPlaying=false;else ui.reduceMotion=true;
      await Vue.nextTick();await new Promise(requestAnimationFrame);
      const frozen=brightness();
      audioAnalysis.beatSequence++;await Vue.nextTick();await window.panelWait(130);
      if(window.panelPolling.rate!==0||brightness()!==frozen)throw Error('Stage must remain static during '+stop);
      window.panelPlayer.isPlaying=true;
    }
    audioAnalysis.rms=audioAnalysis.lowEnergy=audioAnalysis.bpm=0;
    audioAnalysis.spectrum=Array(64).fill(0);
    rhythmVisualConfig.enabled=false;ui.reduceMotion=reduceMotion;ui.pauseAnimationsOnBlur=pauseOnBlur;
    await Vue.nextTick();
    const originalSong=window.panelPlayer.currentQueueSong;
    const NativeImage=window.Image, images=[];
    window.Image=new Proxy(NativeImage,{construct(target,args){
      const image=Reflect.construct(target,args);images.push(image);return image;
    }});
    const setHidden=hidden=>{
      Object.defineProperty(document,'hidden',{configurable:true,value:hidden});
      document.dispatchEvent(new Event('visibilitychange'));
    };
    try {
      setHidden(true);
      for(const id of [1,2]) {
        window.panelPlayer.currentQueueSong={...originalSong,id,cover:String(id)};
        await Vue.nextTick();await window.panelWait(130);
      }
      if(images.length!==2)throw Error('Hidden song changes should only preload the regular cover');
      setHidden(false);
      await Vue.nextTick();await window.panelWait(150);
      if(images.length!==3)throw Error('Showing the arena loads the latest wing artwork once');
      if(images.some(image=>image.hasAttribute('src')))throw Error('Temporary cover images release their sources after use');
    } finally {
      window.Image=NativeImage;
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
      window.panelPlayer.currentQueueSong=originalSong;
      await Vue.nextTick();
    }
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
   if(document.querySelector('.panel-tools [data-panel-tool=source], .panel-tools [data-panel-tool=search]'))
    throw Error('Lyrics source and search are no longer duplicated in the tools row');
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
   await chooseLyricOption(zh.songList.more,zh.playerPanel.lyricSearchTitle,()=>dialogTitle()===zh.playerPanel.lyricSearchTitle&&document.querySelector('[data-lyric-search-sidebar]')&&songRequests.some(request=>request.action==='getSong'&&request.params.id===21));
   await closeActionDialog();
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
    if (cheer) {
      await window.webContents.executeJavaScript(`(async()=>{
        const ui=PanelCheck.useUIStore();ui.showPlayer=true;ui.showPlayerAppearance=true;
        window.disposeDrawerGlass=PanelCheck.mountGlassComponentEffects();
        await PanelCheck.Vue.nextTick();await window.panelWait(360);
        document.querySelector('.player-cheer-settings summary').click();
      })()`)
      const cdp = window.webContents.debugger
      cdp.attach('1.3')
      await cdp.sendCommand('DOM.enable')
      await cdp.sendCommand('CSS.enable')
      const { root: drawerRoot } = await cdp.sendCommand('DOM.getDocument')
      const hoverSelectors = [
        '.player-appearance-drawer .ep-drawer-close',
        '.appearance-tabs button[aria-pressed=false]',
        '.appearance-tabs button[aria-pressed=true]',
        '.cheer-color-modes button[aria-pressed=false]',
        '.cheer-color-modes button[aria-pressed=true]'
      ]
      for (const selector of hoverSelectors) {
        const { nodeId } = await cdp.sendCommand('DOM.querySelector', {
          nodeId: drawerRoot.nodeId,
          selector
        })
        await cdp.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] })
      }
      const alphas = await window.webContents.executeJavaScript(`(async()=>{
        await window.panelWait(180);
        const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
        const ctx=canvas.getContext('2d',{willReadFrequently:true});
        return ${JSON.stringify(['.appearance-tabs', ...hoverSelectors, '.cheer-color-modes'])}.map(selector=>{
          ctx.clearRect(0,0,1,1);
          ctx.fillStyle=getComputedStyle(document.querySelector(selector)).backgroundColor;
          ctx.fillRect(0,0,1,1);return ctx.getImageData(0,0,1,1).data[3];
        });
      })()`)
      assert.ok(
        alphas.every((alpha) => alpha > 0 && alpha < 64),
        `The glass tab and color mode controls and drawer close hover remain translucent: ${alphas}`
      )
      cdp.detach()
      await window.webContents.executeJavaScript(`(async()=>{
        PanelCheck.useUIStore().showPlayerAppearance=false;
        window.disposeDrawerGlass();await window.panelWait(300);
      })()`)
    }
    if (cheerGeometry) {
      await window.webContents.executeJavaScript(`(async()=>{
        const player=window.panelPlayer,ui=PanelCheck.useUIStore();
        ui.reduceMotion=false;ui.pauseAnimationsOnBlur=false;player.rhythmVisualConfig.enabled=true;
        player.audioAnalysis.rms=0.35;player.audioAnalysis.lowEnergy=0.26;
        await PanelCheck.Vue.nextTick();await window.panelWait(350);
        document.querySelector('.stage-background').parentElement.nextElementSibling.style.visibility='hidden';
        player.audioAnalysis.beatSequence++;await PanelCheck.Vue.nextTick();await window.panelWait(55);
      })()`)
      fs.writeFileSync(
        path.resolve('build/player-cheer-arena.png'),
        (await window.webContents.capturePage()).toPNG()
      )
      await window.webContents.executeJavaScript(
        "document.querySelector('.stage-background').parentElement.nextElementSibling.style.removeProperty('visibility');true"
      )
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
      scope: `Actual playback panel, cover analysis, ${background} background and 100 lyric lines; isolated reactive player, ${cheer ? 'in-memory preferences' : 'no persistence'}, no decoder`,
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
            const toolbar=document.querySelector('.panel-tools');toolbar.style.maxWidth='54px';toolbar.style.justifySelf='end';await Vue.nextTick();await window.panelWait(80);
            if(getComputedStyle(document.querySelector('[data-panel-tool="timing"]')).display!=='none')throw Error('Narrow layout overflows the timing control into More');
            const audio=toolbar.querySelector('button[aria-label="'+zh.footer.audioControls+'"]');
            if(!audio?.getBoundingClientRect().width||toolbar.scrollWidth>toolbar.clientWidth+1)throw Error('Audio controls remain visible in the narrow tools row');
            more().click();await Vue.nextTick();await window.panelWait(100);
            if([...document.querySelectorAll('.ep-menu-item')].some(button=>button.textContent.trim()===zh.footer.audioControls))throw Error('Audio controls stay out of More at narrow widths');
            const items=[...document.querySelectorAll('.ep-menu-item')].map(button=>button.textContent.trim());
            if(items.filter(label=>label===zh.playerPanel.lyricSearchTitle).length!==1||items.some(label=>label.startsWith(zh.playerPanel.lyricSource)))
              throw Error('More keeps one lyrics search action and leaves source selection in the drawer');
            const item=[...document.querySelectorAll('.ep-menu-item')].find(button=>button.textContent.trim()===zh.playerPanel.lyricTiming);
            if(!item)throw Error('Hidden timing control must be available in More');
            item.click();await Vue.nextTick();await window.panelWait(200);
            const range=document.querySelector('.ep-tooltip input[aria-label="'+zh.playerPanel.lyricTiming+'"]');
            if(!range||getComputedStyle(range).visibility!=='visible')throw Error('Overflow action opens the original timing control');
            document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await Vue.nextTick();await window.panelWait(200);
            if(document.querySelector('[data-overflow-anchor]'))throw Error('Closing overflow control releases its temporary anchor');
            const clickMoreItem=async(label)=>{
              more().click();await Vue.nextTick();await window.panelWait(100);
              const option=[...document.querySelectorAll('.ep-menu-item')].find(button=>button.textContent.trim()===label);
              if(!option)throw Error('Missing overflow action: '+label);
              option.click();await Vue.nextTick();await window.panelWait(200);
            };
            await clickMoreItem(zh.queue.sequential);
            if(window.panelPlayer.playMode!==1)throw Error('Playback mode still works from overflow');
            window.panelPlayer.setPlayMode(0);await Vue.nextTick();
            await clickMoreItem(zh.queue.title);
            const queue=toolbar.querySelector('[data-panel-tool=queue]');
            if(queue.getAttribute('aria-expanded')!=='true')throw Error('The queue still opens from overflow');
            queue.click();await Vue.nextTick();
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
