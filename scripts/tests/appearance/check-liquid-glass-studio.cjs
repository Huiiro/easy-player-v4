/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const esbuild = require('esbuild')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ep-studio-')))
app.commandLine.appendSwitch('force-device-scale-factor', process.env.EP_GLASS_DPR || '1')
if (process.env.EP_GLASS_NO_WEBGL === '1') app.commandLine.appendSwitch('disable-webgl')

app.whenReady().then(async () => {
  try {
    const output = path.resolve('build/themes/liquid-glass-studio')
    fs.mkdirSync(output, { recursive: true })
    const vendor = path.resolve('src/renderer/src/vendor/liquid-glass-studio')
    const upstream = JSON.parse(fs.readFileSync(path.join(vendor, 'upstream.json'), 'utf8'))
    for (const file of upstream.files) {
      assert.equal(
        crypto
          .createHash('sha256')
          .update(fs.readFileSync(path.join(vendor, file.path)))
          .digest('hex'),
        file.sha256,
        `Unmodified upstream ${file.path}`
      )
    }
    const bundle = await esbuild.build({
      stdin: {
        contents:
          "export * from './src/renderer/src/services/liquidGlassStudio';export * from './src/renderer/src/services/liquidGlassProfile';export * from './src/renderer/src/services/glassBackground';export {applyCustomTheme} from './src/renderer/src/services/customTheme'",
        resolveDir: process.cwd()
      },
      bundle: true,
      write: false,
      format: 'iife',
      globalName: 'Studio',
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
          name: 'raw-glsl',
          setup(build) {
            build.onResolve({ filter: /\.glsl\?raw$/ }, (args) => ({
              path: path.resolve(args.resolveDir, args.path.slice(0, -4)),
              namespace: 'raw-glsl'
            }))
            build.onLoad({ filter: /.*/, namespace: 'raw-glsl' }, (args) => ({
              contents: fs.readFileSync(args.path, 'utf8'),
              loader: 'text'
            }))
          }
        }
      ]
    })
    const win = new BrowserWindow({
      show: false,
      width: 1120,
      height: 760,
      webPreferences: {
        offscreen: true,
        backgroundThrottling: false,
        webgl: process.env.EP_GLASS_NO_WEBGL !== '1'
      }
    })
    const errors = []
    win.webContents.on('console-message', (event) => {
      if (event.level === 'error' || event.level === 'warning') {
        errors.push(event.message)
        console.log(event.message)
      }
    })
    const fixture = path.join(output, 'fixture.html')
    fs.writeFileSync(
      fixture,
      `<!doctype html><html style="--color-bg:#152236"><head><style>
      *{box-sizing:border-box}body{margin:0;font:14px sans-serif;color:white;background:#152236}.app-background-stage{position:absolute;inset:0;background:linear-gradient(125deg,#ac275d 0%,#268dc4 45%,#e3b140 75%,#135432 100%)}
      .ep-header{position:fixed;left:14px;right:14px;top:12px;height:64px;padding:16px;border-radius:20px;background:#2228;-webkit-app-region:drag}#input{-webkit-app-region:no-drag}.ep-sidebar{position:fixed;left:14px;top:88px;bottom:102px;width:210px;border-radius:20px;padding:20px;background:#2228}.ep-footer{position:fixed;left:14px;right:14px;bottom:14px;height:72px;border-radius:22px;padding:20px;background:#2228}.ep-dialog-panel{position:fixed;left:400px;top:210px;width:500px;height:240px;padding:24px;border-radius:24px;background:#2228}
      .library{position:absolute;inset:90px 0 100px 240px;overflow:auto}.song-row{height:36px}.song-row.active{color:#ff0}button,input{position:relative;font:inherit}canvas{display:block}
    </style></head><body><div class="app-background-stage" data-background-key="theme"></div><div class="library">${Array.from({ length: 180 }, (_, i) => `<div class="song-row">${i} Music</div>`).join('')}</div><header class="ep-header">Easy Player <input aria-label="Search" id="input"></header><aside class="ep-sidebar">Library</aside><footer class="ep-footer"><button id="play">Play / pause</button><span class="progress"></span></footer><div class="ep-dialog-panel">Liquid Glass Studio <input aria-label="Dialog input"></div></body></html>`
    )
    await win.loadFile(fixture)
    await win.webContents.executeJavaScript(bundle.outputFiles[0].text)
    await win.webContents.executeJavaScript(
      `window.draws=0;window.originalDraw=WebGL2RenderingContext.prototype.drawArrays;WebGL2RenderingContext.prototype.drawArrays=function(...args){window.draws++;return originalDraw.apply(this,args)};
      window.uploadCounts={allocations:0,updates:0};for(const name of ['texImage2D','texSubImage2D']){const original=WebGL2RenderingContext.prototype[name];WebGL2RenderingContext.prototype[name]=function(...args){if(args.at(-1) instanceof HTMLCanvasElement)uploadCounts[name==='texImage2D'?'allocations':'updates']++;return original.apply(this,args)}};
      window.opticUniforms={};window.blurUniforms={radii:[],kernels:[],offsets:[],resolutions:[]};const locations=new WeakMap(),blurPrograms=new WeakSet(),programs=new WeakMap();
      const locate=WebGL2RenderingContext.prototype.getUniformLocation;WebGL2RenderingContext.prototype.getUniformLocation=function(program,name){const result=locate.call(this,program,name);if(name==='u_blurRadius')blurPrograms.add(program);if(result)locations.set(result,name.replace(/\\[0\\]$/,''));return result};
      const use=WebGL2RenderingContext.prototype.useProgram;WebGL2RenderingContext.prototype.useProgram=function(program){programs.set(this,program);return use.call(this,program)};
      const vector=WebGL2RenderingContext.prototype.uniform2fv;WebGL2RenderingContext.prototype.uniform2fv=function(location,values,...rest){if(locations.get(location)==='u_resolution'&&blurPrograms.has(programs.get(this)))blurUniforms.resolutions.push(Array.from(values));return vector.call(this,location,values,...rest)};
      const scalar=WebGL2RenderingContext.prototype.uniform1f;WebGL2RenderingContext.prototype.uniform1f=function(location,value){const name=locations.get(location);if(name)opticUniforms[name]=value;return scalar.call(this,location,value)};
      const integer=WebGL2RenderingContext.prototype.uniform1i;WebGL2RenderingContext.prototype.uniform1i=function(location,value){const name=locations.get(location);if(name==='u_blurRadius')blurUniforms.radii.push(value);if(name)opticUniforms[name]=value;return integer.call(this,location,value)};
      const array=WebGL2RenderingContext.prototype.uniform1fv;WebGL2RenderingContext.prototype.uniform1fv=function(location,values,...rest){if(locations.get(location)==='u_blurWeights')blurUniforms.kernels.push(Array.from(values));if(locations.get(location)==='u_blurOffsets')blurUniforms.offsets.push(Array.from(values));return array.call(this,location,values,...rest)};
      window.controller=Studio.mountLiquidGlassStudio();void 0`
    )
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    await wait(1800)
    const fallback = process.env.EP_GLASS_NO_WEBGL === '1'
    const initial = await win.webContents.executeJavaScript(
      `({draws,canvases:document.querySelectorAll('.ep-studio-canvas').length,surfaces:document.querySelectorAll('.ep-studio-surface').length})`
    )
    assert.equal(initial.surfaces, 4)
    assert.equal(
      await win.webContents.executeJavaScript(
        `document.documentElement.getAttribute('data-ep-glass-components')`
      ),
      'liquid-glass-studio'
    )
    assert.equal(initial.canvases, fallback ? 0 : 4)
    if (!fallback)
      assert(initial.draws >= 16, 'Real upstream multipass WebGL renders every surface')
    const referenceBlur = await win.webContents.executeJavaScript(
      `({radius:Studio.STUDIO_BLUR_RADIUS,sigma:Studio.studioBlurSigma(Studio.STUDIO_BLUR_RADIUS,devicePixelRatio),dpr:devicePixelRatio,kernel:Studio.STUDIO_BLUR_WEIGHTS,radii:[...new Set(blurUniforms.radii)],gpuKernels:blurUniforms.kernels,offsets:blurUniforms.offsets,preset:Studio.STUDIO_PRESET,expectedSamples:[...document.querySelectorAll('.ep-studio-surface')].flatMap(e=>{const c=e.querySelector('canvas');return c?[Studio.studioBlurSamples(c.width/(e.clientWidth*devicePixelRatio)),Studio.studioBlurSamples(c.height/(e.clientHeight*devicePixelRatio))]:[]}),resolutions:blurUniforms.resolutions,expectedResolutions:[...document.querySelectorAll('.ep-studio-surface')].map(e=>[e.querySelector('canvas')?.width,e.querySelector('canvas')?.height])})`
    )
    assert.equal(referenceBlur.radius, referenceBlur.preset.blurRadius)
    assert.equal(referenceBlur.kernel.length, referenceBlur.radius + 1)
    assert(
      Math.abs(
        referenceBlur.kernel[referenceBlur.radius] / referenceBlur.kernel[0] - Math.exp(-4.5)
      ) < 1e-12,
      'Configured radius uses the upstream three-sigma Gaussian cutoff'
    )
    assert(
      Math.abs(referenceBlur.sigma * referenceBlur.dpr - referenceBlur.radius / 3) < 1e-10,
      'CSS blur preserves the same physical-pixel sigma across displays'
    )
    const mass =
      referenceBlur.kernel[0] +
      2 * referenceBlur.kernel.slice(1).reduce((sum, value) => sum + value, 0)
    assert(Math.abs(mass - 1) < 1e-12, 'Demo Gaussian kernel preserves brightness')
    if (!fallback) {
      const presetUniforms = await win.webContents.executeJavaScript('opticUniforms')
      const preset = referenceBlur.preset
      for (const key of [
        'refThickness',
        'refDistance',
        'refFactor',
        'refFresnelRange',
        'glareRange'
      ])
        assert.equal(presetUniforms['u_' + key], preset[key])
      assert.equal(
        presetUniforms.u_refDispersion,
        0,
        'WebGL does not duplicate live DOM dispersion'
      )
      for (const key of [
        'refFresnelHardness',
        'refFresnelFactor',
        'glareHardness',
        'glareFactor',
        'glareConvergence',
        'glareOppositeFactor',
        'shadowFactor'
      ])
        assert.equal(presetUniforms['u_' + key], preset[key] / 100)
      for (const samples of referenceBlur.expectedSamples) {
        assert(
          referenceBlur.gpuKernels.some(
            (weights) => JSON.stringify(weights) === JSON.stringify(samples.weights)
          ),
          'GPU receives the equivalent paired kernel'
        )
        assert(
          referenceBlur.offsets.some(
            (offsets) => JSON.stringify(offsets) === JSON.stringify(samples.offsets)
          ),
          'GPU uses weighted bilinear offsets'
        )
        assert(
          1 + 2 * (samples.weights.length - 1) < 1 + 2 * referenceBlur.radius,
          'Fewer reads preserve the source Gaussian'
        )
      }
      for (const expected of referenceBlur.expectedResolutions)
        assert(
          referenceBlur.resolutions.some((actual) =>
            actual.every((value, index) => Math.abs(value - expected[index]) < 1e-5)
          ),
          'Paired blur uses framebuffer texels after equivalent display-pixel kernel remapping'
        )
    }
    const drag = await win.webContents.executeJavaScript(`(()=>{
      const header=document.querySelector('.ep-header'),canvas=header.querySelector('.ep-studio-canvas'),input=document.querySelector('#input'),r=input.getBoundingClientRect();
      const region=e=>getComputedStyle(e).getPropertyValue('-webkit-app-region');
      return {header:region(header),canvas:canvas?region(canvas):null,input:region(input),inputHit:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===input};
    })()`)
    assert.equal(drag.header, 'drag')
    assert.equal(drag.input, 'no-drag')
    assert.equal(drag.inputHit, true)
    if (!fallback)
      assert.equal(
        drag.canvas,
        'drag',
        'Decorative canvas cannot subtract the Header native drag region'
      )
    const softness = await win.webContents.executeJavaScript(
      `(()=>{
        const read=selector=>{const css=getComputedStyle(document.querySelector(selector)).backdropFilter,id=css.match(/#([^"')]+)/)?.[1],filter=id&&document.getElementById(id);return {css,blur:parseFloat(filter?.querySelector('feGaussianBlur')?.getAttribute('stdDeviation')??css.match(/blur\\(([\\d.]+)px\\)/)?.[1]??'0')}};
        const footer=read('.ep-footer'),dialog=read('.ep-dialog-panel'),filter=document.getElementById(dialog.css.match(/#([^"')]+)/)?.[1]);return {footer:footer.css,dialog:dialog.css,footerBlur:footer.blur,dialogBlur:dialog.blur,composites:filter?.querySelectorAll('feComposite').length,images:filter?.querySelectorAll('feImage').length,channels:filter?.querySelectorAll('feDisplacementMap').length};
      })()`
    )
    assert.equal(softness.footerBlur, 0, 'Scrolling footer stays clear')
    assert(
      Math.abs(softness.dialogBlur - referenceBlur.sigma) < 1e-4,
      'Dialog matches the configured upstream radius at the current DPR'
    )
    if (!fallback) {
      assert.equal(
        softness.composites,
        2,
        'Live RGB channels are recombined without masking the clear centre'
      )
      assert.equal(
        softness.images,
        1,
        'Only the displacement field is uploaded; no unused reflection or interior images'
      )
      assert.equal(softness.channels, 3, 'Actual page pixels are sampled at three wavelengths')
      const edge = await win.webContents.executeJavaScript(`(async()=>{
        const footer=document.querySelector('.ep-footer'),id=getComputedStyle(footer).backdropFilter.match(/#([^"')]+)/)[1];
        const image=new Image();image.src=document.querySelector('#'+id+' feImage[result="normal"]').getAttribute('href');await image.decode();
        const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,c.width,c.height).data;
        const sample=y=>{const i=(Math.min(c.height-1,Math.floor(y/footer.offsetHeight*c.height))*c.width+Math.floor(c.width/2))*4;return [data[i],data[i+1]]};return {rim:sample(2),interior:sample(35)};
      })()`)
      assert(
        edge.rim.some((value) => value !== 128),
        'Demo rim still refracts'
      )
      assert.deepEqual(edge.interior, [128, 128], 'Refraction has faded beyond the configured edge')
    }
    let liveDispersion
    if (!fallback) {
      await win.webContents.executeJavaScript(`{
        const stage=document.querySelector('.app-background-stage');window.liveTheme=stage.style.background;stage.style.background='#aaa';
        const underlay=document.createElement('div');underlay.id='live-dom-dispersion';underlay.style.cssText='position:fixed;left:0;right:0;bottom:0;height:110px;background:repeating-linear-gradient(45deg,#222 0 12px,#eee 12px 24px);pointer-events:none';document.body.insertBefore(underlay,document.querySelector('.ep-footer'));controller.refresh();void 0;
      }`)
      await wait(220)
      const shot = (await win.webContents.capturePage()).resize({ width: 1120, height: 760 }),
        bytes = shot.toBitmap()
      let fringes = 0,
        maxSpread = 0
      for (let y = 675; y < 687; y++)
        for (let x = 50; x < 1070; x++) {
          const i = (y * 1120 + x) * 4,
            rgb = [bytes[i], bytes[i + 1], bytes[i + 2]],
            spread = Math.max(...rgb) - Math.min(...rgb)
          maxSpread = Math.max(maxSpread, spread)
          if (spread > 18) fringes++
        }
      liveDispersion = { fringes, maxSpread }
      assert(
        fringes > 80 && maxSpread > 30,
        'Actual grayscale DOM content refracts into visible colours over a flat theme: ' +
          JSON.stringify(liveDispersion)
      )
      fs.writeFileSync(
        path.join(output, `live-dom-dispersion-${process.env.EP_GLASS_DPR || '1'}x.png`),
        shot.toPNG()
      )
      await win.webContents.executeJavaScript(
        `document.querySelector('#live-dom-dispersion').remove();document.querySelector('.app-background-stage').style.background=liveTheme;controller.refresh();void 0`
      )
      await wait(150)
    }
    let dispersion
    if (!fallback) {
      await win.webContents.executeJavaScript(`{
        window.prismFrames=[];window.prismFactor=0;window.prismDraws=0;
        window.prismUniform=WebGL2RenderingContext.prototype.uniform1f;
        WebGL2RenderingContext.prototype.uniform1f=function(location,value){
          if(this.canvas.parentElement?.id==='dispersion-check'&&locations.get(location)==='u_refDispersion')value=prismFactor;
          return prismUniform.call(this,location,value);
        };
        window.prismDraw=WebGL2RenderingContext.prototype.drawArrays;
        WebGL2RenderingContext.prototype.drawArrays=function(...args){
          const result=prismDraw.apply(this,args);
          if(this.canvas.parentElement?.id==='dispersion-check'){
            prismDraws++;
            if(this.getParameter(this.FRAMEBUFFER_BINDING)===null){
              const data=new Uint8Array(this.canvas.width*this.canvas.height*4);
              this.readPixels(0,0,this.canvas.width,this.canvas.height,this.RGBA,this.UNSIGNED_BYTE,data);
              prismFrames.push({data,width:this.canvas.width,height:this.canvas.height});
            }
          }
          return result;
        };
        const stage=document.querySelector('.app-background-stage');window.prismBackground=stage.style.background;
        stage.style.background='linear-gradient(90deg,#111 0%,#111 30%,#eee 30%,#eee 36%,#111 36%,#111 43%,#eee 43%,#eee 50%,#111 50%,#111 57%,#eee 57%,#eee 64%,#111 64%,#111 100%)';
        const panel=document.createElement('div');panel.id='dispersion-check';panel.className='ep-glass-panel';panel.style.cssText='position:fixed;left:360px;top:180px;width:380px;height:260px;border-radius:24px;pointer-events:none';document.body.append(panel);
        controller.refresh();void 0;
      }`)
      await wait(300)
      await win.webContents.executeJavaScript(
        `window.prismNeutral=prismFrames.at(-1);prismFactor=Studio.STUDIO_PRESET.refDispersion;window.prismBeforeDraws=prismDraws;controller.refresh();void 0`
      )
      await wait(250)
      dispersion = await win.webContents.executeJavaScript(`(()=>{
        const frame=prismFrames.at(-1),base=prismNeutral;let changed=0,fringes=0,maxSpread=0,maxDelta=0;
        for(let i=0;i<frame.data.length;i+=4){
          const rgb=[frame.data[i],frame.data[i+1],frame.data[i+2]],spread=Math.max(...rgb)-Math.min(...rgb);
          const diff=Math.max(...rgb.map((v,c)=>Math.abs(v-base.data[i+c])));
          if(diff>4)changed++;if(diff>4&&spread>12)fringes++;maxSpread=Math.max(maxSpread,spread);maxDelta=Math.max(maxDelta,diff);
        }
        const middle=(Math.floor(frame.height/2)*frame.width+Math.floor(frame.width/2))*4;
        return {factor:prismFactor,changed,fringes,maxSpread,maxDelta,center:Array.from(frame.data.slice(middle,middle+4)),draws:prismDraws-prismBeforeDraws};
      })()`)
      assert(
        dispersion.changed > 100,
        'Changing dispersion changes rendered edge pixels: ' + JSON.stringify(dispersion)
      )
      assert(
        dispersion.fringes > 40 && dispersion.maxSpread > 20,
        'A grayscale background produces real coloured refraction fringes: ' +
          JSON.stringify(dispersion)
      )
      assert.deepEqual(
        dispersion.center,
        [0, 0, 0, 0],
        'Dispersion leaves the flat glass centre transparent'
      )
      assert.equal(dispersion.draws, 4, 'Dispersion reuses the existing four passes')
      fs.writeFileSync(
        path.join(output, `dispersion-${process.env.EP_GLASS_DPR || '1'}x.png`),
        (await win.webContents.capturePage()).toPNG()
      )
      await wait(150)
      const steadyDraws = await win.webContents.executeJavaScript('prismDraws')
      await wait(150)
      assert.equal(
        await win.webContents.executeJavaScript('prismDraws'),
        steadyDraws,
        'Dispersion adds no idle drawing loop'
      )
      await win.webContents.executeJavaScript(
        `WebGL2RenderingContext.prototype.uniform1f=prismUniform;WebGL2RenderingContext.prototype.drawArrays=prismDraw;document.querySelector('#dispersion-check').remove();document.querySelector('.app-background-stage').style.background=prismBackground;controller.refresh();void 0`
      )
      await wait(150)
    }
    // Vue replaces the complete class attribute when Footer changes layout.
    // Reproduce that replacement instead of preserving engine-added classes.
    await win.webContents.executeJavaScript(`{
      const probe=document.createElement('div');probe.id='footer-backdrop-probe';probe.style.cssText='position:fixed;left:0;right:0;bottom:0;height:100px;background:rgb(240,30,40)';document.body.insertBefore(probe,document.querySelector('.ep-footer'));
      const footer=document.querySelector('.ep-footer');footer.style.width=footer.clientWidth+'px';
    }`)
    // Commit the probe and numeric starting width before sampling animation.
    await wait(150)
    const footerLayouts = []
    for (const [layoutIndex, collapsed] of [true, false, true, true].entries()) {
      const beforeLayoutDraws = await win.webContents.executeJavaScript('draws')
      const immediate = await win.webContents.executeJavaScript(`(()=>{
        const footer=document.querySelector('.ep-footer'),before=getComputedStyle(footer),background=before.backgroundColor,filter=before.backdropFilter;
        footer.className='ep-footer app-footer--${collapsed ? 'collapsed' : 'expanded'}';footer.style.transitionDuration='300ms';footer.style.width='${collapsed ? '448px' : 'calc(100% - 28px)'}';footer.style.left='${collapsed ? 'calc(50% - 224px)' : '14px'}';footer.style.right='auto';
        const after=getComputedStyle(footer);return {background,filter,afterBackground:after.backgroundColor,afterFilter:after.backdropFilter};
      })()`)
      assert.equal(
        immediate.afterFilter,
        immediate.filter,
        'Live filter remains bound during the first collapse frame'
      )
      const alpha = (color) => Number(color.match(/[/,]\s*([\d.]+)\s*\)$/)?.[1] ?? 1)
      assert.equal(
        alpha(immediate.afterBackground),
        alpha(immediate.background),
        'Footer tint never enters an opaque background transition'
      )
      const frames = []
      if (layoutIndex < 3)
        for (let frame = 0; frame < 10; frame++) {
          await win.webContents.executeJavaScript('new Promise(requestAnimationFrame)')
          const sample = await win.webContents.executeJavaScript(
            `(()=>{const e=document.querySelector('.ep-footer'),r=e.getBoundingClientRect(),css=getComputedStyle(e);return {x:Math.round(r.left+r.width/2+70),y:Math.round(r.top+r.height/2),background:css.backgroundColor,filter:css.backdropFilter,width:r.width};})()`
          )
          const bytes = (await win.webContents.capturePage())
            .resize({ width: 1120, height: 760 })
            .toBitmap()
          const i = (sample.y * 1120 + sample.x) * 4
          sample.pixel = [bytes[i + 2], bytes[i + 1], bytes[i]]
          assert(alpha(sample.background) < 0.1, 'Animated Footer keeps its transparent tint')
          assert(
            sample.pixel[0] > 190 && sample.pixel[1] < 80 && sample.pixel[2] < 90,
            'Footer never flashes an opaque centre during animation: ' + JSON.stringify(sample)
          )
          assert(
            fallback || sample.filter.includes('url('),
            'Live transmission stays bound on every sampled animation frame'
          )
          frames.push(sample)
        }
      await wait(450)
      const state = await win.webContents.executeJavaScript(
        `(()=>{const e=document.querySelector('.ep-footer'),css=getComputedStyle(e),r=e.getBoundingClientRect();return {glass:e.classList.contains('ep-studio-surface'),filter:css.backdropFilter,background:css.backgroundColor,canvas:!!e.querySelector('.ep-studio-canvas'),x:Math.round(r.left+r.width/2+70),y:Math.round(r.top+r.height/2),width:r.width};})()`
      )
      assert.equal(state.glass, true, 'Footer class replacement preserves the glass material')
      assert(
        fallback || state.filter.includes('url('),
        'Collapsed Footer retains its live SVG filter'
      )
      assert.equal(state.canvas, !fallback, 'Footer retains its optical canvas')
      if (layoutIndex === 3)
        assert.equal(
          await win.webContents.executeJavaScript('draws'),
          beforeLayoutDraws,
          'Restoring material classes at the same size reuses cached GPU output'
        )
      const bitmap = (await win.webContents.capturePage())
        .resize({ width: 1120, height: 760 })
        .toBitmap()
      const i = (state.y * 1120 + state.x) * 4
      state.pixel = [bitmap[i + 2], bitmap[i + 1], bitmap[i]]
      assert(
        state.pixel[0] > 190 && state.pixel[1] < 80 && state.pixel[2] < 90,
        'Footer centre remains transparent across collapse and expansion: ' + JSON.stringify(state)
      )
      footerLayouts.push(state)
      state.frames = frames
    }
    await win.webContents.executeJavaScript(
      `document.querySelector('#footer-backdrop-probe').remove();document.querySelector('.ep-footer').className='ep-footer';document.querySelector('.ep-footer').removeAttribute('style');void 0`
    )
    await wait(150)
    const screenshot = await win.webContents.capturePage()
    fs.writeFileSync(
      path.join(
        output,
        fallback ? 'fallback.png' : `preview-${process.env.EP_GLASS_DPR || '1'}x.png`
      ),
      screenshot.toPNG()
    )
    // A nearer DOM layer must remain visible through glass, even when the theme
    // texture is different. Modal scrims must continue dimming that layer.
    await win.webContents.executeJavaScript(`{
      const probe=document.createElement('div');probe.id='layer-probe';probe.style.cssText='position:fixed;left:600px;top:330px;width:100px;height:60px;background:rgb(240,30,40)';
      document.body.insertBefore(probe,document.querySelector('.ep-dialog-panel'));
    }`)
    await wait(100)
    const sample = async () => {
      const shot = (await win.webContents.capturePage()).resize({ width: 1120, height: 760 })
      const bytes = shot.toBitmap()
      const offset = (360 * 1120 + 650) * 4
      return [bytes[offset + 2], bytes[offset + 1], bytes[offset]]
    }
    const throughGlass = await sample()
    assert(
      throughGlass[0] > 190 && throughGlass[1] < 80,
      'Glass transmits nearer DOM content: ' + JSON.stringify(throughGlass)
    )
    await win.webContents.executeJavaScript(`{
      const scrim=document.createElement('div');scrim.id='layer-scrim';scrim.style.cssText='position:fixed;inset:0;background:rgb(0 0 0 / 50%)';
      document.body.insertBefore(scrim,document.querySelector('.ep-dialog-panel'));
    }`)
    await wait(100)
    const dimmedGlass = await sample()
    assert(
      dimmedGlass[0] < throughGlass[0] * 0.7,
      'Dialog glass preserves the modal scrim rather than brightening an unmasked background copy'
    )
    const restoration = await win.webContents.executeJavaScript(
      `({filter:getComputedStyle(document.querySelector('.ep-dialog-panel')).backdropFilter,background:getComputedStyle(document.querySelector('.ep-dialog-panel')).backgroundColor})`
    )
    assert.notEqual(restoration.filter, 'none')
    await win.webContents.executeJavaScript(
      `document.querySelector('#layer-scrim').remove();document.querySelector('#layer-probe').style.background='repeating-linear-gradient(90deg,#000 0 2px,#fff 2px 4px)';void 0`
    )
    const stripeContrast = async () => {
      const bytes = (await win.webContents.capturePage())
        .resize({ width: 1120, height: 760 })
        .toBitmap()
      const red = Array.from({ length: 40 }, (_, i) => bytes[(360 * 1120 + 635 + i) * 4 + 2])
      return Math.max(...red) - Math.min(...red)
    }
    const waitForDialogBlur = async (sigma) => {
      const ready = await win.webContents.executeJavaScript(`(async()=>{
        for(let frame=0;frame<120;frame++){
          const value=getComputedStyle(document.querySelector('.ep-dialog-panel')).backdropFilter,id=value.match(/#([^"')]+)/)?.[1],filter=id&&document.getElementById(id);
          const blur=filter?Number(filter.querySelector('feGaussianBlur')?.getAttribute('stdDeviation')??0):Number(value.match(/blur\\(([\\d.]+)px\\)/)?.[1]);
          if(Math.abs(blur-${sigma})<1e-4){await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return true}
          await new Promise(requestAnimationFrame);
        }return false;
      })()`)
      assert(ready, 'Dialog commits its decoded filter before pixel comparison')
    }
    await waitForDialogBlur(referenceBlur.sigma)
    await wait(80)
    const blurredContrast = await stripeContrast()
    await win.webContents.executeJavaScript(
      `document.querySelector('.ep-dialog-panel').style.setProperty('--ep-studio-blur-radius','0');void 0`
    )
    await waitForDialogBlur(0)
    const clearContrast = await stripeContrast()
    assert(
      clearContrast > 90 && blurredContrast < clearContrast - 20,
      'Dialog blur genuinely softens high-frequency backdrop pixels: ' +
        JSON.stringify({ clearContrast, blurredContrast })
    )
    softness.contrast = { clear: clearContrast, blurred: blurredContrast }
    await win.webContents.executeJavaScript(
      `document.querySelector('.ep-dialog-panel').style.removeProperty('--ep-studio-blur-radius');document.querySelector('#layer-probe').remove();void 0`
    )
    const background = await win.webContents.executeJavaScript(
      `(async()=>{window.bg=Studio.createGlassBackground();await bg.capture();return [...bg.canvas.getContext('2d').getImageData(560,380,1,1).data]})()`
    )
    assert(
      background[0] + background[1] + background[2] > 80,
      'Current theme paint becomes texture'
    )
    const measureActivity = () =>
      win.webContents.executeJavaScript(`(async()=>{
      const start=draws,frames=[],rows=[...document.querySelectorAll('.song-row')],library=document.querySelector('.library'),input=document.querySelector('#input');let clicks=0,inputs=0;
      document.querySelector('#play').onclick=()=>clicks++;input.oninput=()=>inputs++;let prev=performance.now();
      for(let i=0;i<60;i++){await new Promise(requestAnimationFrame);const now=performance.now();frames.push(now-prev);prev=now;rows[i].classList.toggle('active');library.scrollTop=i*10;input.value=String(i);input.dispatchEvent(new Event('input',{bubbles:true}));document.dispatchEvent(new MouseEvent('pointermove',{clientX:i*10,clientY:i}));}
      document.querySelector('#play').click();await new Promise(requestAnimationFrame);frames.sort((a,b)=>a-b);return {draws:draws-start,clicks,inputs,medianMs:frames[30],p95Ms:frames[57]};
    })()`)
    // The blur-control test above legitimately redraws the optical edge once.
    // Start the steady interaction measurement after that update is committed.
    await wait(150)
    const activity = await measureActivity()
    await win.webContents.executeJavaScript(
      `window.audioProbe=document.createElement('audio');document.body.append(audioProbe);window.beforeAudioDraws=draws;for(const type of ['loadeddata','play','pause','seeked'])audioProbe.dispatchEvent(new Event(type));void 0`
    )
    await wait(150)
    assert.equal(
      await win.webContents.executeJavaScript('draws-beforeAudioDraws'),
      0,
      'Player media events never recapture or redraw the glass background'
    )
    await win.webContents.executeJavaScript('audioProbe.remove();void 0')
    await win.webContents.executeJavaScript(
      `document.querySelector('.ep-dialog-panel').style.setProperty('--ep-studio-blur-radius','0');void 0`
    )
    await wait(200)
    const clearActivity = await measureActivity()
    await win.webContents.executeJavaScript(
      `document.querySelector('.ep-dialog-panel').style.removeProperty('--ep-studio-blur-radius');void 0`
    )
    assert.equal(
      activity.draws,
      0,
      'Scroll, typing, row/progress updates and mouse movement never repaint a static theme'
    )
    assert.equal(activity.clicks, 1)
    assert.equal(activity.inputs, 60)
    await win.webContents.executeJavaScript('Studio.applyCustomTheme(null,false)')
    assert.equal(
      await win.webContents.executeJavaScript(
        `!!document.querySelector('#ep-studio-backdrop-svg')`
      ),
      true,
      'Theme refresh does not dispose the independently owned live backdrop'
    )
    if (!fallback) {
      const changes = await win.webContents.executeJavaScript(`(async()=>{
        const before=draws;document.querySelector('.app-background-stage').style.background='linear-gradient(90deg,#008000,#00ff00)';await new Promise(r=>setTimeout(r,150));await bg.capture();return {draws:draws-before,pixel:[...bg.canvas.getContext('2d').getImageData(560,380,1,1).data]};})()`)
      assert(changes.draws >= 16, 'Theme changes refresh the texture')
      assert(changes.pixel[1] > changes.pixel[0] + 100)
    }
    const media = await win.webContents.executeJavaScript(`(async()=>{
      const stage=document.querySelector('.app-background-stage');stage.style.background='#000';const img=document.createElement('div');img.className='background-image';img.style.cssText='position:absolute;inset:-24px;background-image:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22%3E%3Cpath fill=%22%23f02430%22 d=%22M0 0h40v40H0z%22/%3E%3C/svg%3E")';stage.append(img);await bg.capture();const image=[...bg.canvas.getContext('2d').getImageData(560,380,1,1).data];img.remove();
      const c=document.createElement('canvas');c.width=80;c.height=80;c.getContext('2d').fillStyle='#1040f0';c.getContext('2d').fillRect(0,0,80,80);const video=document.createElement('video');video.muted=true;video.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover';video.srcObject=c.captureStream(10);stage.append(video);await video.play();await new Promise(r=>setTimeout(r,150));await bg.capture();const pixel=[...bg.canvas.getContext('2d').getImageData(560,380,1,1).data];const dynamic=bg.dynamic;const before=draws;for(let i=0;i<30;i++){await new Promise(requestAnimationFrame);document.dispatchEvent(new Event('scroll'));}const animatedDraws=draws-before;video.pause();video.srcObject.getTracks().forEach(t=>t.stop());video.remove();return {image,video:pixel,dynamic,animatedDraws};})()`)
    assert(media.image[0] > 200 && media.image[2] < 80, 'Custom image is sampled')
    assert(media.video[2] > 200 && media.video[0] < 80, 'Video frame is sampled')
    assert.equal(media.dynamic, true)
    assert(media.animatedDraws <= 160, 'Scrolling cannot multiply dynamic background timers')
    const uploads = await win.webContents.executeJavaScript('({...uploadCounts})')
    if (!fallback) {
      assert.equal(
        uploads.allocations,
        initial.canvases + Number(!!dispersion),
        'Same-size dynamic textures allocate storage only once per surface'
      )
      assert(uploads.updates > initial.canvases, 'Dynamic backgrounds reuse texture storage')
    }
    if (!fallback)
      assert(media.animatedDraws > 0, 'Dynamic theme keeps updating during interaction')
    // The following checks use a second sampler. Stop the controller so it does
    // not compete for the iframe helper's single in-flight snapshot request.
    await win.webContents.executeJavaScript('controller.setActivity(false,false)')
    await wait(300)
    const helper = fs
      .readFileSync('src/main/plugins/themeGlassSnapshot.ts', 'utf8')
      .match(/Buffer\.from\(`([\s\S]*)`\)/)[1]
    const isolatedDocument = `<html><body style="margin:0"><div id="app"><canvas width="80" height="80" style="width:100vw;height:100vh"></canvas></div><script>${helper}</script><script>const c=document.querySelector('canvas'),ctx=c.getContext('2d');function paint(){ctx.fillStyle='#9040f0';ctx.fillRect(0,0,80,80);requestAnimationFrame(paint)}paint();</script></body></html>`
    const sandbox = await win.webContents.executeJavaScript(`(async()=>{
      const wrapper=document.createElement('div');wrapper.className='sandboxed-theme-background ep-app-background';wrapper.style.cssText='position:absolute;inset:0';const frame=document.createElement('iframe');frame.sandbox='allow-scripts';frame.className='ready';frame.style.cssText='width:100%;height:100%;border:0';frame.srcdoc=${JSON.stringify(isolatedDocument)};wrapper.append(frame);document.querySelector('.app-background-stage').append(wrapper);await new Promise(r=>setTimeout(r,150));await bg.capture();const pixel=[...bg.canvas.getContext('2d').getImageData(560,380,1,1).data];let isolated=false;try{frame.contentWindow.document.body}catch{isolated=true}wrapper.remove();return {pixel,isolated};})()`)
    assert.equal(sandbox.isolated, true, 'Sandbox keeps its opaque origin')
    assert(
      sandbox.pixel[0] > 130 && sandbox.pixel[2] > 220,
      'Sandbox transfers only a bounded background bitmap'
    )
    if (!fallback) {
      const glDocument = isolatedDocument
        .replace("ctx=c.getContext('2d')", "ctx=c.getContext('webgl2')")
        .replace(
          "ctx.fillStyle='#9040f0';ctx.fillRect(0,0,80,80)",
          'ctx.clearColor(0.1,0.7,0.9,1);ctx.clear(ctx.COLOR_BUFFER_BIT)'
        )
      const glPixel = await win.webContents.executeJavaScript(
        `(async()=>{const host=document.createElement('div');host.className='sandboxed-theme-background ep-app-background';host.style.cssText='position:absolute;inset:0';const f=document.createElement('iframe');f.sandbox='allow-scripts';f.className='ready';f.style.cssText='width:100%;height:100%;border:0';f.srcdoc=${JSON.stringify(glDocument)};host.append(f);document.querySelector('.app-background-stage').append(host);await new Promise(r=>setTimeout(r,150));await bg.capture();const pixel=[...bg.canvas.getContext('2d').getImageData(560,380,1,1).data];host.remove();return pixel;})()`
      )
      assert(
        glPixel[1] > 150 && glPixel[2] > 200,
        'Sandbox samples WebGL in the frame before its drawing buffer is discarded'
      )
    }
    await win.webContents.executeJavaScript('controller.setActivity(true,false)')
    await wait(250)
    await win.webContents.executeJavaScript('controller.setActivity(false,false)')
    const paused = await win.webContents.executeJavaScript('draws')
    await win.webContents.executeJavaScript(
      `document.documentElement.style.setProperty('--color-bg','#321');window.dispatchEvent(new Event('resize'))`
    )
    await wait(200)
    assert.equal(
      await win.webContents.executeJavaScript('draws'),
      paused,
      'Hidden/blurred/player-covered windows stop work'
    )
    await win.webContents.executeJavaScript(`controller.setActivity(true,true)`)
    await wait(150)
    await win.webContents.executeJavaScript(
      `window.savedBackground=document.querySelector('.app-background-stage').getAttribute('style');controller.dispose();bg.dispose()`
    )
    const cleanup = await win.webContents.executeJavaScript(
      `({canvases:document.querySelectorAll('.ep-studio-canvas').length,classes:document.querySelectorAll('.ep-studio-surface,.ep-studio-relative').length,attributes:document.querySelectorAll('[data-ep-studio-surface],[data-ep-studio-relative],[data-ep-studio-backdrop-surface]').length,style:!!document.querySelector('#ep-liquid-glass-studio'),background:document.querySelector('.app-background-stage').getAttribute('style')===savedBackground})`
    )
    assert.deepEqual(cleanup, {
      canvases: 0,
      classes: 0,
      attributes: 0,
      style: false,
      background: true
    })
    assert.equal(
      await win.webContents.executeJavaScript(
        `!!document.querySelector('#ep-glass-component-effects') || document.documentElement.hasAttribute('data-ep-glass-components')`
      ),
      false,
      'Disabling the built-in effect releases component treatments'
    )
    assert.equal(
      await win.webContents.executeJavaScript(
        `!!document.querySelector('#ep-studio-backdrop-svg,#ep-studio-backdrop-style')`
      ),
      false,
      'Turning the effect off releases its live backdrop filters'
    )
    const originalTheme = JSON.parse(fs.readFileSync('docs/themes/liquid-glass/theme.json', 'utf8'))
    const config = {
      version: 1,
      name: 'preserved-glass',
      tokens: originalTheme.tokens,
      rules: originalTheme.rules,
      plugin: { data: originalTheme }
    }
    await win.webContents.executeJavaScript(
      `Studio.applyCustomTheme(${JSON.stringify(config)},false)`
    )
    assert.equal(
      await win.webContents.executeJavaScript(`!!document.querySelector('#ep-theme-glass-svg')`),
      false,
      'Built-in mode suppresses the independent theme SVG renderer'
    )
    await win.webContents.executeJavaScript(`Studio.applyCustomTheme(${JSON.stringify(config)})`)
    assert.equal(
      await win.webContents.executeJavaScript(`!!document.querySelector('#ep-theme-glass-svg')`),
      true,
      'Original theme glass resumes when built-in mode is disabled'
    )
    await win.webContents.executeJavaScript(`Studio.applyCustomTheme(null)`)
    let startup
    if (!fallback) {
      await win.webContents.executeJavaScript(`{
        window.mapGates=[];window.normalDecode=HTMLImageElement.prototype.decode;
        HTMLImageElement.prototype.decode=function(){const decoded=normalDecode.call(this);return this.src.startsWith('data:image/png')?decoded.then(()=>new Promise(resolve=>mapGates.push(resolve))):decoded};
        const c=document.createElement('canvas');c.width=c.height=2;c.getContext('2d').fillStyle='#eee';c.getContext('2d').fillRect(0,0,2,2);
        const stage=document.querySelector('.app-background-stage');window.startupPaint=stage.style.background;stage.style.background='url('+c.toDataURL()+')';
        const underlay=document.createElement('div');underlay.id='startup-white';underlay.style.cssText='position:fixed;inset:auto 0 0;height:120px;background:#eee';document.body.insertBefore(underlay,document.querySelector('.ep-footer'));
        window.startupController=Studio.mountLiquidGlassStudio();void 0;
      }`)
      await win.webContents.executeJavaScript(
        `(async()=>{for(let frame=0;frame<180;frame++){if(mapGates.length>0)return;await new Promise(requestAnimationFrame)}})()`
      )
      const blocked = await win.webContents.executeJavaScript(
        `({gates:mapGates.length,filter:getComputedStyle(document.querySelector('.ep-footer')).backdropFilter,canvases:[...document.querySelectorAll('.ep-studio-canvas')].map(c=>({hidden:c.hidden,display:getComputedStyle(c).display}))})`
      )
      assert(blocked.gates > 0, 'Startup check delays real displacement and theme PNG decoding')
      assert(
        !blocked.filter.includes('url('),
        'Undecoded displacement must not be attached to Footer'
      )
      assert(
        blocked.canvases.length > 0 &&
          blocked.canvases.every((c) => c.hidden && c.display === 'none'),
        'Undrawn canvases remain hidden while the first texture is pending'
      )
      await win.webContents.executeJavaScript(
        `HTMLImageElement.prototype.decode=normalDecode;for(const resolve of mapGates.splice(0))resolve();void 0`
      )
      const samples = []
      const sampleFooter = async () => {
        const r = await win.webContents.executeJavaScript(
          `(()=>{const r=document.querySelector('.ep-footer').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+2)}})()`
        )
        const shot = (await win.webContents.capturePage()).resize({ width: 1120, height: 760 }),
          bytes = shot.toBitmap(),
          i = (r.y * 1120 + r.x) * 4
        const value = [bytes[i], bytes[i + 1], bytes[i + 2]]
        samples.push(value)
        assert(
          Math.min(...value) > 140,
          'Footer edge must not flash black during startup: ' + JSON.stringify(value)
        )
      }
      for (let i = 0; i < 10; i++) {
        await wait(20)
        await sampleFooter()
      }
      const oldId = await win.webContents.executeJavaScript(
        `getComputedStyle(document.querySelector('.ep-footer')).backdropFilter.match(/#([^"')]+)/)?.[1]`
      )
      assert(oldId, 'Decoded startup installs a real optical filter')
      await win.webContents.executeJavaScript(
        `HTMLImageElement.prototype.decode=function(){const decoded=normalDecode.call(this);return this.src.startsWith('data:image/png')?decoded.then(()=>new Promise(resolve=>mapGates.push(resolve))):decoded};const footer=document.querySelector('.ep-footer');footer.style.transition='none';footer.style.width='800px';void 0`
      )
      await wait(120)
      assert.equal(
        await win.webContents.executeJavaScript(
          `getComputedStyle(document.querySelector('.ep-footer')).backdropFilter.match(/#([^"')]+)/)?.[1]`
        ),
        oldId,
        'Resize retains the previous ready filter until the replacement map has decoded'
      )
      await sampleFooter()
      await win.webContents.executeJavaScript(
        `HTMLImageElement.prototype.decode=normalDecode;for(const resolve of mapGates.splice(0))resolve();void 0`
      )
      await wait(150)
      await sampleFooter()
      assert.notEqual(
        await win.webContents.executeJavaScript(
          `getComputedStyle(document.querySelector('.ep-footer')).backdropFilter.match(/#([^"')]+)/)?.[1]`
        ),
        oldId,
        'Decoded replacement switches to the updated geometry'
      )
      startup = { blocked, edgeSamples: samples }
      await win.webContents.executeJavaScript(
        `HTMLImageElement.prototype.decode=function(){const decoded=normalDecode.call(this);return this.src.startsWith('data:image/png')?decoded.then(()=>new Promise(resolve=>mapGates.push(resolve))):decoded};document.querySelector('.ep-footer').style.width='1000px';void 0`
      )
      await wait(100)
      assert(
        await win.webContents.executeJavaScript('mapGates.length>0'),
        'Disposal check has a replacement map still pending'
      )
      assert.equal(
        await win.webContents.executeJavaScript(
          `(()=>{const id=getComputedStyle(document.querySelector('.ep-footer')).backdropFilter.match(/#([^"')]+)/)[1];return Number(document.getElementById(id).querySelector('feImage[result="normal"]').getAttribute('width'))})()`
        ),
        1000,
        'The decoded normal image covers the growing Footer while its replacement is pending'
      )
      await sampleFooter()
      await win.webContents.executeJavaScript(
        `startupController.dispose();HTMLImageElement.prototype.decode=normalDecode;for(const resolve of mapGates.splice(0))resolve();document.querySelector('#startup-white').remove();document.querySelector('.ep-footer').removeAttribute('style');document.querySelector('.app-background-stage').style.background=startupPaint;void 0`
      )
      await wait(100)
      assert.equal(
        await win.webContents.executeJavaScript(
          `document.querySelectorAll('#ep-studio-backdrop-svg,.ep-studio-canvas,[data-ep-studio-surface]').length`
        ),
        0,
        'Pending decode cannot restore disposed material'
      )
    }
    assert(
      !errors.some((message) =>
        /Shader compile error|Program link error|GL_INVALID|Unhandled/.test(message)
      ),
      errors.join('\n')
    )
    const metrics = {
      dpr: process.env.EP_GLASS_DPR || '1',
      fallback,
      initial,
      drag,
      softness,
      liveDispersion,
      dispersion,
      startup,
      footerLayouts,
      referenceBlur,
      activity,
      clearActivity,
      media,
      uploads,
      sandbox,
      layers: { throughGlass, dimmedGlass, ...restoration },
      cleanup,
      upstream: upstream.commit
    }
    fs.writeFileSync(
      path.join(
        output,
        fallback ? 'fallback.json' : `verification-${process.env.EP_GLASS_DPR || '1'}x.json`
      ),
      JSON.stringify(metrics, null, 2)
    )
    console.log(JSON.stringify(metrics, null, 2))
    win.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
