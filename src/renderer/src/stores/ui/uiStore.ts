import { defineStore } from 'pinia'
import { computed, reactive, ref, watch } from 'vue'
import { PlayerBgType, PlayerDisplayMode, TagStyle } from '@/consts'

export const useUIStore = defineStore('ui', () => {
  const themeStorageKey = 'easy-player.theme-settings'
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
  const useLocalFileName = ref(false)
  const useFullProgress = ref(false)
  const showWelcomeText = ref(true)
  const customFontFamily = ref('')
  const customThemeColor = ref('')
  const customBg = reactive({
    url: '',
    path: '',
    blur: 0,
    brightness: 100
  })
  const currentDynamicBg = reactive({
    bg: 'static_light',
    footer: '',
    dark: false
  })
  // ========== 歌词设置 ==========
  const lyricsAlignment = ref<'left' | 'center' | 'right'>('center')
  const lyricsFontSize = ref(2.4)
  const lyricsFontPadding = ref(30)
  const lyricsGlow = ref(false)
  const lyricsFollow = ref(false)
  const lyricsFontSizeIndex = ref(1)
  const showLyricsSizeSlider = ref(false)
  const showLyricsEditor = ref(false)
  const showLyricsTranslation = ref(false)
  const autoLyricsFontResizer = ref(true)
  // ========== 播放器设置 ==========
  const playerBgType = ref(PlayerBgType.DEFAULT)
  const playerDisplayMode = ref(PlayerDisplayMode.Normal)
  const allowSwitchCoverStyle = ref(true)
  const isCircularCover = ref(false)
  const isCoverSpin = ref(true)
  const showLyricsSettings = ref(false)
  const showDisplaySettings = ref(false)
  const showPlayer = ref(false)
  // ========== 标签与来源 ==========
  const tagStyle = ref(TagStyle.Full)
  const tagSelected = ref<number[]>([])
  const musicSource = ref<'all' | 'local' | 'remote'>('all')
  const musicSourceId = ref(0)
  // ========== 桌面歌词 ==========
  const useDesktopLyrics = ref(false)
  const desktopLyricsStyles = reactive({})
  // ========== 快捷键 ==========
  const useGlobalShortcutKeys = ref(false)
  const shortcutKeys = reactive({
    play: '',
    prev: '',
    next: '',
    iv: '',
    dv: '',
    it: '',
    dt: '',
    tp: ''
  })
  const globalShortcutKeys = reactive({
    play: '',
    prev: '',
    next: '',
    iv: '',
    dv: '',
    it: '',
    dt: '',
    tp: ''
  })
  const getCustomFontStyle = computed(() => ({
    fontFamily: customFontFamily.value || 'inherit'
  }))
  const getCustomBgStyle = computed(() => {
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
  function toggleCardStyle(): void {
    useCardView.value = !useCardView.value
  }
  function setCardStyle(v: boolean): void {
    useCardView.value = v
  }

  function applyTheme(): void {
    const root = document.documentElement
    root.classList.toggle('dark', useDarkMode.value)
    root.style.colorScheme = useDarkMode.value ? 'dark' : 'light'
    if (customThemeColor.value) root.style.setProperty('--color-primary', customThemeColor.value)
    else root.style.removeProperty('--color-primary')
  }

  function persistTheme(): void {
    try {
      localStorage.setItem(
        themeStorageKey,
        JSON.stringify({
          useDarkMode: useDarkMode.value,
          customThemeColor: customThemeColor.value,
          useCustomBg: useCustomBg.value,
          customBg: { ...customBg }
        })
      )
    } catch {
      // A large background can exceed local storage. Preserve the remaining theme choices.
      try {
        localStorage.setItem(
          themeStorageKey,
          JSON.stringify({
            useDarkMode: useDarkMode.value,
            customThemeColor: customThemeColor.value,
            useCustomBg: false,
            customBg: { url: '', path: '', blur: customBg.blur, brightness: customBg.brightness }
          })
        )
      } catch {
        // Storage can be disabled by the host; keep the active session settings instead.
      }
    }
  }

  function initializeTheme(): void {
    try {
      const saved = JSON.parse(localStorage.getItem(themeStorageKey) || '{}')
      if (typeof saved.useDarkMode === 'boolean') useDarkMode.value = saved.useDarkMode
      if (typeof saved.customThemeColor === 'string')
        customThemeColor.value = saved.customThemeColor
      if (typeof saved.useCustomBg === 'boolean') useCustomBg.value = saved.useCustomBg
      if (saved.customBg && typeof saved.customBg === 'object') {
        customBg.url = typeof saved.customBg.url === 'string' ? saved.customBg.url : ''
        customBg.path = typeof saved.customBg.path === 'string' ? saved.customBg.path : ''
        customBg.blur = Number(saved.customBg.blur) || 0
        customBg.brightness = Number(saved.customBg.brightness) || 100
      }
    } catch {
      // Invalid legacy settings should not prevent the app from starting.
    }
    applyTheme()
  }

  function setTheme(mode: 'light' | 'dark'): void {
    useDarkMode.value = mode === 'dark'
  }

  function resetTheme(): void {
    useDarkMode.value = true
    customThemeColor.value = ''
    useCustomBg.value = false
    Object.assign(customBg, { url: '', path: '', blur: 0, brightness: 100 })
  }

  watch(
    [
      useDarkMode,
      customThemeColor,
      useCustomBg,
      () => customBg.url,
      () => customBg.blur,
      () => customBg.brightness
    ],
    () => {
      applyTheme()
      persistTheme()
    }
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
    useDynamicBg,
    useLocalFileName,
    useFullProgress,
    showWelcomeText,
    customThemeColor,
    customBg,
    currentDynamicBg,
    lyricsAlignment,
    lyricsFontSize,
    lyricsFontPadding,
    lyricsGlow,
    lyricsFollow,
    lyricsFontSizeIndex,
    showLyricsSizeSlider,
    showLyricsEditor,
    showLyricsTranslation,
    autoLyricsFontResizer,
    playerBgType,
    playerDisplayMode,
    allowSwitchCoverStyle,
    isCircularCover,
    isCoverSpin,
    showLyricsSettings,
    showDisplaySettings,
    showPlayer,
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
    getCustomBgStyle,
    initializeTheme,
    setTheme,
    resetTheme,
    toggleCardStyle,
    setCardStyle
  }
})
