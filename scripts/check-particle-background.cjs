/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const esbuild = require('esbuild')
const { parse, compileScript } = require('@vue/compiler-sfc')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-particles-'))
app.setPath('userData', path.join(root, 'profile'))

async function checkBackground() {
  const { Vue, Background, ParticleFlowRenderer, resolvePlayerBgType } = window.ParticleCheck
  const check = (condition, message) => {
    if (!condition) throw Error(message)
  }
  const wait = () => new Promise((resolve) => setTimeout(resolve, 100))
  const originalResize = ParticleFlowRenderer.prototype.resize
  ParticleFlowRenderer.prototype.resize = function () {
    window.particleRenderer = this
    return originalResize.call(this)
  }
  let unavailable = 0
  const props = Vue.reactive({
    active: false,
    reducedMotion: false,
    energy: 0,
    bass: 0,
    beat: 0,
    beatSequence: 0
  })
  const instance = Vue.createApp({
    render: () => Vue.h(Background, { ...props, onUnavailable: () => unavailable++ })
  })
  instance.mount('#app')
  await wait()
  const renderer = window.particleRenderer
  const canvas = document.querySelector('canvas')
  const gl = canvas.getContext('webgl')
  check(renderer && !unavailable, 'WebGL background initializes without artwork')
  const pixels = () => {
    renderer.draw()
    const data = new Uint8Array(canvas.width * canvas.height * 4)
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data)
    check(gl.getError() === gl.NO_ERROR, 'Particle shaders draw without WebGL errors')
    return data
  }
  const initial = renderer.positions.slice()
  check(
    new Set(Array.from(renderer.homes).filter((_, index) => index % 2 === 0)).size > 9000,
    'Initial cloud has independent positions instead of repeated grid columns'
  )
  for (let frame = 0; frame < 120; frame++) renderer.advance(1)
  check(
    renderer.positions.every((value, index) => value === initial[index]),
    'Silence leaves the cloud stationary'
  )
  const silent = pixels()
  check(
    silent.some((value, index) => index % 4 !== 3 && value > 30),
    'Particles are visible'
  )
  renderer.setAudio(0.8, 0.9, 0.8, 1)
  for (let frame = 0; frame < 240; frame++) renderer.advance(1)
  const flowing = pixels()
  check(
    renderer.positions.some((value, index) => Math.abs(value - initial[index]) > 0.15),
    'Audio drives substantial inertial motion'
  )
  check(
    flowing.some((value, index) => value !== silent[index]),
    'Audio changes the rendered image'
  )
  check(renderer.positions.every(Number.isFinite), 'Particle positions remain finite')
  const extent = () => {
    let total = 0
    for (let i = 0; i < renderer.positions.length; i += 2)
      total += (renderer.positions[i] / renderer.aspect) ** 2 + renderer.positions[i + 1] ** 2
    return total / (renderer.positions.length / 2)
  }
  const holdPhase = (phase) => {
    for (let frame = 0; frame < 150; frame++) {
      renderer.phase = phase
      renderer.advance(1)
    }
  }
  holdPhase(Math.PI / 2)
  const gatheredExtent = extent()
  const homeDistance = () => {
    let total = 0
    for (let i = 0; i < renderer.positions.length; i++)
      total += Math.abs(renderer.positions[i] - renderer.homes[i])
    return total / renderer.positions.length
  }
  const gatheredHomeDistance = homeDistance()
  holdPhase(Math.PI * 1.5)
  check(extent() > gatheredExtent * 1.5, 'Scatter phase spreads particles across the viewport')
  holdPhase(Math.PI * 2)
  check(
    homeDistance() < gatheredHomeDistance * 0.8 && extent() > gatheredExtent * 1.15,
    'Return relaxes toward a distributed cloud while local turbulence continues'
  )
  const colorful = pixels()
  const hues = new Set()
  for (let i = 0; i < colorful.length; i += 4) {
    const r = colorful[i],
      g = colorful[i + 1],
      b = colorful[i + 2]
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b)
    if (max < 45 || max - min < 20) continue
    let hue =
      max === r
        ? (g - b) / (max - min)
        : max === g
          ? 2 + (b - r) / (max - min)
          : 4 + (r - g) / (max - min)
    hues.add(Math.floor(((hue + 6) % 6) * 2))
  }
  check(hues.size >= 8, 'The rendered field contains a broad spectrum of particle colors')
  let minExtent = Infinity,
    maxExtent = 0
  for (let frame = 0; frame < 900; frame++) {
    renderer.advance(frame % 2 ? 1 : 2)
    if (frame % 15 === 0) {
      minExtent = Math.min(minExtent, extent())
      maxExtent = Math.max(maxExtent, extent())
    }
  }
  check(maxExtent > minExtent * 1.5, 'Continuous audio repeatedly expands and contracts the field')
  check(
    renderer.positions.every(
      (value, index) => Math.abs(value) < (index % 2 ? 1.25 : renderer.aspect * 1.25)
    ),
    'Extended playback keeps particles near the viewport'
  )
  renderer.setActive(true)
  renderer.setAudio(0.8, 0.9, 1, 2)
  check(renderer.pulse === 1, 'A new beat produces a pulse')
  renderer.advance(1)
  const pulse = renderer.pulse
  renderer.setAudio(0.8, 0.9, 1, 2)
  check(renderer.pulse === pulse, 'The same beat does not repeatedly fire')
  renderer.setActive(false)
  const frozen = renderer.positions.slice()
  await wait()
  check(
    renderer.frame === 0 && renderer.positions.every((value, index) => value === frozen[index]),
    'Pausing cancels frames and freezes particles'
  )
  props.active = true
  props.reducedMotion = true
  await wait()
  check(renderer.frame === 0, 'Reduced motion keeps a static frame')
  props.reducedMotion = false
  await wait()
  check(renderer.frame !== 0, 'Animation resumes')
  props.active = false
  await wait()
  renderer.setAudio(0, 0, 0, 2)
  for (let frame = 0; frame < 900; frame++) renderer.advance(1)
  check(
    renderer.positions.every((value, index) => Math.abs(value - renderer.homes[index]) < 0.005),
    'Particles settle into the irregular cloud after silence'
  )
  check(
    resolvePlayerBgType('particles') === 'particles',
    'Selection survives preference normalization'
  )
  check(
    resolvePlayerBgType('particles', { particlesAvailable: false }) === 'ambient',
    'GPU failure falls back to ambient'
  )
  window.particlePreview = (phase = Math.PI / 2) => {
    renderer.setAudio(0.8, 0.9, 1, 3)
    renderer.pulse = 0
    holdPhase(phase)
    renderer.draw()
    // Let the compositor present the new WebGL frame before capturing it.
    return wait()
  }
  window.checkParticleResize = async () => {
    await wait()
    check(canvas.width * canvas.height <= 900000, 'Backing buffer respects pixel budget')
    check(renderer.positions.every(Number.isFinite), 'Resize preserves finite positions')
    pixels()
  }
  window.checkParticleDisposal = async () => {
    const buffer = renderer.buffer,
      seedBuffer = renderer.seedBuffer,
      velocityBuffer = renderer.velocityBuffer,
      program = renderer.program
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    await wait()
    check(
      unavailable === 1 && renderer.disposed && renderer.frame === 0,
      'Context loss signals fallback and stops animation'
    )
    check(
      !gl.isBuffer(buffer) &&
        !gl.isBuffer(seedBuffer) &&
        !gl.isBuffer(velocityBuffer) &&
        !gl.isProgram(program),
      'GPU buffers and program are released'
    )
    instance.unmount()
    check(
      renderer.positions.length === 0 &&
        renderer.seeds.length === 0 &&
        renderer.directions.length === 0 &&
        renderer.field.length === 0,
      'Unmount releases particle arrays'
    )
  }
  return 'Particles: WebGL, color spectrum, audio gather/scatter/return, silence, beat deduplication, pause, reduced motion and fallback passed.'
}

app.whenReady().then(async () => {
  try {
    const bundle = await esbuild.build({
      stdin: {
        resolveDir: process.cwd(),
        contents:
          "export * as Vue from 'vue';export {default as Background} from './src/renderer/src/components/background/player/ParticleFlowBackground.vue';export {ParticleFlowRenderer} from './src/renderer/src/components/background/player/particleFlowRenderer';export {resolvePlayerBgType} from './src/renderer/src/constants';"
      },
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      globalName: 'ParticleCheck',
      alias: { vue: require.resolve('vue/dist/vue.esm-bundler.js') },
      define: {
        __APP_VERSION__: '"test"',
        __APP_BUILD__: '"0"',
        __VUE_OPTIONS_API__: 'true',
        __VUE_PROD_DEVTOOLS__: 'false',
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false'
      },
      plugins: [
        {
          name: 'vue',
          setup(build) {
            build.onLoad({ filter: /\.vue$/ }, ({ path: filename }) => {
              const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
              return {
                contents: compileScript(descriptor, { id: 'particle-check', inlineTemplate: true })
                  .content,
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
      width: 1200,
      height: 760,
      webPreferences: { offscreen: true, backgroundThrottling: false }
    })
    const html = path.join(root, 'check.html')
    fs.writeFileSync(
      html,
      '<html><style>html,body,#app{width:100%;height:100%;margin:0;background:#06080c}.particle-flow-background{position:absolute;inset:0}canvas{display:block;width:100%;height:100%}</style><body><div id="app"></div></body></html>'
    )
    await win.loadFile(html)
    await win.webContents.executeJavaScript(bundle.outputFiles[0].text)
    const result = await win.webContents.executeJavaScript(
      '(' + checkBackground.toString() + ')().catch(error=>({error:error.stack}))'
    )
    if (result.error) throw Error(result.error)
    console.log(result)
    await win.webContents.executeJavaScript('window.particlePreview()')
    fs.mkdirSync('build', { recursive: true })
    fs.writeFileSync(
      'build/particle-flow-preview.png',
      (await win.webContents.capturePage()).toPNG()
    )
    await win.webContents.executeJavaScript('window.particlePreview(Math.PI * 1.5)')
    fs.writeFileSync(
      'build/particle-flow-scatter.png',
      (await win.webContents.capturePage()).toPNG()
    )
    await win.webContents.executeJavaScript('window.particlePreview(Math.PI * 2)')
    fs.writeFileSync(
      'build/particle-flow-return.png',
      (await win.webContents.capturePage()).toPNG()
    )
    win.setSize(520, 800)
    await win.webContents.executeJavaScript('window.checkParticleResize()')
    win.setSize(1920, 1080)
    await win.webContents.executeJavaScript('window.checkParticleResize()')
    await win.webContents.executeJavaScript('window.checkParticleDisposal()')
    console.log('Particles: portrait/large resize, context loss and GPU disposal passed.')
    win.destroy()
    app.exit(0)
  } catch (reason) {
    console.error(reason)
    app.exit(1)
  }
})
