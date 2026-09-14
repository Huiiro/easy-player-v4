interface Palette {
  primary: string
  secondary: string
  tertiary: string
}

interface RgbColor {
  red: number
  green: number
  blue: number
}

interface CachedAnalysis {
  primary: string
  secondary: string
  lyricsDark: number
}

interface LyricsAnalysis {
  averageLuminance: number
  brightRatio: number
  nearWhite: number
  lowContrastRisk: number
  useDarkText: boolean
}

interface AnalysisResult {
  palette: Palette
  useDarkLyrics: boolean
  source: 'cache' | 'sampled' | 'failed'
  result?: LyricsAnalysis
}

interface AnalyzeOptions {
  image: HTMLImageElement
  song?: {
    id: string
    cover: string
    coverAnalysisPath?: string
    coverAnalysisVersion?: number
    coverPrimary?: string
    coverSecondary?: string
    coverLyricsDark?: number | null
  }
  isPanelBackground: boolean
  useLiquidBackground: boolean
  coverAnalysisVersion: number
  getLyricsRegion: (image: HTMLImageElement) => [number, number, number, number] | null
  onCacheUpdate?: (
    songId: string,
    analysis: {
      path: string
      primary: string
      secondary: string
      lyricsDark: boolean
      version: number
    }
  ) => void
}

export class CoverAnalyzer {
  private static readonly SAMPLE_SIZE = 32

  /**
   * entry - 分析封面颜色
   * @returns 调色板、歌词暗色模式判断、数据来源
   */
  static analyze(options: AnalyzeOptions): AnalysisResult {
    const {
      image,
      song,
      isPanelBackground,
      useLiquidBackground,
      coverAnalysisVersion,
      getLyricsRegion,
      onCacheUpdate
    } = options

    if (!image.naturalWidth || !image.naturalHeight) {
      return this.fallbackResult()
    }

    const cached = this.getCachedAnalysis(song, coverAnalysisVersion, isPanelBackground)
    if (cached) {
      return {
        palette: this.createPalette(cached.primary, cached.secondary),
        useDarkLyrics: cached.lyricsDark === 1,
        source: 'cache'
      }
    }

    try {
      const pixelData = this.sampleImageData(image)
      const palette = this.extractVibrantColors(pixelData, this.SAMPLE_SIZE, useLiquidBackground)

      let useDarkLyrics = false
      let result: LyricsAnalysis = null
      if (isPanelBackground) {
        const region = getLyricsRegion(image)
        if (region) {
          const analysis = this.analyzeRegion(image, region)
          result = analysis
          useDarkLyrics = analysis.useDarkText
        }
      } else if (useLiquidBackground) {
        const analysis = this.analyzeLiquid(pixelData)
        result = analysis
        useDarkLyrics = analysis.useDarkText
      }

      if (isPanelBackground && song?.cover && onCacheUpdate) {
        onCacheUpdate(song.id, {
          path: song.cover,
          primary: palette.primary,
          secondary: palette.secondary,
          lyricsDark: useDarkLyrics,
          version: coverAnalysisVersion
        })
      }

      return {
        palette,
        useDarkLyrics,
        source: 'sampled',
        result: result
      }
    } catch {
      return this.fallbackResult()
    }
  }

  /**
   * 从缓存中获取分析结果
   */
  private static getCachedAnalysis(
    song: AnalyzeOptions['song'],
    version: number,
    isPanelBackground: boolean
  ): CachedAnalysis | null {
    if (!isPanelBackground || !song) return null

    const isValid =
      song.coverAnalysisPath === song.cover &&
      song.coverAnalysisVersion === version &&
      song.coverPrimary &&
      song.coverSecondary &&
      song.coverLyricsDark !== null &&
      song.coverLyricsDark !== undefined

    if (!isValid) return null

    return {
      primary: song.coverPrimary!,
      secondary: song.coverSecondary!,
      lyricsDark: song.coverLyricsDark!
    }
  }

  /**
   * 从图像采样像素数据
   */
  private static sampleImageData(image: HTMLImageElement): Uint8ClampedArray {
    const canvas = document.createElement('canvas')
    const size = this.SAMPLE_SIZE
    canvas.width = size
    canvas.height = size

    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) {
      throw new Error('Failed to get canvas context')
    }

    ctx.drawImage(image, 0, 0, size, size)
    return ctx.getImageData(0, 0, size, size).data
  }

  /**
   * 分析指定区域的歌词对比度
   */
  private static analyzeRegion(
    image: HTMLImageElement,
    region: [number, number, number, number]
  ): LyricsAnalysis {
    const canvas = document.createElement('canvas')
    const size = this.SAMPLE_SIZE
    canvas.width = size
    canvas.height = size

    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) {
      throw new Error('Failed to get canvas context')
    }

    ctx.drawImage(image, ...region, 0, 0, size, size)
    const data = ctx.getImageData(0, 0, size, size).data
    return this.analyzeLyricsContrast(data)
  }

  /**
   * 分析液态背景对比度
   */
  private static analyzeLiquid(pixelData: Uint8ClampedArray): LyricsAnalysis {
    return this.analyzeLyricsContrast(pixelData, true)
  }

  /**
   * 提取鲜明颜色
   */
  private static extractVibrantColors(
    data: Uint8ClampedArray,
    size = this.SAMPLE_SIZE,
    preserveVibrancy = false
  ): Palette {
    const fallbackPrimary = this.averageColor(data, 0, size / 2, size)
    const fallbackSecondary = this.averageColor(data, size / 2, size, size)
    const swatches = new Map<string, { red: number; green: number; blue: number; weight: number }>()
    for (let index = 0; index < data.length; index += 4) {
      const red = data[index]
      const green = data[index + 1]
      const blue = data[index + 2]
      const alpha = data[index + 3] / 255
      const maximum = Math.max(red, green, blue)
      const minimum = Math.min(red, green, blue)
      if (alpha < 0.75 || maximum < 30) continue
      const saturation = maximum - minimum
      const key = `${Math.floor(red / 32)}-${Math.floor(green / 32)}-${Math.floor(blue / 32)}`
      const swatch = swatches.get(key) ?? { red: 0, green: 0, blue: 0, weight: 0 }
      const weight = preserveVibrancy
        ? 0.42 + (saturation / 255) * 1.05 + (maximum / 255) * 0.22
        : 0.18 + (saturation / 255) * 1.8 + (maximum / 255) * 0.25
      swatch.red += red * weight
      swatch.green += green * weight
      swatch.blue += blue * weight
      swatch.weight += weight
      swatches.set(key, swatch)
    }
    const candidates: RgbColor[] = [...swatches.values()]
      .sort((left, right) => right.weight - left.weight)
      .map((swatch) => ({
        red: Math.round(swatch.red / swatch.weight),
        green: Math.round(swatch.green / swatch.weight),
        blue: Math.round(swatch.blue / swatch.weight)
      }))
    const chosen = candidates.reduce<typeof candidates>((selected, candidate) => {
      if (
        selected.length < 3 &&
        selected.every(
          (existing) =>
            Math.hypot(
              candidate.red - existing.red,
              candidate.green - existing.green,
              candidate.blue - existing.blue
            ) > 58
        )
      )
        selected.push(candidate)
      return selected
    }, [])
    const primary = preserveVibrancy ? chosen[0] : this.smartSoftenColor(chosen[0])
    if (!primary) return this.createPalette(fallbackPrimary, fallbackSecondary)
    const secondary = preserveVibrancy ? chosen[1] : this.smartSoftenColor(chosen[1])
    // console.log(`primary ${JSON.stringify(chosen[0])} : ${JSON.stringify(primary)}`)
    // console.log(`secondary ${JSON.stringify(chosen[1])} : ${JSON.stringify(secondary)}`)
    const palette = this.createPalette(
      `${primary.red} ${primary.green} ${primary.blue}`,
      secondary ? `${secondary.red} ${secondary.green} ${secondary.blue}` : fallbackSecondary
    )
    const tertiary = preserveVibrancy ? chosen[2] : this.smartSoftenColor(chosen[2])
    return tertiary
      ? { ...palette, tertiary: `${tertiary.red} ${tertiary.green} ${tertiary.blue}` }
      : palette
  }

  /**
   * 自动柔化颜色
   */
  private static smartSoftenColor(color: RgbColor): RgbColor {
    const r = color.red
    const g = color.green
    const b = color.blue
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const saturation = max === 0 ? 0 : (max - min) / max
    const lightness = (max + min) / (2 * 255)
    const chroma = max - min
    const shouldSoften = this.shouldSoftenColor(saturation, lightness, chroma, r, g, b)
    if (!shouldSoften) {
      return color
    }
    const intensity = this.calculateSoftenIntensity(saturation, lightness, chroma)
    return this.applySoften(r, g, b, intensity)
  }

  /**
   * 判断颜色是否需要柔化
   * condition1: 饱和度 > 0.45
   * condition2: 亮度在中等偏上
   * condition3: 色度 > 60
   * condition4: 排除纯色倾向太强的颜色
   * condition5: 高饱和度+高亮度
   * condition6: 色相在特定范围（红/橙/紫/品红）更容易刺眼
   */
  private static shouldSoftenColor(
    saturation: number,
    lightness: number,
    chroma: number,
    r: number,
    g: number,
    b: number
  ): boolean {
    if (saturation < 0.45) return false
    if (lightness < 0.25 || lightness > 0.85) return false
    if (chroma < 60) return false
    const maxChannel = Math.max(r, g, b)
    const minChannel = Math.min(r, g, b)
    if (maxChannel - minChannel > 150) {
      const ratios = [r, g, b].map((v) => v / maxChannel)
      const dominant = ratios.filter((v) => v > 0.8).length
      if (dominant >= 1) return true
    }
    if (saturation > 0.7 && lightness > 0.6) return true
    const hue = this.rgbToHue(r, g, b)
    const harshHues = [hue > 340 || hue < 20, hue > 10 && hue < 45, hue > 290 && hue < 340]
    return harshHues.some((v) => v) && saturation > 0.5 && lightness > 0.4
  }

  /**
   * 计算柔化强度 (0.2 ~ 0.7)
   */
  private static calculateSoftenIntensity(
    saturation: number,
    lightness: number,
    chroma: number
  ): number {
    let intensity = 0.3 // 基础强度
    if (saturation > 0.7) intensity += 0.25
    else if (saturation > 0.6) intensity += 0.15
    if (lightness > 0.4 && lightness < 0.6) intensity += 0.1
    if (chroma > 150) intensity += 0.1
    return Math.max(0.2, Math.min(0.7, intensity))
  }

  /**
   * 应用柔化（向灰色靠拢 + 轻微去饱和）
   */
  private static applySoften(r: number, g: number, b: number, intensity: number): RgbColor {
    const [h, s, l] = this.rgbToHsl(r, g, b)
    const newS = s * (1 - intensity * 0.7)
    let newL = l
    if (l > 0.8) newL = 0.8 - (l - 0.8) * intensity * 0.5
    if (l < 0.2) newL = 0.2 + (0.2 - l) * intensity * 0.5
    const [nr, ng, nb] = this.hslToRgb(h, newS, newL)
    return {
      red: Math.round(nr),
      green: Math.round(ng),
      blue: Math.round(nb)
    }
  }

  /**
   * 分析歌词对比度
   */
  private static analyzeLyricsContrast(
    data: Uint8ClampedArray,
    liquidBackground?: boolean
  ): LyricsAnalysis {
    let visible = 0
    let luminanceSum = 0
    let bright = 0
    let nearWhite = 0
    let lowContrastRisk = 0

    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3] / 255
      if (!alpha) continue

      const red = data[index]
      const green = data[index + 1]
      const blue = data[index + 2]
      // Relative luminance and chroma are both normalized to 0–1. Use sRGB
      // luminance here because this is a perceptual UI contrast heuristic.
      const luminance = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255
      const chroma = (Math.max(red, green, blue) - Math.min(red, green, blue)) / 255

      visible += alpha
      luminanceSum += luminance * alpha
      if (luminance >= 0.72) bright += alpha
      if (luminance >= 0.9 && chroma <= 0.16) nearWhite += alpha
      if (luminance >= 0.82 && chroma <= 0.5) lowContrastRisk += alpha
    }

    const averageLuminance = visible ? luminanceSum / visible : 0
    const brightRatio = visible ? bright / visible : 0
    const nearWhiteRatio = visible ? nearWhite / visible : 0
    const lowContrastRiskRatio = visible ? lowContrastRisk / visible : 0
    const useDarkText = liquidBackground
      ? (averageLuminance >= 0.79 && brightRatio >= 0.65) ||
        nearWhiteRatio >= 0.55 ||
        (averageLuminance >= 0.75 && lowContrastRiskRatio >= 0.72)
      : (averageLuminance >= 0.74 && brightRatio >= 0.56) ||
        nearWhiteRatio >= 0.42 ||
        (averageLuminance >= 0.68 && lowContrastRiskRatio >= 0.62)
    return {
      averageLuminance,
      brightRatio,
      nearWhite: nearWhiteRatio,
      lowContrastRisk: lowContrastRiskRatio,
      useDarkText
    }
  }

  /**
   * 创建调色板
   */
  private static createPalette(primary: string, secondary: string): Palette {
    const [red, green, blue] = secondary.split(/\s+/).map(Number)
    const [hue, saturation, lightness] = this.rgbToHsl(red, green, blue)
    const tertiary = this.hslToRgb(
      (hue + (hue < 0.5 ? 0.085 : -0.085) + 1) % 1,
      Math.min(0.82, saturation * 0.9 + 0.08),
      Math.max(0.22, Math.min(0.76, lightness))
    ).join(' ')
    return {
      primary,
      secondary,
      tertiary
    }
  }

  /**
   * 平均取色
   */
  private static averageColor(
    data: Uint8ClampedArray,
    startX: number,
    endX: number,
    width: number
  ): string {
    let red = 0
    let green = 0
    let blue = 0
    let count = 0
    for (let y = 0; y < width; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        const offset = (y * width + x) * 4
        const alpha = data[offset + 3] / 255
        red += data[offset] * alpha
        green += data[offset + 1] * alpha
        blue += data[offset + 2] * alpha
        count += alpha
      }
    }
    if (!count) return '77 136 220'
    return `${Math.round(red / count)} ${Math.round(green / count)} ${Math.round(blue / count)}`
  }

  /**
   * 回退结果
   */
  private static fallbackResult(): AnalysisResult {
    return {
      palette: {
        primary: '102 102 102',
        secondary: '136 136 136',
        tertiary: '112 126 151'
      },
      useDarkLyrics: false,
      source: 'failed'
    }
  }

  /**
   * RGB转色相 (0-360)
   */
  private static rgbToHue(r: number, g: number, b: number): number {
    const rf = r / 255,
      gf = g / 255,
      bf = b / 255
    const max = Math.max(rf, gf, bf),
      min = Math.min(rf, gf, bf)
    const d = max - min
    if (d === 0) return 0
    let hue = 0
    if (max === rf) hue = ((gf - bf) / d + (gf < bf ? 6 : 0)) / 6
    else if (max === gf) hue = ((bf - rf) / d + 2) / 6
    else hue = ((rf - gf) / d + 4) / 6
    return hue * 360
  }

  /**
   * RGB转HSL (复用之前的实现)
   */
  private static rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    const rf = r / 255,
      gf = g / 255,
      bf = b / 255
    const max = Math.max(rf, gf, bf),
      min = Math.min(rf, gf, bf)
    let h = 0,
      s = 0
    const l = (max + min) / 2

    if (max !== min) {
      const d = max - min
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
      if (max === rf) h = ((gf - bf) / d + (gf < bf ? 6 : 0)) / 6
      else if (max === gf) h = ((bf - rf) / d + 2) / 6
      else h = ((rf - gf) / d + 4) / 6
    }
    return [h, s, l]
  }

  /**
   * HSL转RGB (复用之前的实现)
   */
  private static hslToRgb(h: number, s: number, l: number): [number, number, number] {
    if (s === 0) {
      const v = Math.round(l * 255)
      return [v, v, v]
    }
    const hue2rgb = (p: number, q: number, t: number): number => {
      if (t < 0) t += 1
      if (t > 1) t -= 1
      if (t < 1 / 6) return p + (q - p) * 6 * t
      if (t < 1 / 2) return q
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
      return p
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    return [
      Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
      Math.round(hue2rgb(p, q, h) * 255),
      Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
    ]
  }
}
