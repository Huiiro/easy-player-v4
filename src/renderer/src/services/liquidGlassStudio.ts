import { MultiPassRenderer } from '@/vendor/liquid-glass-studio/src/utils/GLUtils'
import vertex from '../vendor/liquid-glass-studio/src/shaders/vertex.glsl?raw'
import background from '../vendor/liquid-glass-studio/src/shaders/fragment-bg.glsl?raw'
import main from '../vendor/liquid-glass-studio/src/shaders/fragment-main.glsl?raw'
import verticalBlur from '../vendor/liquid-glass-studio/src/shaders/fragment-bg-vblur.glsl?raw'
import horizontalBlur from '../vendor/liquid-glass-studio/src/shaders/fragment-bg-hblur.glsl?raw'
import sdf from '../vendor/liquid-glass-studio/src/shaders/lib/sdf.glsl?raw'
import math from '../vendor/liquid-glass-studio/src/shaders/lib/math.glsl?raw'
import color from '../vendor/liquid-glass-studio/src/shaders/lib/color.glsl?raw'
import { createGlassBackground } from './glassBackground'
import { createLiquidGlassEffect } from './liquidGlass'
import { mountGlassComponentEffects } from './liquidGlassComponents'
import {
  STUDIO_PRESET,
  STUDIO_BLUR_RADIUS,
  studioBlurSamples,
  studioBlurSigma
} from './liquidGlassProfile'
import type { PluginThemeGlass } from '../../../../packages/plugin-sdk/src'

const defaultSelector =
  '.ep-header,.ep-sidebar,.ep-footer,.ep-dialog-panel,.ep-drawer-panel,.ep-menu,.ep-popover,.ep-select-options,.ep-color-picker,.ep-message,.ep-glass-panel,.ep-backtop,.ep-tooltip'
const libraries = { sdf, math, color }
// Adapt the upstream separable blur without changing its effective Gaussian.
function pairedBlur(shader: string): string {
  return shader
    .replace(
      'uniform int u_blurRadius;',
      'uniform int u_blurRadius;\nuniform float u_blurOffsets[MAX_BLUR_RADIUS + 1];'
    )
    .replace('vec2(float(i))', 'vec2(u_blurOffsets[i])')
}
function expand(source: string): string {
  return source.replace(
    /#include ['"]\.\/lib\/(sdf|math|color)\.glsl['"]/g,
    (_, name: keyof typeof libraries) => libraries[name]
  )
}
// Keep upstream optics; adapt coordinates and the final composition for live DOM glass.
const backgroundShader = expand(background)
  .replace(
    'uniform vec2 u_resolution;',
    'uniform vec2 u_resolution;\nuniform vec2 u_themeOrigin;\nuniform vec2 u_themePanelSize;\nuniform vec2 u_themeSize;'
  )
  .replace(
    'getCoverUV(v_uv, u_resolution.x / u_resolution.y, u_bgTextureRatio)',
    '(u_themeOrigin + v_uv * u_themePanelSize) / u_themeSize'
  )
// An opaque background copy would cover lower panels and bypass modal scrims.
// Retain only the optical delta, in premultiplied-alpha form. The baseline must
// be the neutral wavelength; subtracting the dispersed sample erases dispersion.
const edgeShader = expand(main)
  .replace('vec4 getTextureDispersion(', 'vec3 neutralTransmission;\nvec4 getTextureDispersion(')
  .replace(
    'float bgG = texture(tex1, v_uv + offset * (1.0 - (N_G - 1.0) * factor)).g;',
    'vec3 neutralBg = texture(tex1, v_uv + offset).rgb;\n  float bgG = neutralBg.g;'
  )
  .replace(
    'float blurG = texture(tex2, v_uv + offset * (1.0 - (N_G - 1.0) * factor)).g;',
    'vec3 neutralBlur = texture(tex2, v_uv + offset).rgb;\n  float blurG = neutralBlur.g;'
  )
  .replace(
    'return pixel;',
    'neutralTransmission = mix(neutralBg, neutralBlur, mixRate);\n  return pixel;'
  )
  .replace(
    'vec4 outColor;',
    `// The flat centre is supplied by the live DOM compositor. Its optical
    // contribution is exactly zero; skip Snell, dispersion and LCH there.
    if (-merged * u_resolution1x.y >= u_refThickness * 1.35 || merged >= 0.001) {
      fragColor = vec4(0.0);
      return;
    }
    vec4 outColor;`
  )
  .replace('vec4 outColor;', 'vec4 outColor;\n  vec3 clearTransmission = texture(u_bg, v_uv).rgb;')
  .replace(
    'outColor = mix(blurredPixel, vec4(u_tint.r, u_tint.g, u_tint.b, 1.0), u_tint.a * 0.8);',
    '$&\n        clearTransmission = mix(neutralTransmission, u_tint.rgb, u_tint.a * 0.8);'
  )
  .replace(
    'outColor = mix(outColor, vec4(u_tint.r, u_tint.g, u_tint.b, 1.0), u_tint.a * 0.8);',
    '$&\n        clearTransmission = outColor.rgb;'
  )
  .replace(
    'fragColor = outColor;',
    `
  float depth = -merged * u_resolution1x.y;
  float edge = (1.0 - smoothstep(0.0, u_refThickness * 1.35, depth)) *
    smoothstep(-0.65, 1.25, depth) *
    (1.0 - smoothstep(-0.001, 0.001, merged));
  vec3 backdrop = clamp(clearTransmission, 0.0, 1.0);
  vec3 delta = (clamp(outColor.rgb, 0.0, 1.0) - backdrop) * edge;
  // Dispersion has both bright and dark fringes. Encode both signs rather than
  // clamping negative channels, which washes coloured edges out on light themes.
  vec3 coverage = max(max(delta, 0.0) / max(vec3(0.001), 1.0 - backdrop),
                      max(-delta, 0.0) / max(vec3(0.001), backdrop));
  float alpha = clamp(max(coverage.r, max(coverage.g, coverage.b)), 0.0, 1.0);
  fragColor = vec4(clamp(delta + backdrop * alpha, vec3(0.0), vec3(alpha)), alpha);
`
  )
const liveGlass: PluginThemeGlass = {
  selectors: defaultSelector.split(','),
  // Share one live normal map and blur; separate wavelengths in the compositor
  // so colours follow actual page detail. WebGL supplies reflection and glare.
  blur: 0,
  // Upstream normal magnitude is sqrt(2)*1000/resolution.y. SVG displacement
  // stores a signed half-range vector, hence twice the CSS-pixel travel scale.
  refraction: 2 * Math.SQRT2 * 1000 * STUDIO_PRESET.refDistance,
  saturation: 1,
  thickness: STUDIO_PRESET.refThickness,
  ior: STUDIO_PRESET.refFactor,
  dispersion: (STUDIO_PRESET.refDispersion * 0.02) / 0.3,
  fresnel: 0,
  highlight: 0,
  lightAngle: 225,
  shadow: 0,
  interactive: false
}
const passes: ConstructorParameters<typeof MultiPassRenderer>[1] = [
  { name: 'background', shader: { vertex, fragment: backgroundShader } },
  {
    name: 'vertical',
    shader: { vertex, fragment: pairedBlur(verticalBlur) },
    inputs: { u_prevPassTexture: 'background' }
  },
  {
    name: 'horizontal',
    shader: { vertex, fragment: pairedBlur(horizontalBlur) },
    inputs: { u_prevPassTexture: 'vertical' }
  },
  {
    name: 'main',
    shader: { vertex, fragment: edgeShader },
    inputs: { u_bg: 'background', u_blurredBg: 'horizontal' },
    outputToScreen: true
  }
]

interface Surface {
  element: HTMLElement
  canvas: HTMLCanvasElement
  renderer?: MultiPassRenderer
  gl?: WebGL2RenderingContext
  texture?: WebGLTexture
  geometry: string
  revision: number
  textureWidth?: number
  textureHeight?: number
  layoutWidth?: number
  layoutHeight?: number
  blurKey?: string
  blurX?: ReturnType<typeof studioBlurSamples>
  blurY?: ReturnType<typeof studioBlurSamples>
}
export interface GlassStudioController {
  refresh(): void
  updateGeometry(): void
  setActivity(active: boolean, reduced: boolean): void
  dispose(): void
}

/** Event-driven static glass; animated theme textures are limited to 10 fps. */
export function mountLiquidGlassStudio(options?: {
  selector?: string
  id?: string
}): GlassStudioController {
  const selector = options?.selector ?? defaultSelector
  const id = options?.id ?? 'ep-liquid-glass-studio'
  const material = { ...liveGlass, selectors: selector.split(',') }
  const disposeComponents = options?.selector ? undefined : mountGlassComponentEffects()
  // Own instance: applying a theme must not dispose this live backdrop compositor.
  const backdrop = createLiquidGlassEffect(
    options?.id ? `${id}-backdrop` : 'ep-studio-backdrop',
    false,
    {
      adaptiveQuality: false,
      // Sample the real page at each wavelength, not just the theme texture.
      // Share one normal image and one blur across the three displacements.
      chromaticTransmission: true,
      waitForImages: true,
      model: 'studio',
      reflection: false,
      blurEdge: STUDIO_PRESET.blurEdge,
      blurForSurface: (element) => {
        const authored = parseFloat(
          getComputedStyle(element).getPropertyValue('--ep-studio-blur-radius')
        )
        const radius = Number.isFinite(authored)
          ? Math.max(0, Math.min(200, authored))
          : options?.selector
            ? STUDIO_BLUR_RADIUS
            : 0
        return studioBlurSigma(radius, devicePixelRatio)
      }
    }
  )
  backdrop(material)
  const source = createGlassBackground()
  const surfaces = new Map<HTMLElement, Surface>()
  // Hovering between submenus must not repeatedly tear down GPU contexts and
  // replace their compositor mailboxes. Keep two renderers ready for reuse.
  const menuRenderers: Surface[] = []
  let disposed = false,
    active = true,
    reduced = false,
    pending = false
  let revision = 0,
    frame = 0,
    timer: ReturnType<typeof setTimeout> | undefined
  let sourceDirty = true
  let layoutDirty = false
  let gpuFailed = false
  const style = document.createElement('style')
  style.id = id
  // Electron subtracts no-drag rectangles even for pointer-events:none layers.
  // Keep Header decoration draggable; its real controls retain no-drag regions.
  style.textContent = `
    html body [data-ep-studio-surface]{isolation:isolate;background-color:color-mix(in srgb,var(--color-bg,#152236) var(--ep-studio-surface-tint,var(--ep-glass-chrome-tint,4%)),transparent)!important;background-image:none!important;border-color:var(--ep-glass-surface-border,color-mix(in srgb,var(--color-text,#fff) 8%,transparent))!important;box-shadow:var(--ep-glass-surface-shadow,${STUDIO_PRESET.shadowPosition.x}px ${STUDIO_PRESET.shadowPosition.y}px ${STUDIO_PRESET.shadowExpand}px rgb(0 0 0 / ${STUDIO_PRESET.shadowFactor}%))}
    html body [data-ep-studio-relative]{position:relative}
    html body [data-ep-studio-surface]:where(:not(.ep-backtop)){transition-property:color,background-color,border-color,box-shadow,opacity,transform,translate,scale,rotate,width,height,min-height,max-width,padding,gap,border-radius,grid-template-columns!important}
    html body .ep-studio-canvas{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;z-index:-1;pointer-events:none;border-radius:inherit}
    html body .ep-studio-canvas[hidden]{display:none!important}
    html body .ep-header > .ep-studio-canvas{-webkit-app-region:drag}
    ${options?.selector ? '' : 'html:has([data-ep-studio-surface]) .ep-overlay--blur{backdrop-filter:none!important}'}
  `
  document.head.append(style)

  function releaseGPU(surface: Surface): void {
    surface.gl?.deleteTexture(surface.texture ?? null)
    surface.renderer?.dispose()
    surface.gl?.getExtension('WEBGL_lose_context')?.loseContext()
  }
  function remove(surface: Surface, retain = true): void {
    resize.unobserve(surface.element)
    surface.canvas.remove()
    surface.element.classList.remove('ep-studio-surface', 'ep-studio-relative')
    surface.element.removeAttribute('data-ep-studio-surface')
    surface.element.removeAttribute('data-ep-studio-relative')
    if (
      retain &&
      surface.element.matches('.ep-menu') &&
      surface.renderer &&
      !surface.gl?.isContextLost()
    ) {
      surface.canvas.hidden = true
      if (menuRenderers.length === 2) releaseGPU(menuRenderers.shift()!)
      menuRenderers.push(surface)
    } else releaseGPU(surface)
    surfaces.delete(surface.element)
  }
  function discover(): void {
    for (const surface of surfaces.values()) {
      const { element, canvas, renderer } = surface
      if (!element.isConnected || !element.getClientRects().length) {
        remove(surface)
        continue
      }
      // Framework class patches must not revert the surface to the opaque
      // authored background. Restore owned hooks without invalidating textures.
      if (!element.classList.contains('ep-studio-surface'))
        element.classList.add('ep-studio-surface')
      if (
        getComputedStyle(element).position === 'static' &&
        !element.classList.contains('ep-studio-relative')
      ) {
        element.setAttribute('data-ep-studio-relative', '')
        element.classList.add('ep-studio-relative')
      }
      if (renderer && canvas.parentElement !== element) element.prepend(canvas)
    }
    // Prioritize transient panels when the page contains many hidden controls.
    const candidates = [...document.querySelectorAll<HTMLElement>(selector)].reverse()
    for (const element of candidates) {
      if (
        surfaces.has(element) ||
        element.offsetWidth < 2 ||
        element.offsetHeight < 2 ||
        !element.getClientRects().length
      )
        continue
      if (surfaces.size >= 8) break
      let retained = element.matches('.ep-menu') ? menuRenderers.pop() : undefined
      if (retained?.gl?.isContextLost()) {
        releaseGPU(retained)
        retained = undefined
      }
      const canvas = retained?.canvas ?? document.createElement('canvas')
      canvas.className = 'ep-studio-canvas'
      canvas.hidden = true
      canvas.setAttribute('aria-hidden', 'true')
      const surface: Surface = { ...retained, element, canvas, geometry: '', revision: -1 }
      if (getComputedStyle(element).position === 'static') {
        element.setAttribute('data-ep-studio-relative', '')
        element.classList.add('ep-studio-relative')
      }
      element.setAttribute('data-ep-studio-surface', '')
      element.classList.add('ep-studio-surface')
      if (!gpuFailed && !surface.renderer) {
        try {
          surface.renderer = new MultiPassRenderer(canvas, passes)
          surface.gl = canvas.getContext('webgl2')!
          surface.texture = surface.gl.createTexture()!
          const gl = surface.gl
          gl.bindTexture(gl.TEXTURE_2D, surface.texture)
          for (const axis of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T])
            gl.texParameteri(gl.TEXTURE_2D, axis, gl.CLAMP_TO_EDGE)
          for (const filter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER])
            gl.texParameteri(gl.TEXTURE_2D, filter, gl.LINEAR)
          canvas.addEventListener(
            'webglcontextlost',
            () => {
              canvas.hidden = true
            },
            { once: true }
          )
        } catch (error) {
          surface.renderer?.dispose()
          canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext()
          gpuFailed = true
          console.warn('[Liquid Glass Studio] WebGL unavailable; using transparent surface.', error)
        }
      }
      if (surface.renderer) element.prepend(canvas)
      surfaces.set(element, surface)
      resize.observe(element)
    }
  }
  function draw(surface: Surface): void {
    const { gl, renderer, canvas, element } = surface
    if (!gl || !renderer || gl.isContextLost()) return
    const rect = element.getBoundingClientRect()
    if (!element.getClientRects().length || rect.bottom <= 0 || rect.top >= innerHeight) return
    const w = element.clientWidth,
      h = element.clientHeight
    const css = getComputedStyle(element)
    const authoredBlur = parseFloat(css.getPropertyValue('--ep-studio-blur-radius'))
    const blurRadius = Number.isFinite(authoredBlur)
      ? Math.max(0, Math.min(200, Math.round(authoredBlur)))
      : STUDIO_BLUR_RADIUS
    const radius = Math.min(parseFloat(css.borderTopLeftRadius) || 0, w / 2, h / 2)
    const geometry = [
      rect.left,
      rect.top,
      rect.width,
      rect.height,
      w,
      h,
      radius,
      devicePixelRatio,
      blurRadius
    ].join(',')
    if (geometry === surface.geometry && revision === surface.revision) return
    const dpr = Math.min(devicePixelRatio, 1.25, Math.sqrt(450000 / (w * h)))
    const width = Math.max(1, Math.round(w * dpr)),
      height = Math.max(1, Math.round(h * dpr))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
      gl.viewport(0, 0, width, height)
      renderer.resize(width, height)
    }
    if (surface.revision !== revision) {
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, surface.texture!)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
      try {
        if (
          surface.textureWidth === source.canvas.width &&
          surface.textureHeight === source.canvas.height
        )
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.canvas)
        else {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source.canvas)
          surface.textureWidth = source.canvas.width
          surface.textureHeight = source.canvas.height
        }
      } catch {
        // A tainted background must not break controls or retry every frame.
        canvas.hidden = true
        surface.revision = revision
        return
      }
    }
    renderer.setUniforms({
      STEP: 9,
      u_resolution: [width, height],
      u_dpr: dpr,
      u_mouseSpring: [width / 2, height / 2],
      u_mouse: [0, 0],
      u_time: 0,
      u_shapeWidth: w,
      u_shapeHeight: h,
      u_shapeRadius: radius,
      u_shapeRoundness: 2,
      u_mergeRate: 0.001,
      u_showShape1: 0,
      u_bgType: 3,
      u_bgTextureReady: 1,
      u_bgTexture: surface.texture,
      u_bgTextureRatio: innerWidth / innerHeight,
      u_themeOrigin: [
        rect.left + element.clientLeft,
        innerHeight - rect.top - element.clientTop - h
      ],
      u_themePanelSize: [w, h],
      u_themeSize: [innerWidth, innerHeight],
      u_shadowExpand: STUDIO_PRESET.shadowExpand,
      u_shadowFactor: STUDIO_PRESET.shadowFactor / 100,
      u_shadowPosition: [-STUDIO_PRESET.shadowPosition.x, -STUDIO_PRESET.shadowPosition.y],
      u_tint: [
        STUDIO_PRESET.tint.r / 255,
        STUDIO_PRESET.tint.g / 255,
        STUDIO_PRESET.tint.b / 255,
        STUDIO_PRESET.tint.a
      ],
      u_refThickness: STUDIO_PRESET.refThickness,
      u_refDistance: STUDIO_PRESET.refDistance,
      u_refFactor: STUDIO_PRESET.refFactor,
      // The live compositor already separates RGB. Do not apply it twice.
      u_refDispersion: 0,
      u_refFresnelRange: STUDIO_PRESET.refFresnelRange,
      u_refFresnelFactor: STUDIO_PRESET.refFresnelFactor / 100,
      u_refFresnelHardness: STUDIO_PRESET.refFresnelHardness / 100,
      u_glareRange: STUDIO_PRESET.glareRange,
      u_glareFactor: STUDIO_PRESET.glareFactor / 100,
      u_glareHardness: STUDIO_PRESET.glareHardness / 100,
      u_glareConvergence: STUDIO_PRESET.glareConvergence / 100,
      u_glareOppositeFactor: STUDIO_PRESET.glareOppositeFactor / 100,
      u_glareAngle: (STUDIO_PRESET.glareAngle * Math.PI) / 180,
      u_blurEdge: Number(STUDIO_PRESET.blurEdge)
    })
    const blurKey = [width, height, w, h, devicePixelRatio, blurRadius].join(',')
    if (blurKey !== surface.blurKey) {
      surface.blurX = studioBlurSamples(width / (w * devicePixelRatio), blurRadius)
      surface.blurY = studioBlurSamples(height / (h * devicePixelRatio), blurRadius)
      surface.blurKey = blurKey
    }
    const blurUniforms = (
      samples: ReturnType<typeof studioBlurSamples>
    ): Record<string, unknown> => ({
      u_blurRadius: samples.weights.length - 1,
      u_blurWeights: samples.weights,
      u_blurOffsets: samples.offsets
    })
    renderer.render({
      vertical: blurUniforms(surface.blurX!),
      horizontal: blurUniforms(surface.blurY!)
    })
    canvas.hidden = false
    surface.geometry = geometry
    surface.layoutWidth = w
    surface.layoutHeight = h
    surface.revision = revision
  }
  async function render(): Promise<void> {
    frame = 0
    if (disposed || !active || pending) return
    pending = true
    layoutDirty = false
    try {
      discover()
      if (
        ![...surfaces.values()].some((surface) => surface.renderer && !surface.gl?.isContextLost())
      ) {
        sourceDirty = false
        source.dynamic = false
        return
      }
      if (sourceDirty) {
        sourceDirty = false
        await source.capture()
        revision++
      }
      if (!disposed && active) for (const surface of surfaces.values()) draw(surface)
    } finally {
      pending = false
      if (!disposed && active) {
        if (sourceDirty || layoutDirty) schedule()
        else if (source.dynamic && !reduced && timer === undefined)
          timer = setTimeout(() => {
            timer = undefined
            refresh()
          }, 100)
      }
    }
  }
  function schedule(): void {
    if (disposed || !active) return
    // A sandboxed dynamic background can be awaiting its frame when a popup
    // opens or resizes. Preserve that request instead of waiting for the next
    // background polling interval to discover and paint the new surface.
    if (pending) {
      layoutDirty = true
      return
    }
    if (!frame)
      frame = requestAnimationFrame(() => {
        void render()
      })
  }
  function refresh(): void {
    clearTimeout(timer)
    timer = undefined
    sourceDirty = true
    schedule()
  }
  const resize = new ResizeObserver((entries) => {
    for (const { target } of entries) {
      const surface = surfaces.get(target as HTMLElement)
      if (!surface) continue
      const { canvas, element } = surface
      const w = surface.layoutWidth,
        h = surface.layoutHeight
      const previousShortSide = w && h && Math.min(w, h)
      const shortSide = Math.min(element.clientWidth, element.clientHeight)
      if (
        previousShortSide &&
        shortSide &&
        Math.max(shortSide / previousShortSide, previousShortSide / shortSide) > 2
      ) {
        canvas.hidden = true
        // A rapid expand/collapse may return to the last drawn dimensions.
        // Still redraw once so the temporarily hidden layer becomes visible.
        surface.geometry = ''
      }
    }
    schedule()
  })
  const observer = new MutationObserver((records) => {
    let changed = false
    for (const record of records) {
      if (record.target instanceof Element && record.target.closest('.app-background-stage')) {
        refresh()
        return
      }
      if (record.type === 'attributes') {
        if (record.target === document.documentElement) {
          refresh()
          return
        }
        if (record.target instanceof Element && record.target.matches(selector)) changed = true
      } else {
        if (record.target instanceof HTMLElement) {
          const surface = surfaces.get(record.target)
          if (surface?.renderer && surface.canvas.parentElement !== record.target) changed = true
        }
        for (const node of [...record.addedNodes, ...record.removedNodes]) {
          if (!(node instanceof Element) || node.matches('.ep-studio-canvas')) continue
          if (
            node.matches('.app-background-stage') ||
            node.querySelector('.app-background-stage')
          ) {
            sourceDirty = true
          }
          if (
            node.matches(selector + ',.app-background-stage') ||
            node.querySelector(selector + ',.app-background-stage')
          )
            changed = true
        }
      }
    }
    if (changed) schedule()
  })
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'src', 'data-background-key']
  })
  const rootObserver = new MutationObserver(refresh)
  rootObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style']
  })
  window.addEventListener('resize', refresh)
  document.addEventListener('scroll', schedule, true)
  const onMediaChange = (event: Event): void => {
    // Player audio events do not alter the glass environment texture.
    if (event.target instanceof Element && event.target.closest('.app-background-stage')) refresh()
  }
  const mediaEvents = ['loadeddata', 'play', 'pause', 'seeked']
  for (const event of mediaEvents) document.addEventListener(event, onMediaChange, true)
  document.addEventListener('transitionend', schedule, true)
  document.fonts?.addEventListener('loadingdone', refresh)
  schedule()
  return {
    refresh() {
      backdrop(material)
      refresh()
    },
    updateGeometry: schedule,
    setActivity(next, reduce) {
      active = next
      reduced = reduce
      clearTimeout(timer)
      if (active) refresh()
      else {
        cancelAnimationFrame(frame)
        frame = 0
      }
    },
    dispose() {
      disposed = true
      disposeComponents?.()
      backdrop()
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      observer.disconnect()
      rootObserver.disconnect()
      resize.disconnect()
      window.removeEventListener('resize', refresh)
      document.removeEventListener('scroll', schedule, true)
      for (const event of mediaEvents) document.removeEventListener(event, onMediaChange, true)
      document.removeEventListener('transitionend', schedule, true)
      document.fonts?.removeEventListener('loadingdone', refresh)
      for (const surface of surfaces.values()) remove(surface, false)
      for (const surface of menuRenderers) releaseGPU(surface)
      menuRenderers.length = 0
      source.dispose()
      style.remove()
    }
  }
}
