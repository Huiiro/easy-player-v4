import type { PluginThemeGlass } from '../../../../packages/plugin-sdk/src'
import {
  buildGlassMaps,
  glassHalfVector,
  resolveGlassOptics,
  type GlassGeometry,
  type GlassMapOptions,
  type GlassOptics
} from './liquidGlassOptics'

const ns = 'http://www.w3.org/2000/svg'
const maxSurfaces = 24
const mapBudget = 1048576
let serial = 0
let acceleratedBackdrop: boolean | undefined

function supportsGlassBackdrop(): boolean {
  if (acceleratedBackdrop !== undefined) return acceleratedBackdrop
  // Electron's software compositor misaligns feImage-backed backdrop filters.
  // A temporary hardware-only context checks acceleration; no WebGL scene is rendered.
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true })
  acceleratedBackdrop = !!gl && CSS.supports('backdrop-filter', 'url("#glass")')
  gl?.getExtension('WEBGL_lose_context')?.loseContext()
  return acceleratedBackdrop
}

function svgNode<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(ns, tag)
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value))
  return node
}
function mapURL(bytes: Uint8ClampedArray, width: number, height: number): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const pixels = ctx.createImageData(width, height)
  pixels.data.set(bytes)
  ctx.putImageData(pixels, 0, 0)
  return canvas.toDataURL('image/png')
}

/** Blinn-Phong half vector in physical tangent space, independent of aspect ratio. */
function lightMatrix(angle: number): string {
  const [x, y, z] = glassHalfVector(angle)
  const row = [2 * x, 2 * y, 2 * z, 0, -(x + y + z)].join(' ')
  return `${row} ${row} ${row} 0 0 0 0 1`
}

function createFilter(
  id: string,
  geometry: GlassGeometry,
  optics: GlassOptics,
  budget: number,
  options: GlassMapOptions & { adaptiveQuality?: boolean; waitForImages?: boolean }
): {
  node: SVGFilterElement
  light?: SVGFEColorMatrixElement
  fast?: SVGFilterElement
  surface?: string
  pixels: number
  ready: Promise<boolean>
} | null {
  const maps = buildGlassMaps(geometry, optics, window.devicePixelRatio, budget, options)
  const { width, height } = geometry
  const images: Promise<boolean>[] = []
  let surface: string | undefined
  const filter = svgNode('filter', {
    id,
    filterUnits: 'objectBoundingBox',
    primitiveUnits: 'userSpaceOnUse',
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    'color-interpolation-filters': 'sRGB'
  })
  for (const [result, data] of [
    ['normal', maps.displacement],
    ['reflection', maps.reflection],
    ['surface-normal', maps.surfaceNormals],
    ['interior', maps.interior]
  ] as const) {
    if (
      !data ||
      (result === 'normal' && optics.refraction === 0) ||
      (result === 'reflection' && options.reflection === false)
    )
      continue
    const url = mapURL(data, maps.width, maps.height)
    if (!url) return null
    if (result === 'reflection' && !optics.interactive) {
      surface = url
      continue
    }
    const image = svgNode('feImage', {
      href: url,
      x: 0,
      y: 0,
      width,
      height,
      preserveAspectRatio: 'none',
      result
    })
    if (options.waitForImages) {
      // feImage in an unused <defs> filter does not reliably emit load in Chromium.
      // Decode its data URI first so a newly committed filter never samples an
      // unloaded, all-zero displacement image as a strong negative offset.
      const decoded = new Image()
      decoded.src = url
      images.push(
        decoded.decode().then(
          () => true,
          () => false
        )
      )
    }
    filter.append(image)
  }
  let backdrop = 'SourceGraphic'
  // A subpixel clear-glass blur needs one pass, not a masked five-pass blend.
  if (optics.blur > 0) {
    filter.append(
      svgNode('feGaussianBlur', {
        in: 'SourceGraphic',
        stdDeviation: optics.blur,
        edgeMode: 'duplicate',
        result: optics.blur > 1 && !options.blurEdge ? 'blurred' : 'backdrop'
      })
    )
    backdrop = 'backdrop'
  }
  if (optics.blur > 1 && !options.blurEdge) {
    filter.append(
      svgNode('feComposite', {
        in: 'blurred',
        in2: 'interior',
        operator: 'in',
        result: 'soft-centre'
      })
    )
    filter.append(
      svgNode('feComposite', {
        in: 'SourceGraphic',
        in2: 'interior',
        operator: 'out',
        result: 'sharp-edge'
      })
    )
    filter.append(
      svgNode('feComposite', {
        in: 'soft-centre',
        in2: 'sharp-edge',
        operator: 'arithmetic',
        k2: 1,
        k3: 1,
        result: 'backdrop'
      })
    )
  }
  let transmitted = backdrop
  if (optics.refraction > 0) {
    filter.append(
      svgNode('feColorMatrix', {
        in: 'normal',
        type: 'matrix',
        values: `1 0 0 0 ${-1 / 510} 0 1 0 0 ${-1 / 510} 0 0 1 0 0 0 0 0 1 0`,
        result: 'normal-centred'
      })
    )
    // Wavelength-separated sampling follows liquid-glass-studio's RGB offset model.
    const channels = optics.dispersion > 0 && options.chromaticTransmission !== false ? 3 : 1
    for (let channel = 0; channel < channels; channel++) {
      const scale =
        channels === 1
          ? optics.refraction
          : optics.refraction * (1 + (1 - channel) * optics.dispersion * 0.3)
      filter.append(
        svgNode('feDisplacementMap', {
          in: backdrop,
          in2: 'normal-centred',
          scale,
          xChannelSelector: 'R',
          yChannelSelector: 'G',
          result: channels === 1 ? 'rgb' : 'displaced-' + channel
        })
      )
      if (channels === 1) continue
      const matrix = Array.from({ length: 20 }, (_, i) =>
        Number(i === channel * 6 || i === 18)
      ).join(' ')
      filter.append(
        svgNode('feColorMatrix', {
          in: 'displaced-' + channel,
          type: 'matrix',
          values: matrix,
          result: 'channel-' + channel
        })
      )
    }
    if (channels === 3) {
      filter.append(
        svgNode('feComposite', {
          in: 'channel-0',
          in2: 'channel-1',
          operator: 'arithmetic',
          k2: 1,
          k3: 1,
          result: 'rg'
        })
      )
      filter.append(
        svgNode('feComposite', {
          in: 'rg',
          in2: 'channel-2',
          operator: 'arithmetic',
          k2: 1,
          k3: 1,
          result: 'rgb'
        })
      )
    }
    transmitted = 'rgb'
  }
  if (optics.saturation !== 1) {
    filter.append(
      svgNode('feColorMatrix', {
        in: transmitted,
        type: 'saturate',
        values: optics.saturation,
        result: 'transmitted'
      })
    )
    transmitted = 'transmitted'
  }
  if (optics.interactive)
    filter.append(
      svgNode('feComposite', {
        in: 'reflection',
        in2: transmitted,
        operator: 'over',
        result: 'fresnel'
      })
    )
  if (!optics.interactive) {
    if (transmitted === 'SourceGraphic')
      filter.append(svgNode('feColorMatrix', { in: 'SourceGraphic', type: 'saturate', values: 1 }))
    let fast: SVGFilterElement | undefined
    if (options.adaptiveQuality !== false && optics.refraction > 0 && optics.dispersion > 0) {
      fast = svgNode('filter', {
        id: id + '-fast',
        filterUnits: 'objectBoundingBox',
        primitiveUnits: 'userSpaceOnUse',
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        'color-interpolation-filters': 'sRGB'
      })
      for (const child of filter.children)
        if (
          (child.tagName === 'feImage' &&
            ['normal'].includes(child.getAttribute('result') ?? '')) ||
          child.getAttribute('result') === 'normal-centred'
        )
          fast.append(child.cloneNode(true))
      let input = 'SourceGraphic'
      if (optics.blur > 1) {
        fast.append(
          svgNode('feGaussianBlur', {
            in: input,
            stdDeviation: optics.blur,
            result: 'fast-backdrop'
          })
        )
        input = 'fast-backdrop'
      }
      fast.append(
        svgNode('feDisplacementMap', {
          in: input,
          in2: 'normal-centred',
          scale: optics.refraction,
          xChannelSelector: 'R',
          yChannelSelector: 'G',
          result: 'fast-refraction'
        })
      )
    }
    return {
      node: filter,
      fast,
      surface,
      pixels: maps.width * maps.height,
      ready: Promise.all(images).then((values) => values.every(Boolean))
    }
  }
  const light = svgNode('feColorMatrix', {
    in: 'surface-normal',
    type: 'matrix',
    values: lightMatrix(optics.lightAngle),
    result: 'normal-dot-half'
  })
  filter.append(light)
  const specular = svgNode('feComponentTransfer', { in: 'normal-dot-half', result: 'specular' })
  for (const tag of ['feFuncR', 'feFuncG', 'feFuncB'] as const)
    specular.append(
      svgNode(tag, { type: 'gamma', amplitude: optics.highlight, exponent: 96, offset: 0 })
    )
  filter.append(specular)
  filter.append(
    svgNode('feComposite', {
      in: 'specular',
      in2: 'interior',
      operator: 'out',
      result: 'edge-glare'
    })
  )
  filter.append(svgNode('feBlend', { in: 'edge-glare', in2: 'fresnel', mode: 'screen' }))
  return {
    node: filter,
    light,
    pixels: maps.width * maps.height,
    ready: Promise.all(images).then((values) => values.every(Boolean))
  }
}

function geometryOf(element: HTMLElement): GlassGeometry | null {
  const style = getComputedStyle(element)
  // Local layout pixels remain stable during dialog scale transitions.
  const width = element.offsetWidth
  const height = element.offsetHeight
  if (!width || !height || style.display === 'none' || style.visibility === 'hidden') return null
  const radius = (value: string): number =>
    Math.min(
      width / 2,
      height / 2,
      value.includes('%')
        ? (parseFloat(value) / 100) * Math.min(width, height)
        : parseFloat(value) || 0
    )
  return {
    width,
    height,
    radii: [
      style.borderTopLeftRadius,
      style.borderTopRightRadius,
      style.borderBottomRightRadius,
      style.borderBottomLeftRadius
    ].map(radius) as GlassGeometry['radii']
  }
}
interface Surface {
  element: HTMLElement
  className: string
  id: string
  signature: string
  blur: number
  filter?: SVGFilterElement
  fast?: SVGFilterElement
  surface?: string
  background?: {
    image: string
    size: string
    position: string
    repeat: string
    origin: string
    clip: string
  }
  light?: SVGFEColorMatrixElement
  pixels: number
  committedPixels?: number
  generation?: number
  pending?: NonNullable<ReturnType<typeof createFilter>>
}

/** Geometry-only maps; backdrop pixels remain in Chromium's live compositor.
 * No screenshots, HTML serialization, plugin code or idle animation loop.
 */
export function createLiquidGlassEffect(
  prefix = 'ep-theme-glass',
  surfaceReflection = true,
  options: GlassMapOptions & {
    adaptiveQuality?: boolean
    blurForSurface?: (element: HTMLElement) => number
    waitForImages?: boolean
  } = {}
): (glass?: PluginThemeGlass) => void {
  let activeKey = ''
  let dispose: (() => void) | undefined
  let refreshActive: (() => void) | undefined
  return function applyGlass(glass?: PluginThemeGlass): void {
    const key = glass ? JSON.stringify(glass) : ''
    if (key === activeKey) {
      refreshActive?.()
      return
    }
    dispose?.()
    activeKey = key
    dispose = undefined
    refreshActive = undefined
    if (!glass) return
    const optics = resolveGlassOptics(glass)
    const surfaceAttribute = `data-${prefix}-surface`
    const surfaces = new Map<HTMLElement, Surface>()
    const svg = svgNode('svg', { id: prefix + '-svg', width: 0, height: 0, 'aria-hidden': 'true' })
    svg.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;overflow:hidden'
    const defs = svgNode('defs', {})
    svg.append(defs)
    document.body.append(svg)
    const style = document.createElement('style')
    style.id = prefix + '-style'
    document.head.insertBefore(style, document.getElementById('ep-custom-theme'))
    const fallback = `blur(${optics.blur}px) saturate(${optics.saturation})`
    const baseCSS = `${glass.selectors.join(',')}{backdrop-filter:${fallback};box-shadow:0 2px 6px rgb(0 5 18 / ${optics.shadow * 0.4}),0 16px 40px rgb(0 5 18 / ${optics.shadow}),inset 0 1px 0 rgb(255 255 255 / ${optics.highlight * 0.1})}`
    style.textContent = baseCSS
    let frame = 0
    let disposed = false
    let pointer: { x: number; y: number; target: Element | null } | undefined
    let geometryDirty = true
    let backgroundDirty = false
    let interactionTimer: ReturnType<typeof setTimeout> | undefined
    const busyAttribute = prefix === 'ep-theme-glass' ? 'data-ep-glass-busy' : `data-${prefix}-busy`
    const onInteraction = (): void => {
      if (disposed || document.hidden) return
      if (!document.documentElement.hasAttribute(busyAttribute))
        document.documentElement.setAttribute(busyAttribute, '')
      clearTimeout(interactionTimer)
      interactionTimer = setTimeout(() => {
        document.documentElement.removeAttribute(busyAttribute)
        interactionTimer = undefined
      }, 180)
    }
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const removeSurface = (surface: Surface): void => {
      resize.unobserve(surface.element)
      surface.element.classList.remove(surface.className)
      if (surface.element.getAttribute(surfaceAttribute) === surface.id)
        surface.element.removeAttribute(surfaceAttribute)
      surface.filter?.remove()
      surface.fast?.remove()
      surface.pending?.node.remove()
      surface.pending?.fast?.remove()
      surfaces.delete(surface.element)
    }
    const writeCSS = (): void => {
      const nextCSS =
        baseCSS +
        [...surfaces.values()]
          .filter((surface) => surface.filter || surface.surface || options.blurForSurface)
          .map(
            (surface) =>
              `${`[${surfaceAttribute}="${surface.id}"]`.repeat(3)}{backdrop-filter:${surface.filter ? `url("#${surface.filter.id}")` : `blur(${surface.blur}px) saturate(${optics.saturation})`};` +
              (surface.surface && surface.background
                ? `background-image:url("${surface.surface}"),${surface.background.image};background-size:100% 100%,${surface.background.size};background-position:center,${surface.background.position};background-repeat:no-repeat,${surface.background.repeat};background-origin:border-box,${surface.background.origin};background-clip:border-box,${surface.background.clip}`
                : '') +
              '}' +
              (surface.fast && options.adaptiveQuality !== false
                ? `html[${busyAttribute}] ${`[${surfaceAttribute}="${surface.id}"]`.repeat(3)}{backdrop-filter:url("#${surface.fast.id}")}`
                : '')
          )
          .join('')
      if (style.textContent !== nextCSS) style.textContent = nextCSS
    }
    const refresh = (): void => {
      let budget = mapBudget
      const selected = new Set<HTMLElement>()
      for (const element of document.querySelectorAll<HTMLElement>(glass.selectors.join(','))) {
        if (!(element instanceof HTMLElement) || element.closest('svg')) continue
        const geometry = geometryOf(element)
        if (!geometry) continue
        const blur = options.blurForSurface?.(element) ?? optics.blur
        const localOptics = blur === optics.blur ? optics : { ...optics, blur }
        selected.add(element)
        let surface = surfaces.get(element)
        if (!surface) {
          const id = prefix + '-' + ++serial
          surface = { element, id, className: id, signature: '', pixels: 0, blur }
          const background = getComputedStyle(element)
          surface.background = {
            image: background.backgroundImage,
            size: background.backgroundSize,
            position: background.backgroundPosition,
            repeat: background.backgroundRepeat,
            origin: background.backgroundOrigin,
            clip: background.backgroundClip
          }
          surfaces.set(element, surface)
          element.setAttribute(surfaceAttribute, id)
          element.classList.add(surface.className)
          resize.observe(element)
        } else if (backgroundDirty) {
          element.classList.remove(surface.className)
          // Read authored paint without our own reflection layer. The stable
          // selector now lives on an attribute rather than the debug class.
          element.removeAttribute(surfaceAttribute)
          const background = getComputedStyle(element)
          surface.background = {
            image: background.backgroundImage,
            size: background.backgroundSize,
            position: background.backgroundPosition,
            repeat: background.backgroundRepeat,
            origin: background.backgroundOrigin,
            clip: background.backgroundClip
          }
          element.setAttribute(surfaceAttribute, surface.id)
          element.classList.add(surface.className)
        }
        // Vue may replace the complete class attribute when a panel switches
        // layout. Restore our hook even when its geometry/filter is cached.
        if (!element.classList.contains(surface.className)) element.classList.add(surface.className)
        surface.blur = blur
        const signature = JSON.stringify([
          geometry,
          window.devicePixelRatio,
          Math.min(budget, 262144),
          blur
        ])
        if (surface.signature !== signature) {
          surface.pending?.node.remove()
          surface.pending?.fast?.remove()
          surface.pending = undefined
          surface.pixels = surface.committedPixels ?? 0
          if (!options.waitForImages || budget < 1024 || surface.pixels > budget) {
            surface.filter?.remove()
            surface.fast?.remove()
            surface.filter = undefined
            surface.light = undefined
            surface.fast = undefined
            surface.surface = undefined
            surface.committedPixels = 0
            surface.pixels = 0
          } else if (surface.filter) {
            // Keep a decoded map covering the whole box while its replacement
            // loads. Uncovered feImage pixels are zero, a large negative offset.
            for (const image of surface.filter.querySelectorAll('feImage')) {
              image.setAttribute('width', String(geometry.width))
              image.setAttribute('height', String(geometry.height))
            }
          }
          const retainedPixels = surface.pixels
          surface.signature = signature
          if (budget >= 1024) {
            try {
              const accelerated = supportsGlassBackdrop()
              const built = accelerated
                ? createFilter(
                    options.waitForImages
                      ? `${surface.id}-g${(surface.generation = (surface.generation ?? 0) + 1)}`
                      : surface.id,
                    geometry,
                    localOptics,
                    budget,
                    options
                  )
                : null
              if (built) {
                // Until decoding completes, the old filter is still resident.
                // Charge the larger reservation so later surfaces cannot spend it.
                surface.pixels = Math.max(retainedPixels, built.pixels)
                const commit = (): void => {
                  surface.filter?.remove()
                  surface.fast?.remove()
                  surface.filter = built.node
                  surface.light = built.light
                  surface.fast = built.fast
                  surface.surface = surfaceReflection ? built.surface : undefined
                  surface.pixels = surface.committedPixels = built.pixels
                }
                if (options.waitForImages) {
                  surface.pending = built
                  void built.ready.then((ready) => {
                    if (disposed || surfaces.get(element) !== surface || surface.pending !== built)
                      return
                    surface.pending = undefined
                    if (ready) commit()
                    else {
                      built.node.remove()
                      built.fast?.remove()
                      surface.pixels = retainedPixels
                    }
                    writeCSS()
                    // Reuse space released by a shrinking map without waiting
                    // for another user action or unrelated layout mutation.
                    if (surface.pixels < Math.max(retainedPixels, built.pixels)) schedule(true)
                  })
                } else commit()
                defs.append(built.node)
                if (built.fast) defs.append(built.fast)
              } else if (!accelerated && !optics.interactive && surfaceReflection) {
                const maps = buildGlassMaps(geometry, localOptics, window.devicePixelRatio, budget)
                surface.surface = mapURL(maps.reflection, maps.width, maps.height) ?? undefined
                surface.pixels = surface.committedPixels = maps.width * maps.height
              }
            } catch (error) {
              console.warn('[Theme] Glass uses CSS fallback', error)
            }
          }
        }
        budget -= surface.pixels
        if (selected.size === maxSurfaces) break
      }
      for (const [element, surface] of surfaces) if (!selected.has(element)) removeSurface(surface)
      backgroundDirty = false
      writeCSS()
    }
    const updateLight = (): void => {
      if (!optics.interactive) return
      const interactive =
        optics.interactive &&
        !motion.matches &&
        !document.documentElement.classList.contains('reduce-motion')
      for (const surface of surfaces.values()) {
        let angle = optics.lightAngle
        if (pointer && interactive) {
          const rect = surface.element.getBoundingClientRect()
          if (
            pointer.target &&
            surface.element.contains(pointer.target) &&
            pointer.x >= rect.left &&
            pointer.x <= rect.right &&
            pointer.y >= rect.top &&
            pointer.y <= rect.bottom
          ) {
            // Optional local response, never a global 360-degree light source.
            const localX = (pointer.x - rect.left) / rect.width - 0.5
            const localY = (pointer.y - rect.top) / rect.height - 0.5
            angle += (localX - localY) * 12
          }
        }
        const matrix = lightMatrix(angle)
        if (surface.light && surface.light.getAttribute('values') !== matrix)
          surface.light.setAttribute('values', matrix)
      }
    }
    const schedule = (geometry: boolean): void => {
      geometryDirty ||= geometry
      if (disposed || frame || document.hidden) return
      frame = requestAnimationFrame(() => {
        frame = 0
        if (disposed || document.hidden) return
        if (geometryDirty) {
          geometryDirty = false
          refresh()
        }
        updateLight()
      })
    }
    const resize = new ResizeObserver(() => schedule(true))
    const selectors = glass.selectors.join(',')
    const selectorClasses = new Set(
      glass.selectors.flatMap((selector) => selector.match(/ep-[a-z][a-z0-9-]*/g) ?? [])
    )
    const containsSurface = (node: HTMLElement): boolean =>
      [...surfaces.keys()].some((element) => node === element || node.contains(element))
    const addsSurface = (node: Node): boolean =>
      node instanceof HTMLElement && (node.matches(selectors) || !!node.querySelector(selectors))
    const mutations = new MutationObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === document.documentElement) {
          schedule(entry.attributeName === 'style')
          continue
        }
        if (entry.type === 'attributes') {
          if (!(entry.target instanceof HTMLElement)) continue
          const target = entry.target
          if (containsSurface(target) || addsSurface(target)) {
            schedule(true)
            return
          }
          if (
            entry.attributeName === 'class' &&
            `${entry.oldValue ?? ''} ${target.className}`
              .split(/\s+/)
              .some((name) => selectorClasses.has(name))
          ) {
            schedule(true)
            return
          }
        } else if (
          [...entry.addedNodes].some(addsSurface) ||
          [...entry.removedNodes].some(
            (node) => node instanceof HTMLElement && containsSurface(node)
          )
        ) {
          schedule(true)
          return
        }
      }
    })
    mutations.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ['class', 'hidden', 'style', 'disabled']
    })
    mutations.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style']
    })
    const onPointer = (event: PointerEvent): void => {
      if (
        !optics.interactive ||
        motion.matches ||
        document.documentElement.classList.contains('reduce-motion')
      )
        return
      pointer = {
        x: event.clientX,
        y: event.clientY,
        target: event.target instanceof Element ? event.target : null
      }
      schedule(false)
    }
    const resetPointer = (): void => {
      pointer = undefined
      schedule(false)
    }
    const onLayout = (): void => schedule(true)
    const dynamicSelectors = glass.selectors.some((selector) => selector.includes(':'))
    const stateEvents = ['pointerover', 'pointerout', 'focusin', 'focusout'] as const
    if (dynamicSelectors)
      for (const event of stateEvents) document.addEventListener(event, onLayout)
    const onVisibility = (): void => {
      if (document.hidden) {
        cancelAnimationFrame(frame)
        frame = 0
      } else schedule(true)
    }
    const interactionEvents = [
      'scroll',
      'wheel',
      'pointerdown',
      'keydown',
      'input',
      'touchmove'
    ] as const
    for (const event of interactionEvents)
      if (options.adaptiveQuality !== false)
        document.addEventListener(event, onInteraction, { capture: true, passive: true })
    const onDrag = (event: PointerEvent): void => {
      if (event.buttons) onInteraction()
    }
    if (options.adaptiveQuality !== false)
      document.addEventListener('pointermove', onDrag, { passive: true })
    if (optics.interactive) {
      document.addEventListener('pointermove', onPointer, { passive: true })
      document.addEventListener('pointerleave', resetPointer)
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', resetPointer)
    window.addEventListener('resize', onLayout)
    motion.addEventListener('change', onLayout)
    refreshActive = (): void => {
      backgroundDirty = true
      schedule(true)
    }
    dispose = (): void => {
      disposed = true
      clearTimeout(interactionTimer)
      document.documentElement.removeAttribute(busyAttribute)
      cancelAnimationFrame(frame)
      mutations.disconnect()
      resize.disconnect()
      for (const surface of [...surfaces.values()]) removeSurface(surface)
      svg.remove()
      style.remove()
      document.removeEventListener('pointermove', onPointer)
      document.removeEventListener('pointerleave', resetPointer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', resetPointer)
      window.removeEventListener('resize', onLayout)
      motion.removeEventListener('change', onLayout)
      for (const event of interactionEvents)
        document.removeEventListener(event, onInteraction, true)
      document.removeEventListener('pointermove', onDrag)
      if (dynamicSelectors)
        for (const event of stateEvents) document.removeEventListener(event, onLayout)
    }
    schedule(true)
  }
}

export const applyLiquidGlass = createLiquidGlassEffect()
