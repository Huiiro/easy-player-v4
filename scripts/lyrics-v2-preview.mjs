import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
const uiModule = `import {reactive} from 'vue'; export const ui=reactive({autoAdjustLyricsDisplay:false,reduceMotion:false,showLyricsTranslation:true,showLyricsRomanization:true,lyricsStyle:'follow',lyricsFontSize:2.4,lyricsFontPadding:30}); export const useUIStore=()=>ui;`
const panelStyles = () => {
  const source = readFileSync('src/renderer/src/views/layout/playerPanel/Index.vue', 'utf8')
  return ['player-panel-layout', 'panel-lyrics']
    .map((name) => source.match(new RegExp('\\.' + name + ' \\{[^}]*\\}'))?.[0] ?? '')
    .join('\n')
}
const html = `<!doctype html><html><head><meta charset="UTF-8"><title>Lyrics v2 verification</title><style>/*PANEL_STYLES*/ *{box-sizing:border-box}.player-panel-layout{display:grid;height:560px;width:100%;overflow:hidden;padding-top:64px}.panel-lyrics{display:flex;flex-direction:column;min-width:0;padding-block:32px}.panel-side{display:flex;align-items:center;justify-content:center;min-width:0} body{background:#17202c;color:white;font-family:Arial}button{margin:8px;padding:8px}#lyrics{height:100%;width:100%;flex:1;--lrc-size:32px;--lrc-height:1.5;--lrc-padding:24px;--lrc-translate-size:18px;--lrc-default:#82909f;--lrc-highlight:#fff;--lrc-translate:#bcc8d6}.lyric-line button{position:absolute;left:5px;top:35%}</style></head><body><div id="app"></div><script type="module">
import {createApp,ref} from 'vue';
import PlayerLyrics from '/src/renderer/src/components/lyrics/PlayerLyricsV2.vue';
import {ui} from 'virtual:lyrics-ui';
const content=Array.from({length:40},(_,i)=>'[00:'+String(i*2).padStart(2,'0')+'.000]第 '+i+' 行 歌词滚动测试 Beautiful music').join('\\n');
const timedContent=Array.from({length:40},(_,i)=>'['+(i*2000)+',2000]'+['春','风','拂','面'].map((char,j)=>'('+(i*2000+j*500)+',500,0)'+char).join('')).join('\\n');
window.api={database:{command:async(_,arg)=>({success:true,data:arg.id===4?{lrc:'[00:03.000]First line\\n[00:05.000]\\n[00:11.000]After the break',lyricFormat:'lrc'}:arg.id===3?{lrc:timedContent,lyricFormat:'yrc'}:arg.id===2?{lrc:'纯文本歌词\\n第二行没有时间戳',lyricFormat:'plain'}:{lrc:content,lyricFormat:'lrc',translation:content.replaceAll('歌词滚动测试 Beautiful music','Translation')}})}};
createApp({components:{PlayerLyrics},setup(){const time=ref(0),song=ref({id:1,audio:'fixture'}),seek=ref(-1),playing=ref(false),measurement=ref('');setInterval(()=>{if(playing.value)time.value+=250},250);function measure(){const samples=[];const started=performance.now();time.value=1800;playing.value=true;function tick(now){const rows=[...document.querySelectorAll('.lyric-line')];samples.push({time:time.value,offsets:rows.slice(1,5).map(el=>parseFloat(el.style.getPropertyValue('--scroll-y'))||0),fill:[...rows[1]?.querySelectorAll('.lyric-char,.lyric-karaoke-char')??[]].map(el=>el.style.getPropertyValue('--progress')).join(','),height:document.querySelector('.player-panel-layout').clientHeight});if(now-started<1400)requestAnimationFrame(tick);else{playing.value=false;measurement.value=JSON.stringify({byTime:[...new Set(samples.map(s=>s.time))].map(t=>({time:t,count:new Set(samples.filter(s=>s.time===t).map(s=>s.fill)).size,last:samples.filter(s=>s.time===t).at(-1).fill})),frames:samples.length,maxRowSpread:Math.max(...samples.map(s=>Math.max(...s.offsets)-Math.min(...s.offsets))),distinctFillValues:new Set(samples.map(s=>s.fill)).size,heights:[...new Set(samples.map(s=>s.height))]})}}requestAnimationFrame(tick)}return{time,song,seek,ui,playing,measurement,measure}},template:'<button @click="playing=!playing">{{playing ? &quot;Pause&quot; : &quot;Play&quot;}}</button><button @click="song={id:3,audio:&quot;timed&quot;}">Timed lyrics</button><button @click="song={id:4,audio:&quot;break&quot;};time=0">Interlude lyrics</button><button @click="time=7000">Inside break</button><button @click="time=11000">After break</button><button @click="measure">Measure motion</button><output>{{measurement}}</output><button @click="time+=2000">Next</button><button @click="time=40000">Seek middle</button><button @click="ui.reduceMotion=!ui.reduceMotion">Reduce motion</button><button @click="ui.showLyricsTranslation=!ui.showLyricsTranslation">Translation</button><button @click="song={id:2,audio: &quot;plain&quot;}">Plain</button><p>Time {{time}} Seek {{seek}}</p><div class="player-panel-layout"><section class="panel-side">Cover and controls</section><section class="panel-lyrics"><PlayerLyrics id="lyrics" :song="song" :source-order="[&quot;database&quot;]" :current-time="time" @seek="seek=$event;time=$event" /></section></div>'}).mount('#app');
</script></body></html>`
const server = await createServer({
  configFile: false,
  root: process.cwd(),
  resolve: {
    alias: [
      { find: '@/stores/ui/uiStore', replacement: 'virtual:lyrics-ui' },
      { find: '@', replacement: resolve('src/renderer/src') },
      { find: 'vue', replacement: resolve('node_modules/vue/dist/vue.esm-browser.js') }
    ]
  },
  plugins: [
    vue(),
    {
      name: 'lyrics-fixture',
      resolveId(id) {
        if (id === 'virtual:lyrics-ui') return id
      },
      load(id) {
        if (id === 'virtual:lyrics-ui') return uiModule
      },
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url === '/') {
            res.setHeader('Content-Type', 'text/html')
            res.end(
              await server.transformIndexHtml(
                req.url,
                html.replace('/*PANEL_STYLES*/', panelStyles())
              )
            )
          } else next()
        })
      }
    }
  ],
  server: { host: '127.0.0.1', port: 5197, strictPort: true }
})
await server.listen()
console.log('Lyrics fixture http://127.0.0.1:5197')
