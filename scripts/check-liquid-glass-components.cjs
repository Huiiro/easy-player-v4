/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const esbuild = require('esbuild')
const { parse, compileScript, compileStyle } = require('@vue/compiler-sfc')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ep-glass-components-')))
app.whenReady().then(async () => {
  try {
    const styles = ['components', 'controls'].map((name) =>
      fs.readFileSync(`src/renderer/src/styles/${name}.css`, 'utf8')
    )
    styles.push(fs.readFileSync('src/renderer/src/styles/settings.css', 'utf8'))
    const bundle = await esbuild.build({
      stdin: {
        contents: `export * as Vue from 'vue';export {createI18n} from 'vue-i18n';
        export {STUDIO_BLUR_RADIUS} from './src/renderer/src/services/liquidGlassProfile';
        export {mountLiquidGlassStudio} from './src/renderer/src/services/liquidGlassStudio';
        export {default as Preview} from './src/renderer/src/views/dev/LiquidGlassPreview.vue';
        export {default as BackTop} from './src/renderer/src/components/ui/BaseBackTop.vue';
        export {default as Tooltip} from './src/renderer/src/components/ui/BaseTooltip.vue';
        export {default as Switch} from './src/renderer/src/components/ui/BaseSwitch.vue';
        export {default as Slider} from './src/renderer/src/components/ui/BaseSlider.vue';
        export {default as Range} from './src/renderer/src/components/ui/BaseRange.vue';
        export {default as ColorPicker} from './src/renderer/src/components/ui/BaseColorPicker.vue';
        export {default as Skeleton} from './src/renderer/src/components/ui/BaseSkeleton.vue';
        export {default as Message} from './src/renderer/src/components/ui/BaseMessage.vue';
        export {useMessage} from './src/renderer/src/components/ui/useMessage';
        export {mountGlassComponentEffects} from './src/renderer/src/services/liquidGlassComponents';
        export {default as Button} from './src/renderer/src/components/ui/BaseButton.vue';
        export {default as Input} from './src/renderer/src/components/ui/BaseInput.vue';
        export {default as Select} from './src/renderer/src/components/ui/BaseSelect.vue';
        export {default as Menu} from './src/renderer/src/components/ui/BaseMenu.vue';
        export {default as Dialog} from './src/renderer/src/components/ui/BaseDialog.vue';
        export {default as Drawer} from './src/renderer/src/components/ui/BaseDrawer.vue';
        export {default as Popover} from './src/renderer/src/components/ui/BasePopover.vue';`,
        resolveDir: process.cwd()
      },
      bundle: true,
      write: false,
      format: 'iife',
      globalName: 'Components',
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
          name: 'vue-fixture',
          setup(build) {
            let sequence = 0
            build.onResolve({ filter: /stores\/ui\/uiStore(?:\.ts)?$/ }, () => ({
              path: 'ui-store',
              namespace: 'mock-ui'
            }))
            build.onLoad({ filter: /.*/, namespace: 'mock-ui' }, () => ({
              contents: 'export const useUIStore=()=>window.previewUI',
              loader: 'js'
            }))
            build.onResolve({ filter: /\.glsl\?raw$/ }, (args) => ({
              path: path.resolve(args.resolveDir, args.path.slice(0, -4)),
              namespace: 'raw-glsl'
            }))
            build.onLoad({ filter: /.*/, namespace: 'raw-glsl' }, (args) => ({
              contents: fs.readFileSync(args.path, 'utf8'),
              loader: 'text'
            }))
            build.onLoad({ filter: /\.vue$/ }, ({ path: filename }) => {
              const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
              const id = 'glass-components-' + ++sequence
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
    const win = new BrowserWindow({
      show: false,
      width: 1100,
      height: 800,
      webPreferences: { offscreen: true, backgroundThrottling: false }
    })
    win.webContents.on('console-message', (event) => {
      if (event.level === 'error') console.log(event.message)
    })
    const output = path.resolve('build/themes/liquid-glass-studio')
    fs.mkdirSync(output, { recursive: true })
    const fixture = path.join(output, 'components.html')
    fs.writeFileSync(
      fixture,
      `<!doctype html><html><head><style>${styles.join('\n')}
      :root{--ep-button-radius:5px!important;--ep-dialog-radius:14px!important;--ep-floating-radius:9px!important}
      #settings-actions .ep-button{transition:none}*{box-sizing:border-box}body{margin:0;background:var(--color-bg);color:var(--color-text);font:14px sans-serif}.fixture{display:grid;gap:14px;padding:24px}.row{display:flex;gap:12px;align-items:center}.ep-button{padding:0 16px}.ep-menu,.ep-select-options,.ep-popover{min-width:220px;padding:12px;border:1px solid}.ep-menu-item,.ep-select-option{display:block;width:100%;padding:8px}.ep-sidebar{padding:16px}.ep-sidebar-item{padding:8px;border:0}.ep-dialog-panel{padding:16px;min-width:300px}.ep-drawer-panel{padding:16px}.ep-select{padding:0 12px;min-width:220px}.ep-progress-track{height:4px}.ep-progress-thumb{width:10px;height:10px;border-radius:50%}.ep-overlay{position:fixed;inset:0}.ep-dialog{position:fixed;inset:0}.ep-dialog-panel{position:relative;margin:100px auto;max-width:500px}
    </style></head><body><div id="app"></div></body></html>`
    )
    await win.loadFile(fixture)
    win.webContents.debugger.attach('1.3')
    await win.webContents.debugger.sendCommand('DOM.enable')
    await win.webContents.debugger.sendCommand('CSS.enable')
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
      enabled: true
    })
    await win.webContents.executeJavaScript(bundle.outputFiles[0].text)
    await win.webContents.executeJavaScript(`{
      const {h,ref}=Components.Vue;window.state=Components.Vue.reactive({switch:true,level:45,color:'#4080c0',value:'',selected:'a',menu:'a',dialog:false,drawer:false});
      window.fixtureApp=Components.Vue.createApp({render:()=>h('div',{class:'fixture'},[
        h('div',{class:'row'},['primary','secondary','ghost','danger'].map(variant=>h(Components.Button,{id:variant,variant},()=>variant)).concat(h(Components.Button,{id:'disabled',variant:'secondary',disabled:true},()=> 'Disabled'))),
        h('section',{id:'settings-actions',class:'settings-page row'},['primary','secondary','ghost','danger'].map(variant=>h(Components.Button,{variant},()=>variant)).concat([h(Components.Button,{variant:'secondary',disabled:true},()=> 'Disabled'),h(Components.Button,{variant:'ghost',iconOnly:true,'aria-label':'Remove background'},()=> '×')])),
        h(Components.Input,{id:'field',modelValue:state.value,'onUpdate:modelValue':v=>state.value=v,placeholder:'Search'}),h(Components.Input,{id:'invalid',invalid:true,placeholder:'Invalid'}),h('input',{id:'legacy-input',class:'input-base',value:'Legacy input'}),
        h('aside',{class:'ep-sidebar'},[h('button',{class:'ep-sidebar-item ep-sidebar-item--active'},'Active library item')]),
        h('div',{class:'row'},[
          h(Components.Select,{modelValue:state.selected,'onUpdate:modelValue':v=>state.selected=v,teleport:true,options:[{label:'Alpha',value:'a'},{label:'Beta',value:'b'}]}),
          h(Components.Menu,{appearance:'glass',teleport:true,modelValue:state.menu,'onUpdate:modelValue':v=>state.menu=v,items:[{label:'Alpha',value:'a'},{label:'Beta',value:'b'},{label:'Disabled',value:'c',disabled:true}]},{trigger:()=>h('button',{id:'open-menu'},'Menu')}),
          h(Components.Popover,{teleport:true},{trigger:()=>h('button',{id:'open-popover'},'Popover'),default:()=>h('span','Popover content')})
        ]),
        h('div',{id:'extra-controls'},[
          h(Components.Switch,{id:'glass-switch',modelValue:state.switch,'onUpdate:modelValue':v=>state.switch=v}),
          h(Components.Switch,{id:'disabled-switch',modelValue:false,disabled:true}),
          h(Components.Slider,{modelValue:state.level,'onUpdate:modelValue':v=>state.level=v}),
          h(Components.Range,{modelValue:state.level,'onUpdate:modelValue':v=>state.level=v}),
          h(Components.ColorPicker,{modelValue:state.color,'onUpdate:modelValue':v=>state.color=v,teleport:true}),
          h(Components.Skeleton,{type:'row'}),h(Components.Message)
        ]),
        h('footer',{class:'ep-footer'},[h('div',{class:'ep-progress-track'}),h('div',{class:'ep-progress-thumb'})]),
        h(Components.Dialog,{modelValue:state.dialog,'onUpdate:modelValue':v=>state.dialog=v,title:'Glass dialog'},()=>h(Components.Input,{id:'dialog-input'})),
        h(Components.Drawer,{modelValue:state.drawer,'onUpdate:modelValue':v=>state.drawer=v,title:'Glass drawer'},()=>h('p','Drawer content'))
      ])}).use(Components.createI18n({legacy:false,locale:'en',messages:{en:{ui:{clear:'Clear',selectPlaceholder:'Select'},common:{close:'Close'}}}}));fixtureApp.mount('#app');
      window.snapshot=()=>{
        const read=s=>{const c=getComputedStyle(document.querySelector(s));return {radius:c.borderTopLeftRadius,bg:c.backgroundColor,color:c.color,image:c.backgroundImage,shadow:c.boxShadow,border:c.borderTopColor,opacity:c.opacity,outline:c.outlineStyle}};
        return {primary:read('#primary'),secondary:read('#secondary'),ghost:read('#ghost'),danger:read('#danger'),disabled:read('#disabled'),field:read('#field'),invalid:read('#invalid'),sidebar:read('.ep-sidebar'),footer:read('.ep-footer'),progress:read('.ep-progress-track'),thumb:read('.ep-progress-thumb'),palette:[getComputedStyle(document.documentElement).getPropertyValue('--color-bg'),getComputedStyle(document.documentElement).getPropertyValue('--color-primary')]};
      };void 0;
    }`)
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const readSettingsStates = async () => {
      const { root } = await win.webContents.debugger.sendCommand('DOM.getDocument')
      const { nodeIds } = await win.webContents.debugger.sendCommand('DOM.querySelectorAll', {
        nodeId: root.nodeId,
        selector: '#settings-actions .ep-button'
      })
      const states = {}
      for (const state of ['', 'hover', 'active', 'focus-visible']) {
        for (const nodeId of nodeIds)
          await win.webContents.debugger.sendCommand('CSS.forcePseudoState', {
            nodeId,
            forcedPseudoClasses: state ? [state] : []
          })
        states[state || 'normal'] = await win.webContents
          .executeJavaScript(`Array.from(document.querySelectorAll('#settings-actions .ep-button'), e => {
          const c = getComputedStyle(e)
          return Object.fromEntries(['height','minHeight','padding','borderRadius','backgroundColor','backgroundImage','boxShadow','color','fontSize','fontWeight','opacity','outlineStyle','outlineColor'].map(key => [key, c[key]]))
        })`)
      }
      for (const nodeId of nodeIds)
        await win.webContents.debugger.sendCommand('CSS.forcePseudoState', {
          nodeId,
          forcedPseudoClasses: []
        })
      return states
    }
    const reports = []
    for (const dark of [true, false]) {
      const palette = dark
        ? {
            '--color-bg': '#101c30',
            '--color-bg-l': '#1b2c43',
            '--color-bg-l2': '#293c55',
            '--color-bg-d': '#0c1627',
            '--color-text': '#f0f6ff',
            '--color-text-l': '#c3d3e6',
            '--color-primary': '#a6e8f5',
            '--btn-primary-bg': '#a6e8f5',
            '--btn-primary-text': '#102435'
          }
        : {
            '--color-bg': '#f5f8ff',
            '--color-bg-l': '#ffffff',
            '--color-bg-l2': '#e1e7f0',
            '--color-bg-d': '#e8edf6',
            '--color-text': '#182238',
            '--color-text-l': '#3e506c',
            '--color-primary': '#1857ad',
            '--btn-primary-bg': '#1857ad',
            '--btn-primary-text': '#ffffff'
          }
      await win.webContents.executeJavaScript(
        `{for(const [key,value] of Object.entries(${JSON.stringify({ ...palette, '--color-border': '#778899', '--color-danger': '#ef3049', '--btn-danger-bg': '#b51931', '--btn-danger-text': '#ffffff', '--color-hover-bg': '#778899', '--color-hover': '#778899' })}))document.documentElement.style.setProperty(key,value);document.documentElement.classList.toggle('dark',${dark});document.activeElement?.blur();void 0}`
      )
      const before = await win.webContents.executeJavaScript('snapshot()')
      const settingsBefore = await readSettingsStates()
      assert.notEqual(
        settingsBefore.hover[0].backgroundColor,
        settingsBefore.normal[0].backgroundColor,
        'Settings actions retain visible hover feedback'
      )
      assert.deepEqual(
        settingsBefore.hover[4],
        settingsBefore.normal[4],
        'Disabled settings buttons ignore hover feedback'
      )
      assert(
        settingsBefore.normal.every(
          (c) => c.height === '28px' && c.backgroundImage === 'none' && c.boxShadow === 'none'
        ),
        'Settings actions share compact, lightweight geometry'
      )
      assert.equal(
        settingsBefore.normal[3].color,
        'rgb(239, 48, 73)',
        'Destructive settings actions retain danger color'
      )
      assert.equal(
        settingsBefore.normal[4].opacity,
        '0.5',
        'Disabled settings actions remain visibly disabled'
      )
      await win.webContents.executeJavaScript(
        'window.disposeEffects=Components.mountGlassComponentEffects();void 0'
      )
      const enabled = await win.webContents.executeJavaScript('snapshot()')
      assert.deepEqual(
        await readSettingsStates(),
        settingsBefore,
        'Settings button geometry, colors and feedback survive enabling Liquid Glass'
      )
      assert.equal(enabled.secondary.radius, '999px')
      assert.equal(enabled.field.radius, '10px')
      assert(
        Number(enabled.field.bg.match(/\/\s*([\d.]+)\)/)?.[1]) <= 0.1,
        'Input keeps a high-transmission background'
      )
      assert.notEqual(enabled.field.image, 'none', 'Input receives a light glass highlight')
      const legacy = await win.webContents.executeJavaScript(
        `(()=>{const c=getComputedStyle(document.querySelector('#legacy-input'));return {background:c.backgroundColor,image:c.backgroundImage,blur:c.backdropFilter}})()`
      )
      assert(
        Number(legacy.background.match(/\/\s*([\d.]+)\)/)?.[1]) <= 0.1 &&
          legacy.image !== 'none' &&
          legacy.blur === 'none',
        'Legacy input-base fields get the same high-transmission, unblurred treatment'
      )
      assert.equal(enabled.sidebar.radius, '20px')
      assert.equal(enabled.footer.radius, '22px')
      assert.notEqual(enabled.secondary.image, 'none')
      assert.notEqual(enabled.primary.shadow, 'none')
      assert.equal(enabled.disabled.opacity, '0.5')
      for (const key of ['primary', 'danger', 'ghost']) {
        assert.equal(enabled[key].bg, before[key].bg)
        assert.equal(enabled[key].color, before[key].color)
      }
      assert.equal(
        enabled.invalid.border,
        before.invalid.border,
        'Invalid state retains danger color'
      )
      assert.deepEqual(
        enabled.palette,
        before.palette,
        'Effect retains selected background and accent'
      )
      await win.webContents.executeJavaScript(
        `document.querySelector('#field').focus();document.querySelector('#field').value='glass';document.querySelector('#field').dispatchEvent(new Event('input',{bubbles:true}));void 0`
      )
      assert.equal(await win.webContents.executeJavaScript('state.value'), 'glass')
      assert.equal(
        await win.webContents.executeJavaScript(
          `getComputedStyle(document.querySelector('#field')).borderTopColor`
        ),
        palette['--color-primary'] === '#a6e8f5' ? 'rgb(166, 232, 245)' : 'rgb(24, 87, 173)'
      )
      await win.webContents.executeJavaScript(`document.querySelector('#invalid').focus();void 0`)
      assert.equal(
        await win.webContents.executeJavaScript(
          `getComputedStyle(document.querySelector('#invalid')).borderTopColor`
        ),
        before.invalid.border,
        'Focused invalid inputs keep their error indicator'
      )
      await win.webContents.executeJavaScript(`document.querySelector('.ep-select').click();void 0`)
      await wait(100)
      const select = await win.webContents.executeJavaScript(
        `(()=>{const c=getComputedStyle(document.querySelector('.ep-select-options'));return {radius:c.borderTopLeftRadius,bg:c.backgroundColor,teleported:!document.querySelector('#app').contains(document.querySelector('.ep-select-options'))}})()`
      )
      assert.equal(select.radius, '16px')
      assert.equal(
        await win.webContents.executeJavaScript(
          `getComputedStyle(document.querySelector('.ep-select-options')).getPropertyValue('--ep-studio-blur-radius').trim()`
        ),
        String(await win.webContents.executeJavaScript('Components.STUDIO_BLUR_RADIUS'))
      )
      assert.equal(select.teleported, true)
      assert(select.bg.includes('0.12'))
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('.ep-select-option')[1].click();void 0`
      )
      await wait(100)
      assert.equal(await win.webContents.executeJavaScript('state.selected'), 'b')
      await win.webContents.executeJavaScript(`document.querySelector('#open-menu').click();void 0`)
      await wait(100)
      const menu = await win.webContents.executeJavaScript(
        `(()=>{const c=getComputedStyle(document.querySelector('.ep-menu'));return {radius:c.borderTopLeftRadius,bg:c.backgroundColor,color:c.color,selected:getComputedStyle(document.querySelector('.ep-menu-item[data-selected="true"]')).color}})()`
      )
      assert.equal(menu.radius, '16px')
      assert.equal(
        await win.webContents.executeJavaScript(
          `getComputedStyle(document.querySelector('.ep-menu')).getPropertyValue('--ep-studio-blur-radius').trim()`
        ),
        String(await win.webContents.executeJavaScript('Components.STUDIO_BLUR_RADIUS'))
      )
      assert.equal(
        menu.color,
        enabled.primary.color === 'rgb(16, 36, 53)' ? 'rgb(240, 246, 255)' : 'rgb(24, 34, 56)'
      )
      const selectedBeforeDisabled = await win.webContents.executeJavaScript(`state.menu`)
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('.ep-menu-item')[2].click();void 0`
      )
      assert.equal(
        await win.webContents.executeJavaScript(`state.menu`),
        selectedBeforeDisabled,
        'Disabled menu items remain inert'
      )
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('.ep-menu-item')[1].click();void 0`
      )
      await wait(100)
      assert.equal(await win.webContents.executeJavaScript('state.menu'), 'b')
      await win.webContents.executeJavaScript(
        `document.querySelector('#open-popover').click();void 0`
      )
      await wait(100)
      assert.equal(
        await win.webContents.executeJavaScript(
          `getComputedStyle(document.querySelector('.ep-popover')).borderTopLeftRadius`
        ),
        '16px'
      )
      await win.webContents.executeJavaScript(
        `document.querySelector('#open-popover').click();state.dialog=true;void 0`
      )
      await wait(120)
      const dialog = await win.webContents.executeJavaScript(
        `(()=>{const c=getComputedStyle(document.querySelector('.ep-dialog-panel'));return {radius:c.borderTopLeftRadius,bg:c.backgroundColor,border:c.borderTopWidth,overlay:getComputedStyle(document.querySelector('.ep-overlay')).backgroundColor}})()`
      )
      assert.equal(dialog.radius, '22px')
      assert.equal(
        await win.webContents.executeJavaScript(
          `getComputedStyle(document.querySelector('.ep-dialog-panel')).getPropertyValue('--ep-studio-blur-radius').trim()`
        ),
        String(await win.webContents.executeJavaScript('Components.STUDIO_BLUR_RADIUS'))
      )
      assert(parseFloat(dialog.border) > 0 && parseFloat(dialog.border) <= 1)
      assert(dialog.bg.includes('0.08'))
      assert(dialog.overlay.includes('0.18'))
      fs.writeFileSync(
        path.join(output, `components-${dark ? 'dark' : 'light'}.png`),
        (await win.webContents.capturePage()).toPNG()
      )
      await win.webContents.executeJavaScript('state.dialog=false;state.drawer=true;void 0')
      await wait(120)
      const drawer = await win.webContents.executeJavaScript(
        `getComputedStyle(document.querySelector('.ep-drawer-panel')).backgroundColor`
      )
      assert(drawer.includes('0.08'))
      assert.equal(
        await win.webContents.executeJavaScript(
          `getComputedStyle(document.querySelector('.ep-drawer-panel')).getPropertyValue('--ep-studio-blur-radius').trim()`
        ),
        String(await win.webContents.executeJavaScript('Components.STUDIO_BLUR_RADIUS'))
      )
      await win.webContents.executeJavaScript('state.drawer=false;void 0')
      await wait(80)
      const extraTokens = {
        '--ep-glass-control-radius': '14px',
        '--ep-glass-floating-radius': '19px',
        '--ep-glass-message-radius': '18px',
        '--ep-glass-floating-blur-radius': '24',
        '--ep-glass-switch-thumb': '#123456',
        '--ep-glass-skeleton': '#234567',
        '--ep-glass-track': '#345678',
        '--ep-glass-thumb': '#456789'
      }
      await win.webContents.executeJavaScript(
        `for(const [k,v] of Object.entries(${JSON.stringify(extraTokens)}))document.documentElement.style.setProperty(k,v,'important');void 0`
      )
      const extras = await win.webContents.executeJavaScript(
        `(()=>{const css=s=>getComputedStyle(document.querySelector(s));return {radius:css('#field').borderTopLeftRadius,switchThumb:css('#glass-switch .ep-switch-thumb').backgroundColor,highlight:css('.ep-switch-track').backgroundImage,skeleton:css('.ep-skeleton-block').backgroundColor,track:css('.ep-progress-track').backgroundColor,thumb:css('.ep-progress-thumb').backgroundColor,contexts:document.querySelectorAll('.ep-studio-canvas').length};})()`
      )
      assert.equal(extras.radius, '14px')
      assert.equal(extras.switchThumb, 'rgb(18, 52, 86)')
      assert.equal(extras.skeleton, 'rgb(35, 69, 103)')
      assert.equal(extras.track, 'rgb(52, 86, 120)')
      assert.equal(extras.thumb, 'rgb(69, 103, 137)')
      assert.notEqual(extras.highlight, 'none')
      assert.equal(extras.contexts, 0, 'Small controls use CSS material without WebGL contexts')
      const switchBefore = await win.webContents.executeJavaScript('state.switch')
      await win.webContents.executeJavaScript(
        `document.querySelector('#glass-switch').click();document.querySelector('#disabled-switch').click();document.querySelector('.ep-slider-control').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));void 0`
      )
      assert.equal(await win.webContents.executeJavaScript('state.switch'), !switchBefore)
      assert.equal(await win.webContents.executeJavaScript('state.level'), 46)
      assert.equal(
        await win.webContents.executeJavaScript(
          `document.querySelector('#disabled-switch').getAttribute('aria-checked')`
        ),
        'false'
      )
      await win.webContents.executeJavaScript(
        `{const range=document.querySelector('.ep-range');range.value='73';range.dispatchEvent(new Event('input',{bubbles:true}));state.color='#4080c0';document.querySelector('.ep-color-trigger').click();}`
      )
      assert.equal(await win.webContents.executeJavaScript('state.level'), 73)
      await wait(100)
      const colorPanel = await win.webContents.executeJavaScript(
        `(()=>{const e=document.querySelector('.ep-color-picker'),css=getComputedStyle(e);return {radius:css.borderTopLeftRadius,blur:css.getPropertyValue('--ep-studio-blur-radius').trim(),teleported:!document.querySelector('#app').contains(e)};})()`
      )
      assert.deepEqual(colorPanel, { radius: '19px', blur: '24', teleported: true })
      await win.webContents.executeJavaScript(
        `document.querySelector('.ep-color-picker button[aria-label="#D0021B"]').click();document.querySelector('.ep-color-trigger').click();window.notice=Components.useMessage().add({type:'error',message:'Material error',duration:0,showClose:true});void 0`
      )
      assert.notEqual(await win.webContents.executeJavaScript('state.color'), '#4080c0')
      await wait(80)
      assert.equal(
        await win.webContents.executeJavaScript(
          `getComputedStyle(document.querySelector('.ep-message')).borderTopLeftRadius`
        ),
        '18px'
      )
      assert.equal(
        await win.webContents.executeJavaScript(
          `document.querySelector('.ep-message').getAttribute('role')`
        ),
        'alert'
      )
      await win.webContents.executeJavaScript(
        `Components.useMessage().remove(notice);state.level=45;for(const key of Object.keys(${JSON.stringify(extraTokens)}))document.documentElement.style.removeProperty(key);void 0`
      )
      await win.webContents.executeJavaScript('state.drawer=false;disposeEffects();void 0')
      await wait(100)
      const after = await win.webContents.executeJavaScript(
        'document.activeElement?.blur();snapshot()'
      )
      assert.deepEqual(after, before, 'Disabling restores component styles of the selected theme')
      assert.deepEqual(
        await readSettingsStates(),
        settingsBefore,
        'Settings buttons remain consistent after disabling Liquid Glass'
      )
      assert.equal(
        await win.webContents.executeJavaScript(
          `document.documentElement.hasAttribute('data-ep-glass-components')`
        ),
        false
      )
      reports.push({ dark, select, menu, dialog, drawer, extras, colorPanel, restored: true })
    }
    fs.writeFileSync(path.join(output, 'components.json'), JSON.stringify(reports, null, 2))
    console.log(JSON.stringify(reports, null, 2))
    await win.webContents.executeJavaScript('fixtureApp.unmount()')
    // Render the actual uiDEV gallery with production utilities and a minimal
    // reactive preference store. Its real components and WebGL engine are used.
    const indexHtml = fs.readFileSync('out/renderer/index.html', 'utf8')
    const productionCss = [...indexHtml.matchAll(/href="[^"]*\/assets\/([^"]+\.css)"/g)]
      .map((match) => fs.readFileSync(path.join('out/renderer/assets', match[1]), 'utf8'))
      .join('\n')
    await win.webContents.executeJavaScript(`{
      const style=document.createElement('style');style.textContent=${JSON.stringify(productionCss)};document.head.append(style);
      document.documentElement.style.setProperty('--ep-glass-floating-radius','23px');
      const {h,ref,KeepAlive}=Components.Vue;
      window.previewUI=Components.Vue.reactive({interfaceEffect:'liquid-glass-studio',nativeMaterialEnabled:false,extremePlayback:false});
      window.galleryActive=ref(true);window.galleryDrawer=ref(false);window.galleryController=undefined;
      window.stopGalleryWatch=Components.Vue.watch(()=>previewUI.interfaceEffect,value=>{galleryController?.dispose();galleryController=value==='liquid-glass-studio'?Components.mountLiquidGlassStudio():undefined},{immediate:true});
      window.galleryApp=Components.Vue.createApp({render:()=>h('div',{style:'padding:24px;max-width:1040px;margin:auto'},[h(KeepAlive,null,{default:()=>galleryActive.value?h(Components.Preview):null}),h(Components.Message),h(Components.Drawer,{modelValue:galleryDrawer.value,'onUpdate:modelValue':v=>galleryDrawer.value=v,title:'Animated glass drawer',width:'360px'},()=>h('p','Drawer content'))])}).use(Components.createI18n({legacy:false,locale:'zh',messages:{zh:{ui:{color:'颜色',colorValue:'色值',presets:'预设',hue:'色相',saturation:'饱和度',brightness:'明度',alpha:'透明度',clear:'清除',selectPlaceholder:'选择'},common:{close:'关闭'}}}}));galleryApp.mount('#app');void 0;
    }`)
    await wait(350)
    const gallery = await win.webContents.executeJavaScript(
      `(()=>{const panel=document.querySelector('.ep-glass-panel');return {panel:panel.hasAttribute('data-ep-studio-surface'),controls:document.querySelectorAll('.ep-switch,.ep-slider,.ep-range,.ep-skeleton').length,smallContexts:document.querySelectorAll('.ep-switch .ep-studio-canvas,.ep-slider .ep-studio-canvas').length};})()`
    )
    assert.equal(gallery.panel, true)
    assert(gallery.controls >= 6)
    assert.equal(gallery.smallContexts, 0)
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='滚动以显示回到顶部').click();void 0`
    )
    await wait(100)
    assert.equal(
      await win.webContents.executeJavaScript(`!!document.querySelector('.ep-backtop')`),
      true,
      'uiDEV BackTop observes its own scroll container'
    )
    await win.webContents.executeJavaScript(
      `document.querySelector('.ep-backtop').scrollIntoView({block:'center'});void 0`
    )
    await wait(220)
    const backTopGlass = await win.webContents.executeJavaScript(
      `(()=>{const e=document.querySelector('.ep-backtop'),css=getComputedStyle(e),id=css.backdropFilter.match(/#([^"')]+)/)?.[1];return {surface:e.hasAttribute('data-ep-studio-surface'),canvas:!!e.querySelector('.ep-studio-canvas'),blur:!!document.getElementById(id)?.querySelector('feGaussianBlur'),label:e.getAttribute('aria-label'),width:e.getBoundingClientRect().width};})()`
    )
    assert.equal(backTopGlass.surface, true)
    assert.equal(backTopGlass.canvas, true)
    assert.equal(backTopGlass.blur, false, 'BackTop stays clear rather than adding another blur')
    assert.equal(Math.round(backTopGlass.width), 36)
    fs.writeFileSync(
      path.join(output, 'backtop.png'),
      (await win.webContents.capturePage()).toPNG()
    )
    await win.webContents.executeJavaScript(`document.querySelector('.ep-backtop').click();void 0`)
    await wait(900)
    assert.equal(
      await win.webContents.executeJavaScript(`!!document.querySelector('.ep-backtop')`),
      false,
      'BackTop hides after returning to the start'
    )
    await win.webContents.executeJavaScript(`window.scrollTo({top:0,behavior:'auto'});void 0`)
    await wait(100)
    await win.webContents.executeJavaScript(
      `document.querySelector('[aria-label="Liquid Glass 样式效果"]').click();void 0`
    )
    await wait(100)
    assert.equal(
      await win.webContents.executeJavaScript(
        `document.documentElement.hasAttribute('data-ep-glass-components')`
      ),
      false
    )
    await win.webContents.executeJavaScript(
      `document.querySelector('[aria-label="Liquid Glass 样式效果"]').click();void 0`
    )
    await wait(120)
    // The glass frame must stay still while only the options viewport scrolls.
    await win.webContents.executeJavaScript(`document.querySelector('.ep-select').click();void 0`)
    await wait(300)
    const readSelect = () =>
      win.webContents.executeJavaScript(`(()=>{
      const pane=document.querySelector('.ep-select-options'),list=pane.querySelector('.ep-select-list'),canvas=pane.querySelector('canvas'),p=pane.getBoundingClientRect(),a=document.querySelector('.ep-select').getBoundingClientRect(),c=canvas?.getBoundingClientRect();
      return {top:p.top,left:p.left,width:p.width,anchorWidth:a.width,canvasTop:c?.top,canvasWidth:c?.width,paneClientWidth:pane.clientWidth,listWidth:list.offsetWidth,listClientWidth:list.clientWidth,scroll:list.scrollTop,range:list.scrollHeight-list.clientHeight};
    })()`)
    const selectStart = await readSelect()
    assert(selectStart.range > 100, 'Long-list preview exercises real scrolling')
    assert.equal(
      selectStart.listWidth,
      selectStart.listClientWidth,
      'Overlay scrollbar consumes no content width'
    )
    assert(
      Math.abs(selectStart.width - selectStart.anchorWidth) < 1.5,
      'Dropdown width matches its trigger'
    )
    await win.webContents.executeJavaScript(
      `document.querySelector('.ep-select-list').scrollTop=120;void 0`
    )
    await wait(80)
    const selectScrolled = await readSelect()
    assert.equal(selectScrolled.scroll, 120)
    assert(
      Math.abs(selectScrolled.top - selectStart.top) < 1.5 &&
        Math.abs(selectScrolled.left - selectStart.left) < 1.5,
      'Internal scroll never repositions the popup'
    )
    assert(
      Math.abs(selectScrolled.canvasTop - selectStart.canvasTop) < 1.5,
      'Optical canvas stays fixed to the glass frame'
    )
    assert(
      Math.abs(selectScrolled.canvasWidth - selectScrolled.paneClientWidth) < 1.5,
      'Scrollbar does not inset the optical edge'
    )
    const wheelPoint = await win.webContents.executeJavaScript(
      `(()=>{const r=document.querySelector('.ep-select-list').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`
    )
    win.webContents.sendInputEvent({
      type: 'mouseWheel',
      ...wheelPoint,
      deltaX: 0,
      deltaY: -120,
      canScroll: true,
      hasPreciseScrollingDeltas: false
    })
    await wait(100)
    const selectWheel = await readSelect()
    assert(selectWheel.scroll > selectScrolled.scroll, 'Real wheel input scrolls the options')
    assert(
      Math.abs(selectWheel.top - selectStart.top) < 1.5 &&
        Math.abs(selectWheel.canvasTop - selectStart.canvasTop) < 1.5,
      'Wheel scrolling keeps both the popup and glass edge fixed'
    )
    await win.webContents.executeJavaScript(
      `document.querySelector('.ep-select-list').scrollTop=0;void 0`
    )
    await wait(60)
    const dragPoint = await win.webContents.executeJavaScript(
      `(()=>{const r=document.querySelector('.ep-select-scrollbar-thumb').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`
    )
    win.webContents.sendInputEvent({ type: 'mouseMove', ...dragPoint })
    win.webContents.sendInputEvent({
      type: 'mouseDown',
      ...dragPoint,
      button: 'left',
      clickCount: 1
    })
    win.webContents.sendInputEvent({
      type: 'mouseMove',
      x: dragPoint.x,
      y: dragPoint.y + 45,
      button: 'left'
    })
    win.webContents.sendInputEvent({
      type: 'mouseUp',
      x: dragPoint.x,
      y: dragPoint.y + 45,
      button: 'left',
      clickCount: 1
    })
    await wait(80)
    assert(
      await win.webContents.executeJavaScript(
        `document.querySelector('.ep-select-list')?.scrollTop>0`
      ),
      'Overlay scrollbar is draggable and does not close the listbox'
    )
    await win.webContents.executeJavaScript(
      `document.querySelector('.ep-select-options').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));void 0`
    )
    await wait(80)
    assert(
      (await readSelect()).scroll > 120,
      'Listbox keyboard navigation still scrolls its viewport'
    )
    await win.webContents.executeJavaScript(
      `document.querySelector('.ep-select').click();document.documentElement.style.setProperty('--motion-duration-standard','600ms');document.documentElement.style.setProperty('--motion-duration-fast','400ms');galleryDrawer.value=true;void 0`
    )
    const drawerMotion = await win.webContents.executeJavaScript(
      `(async()=>{const frames=[];for(let i=0;i<12;i++){await new Promise(requestAnimationFrame);const e=document.querySelector('.ep-drawer-panel');if(e){const r=e.getBoundingClientRect(),css=getComputedStyle(e);frames.push({left:r.left,width:r.width,viewport:innerWidth,properties:css.transitionProperty,animations:e.getAnimations().map(a=>a.transitionProperty)})}}return frames})()`
    )
    assert(
      drawerMotion.some((f) =>
        f.properties
          .split(',')
          .map((x) => x.trim())
          .includes('translate')
      ),
      'Glass preserves Tailwind transform longhands'
    )
    assert(
      drawerMotion.some((f) => f.left > f.viewport - f.width + 2 && f.left < f.viewport - 2),
      'Drawer has intermediate sliding frames with glass enabled'
    )
    await win.webContents.executeJavaScript('galleryDrawer.value=false;void 0')
    const drawerExit = await win.webContents.executeJavaScript(
      `(async()=>{const frames=[];for(let i=0;i<8;i++){await new Promise(requestAnimationFrame);const e=document.querySelector('.ep-drawer-panel');if(e){const r=e.getBoundingClientRect();frames.push({left:r.left,width:r.width,viewport:innerWidth})}}return frames})()`
    )
    assert(
      drawerExit.some((f) => f.left > f.viewport - f.width + 2 && f.left < f.viewport - 2),
      'Drawer also slides during exit'
    )
    await wait(650)
    assert.equal(
      await win.webContents.executeJavaScript(`!!document.querySelector('.ep-drawer-panel')`),
      false
    )
    await win.webContents.executeJavaScript(
      `document.documentElement.style.removeProperty('--motion-duration-standard');document.documentElement.style.removeProperty('--motion-duration-fast');void 0`
    )
    await win.webContents.executeJavaScript(`{
      const details=document.querySelector('details');details.open=true;
      const ranges=details.querySelectorAll('.ep-range');for(const [i,value]of [24,28,10].entries()){ranges[i].value=String(value);ranges[i].dispatchEvent(new Event('input',{bubbles:true}))}
    }`)
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='应用预览变量').click();document.querySelector('.ep-color-trigger').click();void 0`
    )
    await wait(180)
    const galleryColor = await win.webContents.executeJavaScript(
      `(()=>{const e=document.querySelector('.ep-color-picker'),css=getComputedStyle(e),id=css.backdropFilter.match(/#([^"')]+)/)?.[1],blur=document.getElementById(id)?.querySelector('feGaussianBlur');return {material:e.hasAttribute('data-ep-studio-surface'),radius:css.borderTopLeftRadius,sigma:Number(blur?.getAttribute('stdDeviation')),dpr:devicePixelRatio};})()`
    )
    assert.equal(galleryColor.material, true, 'Real color panel joins the optical engine')
    assert.equal(galleryColor.radius, '28px')
    assert(
      Math.abs(galleryColor.sigma - 24 / (3 * galleryColor.dpr)) < 1e-10,
      'Temporary blur token updates the live SVG filter'
    )
    await win.webContents.executeJavaScript(
      `window.unrelatedNotice=Components.useMessage().add({message:'Existing notice',duration:0});[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='info 消息').click();document.querySelector('details').open=false;void 0`
    )
    await wait(450)
    assert.equal(
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('.ep-message[data-ep-studio-surface]').length`
      ),
      2,
      'Both real notifications receive the optical material'
    )
    assert.equal(
      await win.webContents.executeJavaScript(
        `getComputedStyle(document.querySelector('.ep-message')).borderTopLeftRadius`
      ),
      '28px'
    )
    fs.writeFileSync(
      path.join(output, 'gallery.png'),
      (await win.webContents.capturePage()).toPNG()
    )
    await win.webContents.executeJavaScript('galleryActive.value=false;void 0')
    await wait(100)
    const galleryCleanup = await win.webContents.executeJavaScript(
      `({radius:document.documentElement.style.getPropertyValue('--ep-glass-floating-radius'),priority:document.documentElement.style.getPropertyPriority('--ep-glass-floating-radius'),blur:document.documentElement.style.getPropertyValue('--ep-glass-floating-blur-radius'),messages:Components.useMessage().messages.value.map(m=>m.id)})`
    )
    assert.deepEqual(
      galleryCleanup,
      {
        radius: '23px',
        priority: '',
        blur: '',
        messages: [await win.webContents.executeJavaScript('unrelatedNotice')]
      },
      'Leaving uiDEV restores prior tokens and only removes preview-owned messages'
    )
    await win.webContents.executeJavaScript(
      `stopGalleryWatch();galleryController?.dispose();galleryApp.unmount();Components.useMessage().remove(unrelatedNotice);document.documentElement.style.removeProperty('--ep-glass-floating-radius');void 0`
    )
    fs.writeFileSync(
      path.join(output, 'gallery.json'),
      JSON.stringify(
        {
          gallery,
          backTopGlass,
          galleryColor,
          galleryCleanup,
          selectStart,
          selectScrolled,
          selectWheel,
          drawerMotion,
          drawerExit
        },
        null,
        2
      )
    )
    // Standalone BackTop: no store, player or virtual-list library dependency.
    await win.webContents.executeJavaScript(`{
      const {h,ref,shallowRef,KeepAlive}=Components.Vue;
      window.btA=shallowRef(null);window.btB=shallowRef(null);window.btTarget=shallowRef(null);
      window.btActive=ref(true);window.btVirtual=ref(false);window.btVisible=ref(undefined);window.btDisabled=ref(false);window.btReduce=ref(false);window.btWindow=ref(false);
      window.btNative=[];window.btCalls=[];window.btClicks=0;window.btReads=0;
      window.backHarness=Components.Vue.createApp({render:()=>h('div',{style:'position:relative;height:240px'},[
        h('div',{id:'bt-a',ref:btA,style:'width:240px;height:100px;overflow:auto'},h('div',{style:'width:600px;height:900px'},'A')),
        h('div',{id:'bt-b',ref:btB,style:'width:240px;height:100px;overflow:auto'},h('div',{style:'height:900px'},'B')),
        h(KeepAlive,null,{default:()=>btActive.value?h(Components.BackTop,{target:btWindow.value?undefined:()=>btTarget.value,position:btWindow.value?'fixed':'absolute',behavior:'smooth',reducedMotion:btReduce.value,visible:btVisible.value,disabled:btDisabled.value,onClick:()=>btClicks++,scrollToTop:btVirtual.value?behavior=>{btCalls.push(behavior);btTarget.value.scrollTop=0}:undefined}):null})
      ])}).use(Components.createI18n({legacy:false,locale:'en',messages:{en:{ui:{backToTop:'Top'}}}}));backHarness.mount('#app');
      const scrollDescriptor=Object.getOwnPropertyDescriptor(Element.prototype,'scrollTop');
      Object.defineProperty(btA.value,'scrollTop',{configurable:true,get(){btReads++;return scrollDescriptor.get.call(this)},set(value){scrollDescriptor.set.call(this,value)}});
      const native=btA.value.scrollTo.bind(btA.value);btA.value.scrollTo=options=>{btNative.push(options);native(options)};
      btTarget.value=btA.value;btB.value.scrollTop=500;void 0;
    }`)
    await wait(100)
    assert.equal(
      await win.webContents.executeJavaScript(`!!document.querySelector('.ep-backtop')`),
      false,
      'Other scroll containers do not show BackTop'
    )
    await win.webContents.executeJavaScript('btA.value.scrollTop=320;void 0')
    await wait(80)
    assert.equal(
      await win.webContents.executeJavaScript(`!!document.querySelector('.ep-backtop')`),
      false,
      'Visibility threshold is strictly greater than 320'
    )
    await win.webContents.executeJavaScript(
      `btA.value.scrollLeft=30;btA.value.scrollTop=321;btReduce.value=true;void 0`
    )
    await wait(100)
    assert.equal(
      await win.webContents.executeJavaScript(
        `document.querySelector('.ep-backtop')?.getAttribute('aria-label')`
      ),
      'Top'
    )
    await win.webContents.executeJavaScript(`document.querySelector('.ep-backtop').click();void 0`)
    await wait(100)
    assert.deepEqual(
      await win.webContents.executeJavaScript(
        '({a:btA.value.scrollTop,b:btB.value.scrollTop,left:btA.value.scrollLeft,behavior:btNative[0].behavior,clicks:btClicks})'
      ),
      { a: 0, b: 500, left: 30, behavior: 'auto', clicks: 1 },
      'Reduced motion returns only the intended container without changing horizontal position'
    )
    await win.webContents.executeJavaScript('btTarget.value=btB.value;void 0')
    await wait(80)
    await win.webContents.executeJavaScript('btA.value.scrollTop=50;void 0')
    await wait(80)
    assert.equal(
      await win.webContents.executeJavaScript(`!!document.querySelector('.ep-backtop')`),
      true,
      'Target changes detach the old scroll listener'
    )
    await win.webContents.executeJavaScript('btVirtual.value=true;void 0')
    await win.webContents.executeJavaScript(`document.querySelector('.ep-backtop').click();void 0`)
    await wait(80)
    assert.deepEqual(
      await win.webContents.executeJavaScript(
        '({calls:btCalls,native:btNative.length,top:btB.value.scrollTop})'
      ),
      { calls: ['auto'], native: 1, top: 0 },
      'Virtual-list callback is used instead of native scrolling'
    )
    await win.webContents.executeJavaScript('btVisible.value=true;btDisabled.value=true;void 0')
    const clicksBeforeDisabled = await win.webContents.executeJavaScript('btClicks')
    await win.webContents.executeJavaScript(`document.querySelector('.ep-backtop').click();void 0`)
    assert.equal(
      await win.webContents.executeJavaScript('btClicks'),
      clicksBeforeDisabled,
      'Disabled BackTop is inert'
    )
    await win.webContents.executeJavaScript(
      'btDisabled.value=false;btVisible.value=undefined;btTarget.value=btA.value;btA.value.scrollTop=450;void 0'
    )
    await wait(80)
    await win.webContents.executeJavaScript('btActive.value=false;btReads=0;void 0')
    await wait(50)
    await win.webContents.executeJavaScript('btA.value.scrollTop=500;void 0')
    await wait(80)
    assert.equal(
      await win.webContents.executeJavaScript('btReads'),
      0,
      'KeepAlive deactivation removes listeners and pending frame reads'
    )
    await win.webContents.executeJavaScript('btActive.value=true;void 0')
    await wait(80)
    assert.equal(
      await win.webContents.executeJavaScript(`!!document.querySelector('.ep-backtop')`),
      true,
      'Reactivation restores current target visibility'
    )
    await win.webContents.executeJavaScript(
      `for(const [name,value]of Object.entries({'--ep-backtop-size':'44px','--ep-backtop-radius':'14px','--ep-backtop-bottom':'36px','--ep-backtop-right':'24px'}))document.documentElement.style.setProperty(name,value);void 0`
    )
    await wait(450)
    assert.deepEqual(
      await win.webContents.executeJavaScript(
        `(()=>{const c=getComputedStyle(document.querySelector('.ep-backtop'));return {width:c.width,radius:c.borderRadius,bottom:c.bottom,right:c.right}})()`
      ),
      { width: '44px', radius: '14px', bottom: '36px', right: '24px' },
      'Public geometry tokens work without Liquid Glass'
    )
    await win.webContents.executeJavaScript(
      `btWindow.value=true;btVirtual.value=false;document.documentElement.style.overflow='auto';document.body.style.overflow='visible';document.body.style.height='auto';const spacer=document.createElement('div');spacer.id='bt-spacer';spacer.style.height='2000px';document.body.append(spacer);window.scrollTo({top:400,behavior:'auto'});void 0`
    )
    await wait(100)
    assert.equal(
      await win.webContents.executeJavaScript(
        `document.querySelector('.ep-backtop')?.parentElement===document.body`
      ),
      true,
      'Window BackTop teleports outside scrolling ancestors'
    )
    await win.webContents.executeJavaScript(`document.querySelector('.ep-backtop').click();void 0`)
    await wait(100)
    assert.equal(
      await win.webContents.executeJavaScript('window.scrollY'),
      0,
      'Omitted target defaults to window'
    )
    await win.webContents.executeJavaScript('btWindow.value=false;btTarget.value=btA.value;void 0')
    await wait(50)
    await win.webContents.executeJavaScript(
      `window.btOldElement=btA.value;backHarness.unmount();btReads=0;btOldElement.dispatchEvent(new Event('scroll'));void 0`
    )
    await wait(80)
    assert.equal(
      await win.webContents.executeJavaScript('btReads'),
      0,
      'Unmount releases the native scroll listener'
    )
    await win.webContents.executeJavaScript(
      `document.querySelector('#bt-spacer').remove();for(const key of ['--ep-backtop-size','--ep-backtop-radius','--ep-backtop-bottom','--ep-backtop-right'])document.documentElement.style.removeProperty(key);void 0`
    )
    fs.writeFileSync(
      path.join(output, 'backtop.json'),
      JSON.stringify(
        {
          material: backTopGlass,
          standalone: true,
          targetSwitch: true,
          virtualCallback: true,
          reducedMotion: true,
          keepAliveCleanup: true,
          unmountCleanup: true,
          windowDefault: true
        },
        null,
        2
      )
    )
    await win.webContents.executeJavaScript(`{
      const {h,ref,KeepAlive}=Components.Vue;
      window.tipValue=ref(50);window.tipDisabled=ref(false);window.tipActive=ref(true);window.tipWheel=0;
      const TipFixture={render:()=>h('div',{id:'tip-scroll',style:'margin:300px 60px 0;height:54px;width:420px;overflow:hidden;background:linear-gradient(120deg,#cf819b,#6ca8d7)'},[
        h('div',{style:'height:400px;padding:16px;display:flex;align-items:flex-start;gap:30px'},[
          h(Components.Tooltip,{interactive:true,variant:'control',ariaLabel:'Volume',disabled:tipDisabled.value,onWheel:event=>{event.preventDefault();tipWheel++}}, {
            trigger:({triggerProps})=>h('button',{...triggerProps,id:'tip-volume'},'Volume'),
            default:()=>[h('b',tipValue.value+'%'),h('input',{id:'tip-range',type:'range',min:0,max:100,value:tipValue.value,'aria-label':'Volume',onInput:event=>tipValue.value=Number(event.target.value)})]
          }),
          h(Components.Tooltip,{content:'Playback speed',disabled:tipDisabled.value},{trigger:({triggerProps})=>h('button',{...triggerProps,id:'tip-text'},'Speed')})
        ])
      ])};
      window.tipHarness=Components.Vue.createApp({render:()=>h(KeepAlive,null,{default:()=>tipActive.value?h(TipFixture):null})});tipHarness.mount('#app');
      window.tipGlass=Components.mountLiquidGlassStudio();void 0;
    }`)
    const tipPoint = async (selector) =>
      win.webContents.executeJavaScript(
        `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`
      )
    const tipMove = async (selector) => {
      win.webContents.sendInputEvent({ type: 'mouseMove', ...(await tipPoint(selector)) })
      await wait(500)
    }
    assert.equal(
      await win.webContents.executeJavaScript(`document.querySelectorAll('.ep-tooltip').length`),
      0,
      'Hidden tooltips do not mount glass surfaces'
    )
    await tipMove('#tip-volume')
    const tipMaterial = await win.webContents.executeJavaScript(
      `(()=>{const e=document.querySelector('.ep-tooltip'),r=e.getBoundingClientRect(),a=document.querySelector('#tip-volume').getBoundingClientRect();return {role:e.getAttribute('role'),label:e.getAttribute('aria-label'),surface:e.hasAttribute('data-ep-studio-surface'),canvas:!!e.querySelector('.ep-studio-canvas'),portal:e.closest('.ep-floating').parentElement===document.body,outsideClip:r.bottom<=a.top,width:r.width,height:r.height,writingMode:getComputedStyle(e.querySelector('input')).writingMode,top:r.top}})()`
    )
    assert.equal(tipMaterial.role, 'dialog')
    assert.equal(tipMaterial.label, 'Volume')
    assert(tipMaterial.surface)
    assert(tipMaterial.canvas)
    assert(tipMaterial.portal)
    assert(tipMaterial.outsideClip)
    assert.equal(tipMaterial.width, 40)
    assert.equal(tipMaterial.height, 160)
    assert.equal(tipMaterial.writingMode, 'vertical-lr')
    await tipMove('#tip-range')
    assert(
      await win.webContents.executeJavaScript(`!!document.querySelector('.ep-tooltip')`),
      'Crossing from trigger to teleported control keeps it open'
    )
    const dragRect = await win.webContents.executeJavaScript(
      `(()=>{const r=document.querySelector('#tip-range').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),top:Math.round(r.top),height:Math.round(r.height)}})()`
    )
    win.webContents.sendInputEvent({
      type: 'mouseDown',
      x: dragRect.x,
      y: dragRect.top + Math.round(dragRect.height * 0.7),
      button: 'left',
      clickCount: 1
    })
    win.webContents.sendInputEvent({
      type: 'mouseMove',
      x: dragRect.x,
      y: dragRect.top + Math.round(dragRect.height * 0.2)
    })
    win.webContents.sendInputEvent({
      type: 'mouseUp',
      x: dragRect.x,
      y: dragRect.top + Math.round(dragRect.height * 0.2),
      button: 'left',
      clickCount: 1
    })
    await wait(80)
    assert(
      await win.webContents.executeJavaScript('tipValue.value>60'),
      'Native vertical slider drag updates the value'
    )
    await win.webContents.executeJavaScript(
      `document.querySelector('#tip-range').dispatchEvent(new WheelEvent('wheel',{deltaY:-40,bubbles:true,cancelable:true}));document.querySelector('#tip-scroll').scrollTop=12;void 0`
    )
    await wait(100)
    assert.equal(
      await win.webContents.executeJavaScript('tipWheel'),
      1,
      'Wheel events on the portal are forwarded once'
    )
    assert(
      Math.abs(
        (await win.webContents.executeJavaScript(
          `document.querySelector('.ep-tooltip').getBoundingClientRect().top`
        )) -
          tipMaterial.top +
          12
      ) < 2,
      'Ancestor scroll repositions the tip with its trigger'
    )
    fs.writeFileSync(
      path.join(output, 'tooltip.png'),
      (await win.webContents.capturePage()).toPNG()
    )
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await wait(280)
    assert.equal(
      await win.webContents.executeJavaScript(`!!document.querySelector('.ep-tooltip')`),
      false,
      'Escape closes without reopening on restored focus'
    )
    assert.equal(await win.webContents.executeJavaScript('document.activeElement.id'), 'tip-volume')
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' })
    await wait(100)
    assert.equal(
      await win.webContents.executeJavaScript('document.activeElement.id'),
      'tip-range',
      'ArrowDown opens and focuses the slider'
    )
    const beforeKey = await win.webContents.executeJavaScript('tipValue.value')
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Up' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Up' })
    await wait(40)
    assert(
      (await win.webContents.executeJavaScript('tipValue.value')) > beforeKey,
      'Range arrow keys retain native adjustment'
    )
    await win.webContents.executeJavaScript('tipDisabled.value=true;void 0')
    await wait(280)
    assert.equal(
      await win.webContents.executeJavaScript(`!!document.querySelector('.ep-tooltip')`),
      false,
      'Disabling closes the tip'
    )
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 20, y: 20 })
    await win.webContents.executeJavaScript(
      'document.activeElement?.blur();tipDisabled.value=false;void 0'
    )
    await tipMove('#tip-text')
    assert(
      await win.webContents.executeJavaScript(
        `(()=>{const e=document.querySelector('.ep-tooltip');return e?.getAttribute('role')==='tooltip'&&document.querySelector('#tip-text').getAttribute('aria-describedby')===e.id})()`
      ),
      'Text tip uses role tooltip and aria-describedby'
    )
    await win.webContents.executeJavaScript('tipActive.value=false;void 0')
    await wait(280)
    assert.equal(
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('.ep-tooltip,.ep-studio-canvas').length`
      ),
      0,
      'Deactivation releases tooltip material'
    )
    await win.webContents.executeJavaScript(
      `tipActive.value=true;tipGlass.dispose();for(const [key,value]of Object.entries({'--ep-tooltip-radius':'18px','--ep-tooltip-bg':'rgb(12, 34, 56)','--ep-tooltip-control-width':'48px'}))document.documentElement.style.setProperty(key,value);void 0`
    )
    await wait(80)
    await tipMove('#tip-volume')
    assert.deepEqual(
      await win.webContents.executeJavaScript(
        `(()=>{const c=getComputedStyle(document.querySelector('.ep-tooltip'));return {radius:c.borderRadius,width:c.width,bg:c.backgroundColor}})()`
      ),
      { radius: '18px', width: '48px', bg: 'rgb(12, 34, 56)' },
      'Tooltip tokens work with glass disabled'
    )
    await win.webContents.executeJavaScript(
      `window.tipGlass=Components.mountLiquidGlassStudio();void 0`
    )
    await wait(200)
    assert.equal(
      await win.webContents.executeJavaScript(
        `getComputedStyle(document.querySelector('.ep-tooltip')).backgroundColor`
      ),
      'rgb(12, 34, 56)',
      'Tooltip background override survives glass styling'
    )
    await win.webContents.executeJavaScript('tipHarness.unmount();tipGlass.dispose();void 0')
    await wait(200)
    assert.equal(
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('.ep-tooltip,.ep-studio-canvas').length`
      ),
      0,
      'Unmount releases tooltip listeners and material'
    )
    fs.writeFileSync(
      path.join(output, 'tooltip.json'),
      JSON.stringify(
        {
          material: tipMaterial,
          hoverTransfer: true,
          drag: true,
          wheel: true,
          scrollTracking: true,
          keyboard: true,
          escape: true,
          disabled: true,
          keepAlive: true,
          tokens: true,
          unmount: true
        },
        null,
        2
      )
    )
    win.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
