import { defineStore } from 'pinia'
import { capturePreferenceDefaults } from '@/utils/preferenceDefaults'
import { DEFAULT_FOOTER_LAYOUT, type FooterLayout } from '@/utils/footerLayout'
import { applyCustomTheme, parseCustomTheme, type CustomTheme } from '@/services/customTheme'
import { createThemePreviewTimer } from '@/services/themePreview'
import type { InstalledThemePackage } from '../../../../shared/themePackage'
import type { WindowMaterial } from '../../../../shared/windowMaterial'
import { DEFAULT_LOCAL_SHORTCUTS, DEFAULT_GLOBAL_SHORTCUTS } from '../../../../shared/shortcuts'
import { DEFAULT_GENRE_SEPARATOR } from '../../../../shared/metadataValues'
import { deserializeUIPreferences } from './uiPreferences'
import {
  resolveAppearance,
  DEFAULT_ACCENT_COLOR,
  type AccentSource,
  type AppearancePreferences,
  type ColorMode
} from '@/services/appearance'
import { applyAppearance, createAppearanceScheduler } from '@/services/appearanceController'
import { computed, nextTick, onScopeDispose, reactive, ref, shallowRef, watch } from 'vue'
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
  'appearanceRulesVersion',
  'accentSource',
  'themeBackgroundEnabled',
  'useCardView',
  'compactSongList',
  'useCustomBg',
  'reduceMotion',
  'useLocalFileName',
  'useFullProgress',
  'extremePlayback',
  'autoPlayOnRestore',
  'songPlayTrigger',
  'closeToTray',
  'autoStart',
  'showWelcomeText',
  'homeSectionOrder',
  'hiddenHomeSections',
  'homeClockEnabled',
  'sidebarExpanded',
  'sidebarPlaylistsExpanded',
  'playlistHeaderCollapsed',
  'recommendationPlaylistHeaderCollapsed',
  'customFontFamily',
  'playerLyricsFontFamily',
  'customThemeColor',
  'systemBackground',
  'customBg',
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
  'normalizeMetadataSeparator',
  'ignoreShortSongs',
  'artistSeparator',
  'genreSeparator',
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
      themeBackgroundEnabled.value = true
    }
    function selectThemeBackground(value: SystemBackground | 'light' | 'dark' | 'custom'): boolean {
      if (value !== 'light' && value !== 'dark' && value !== 'custom' && !isSystemBackground(value))
        return false
      if (value === 'light' || value === 'dark') {
        setColorMode(value)
        return true
      }
      const background = value === 'custom' ? 'none' : value
      const changed =
        useCustomBg.value !== (value === 'custom') ||
        systemBackground.value !== background ||
        themeBackgroundEnabled.value
      cancelCustomThemePreview()
      useCustomBg.value = value === 'custom'
      systemBackground.value = background
      themeBackgroundEnabled.value = false
      return changed
    }
    function setCustomBackground(media: Pick<typeof customBg, 'kind' | 'url' | 'path'>): void {
      selectThemeBackground('custom')
      Object.assign(customBg, media)
    }
    function clearCustomBackground(): void {
      useCustomBg.value = false
      Object.assign(customBg, { kind: 'image', url: '', path: '', blur: 0, brightness: 100 })
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
      themeBackgroundEnabled.value = true
      pendingCustomTheme.value = null
      releaseThemePackage(previousPackage)
    }
    const customThemeText = computed(() => effectiveCustomTheme.value?.package?.manifest.text ?? {})
    const customThemeOverridesBackground = computed(() => {
      return resolvedAppearance.value.background.type === 'theme'
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
    const availableWindowMaterials = ref<WindowMaterial[]>(['none'])
    const nativeWindowMaterial = ref<WindowMaterial>('none')
    const windowMaterialPending = ref(false)
    // Retain the persisted legacy name for existing window/theme consumers.
    // It now means that any native window material is active.
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
    const reduceMotion = ref(false)
    const useLocalFileName = ref(false)
    const useFullProgress = ref(false)
    const extremePlayback = ref(false)
    const autoPlayOnRestore = ref(false)
    const songPlayTrigger = ref<'single' | 'double'>('double')
    const closeToTray = ref(false)
    const autoStart = ref(false)
    const showWelcomeText = ref(true)
    const homeSectionOrder = ref<string[]>([...DEFAULT_HOME_SECTION_ORDER])
    const hiddenHomeSections = ref<string[]>([...DEFAULT_HIDDEN_HOME_SECTIONS])
    const homeClockEnabled = ref(false)
    const homeLayoutOpen = ref(false)
    const sidebarExpanded = ref(true)
    const sidebarPlaylistsExpanded = ref(true)
    const playlistHeaderCollapsed = ref(false)
    const recommendationPlaylistHeaderCollapsed = ref(false)
    const customFontFamily = ref('')
    const playerLyricsFontFamily = ref('')
    const customFonts = ref<Array<{ family: string; file: string; url: string }>>([])
    const loadedCustomFontUrls = new Set<string>()
    let themeInitialized = false
    let themeTransitionTimer: ReturnType<typeof setTimeout> | undefined
    const customThemeColor = ref(DEFAULT_ACCENT_COLOR)
    const accentSource = ref<AccentSource>('auto')
    const themeBackgroundEnabled = ref(true)
    const appearanceRulesVersion = ref(0)
    const systemDarkMode = ref(false)
    const colorMode = computed<ColorMode>(() =>
      followSystemTheme.value ? 'system' : useDarkMode.value ? 'dark' : 'light'
    )
    const systemBackground = ref<SystemBackground>('none')
    // Transient song palette; theme selection remains the persisted preference.
    const songThemeColor = ref<string | null>(null)
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
    // Legacy fields remain the storage adapter. All consumers use this normalized model.
    const appearancePreferences = computed<AppearancePreferences>(() => ({
      colorMode: colorMode.value,
      background: useCustomBg.value
        ? { type: customBg.kind }
        : systemBackground.value !== 'none'
          ? { type: 'preset', id: systemBackground.value }
          : { type: 'none' },
      accentSource: accentSource.value,
      accentColor: customThemeColor.value,
      themeBackgroundEnabled: customThemePreviewActive.value || themeBackgroundEnabled.value,
      customChrome: {
        header: customBg.headerBackground,
        footer: customBg.footerBackground,
        border: customBg.chromeBorder
      }
    }))
    const resolvedAppearance = computed(() =>
      resolveAppearance(appearancePreferences.value, {
        systemDark: systemDarkMode.value,
        material: nativeWindowMaterial.value,
        scene: getSystemBackgroundTheme(systemBackground.value),
        songColor: songThemeColor.value,
        theme: effectiveCustomTheme.value
      })
    )
    const activeThemeColor = computed(() => resolvedAppearance.value.accentColor)
    const nativeMaterialEnabled = computed(() => resolvedAppearance.value.nativeMaterialEnabled)
    function setColorMode(mode: ColorMode): void {
      followSystemTheme.value = mode === 'system'
      if (mode !== 'system') useDarkMode.value = mode === 'dark'
      syncFollowSystemTheme()
    }
    function migrateAppearanceRules(): void {
      if (appearanceRulesVersion.value >= 1) return
      const previous = themeBeforeMica.value
      if (previous) {
        useDarkMode.value = previous.useDarkMode
        followSystemTheme.value = previous.followSystemTheme
        useCustomBg.value = previous.useCustomBg
        systemBackground.value = previous.systemBackground
      } else if (themeBeforeFollowingSystem.value) {
        const prior = themeBeforeFollowingSystem.value
        useDarkMode.value = prior.useDarkMode
        useCustomBg.value = prior.useCustomBg
        systemBackground.value = prior.systemBackground
      }
      themeBeforeMica.value = null
      themeBeforeFollowingSystem.value = null
      appearanceRulesVersion.value = 1
    }
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
    const normalizeMetadataSeparator = ref(false)
    const ignoreShortSongs = ref(true)
    const artistSeparator = ref('/；;、')
    const genreSeparator = ref(DEFAULT_GENRE_SEPARATOR)
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
    const getPlayerLyricsFontStyle = computed(() => ({
      fontFamily: playerLyricsFontFamily.value
        ? resolveFontStack(playerLyricsFontFamily.value)
        : undefined
    }))
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
    const hasBackground = computed(() => resolvedAppearance.value.background.type !== 'none')
    function toggleCardStyle(): void {
      useCardView.value = !useCardView.value
    }
    function setCardStyle(v: boolean): void {
      useCardView.value = v
    }

    let appliedAppearanceKey = ''
    let appliedDark: boolean | undefined
    let appliedThemePaletteKey: string | undefined
    function applyTheme(): void {
      const root = document.documentElement
      const appearance = resolvedAppearance.value
      const themeTokens = effectiveCustomTheme.value?.tokens
      const themePaletteKey = JSON.stringify([
        themeTokens?.['--color-bg'],
        themeTokens?.['--color-bg-l'],
        themeTokens?.['--color-bg-l2'],
        themeTokens?.['--color-text']
      ])
      const key = JSON.stringify([
        appearance.dark,
        appearance.material,
        appearance.systemTheme,
        appearance.accentColor,
        appearance.primaryFill,
        appearance.chrome
      ])
      if (key !== appliedAppearanceKey || themePaletteKey !== appliedThemePaletteKey) {
        if (
          (appliedDark !== undefined && appliedDark !== appearance.dark) ||
          (appliedThemePaletteKey !== undefined && appliedThemePaletteKey !== themePaletteKey)
        ) {
          // Cross-fading light text and dark surfaces together passes through a
          // gray-on-gray frame. Switch mode or authored surface palettes atomically;
          // accent changes within one palette retain their normal color transition.
          if (themeTransitionTimer) clearTimeout(themeTransitionTimer)
          themeTransitionTimer = undefined
          root.classList.remove('theme-transitioning')
          void getComputedStyle(root).transitionProperty
        } else if (
          themeInitialized &&
          !reduceMotion.value &&
          !window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ) {
          beginThemeTransition()
        }
        applyAppearance(appearance, root)
        appliedAppearanceKey = key
        appliedDark = appearance.dark
        appliedThemePaletteKey = themePaletteKey
      }
      root.classList.toggle('reduce-motion', reduceMotion.value)
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
    const scheduleAppearance = createAppearanceScheduler(applyTheme, (job) => {
      void nextTick(job)
    })
    function syncFollowSystemTheme(): void {
      if (typeof window !== 'undefined')
        systemDarkMode.value = window.matchMedia('(prefers-color-scheme: dark)').matches
    }
    function setFollowSystemTheme(enabled: boolean): void {
      setColorMode(enabled ? 'system' : useDarkMode.value ? 'dark' : 'light')
    }

    async function loadCustomFonts(): Promise<void> {
      try {
        const response = await window.api.fonts.list()
        const fonts = response.success && Array.isArray(response.data) ? response.data : []
        customFonts.value = fonts
        for (const family of [customFontFamily, playerLyricsFontFamily]) {
          const legacyFamily = family.value.replace(
            /^EasyPlayerFont-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}-/i,
            'EasyPlayerFont-'
          )
          if (legacyFamily !== family.value && fonts.some((font) => font.family === legacyFamily))
            family.value = legacyFamily
          if (
            family.value.startsWith('EasyPlayerFont-') &&
            !fonts.some((font) => font.family === family.value)
          ) {
            family.value = ''
          }
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
        const material = await window.api.system.getWindowMaterialState()
        if (material.success && material.data) {
          availableWindowMaterials.value = material.data.available
          nativeWindowMaterial.value = material.data.material
          micaAvailable.value = material.data.available.includes('mica')
          useMica.value = material.data.enabled
        }
      } catch {
        // Native materials are optional; an older preload may only expose Mica.
        const mica = await window.api.system.getMicaState().catch(() => null)
        if (mica?.success && mica.data) {
          micaAvailable.value = mica.data.available
          availableWindowMaterials.value = mica.data.available ? ['none', 'mica'] : ['none']
          nativeWindowMaterial.value = mica.data.enabled ? 'mica' : 'none'
          useMica.value = mica.data.enabled
        }
      }
      // New installations are hydrated synchronously by the Pinia persistence
      // plugin. Keep this one-time reader solely for migration from the former
      // partial theme snapshot.
      if (hasPersistedStore(persistedSettingsKey)) {
        migrateAppearanceRules()
        syncFollowSystemTheme()
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
      migrateAppearanceRules()
      syncFollowSystemTheme()
      applyTheme()
      themeInitialized = true
      if (migratedLegacyTheme) localStorage.removeItem('easy-player.theme-settings')
    }

    function setTheme(mode: 'light' | 'dark'): void {
      setColorMode(mode)
    }
    function setPlayerBgType(value: unknown): void {
      playerBgType.value = resolvePlayerBgType(value)
    }
    function setPlayerCoverStyle(value: unknown): void {
      playerCoverStyle.value = resolvePlayerCoverStyle(value)
    }
    async function setMicaEnabled(enabled: boolean): Promise<void> {
      await setNativeWindowMaterial(enabled ? 'mica' : 'none')
    }
    async function setNativeWindowMaterial(material: WindowMaterial): Promise<void> {
      if (windowMaterialPending.value || !availableWindowMaterials.value.includes(material)) return
      windowMaterialPending.value = true
      let response: Awaited<ReturnType<typeof window.api.system.setWindowMaterial>>
      try {
        response = await window.api.system.setWindowMaterial(material)
        if (!response.success || !response.data)
          throw new Error(response.error || 'Window material update failed')
      } finally {
        windowMaterialPending.value = false
      }
      nativeWindowMaterial.value = response.data.material
      useMica.value = response.data.enabled
    }

    async function resetTheme(): Promise<void> {
      if (windowMaterialPending.value) throw new Error('Window material update is pending')
      if (nativeMaterialEnabled.value) await setNativeWindowMaterial('none')
      cancelCustomThemePreview()
      activeCustomThemeName.value = ''
      useDarkMode.value = true
      followSystemTheme.value = false
      themeBeforeFollowingSystem.value = null
      themeBeforeMica.value = null
      customThemeColor.value = DEFAULT_ACCENT_COLOR
      accentSource.value = 'auto'
      themeBackgroundEnabled.value = true
      useCustomBg.value = false
      systemBackground.value = 'none'
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
    watch([resolvedAppearance, effectiveCustomTheme], scheduleAppearance, { deep: true })
    watch([customFontFamily, reduceMotion, lyricsFontSize, lyricsFontPadding], scheduleAppearance)
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
      onScopeDispose(() => systemThemeQuery.removeEventListener('change', syncFollowSystemTheme))
    }
    const state = {
      customThemes,
      appearancePreferences,
      resolvedAppearance,
      colorMode,
      setColorMode,
      nativeMaterialEnabled,
      appearanceRulesVersion,
      accentSource,
      themeBackgroundEnabled,
      setCustomBackground,
      clearCustomBackground,
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
      availableWindowMaterials,
      nativeWindowMaterial,
      windowMaterialPending,
      setNativeWindowMaterial,
      useMica,
      themeBeforeMica,
      themeBeforeFollowingSystem,
      useCardView,
      compactSongList,
      useCustomBg,
      reduceMotion,
      extremePlayback,
      autoPlayOnRestore,
      songPlayTrigger,
      closeToTray,
      autoStart,
      useLocalFileName,
      useFullProgress,
      showWelcomeText,
      homeSectionOrder,
      hiddenHomeSections,
      homeClockEnabled,
      homeLayoutOpen,
      sidebarExpanded,
      sidebarPlaylistsExpanded,
      playlistHeaderCollapsed,
      recommendationPlaylistHeaderCollapsed,
      customFontFamily,
      playerLyricsFontFamily,
      getPlayerLyricsFontStyle,
      customFonts,
      customThemeColor,
      activeThemeColor,
      songThemeColor,
      systemBackground,
      customBg,
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
      normalizeMetadataSeparator,
      ignoreShortSongs,
      artistSeparator,
      genreSeparator,
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
      serializer: { serialize: JSON.stringify, deserialize: deserializeUIPreferences },
      pick: [...UI_PREFERENCE_KEYS]
    }
  }
)
