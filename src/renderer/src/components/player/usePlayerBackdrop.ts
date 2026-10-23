import { computed, nextTick, ref, watch, type Ref } from 'vue'
import type { usePlayerStore } from '@/stores/player/playerStore'
import type { useUIStore } from '@/stores/ui/uiStore'
import { CoverAnalyzer } from '@/hooks/useImageColors'
import { PlayerBgType, resolvePlayerBgType } from '@/consts'
import { chooseSpectrumColor } from './spectrumColor'
const COVER_ANALYSIS_VERSION = 11

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function usePlayerBackdrop(
  player: ReturnType<typeof usePlayerStore>,
  ui: ReturnType<typeof useUIStore>,
  coverUrl: Readonly<Ref<string | null>>,
  coverFailed: Ref<boolean>,
  displayedCoverUrl: Ref<string | null>,
  rhythmAmount: Readonly<Ref<number>>,
  isPanelVisible: Readonly<Ref<boolean>>
) {
  const liquidUnavailable = ref(false)
  const coverColorSource = ref<'idle' | 'loading' | 'cache' | 'sampled' | 'failed'>('idle')
  const defaultLiquidColors = {
    primary: '77 136 220',
    secondary: '205 78 165',
    tertiary: '73 186 165'
  }
  const selectedPlayerBackground = computed(() => resolvePlayerBgType(ui.playerBgType))
  const effectivePlayerBackground = computed(() =>
    resolvePlayerBgType(selectedPlayerBackground.value, {
      coverAvailable: Boolean(coverUrl.value && !coverFailed.value),
      liquidAvailable: !liquidUnavailable.value
    })
  )
  const useAlbumArtwork = computed(() => effectivePlayerBackground.value === PlayerBgType.ALBUM)
  const useAmbientBackground = computed(
    () => effectivePlayerBackground.value === PlayerBgType.AMBIENT
  )
  const useLiquidBackground = computed(
    () => effectivePlayerBackground.value === PlayerBgType.LIQUID
  )
  const ambientIntensity = computed(() =>
    selectedPlayerBackground.value === PlayerBgType.AMBIENT ? 1 : 0.68
  )
  const liquidCoverSource = computed(() =>
    coverColorSource.value === 'failed' ? null : coverUrl.value
  )
  const backgroundSource = computed(() => {
    if (useAlbumArtwork.value && displayedCoverUrl.value && !coverFailed.value)
      return displayedCoverUrl.value
    return null
  })
  watch(selectedPlayerBackground, (background) => {
    liquidUnavailable.value = false
    if (background === PlayerBgType.LIQUID)
      coverColorSource.value = coverUrl.value ? 'loading' : 'idle'
    else coverColorSource.value = 'idle'
  })

  /**
   * colors
   */
  const initialPalette = CoverAnalyzer.getCachedPalette(
    player.currentQueueSong,
    COVER_ANALYSIS_VERSION,
    useLiquidBackground.value
  )
  const coverColors = ref(initialPalette ?? { ...defaultLiquidColors })
  const spectrumBackgroundLuminance = ref(0.1)
  const spectrumColor = computed(() =>
    chooseSpectrumColor(coverColors.value, spectrumBackgroundLuminance.value)
  )
  const paletteReady = ref(!coverUrl.value || Boolean(initialPalette))
  const useDarkLyrics = ref(false)
  const backgroundImage = ref<HTMLImageElement | null>(null)
  const analyzedBackgrounds = new WeakSet<HTMLImageElement>()
  // Cached images can load before Vue assigns the template ref.
  watch(
    backgroundImage,
    async (image) => {
      await nextTick()
      if (image && image === backgroundImage.value && image.complete && image.naturalWidth)
        analyzeCoverImage(image)
    },
    { flush: 'post' }
  )
  const lyricColorStyle = computed(() => {
    if (useDarkLyrics.value && !ui.lyricsColors.overrideAutoContrast) return undefined
    return {
      '--lrc-default': ui.lyricsColors.default,
      '--lrc-highlight': ui.lyricsColors.highlight,
      '--lrc-translate': ui.lyricsColors.translation
    }
  })
  const shouldAnimate = computed(
    () =>
      player.isPlaying &&
      isPanelVisible.value &&
      player.rhythmVisualConfig.enabled &&
      !player.rhythmVisualConfig.reducedMotion &&
      !ui.reduceMotion
  )
  const liquidEnergy = computed(() => {
    if (!player.rhythmVisualConfig.enabled) return 0
    const { rms, onsetStrength } = player.audioAnalysis
    return Math.min(1, Math.max(0, rms * 3.5, onsetStrength * 0.9, rhythmAmount.value * 0.8))
  })
  const liquidBass = computed(() =>
    player.rhythmVisualConfig.enabled
      ? Math.min(1, Math.max(0, player.audioAnalysis.lowEnergy) * 3.4)
      : 0
  )
  const liquidBeat = computed(() =>
    player.rhythmVisualConfig.enabled
      ? Math.min(
          1,
          Math.max(0, player.audioAnalysis.onsetStrength) *
            player.rhythmVisualConfig.intensity *
            4.2
        )
      : 0
  )
  const analysisPollingRate = computed(() => {
    if (!ui.showPlayer || !isPanelVisible.value) return 0
    if (ui.showPlayerSpectrum) return 20
    return shouldAnimate.value ? 12 : 0
  })
  function extractCoverColors(event: Event): void {
    const image = event.currentTarget as HTMLImageElement
    if (image) analyzeCoverImage(image)
  }
  function analyzeCoverImage(image: HTMLImageElement): void {
    const isBackground = image.classList.contains('panel-background-item') && useAlbumArtwork.value
    if (isBackground && analyzedBackgrounds.has(image)) return
    const loadedSource = image.getAttribute('src')
    if (loadedSource && loadedSource !== coverUrl.value) return
    const result = CoverAnalyzer.analyze({
      image,
      song: player.currentQueueSong,
      isPanelBackground: isBackground,
      backgroundFilter: getComputedStyle(image).filter,
      useLiquidBackground: useLiquidBackground.value,
      coverAnalysisVersion: COVER_ANALYSIS_VERSION,
      getLyricsRegion: (loadedImage) => {
        return CoverAnalyzer.getLyricsRegion(loadedImage, {
          width: window.innerWidth,
          height: window.innerHeight
        })
      },
      onCacheUpdate: (id, analysis) => {
        void window.api.database.command('updateSongCoverAnalysis', {
          id,
          analysis
        })
      }
    })
    if ((useLiquidBackground.value || useAmbientBackground.value) && result.source === 'failed') {
      resetCoverPalette('failed')
      paletteReady.value = true
      return
    }
    coverColors.value = result.palette
    paletteReady.value = true
    // Cover thumbnail load events must never overwrite background contrast.
    if (isBackground) {
      analyzedBackgrounds.add(image)
      useDarkLyrics.value = result.useDarkLyrics
      spectrumBackgroundLuminance.value =
        result.result?.averageLuminance ?? (result.useDarkLyrics ? 0.75 : 0.1)
    }
    coverColorSource.value = result.source
  }
  function resetCoverPalette(source: 'idle' | 'loading' | 'failed', preserveColors = false): void {
    if (!preserveColors) coverColors.value = { ...defaultLiquidColors }
    useDarkLyrics.value = false
    spectrumBackgroundLuminance.value = 0.1
    coverColorSource.value = source
  }
  function handleCoverError(event: Event): void {
    if ((event.currentTarget as HTMLImageElement).getAttribute('src') !== coverUrl.value) return
    coverFailed.value = true
    displayedCoverUrl.value = null
    resetCoverPalette('failed')
    paletteReady.value = true
  }
  watch(
    coverUrl,
    (url, _, onCleanup) => {
      coverFailed.value = false
      const cached = CoverAnalyzer.getCachedPalette(
        player.currentQueueSong,
        COVER_ANALYSIS_VERSION,
        useLiquidBackground.value
      )
      const preserveColors = Boolean(url && paletteReady.value)
      resetCoverPalette(url ? 'loading' : 'idle', preserveColors)
      if (cached) {
        coverColors.value = cached
        coverColorSource.value = 'cache'
      }
      paletteReady.value = !url || preserveColors || Boolean(cached)
      if (!url) {
        displayedCoverUrl.value = null
        return
      }
      const image = new Image()
      let active = true
      onCleanup(() => {
        active = false
        image.onload = null
        image.onerror = null
        image.removeAttribute('src')
      })
      image.crossOrigin = 'anonymous'
      image.onload = () => {
        void image
          .decode()
          .catch(() => {})
          .then(() => {
            if (!active) return
            // Palette extraction must not depend on a visible cover's load event.
            analyzeCoverImage(image)
            displayedCoverUrl.value = url
          })
      }
      image.onerror = () => {
        if (!active) return
        coverFailed.value = true
        displayedCoverUrl.value = null
        resetCoverPalette('failed')
      }
      image.src = url
    },
    { immediate: true }
  )
  watch(backgroundSource, (source) => {
    if (!source) {
      useDarkLyrics.value = false
      spectrumBackgroundLuminance.value = 0.1
      if (!coverUrl.value) resetCoverPalette('idle')
    }
  })
  return {
    liquidUnavailable,
    coverColorSource,
    selectedPlayerBackground,
    effectivePlayerBackground,
    useAlbumArtwork,
    useAmbientBackground,
    useLiquidBackground,
    ambientIntensity,
    liquidCoverSource,
    backgroundSource,
    coverColors,
    spectrumColor,
    paletteReady,
    useDarkLyrics,
    backgroundImage,
    lyricColorStyle,
    shouldAnimate,
    liquidEnergy,
    liquidBass,
    liquidBeat,
    analysisPollingRate,
    extractCoverColors,
    handleCoverError
  }
}
