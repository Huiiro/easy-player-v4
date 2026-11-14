/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const esbuild = require('esbuild')
const { parse, compileScript, compileStyle } = require('@vue/compiler-sfc')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ep-background-transition-')))
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  try {
    const styles = []
    let scope = 0
    const bundle = await esbuild.build({
      stdin: {
        contents: `import * as Vue from 'vue';import {createI18n} from 'vue-i18n';import AppBackground from './src/renderer/src/components/background/AppBackground.vue';import {backgroundAppearanceHandoff} from './src/renderer/src/services/appearanceController';import {usePlayerRhythm} from './src/renderer/src/components/player/usePlayerRhythm';export {Vue,createI18n,AppBackground,backgroundAppearanceHandoff,usePlayerRhythm};`,
        resolveDir: process.cwd()
      },
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      globalName: 'BackgroundCheck',
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
          name: 'background-fixture',
          setup(build) {
            build.onResolve({ filter: /stores[\\/]ui[\\/]uiStore(?:\.ts)?$/ }, () => ({
              path: 'ui',
              namespace: 'fixture'
            }))
            build.onResolve({ filter: /stores[\\/]player[\\/]playerStore(?:\.ts)?$/ }, () => ({
              path: 'player',
              namespace: 'fixture'
            }))
            build.onResolve({ filter: /systemBackgroundRegistry(?:\.ts)?$/ }, () => ({
              path: 'themes',
              namespace: 'fixture'
            }))
            build.onResolve({ filter: /useMessage(?:\.ts)?$/ }, () => ({
              path: 'message',
              namespace: 'fixture'
            }))
            build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: id }) => ({
              contents: {
                ui: 'export const useUIStore=()=>window.__ui',
                player: 'export const usePlayerStore=()=>({currentQueueSong:null})',
                themes:
                  'export const getSystemBackgroundTheme=id=>window.__themes[id]??{id:"none"}',
                message: 'export const useMessage=()=>({error:value=>window.__errors.push(value)})'
              }[id],
              loader: 'js'
            }))
            build.onLoad({ filter: /\.vue$/ }, ({ path: filename }) => {
              const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
              const id = 'background-' + ++scope
              for (const style of descriptor.styles) {
                const result = compileStyle({
                  source: style.content,
                  filename,
                  id: 'data-v-' + id,
                  scoped: style.scoped
                })
                if (result.errors.length) throw result.errors[0]
                styles.push(result.code)
              }
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
    const cssFile = fs
      .readdirSync('out/renderer/assets')
      .find((file) => /^main-.*\.css$/.test(file))
    const html = path.join(app.getPath('userData'), 'background.html')
    fs.writeFileSync(html, '<html><body><div id="app"></div></body></html>')
    const win = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      webPreferences: { sandbox: true, offscreen: true, backgroundThrottling: false }
    })
    const errors = []
    win.webContents.on('console-message', (event) => {
      if (event.level === 'error') errors.push(event.message)
    })
    await win.loadFile(html)
    await win.webContents.insertCSS(
      fs.readFileSync(path.join('out/renderer/assets', cssFile), 'utf8') +
        styles.join('\n') +
        '\n#app{height:100vh;position:relative}body[data-theme="a"] .fixture-scene{background-image:linear-gradient(#142a38,#243e50)}body[data-theme="b"] .fixture-scene{background-image:linear-gradient(#33452a,#1e3020)}'
    )
    await win.webContents.executeJavaScript(bundle.outputFiles[0].text)
    const result = await win.webContents.executeJavaScript(`(async()=>{
      const {Vue,createI18n,AppBackground,backgroundAppearanceHandoff}=BackgroundCheck;const {h,ref,reactive,createApp,onMounted,onBeforeUnmount,watch,nextTick,defineAsyncComponent}=Vue;
      const checks=[];const check=(condition,message)=>{if(!condition)throw Error(message);checks.push(message)};
      const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
      const wait=async()=>{await nextTick();await frame();await nextTick()};
      const until=async(predicate,label)=>{const end=performance.now()+4000;while(!predicate()){if(performance.now()>end)throw Error('Timed out: '+label);await wait()}};
      let focused=true,hidden=false;
      document.hasFocus=()=>focused;Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});
      const startViewTransition=document.startViewTransition?.bind(document);document.startViewTransition=undefined;
      const root=document.documentElement;root.style.setProperty('--motion-duration-theme','240ms');root.style.setProperty('--app-header-bg','#000000');root.style.setProperty('--app-footer-bg','#000000');
      window.__errors=[];window.__themes={};window.ready={};window.fail={};const events=[];const alive=new Set();let serial=0;let maximumAlive=0;
      function renderer(name,automatic=false){return {props:{theme:Object,paused:Boolean},emits:['ready','failure'],setup(props,{emit}){
        const element=ref();const instance=++serial;
        onMounted(()=>{alive.add(instance);maximumAlive=Math.max(maximumAlive,alive.size);events.push({type:'mount',name,instance});window.ready[name]=()=>emit('ready');window.fail[name]=()=>emit('failure');if(automatic)emit('ready')});
        onBeforeUnmount(()=>{const own=element.value?.closest('.app-background-stage');const other=[...document.querySelectorAll('.app-background-stage')].filter(node=>node!==own).map(node=>Number(getComputedStyle(node).opacity));events.push({type:'dispose',name,instance,coveredBy:Math.max(0,...other)});alive.delete(instance)});
        watch(()=>props.paused,paused=>events.push({type:'pause',name,paused}),{immediate:true});
        return()=>h('div',{ref:element,class:'fixture-scene ep-app-background','data-renderer':name,style:{position:'absolute',inset:'0',backgroundColor:props.theme.data.background}},name)
      }}}
      const colors={a:'#142a38',b:'#33452a',c:'#422a3d',d:'#302746',f:'#3a2823',g:'rgba(20,40,60,0.35)'};
      let releaseB;const moduleB=new Promise(resolve=>{releaseB=resolve});
      for(const name of Object.keys(colors))window.__themes['plugin:'+name]={id:'plugin:'+name,pluginTheme:{pluginId:name,revision:'1',data:{background:colors[name]}},component:name==='b'?defineAsyncComponent(()=>moduleB):renderer(name,name==='a'||name==='g')};
      window.__ui=reactive({selected:'a',material:false,reduceMotion:false,showPlayer:false,accentSource:'user',songThemeColor:null,activeThemeColor:'#4dbd90',effectiveCustomThemeName:'',customBg:{url:'',kind:'image'},getBackgroundFilter:'none',
        get getBackgroundStyle(){return {backgroundImage:this.customBg.url?'url("'+this.customBg.url+'")':'none'}},
        get systemBackground(){return 'plugin:'+this.selected},
        get resolvedAppearance(){return {nativeMaterialEnabled:this.material,dark:false,contentDark:this.selected!=='none',backgroundSurface:null,backgroundScrim:null,background:this.material||this.selected==='none'?{type:'none'}:this.selected==='image'?{type:'image'}:{type:'preset',id:'plugin:'+this.selected}}}
      });
      const contrast=[];const mounted=createApp({render:()=>h('div',{class:'app-layout'},[h(AppBackground,{onContrast:value=>contrast.push(value)}),h('header',{class:'ep-header'},[h('button',{class:'ep-button transition',style:'background:var(--app-header-bg)'},'probe')]),h('footer',{class:'ep-footer'})])}).use(createI18n({legacy:false,locale:'en',messages:{en:{plugins:{themeRenderFailed:'Theme failed'},settings:{backgroundVideoUnsupported:'Video failed'}}}}));mounted.mount('#app');
      const roots=()=>[...document.querySelectorAll('.app-background-stage')];
      const target=name=>roots().find(node=>node.dataset.backgroundKey==='preset:plugin:'+name+':1');
      const settled=name=>roots().length===1&&target(name)?.dataset.backgroundPhase==='current';
      const paletteEvents=[];const choose=name=>{window.__ui.selected=name;document.body.dataset.theme=name;void nextTick(()=>{const key=name==='none'?'none':name==='image'?'image:'+window.__ui.customBg.url:'preset:plugin:'+name+':1';backgroundAppearanceHandoff.stage(key,animated=>{root.classList.toggle('theme-transitioning',animated);void getComputedStyle(root).transitionProperty;root.style.setProperty('--app-header-bg',name==='b'?'#ffffff':'#000000');root.style.setProperty('--app-footer-bg',name==='b'?'#ffffff':'#000000');paletteEvents.push(name)})})};
      document.body.dataset.theme='a';await until(()=>!!window.ready.a,'initial scene');await wait();
      const rhythmHost=document.createElement('div');document.body.append(rhythmHost);let rhythm;
      const rhythmPlayer=reactive({isPlaying:true,rhythmVisualConfig:{enabled:true,reducedMotion:false,intensity:0.6},audioAnalysis:{rms:0.5,lowEnergy:0.5,onsetStrength:0.5}});
      const rhythmApp=createApp({setup(){rhythm=BackgroundCheck.usePlayerRhythm(rhythmPlayer,window.__ui);return()=>null}});rhythmApp.mount(rhythmHost);
      const paused=()=>events.filter(event=>event.type==='pause'&&event.name==='a').at(-1)?.paused;
      focused=false;window.dispatchEvent(new Event('blur'));await wait();
      check(paused()===true&&!rhythm.isPanelVisible.value,'Default blur policy pauses application backgrounds and player visuals');
      window.__ui.pauseAnimationsOnBlur=false;await wait();
      check(paused()===false&&rhythm.isPanelVisible.value,'Turning off blur pausing immediately resumes visible unfocused animations');
      hidden=true;document.dispatchEvent(new Event('visibilitychange'));await wait();
      check(paused()===true&&!rhythm.isPanelVisible.value,'Hidden windows still pause animations when blur pausing is disabled');
      hidden=false;document.dispatchEvent(new Event('visibilitychange'));await wait();
      check(paused()===false&&rhythm.isPanelVisible.value,'Showing an unfocused window resumes animations under the disabled blur policy');
      window.__ui.pauseAnimationsOnBlur=true;await wait();
      check(paused()===true&&!rhythm.isPanelVisible.value,'Reenabling blur pausing immediately stops unfocused animations');
      focused=true;window.dispatchEvent(new Event('focus'));await wait();
      check(paused()===false&&rhythm.isPanelVisible.value,'Regaining focus resumes animations with the default policy');
      rhythmApp.unmount();rhythmHost.remove();
      focused=false;window.dispatchEvent(new Event('blur'));await wait();
      check(rhythm.isPanelVisible.value,'Disposed animation activity stops listening to focus events');
      focused=true;window.dispatchEvent(new Event('focus'));await wait();
      const originalA=document.querySelector('[data-renderer="a"]');const originalImage=getComputedStyle(originalA).backgroundImage;
      choose('b');await wait();await wait();
      check(roots().length===2&&Number(getComputedStyle(target('a')).opacity)===1&&Number(getComputedStyle(target('b')).opacity)===0,'Pending async modules keep the previous background opaque');
      check(originalA.isConnected&&!events.some(event=>event.type==='dispose'&&event.name==='a'),'Outgoing resources remain mounted while a candidate loads');
      check(!paletteEvents.includes('b')&&getComputedStyle(document.querySelector('.ep-header')).backgroundColor==='rgb(0, 0, 0)','Header and footer keep their visible palette while the next background loads');
      check(getComputedStyle(originalA).backgroundImage===originalImage,'Outgoing image styles are frozen before the next theme stylesheet applies');
      releaseB(renderer('b'));await until(()=>!!window.ready.b,'candidate module');await wait();
      check(target('b').dataset.backgroundPhase==='pending'&&Number(getComputedStyle(target('b')).opacity)===0,'Module availability alone does not reveal an unpainted renderer');
      check(events.some(event=>event.type==='pause'&&event.name==='a'&&event.paused),'Outgoing animations pause while retaining their painted frame');
      window.ready.b();const opacities=[];let exposedBase=false;let emptyFrame=false;const timingSamples=[];
      while(!settled('b')){await wait();const incoming=target('b');if(incoming){const opacity=Number(getComputedStyle(incoming).opacity);opacities.push(opacity);const animation=root.getAnimations().find(item=>item.transitionProperty==='--app-header-bg');if(animation&&opacity>0&&opacity<1)timingSamples.push({opacity,progress:animation.effect.getComputedTiming().progress,root:getComputedStyle(root).getPropertyValue('--app-header-bg'),header:getComputedStyle(document.querySelector('.ep-header')).getPropertyValue('--app-header-bg'),button:getComputedStyle(document.querySelector('button')).backgroundColor,headerBackground:getComputedStyle(document.querySelector('.ep-header')).backgroundColor})}const old=target('a');if(old&&Number(getComputedStyle(old).opacity)!==1)exposedBase=true;if(roots().length===0)emptyFrame=true}
      check(!emptyFrame,'The background stack never becomes empty during handoff');
      check(opacities.some(value=>value>0&&value<1),'Ready backgrounds fade in through real intermediate opacity values');
      check(timingSamples.length>1&&timingSamples.every(sample=>Math.abs(sample.opacity-sample.progress)<0.025),'Background opacity and chrome palette share one start frame, duration and easing');
      check(timingSamples.every(sample=>sample.root===sample.header),'The fallback keeps chrome tokens on their root animation clock');
      check(!exposedBase&&opacities.every((value,index)=>index===0||value>=opacities[index-1]),'Only the incoming layer fades, avoiding a translucent gap to the page base');
      check(events.find(event=>event.type==='dispose'&&event.name==='a').coveredBy===1,'The old renderer is disposed only after another layer fully covers it');
      choose('c');await until(()=>!!window.ready.c,'candidate C');const staleReady=window.ready.c;choose('d');await until(()=>!!window.ready.d,'candidate D');staleReady();await wait();
      check(!target('c')&&target('b')&&target('d').dataset.backgroundPhase==='pending','Rapid pending selections discard stale resources and ignore late ready events');
      window.ready.d();await until(()=>target('d')?.dataset.backgroundPhase==='entering','D fade');const enteringImage=getComputedStyle(document.querySelector('[data-renderer="d"]')).backgroundImage;choose('a');await wait();
      check(getComputedStyle(document.querySelector('[data-renderer="d"]')).backgroundImage===enteringImage,'Queued theme styles cannot rewrite the incoming image during its fade');
      check(!target('a')&&alive.size<=2,'Selections made during a fade wait for its resource handoff');
      await until(()=>settled('a'),'latest queued selection');check(maximumAlive<=2,'At most two renderer resources are retained, including rapid queued switches');
      const retainedA=document.querySelector('[data-renderer="a"]');choose('c');await until(()=>!!target('c'),'pending cancel');choose('a');await wait();
      check(settled('a')&&document.querySelector('[data-renderer="a"]')===retainedA,'Returning to the current background cancels pending work without remounting it');
      choose('f');await until(()=>!!window.fail.f,'failure candidate');window.fail.f();await until(()=>settled('f'),'failed candidate fallback');
      check(window.__errors.length===1&&alive.size===1,'A failed candidate settles to its fallback and releases outgoing resources');
      choose('g');await until(()=>settled('g'),'translucent theme handoff');
      check(getComputedStyle(target('g')).backgroundColor.endsWith('1)')||!getComputedStyle(target('g')).backgroundColor.startsWith('rgba'),'Translucent theme fills have an opaque base before their outgoing renderer is removed');
      window.__ui.customBg.url='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#233a4a"/></svg>');choose('image');await until(()=>roots().length===1&&!!document.querySelector('.background-image'),'decoded image handoff');
      check(getComputedStyle(document.querySelector('.background-image')).backgroundImage.includes('data:image/svg+xml'),'Custom image resources decode before their opacity handoff completes');
      window.__ui.reduceMotion=true;choose('c');await wait();
      check(settled('c')&&getComputedStyle(target('c')).transitionDuration==='0s','Reduced motion switches immediately without a fade or retained outgoing canvas');
      window.__ui.reduceMotion=false;choose('d');await until(()=>!!target('d'),'native interrupt');window.__ui.material=true;await wait();await new Promise(resolve=>setTimeout(resolve,400));
      check(roots().length===0&&alive.size===0,'Native material interrupts pending transitions and leaves no opaque renderer behind');
      window.__ui.material=false;choose('none');await wait();const beforeContrast=contrast.at(-1);choose('b');await until(()=>!!target('b'),'foreground wait');
      check(contrast.at(-1)===beforeContrast,'Foreground contrast stays with the visible scene while the next renderer loads');
      window.ready.b();await until(()=>settled('b'),'foreground commit');check(contrast.at(-1)===true,'Foreground contrast changes with the visible background handoff');
      check(!!startViewTransition,'The desktop runtime supports atomic page snapshots');
      const snapshots=[];document.startViewTransition=update=>{const transition=startViewTransition(update);snapshots.push(transition);return transition};
      await new Promise(resolve=>setTimeout(resolve,350));choose('g');await until(()=>snapshots.length===1,'page snapshot');await snapshots[0].ready;
      check(target('b')&&target('g')&&Number(getComputedStyle(target('g')).opacity)===1,'Page snapshot handoff retains the outgoing renderer until the shared animation finishes');
      const snapshotStyle=getComputedStyle(root,'::view-transition-new(root)');
      const easing=value=>value.trim().slice(value.indexOf('(')+1,-1).split(',').map(Number).join(',');
      check(snapshotStyle.animationDuration==='0.24s'&&easing(snapshotStyle.animationTimingFunction)===easing(getComputedStyle(root).getPropertyValue('--motion-ease-standard')),'The complete page uses the same configured theme duration and easing');
      check(getComputedStyle(document.querySelector('button')).backgroundColor==='rgb(0, 0, 0)'&&getComputedStyle(document.querySelector('.ep-header')).backgroundColor==='rgb(0, 0, 0)','Background, chrome and controls commit atomically inside the same new page snapshot');
      const reveal=document.getAnimations().find(animation=>animation.animationName==='appearance-reveal');await wait();
      check(reveal&&reveal.effect.getComputedTiming().progress>0&&reveal.effect.getComputedTiming().progress<1,'The complete page crossfades through real intermediate snapshot opacity');
      await snapshots[0].finished;await until(()=>settled('g'),'page snapshot completion');
      check(alive.size===1&&!root.classList.contains('appearance-snapshot'),'Completing a page snapshot releases old GPU resources and temporary transition overrides');
      document.startViewTransition=undefined;
      choose('d');await until(()=>!!target('d'),'unmount interrupt');window.ready.d();await wait();mounted.unmount();await new Promise(resolve=>setTimeout(resolve,400));
      check(alive.size===0&&roots().length===0,'Unmount cancels pending fades and disposes all renderer resources');
      return {passed:checks.length,checks,maximumAlive,opacitySamples:opacities,timingSamples};
    })()`)
    if (errors.length) throw Error(errors.join('\n'))
    console.log(JSON.stringify(result, null, 2))
    win.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
