import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import { PlayerBgType, PlayerDisplayMode, TagStyle } from '@/consts'

export const useUIStore = defineStore('ui', () => {
  // ========== 基础设置 ==========
  const locale = ref<'zh' | 'en'>('zh')
  const platform = ref<'win' | 'macOS' | 'linux'>('win')
  const logoText = ref('Easy Player')
  const userName = ref('Easy Player')
  const itemOrder = ref<'asc' | 'desc'>('desc')
  // ========== UI设置 ==========
  const useDarkMode = ref(false)
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
    blur: '',
    brightness: ''
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
    const brightness = customBg.brightness ?? 1
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
    this.useCardView = v
  }
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
    toggleCardStyle,
    setCardStyle
  }
})
