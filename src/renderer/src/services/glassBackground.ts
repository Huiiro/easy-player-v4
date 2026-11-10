/** Theme paint only: never rasterize application controls or cross an iframe boundary. */
function parts(value: string): string[] {
  const result: string[] = []
  let depth = 0
  let start = 0
  let quote = ''
  for (let i = 0; i < value.length; i++) {
    const c = value[i]
    if (quote) {
      if (c === quote && value[i - 1] !== '\\') quote = ''
    } else if (c === '"' || c === "'") quote = c
    else if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ',' && depth === 0) {
      result.push(value.slice(start, i).trim())
      start = i + 1
    }
  }
  result.push(value.slice(start).trim())
  return result
}

function stops(gradient: CanvasGradient, values: string[], length: number): void {
  const parsed = values.map((value) => {
    const match = value.match(/^(.*?)\s+(-?[\d.]+)(%|px)$/)
    return {
      color: match?.[1] ?? value,
      at: match ? +match[2] / (match[3] === '%' ? 100 : length) : undefined
    }
  })
  if (!parsed.length) return
  parsed[0].at ??= 0
  parsed[parsed.length - 1].at ??= 1
  for (let i = 1; i < parsed.length - 1; i++) {
    if (parsed[i].at !== undefined) continue
    let end = i + 1
    while (parsed[end].at === undefined) end++
    const from = parsed[i - 1].at!
    for (let j = i; j < end; j++)
      parsed[j].at = from + ((parsed[end].at! - from) * (j - i + 1)) / (end - i + 1)
    i = end - 1
  }
  let previous = 0
  for (const stop of parsed) {
    previous = Math.max(previous, Math.min(1, Math.max(0, stop.at ?? 0)))
    gradient.addColorStop(previous, stop.color)
  }
}

function paintGradient(ctx: CanvasRenderingContext2D, value: string, w: number, h: number): void {
  const match = value.match(/^(linear|radial)-gradient\((.*)\)$/)
  if (!match) return
  const values = parts(match[2])
  ctx.save()
  let gradient: CanvasGradient
  let length: number
  if (match[1] === 'linear') {
    const direction = values[0]
    let angle = Math.PI
    if (/^[\d.-]+deg$/.test(direction)) {
      angle = (parseFloat(values.shift()!) * Math.PI) / 180
    } else if (direction.startsWith('to ')) {
      values.shift()
      const x = direction.includes('right') ? 1 : direction.includes('left') ? -1 : 0
      const y = direction.includes('bottom') ? 1 : direction.includes('top') ? -1 : 0
      angle = Math.atan2(x, -y)
    }
    const dx = Math.sin(angle),
      dy = -Math.cos(angle)
    length = Math.abs(w * dx) + Math.abs(h * dy)
    gradient = ctx.createLinearGradient(
      w / 2 - (dx * length) / 2,
      h / 2 - (dy * length) / 2,
      w / 2 + (dx * length) / 2,
      h / 2 + (dy * length) / 2
    )
  } else {
    let x = w / 2,
      y = h / 2
    const config = values[0]
    if (/^(ellipse|circle|at |closest-|farthest-)/.test(config)) {
      values.shift()
      const position = config.match(/at\s+([\d.]+)%\s+([\d.]+)%/)
      if (position) {
        x = (w * +position[1]) / 100
        y = (h * +position[2]) / 100
      }
    }
    const circle = config.startsWith('circle')
    const rx = Math.max(x, w - x) * (circle ? 1 : Math.SQRT2)
    const ry = circle ? rx : Math.max(y, h - y) * Math.SQRT2
    length = rx
    ctx.translate(x, y)
    ctx.scale(rx, ry)
    gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
  }
  try {
    stops(gradient, values, length)
    ctx.fillStyle = gradient
    if (match[1] === 'radial') ctx.fillRect(-2, -2, 4, 4)
    else ctx.fillRect(0, 0, w, h)
  } finally {
    ctx.restore()
  }
}

export interface GlassBackground {
  canvas: HTMLCanvasElement
  dynamic: boolean
  capture(): Promise<void>
  dispose(): void
}

function sandboxFrame(frame: HTMLIFrameElement): Promise<ImageBitmap | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timeout = setTimeout(() => finish(null), 250)
    function finish(value: ImageBitmap | null): void {
      clearTimeout(timeout)
      channel.port1.close()
      resolve(value)
    }
    channel.port1.onmessage = (event) => {
      const bitmap = event.data
      if (bitmap instanceof ImageBitmap && bitmap.width <= 1280 && bitmap.height <= 900)
        finish(bitmap)
      else {
        if (bitmap instanceof ImageBitmap) bitmap.close()
        finish(null)
      }
    }
    frame.contentWindow?.postMessage({ channel: 'easy-player-theme', type: 'glass-frame' }, '*', [
      channel.port2
    ])
  })
}

export function createGlassBackground(): GlassBackground {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const images = new Map<string, Promise<HTMLImageElement | null>>()
  const loading = new Set<HTMLImageElement>()
  let disposed = false
  const state: GlassBackground = {
    canvas,
    dynamic: false,
    capture,
    dispose: () => {
      disposed = true
      for (const img of loading) img.removeAttribute('src')
      loading.clear()
      images.clear()
      canvas.width = canvas.height = 1
    }
  }

  function image(url: string): Promise<HTMLImageElement | null> {
    if (!images.has(url)) {
      const img = new Image()
      loading.add(img)
      img.crossOrigin = 'anonymous'
      img.src = url
      images.set(
        url,
        img
          .decode()
          .then(
            () => img,
            () => null
          )
          .finally(() => loading.delete(img))
      )
      // Bound retained media when browsing many backgrounds.
      if (images.size > 8) images.delete(images.keys().next().value!)
    }
    return images.get(url)!
  }
  function cover(source: CanvasImageSource, sw: number, sh: number, rect: DOMRect): void {
    if (!sw || !sh) return
    const scale = Math.max(rect.width / sw, rect.height / sh)
    ctx.drawImage(
      source,
      rect.left + (rect.width - sw * scale) / 2,
      rect.top + (rect.height - sh * scale) / 2,
      sw * scale,
      sh * scale
    )
  }
  async function paint(element: HTMLElement): Promise<void> {
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    ctx.save()
    ctx.translate(rect.left, rect.top)
    ctx.fillStyle = style.backgroundColor
    ctx.fillRect(0, 0, rect.width, rect.height)
    for (const layer of parts(style.backgroundImage).reverse()) {
      if (layer.startsWith('url(')) {
        const img = await image(layer.slice(4, -1).replace(/^['"]|['"]$/g, ''))
        if (disposed) break
        if (img)
          cover(
            img,
            img.naturalWidth,
            img.naturalHeight,
            new DOMRect(0, 0, rect.width, rect.height)
          )
      } else {
        try {
          paintGradient(ctx, layer, rect.width, rect.height)
        } catch {
          /* Keep the declared theme base for unsupported paint. */
        }
      }
    }
    ctx.restore()
  }
  async function capture(): Promise<void> {
    const scale = Math.min(1, 1280 / innerWidth, 900 / innerHeight)
    const w = Math.max(1, Math.round(innerWidth * scale)),
      h = Math.max(1, Math.round(innerHeight * scale))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    ctx.globalAlpha = 1
    ctx.filter = 'none'
    ctx.fillStyle =
      getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim() || '#141820'
    ctx.fillRect(0, 0, innerWidth, innerHeight)
    const stages = [...document.querySelectorAll<HTMLElement>('.app-background-stage')]
    const stage = stages
      .sort((a, b) => +getComputedStyle(a).opacity - +getComputedStyle(b).opacity)
      .at(-1)
    state.dynamic = false
    if (!stage) return
    await paint(stage)
    for (const element of stage.querySelectorAll<HTMLElement>(
      '.ep-app-background, .background-image'
    )) {
      ctx.filter = getComputedStyle(element).filter
      await paint(element)
      ctx.filter = 'none'
    }
    const video = stage.querySelector<HTMLVideoElement>('video')
    const frame = stage.querySelector<HTMLIFrameElement>('.sandboxed-theme-background iframe.ready')
    if (frame) {
      // A busy, loading or timed-out frame is still an animated source. Keep
      // the controller's bounded polling alive so a later frame can recover.
      state.dynamic = true
      const bitmap = await sandboxFrame(frame)
      if (bitmap) {
        if (!disposed) cover(bitmap, bitmap.width, bitmap.height, frame.getBoundingClientRect())
        bitmap.close()
      }
    }
    const sceneCanvas = stage.querySelector<HTMLCanvasElement>('canvas')
    const media = video && video.readyState >= 2 ? video : sceneCanvas
    if (media) {
      const rect = media.getBoundingClientRect()
      ctx.filter = getComputedStyle(video?.parentElement ?? media).filter
      try {
        cover(
          media,
          video ? video.videoWidth : sceneCanvas!.width,
          video ? video.videoHeight : sceneCanvas!.height,
          rect
        )
      } catch {
        /* Cross-origin media keeps its theme's declared background. */
      }
      ctx.filter = 'none'
      state.dynamic ||= video ? !video.paused && !video.ended : true
    }
    const scrim = stage.querySelector<HTMLElement>('.app-background-scrim')
    if (scrim) await paint(scrim)
  }
  return state
}
