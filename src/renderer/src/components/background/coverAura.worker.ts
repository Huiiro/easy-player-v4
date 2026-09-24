interface AuraRequest {
  id: number
  width: number
  height: number
  scale: number
  primary: string
  secondary: string
  shape: 'rounded' | 'circle'
}

function parseColor(value: string): [number, number, number] {
  const parts = value.split(/\s+/).map(Number)
  return parts.length === 3 ? [parts[0], parts[1], parts[2]] : [110, 160, 220]
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<AuraRequest>) => void) | null
  postMessage: (message: unknown, transfer: Transferable[]) => void
}

workerScope.onmessage = (event: MessageEvent<AuraRequest>): void => {
  const { id, width, height, scale, primary, secondary, shape } = event.data
  const buffer = new ArrayBuffer(width * height * 4)
  const pixels = new Uint8ClampedArray(buffer)
  const first = parseColor(primary)
  const second = parseColor(secondary)
  const color = first.map((channel, index) => Math.round((channel + second[index]) / 2))
  const cssWidth = width / scale
  const cssHeight = height / scale
  const margin = 96
  const glowWidth = 32
  const halfWidth = Math.max(0, cssWidth / 2 - margin)
  const halfHeight = Math.max(0, cssHeight / 2 - margin)
  const radius = Math.min(32, halfWidth / 4, halfHeight / 4)

  for (let y = 0; y < height; y += 1) {
    const centerY = (y + 0.5) / scale - cssHeight / 2
    const distanceY = Math.abs(centerY) - (halfHeight - radius)
    for (let x = 0; x < width; x += 1) {
      const centerX = (x + 0.5) / scale - cssWidth / 2
      const distanceX = Math.abs(centerX) - (halfWidth - radius)
      const distance =
        shape === 'circle'
          ? Math.max(0, Math.hypot(centerX, centerY) - Math.min(halfWidth, halfHeight))
          : Math.max(
              0,
              Math.hypot(Math.max(distanceX, 0), Math.max(distanceY, 0)) +
                Math.min(Math.max(distanceX, distanceY), 0) -
                radius
            )
      if (distance > margin) continue
      const glow = 145 * Math.exp(-0.5 * (distance / glowWidth) ** 2)
      let hash = Math.imul(x ^ (y * 374761393), 668265263)
      hash = Math.imul(hash ^ (hash >>> 13), 1274126177)
      const dither = (((hash ^ (hash >>> 16)) & 255) / 255 - 0.5) * 3
      const offset = (y * width + x) * 4
      pixels[offset] = color[0]
      pixels[offset + 1] = color[1]
      pixels[offset + 2] = color[2]
      pixels[offset + 3] = Math.max(0, Math.min(255, Math.round(glow + dither)))
    }
  }

  workerScope.postMessage({ id, width, height, buffer }, [buffer])
}
