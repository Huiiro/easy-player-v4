import { computed, ref, watch, type Ref } from 'vue'
import type { usePlayerStore } from '@/stores/player/playerStore'
import type { useUIStore } from '@/stores/ui/uiStore'
import { CoverAnalyzer } from '@/hooks/useImageColors'
import { PlayerBgType, resolvePlayerBgType } from '@/constants'
import { chooseSpectrumColor } from './spectrumColor'
const COVER_ANALYSIS_VERSION = 11

function fullCoverUrl(source: string): string {
  return source.replace('://cover-thumb?', '://cover?')
}

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
  const meshUnavailable = ref(false)
  const particlesUnavailable = ref(false)
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
      liquidAvailable: !liquidUnavailable.value,
      meshAvailable: !meshUnavailable.value,
      particlesAvailable: !particlesUnavailable.value
    })
  )
  const useAlbumArtwork = computed(() => effectivePlayerBackground.value === PlayerBgType.ALBUM)
  const useAmbientBackground = computed(
    () => effectivePlayerBackground.value === PlayerBgType.AMBIENT
  )
  const useLiquidBackground = computed(
    () => effectivePlayerBackground.value === PlayerBgType.LIQUID
  )
  const useCheerBackground = computed(() => effectivePlayerBackground.value === PlayerBgType.CHEER)
  // The persisted album cache only contains two colors. These backgrounds use all three.
  const useVibrantPalette = computed(() => useLiquidBackground.value || useAmbientBackground.value)
  const ambientIntensity = computed(() =>
    selectedPlayerBackground.value === PlayerBgType.AMBIENT ? 1 : 0.68
  )
  const liquidCoverSource = computed(() =>
    coverFailed.value || coverColorSource.value === 'failed' ? null : displayedCoverUrl.value
  )
  const useMeshBackground = computed(() => effectivePlayerBackground.value === PlayerBgType.MESH)
  const useParticleBackground = computed(
    () => effectivePlayerBackground.value === PlayerBgType.PARTICLES
  )
  const backgroundSource = computed(() => {
    if (useAlbumArtwork.value && displayedCoverUrl.value && !coverFailed.value)
      return fullCoverUrl(displayedCoverUrl.value)
    return null
  })
  watch(selectedPlayerBackground, (background) => {
    liquidUnavailable.value = false
    meshUnavailable.value = false
    particlesUnavailable.value = false
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
    useVibrantPalette.value
  )
  const coverColors = ref(initialPalette ?? { ...defaultLiquidColors })
  const spectrumBackgroundLuminance = ref(0.1)
  const spectrumColor = computed(() =>
    chooseSpectrumColor(coverColors.value, spectrumBackgroundLuminance.value)
  )
  const paletteReady = ref(!coverUrl.value || Boolean(initialPalette))
  const useDarkLyrics = ref(false)
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
  const stageLightingActive = computed(
    () => ui.showPlayer && !ui.extremePlayback && useCheerBackground.value && shouldAnimate.value
  )
  const analysisNeedsSpectrum = computed(() => ui.showPlayerSpectrum || stageLightingActive.value)
  const analysisPollingRate = computed(() => {
    if (!ui.showPlayer || !isPanelVisible.value) return 0
    if (analysisNeedsSpectrum.value) return 20
    return shouldAnimate.value ? 12 : 0
  })
  function extractCoverColors(image: HTMLImageElement): void {
    analyzeCoverImage(image, true)
  }
  function matchesCurrentCover(source: string | null): boolean {
    const current = coverUrl.value
    return Boolean(current && (source === current || source === fullCoverUrl(current)))
  }
  function analyzeCoverImage(image: HTMLImageElement, isBackground = false): void {
    const loadedSource = image.getAttribute('src')
    if (loadedSource && !matchesCurrentCover(loadedSource)) return
    const result = CoverAnalyzer.analyze({
      image,
      song: player.currentQueueSong,
      isPanelBackground: isBackground,
      backgroundFilter: isBackground ? getComputedStyle(image).filter : undefined,
      useLiquidBackground: useVibrantPalette.value,
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
    if (useVibrantPalette.value && result.source === 'failed') {
      resetCoverPalette('failed')
      paletteReady.value = true
      return
    }
    coverColors.value = result.palette
    paletteReady.value = true
    // Cover thumbnail load events must never overwrite background contrast.
    if (isBackground) {
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
    if (!matchesCurrentCover((event.currentTarget as HTMLImageElement).getAttribute('src'))) return
    coverFailed.value = true
    displayedCoverUrl.value = null
    resetCoverPalette('failed')
    paletteReady.value = true
  }
  let decodedCover: HTMLImageElement | null = null
  watch(useVibrantPalette, () => {
    if (decodedCover?.getAttribute('src') === coverUrl.value) analyzeCoverImage(decodedCover)
  })
  watch(
    coverUrl,
    (url, _, onCleanup) => {
      coverFailed.value = false
      const cached = CoverAnalyzer.getCachedPalette(
        player.currentQueueSong,
        COVER_ANALYSIS_VERSION,
        useVibrantPalette.value
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
      const releaseImage = (): void => {
        if (decodedCover === image) decodedCover = null
        image.onload = image.onerror = null
        image.removeAttribute('src')
      }
      onCleanup(() => {
        active = false
        releaseImage()
      })
      image.crossOrigin = 'anonymous'
      image.onload = () => {
        image.onload = image.onerror = null
        void image
          .decode()
          .catch(() => {})
          .then(() => {
            if (!active) return
            // Keep only the current decode for palette changes and release it on track change.
            decodedCover = image
            analyzeCoverImage(image)
            displayedCoverUrl.value = url
          })
      }
      image.onerror = () => {
        if (!active) return
        coverFailed.value = true
        displayedCoverUrl.value = null
        resetCoverPalette('failed')
        paletteReady.value = true
        releaseImage()
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
    meshUnavailable,
    particlesUnavailable,
    coverColorSource,
    selectedPlayerBackground,
    effectivePlayerBackground,
    useAmbientBackground,
    useLiquidBackground,
    useMeshBackground,
    useParticleBackground,
    useCheerBackground,
    ambientIntensity,
    liquidCoverSource,
    backgroundSource,
    coverColors,
    spectrumColor,
    paletteReady,
    useDarkLyrics,
    lyricColorStyle,
    shouldAnimate,
    liquidEnergy,
    liquidBass,
    liquidBeat,
    stageLightingActive,
    analysisNeedsSpectrum,
    analysisPollingRate,
    extractCoverColors,
    handleCoverError
  }
}
