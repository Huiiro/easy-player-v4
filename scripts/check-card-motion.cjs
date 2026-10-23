/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, protocol } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const esbuild = require('esbuild')
const { parse, compileScript } = require('@vue/compiler-sfc')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ep-card-motion-')))
app.disableHardwareAcceleration()
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'easy-player-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
])
app.whenReady().then(async () => {
  try {
    protocol.handle('easy-player-media', (request) => {
      const id = Number(new URL(request.url).searchParams.get('path')) || 1
      const palette = ['#547b92', '#9b727b', '#547e73', '#8a7caa', '#a78c66', '#6778a8']
      return new Response(
        `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><defs><linearGradient id="a" x2="1" y2="1"><stop stop-color="${palette[id % palette.length]}"/><stop offset="1" stop-color="#182632"/></linearGradient></defs><path fill="url(#a)" d="M0 0h600v600H0z"/><circle cx="440" cy="160" r="180" fill="#ffffff" opacity=".07"/><path d="M0 460Q220 180 600 400v200H0" fill="#ffffff" opacity=".12"/><text x="60" y="470" fill="#ffffff" font-size="56" font-family="sans-serif" letter-spacing="6">SIDE ${(id % 10) + 1}</text><text x="64" y="514" fill="#ffffff" opacity=".65" font-size="18" font-family="sans-serif" letter-spacing="8">EASY PLAYER</text></svg>`,
        { headers: { 'Content-Type': 'image/svg+xml', 'Access-Control-Allow-Origin': '*' } }
      )
    })
    const styles = []
    const bundle = await esbuild.build({
      stdin: {
        contents: `import * as Vue from 'vue';import {createI18n} from 'vue-i18n';import CardView from './src/renderer/src/views/layout/card/Index.vue';import LayoutModeTransition from './src/renderer/src/components/layout/LayoutModeTransition.vue';import eventBus from './src/renderer/src/utils/eventBus';import zh from './src/renderer/src/i18n/locales/zh';export {Vue,createI18n,CardView,LayoutModeTransition,eventBus,zh};`,
        resolveDir: process.cwd()
      },
      bundle: true,
      platform: 'browser',
      format: 'iife',
      globalName: 'CardCheck',
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
          name: 'card-fixture',
          setup(build) {
            build.onResolve(
              { filter: /[\\/]stores[\\/](ui[\\/]uiStore|player[\\/]playerStore)(?:\.ts)?$/ },
              (args) => ({
                path: args.path.includes('uiStore') ? 'ui' : 'player',
                namespace: 'fixture'
              })
            )
            build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: id }) => ({
              contents:
                id === 'ui'
                  ? 'export const useUIStore=()=>window.cardUi'
                  : 'export const usePlayerStore=()=>window.cardPlayer',
              loader: 'js'
            }))
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
      width: 1280,
      height: 850,
      webPreferences: { sandbox: true, offscreen: true, backgroundThrottling: false }
    })
    const errors = []
    window.webContents.on('console-message', (event) => {
      if (event.level === 'error') {
        errors.push(event.message)
        console.error(event.message)
      }
    })
    const fixture = path.join(app.getPath('userData'), 'card.html')
    fs.writeFileSync(fixture, '<html><body><div id="app"></div></body></html>')
    await window.loadFile(fixture)
    const sprite = [
      'arrow/arrow-left-light.svg',
      'arrow/arrow-right-light.svg',
      'common/music.svg',
      'play/play.svg',
      'play/pause.svg'
    ]
      .map((file) =>
        fs
          .readFileSync(path.join('src/renderer/src/assets/svg', file), 'utf8')
          .replace(/<\?xml[^>]*\?>/g, '')
          .replace(/\s(?:width|height)="[^"]*"/g, '')
          .replace(
            /<svg\b([^>]*)>/,
            `<symbol $1 id="icon-${file.replace(/\.svg$/, '').replace(/\//g, '-')}">`
          )
          .replace('</svg>', '</symbol>')
      )
      .join('')
    await window.webContents.executeJavaScript(
      `document.body.insertAdjacentHTML('beforeend',${JSON.stringify('<svg style="display:none">' + sprite + '</svg>')});void 0;`
    )
    const mainCss = fs
      .readdirSync('out/renderer/assets')
      .find((file) => /^main-.*\.css$/.test(file))
    const css =
      fs.readFileSync(path.join('out/renderer/assets', mainCss), 'utf8') + styles.join('\n')
    await window.webContents.executeJavaScript(
      `const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style);window.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),16);window.cancelAnimationFrame=clearTimeout;void 0;`
    )
    await window.webContents.executeJavaScript(bundle.outputFiles[0].text)
    const result = await window.webContents.executeJavaScript(`(async()=>{
      const {Vue,createI18n,CardView,LayoutModeTransition,eventBus,zh}=CardCheck;
      const {createApp,h,reactive,nextTick,watch}=Vue;
      const checks=[];const check=(ok,message)=>{if(!ok)throw new Error(message);checks.push(message)};
      const wait=async(ms=30)=>{await nextTick();await new Promise(resolve=>setTimeout(resolve,ms))};
      window.cardUi=reactive({useCardView:false,reduceMotion:false,artistSeparator:' / ',normalizeMetadataSeparator:true});
      watch(()=>window.cardUi.reduceMotion,value=>document.documentElement.classList.toggle('reduce-motion',value));
      const songs=(offset,label)=>Array.from({length:8},(_,i)=>({id:offset+i,title:label+' '+(i+1),artist:'Studio sessions',cover:String(offset+i),songStatus:1}));
      const all=songs(1,'Library'),evening=songs(101,'Evening'),quiet=songs(201,'Quiet');
      const playCalls=[];
      window.cardPlayer=reactive({currentQueueSong:all[2],currentFile:'fixture.wav',isPlaying:true,playCollection:async(...args)=>playCalls.push(args),play:async()=>{},pause:async()=>{}});
      const pending=[];let automatic=true;
      window.api={database:{command:(action,params)=>{
        if(action==='listPlaylists')return Promise.resolve({success:true,data:[{id:1,name:'Evening sessions'},{id:2,name:'Quiet hours'},{id:3,name:'Empty playlist'},{id:4,name:'Unavailable'}]});
        if(action==='querySongs'&&automatic)return Promise.resolve({success:true,data:{data:all}});
        return new Promise(resolve=>pending.push({id:params?.playlistId??null,resolve,done:false}));
      }}};
      const resolve=(id,data,success=true)=>{const request=pending.find(request=>request.id===id&&!request.done);check(!!request,'Requested collection '+id+' is pending');request.done=true;request.resolve(success?{success:true,data:{data}}:{success:false,error:'fixture failure'})};
      const pill=name=>[...document.querySelectorAll('.playlist-pill')].find(button=>button.textContent.trim()===name);
      const app=createApp({render:()=>h('div',{style:'height:100vh;overflow:hidden'},[h(LayoutModeTransition,{card:window.cardUi.useCardView,reduceMotion:window.cardUi.reduceMotion},{default:()=>h('section',{id:'normal-view',style:'width:100%;display:grid;place-items:center'},[h('button','Library view')]),card:()=>h(CardView,{class:'flex-1 min-h-0 overflow-auto'})})])}).use(createI18n({legacy:false,locale:'zh',messages:{zh},missingWarn:false,fallbackWarn:false}));app.mount('#app');await wait();
      window.cardUi.useCardView=true;await wait(35);
      check(document.querySelector('#normal-view')&&document.querySelector('[data-mode=library]').inert&&!document.querySelector('.card-view'),'Mode entry fades the old surface first and blocks its controls');
      await wait(850);
      check(document.querySelectorAll('.card-item').length===9&&Number(getComputedStyle(document.querySelector('.card-stage')).opacity)>0.99,'Card mode enters with a fully visible bounded carousel');
      check(document.querySelector('[data-virtual-index="2"]').textContent.includes('Library 3'),'Entry centers the currently playing song before revealing cards');
      check(Math.abs(document.querySelector('.card-view').getBoundingClientRect().width-innerWidth)<1,'Card content fills the mode surface without shifting its center');
      pill('Evening sessions').click();await wait(100);
      check(document.querySelector('.card-carousel').textContent.includes('Library 3')&&Number(getComputedStyle(document.querySelector('.card-carousel')).opacity)>0.99,'Slow queries keep the existing collection visible instead of fading to blank');
      check(pill('Evening sessions').classList.contains('is-active')&&document.querySelector('.card-carousel').inert,'Playlist selection responds immediately while old playback controls are blocked');
      document.querySelector('.card-play-button').click();check(playCalls.length===0,'Loading a new playlist cannot play the previous songs under the new identity');
      resolve(1,evening);await wait(65);
      check(document.querySelector('.card-carousel').textContent.includes('Library 3')&&Number(getComputedStyle(document.querySelector('.card-carousel')).opacity)<0.99,'Ready data waits for the previous carousel to leave');
      await wait(210);
      check(document.querySelector('.card-carousel').textContent.includes('Evening 1')&&document.querySelector('.card-carousel').getAnimations().length===1,'The new collection moves in after the old collection has left');
      await wait(450);
      check(!document.querySelector('.card-carousel').inert&&document.querySelector('.card-carousel').getAnimations().length===0&&Number(getComputedStyle(document.querySelector('.card-carousel')).opacity)===1,'Playlist entry ends with normal interaction and no retained animation');
      document.querySelector('[data-virtual-index="0"] .card-play-button').click();await wait();check(playCalls[0]?.[0][0].id===101&&playCalls[0]?.[1]===101&&playCalls[0]?.[2]===1,'Playback after entry uses the displayed collection and its playlist identity');
      pill('Quiet hours').click();await wait();resolve(2,quiet);await wait(60);pill('Empty playlist').click();await wait();resolve(3,[]);await wait(700);
      check(!document.querySelector('.card-item')&&document.querySelector('.card-carousel').textContent.includes(zh.library.empty),'A newer selection cancels an in-flight leave and can transition to an empty collection');
      pill('Evening sessions').click();await wait();pill('Quiet hours').click();await wait();resolve(2,quiet);await wait(20);resolve(1,evening);await wait(700);
      check(document.querySelector('.card-carousel').textContent.includes('Quiet 1')&&!document.querySelector('.card-carousel').textContent.includes('Evening 1')&&pill('Quiet hours').classList.contains('is-active'),'Out-of-order responses cannot resurrect an older playlist');
      pill('Unavailable').click();await wait();resolve(4,[],false);await wait(250);
      check(document.querySelector('.card-carousel').textContent.includes('Quiet 1')&&pill('Quiet hours').classList.contains('is-active')&&!document.querySelector('.card-carousel').inert,'A failed query restores selection and leaves the previous collection usable');
      pill('Evening sessions').click();await wait();resolve(1,evening);await wait(65);window.cardUi.reduceMotion=true;await wait(65);
      check(document.querySelector('.card-carousel').textContent.includes('Evening 1')&&document.querySelector('.card-carousel').getAnimations().length===0&&!document.querySelector('.card-carousel').inert,'Reduced motion commits the new collection immediately without a hidden phase');
      window.cardUi.useCardView=false;await wait(50);
      check(!!document.querySelector('#normal-view')&&!document.querySelector('.card-view'),'Reduced motion also skips mode exit animation');
      window.cardUi.reduceMotion=false;window.cardUi.useCardView=true;await wait(850);window.cardUi.useCardView=false;await wait(40);
      check(document.querySelector('[data-mode=card]')?.inert&&!document.querySelector('#normal-view'),'Card mode remains visible and inert while its exit animation runs');
      window.cardUi.useCardView=true;await wait(900);
      check(!!document.querySelector('.card-view')&&!document.querySelector('[data-mode=card]').inert&&!document.querySelector('#normal-view'),'A quick mode reversal finishes on the latest requested mode');
      pill('Quiet hours').click();await wait();resolve(2,quiet);await wait(260);
      const departing=document.querySelector('.card-carousel');const previousOpacity=Number(getComputedStyle(departing).opacity);window.cardUi.useCardView=false;await wait(35);
      check(departing.isConnected&&Number(getComputedStyle(departing).opacity)<=previousOpacity+0.15&&departing.getAnimations().length===0,'Exiting during playlist entry freezes its current pose instead of flashing back to full opacity');
      await wait(400);window.cardUi.useCardView=true;await wait(850);
      window.cardUi.reduceMotion=true;await wait();pill('Quiet hours').click();await wait();window.cardUi.useCardView=false;await wait(60);resolve(2,quiet);await wait(100);
      check(!document.querySelector('.card-view')&&!!document.querySelector('#normal-view'),'Closing during a pending request prevents late cards and mount work from returning');
      window.cardUi.reduceMotion=false;window.cardUi.useCardView=true;await wait(900);
      for(const image of document.querySelectorAll('img'))await image.decode().catch(()=>{});
      window.cardMotionApp=app;return {passed:checks.length,checks};
    })().catch(error=>{console.error(error.stack);throw error})`)
    await new Promise((resolve) => setTimeout(resolve, 100))
    fs.writeFileSync(
      'build/card-motion-desktop.png',
      (await window.webContents.capturePage()).toPNG()
    )
    window.setContentSize(720, 800)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const dimensions = await window.webContents.executeJavaScript(
      `({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,cards:document.querySelectorAll('.card-item').length})`
    )
    if (dimensions.scrollWidth > dimensions.width)
      throw new Error('Card mode overflows the compact window')
    fs.writeFileSync(
      'build/card-motion-compact.png',
      (await window.webContents.capturePage()).toPNG()
    )
    await window.webContents.executeJavaScript('window.cardMotionApp.unmount();void 0;')
    if (errors.length) throw new Error(errors.join('\n'))
    console.log(JSON.stringify({ ...result, compact: dimensions }, null, 2))
    window.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
