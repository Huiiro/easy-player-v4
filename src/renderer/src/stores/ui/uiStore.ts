import { defineStore } from 'pinia'
import { capturePreferenceDefaults } from '@/utils/preferenceDefaults'
import { DEFAULT_FOOTER_LAYOUT, type FooterLayout } from '@/utils/footerLayout'
import type { InstalledThemePackage } from '../../../../shared/themePackage'
import { applyCustomTheme, parseCustomTheme, type CustomTheme } from '@/services/customTheme'
import { createThemePreviewTimer } from '@/services/themePreview'
import { DEFAULT_LOCAL_SHORTCUTS, DEFAULT_GLOBAL_SHORTCUTS } from '../../../../shared/shortcuts'
import { accessibleSongAccent, primarySurfaceColors } from '@/components/background/songThemeColors'
import { computed, nextTick, reactive, ref, shallowRef, watch } from 'vue'
import {
  DEFAULT_PLAYER_BG_TYPE,
  DEFAULT_PLAYER_COVER_STYLE,
  PlayerBgType,
  PlayerCoverStyle,
  PlayerDisplayMode,
  resolvePlayerBgType,
  resolvePlayerCoverStyle,
  TagStyle
} from '@/consts'
import type { LyricSource } from '@/services/lyrics'
import { hasPersistedStore, playerDataStorage } from '@/stores/persistence'
import {
  getSystemBackgroundTheme,
  isSystemBackground,
  type SystemBackground
} from '@/components/background/systemBackgroundRegistry'

export type { SystemBackground } from '@/components/background/systemBackgroundRegistry'

export const DEFAULT_HOME_SECTION_ORDER = [
  'welcome',
  'overview',
  'playlists',
  'recommendations',
  'heatmap',
  'topPlayed',
  'topDuration',
  'navigation',
  'clock'
] as const
export const DEFAULT_HIDDEN_HOME_SECTIONS = ['navigation'] as const

export const UI_PREFERENCE_KEYS = [
  'customThemes',
  'activeCustomThemeName',
  'locale',
  'logoText',
  'userName',
  'homeWelcomeText',
  'itemOrder',
  'useDarkMode',
  'followSystemTheme',
  'useMica',
  'themeBeforeMica',
  'themeBeforeFollowingSystem',
  'useCardView',
  'compactSongList',
  'useCustomBg',
  'reduceMotion',
  'useDynamicBg',
  'useLocalFileName',
  'useFullProgress',
  'extremePlayback',
  'autoPlayOnRestore',
  'closeToTray',
  'autoStart',
  'showWelcomeText',
  'homeSectionOrder',
  'hiddenHomeSections',
  'homeClockEnabled',
  'sidebarExpanded',
  'sidebarPlaylistsExpanded',
  'customFontFamily',
  'customThemeColor',
  'systemBackground',
  'customBg',
  'currentDynamicBg',
  'lyricsAlignment',
  'lyricSourceMode',
  'autoSearchNetworkLyrics',
  'preferWordTimedNetworkLyrics',
  'lyricsFontSize',
  'lyricsFontPadding',
  'lyricsOffsetMs',
  'lyricsStyle',
  'karaokeAnimation',
  'lyricsColors',
  'lyricsFontSizeIndex',
  'showLyricsTranslation',
  'showLyricsRomanization',
  'autoAdjustLyricsDisplay',
  'lyricSourceOrder',
  'playerBgType',
  'playerCoverStyle',
  'playerDisplayMode',
  'showPlayerSpectrum',
  'playerSpectrumStyle',
  'footerOpenMode',
  'footerLayout',
  'autoHideFooter',
  'allowSwitchCoverStyle',
  'isCircularCover',
  'isCoverSpin',
  'tagStyle',
  'musicSource',
  'musicSourceId',
  'normalizeArtistSeparator',
  'ignoreShortSongs',
  'artistSeparator',
  'librarySortOrder',
  'libraryCardSize',
  'useDesktopLyrics',
  'desktopLyricsStyles',
  'useGlobalShortcutKeys',
  'shortcutKeys',
  'globalShortcutKeys'
] as const

export const useUIStore = defineStore(
  'ui',
  () => {
    const customThemes = ref<CustomTheme[]>([])
    const activeCustomThemeName = ref('')
    // Preview state is deliberately excluded from UI_PREFERENCE_KEYS.
    const pendingCustomTheme = shallowRef<CustomTheme | null>(null)
    const customThemePreviewSeconds = ref(0)
    const customThemePreviewActive = computed(() => pendingCustomTheme.value !== null)
    const effectiveCustomThemeName = computed(
      () => pendingCustomTheme.value?.name ?? activeCustomThemeName.value
    )
    const effectiveCustomTheme = computed(
      () =>
        pendingCustomTheme.value ??
        customThemes.value.find((theme) => theme.name === effectiveCustomThemeName.value)
    )
    const themePreviewTimer = createThemePreviewTimer((seconds) => {
      customThemePreviewSeconds.value = seconds
    }, cancelCustomThemePreview)
    function releaseThemePackage(id?: string): void {
      if (!id || customThemes.value.some((theme) => theme.package?.id === id)) return
      void window.api.themes
        .removePackage(id)
        .catch((error) => console.warn('[Theme] Resource cleanup failed', error))
    }
    function cancelCustomThemePreview(): void {
      themePreviewTimer.stop()
      const pendingPackage = pendingCustomTheme.value?.package?.id
      pendingCustomTheme.value = null
      releaseThemePackage(pendingPackage)
    }
    function selectCustomTheme(name: string): void {
      if (name && !customThemes.value.some((theme) => theme.name === name)) return
      cancelCustomThemePreview()
      activeCustomThemeName.value = name
    }
    function selectThemeBackground(value: SystemBackground | 'light' | 'dark' | 'custom'): boolean {
      if (followSystemTheme.value || useMica.value) return false
      if (value !== 'light' && value !== 'dark' && value !== 'custom' && !isSystemBackground(value))
        return false
      cancelCustomThemePreview()
      const background =
        value === 'light' || value === 'dark' || value === 'custom' ? 'none' : value
      const dark =
        value === 'light'
          ? false
          : value === 'dark' || value === 'custom'
            ? true
            : getSystemBackgroundTheme(value).colorMode === 'dark'
      if (
        !activeCustomThemeName.value &&
        useCustomBg.value === (value === 'custom') &&
        systemBackground.value === background &&
        useDarkMode.value === dark
      )
        return false
      useCustomBg.value = value === 'custom'
      systemBackground.value = background
      useDarkMode.value = dark
      activeCustomThemeName.value = ''
      return true
    }
    function confirmCustomThemePreview(): void {
      if (!customThemePreviewActive.value || !themePreviewTimer.confirm()) return
      const pending = pendingCustomTheme.value
      let previousPackage: string | undefined
      if (pending) {
        const index = customThemes.value.findIndex((theme) => theme.name === pending.name)
        previousPackage = customThemes.value[index]?.package?.id
        if (index >= 0) customThemes.value.splice(index, 1, pending)
        else customThemes.value.push(pending)
      }
      activeCustomThemeName.value = pending?.name ?? activeCustomThemeName.value
      pendingCustomTheme.value = null
      releaseThemePackage(previousPackage)
    }
    const customThemeText = computed(() => effectiveCustomTheme.value?.package?.manifest.text ?? {})
    const customThemeOverridesBackground = computed(() => {
      const theme = effectiveCustomTheme.value
      return !!theme && theme.background !== 'inherit'
    })
    function refreshCustomTheme(): void {
      const theme = effectiveCustomTheme.value
      try {
        applyCustomTheme(theme ? parseCustomTheme(JSON.stringify(theme)) : null)
      } catch {
        if (customThemePreviewActive.value) {
          cancelCustomThemePreview()
          refreshCustomTheme()
          return
        }
        applyCustomTheme(null)
        activeCustomThemeName.value = ''
      }
    }
    function importCustomTheme(source: string, installed?: InstalledThemePackage): void {
      const theme = parseCustomTheme(source)
      // Package metadata comes from the main-process importer, never a loose JSON file.
      delete theme.package
      if (installed) theme.package = installed
      const validated = parseCustomTheme(JSON.stringify(theme))
      const index = customThemes.value.findIndex((item) => item.name === theme.name)
      if (index < 0 && customThemes.value.length >= 20) throw new Error('At most 20 themes')
      cancelCustomThemePreview()
      pendingCustomTheme.value = validated
      themePreviewTimer.start()
    }
    function removeCustomTheme(name: string): void {
      cancelCustomThemePreview()
      const previous = customThemes.value.find((theme) => theme.name === name)?.package?.id
      customThemes.value = customThemes.value.filter((theme) => theme.name !== name)
      if (activeCustomThemeName.value === name) activeCustomThemeName.value = ''
      releaseThemePackage(previous)
    }
    watch([customThemes, effectiveCustomTheme], refreshCustomTheme, { deep: true })
    const themeSettingsKey = 'ui.theme-settings'
    const persistedSettingsKey = 'ui.preferences.v1'
    // ========== 基础设置 ==========
    const locale = ref<'zh' | 'en'>('zh')
    const platform = ref<'win' | 'macOS' | 'linux'>('win')
    const logoText = ref('Easy Player')
    const userName = ref('Easy Player')
    const homeWelcomeText = ref('')
    const itemOrder = ref<'asc' | 'desc'>('desc')
    // ========== UI设置 ==========
    // The player is dark by default; custom backgrounds inherit this mode for contrast.
    const useDarkMode = ref(true)
    const followSystemTheme = ref(false)
    const micaAvailable = ref(false)
    const useMica = ref(false)
    const themeBeforeMica = ref<{
      useDarkMode: boolean
      followSystemTheme: boolean
      useCustomBg: boolean
      systemBackground: SystemBackground
    } | null>(null)
    const themeBeforeFollowingSystem = ref<{
      useDarkMode: boolean
      useCustomBg: boolean
      systemBackground: SystemBackground
    } | null>(null)
    const useCardView = ref(false)
    const compactSongList = ref(false)
    const useCustomBg = ref(false)
    const useDynamicBg = ref(false)
    const reduceMotion = ref(false)
    const useLocalFileName = ref(false)
    const useFullProgress = ref(false)
    const extremePlayback = ref(false)
    const autoPlayOnRestore = ref(false)
    const closeToTray = ref(false)
    const autoStart = ref(false)
    const showWelcomeText = ref(true)
    const homeSectionOrder = ref<string[]>([...DEFAULT_HOME_SECTION_ORDER])
    const hiddenHomeSections = ref<string[]>([...DEFAULT_HIDDEN_HOME_SECTIONS])
    const homeClockEnabled = ref(false)
    const homeLayoutOpen = ref(false)
    const sidebarExpanded = ref(true)
    const sidebarPlaylistsExpanded = ref(true)
    const customFontFamily = ref('')
    const customFonts = ref<Array<{ family: string; file: string; url: string }>>([])
    const loadedCustomFontUrls = new Set<string>()
    let themeInitialized = false
    let themeTransitionTimer: ReturnType<typeof setTimeout> | undefined
    let applyingVisualTheme = false
    const customThemeColor = ref('oklch(0.691 0.198 148.262)')
    const systemBackground = ref<SystemBackground>('none')
    // Transient song palette; theme selection remains the persisted preference.
    const songThemeColor = ref<string | null>(null)
    const activeThemeColor = computed(() => {
      if (
        !customThemeOverridesBackground.value &&
        !useCustomBg.value &&
        systemBackground.value !== 'none'
      ) {
        if (systemBackground.value === 'solid' && songThemeColor.value)
          return accessibleSongAccent(songThemeColor.value)
        return getSystemBackgroundTheme(systemBackground.value).accentColor
      }
      return customThemeColor.value
    })
    const customBg = reactive({
      kind: 'image' as 'image' | 'video',
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
    const preferWordTimedNetworkLyrics = ref(true)
    const lyricsFontSize = ref(2.4)
    const lyricsFontPadding = ref(30)
    const lyricsOffsetMs = ref(0)
    const lyricsStyle = ref<'none' | 'glow' | 'follow'>('none')
    const karaokeAnimation = ref<'wave' | 'float'>('wave')
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
    const showLyricsRomanization = ref(false)
    const autoAdjustLyricsDisplay = ref(false)
    const lyricSourceOrder = ref<LyricSource[]>(['embedded', 'database', 'local', 'network'])
    // ========== 播放器设置 ==========
    const playerBgType = ref<PlayerBgType>(DEFAULT_PLAYER_BG_TYPE)
    const playerCoverStyle = ref<PlayerCoverStyle>(DEFAULT_PLAYER_COVER_STYLE)
    const playerDisplayMode = ref(PlayerDisplayMode.Normal)
    const allowSwitchCoverStyle = ref(true)
    const isCircularCover = ref(false)
    const isCoverSpin = ref(true)
    const showLyricsSettings = ref(false)
    const showDisplaySettings = ref(false)
    const showPlayerSpectrum = ref(false)
    const playerSpectrumStyle = ref<'bars' | 'dots'>('bars')
    const showPlayer = ref(false)
    const footerOpenMode = ref<'all' | 'cover'>('all')
    const footerLayout = ref<FooterLayout>({ ...DEFAULT_FOOTER_LAYOUT })
    function resetFooterLayout(): void {
      footerLayout.value = { ...DEFAULT_FOOTER_LAYOUT }
    }
    const autoHideFooter = ref(false)
    // ========== 标签与来源 ==========
    const tagStyle = ref(TagStyle.Full)
    const tagSelected = ref<number[]>([])
    const musicSource = ref<'all' | 'local' | 'remote'>('all')
    const musicSourceId = ref(0)
    const normalizeArtistSeparator = ref(false)
    const ignoreShortSongs = ref(true)
    const artistSeparator = ref('/；;、')
    const librarySortOrder = reactive<Record<'album' | 'artist' | 'genre', 'asc' | 'desc'>>({
      album: 'asc',
      artist: 'asc',
      genre: 'asc'
    })
    const libraryCardSize = reactive<Record<'album' | 'artist' | 'genre', number>>({
      album: 176,
      artist: 176,
      genre: 176
    })
    // ========== 桌面歌词 ==========
    const useDesktopLyrics = ref(false)
    const desktopLyricsStyles = reactive({
      fontSize: 34,
      activeColor: '#ffffff',
      inactiveColor: 'rgba(255, 255, 255, 0.58)',
      fontBold: true,
      glow: true,
      sweep: false,
      showTranslation: true,
      autoHideBackground: true,
      fontFamily: ''
    })
    // ========== 快捷键 ==========
    const useGlobalShortcutKeys = ref(false)
    const shortcutKeys = reactive({ ...DEFAULT_LOCAL_SHORTCUTS })
    const globalShortcutKeys = reactive({ ...DEFAULT_GLOBAL_SHORTCUTS })
    const presetFontStacks: Record<string, string> = {
      'system-ui': 'system-ui, "Segoe UI Variable", "Segoe UI", "Microsoft YaHei", sans-serif',
      'SF Pro Display':
        '"SF Pro Display", "SF Pro Text", "PingFang SC", "Segoe UI Variable", "Microsoft YaHei", sans-serif',
      'SF Pro Rounded':
        '"SF Pro Rounded", "SF Pro Display", "PingFang SC", "Segoe UI Variable", "Microsoft YaHei", sans-serif',
      'PingFang SC': '"PingFang SC", "SF Pro Display", "Microsoft YaHei", sans-serif',
      'Segoe UI Variable': '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei", sans-serif',
      MiSans: 'MiSans, "Microsoft YaHei", "Segoe UI", sans-serif',
      'HarmonyOS Sans SC': '"HarmonyOS Sans SC", "Microsoft YaHei", "Segoe UI", sans-serif',
      'Source Han Sans SC': '"Source Han Sans SC", "Noto Sans SC", "Microsoft YaHei", sans-serif',
      'Noto Sans SC': '"Noto Sans SC", "Microsoft YaHei", "Segoe UI", sans-serif'
    }
    function resolveFontStack(family: string): string {
      if (!family) return 'inherit'
      return (
        presetFontStacks[family] ||
        `"${family}", Inter, "Segoe UI Variable", "Segoe UI", "Microsoft YaHei", system-ui, sans-serif`
      )
    }
    const fontStack = computed(() => resolveFontStack(customFontFamily.value))
    function normalizeLyricsFontPadding(value: number): number {
      return Math.max(3, Math.min(78, Math.round(value / 3) * 3))
    }
    const getCustomFontStyle = computed(() => ({ fontFamily: fontStack.value }))
    const getBackgroundStyle = computed(() => {
      const blur = customBg.blur ?? 0
      const brightness = customBg.brightness ?? 100
      return {
        backgroundImage: customBg.url ? `url(${customBg.url})` : 'none',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        filter: `blur(${blur}px) brightness(${brightness}%)`
      }
    })
    const getBackgroundFilter = computed(
      () => `blur(${customBg.blur ?? 0}px) brightness(${customBg.brightness ?? 100}%)`
    )
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
      root.classList.toggle('mica-enabled', useMica.value)
      document.body.classList.toggle('mica-enabled', useMica.value)
      root.style.colorScheme = useDarkMode.value ? 'dark' : 'light'
      if (activeThemeColor.value) root.style.setProperty('--color-primary', activeThemeColor.value)
      else root.style.removeProperty('--color-primary')
      if (
        !customThemeOverridesBackground.value &&
        !useCustomBg.value &&
        systemBackground.value === 'solid'
      ) {
        const fill = songThemeColor.value ?? activeThemeColor.value
        const surface = primarySurfaceColors(fill)
        root.style.setProperty('--color-primary-fill', fill)
        root.style.setProperty('--color-on-primary', surface.text)
        root.style.setProperty('--btn-primary-bg-hover', surface.hover)
      } else {
        root.style.removeProperty('--color-primary-fill')
        root.style.removeProperty('--color-on-primary')
        root.style.removeProperty('--btn-primary-bg-hover')
      }
      root.style.setProperty('--lrc-size', `${lyricsFontSize.value}rem`)
      const normalizedPadding = normalizeLyricsFontPadding(lyricsFontPadding.value)
      if (normalizedPadding !== lyricsFontPadding.value) lyricsFontPadding.value = normalizedPadding
      root.style.setProperty('--lrc-padding', `${normalizedPadding}px`)
      root.style.fontFamily = customFontFamily.value ? fontStack.value : ''
      refreshCustomTheme()
    }
    function beginThemeTransition(): void {
      if (!themeInitialized || reduceMotion.value || typeof document === 'undefined') return
      const root = document.documentElement
      root.classList.add('theme-transitioning')
      if (themeTransitionTimer) clearTimeout(themeTransitionTimer)
      const configuredDuration = getComputedStyle(root)
        .getPropertyValue('--motion-duration-theme')
        .trim()
      const durationValue = Number.parseFloat(configuredDuration)
      const durationMs = Number.isFinite(durationValue)
        ? configuredDuration.endsWith('ms')
          ? durationValue
          : durationValue * 1000
        : 220
      themeTransitionTimer = setTimeout(() => {
        root.classList.remove('theme-transitioning')
        themeTransitionTimer = undefined
      }, durationMs + 80)
    }
    async function updateVisualTheme(): Promise<void> {
      applyingVisualTheme = true
      try {
        syncSystemBackgroundThemeColor()
        applyTheme()
        await nextTick()
      } finally {
        applyingVisualTheme = false
      }
    }
    function applyVisualThemeWithTransition(): void {
      if (applyingVisualTheme) return
      if (
        !themeInitialized ||
        reduceMotion.value ||
        typeof document === 'undefined' ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        void updateVisualTheme()
        return
      }
      beginThemeTransition()
      void updateVisualTheme()
    }
    function syncFollowSystemTheme(): void {
      if (!followSystemTheme.value || typeof window === 'undefined') return
      useDarkMode.value = window.matchMedia('(prefers-color-scheme: dark)').matches
    }
    function applyMicaThemeConstraints(): void {
      followSystemTheme.value = true
      useCustomBg.value = false
      systemBackground.value = 'none'
      syncFollowSystemTheme()
    }
    function setFollowSystemTheme(enabled: boolean): void {
      if (useMica.value && !enabled) return
      if (enabled === followSystemTheme.value) return
      if (!enabled) {
        const previous = themeBeforeFollowingSystem.value
        followSystemTheme.value = false
        if (previous) {
          useDarkMode.value = previous.useDarkMode
          useCustomBg.value = previous.useCustomBg
          systemBackground.value = previous.systemBackground
        }
        themeBeforeFollowingSystem.value = null
        return
      }
      themeBeforeFollowingSystem.value = {
        useDarkMode: useDarkMode.value,
        useCustomBg: useCustomBg.value,
        systemBackground: systemBackground.value
      }
      followSystemTheme.value = enabled
      useCustomBg.value = false
      systemBackground.value = 'none'
      syncFollowSystemTheme()
    }
    function syncSystemBackgroundThemeColor(): void {
      if (followSystemTheme.value) {
        useCustomBg.value = false
        systemBackground.value = 'none'
      }
      const overridesBackground = customThemeOverridesBackground.value
      const theme = getSystemBackgroundTheme(
        useCustomBg.value || overridesBackground ? 'none' : systemBackground.value
      )
      if (!overridesBackground && !useCustomBg.value && systemBackground.value !== 'none') {
        useDarkMode.value = theme.colorMode === 'dark'
      }
      const root = document.documentElement
      root.dataset.systemTheme = overridesBackground
        ? 'none'
        : useCustomBg.value
          ? 'custom'
          : systemBackground.value
      root.style.setProperty(
        '--app-header-bg',
        useCustomBg.value && !overridesBackground
          ? customBg.headerBackground
          : theme.headerBackground
      )
      root.style.setProperty(
        '--app-footer-bg',
        useCustomBg.value && !overridesBackground
          ? customBg.footerBackground
          : theme.footerBackground
      )
      root.style.setProperty(
        '--app-chrome-border',
        useCustomBg.value && !overridesBackground ? customBg.chromeBorder : theme.chromeBorder
      )
      if (useCustomBg.value && !overridesBackground) {
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
      // Discard shader preferences saved by earlier builds of the custom background feature.
      if ((customBg.kind as string | undefined) === 'shader') {
        customBg.kind = 'image'
        customBg.url = ''
        customBg.path = ''
        useCustomBg.value = false
      } else if (customBg.kind !== 'video') {
        customBg.kind = 'image'
      }
      delete (customBg as typeof customBg & { shaderSource?: string }).shaderSource
      try {
        const mica = await window.api.system.getMicaState()
        if (mica.success && mica.data) {
          micaAvailable.value = mica.data.available
          useMica.value = mica.data.enabled
        }
      } catch {
        // Native material is an optional Windows-only enhancement.
      }
      // New installations are hydrated synchronously by the Pinia persistence
      // plugin. Keep this one-time reader solely for migration from the former
      // partial theme snapshot.
      if (hasPersistedStore(persistedSettingsKey)) {
        if (useMica.value) applyMicaThemeConstraints()
        syncFollowSystemTheme()
        syncSystemBackgroundThemeColor()
        applyTheme()
        themeInitialized = true
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
      if (typeof saved.followSystemTheme === 'boolean')
        followSystemTheme.value = saved.followSystemTheme
      if (typeof saved.customThemeColor === 'string')
        customThemeColor.value = saved.customThemeColor
      if (typeof saved.useCustomBg === 'boolean') useCustomBg.value = saved.useCustomBg
      if (typeof saved.reduceMotion === 'boolean') reduceMotion.value = saved.reduceMotion
      if (isSystemBackground(saved.systemBackground)) {
        systemBackground.value = saved.systemBackground as SystemBackground
      }
      if (typeof saved.autoPlayOnRestore === 'boolean')
        autoPlayOnRestore.value = saved.autoPlayOnRestore
      setPlayerBgType(saved.playerBgType)
      setPlayerCoverStyle(saved.playerCoverStyle)
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
        customBg.kind = background.kind === 'video' ? 'video' : 'image'
        customBg.url = typeof background.url === 'string' ? background.url : ''
        customBg.path = typeof background.path === 'string' ? background.path : ''
        if (background.kind === 'shader') {
          customBg.url = ''
          customBg.path = ''
          useCustomBg.value = false
        }
        customBg.blur = Number(background.blur) || 0
        customBg.brightness = Math.max(10, Math.min(110, Number(background.brightness) || 100))
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
      if (useMica.value) applyMicaThemeConstraints()
      syncFollowSystemTheme()
      applyTheme()
      themeInitialized = true
      if (migratedLegacyTheme) localStorage.removeItem('easy-player.theme-settings')
    }

    function setTheme(mode: 'light' | 'dark'): void {
      if (followSystemTheme.value) return
      useDarkMode.value = mode === 'dark'
    }
    function setPlayerBgType(value: unknown): void {
      playerBgType.value = resolvePlayerBgType(value)
    }
    function setPlayerCoverStyle(value: unknown): void {
      playerCoverStyle.value = resolvePlayerCoverStyle(value)
    }
    async function setMicaEnabled(enabled: boolean): Promise<void> {
      if (!micaAvailable.value) return
      const response = await window.api.system.setMicaEnabled(enabled)
      if (!response.success || !response.data) return
      if (response.data.enabled) {
        if (!useMica.value) {
          themeBeforeMica.value = {
            useDarkMode: useDarkMode.value,
            followSystemTheme: followSystemTheme.value,
            useCustomBg: useCustomBg.value,
            systemBackground: systemBackground.value
          }
        }
        useMica.value = true
        applyMicaThemeConstraints()
        return
      }

      useMica.value = false
      const previous = themeBeforeMica.value
      if (previous) {
        useDarkMode.value = previous.useDarkMode
        followSystemTheme.value = previous.followSystemTheme
        useCustomBg.value = previous.useCustomBg
        systemBackground.value = previous.systemBackground
        syncFollowSystemTheme()
      }
      themeBeforeMica.value = null
    }

    function resetTheme(): void {
      cancelCustomThemePreview()
      activeCustomThemeName.value = ''
      useDarkMode.value = true
      followSystemTheme.value = false
      themeBeforeFollowingSystem.value = null
      customThemeColor.value = ''
      useCustomBg.value = false
      systemBackground.value = 'none'
      setPlayerBgType(DEFAULT_PLAYER_BG_TYPE)
      setPlayerCoverStyle(DEFAULT_PLAYER_COVER_STYLE)
      Object.assign(customBg, {
        kind: 'image',
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
      if (typeof padding === 'number' && Number.isFinite(padding))
        lyricsFontPadding.value = normalizeLyricsFontPadding(padding)
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
    function toggleRomanization(): void {
      showLyricsRomanization.value = !showLyricsRomanization.value
    }
    watch(
      [
        useDarkMode,
        useMica,
        customThemeColor,
        useCustomBg,
        systemBackground,
        customThemeOverridesBackground,
        () => customBg.url
      ],
      applyVisualThemeWithTransition
    )
    watch([customFontFamily, reduceMotion, lyricsFontSize, lyricsFontPadding], applyTheme)
    watch(songThemeColor, applyTheme)
    watch(
      playerBgType,
      (value) => {
        const resolved = resolvePlayerBgType(value)
        if (value !== resolved) playerBgType.value = resolved
      },
      { immediate: true }
    )
    watch(
      playerCoverStyle,
      (value) => {
        const resolved = resolvePlayerCoverStyle(value)
        if (value !== resolved) playerCoverStyle.value = resolved
      },
      { immediate: true }
    )
    if (typeof window !== 'undefined') {
      const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
      systemThemeQuery.addEventListener('change', syncFollowSystemTheme)
    }
    watch(
      [
        () => customBg.headerBackground,
        () => customBg.footerBackground,
        () => customBg.chromeBorder
      ],
      syncSystemBackgroundThemeColor
    )
    const state = {
      customThemes,
      selectThemeBackground,
      effectiveCustomThemeName,
      effectiveCustomTheme,
      customThemePreviewActive,
      customThemePreviewSeconds,
      selectCustomTheme,
      confirmCustomThemePreview,
      cancelCustomThemePreview,
      checkCustomThemePreviewDeadline: themePreviewTimer.check,
      customThemeText,
      customThemeOverridesBackground,
      activeCustomThemeName,
      importCustomTheme,
      removeCustomTheme,
      locale,
      platform,
      logoText,
      userName,
      homeWelcomeText,
      itemOrder,
      useDarkMode,
      followSystemTheme,
      micaAvailable,
      useMica,
      themeBeforeMica,
      themeBeforeFollowingSystem,
      useCardView,
      compactSongList,
      useCustomBg,
      reduceMotion,
      extremePlayback,
      autoPlayOnRestore,
      closeToTray,
      autoStart,
      useDynamicBg,
      useLocalFileName,
      useFullProgress,
      showWelcomeText,
      homeSectionOrder,
      hiddenHomeSections,
      homeClockEnabled,
      homeLayoutOpen,
      sidebarExpanded,
      sidebarPlaylistsExpanded,
      customFontFamily,
      customFonts,
      customThemeColor,
      activeThemeColor,
      songThemeColor,
      systemBackground,
      customBg,
      currentDynamicBg,
      lyricsAlignment,
      lyricSourceMode,
      autoSearchNetworkLyrics,
      preferWordTimedNetworkLyrics,
      lyricsFontSize,
      lyricsFontPadding,
      lyricsOffsetMs,
      lyricsStyle,
      karaokeAnimation,
      lyricsColors,
      lyricsFontSizeIndex,
      showLyricsSizeSlider,
      showLyricsEditor,
      showLyricsTranslation,
      showLyricsRomanization,
      autoAdjustLyricsDisplay,
      lyricSourceOrder,
      playerBgType,
      setPlayerBgType,
      playerCoverStyle,
      setPlayerCoverStyle,
      playerDisplayMode,
      allowSwitchCoverStyle,
      isCircularCover,
      isCoverSpin,
      showLyricsSettings,
      showDisplaySettings,
      showPlayerSpectrum,
      playerSpectrumStyle,
      showPlayer,
      footerOpenMode,
      footerLayout,
      resetFooterLayout,
      autoHideFooter,
      tagStyle,
      tagSelected,
      musicSource,
      musicSourceId,
      normalizeArtistSeparator,
      ignoreShortSongs,
      artistSeparator,
      librarySortOrder,
      libraryCardSize,
      useDesktopLyrics,
      desktopLyricsStyles,
      resolveFontStack,
      useGlobalShortcutKeys,
      shortcutKeys,
      globalShortcutKeys,
      getCustomFontStyle,
      hasBackground,
      getBackgroundStyle,
      getBackgroundFilter,
      initializeTheme,
      loadCustomFonts,
      setTheme,
      setFollowSystemTheme,
      setMicaEnabled,
      resetTheme,
      toggleCardStyle,
      setCardStyle,
      setLyricsFontSize,
      setLyricsFontPadding,
      setLyricsOffset,
      resetLyricsOffset,
      resetLyricsColors,
      handleClickStyle,
      toggleTranslation,
      toggleRomanization
    }
    const resetPreferences = capturePreferenceDefaults(
      state,
      UI_PREFERENCE_KEYS.filter((key) => key !== 'customThemes')
    )
    return { ...state, resetPreferences }
  },
  {
    persist: {
      key: 'ui.preferences.v1',
      storage: playerDataStorage,
      pick: [...UI_PREFERENCE_KEYS]
    }
  }
)
