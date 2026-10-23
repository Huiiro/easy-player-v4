/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, protocol } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const sharp = require('sharp')
const assert = require('node:assert/strict')
const esbuild = require('esbuild')
const { parse, compileScript } = require('@vue/compiler-sfc')
const baseline = process.argv.includes('--baseline')
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
    const bundle = await esbuild.build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
    import * as Vue from 'vue';import {createPinia} from 'pinia';import {createI18n} from 'vue-i18n';
    import Panel from './src/renderer/src/views/layout/playerPanel/Index.vue';
    import {useUIStore} from './src/renderer/src/stores/ui/uiStore';
    import {CoverAnalyzer} from './src/renderer/src/hooks/useImageColors';
    import zh from './src/renderer/src/i18n/locales/zh';export {Vue,createPinia,createI18n,Panel,useUIStore,CoverAnalyzer,zh};
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
              () => ({ contents: 'export default {render(){return null}}', loader: 'js' })
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
              descriptor.styles.forEach((style) => styles.push(style.content))
              return {
                contents: compileScript(descriptor, { id: filename, inlineTemplate: true }).content,
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
    fs.writeFileSync(fixture, '<html><body><div id="app"></div></body></html>')
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
   const {Vue,createPinia,createI18n,Panel,useUIStore,CoverAnalyzer,zh}=PanelCheck;
   window.panelWait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
   window.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),16);window.cancelAnimationFrame=clearTimeout;
   window.panelAnalysis=[];const analyze=CoverAnalyzer.analyze;CoverAnalyzer.analyze=function(...args){const start=performance.now();const result=analyze.apply(this,args);window.panelAnalysis.push(performance.now()-start);return result};
   const lyric=Array.from({length:100},(_,index)=>'['+String(Math.floor(index*2/60)).padStart(2,'0')+':'+String(index*2%60).padStart(2,'0')+'.000]第'+index+'行切歌测试歌词 Beautiful music').join('\\n');
   window.panelPlayer=Vue.reactive({currentQueueSong:{id:0,title:'Initial',artist:'Artist',audio:'0.flac',cover:'0'},trackInfo:null,positionMs:0,durationMs:180000,durationFormatted:'3:00',playbackSpeedConfig:{enabled:false,speed:1},volume:0.5,isPlaying:true,playMode:0,queue:[],getSongPreference:()=>0,setAudioAnalysisPollingRate(){},rhythmVisualConfig:{enabled:false,reducedMotion:false,intensity:1},audioAnalysis:{rms:0,lowEnergy:0,onsetStrength:0,beatSequence:0}});
   window.api={database:{command:async(action,params)=>({success:true,data:action==='getSong'?{id:params.id,lrc:lyric,lyricFormat:'lrc'}:[]})},fonts:{list:async()=>({success:true,data:[]})}};
   const app=Vue.createApp({render:()=>Vue.h(Panel)});app.use(createPinia());app.use(createI18n({legacy:false,locale:'zh',messages:{zh},missingWarn:false,fallbackWarn:false}));
   const ui=useUIStore();ui.showPlayer=true;ui.playerBgType='album';ui.lyricSourceOrder=['database'];ui.autoSearchNetworkLyrics=false;ui.showPlayerSpectrum=false;
   app.mount('#app');await window.panelWait(700);
  })()`)
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
      scope:
        'Actual playback panel, cover analysis, album background and 100 lyric lines; isolated reactive player, no decoder or persistence',
      ...result
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
