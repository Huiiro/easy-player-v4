/* eslint-disable @typescript-eslint/no-require-imports */
// Hidden Electron integration checks against Chromium's real DOM and focus handling.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const esbuild = require('esbuild')
const { parse, compileScript } = require('@vue/compiler-sfc')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ep-ui-check-')))
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  try {
    const sfcStyles = []
    const bundle = await esbuild.build({
      stdin: {
        contents: `import * as Vue from 'vue'; import { createI18n } from 'vue-i18n';
          import * as UI from './src/renderer/src/components/ui';
          import { floatingPosition } from './src/renderer/src/components/ui/floatingPosition';
          import { fromHex, rgbaToHex, hsvaToRgba } from './src/renderer/src/components/ui/color';
          import AppPageOutlet from './src/renderer/src/components/layout/AppPageOutlet.vue';
          import PlayerPanelTransition from './src/renderer/src/components/layout/PlayerPanelTransition.vue';
          import { createRouter, createMemoryHistory } from 'vue-router';
          import { useEqEditor } from './src/renderer/src/components/player/useEqEditor';
          import { useSongSelection } from './src/renderer/src/components/songlist/useSongSelection';
          import { useCardLibrary } from './src/renderer/src/components/library/useCardLibrary';
          import { useSongActions } from './src/renderer/src/components/songlist/useSongActions';
          import { useFooterSwipe } from './src/renderer/src/components/player/useFooterSwipe';
          import { useSeekProgress } from './src/renderer/src/components/player/useSeekProgress';
          import { useSongActivation } from './src/renderer/src/hooks/useSongActivation';
          import DspEffectEditor from './src/renderer/src/components/player/DspEffectEditor.vue';
          import AudioOutputSettings from './src/renderer/src/components/player/AudioOutputSettings.vue';
          import ImpulseResponseEditor from './src/renderer/src/components/player/ImpulseResponseEditor.vue';
          import LibrarySettings from './src/renderer/src/components/settings/LibrarySettings.vue';
          import SongDetailsDialog from './src/renderer/src/components/songlist/SongDetailsDialog.vue';
          export { Vue, UI, createI18n, floatingPosition, fromHex, rgbaToHex, hsvaToRgba, AppPageOutlet, PlayerPanelTransition, createRouter, createMemoryHistory, useEqEditor, useSongSelection, useCardLibrary, useSongActions, useFooterSwipe, useSeekProgress, useSongActivation, DspEffectEditor, AudioOutputSettings, ImpulseResponseEditor, LibrarySettings, SongDetailsDialog };`,
        resolveDir: process.cwd()
      },
      bundle: true,
      platform: 'browser',
      format: 'iife',
      globalName: 'Checks',
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
          name: 'vue-sfc',
          setup(build) {
            build.onResolve({ filter: /[\\/]stores[\\/]ui[\\/]uiStore(?:\.ts)?$/ }, () => ({
              path: 'ui-store',
              namespace: 'activation-test'
            }))
            build.onLoad({ filter: /.*/, namespace: 'activation-test' }, () => ({
              contents: 'export const useUIStore = () => globalThis.__activationUi',
              loader: 'js'
            }))
            build.onResolve({ filter: /[\\/]stores[\\/]player[\\/]playerStore(?:\.ts)?$/ }, () => ({
              path: 'player-store',
              namespace: 'ui-test'
            }))
            build.onLoad({ filter: /.*/, namespace: 'ui-test' }, () => ({
              contents: 'export const usePlayerStore = () => globalThis.__uiPlayer',
              loader: 'js'
            }))
            build.onLoad({ filter: /\.vue$/ }, ({ path: filename }) => {
              const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
              descriptor.styles.forEach((style) => sfcStyles.push(style.content))
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
      width: 900,
      height: 700,
      webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true }
    })
    window.webContents.on('console-message', (event) => {
      if (/warn|error/i.test(event.message)) console.log(event.message)
    })
    const fixture = path.join(app.getPath('userData'), 'fixture.html')
    fs.writeFileSync(fixture, '<html><body></body></html>')
    await window.loadFile(fixture)
    await window.webContents.executeJavaScript(
      'window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 16); window.cancelAnimationFrame = clearTimeout; void 0;'
    )
    await window.webContents.executeJavaScript(bundle.outputFiles[0].text)
    const cssPath = fs
      .readdirSync('out/renderer/assets')
      .find((file) => /^main-.*\.css$/.test(file))
    const css =
      fs.readFileSync(path.join('out/renderer/assets', cssPath), 'utf8') + sfcStyles.join('\n')
    await window.webContents.executeJavaScript(
      `const style = document.createElement('style'); style.textContent = ${JSON.stringify(css)}; document.head.append(style);`
    )
    const results = await window.webContents.executeJavaScript(`(async () => {
      const { Vue, UI, createI18n, floatingPosition, fromHex, rgbaToHex, hsvaToRgba, AppPageOutlet, PlayerPanelTransition, createRouter, createMemoryHistory, useEqEditor, useSongSelection, useCardLibrary, useSongActions, useFooterSwipe, useSeekProgress, useSongActivation, DspEffectEditor, AudioOutputSettings, ImpulseResponseEditor, LibrarySettings, SongDetailsDialog } = Checks;
      const { createApp, h, reactive, nextTick, onMounted, onActivated } = Vue;
      const results = [];
      function check(value, message) { if (!value) throw new Error(message); results.push(message); }
      const wait = async (ms = 100) => { await nextTick(); await new Promise(resolve => setTimeout(resolve, ms)); };
      let activeApp;
      async function mount(component, props = {}, slots) {
        activeApp?.unmount(); document.body.innerHTML = '<div id="app"></div>';
        const state = reactive(props);
        activeApp = createApp({ render: () => h(component, state, slots) });
        activeApp.use(createI18n({ legacy:false, locale:'en', missingWarn:false, fallbackWarn:false, messages:{ en:{ common:{close:'Close',cancel:'Cancel'}, ui:{clear:'Clear',selectPlaceholder:'Select',empty:'Empty',color:'Color',colorValue:'Color value',presets:'Presets',hue:'Hue',saturation:'Saturation',brightness:'Brightness',alpha:'Opacity'} } } }));
        activeApp.mount('#app'); await wait(); return state;
      }
      window.__activationUi=reactive({songPlayTrigger:'double'});
      let songPlays=0;
      const activation=useSongActivation();
      const activate=event=>activation(event,()=>songPlays++);
      await mount({render:()=>h('div',{id:'song-row',onClick:activate,onDblclick:activate},[h('span',{id:'song-title'},'Song'),h('button',{id:'song-action'},'Remove'),h('input',{type:'checkbox'})])});
      const title=document.querySelector('#song-title');
      const mouse=(target,type,detail)=>target.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,detail}));
      mouse(title,'click',1);mouse(title,'click',2);
      check(songPlays===0,'Default song activation ignores both clicks before a double click');
      mouse(title,'dblclick',2);check(songPlays===1,'Default song activation plays once on double click');
      window.__activationUi.songPlayTrigger='single';
      mouse(title,'click',1);mouse(title,'click',2);mouse(title,'dblclick',2);
      check(songPlays===2,'Single click activation takes effect immediately and ignores repeated double click events');
      for(const target of [document.querySelector('#song-action'),document.querySelector('input')]) {
        mouse(target,'click',1);mouse(target,'dblclick',2);
      }
      check(songPlays===2,'Song row controls never trigger playback through bubbling');
      window.__activationUi.songPlayTrigger='double';mouse(title,'click',1);
      check(songPlays===2,'Switching back to double click restores the original interaction');
      document.querySelector('#song-row').click();check(songPlays===3,'Keyboard-style button activation remains immediate');
      let clicks = 0;
      let state = await mount(UI.BaseButton, { loading:true, onClick:() => clicks++ }, () => 'Save');
      document.querySelector('button').click(); check(clicks === 0 && document.querySelector('button').disabled, 'loading button blocks activation');
      state.loading = false; await wait(); document.querySelector('button').click(); check(clicks === 1, 'button restores activation');
      for(const [size,height] of [['xs',24],['sm',28],['md',32],['lg',40]]) {
        const dimensions=[];
        for(const control of [UI.BaseButton,UI.BaseInput,UI.BaseSelect]) {
          await mount(control,{size,modelValue:'',options:[]},()=> 'Control');
          dimensions.push(document.querySelector('.ep-button,.ep-input,.ep-select').getBoundingClientRect().height);
        }
        check(dimensions.every(value=>Math.abs(value-height)<0.5),'shared '+size+' geometry matches across button/input/select');
      }
      document.documentElement.style.setProperty('--ep-control-height-md','44px');
      await mount(UI.BaseInput,{modelValue:'Custom size'});check(document.querySelector('input').getBoundingClientRect().height===44,'control height can be overridden through theme token');
      document.documentElement.style.removeProperty('--ep-control-height-md');
      const longOptions=[{value:'a',label:'An extremely long selected option that must never stretch the surrounding layout'}];
      for(const teleport of [false,true]) {
        await mount(UI.BaseSelect,{modelValue:'a',options:longOptions,class:'w-64',teleport});
        let root=document.querySelector('.ep-select-root'),button=document.querySelector('.ep-select');
        check(Math.abs(root.getBoundingClientRect().width-256)<1 && Math.abs(button.getBoundingClientRect().width-256)<1,'select fixed width reaches native trigger (teleport='+teleport+')');
        button.click();await wait(250);
        check(Math.abs(document.querySelector('.ep-select-options').getBoundingClientRect().width-button.getBoundingClientRect().width)<1,'select dropdown matches trigger width (teleport='+teleport+')');
      }
      await mount(UI.BaseSelect,{modelValue:'a',options:longOptions,class:'w-full'});document.querySelector('#app').style.width='300px';await wait();
      check(document.querySelector('.ep-select').getBoundingClientRect().width===300,'full width select fills constrained container');
      await mount(UI.BaseSelect,{modelValue:'a',options:longOptions,class:'w-1/3'});document.querySelector('#app').style.width='600px';await wait();
      check(Math.abs(document.querySelector('.ep-select').getBoundingClientRect().width-200)<1,'percentage select width stays proportional');
      await mount(UI.BaseSelect,{modelValue:'a',options:longOptions,class:'flex-1 min-w-0'});
      const flex=document.querySelector('#app');flex.style.cssText='display:flex;width:300px';const sibling=document.createElement('div');sibling.style.cssText='width:100px;flex-shrink:0';flex.append(sibling);await wait();
      check(document.querySelector('.ep-select').getBoundingClientRect().width===200,'select shrinks within flex layout despite long label');
      let updates = [];
      state = await mount(UI.BaseInput, { modelValue:0, disabled:true, 'onUpdate:modelValue':v => updates.push(v) });
      check(!document.querySelector('button'), 'disabled input hides clear');
      state.disabled = false; state.readonly = true; await wait(); check(!document.querySelector('button'), 'readonly input hides clear');
      state.readonly = false; await wait(); document.querySelector('button').click(); check(updates[0] === '', 'zero value can be cleared');
      state['aria-label'] = 'Changed label'; await wait(); check(document.querySelector('input').getAttribute('aria-label') === 'Changed label', 'input forwards changing attributes');
      updates = []; let commits = [];
      state = await mount(UI.BaseSlider, { modelValue:0.5, min:0, max:100, step:10, transform:v=>v/100, reverseTransform:v=>v*100, 'onUpdate:modelValue':v=>updates.push(v), onChange:v=>commits.push(v) });
      const slider = document.querySelector('[role=slider]'); slider.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
      check(updates[0] === 0.6 && commits[0] === 0.6, 'slider commits transformed value without stale parent state');
      state.disabled = true; await wait(); slider.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true})); check(commits.length === 1, 'disabled slider ignores keyboard');
      let seekState,finishSeek;const seeks=[];
      const seekPlayer=reactive({currentFile:'first.wav',durationMs:60000,positionMs:1000,seek:target=>{seeks.push(target);seekPlayer.positionMs=target;return new Promise(resolve=>{finishSeek=()=>resolve(true)})}});
      await mount({setup(){seekState=useSeekProgress(seekPlayer);return()=>h(UI.BaseRange,{min:0,max:seekPlayer.durationMs,value:seekState.displayPositionMs.value,onInput:seekState.previewSeek,onChange:seekState.commitSeek,onPointercancel:seekState.cancelSeek,onBlur:seekState.cancelSeek})}});
      const seekRange=document.querySelector('input[type=range]');
      const previewAt=async value=>{seekRange.value=String(value);seekRange.dispatchEvent(new Event('input',{bubbles:true}));await wait(10)};
      await previewAt(10000);await previewAt(22000);await previewAt(45000);
      check(seeks.length===0 && seekState.displayPositionFormatted.value==='0:45','progress drag updates only local position and time preview');
      seekPlayer.positionMs=1500;await wait();
      check(Number(seekRange.value)===45000,'playback position reports never pull a dragging progress thumb backwards');
      seekRange.dispatchEvent(new Event('change',{bubbles:true}));await wait();
      check(seeks.length===1 && seeks[0]===45000,'progress release sends exactly one seek to the final position');
      seekPlayer.positionMs=1800;await wait();check(Number(seekRange.value)===45000,'progress preview stays stable while seek acknowledgement is pending');
      seekPlayer.positionMs=45000;finishSeek();await wait();seekPlayer.positionMs=46000;await wait();
      check(Number(seekRange.value)===46000,'progress follows playback reports again after the seek completes');
      await previewAt(25000);seekRange.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true}));seekRange.dispatchEvent(new Event('change',{bubbles:true}));await wait();
      check(seeks.length===1 && Number(seekRange.value)===46000,'cancelled progress drag never commits a seek');
      await previewAt(30000);seekPlayer.currentFile='second.wav';seekPlayer.positionMs=0;await wait();seekRange.value='30000';seekRange.dispatchEvent(new Event('change',{bubbles:true}));await wait();
      check(seeks.length===1 && Number(seekRange.value)===0,'a drag from the previous track cannot seek the next track');
      await previewAt(5000);seekRange.dispatchEvent(new Event('change',{bubbles:true}));await wait();finishSeek();await wait();
      check(seeks.length===2 && seeks[1]===5000,'progress remains usable after a cancelled track-change gesture');
      state = await mount(UI.BaseColorPicker, {modelValue:'#ff0000',disabled:true});
      document.querySelector('button').click(); await wait(); check(!document.querySelector('.ep-color-picker'),'disabled color picker cannot open');
      const rect = {left:870,right:890,top:650,bottom:680,width:20,height:30};
      const pos = floatingPosition(rect,{width:200,height:150},{width:900,height:700},'bottom','start');
      check(pos.side === 'top' && pos.left === 692 && pos.top === 492, 'floating panel flips and stays inside viewport');
      check(rgbaToHex(hsvaToRgba(fromHex('#ff000080')),true) === '#ff000080', 'color conversion retains alpha');
      let invalid = false; try { fromHex('zzzzzz'); } catch { invalid = true; } check(invalid, 'invalid color is rejected');
      let shown = 0, hidden = 0;
      state = await mount(UI.BasePopover, {trigger:'hover', teleport:true, offset:20, content:'Panel',onShow:()=>shown++,onHide:()=>hidden++}, {trigger:()=>h('span','Trigger')});
      document.querySelector('.ep-popover-trigger').dispatchEvent(new Event('pointerenter')); await wait();
      check(shown === 1 && !!document.querySelector('.ep-popover'), 'hover popover opens and emits show once');
      check(Math.abs(document.querySelector('.ep-floating').getBoundingClientRect().top-document.querySelector('.ep-popover-trigger').getBoundingClientRect().bottom-20)<2,'popover applies requested offset');
      document.querySelector('.ep-popover-trigger').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await wait(250); check(hidden === 1 && !document.querySelector('.ep-popover'), 'popover Escape closes and emits hide');
      state = await mount(UI.BaseSelect, { modelValue:'a',teleport:true,options:[{label:'Alpha',value:'a'},{label:'Beta',value:'b'},{label:'Disabled',value:'c',disabled:true}] });
      const select = document.querySelector('.ep-select'); select.focus(); select.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})); await wait();
      check(!!document.querySelector('[role=listbox]') && document.querySelector('[role=option][aria-disabled=true]'), 'select opens from keyboard and exposes disabled options');
      const floating = document.querySelector('.ep-floating'); const before = floating.getBoundingClientRect().top;
      document.querySelector('#app').style.paddingTop = '100px'; window.dispatchEvent(new Event('resize')); await wait();
      check(Math.abs(floating.getBoundingClientRect().top - before - 100) < 2, 'teleported select follows moved trigger');
      let menuSelection;
      await mount(UI.BaseMenu, {teleport:true,items:[{label:'First',value:'first'},{label:'Disabled',value:'disabled',disabled:true},{label:'Last',value:'last'}],'onUpdate:modelValue':value=>menuSelection=value}, {trigger:()=>h('button',{type:'button'},'Menu')});
      document.querySelector('button').click();await wait();
      check(!!document.querySelector('.ep-menu') && document.querySelector('[role=menuitem][aria-disabled=true]'),'menu renders with disabled item semantics');
      const lastItem=[...document.querySelectorAll('.ep-menu button')].at(-1);lastItem.click();await wait();check(menuSelection==='last','menu item activation updates model');
      let closes = 0;
      state = await mount(UI.BaseDialog, {modelValue:true,title:'Dialog',width:420,closeOnOverlay:false,closeOnEsc:true,'onUpdate:modelValue':()=>closes++}, () => h('button','Inside'));
      await wait(250);
      check(Math.abs(document.querySelector('.ep-dialog-panel').getBoundingClientRect().width - 420) < 2, 'dialog accepts CSS pixel width');
      document.querySelector('.ep-dialog-panel button').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})); await wait(); check(closes === 1, 'Escape works independently of overlay policy (received '+closes+')');
      state.closeOnEsc = false; await wait(); document.querySelector('.ep-dialog-panel button').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})); await wait(); check(closes===1,'dialog can independently block Escape');
      let rejectAction; let errors = 0; let closed = false;
      state = await mount(UI.BaseConfirmDialog, {modelValue:true,title:'Confirm',message:'Async',confirmText:'Confirm',confirmAction:()=>new Promise((resolve,reject)=>{rejectAction=reject}),'onUpdate:modelValue':()=>closed=true,onError:()=>errors++});
      document.querySelector('.ep-button--primary').click(); await wait(); check(document.querySelector('.ep-button--primary').disabled && !closed, 'async confirmation remains open while pending');
      rejectAction(new Error('Failed')); await wait(); check(errors === 1 && !closed && !document.querySelector('.ep-button--primary').disabled, 'failed confirmation stays open and can retry');
      const messages = UI.useMessage(); messages.clear(); messages.configure({max:2});
      const first = messages.add({message:'Same',dedupeKey:'same',duration:0}); check(messages.add({message:'Same',dedupeKey:'same'}) === first, 'messages deduplicate by explicit key');
      let removals = 0; messages.add({message:'Second',duration:30,onClose:()=>removals++}); messages.clear(); await wait(60); check(messages.messages.value.length === 0 && removals === 1, 'message removal clears timers and invokes close once');
      let selection;
      await mount({setup(){selection=useSongSelection(Vue.ref([{id:1,isNewest:true},{id:2}]));return()=>h('p','Selection');}});
      selection.toggleSelection();selection.toggleAll();check(selection.allSelected.value && selection.selectedIds.value.size===2,'song selection selects visible collection');
      selection.selectNewest();check(selection.selectedIds.value.has(1) && !selection.selectedIds.value.has(2),'newest selection preserves filtering');
      selection.toggleSelection();check(selection.selectedIds.value.size===0,'leaving selection mode clears selected IDs');
      let editor;const eqSection=Vue.ref('eq');
      const eqPlayer=reactive({eqBands:[{frequencyHz:100,gainDb:0,q:1,enabled:false},{frequencyHz:1000,gainDb:0,q:1,enabled:false}],commitEqBands:async()=>true,refreshAudioChain:async()=>{}});
      await mount({setup(){editor=useEqEditor(eqPlayer,{allPresets:[]},eqSection);return()=>h('p','EQ');}});
      editor.updateEqBand(0,{gainDb:6});editor.commitEq();editor.undoEq();check(eqPlayer.eqBands[0].gainDb===0,'EQ undo restores snapshot');
      editor.redoEq();check(eqPlayer.eqBands[0].gainDb===6,'EQ redo restores committed edit');
      editor.toggleEqComparison();check(eqPlayer.eqBands[0].gainDb===0,'EQ comparison auditions prior band');
      eqSection.value='output';await wait();check(eqPlayer.eqBands[0].gainDb===6 && !editor.eqComparison.value,'leaving EQ comparison restores current settings');
      let library;const requests=[];
      window.api={database:{command:()=>new Promise(resolve=>requests.push(resolve))}};
      await mount({setup(){library=useCardLibrary({beforeLoad(){},onSongsLoaded:async()=>{},onPlaylistsLoaded:async()=>{},reduceMotion:()=>true});return()=>h('p','Cards');}});
      const oldLoad=library.loadSongs();const newLoad=library.loadSongs();
      requests[1]({success:true,data:{data:[{id:2,songStatus:1}]}});await newLoad;
      requests[0]({success:true,data:{data:[{id:1,songStatus:1}]}});await oldLoad;
      check(library.songs.value[0].id===2,'late carousel query cannot overwrite newer collection');
      let songActions,refreshes=0;const mutations=[];
      const actionProps=reactive({source:{type:'playlist',id:12},songs:[{id:1,sourceId:null,title:'One'},{id:3,sourceId:null,title:'Three'}],selectedIds:new Set([1,3]),refresh:async()=>refreshes++,playSong:async()=>{}});
      window.__uiPlayer=reactive({queue:[{id:1},{id:2},{id:3}],removeQueueItem:async function(index){this.queue.splice(index,1)}});
      window.api.database.command=async(action,params)=>{mutations.push({action,params});return {success:true}};
      await mount({setup(){songActions=useSongActions(actionProps,()=>{actionProps.selectedIds=new Set()});return()=>h('p','Song actions');}});
      songActions.requestDeleteSelectedSongs();check(songActions.songsPendingDelete.value.length===2 && window.__uiPlayer.queue.length===3,'delete action waits for dialog confirmation');
      await songActions.onSongsDeleted([1,3]);check(window.__uiPlayer.queue.length===1 && window.__uiPlayer.queue[0].id===2 && actionProps.selectedIds.size===0 && refreshes===1,'confirmed deletion updates queue, selection and collection');
      await songActions.removeSongsFromCurrentPlaylist([2]);check(mutations[0].action==='removeSongsFromPlaylist' && mutations[0].params.playlistId===12,'playlist action retains source collection identity');
      let swipe;const navigations=[];const collapsed=Vue.ref(true),reduced=Vue.ref(true);
      const swipePlayer=reactive({queue:[{id:1},{id:2},{id:3}],currentQueueSong:{id:2},currentQueueIndex:1,playMode:0,shuffleNavigationRevision:0,getPreviousQueueIndex:()=>0,getNextQueueIndex:()=>2,playPrevious:async()=>navigations.push('previous'),playNext:async index=>navigations.push(index)});
      await mount({setup(){swipe=useFooterSwipe(swipePlayer,collapsed,reduced);return()=>h('p','Swipe');}});
      const pointer=(x,y=0)=>({isPrimary:true,button:0,pointerId:1,clientX:x,clientY:y,currentTarget:null});
      swipe.handleSwipePointerDown(pointer(200));swipe.handleSwipePointerMove(pointer(100));swipe.handleSwipePointerUp(pointer(100));await wait();check(navigations[0]===2,'collapsed footer swipe selects precomputed next queue item');
      swipe.handleSwipePointerDown(pointer(200));swipe.handleSwipePointerMove(pointer(100));swipe.handleSwipePointerCancel(pointer(100));await wait();check(navigations.length===1,'cancelled swipe never changes track');
      collapsed.value=false;swipe.handleSwipePointerDown(pointer(200));swipe.handleSwipePointerMove(pointer(100));swipe.handleSwipePointerUp(pointer(100));await wait();check(navigations.length===1,'expanded footer ignores collapsed gestures');
      const effectCalls=[];
      window.__uiPlayer=reactive({compressorConfig:{thresholdDb:-20,ratio:4,attackMs:10,releaseMs:100,kneeDb:3,makeupDb:0},limiterConfig:{enabled:true,ceilingDb:-1,releaseMs:50},setCompressorConfig:async()=>{effectCalls.push('compressor');return true},setLimiter:async()=>{effectCalls.push('limiter');return true},refreshAudioChain:async()=>{}});
      state=await mount(DspEffectEditor,{effect:'compressor'});document.querySelector('[role=slider]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));await wait();
      check(window.__uiPlayer.compressorConfig.thresholdDb>-20 && effectCalls[0]==='compressor','DSP compressor field commits to its own processing node');
      state.effect='limiter';await wait();document.querySelector('[role=slider]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));await wait();
      check(Math.abs(window.__uiPlayer.limiterConfig.ceilingDb+0.9)<0.001 && effectCalls.at(-1)==='limiter','switching DSP node routes field edits to the new schema');
      let selectedBackend;
      window.__uiPlayer=reactive({devices:[{backend:'asio',id:'same',name:'ASIO device'},{backend:'wasapi_shared',id:'same',name:'WASAPI device'}],currentBackend:'asio',currentDeviceId:'same',volume:0.5,selectOutputDevice:async device=>{selectedBackend=device.backend;return true},refreshAudioChain:async()=>{},refreshDevices:async()=>{}});
      await mount(AudioOutputSettings);document.querySelector('.ep-select').click();await wait();document.querySelectorAll('[role=option]')[1].click();await wait();
      check(selectedBackend==='wasapi_shared','output selector distinguishes identical device IDs across backends');
      let irFailure,irCleared=0;
      window.__uiPlayer=reactive({impulseResponseConfig:{path:'original.wav',enabled:false,gainDb:0,autoGain:true},setImpulseResponseConfig:async()=>({success:false,error:'unsupported'}),loadImpulseResponseConfig:async()=>{}});
      window.api.audio={getFilePath:()=> 'new.wav'};
      await mount(ImpulseResponseEditor,{error:'',onLoadError:code=>irFailure=code,onClearError:()=>irCleared++});
      const importIr=async()=>{const data=new DataTransfer();data.items.add(new File(['test'],'new.wav',{type:'audio/wav'}));const input=document.querySelector('input[type=file]');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));await wait();};
      await importIr();check(window.__uiPlayer.impulseResponseConfig.path==='original.wav' && irFailure==='unsupported','failed impulse import restores previous config and reports error');
      window.__uiPlayer.setImpulseResponseConfig=async()=>({success:true});await importIr();check(window.__uiPlayer.impulseResponseConfig.path==='new.wav' && irCleared===1,'successful impulse import commits new config and clears error');
      activeApp.unmount(); document.body.innerHTML = '<div id="app"></div>';
      let aMounts=0, aActivations=0;
      const A={setup(){onMounted(()=>aMounts++);onActivated(()=>aActivations++);return()=>[h('p','A'),h('p','Fragment root')];}};
      const B={render:()=>h('p','B')};
      const router=createRouter({history:createMemoryHistory(),routes:[{path:'/a',component:A},{path:'/b',component:B,meta:{keepAlive:false}}]});
      await router.push('/a'); await router.isReady(); activeApp=createApp({render:()=>h(AppPageOutlet,{transition:'none'})});activeApp.use(router);activeApp.mount('#app');await wait();
      document.querySelector('.ep-page').dataset.marker='retained';
      await router.push('/b');await wait();await router.push('/a');await wait();
      check(aMounts===1 && aActivations===2 && document.querySelector('.ep-page').dataset.marker==='retained','page cache survives visits to uncached routes and supports fragment pages');
      await router.push('/a?q=search');await wait();check(aMounts===1,'search query changes preserve page instance');
      document.documentElement.classList.add('reduce-motion');await wait();
      check(getComputedStyle(document.querySelector('.ep-page')).transitionDuration==='0s','reduced motion disables page transitions');
      document.documentElement.classList.remove('reduce-motion');
      let panelMounts=0,panelDisposals=0;
      const hiddenAtDisposal=[];
      const CanvasPanel={setup(){
        const canvas=Vue.ref();panelMounts++;
        Vue.onBeforeUnmount(()=>{
          panelDisposals++;
          hiddenAtDisposal.push(getComputedStyle(canvas.value.closest('.player-panel-layer')).display==='none');
          canvas.value.width=1;canvas.value.height=1;
        });
        return()=>h('canvas',{ref:canvas,width:800,height:600,'data-player-canvas':''});
      }};
      state=await mount(PlayerPanelTransition,{open:false},()=>h(CanvasPanel));
      check(panelMounts===0,'closed player never mounts visual resources');
      state.open=true;await wait(300);
      let playerCanvas=document.querySelector('[data-player-canvas]');
      check(panelMounts===1 && playerCanvas.width===800,'opening player lazily mounts its canvas');
      state.open=false;await wait(70);
      const leavingLayer=document.querySelector('.player-panel-layer');
      check(panelDisposals===0 && playerCanvas.width===800 && playerCanvas.isConnected,'player canvas retains its rendered frame throughout leave');
      check(Number(getComputedStyle(leavingLayer).opacity)>0 && Number(getComputedStyle(leavingLayer).opacity)<1 && leavingLayer.inert,'player fades smoothly and blocks interaction while leaving');
      await wait(300);
      check(panelDisposals===1 && !playerCanvas.isConnected && hiddenAtDisposal.every(Boolean),'player releases visual resources only after the host is hidden');
      state.open=true;await wait(300);playerCanvas=document.querySelector('[data-player-canvas]');
      state.open=false;await wait(70);state.open=true;await wait(300);
      check(panelMounts===2 && panelDisposals===1 && playerCanvas===document.querySelector('[data-player-canvas]') && playerCanvas.width===800,'reopening during leave preserves the existing canvas');
      state.open=false;await wait(300);
      check(panelDisposals===2 && hiddenAtDisposal.every(Boolean),'a cancelled leave does not prevent later cleanup');
      document.documentElement.classList.add('reduce-motion');
      state.open=true;await wait(70);state.open=false;await wait(70);
      check(panelDisposals===3 && !document.querySelector('[data-player-canvas]') && hiddenAtDisposal.every(Boolean),'reduced motion closes immediately without clearing a visible canvas');
      document.documentElement.classList.remove('reduce-motion');
      const metadataFixture={id:1,title:'Metadata fixture',artist:'Singer A;Singer B',album:'Album',genre:'POP,rock',duration:10,fileSize:100,year:null,trackNo:null,diskNo:null};
      window.__activationUi=reactive({normalizeMetadataSeparator:false,artistSeparator:';',genreSeparator:',',ignoreShortSongs:true});
      window.api.files={onImportProgress:()=>()=>{}};
      window.api.database={command:async()=>({success:true,data:metadataFixture})};
      const detailsState=reactive({open:false});
      await mount({render:()=>[h(LibrarySettings),h(SongDetailsDialog,{modelValue:detailsState.open,songId:1,'onUpdate:modelValue':value=>detailsState.open=value})]});
      const normalizationRows=[...document.querySelectorAll('.setting-row')].filter(row=>row.querySelector('h3')?.textContent==='settings.normalizeMetadataSeparator');
      check(normalizationRows.length===1,'library settings expose one shared separator normalization switch');
      normalizationRows[0].querySelector('[role=switch]').click();await wait();
      check(window.__activationUi.normalizeMetadataSeparator===true,'shared separator switch updates the single UI preference');
      detailsState.open=true;await wait();
      check(document.body.textContent.includes('Singer A / Singer B') && document.body.textContent.includes('POP / rock'),'shared switch normalizes both artist and genre in real song details');
      detailsState.open=false;await wait();
      normalizationRows[0].querySelector('[role=switch]').click();await wait();
      detailsState.open=true;await wait();
      check(document.body.textContent.includes('Singer A;Singer B') && document.body.textContent.includes('POP,rock'),'disabling the shared switch restores both original separator styles');
      check(metadataFixture.artist==='Singer A;Singer B' && metadataFixture.genre==='POP,rock','display normalization preserves original song metadata');
      activeApp.unmount(); messages.clear(); return results;
    })()`)
    assert.ok(results.length >= 20)
    console.log(JSON.stringify({ passed: results.length, checks: results }, null, 2))
    await window.webContents.executeJavaScript(`(async()=>{
      const {Vue,UI,createI18n}=Checks;const {h,createApp}=Vue;
      document.body.innerHTML='<div id="showcase"></div>';
      createApp({render:()=>h('main',{style:'padding:32px;display:grid;gap:20px;max-width:880px;margin:auto'},[
        h('h1',{style:'font-size:24px;font-weight:650'},'UI component standards'),
        h('p',{style:'color:var(--color-text-l)'},'Shared sizing, state feedback, surfaces and keyboard focus'),
        h('div',{style:'display:flex;gap:12px;align-items:center'},['xs','sm','md','lg'].map(size=>h(UI.BaseButton,{size},()=>size))),
        h('div',{style:'display:flex;gap:12px;align-items:center'},[h(UI.BaseButton,{variant:'secondary'},()=> 'Secondary'),h(UI.BaseButton,{variant:'ghost'},()=> 'Ghost'),h(UI.BaseButton,{variant:'danger'},()=> 'Danger'),h(UI.BaseButton,{loading:true},()=> 'Saving'),h(UI.BaseButton,{disabled:true},()=> 'Disabled')]),
        h('div',{style:'display:grid;grid-template-columns:1fr 1fr;gap:16px'},[h(UI.BaseInput,{modelValue:'Editable input'}),h(UI.BaseInput,{modelValue:'Readonly input',readonly:true}),h(UI.BaseInput,{modelValue:'Invalid input',invalid:true}),h(UI.BaseInput,{modelValue:'Disabled input',disabled:true})]),
        h('div',{style:'display:flex;gap:24px;align-items:center'},[h(UI.BaseSwitch,{modelValue:true,activeText:'Enabled'}),h(UI.BaseSwitch,{modelValue:false,inactiveText:'Off'}),h(UI.BaseSelect,{modelValue:'one',options:[{label:'Selected option',value:'one'}]}),h(UI.BaseColorPicker,{modelValue:'#22c55e'})]),
        h(UI.BaseSlider,{modelValue:65}),h(UI.BaseSkeleton,{type:'row',size:40})
      ])}).use(createI18n({legacy:false,locale:'en',messages:{en:{ui:{clear:'Clear',color:'Color'}}}})).mount('#showcase');
      await Vue.nextTick();await new Promise(resolve=>setTimeout(resolve,200));
    })()`)
    const preview = path.resolve('build/ui-component-showcase.png')
    fs.mkdirSync(path.dirname(preview), { recursive: true })
    fs.writeFileSync(preview, (await window.webContents.capturePage()).toPNG())
    console.log('Preview: ' + preview)
    window.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
