/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
// Render the real home page with isolated music-library fixtures, never user data.
const { app, BrowserWindow, protocol } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const esbuild = require('esbuild')
const { parse, compileScript } = require('@vue/compiler-sfc')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ep-home-layout-')))
app.disableHardwareAcceleration()
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'easy-player-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true }
  }
])
app.whenReady().then(async () => {
  try {
    protocol.handle('easy-player-media', (request) => {
      const key = Number(new URL(request.url).searchParams.get('path')) || 0
      const colors = [
        ['#123550', '#4c8f9d'],
        ['#d68b72', '#f0ceb0'],
        ['#2a443a', '#9aa78b'],
        ['#463953', '#af8599'],
        ['#233e6a', '#9bb9d3'],
        ['#695c49', '#d7caad']
      ][key % 6]
      const titles = ['AFTER HOURS', 'SLOW DAYS', 'EVERGREEN', 'IN BLOOM', 'BLUE NOTE', 'GOLDEN'][
        key % 6
      ]
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><defs><linearGradient id="b" x2="1" y2="1"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs><rect width="400" height="400" fill="url(#b)"/><circle cx="290" cy="140" r="105" fill="none" stroke="white" stroke-opacity=".2" stroke-width="1"/><circle cx="290" cy="140" r="73" fill="none" stroke="white" stroke-opacity=".25"/><path d="M-40 320 Q180 30 440 290 M-40 345 Q180 55 440 315 M-40 370 Q180 80 440 340" fill="none" stroke="white" stroke-opacity=".22" stroke-width="30"/><text x="28" y="52" font-family="sans-serif" font-size="12" letter-spacing="5" fill="white" opacity=".75">SELECTED SOUNDS</text><text x="28" y="360" font-family="sans-serif" font-size="29" letter-spacing="1" fill="white">${titles}</text></svg>`
      return new Response(svg, { headers: { 'content-type': 'image/svg+xml' } })
    })
    const styles = []
    const bundle = await esbuild.build({
      stdin: {
        contents: `import * as Vue from 'vue'; import { createI18n } from 'vue-i18n'; import { createRouter, createMemoryHistory } from 'vue-router'; import Home from './src/renderer/src/views/home/Index.vue'; import zh from './src/renderer/src/i18n/locales/zh'; export { Vue, createI18n, createRouter, createMemoryHistory, Home, zh };`,
        resolveDir: process.cwd()
      },
      bundle: true,
      platform: 'browser',
      format: 'iife',
      globalName: 'HomePreview',
      write: false,
      define: {
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
          name: 'home-preview',
          setup(build) {
            build.onResolve(
              {
                filter:
                  /[\\/]stores[\\/](?:ui[\\/]uiStore|player[\\/]playerStore|statistics[\\/]statisticsStore)(?:\.ts)?$/
              },
              ({ path: file }) => ({ path: file, namespace: 'fixture-store' })
            )
            build.onLoad({ filter: /.*/, namespace: 'fixture-store' }, ({ path: file }) => ({
              contents: /uiStore/.test(file)
                ? `export const DEFAULT_HOME_SECTION_ORDER=['welcome','overview','playlists','recommendations','heatmap','topPlayed','topDuration','navigation','clock']; export const DEFAULT_HIDDEN_HOME_SECTIONS=['navigation']; export const useUIStore=()=>window.homeUi;`
                : /statisticsStore/.test(file)
                  ? 'export const useStatisticsStore=()=>window.homeStatistics;'
                  : 'export const usePlayerStore=()=>window.homePlayer;',
              loader: 'js'
            }))
            build.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }))
            build.onLoad({ filter: /\.vue$/ }, ({ path: file }) => {
              const { descriptor } = parse(fs.readFileSync(file, 'utf8'), { filename: file })
              descriptor.styles.forEach((style) => styles.push(style.content))
              return {
                contents: compileScript(descriptor, { id: file, inlineTemplate: true }).content,
                loader: 'ts',
                resolveDir: path.dirname(file)
              }
            })
          }
        }
      ]
    })
    const sprite = fs
      .readdirSync('src/renderer/src/assets/svg', { recursive: true })
      .filter((file) => file.endsWith('.svg'))
      .map((file) => {
        const svg = fs
          .readFileSync(path.join('src/renderer/src/assets/svg', file), 'utf8')
          .replace(/\s(?:width|height)="[^"]*"/g, '')
        return svg
          .replace(
            /<svg\b([^>]*)>/,
            `<symbol $1 id="icon-${file
              .replace(/\\/g, '/')
              .replace(/\.svg$/, '')
              .replace(/\//g, '-')}">`
          )
          .replace('</svg>', '</symbol>')
      })
      .join('')
    const window = new BrowserWindow({
      show: false,
      width: 1280,
      height: 1500,
      webPreferences: { sandbox: true, offscreen: true, backgroundThrottling: false }
    })
    window.webContents.on('console-message', (event) => {
      if (event.level === 'error') console.error(event.message)
    })
    const fixture = path.join(app.getPath('userData'), 'home.html')
    fs.writeFileSync(fixture, '<html><body><div id="app"></div></body></html>')
    await window.loadFile(fixture)
    const cssFile = fs
      .readdirSync('out/renderer/assets')
      .find((file) => /^main-.*\.css$/.test(file))
    const css =
      fs.readFileSync(path.join('out/renderer/assets', cssFile), 'utf8') +
      fs.readFileSync('src/renderer/src/views/home/home.css', 'utf8') +
      styles.join('\n')
    await window.webContents.executeJavaScript(
      `document.head.insertAdjacentHTML('beforeend','<style></style>');document.head.lastElementChild.textContent=${JSON.stringify(css)};document.body.insertAdjacentHTML('beforeend',${JSON.stringify('<svg style="display:none">' + sprite + '</svg>')});void 0;`
    )
    await window.webContents.executeJavaScript(bundle.outputFiles[0].text)
    await window.webContents.executeJavaScript(`(async()=>{
      const {Vue,createI18n,createRouter,createMemoryHistory,Home,zh}=HomePreview;
      const {reactive,createApp,h,nextTick}=Vue;
      window.homeUi=reactive({homeSectionOrder:['welcome','overview','playlists','recommendations','heatmap','topPlayed','topDuration','navigation','clock'],hiddenHomeSections:['navigation'],showWelcomeText:true,homeClockEnabled:false,homeWelcomeText:'晚上好，Huiiro',customThemeText:{},userName:'Huiiro',locale:'zh',artistSeparator:' / ',normalizeMetadataSeparator:true,reduceMotion:true,homeLayoutOpen:false});
      window.homeStatistics=reactive({enabled:true,generation:'preview'});
      window.homePlayer=reactive({queue:[],currentQueueSong:null,isPlaying:false,isPaused:false});
      const songs=['夜曲','晴天','花海','慢慢喜欢你','世界赠予我的','一路向北'].map((title,index)=>({id:index+1,title,artist:['周杰伦','莫文蔚','王菲'][index%3],album:'精选',cover:String(index),songStatus:1,value:60-index*7}));
      const quality={standard:{count:820,bytes:0},high:{count:1240,bytes:0},ultra:{count:960,bytes:0},lossless:{count:5660,bytes:0},bitrateCount:8680,sizeFallbackCount:0,unknownCount:0,thresholds:{highKbps:320,ultraKbps:500,losslessKbps:800,highMiB:10,ultraMiB:20,losslessMiB:30}};
      const stats={songCount:8680,albumCount:642,artistCount:328,librarySize:142*1024**3,totalPlaySeconds:428*3600,todayPlaySeconds:102*60,eligiblePlays:1860,completedPlays:1624,quality,timePeriods:[{id:'evening',playedSeconds:26000,plays:480},{id:'morning',playedSeconds:12000,plays:250}]};
      const playlists=['慢一点，听一会儿','通勤路上的风','写给自己的歌','深夜电台','晴天与海','周末漫游'].map((name,index)=>({id:index+1,name,cover:String(index),songCount:index*23,description:['给日常留一点空白','一路好心情','收藏喜欢的声音'][index%3]}));
      const cards=['recommended','discovery','discovery','discovery','discovery','discovery'].map((group,index)=>({group,generatedFor:'2026-10-'+String(22-index).padStart(2,'0'),songs:[songs[(index+2)%songs.length]],total:20+index*3}));
      const days=Array.from({length:365},(_,index)=>{const day=new Date();day.setDate(day.getDate()-index);return {date:day.getFullYear()+'-'+String(day.getMonth()+1).padStart(2,'0')+'-'+String(day.getDate()).padStart(2,'0'),seconds:index%5===0?0:((index*7919)%7200)}});
      window.api={database:{command:async action=>({success:true,data:action==='getOverviewStats'?stats:action==='getPlayHistoryDays'?days:action==='getTopPlayedSongs'||action==='getTopDurationSongs'?songs:action==='listPlaylists'?playlists:action==='getLikedPlaylistCover'?{cover:'3',songCount:128}:action==='getHomeRecommendations'?cards:[]})}};
      window.homeRouter=createRouter({history:createMemoryHistory(),routes:[{path:'/home',component:Home},{path:'/recommend',component:{render:()=>h('div','Recommendations')}},{path:'/playlist/:id',component:{render:()=>h('div','Playlist')}},{path:'/liked',component:{render:()=>h('div','Liked')}}]});
      await window.homeRouter.push('/home');await window.homeRouter.isReady();
      window.homeApp=createApp({render:()=>h(Home)}).use(createI18n({legacy:false,locale:'zh',messages:{zh}})).use(window.homeRouter);window.homeApp.mount('#app');
      await nextTick();await new Promise(resolve=>setTimeout(resolve,500));
    })()`)
    const theme = async (dark) =>
      window.webContents.executeJavaScript(
        `document.documentElement.classList.toggle('dark',${dark});document.documentElement.style.cssText=${JSON.stringify(dark ? '--color-bg:#15181c;--color-bg-l:#282e35;--color-bg-l2:#242a31;--color-text:#e5e9ee;--color-text-l:#929da9;--color-border:#59616c;--color-hover:rgb(255 255 255 / 5%);--color-hover-bg:#2d343c;--color-primary:#72c9a3;' : '--color-bg:#fafbf9;--color-bg-l:#edf0eb;--color-bg-l2:#f0f3ef;--color-text:#24352f;--color-text-l:#7b867f;--color-border:#9ba69d;--color-hover:rgb(0 0 0 / 4%);--color-hover-bg:#e8ede7;--color-primary:#3e8267;')};void 0;`
      )
    const save = async (name) => {
      await new Promise((resolve) => setTimeout(resolve, 250))
      fs.writeFileSync(
        path.resolve('build', name),
        (await window.webContents.capturePage()).toPNG()
      )
    }
    const layout = () =>
      window.webContents.executeJavaScript(
        `(()=>{
          const grids=[...document.querySelectorAll('.home-collection-grid')];
          return {
            overflow:document.querySelector('.home-page').scrollWidth>document.querySelector('.home-page').clientWidth,
            stats:document.querySelectorAll('.home-stat').length,
            cover:document.querySelector('.home-collection-cover').getBoundingClientRect().width,
            rankColumns:getComputedStyle(document.querySelector('.home-content')).gridTemplateColumns.split(' ').length,
            collections:grids.map(grid=>({columns:getComputedStyle(grid).gridTemplateColumns,gap:getComputedStyle(grid).gap,cover:grid.querySelector('.home-collection-cover').getBoundingClientRect().width,overflow:grid.scrollWidth>grid.clientWidth}))
          };
        })()`
      )
    await theme(false)
    const desktop = await layout()
    assert.equal(desktop.overflow, false, 'Desktop home must not overflow horizontally')
    assert.equal(desktop.stats, 9, 'All existing overview metrics remain available')
    assert.ok(
      desktop.cover >= 160 && desktop.cover <= 209,
      'Artwork uses the larger responsive size'
    )
    assert.equal(desktop.rankColumns, 2)
    assert.equal(desktop.collections.length, 2)
    assert.deepEqual(
      desktop.collections[0],
      desktop.collections[1],
      'Desktop playlists and recommendations share cover size, grid columns and gaps'
    )
    const playlistDetails = await window.webContents.executeJavaScript(`(()=>{
      const grid=document.querySelector('.home-playlist-grid');
      const cards=[...grid.children];
      const icon=document.querySelector('.home-stat-icon');
      const box=icon.getBoundingClientRect();
      return {
        wraps:cards.at(-1).getBoundingClientRect().top>cards[0].getBoundingClientRect().top,
        overflow:grid.scrollWidth>grid.clientWidth,
        counts:[...grid.querySelectorAll('.playlist-song-count')].map(item=>item.textContent.trim()),
        countOpacity:getComputedStyle(grid.querySelector('.playlist-song-count')).opacity,
        layoutEntry:!!document.querySelector('.home-layout-action'),
        headingCounts:document.querySelectorAll('.home-section-count').length,
        squareIcon:box.width===box.height&&box.width===56&&getComputedStyle(icon).backgroundColor!=='rgba(0, 0, 0, 0)'
      };
    })()`)
    assert.equal(playlistDetails.wraps, true, 'Playlists wrap into multiple rows')
    assert.equal(playlistDetails.overflow, false, 'Playlists fit their grid without a shelf')
    assert.equal(playlistDetails.layoutEntry, false, 'Home has no layout entry')
    assert.equal(playlistDetails.headingCounts, 0, 'Section headings have no count')
    assert.equal(playlistDetails.squareIcon, true, 'Overview icons retain square backgrounds')
    assert.equal(playlistDetails.counts[0], '128 首歌曲')
    assert.equal(playlistDetails.counts[1], '0 首歌曲')
    assert.equal(playlistDetails.countOpacity, '0', 'Counts stay hidden before hover')
    await save('home-desktop-light.png')
    const coverPosition = await window.webContents.executeJavaScript(`(()=>{
      const box=document.querySelector('.home-playlist-grid .home-collection-cover').getBoundingClientRect();
      return {x:Math.round(box.x+box.width/2),y:Math.round(box.y+box.height/2)};
    })()`)
    window.webContents.sendInputEvent({ type: 'mouseMove', ...coverPosition })
    await new Promise((resolve) => setTimeout(resolve, 250))
    const hoveredCount = await window.webContents.executeJavaScript(`(()=>{
      const badge=document.querySelector('.playlist-song-count');
      const box=badge.getBoundingClientRect(),cover=badge.parentElement.getBoundingClientRect();
      return {opacity:getComputedStyle(badge).opacity,left:box.left-cover.left,bottom:cover.bottom-box.bottom};
    })()`)
    assert.equal(hoveredCount.opacity, '1', 'Hover shows the playlist song count')
    assert.ok(hoveredCount.left >= 10 && hoveredCount.left <= 14)
    assert.ok(hoveredCount.bottom >= 10 && hoveredCount.bottom <= 14)
    await save('home-playlist-hover.png')
    window.webContents.sendInputEvent({ type: 'mouseMove', x: 0, y: 0 })
    await window.webContents.executeJavaScript(
      `document.querySelector('.home-page').scrollTop=1050;void 0;`
    )
    await save('home-desktop-details.png')
    await window.webContents.executeJavaScript(
      `document.querySelector('.home-page').scrollTop=0;void 0;`
    )
    await theme(true)
    await save('home-desktop-dark.png')
    window.setSize(620, 1500)
    await new Promise((resolve) => setTimeout(resolve, 250))
    const compact = await layout()
    assert.equal(compact.overflow, false, 'Compact home keeps playlists within the viewport')
    assert.equal(compact.rankColumns, 1)
    assert.deepEqual(
      compact.collections[0],
      compact.collections[1],
      'Compact playlists and recommendations share cover size, grid columns and gaps'
    )
    await theme(false)
    await save('home-compact.png')
    await window.webContents.executeJavaScript(
      `document.querySelector('.home-stat:last-child button').click();void 0;`
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    const detail = await window.webContents.executeJavaScript(
      `(()=>{const panel=document.querySelector('#home-stat-detail-panel');return {present:!!panel,right:panel?.getBoundingClientRect().right}})()`
    )
    assert.ok(
      detail.present && detail.right <= 620,
      'Statistics details remain accessible inside compact viewport'
    )
    await window.webContents.executeJavaScript(
      `window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));window.homeUi.homeLayoutOpen=true;void 0;`
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.ok(
      await window.webContents.executeJavaScript(`!!document.querySelector('.ep-dialog-panel')`),
      'Layout customization still opens through the existing shared state'
    )
    await window.webContents.executeJavaScript(`window.homeUi.homeLayoutOpen=false;void 0;`)
    // Keep a transport command pending across a queue-item change. The real home
    // handlers should lock duplicate clicks without dimming/replacing other covers.
    const transport = await window.webContents.executeJavaScript(`(async()=>{
      const {Vue}=HomePreview;
      const player=window.homePlayer;
      player.queue=[{id:1,title:'First',audio:'first.wav'},{id:2,title:'Next',audio:'next.wav'}];
      player.currentQueueSong=player.queue[0];player.queuePlaylistId=-1;
      player.isPlaying=true;player.isPaused=false;
      let calls=0,complete;
      player.pause=()=>{calls++;return new Promise(resolve=>{complete=()=>{player.isPlaying=false;player.isPaused=true;resolve(true)}})};
      player.play=()=>{calls++;return new Promise(resolve=>{complete=()=>{player.isPlaying=true;player.isPaused=false;resolve(true)}})};
      await Vue.nextTick();
      const covers=[...document.querySelectorAll('.home-recommendation-grid .home-collection-cover')];
      const initial=covers.map(cover=>getComputedStyle(cover).opacity);
      const button=document.querySelector('.home-playlist-grid .home-collection-cover');
      const states=[];
      for(let attempt=0;attempt<2;attempt++){
        button.click();await Vue.nextTick();
        states.push({locked:button.disabled&&covers.every(cover=>cover.disabled),opacity:covers.map(cover=>getComputedStyle(cover).opacity)});
        button.click(); // A duplicate click while pending must be ignored.
        player.currentQueueSong=player.queue[1];
        await Vue.nextTick();complete();await Vue.nextTick();await Vue.nextTick();
      }
      const result={initial,states,calls,unlocked:!button.disabled&&covers.every(cover=>!cover.disabled),sameCovers:covers.every((cover,index)=>cover===document.querySelectorAll('.home-recommendation-grid .home-collection-cover')[index]),nextId:player.currentQueueSong.id,playing:player.isPlaying};
      player.queue=[];player.currentQueueSong=null;player.queuePlaylistId=null;player.isPlaying=false;player.isPaused=false;
      await Vue.nextTick();return result;
    })()`)
    assert.equal(transport.calls, 2, 'Pending playback commands reject duplicate clicks')
    assert.equal(transport.nextId, 2, 'A concurrent next track remains selected')
    assert.equal(transport.playing, true, 'The playlist resumes after pausing at a track change')
    assert.equal(transport.sameCovers, true, 'Playback toggles preserve recommendation covers')
    assert.equal(transport.unlocked, true, 'Cover controls unlock when commands finish')
    for (const state of transport.states) {
      assert.equal(state.locked, true)
      assert.deepEqual(state.opacity, transport.initial, 'Recommendation covers never flash dim')
    }
    await window.webContents.executeJavaScript(`window.homeStatistics.enabled=false;void 0;`)
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal((await layout()).stats, 0, 'Statistics preference still hides its modules')
    console.log(
      JSON.stringify(
        {
          desktop,
          compact,
          previews: ['home-desktop-light.png', 'home-desktop-dark.png', 'home-compact.png']
        },
        null,
        2
      )
    )
    window.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
