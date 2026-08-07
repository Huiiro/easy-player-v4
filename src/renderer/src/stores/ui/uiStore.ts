import { defineStore } from 'pinia'
import { computed, reactive, ref, watch } from 'vue'
import { PlayerBgType, PlayerDisplayMode, TagStyle } from '@/consts'
import type { LyricSource } from '@/services/lyrics'
import { hasPersistedStore, playerDataStorage } from '@/stores/persistence'
import {
  getSystemBackgroundTheme,
  isSystemBackground,
  type SystemBackground
} from '@/components/background/systemBackgroundRegistry'

export type { SystemBackground } from '@/components/background/systemBackgroundRegistry'

export const useUIStore = defineStore(
  'ui',
  () => {
    const themeSettingsKey = 'ui.theme-settings'
    const persistedSettingsKey = 'ui.preferences.v1'
    // ========== 基础设置 ==========
    const locale = ref<'zh' | 'en'>('zh')
    const platform = ref<'win' | 'macOS' | 'linux'>('win')
    const logoText = ref('Easy Player')
    const userName = ref('Easy Player')
    const itemOrder = ref<'asc' | 'desc'>('desc')
    // ========== UI设置 ==========
    // The player is dark by default; custom backgrounds inherit this mode for contrast.
    const useDarkMode = ref(true)
    const useCardView = ref(false)
    const useCustomBg = ref(false)
    const useDynamicBg = ref(false)
    const reduceMotion = ref(false)
    const useLocalFileName = ref(false)
    const useFullProgress = ref(false)
    const autoPlayOnRestore = ref(false)
    const closeToTray = ref(false)
    const autoStart = ref(false)
    const showWelcomeText = ref(true)
    const customFontFamily = ref('')
    const customFonts = ref<Array<{ family: string; file: string; url: string }>>([])
    const loadedCustomFontUrls = new Set<string>()
    const customThemeColor = ref('oklch(0.691 0.198 148.262)')
    const systemBackground = ref<SystemBackground>('none')
    const customBg = reactive({
      url: '',
      path: '',
      blur: 0,
      brightness: 100,
      headerBackground: '#0f1724cc',
      footerBackground: '#101827d9',
      chromeBorder: '#ffffff30'
    })
    const currentDynamicBg = reactive({
      bg: 'static_light',
      footer: '',
      dark: false
    })
    // ========== 歌词设置 ==========
    const lyricsAlignment = ref<'left' | 'center' | 'right'>('center')
    const lyricSourceMode = ref<'auto' | LyricSource>('auto')
    const autoSearchNetworkLyrics = ref(true)
    const lyricsFontSize = ref(2.4)
    const lyricsFontPadding = ref(30)
    const lyricsOffsetMs = ref(0)
    const lyricsStyle = ref<'none' | 'glow' | 'follow'>('none')
    const lyricsColors = reactive({
      default: '#AEB4C0',
      highlight: '#FFFFFF',
      translation: '#D9DDE4',
      overrideAutoContrast: false
    })
    const lyricsFontSizeIndex = ref(1)
    const showLyricsSizeSlider = ref(false)
    const showLyricsEditor = ref(false)
    const showLyricsTranslation = ref(false)
    const autoLyricsFontResizer = ref(true)
    const lyricSourceOrder = ref<LyricSource[]>(['embedded', 'database', 'local', 'network'])
    // ========== 播放器设置 ==========
    const playerBgType = ref(PlayerBgType.ALBUM)
    const playerDisplayMode = ref(PlayerDisplayMode.Normal)
    const allowSwitchCoverStyle = ref(true)
    const isCircularCover = ref(false)
    const isCoverSpin = ref(true)
    const showLyricsSettings = ref(false)
    const showDisplaySettings = ref(false)
    const showPlayerSpectrum = ref(false)
    const showPlayer = ref(false)
    const footerOpenMode = ref<'all' | 'cover'>('all')
    // ========== 标签与来源 ==========
    const tagStyle = ref(TagStyle.Full)
    const tagSelected = ref<number[]>([])
    const musicSource = ref<'all' | 'local' | 'remote'>('all')
    const musicSourceId = ref(0)
    // ========== 桌面歌词 ==========
    const useDesktopLyrics = ref(false)
    const desktopLyricsStyles = reactive({
      fontSize: 34,
      activeColor: '#ffffff',
      inactiveColor: 'rgba(255, 255, 255, 0.58)',
      fontBold: true,
      glow: true,
      showTranslation: true,
      autoHideBackground: true,
      fontFamily: ''
    })
    // ========== 快捷键 ==========
    const useGlobalShortcutKeys = ref(false)
    const shortcutKeys = reactive({
      previous: 'ctrl+left',
      toggle: 'space',
      next: 'ctrl+right',
      volumeUp: 'ctrl+up',
      volumeDown: 'ctrl+down'
    })
    const globalShortcutKeys = reactive({
      previous: '',
      toggle: '',
      next: '',
      volumeUp: '',
      volumeDown: ''
    })
    const fontStack = computed(() =>
      customFontFamily.value
        ? `"${customFontFamily.value}", Inter, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif`
        : 'inherit'
    )
    const getCustomFontStyle = computed(() => ({ fontFamily: fontStack.value }))
    const getBackgroundStyle = computed(() => {
      const brightness = customBg.brightness / 100
      const blur = customBg.blur ?? 0
      return {
        backgroundImage: customBg.url ? `url(${customBg.url})` : 'none',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        filter: `brightness(${brightness}) blur(${blur}px)`,
        transition: 'filter 0.3s ease'
      }
    })
    const hasBackground = computed(() => useCustomBg.value || systemBackground.value !== 'none')
    function toggleCardStyle(): void {
      useCardView.value = !useCardView.value
    }
    function setCardStyle(v: boolean): void {
      useCardView.value = v
    }

    function applyTheme(): void {
      const root = document.documentElement
      root.classList.toggle('dark', useDarkMode.value)
      root.classList.toggle('reduce-motion', reduceMotion.value)
      root.style.colorScheme = useDarkMode.value ? 'dark' : 'light'
      if (customThemeColor.value) root.style.setProperty('--color-primary', customThemeColor.value)
      else root.style.removeProperty('--color-primary')
      root.style.setProperty('--lrc-size', `${lyricsFontSize.value}rem`)
      root.style.setProperty('--lrc-padding', `${lyricsFontPadding.value}px`)
      root.style.fontFamily = customFontFamily.value ? fontStack.value : ''
    }
    function syncSystemBackgroundThemeColor(): void {
      const theme = getSystemBackgroundTheme(useCustomBg.value ? 'none' : systemBackground.value)
      if (!useCustomBg.value) customThemeColor.value = theme.accentColor
      if (!useCustomBg.value && systemBackground.value !== 'none') {
        useDarkMode.value = theme.colorMode === 'dark'
      }
      const root = document.documentElement
      root.dataset.systemTheme = useCustomBg.value ? 'custom' : systemBackground.value
      root.style.setProperty(
        '--app-header-bg',
        useCustomBg.value ? customBg.headerBackground : theme.headerBackground
      )
      root.style.setProperty(
        '--app-footer-bg',
        useCustomBg.value ? customBg.footerBackground : theme.footerBackground
      )
      root.style.setProperty(
        '--app-chrome-border',
        useCustomBg.value ? customBg.chromeBorder : theme.chromeBorder
      )
      if (useCustomBg.value) {
        root.style.setProperty('--color-border', customBg.chromeBorder)
        root.style.setProperty(
          '--color-border-l',
          `color-mix(in srgb, ${customBg.chromeBorder} 68%, white)`
        )
      } else {
        root.style.removeProperty('--color-border')
        root.style.removeProperty('--color-border-l')
      }
    }

    async function loadCustomFonts(): Promise<void> {
      try {
        const response = await window.api.fonts.list()
        const fonts = response.success && Array.isArray(response.data) ? response.data : []
        customFonts.value = fonts
        const legacyFamily = customFontFamily.value.replace(
          /^EasyPlayerFont-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}-/i,
          'EasyPlayerFont-'
        )
        if (
          legacyFamily !== customFontFamily.value &&
          fonts.some((font) => font.family === legacyFamily)
        )
          customFontFamily.value = legacyFamily
        if (
          customFontFamily.value.startsWith('EasyPlayerFont-') &&
          !fonts.some((font) => font.family === customFontFamily.value)
        ) {
          customFontFamily.value = ''
        }
        await Promise.all(
          fonts.map(async (font) => {
            if (loadedCustomFontUrls.has(font.url)) return
            const face = new FontFace(font.family, `url("${font.url}")`)
            document.fonts.add(await face.load())
            loadedCustomFontUrls.add(font.url)
          })
        )
      } catch {
        customFonts.value = []
      }
    }

    async function initializeTheme(): Promise<void> {
      await loadCustomFonts()
      // New installations are hydrated synchronously by the Pinia persistence
      // plugin. Keep this one-time reader solely for migration from the former
      // partial theme snapshot.
      if (hasPersistedStore(persistedSettingsKey)) {
        syncSystemBackgroundThemeColor()
        applyTheme()
        return
      }
      let saved: Record<string, unknown> = {}
      let migratedLegacyTheme = false
      try {
        const response = window.api.database.getSync(themeSettingsKey)
        if (response.success && response.data && typeof response.data === 'object') {
          saved = response.data as Record<string, unknown>
        } else {
          const legacy = localStorage.getItem('easy-player.theme-settings')
          if (legacy) {
            const parsed = JSON.parse(legacy)
            if (parsed && typeof parsed === 'object') saved = parsed as Record<string, unknown>
            migratedLegacyTheme = true
          }
        }
      } catch {
        // Invalid persisted preferences should not prevent the app from starting.
      }
      if (typeof saved.useDarkMode === 'boolean') useDarkMode.value = saved.useDarkMode
      if (typeof saved.customThemeColor === 'string')
        customThemeColor.value = saved.customThemeColor
      if (typeof saved.useCustomBg === 'boolean') useCustomBg.value = saved.useCustomBg
      if (typeof saved.reduceMotion === 'boolean') reduceMotion.value = saved.reduceMotion
      if (isSystemBackground(saved.systemBackground)) {
        systemBackground.value = saved.systemBackground as SystemBackground
      }
      if (typeof saved.autoPlayOnRestore === 'boolean')
        autoPlayOnRestore.value = saved.autoPlayOnRestore
      if (Object.values(PlayerBgType).includes(saved.playerBgType as PlayerBgType))
        playerBgType.value = saved.playerBgType as PlayerBgType
      if (
        ['auto', 'embedded', 'database', 'local', 'network'].includes(
          saved.lyricSourceMode as string
        )
      ) {
        lyricSourceMode.value = saved.lyricSourceMode as 'auto' | LyricSource
      }
      if (Array.isArray(saved.lyricSourceOrder)) {
        const allowed: LyricSource[] = ['embedded', 'database', 'local', 'network']
        const order = saved.lyricSourceOrder.filter((item): item is LyricSource =>
          allowed.includes(item as LyricSource)
        )
        if (order.length) lyricSourceOrder.value = order
      }
      if (saved.customBg && typeof saved.customBg === 'object') {
        const background = saved.customBg as Record<string, unknown>
        customBg.url = typeof background.url === 'string' ? background.url : ''
        customBg.path = typeof background.path === 'string' ? background.path : ''
        customBg.blur = Number(background.blur) || 0
        customBg.brightness = Number(background.brightness) || 100
        customBg.headerBackground =
          typeof background.headerBackground === 'string'
            ? background.headerBackground
            : customBg.headerBackground
        customBg.footerBackground =
          typeof background.footerBackground === 'string'
            ? background.footerBackground
            : customBg.footerBackground
        customBg.chromeBorder =
          typeof background.chromeBorder === 'string'
            ? background.chromeBorder
            : customBg.chromeBorder
      }
      syncSystemBackgroundThemeColor()
      applyTheme()
      if (migratedLegacyTheme) localStorage.removeItem('easy-player.theme-settings')
    }

    function setTheme(mode: 'light' | 'dark'): void {
      useDarkMode.value = mode === 'dark'
    }

    function resetTheme(): void {
      useDarkMode.value = true
      customThemeColor.value = ''
      useCustomBg.value = false
      systemBackground.value = 'none'
      playerBgType.value = PlayerBgType.ALBUM
      Object.assign(customBg, {
        url: '',
        path: '',
        blur: 0,
        brightness: 100,
        headerBackground: '#0f1724cc',
        footerBackground: '#101827d9',
        chromeBorder: '#ffffff30'
      })
    }
    function setLyricsFontSize(size?: number): void {
      if (size) lyricsFontSize.value = size
      const root = document.documentElement
      root.style.setProperty('--lrc-size', lyricsFontSize.value + 'rem')
    }
    function setLyricsFontPadding(padding?: number): void {
      if (padding) lyricsFontPadding.value = padding
      const root = document.documentElement
      root.style.setProperty('--lrc-padding', lyricsFontPadding.value + 'px')
    }
    function setLyricsOffset(offsetMs: number): void {
      lyricsOffsetMs.value = Math.max(-5000, Math.min(5000, Math.round(offsetMs / 100) * 100))
    }
    function resetLyricsOffset(): void {
      lyricsOffsetMs.value = 0
    }
    function resetLyricsColors(): void {
      Object.assign(lyricsColors, {
        default: '#AEB4C0',
        highlight: '#FFFFFF',
        translation: '#D9DDE4',
        overrideAutoContrast: false
      })
    }
    function handleClickStyle(): void {
      if (lyricsStyle.value === 'none') {
        lyricsStyle.value = 'glow'
      } else if (lyricsStyle.value === 'glow') {
        lyricsStyle.value = 'follow'
      } else {
        lyricsStyle.value = 'none'
      }
    }
    function toggleTranslation(): void {
      showLyricsTranslation.value = !showLyricsTranslation.value
    }
    watch(
      [
        useDarkMode,
        customFontFamily,
        customThemeColor,
        useCustomBg,
        reduceMotion,
        () => customBg.url,
        () => customBg.blur,
        () => customBg.brightness,
        () => customBg.headerBackground,
        () => customBg.footerBackground,
        () => customBg.chromeBorder,
        lyricsFontSize,
        lyricsFontPadding
      ],
      applyTheme
    )
    watch(
      [
        systemBackground,
        useCustomBg,
        () => customBg.headerBackground,
        () => customBg.footerBackground,
        () => customBg.chromeBorder
      ],
      syncSystemBackgroundThemeColor
    )
    return {
      locale,
      platform,
      logoText,
      userName,
      itemOrder,
      useDarkMode,
      useCardView,
      useCustomBg,
      autoPlayOnRestore,
      closeToTray,
      autoStart,
      useDynamicBg,
      useLocalFileName,
      useFullProgress,
      showWelcomeText,
      customFontFamily,
      customFonts,
      customThemeColor,
      systemBackground,
      customBg,
      currentDynamicBg,
      lyricsAlignment,
      lyricSourceMode,
      autoSearchNetworkLyrics,
      lyricsFontSize,
      lyricsFontPadding,
      lyricsOffsetMs,
      lyricsStyle,
      lyricsColors,
      lyricsFontSizeIndex,
      showLyricsSizeSlider,
      showLyricsEditor,
      showLyricsTranslation,
      autoLyricsFontResizer,
      lyricSourceOrder,
      playerBgType,
      playerDisplayMode,
      allowSwitchCoverStyle,
      isCircularCover,
      isCoverSpin,
      showLyricsSettings,
      showDisplaySettings,
      showPlayerSpectrum,
      showPlayer,
      footerOpenMode,
      tagStyle,
      tagSelected,
      musicSource,
      musicSourceId,
      useDesktopLyrics,
      desktopLyricsStyles,
      useGlobalShortcutKeys,
      shortcutKeys,
      globalShortcutKeys,
      getCustomFontStyle,
      hasBackground,
      getBackgroundStyle,
      initializeTheme,
      loadCustomFonts,
      setTheme,
      resetTheme,
      toggleCardStyle,
      setCardStyle,
      setLyricsFontSize,
      setLyricsFontPadding,
      setLyricsOffset,
      resetLyricsOffset,
      resetLyricsColors,
      handleClickStyle,
      toggleTranslation
    }
  },
  {
    persist: {
      key: 'ui.preferences.v1',
      storage: playerDataStorage,
      pick: [
        'locale',
        'logoText',
        'userName',
        'itemOrder',
        'useDarkMode',
        'useCardView',
        'useCustomBg',
        'reduceMotion',
        'useDynamicBg',
        'useLocalFileName',
        'useFullProgress',
        'autoPlayOnRestore',
        'closeToTray',
        'autoStart',
        'showWelcomeText',
        'customFontFamily',
        'customThemeColor',
        'systemBackground',
        'customBg',
        'currentDynamicBg',
        'lyricsAlignment',
        'lyricSourceMode',
        'autoSearchNetworkLyrics',
        'lyricsFontSize',
        'lyricsFontPadding',
        'lyricsOffsetMs',
        'lyricsStyle',
        'lyricsColors',
        'lyricsFontSizeIndex',
        'showLyricsTranslation',
        'autoLyricsFontResizer',
        'lyricSourceOrder',
        'playerBgType',
        'playerDisplayMode',
        'showPlayerSpectrum',
        'footerOpenMode',
        'allowSwitchCoverStyle',
        'isCircularCover',
        'isCoverSpin',
        'tagStyle',
        'musicSource',
        'musicSourceId',
        'useDesktopLyrics',
        'desktopLyricsStyles',
        'useGlobalShortcutKeys',
        'shortcutKeys',
        'globalShortcutKeys'
      ]
    }
  }
)
