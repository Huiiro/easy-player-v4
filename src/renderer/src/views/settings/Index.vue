<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSlider from '@/components/ui/BaseSlider.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { useUIStore } from '@/stores/ui/uiStore'
import {
  systemBackgroundThemes,
  type SystemBackground
} from '@/components/background/systemBackgroundRegistry'
import { ENGINE_VERSION, PlayerBgType, VERSION } from '@/consts'
import { presetColors } from '@/consts/color'
import BaseColorPicker from '@/components/ui/BaseColorPicker.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import PlaybackSettings from '@/components/settings/PlaybackSettings.vue'
import ShortcutSettings from '@/components/settings/ShortcutSettings.vue'
import SystemSettings from '@/components/settings/SystemSettings.vue'
import LocalFileManagement from '@/components/settings/LocalFileManagement.vue'
import Draggable from 'vuedraggable'

const ui = useUIStore()
const { locale, t } = useI18n()
const backgroundInput = ref<HTMLInputElement | null>(null)
const activeSection = ref('playback')
const settingsScroller = ref<HTMLElement | null>(null)
let sectionObserver: IntersectionObserver | undefined
let navigatingBySidebar = false
let sidebarScrollTimer: number | undefined
const navigationSections = computed(() => [
  { id: 'playback', label: t('settings.playback') },
  { id: 'fonts', label: t('settings.fonts') },
  { id: 'language', label: t('settings.language') },
  { id: 'background', label: t('settings.playerBackground') },
  { id: 'theme', label: t('settings.theme') },
  { id: 'customBackground', label: t('settings.customBackground') },
  { id: 'desktop-lyrics', label: t('settings.desktopLyrics') },
  { id: 'lyrics', label: t('settings.lyrics') },
  { id: 'shortcuts', label: t('settings.shortcuts') },
  { id: 'local-files', label: t('settings.localFileManagement') },
  { id: 'system', label: t('settings.system') },
  { id: 'other', label: t('settings.other') }
])
const language = computed<'zh' | 'en'>({
  get: () => (locale.value === 'en' ? 'en' : 'zh'),
  set: (value) => {
    locale.value = value
    ui.locale = value
  }
})
const languageOptions = computed(() => [
  { label: t('settings.languageChinese'), value: 'zh' },
  { label: t('settings.languageEnglish'), value: 'en' }
])
type ThemeBackgroundChoice = SystemBackground | 'light' | 'dark' | 'custom'
const playerBackground = computed<PlayerBgType>({
  get: () => ui.playerBgType,
  set: (value) => {
    ui.playerBgType = value
  }
})
const themeBackgroundOptions = computed(() => [
  { id: 'light' as const, label: t('settings.appearanceModeLight') },
  { id: 'dark' as const, label: t('settings.appearanceModeDark') },
  { id: 'custom' as const, label: t('settings.appearanceModeCustom') },
  ...systemBackgroundThemes
    .filter((background) => background.id !== 'none')
    .map((background) => ({
      ...background,
      label: t(background.labelKey)
    }))
])
function isThemeBackgroundSelected(value: ThemeBackgroundChoice): boolean {
  if (value === 'custom') return ui.useCustomBg
  if (ui.useCustomBg) return false
  if (value === 'light' || value === 'dark')
    return ui.systemBackground === 'none' && ui.useDarkMode === (value === 'dark')
  return ui.systemBackground === value
}
function selectThemeBackground(value: ThemeBackgroundChoice): void {
  if (ui.followSystemTheme) return
  ui.useCustomBg = false
  if (value === 'custom') {
    ui.systemBackground = 'none'
    ui.useCustomBg = true
    ui.setTheme('dark')
    navigateTo('customBackground')
    return
  }
  if (value === 'light' || value === 'dark') {
    ui.systemBackground = 'none'
    ui.setTheme(value)
    return
  }
  const background = systemBackgroundThemes.find((item) => item.id === value)
  ui.systemBackground = value
  ui.setTheme(background?.colorMode ?? 'dark')
}
const fontOptions = computed(() => [
  { label: t('settings.fontSystemDefault'), value: '' },
  { label: t('settings.fontSystemUi'), value: 'system-ui' },
  { label: t('settings.fontAppleMusic'), value: 'SF Pro Display' },
  { label: t('settings.fontAppleMusicRounded'), value: 'SF Pro Rounded' },
  { label: t('settings.fontPingfang'), value: 'PingFang SC' },
  { label: t('settings.fontSegoeUiVariable'), value: 'Segoe UI Variable' },
  { label: t('settings.fontMicrosoftYahei'), value: 'Microsoft YaHei' },
  { label: t('settings.fontMiSans'), value: 'MiSans' },
  { label: t('settings.fontHarmonyOsSans'), value: 'HarmonyOS Sans SC' },
  { label: t('settings.fontSourceHanSans'), value: 'Source Han Sans SC' },
  { label: t('settings.fontNotoSans'), value: 'Noto Sans SC' },
  ...ui.customFonts.map((font) => ({ label: font.file, value: font.family }))
])
const desktopLyricsFontOptions = computed(() => [
  { label: t('settings.desktopLyricsFontInherit'), value: '' },
  ...fontOptions.value.filter((opt) => opt.value !== '')
])
function navigateTo(sectionId: string): void {
  activeSection.value = sectionId
  const container = settingsScroller.value
  const section = document.getElementById(sectionId)
  if (!container || !section) return
  const top = section.getBoundingClientRect().top - container.getBoundingClientRect().top
  navigatingBySidebar = true
  container.scrollTo({ top: container.scrollTop + top - 24, behavior: 'smooth' })
  onSettingsScroll()
}
function onSettingsScroll(): void {
  if (!navigatingBySidebar) return
  if (sidebarScrollTimer) window.clearTimeout(sidebarScrollTimer)
  sidebarScrollTimer = window.setTimeout(() => {
    navigatingBySidebar = false
    sidebarScrollTimer = undefined
  }, 120)
}
const lyricSourceKey = (source: string): string => source

function chooseBackground(): void {
  backgroundInput.value?.click()
}

function updateBackground(event: Event): void {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || !file.type.startsWith('image/')) return

  const reader = new FileReader()
  reader.onload = () => {
    ui.customBg.url = typeof reader.result === 'string' ? reader.result : ''
    ui.customBg.path = file.name
    ui.systemBackground = 'none'
    ui.useCustomBg = true
    ui.setTheme('dark')
  }
  reader.readAsDataURL(file)
}

function clearBackground(): void {
  ui.useCustomBg = false
  ui.customBg.url = ''
  ui.customBg.path = ''
  ui.customBg.blur = 0
  ui.customBg.brightness = 100
  if (backgroundInput.value) backgroundInput.value.value = ''
}

async function refreshFonts(): Promise<void> {
  await ui.loadCustomFonts()
}

async function openFontDirectory(): Promise<void> {
  await window.api.fonts.openDirectory()
}
onMounted(() => {
  sectionObserver = new IntersectionObserver(
    (entries) => {
      if (navigatingBySidebar) return
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)
      const section = visible.find((entry) => entry.boundingClientRect.top >= 0) || visible[0]
      if (section?.target.id) activeSection.value = section.target.id
    },
    { root: settingsScroller.value, rootMargin: '-18% 0px -68% 0px', threshold: 0 }
  )
  for (const section of navigationSections.value) {
    const element = document.getElementById(section.id)
    if (element) sectionObserver.observe(element)
  }
})
onBeforeUnmount(() => {
  sectionObserver?.disconnect()
  if (sidebarScrollTimer) window.clearTimeout(sidebarScrollTimer)
})
</script>

<template>
  <main
    ref="settingsScroller"
    class="custom-scrollbar h-full overflow-y-auto"
    @scroll="onSettingsScroll"
  >
    <div
      class="mx-auto grid w-full max-w-7xl grid-cols-[10rem_minmax(0,1fr)] gap-10 px-6 py-8 pb-28 sm:px-10"
    >
      <aside class="settings-nav">
        <p class="settings-nav-title">{{ t('settings.navigation') }}</p>
        <button
          v-for="section in navigationSections"
          :key="section.id"
          class="settings-nav-item"
          :class="activeSection === section.id && 'active'"
          @click="navigateTo(section.id)"
        >
          {{ section.label }}
        </button>
      </aside>
      <div class="min-w-0 flex-1">
        <!-- header -->
        <div class="mb-8">
          <p class="text-xs font-semibold tracking-[0.14em] text-primary">PREFERENCES</p>
          <h1 class="mt-2 text-2xl font-semibold tracking-tight text-text">
            {{ t('settings.title') }}
          </h1>
          <p class="mt-2 text-sm text-text-l">
            {{ t('settings.description') }}
          </p>
        </div>
        <!-- playback -->
        <section id="playback" class="settings-section">
          <div class="section-heading">
            <div>
              <h2>{{ t('settings.playback') }}</h2>
              <p>{{ t('settings.playbackDescription') }}</p>
            </div>
          </div>
          <PlaybackSettings />
        </section>
        <!-- font -->
        <section id="fonts" class="settings-section">
          <div class="section-heading">
            <div>
              <h2>{{ t('settings.fonts') }}</h2>
              <p>{{ t('settings.fontsDescription') }}</p>
            </div>
          </div>
          <div class="settings-card">
            <div class="setting-row">
              <div>
                <h3>{{ t('settings.interfaceFont') }}</h3>
                <p>{{ t('settings.interfaceFontDescription') }}</p>
              </div>
              <div class="flex items-center gap-2">
                <BaseSelect
                  v-model="ui.customFontFamily"
                  :options="fontOptions"
                  :placeholder="t('settings.fontSystemDefault')"
                  teleport
                  class="w-64"
                />
                <button class="secondary-button text-nowrap" type="button" @click="refreshFonts">
                  {{ t('settings.refreshFonts') }}
                </button>
                <button
                  class="secondary-button text-nowrap"
                  type="button"
                  @click="openFontDirectory"
                >
                  {{ t('settings.openFontDirectory') }}
                </button>
              </div>
            </div>
          </div>
        </section>
        <!-- language -->
        <section id="language" class="settings-section">
          <div class="section-heading">
            <div>
              <h2>{{ t('settings.language') }}</h2>
              <p>{{ t('settings.languageDescription') }}</p>
            </div>
          </div>
          <div class="settings-card">
            <div class="setting-row">
              <div>
                <h3>{{ t('settings.interfaceLanguage') }}</h3>
                <p>{{ t('settings.interfaceLanguageDescription') }}</p>
              </div>
              <BaseSelect v-model="language" :options="languageOptions" teleport class="w-64" />
            </div>
          </div>
        </section>
        <!-- player theme -->
        <section id="background" class="settings-section">
          <div class="section-heading">
            <div>
              <h2>{{ t('settings.playerBackground') }}</h2>
              <p>{{ t('settings.playerBackgroundDescription') }}</p>
            </div>
          </div>
          <div class="settings-card">
            <div class="setting-row setting-row-stack">
              <div>
                <h3>{{ t('settings.playerBackgroundStyle') }}</h3>
                <p>{{ t('settings.playerBackgroundStyleDescription') }}</p>
              </div>
              <div
                class="theme-options"
                role="radiogroup"
                :aria-label="t('settings.playerBackgroundStyle')"
              >
                <button
                  type="button"
                  class="theme-option album-background-preview"
                  :class="{ selected: playerBackground === PlayerBgType.ALBUM }"
                  :aria-checked="playerBackground === PlayerBgType.ALBUM"
                  role="radio"
                  @click="playerBackground = PlayerBgType.ALBUM"
                >
                  <span class="preview-window"><i /><b /></span>
                  <span>{{ t('settings.playerBackgroundAlbum') }}</span>
                </button>
                <button
                  type="button"
                  class="theme-option ambient-background-preview"
                  :class="{ selected: playerBackground === PlayerBgType.AMBIENT }"
                  :aria-checked="playerBackground === PlayerBgType.AMBIENT"
                  role="radio"
                  @click="playerBackground = PlayerBgType.AMBIENT"
                >
                  <span class="preview-window"><i /><b /></span>
                  <span>{{ t('settings.playerBackgroundAmbient') }}</span>
                </button>
                <button
                  type="button"
                  class="theme-option liquid-background-preview"
                  :class="{ selected: playerBackground === PlayerBgType.LIQUID }"
                  :aria-checked="playerBackground === PlayerBgType.LIQUID"
                  role="radio"
                  @click="playerBackground = PlayerBgType.LIQUID"
                >
                  <span class="preview-window"><i /><b /><em /></span>
                  <span>{{ t('settings.playerBackgroundLiquid') }}</span>
                </button>
              </div>
            </div>
          </div>
        </section>
        <!-- theme -->
        <section id="theme" class="settings-section">
          <div class="section-heading">
            <div>
              <h2>{{ t('settings.theme') }}</h2>
              <p>{{ t('settings.themeDescription') }}</p>
            </div>
            <button class="reset-button" type="button" @click="ui.resetTheme">
              {{ t('settings.restoreDefault') }}
            </button>
          </div>

          <div class="settings-card" :class="{ muted: ui.followSystemTheme || ui.useMica }">
            <div class="setting-row">
              <div>
                <h3>{{ t('settings.followSystemTheme') }}</h3>
                <p>{{ t('settings.followSystemThemeDescription') }}</p>
              </div>
              <BaseSwitch
                :model-value="ui.followSystemTheme"
                :disabled="ui.useMica"
                @update:model-value="ui.setFollowSystemTheme(Boolean($event))"
              />
            </div>
            <div v-if="ui.micaAvailable" class="setting-row">
              <div>
                <h3>{{ t('settings.micaEffect') }}</h3>
                <p>{{ t('settings.micaEffectDescription') }}</p>
              </div>
              <BaseSwitch
                :model-value="ui.useMica"
                @update:model-value="ui.setMicaEnabled(Boolean($event))"
              />
            </div>
            <div
              class="setting-row setting-row-stack"
              :class="{ 'pointer-events-none': ui.followSystemTheme || ui.useMica }"
            >
              <div>
                <h3>{{ t('settings.themeBackground') }}</h3>
                <p>{{ t('settings.themeBackgroundDescription') }}</p>
              </div>
              <div
                class="theme-options system-background-options"
                role="radiogroup"
                :aria-label="t('settings.themeBackground')"
              >
                <button
                  v-for="background in themeBackgroundOptions"
                  :key="background.id"
                  type="button"
                  class="theme-option system-background-preview"
                  :class="[
                    background.id === 'light'
                      ? 'light-preview'
                      : background.id === 'dark'
                        ? 'dark-preview'
                        : background.id === 'custom'
                          ? 'custom-preview'
                          : `system-background-preview--${background.id}`,
                    { selected: isThemeBackgroundSelected(background.id) }
                  ]"
                  :aria-checked="isThemeBackgroundSelected(background.id)"
                  role="radio"
                  @click="selectThemeBackground(background.id)"
                >
                  <span class="preview-window"><i /><b /></span>
                  <span>{{ background.label }}</span>
                </button>
              </div>
            </div>

            <div class="setting-row" :class="{ 'pointer-events-none opacity-55': ui.useMica }">
              <div>
                <h3>{{ t('settings.themeColor') }}</h3>
                <p>{{ t('settings.themeColorDescription') }}</p>
              </div>
              <div>
                <BaseColorPicker v-model="ui.customThemeColor" :presets="presetColors" teleport />
              </div>
            </div>
          </div>
        </section>
        <!-- custom background -->
        <section id="customBackground" class="settings-section">
          <div class="section-heading">
            <div>
              <h2>{{ t('settings.customBackground') }}</h2>
              <p>{{ t('settings.customBackgroundDescription') }}</p>
            </div>
            <span class="text-xs text-text-l">
              {{ ui.useCustomBg ? t('settings.enabled') : t('settings.disabled') }}
            </span>
          </div>

          <div
            class="settings-card"
            :class="{
              muted: !ui.useCustomBg || ui.followSystemTheme,
              'pointer-events-none': ui.followSystemTheme
            }"
          >
            <div class="setting-row background-row">
              <div>
                <h3>{{ t('settings.backgroundImage') }}</h3>
                <p>{{ ui.customBg.path || t('noImageSelected') }}</p>
              </div>
              <div class="flex shrink-0 gap-2">
                <button class="secondary-button" type="button" @click="chooseBackground">
                  {{ t('settings.selectImage') }}
                </button>
                <button
                  v-if="ui.customBg.url"
                  class="icon-button"
                  type="button"
                  :title="t('settings.removeBackground')"
                  @click="clearBackground"
                >
                  ×
                </button>
              </div>
              <input
                ref="backgroundInput"
                class="hidden"
                type="file"
                accept="image/*"
                @change="updateBackground"
              />
            </div>

            <div class="slider-row">
              <div class="slider-label">
                <span>{{ t('settings.brightness') }}</span>
                <strong>{{ ui.customBg.brightness }}%</strong>
              </div>
              <BaseSlider
                v-model="ui.customBg.brightness"
                :min="30"
                :max="130"
                :step="1"
                size="sm"
                :disabled="!ui.useCustomBg"
              />
            </div>
            <div class="slider-row">
              <div class="slider-label">
                <span>{{ t('settings.blur') }}</span>
                <strong>{{ ui.customBg.blur }} px</strong>
              </div>
              <BaseSlider
                v-model="ui.customBg.blur"
                :min="0"
                :max="30"
                :step="1"
                size="sm"
                :disabled="!ui.useCustomBg"
              />
            </div>
            <div class="custom-background-chrome">
              <div class="custom-background-chrome-heading">
                <h3>{{ t('settings.backgroundChrome') }}</h3>
                <p>{{ t('settings.backgroundChromeDescription') }}</p>
              </div>
              <div class="custom-background-color-grid">
                <label class="custom-background-color-control">
                  <span>{{ t('settings.headerBackground') }}</span>
                  <BaseColorPicker
                    v-model="ui.customBg.headerBackground"
                    :presets="presetColors"
                    show-alpha
                    teleport
                    :disabled="!ui.useCustomBg"
                  />
                </label>
                <label class="custom-background-color-control">
                  <span>{{ t('settings.footerBackground') }}</span>
                  <BaseColorPicker
                    v-model="ui.customBg.footerBackground"
                    :presets="presetColors"
                    show-alpha
                    teleport
                    :disabled="!ui.useCustomBg"
                  />
                </label>
                <label class="custom-background-color-control">
                  <span>{{ t('settings.globalBorder') }}</span>
                  <BaseColorPicker
                    v-model="ui.customBg.chromeBorder"
                    :presets="presetColors"
                    show-alpha
                    teleport
                    :disabled="!ui.useCustomBg"
                  />
                </label>
              </div>
            </div>
          </div>
        </section>
        <!-- desktop lyrics -->
        <section id="desktop-lyrics" class="settings-section">
          <div class="section-heading">
            <div>
              <h2>{{ t('settings.desktopLyrics') }}</h2>
              <p>{{ t('settings.desktopLyricsDescription') }}</p>
            </div>
          </div>
          <div class="settings-card">
            <div class="setting-row">
              <div>
                <h3>{{ t('settings.desktopLyricsEnabled') }}</h3>
                <p>{{ t('settings.desktopLyricsEnabledDescription') }}</p>
              </div>
              <BaseSwitch v-model="ui.useDesktopLyrics" size="md" />
            </div>
            <div class="setting-row setting-row-stack gap-4">
              <div class="w-full">
                <div class="flex items-center gap-2 my-3 text-xs text-text-l text-nowrap">
                  <span>{{ t('settings.desktopLyricsFontFamily') }}</span>
                  <BaseSelect
                    v-model="ui.desktopLyricsStyles.fontFamily"
                    :options="desktopLyricsFontOptions"
                    :placeholder="t('settings.desktopLyricsFontInherit')"
                    teleport
                    class="w-full"
                  />
                </div>
                <div class="slider-label">
                  <span>{{ t('settings.desktopLyricsFontSize') }}</span>
                  <strong>{{ ui.desktopLyricsStyles.fontSize }}px</strong>
                </div>
                <BaseSlider
                  v-model="ui.desktopLyricsStyles.fontSize"
                  :min="24"
                  :max="64"
                  :step="1"
                  size="sm"
                />
                <div class="flex gap-4">
                  <label class="flex items-center gap-2 my-2 text-xs text-text-l">
                    <span>{{ t('settings.desktopLyricsActiveColor') }}</span>
                    <BaseColorPicker
                      v-model="ui.desktopLyricsStyles.activeColor"
                      :presets="presetColors"
                      teleport
                    />
                  </label>
                  <label class="flex items-center gap-2 my-3 text-xs text-text-l">
                    <span>{{ t('settings.desktopLyricsInactiveColor') }}</span>
                    <BaseColorPicker
                      v-model="ui.desktopLyricsStyles.inactiveColor"
                      :presets="presetColors"
                      teleport
                    />
                  </label>
                </div>
                <div class="flex gap-4">
                  <label class="flex items-center gap-2 my-3 text-xs text-text-l">
                    <span>{{ t('settings.desktopLyricsTranslation') }}</span>
                    <BaseSwitch v-model="ui.desktopLyricsStyles.showTranslation" :size="'sm'" />
                  </label>
                  <label class="flex items-center gap-2 my-3 text-xs text-text-l">
                    <span>{{ t('settings.desktopLyricsAutoHide') }}</span>
                    <BaseSwitch v-model="ui.desktopLyricsStyles.autoHideBackground" :size="'sm'" />
                  </label>
                </div>
                <div class="flex gap-4">
                  <label class="flex items-center gap-2 my-3 text-xs text-text-l">
                    <span>{{ t('settings.desktopLyricsBold') }}</span>
                    <BaseSwitch v-model="ui.desktopLyricsStyles.fontBold" :size="'sm'" />
                  </label>
                  <label class="flex items-center gap-2 my-3 text-xs text-text-l">
                    <span>{{ t('settings.desktopLyricsGlow') }}</span>
                    <BaseSwitch v-model="ui.desktopLyricsStyles.glow" :size="'sm'" />
                  </label>
                </div>
              </div>
              <div
                class="desktop-lyrics-preview"
                :style="{
                  '--desktop-active': ui.desktopLyricsStyles.activeColor,
                  '--desktop-inactive': ui.desktopLyricsStyles.inactiveColor,
                  '--desktop-size': `${Math.round(ui.desktopLyricsStyles.fontSize * 0.55)}px`
                }"
              >
                <strong
                  :class="ui.desktopLyricsStyles.glow && 'desktop-lyrics-preview--glow'"
                  :style="{ fontWeight: ui.desktopLyricsStyles.fontBold ? 700 : 500 }"
                  >{{ t('settings.desktopLyricsPreviewLine') }}</strong
                >
                <span v-if="ui.desktopLyricsStyles.showTranslation">
                  {{ t('settings.desktopLyricsPreviewTranslation') }}
                </span>
                <span>
                  {{ t('settings.desktopLyricsPreviewNext') }}
                </span>
              </div>
            </div>
          </div>
        </section>
        <!-- lyrics -->
        <section id="lyrics" class="settings-section">
          <div class="section-heading">
            <div>
              <h2>{{ t('settings.lyrics') }}</h2>
              <p>{{ t('settings.lyricsDescription') }}</p>
            </div>
          </div>
          <div class="settings-card">
            <Draggable
              v-model="ui.lyricSourceOrder"
              :item-key="lyricSourceKey"
              handle=".lyric-drag-handle"
            >
              <template #item="{ element: source, index }">
                <div class="setting-row border-border border-b">
                  <div class="flex items-center gap-3">
                    <button class="lyric-drag-handle" :title="t('settings.lyricsDrag')">
                      <SvgIcon name="common-drag" class-name="size-4" />
                    </button>
                    <div>
                      <h3>{{ t(`lyrics.source.${source}`) }}</h3>
                      <p>
                        {{ index === 0 ? t('settings.lyricsFirst') : t('settings.lyricsFallback') }}
                      </p>
                    </div>
                  </div>
                </div>
              </template>
            </Draggable>
            <div class="setting-row">
              <div>
                <h3>{{ t('settings.autoSearchNetworkLyrics') }}</h3>
                <p>{{ t('settings.autoSearchNetworkLyricsDescription') }}</p>
              </div>
              <BaseSwitch v-model="ui.autoSearchNetworkLyrics" size="md" />
            </div>
          </div>
        </section>
        <!-- shortcuts -->
        <section id="shortcuts" class="settings-section">
          <div class="section-heading">
            <div>
              <h2>{{ t('settings.shortcuts') }}</h2>
              <p>{{ t('settings.shortcutsDescription') }}</p>
            </div>
          </div>
          <ShortcutSettings />
        </section>
        <!-- local file -->
        <section id="local-files" class="settings-section">
          <div class="section-heading">
            <div>
              <h2>{{ t('settings.localFileManagement') }}</h2>
              <p>{{ t('settings.localFileManagementDescription') }}</p>
            </div>
          </div>
          <div class="settings-card"><LocalFileManagement /></div>
        </section>
        <!-- system -->
        <section id="system" class="settings-section">
          <div class="section-heading">
            <div>
              <h2>{{ t('settings.system') }}</h2>
              <p>{{ t('settings.systemDescription') }}</p>
            </div>
          </div>
          <div class="settings-card"><SystemSettings /></div>
        </section>
        <!-- other -->
        <section id="other" class="settings-section">
          <div class="section-heading">
            <div>
              <h2>{{ t('settings.other') }}</h2>
              <p>{{ t('settings.otherDescription') }}</p>
            </div>
          </div>
          <div class="settings-card">
            <div class="setting-row">
              <div>
                <h3>{{ t('settings.version') }}</h3>
              </div>
              <div class="flex items-center gap-2 cursor-pointer">
                <span class="text-text">v{{ VERSION }}</span>
                <p>Powered by Easy Player Audio Engine v{{ ENGINE_VERSION }}</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </main>
</template>

<style scoped>
.settings-section {
  margin-top: 2.5rem;
  scroll-margin-top: 1.5rem;
}
.settings-nav {
  position: sticky;
  top: 1.5rem;
  display: flex;
  flex: 0 0 10rem;
  align-self: flex-start;
  flex-direction: column;
  gap: 0.2rem;
  border-left: 1px solid var(--color-border);
  padding-left: 0.65rem;
}
.settings-nav-title {
  margin: 0 0 0.45rem 0.35rem;
  color: var(--color-text-l);
  font-size: 0.7rem;
  font-weight: 650;
  letter-spacing: 0.08em;
}
.settings-nav-item {
  border-radius: 7px;
  padding: 0.45rem 0.55rem;
  color: var(--color-text-l);
  font-size: 0.8rem;
  text-align: left;
}
.settings-nav-item:hover,
.settings-nav-item.active {
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
  color: var(--color-primary);
}
.lyric-drag-handle {
  display: grid;
  cursor: grab;
  place-items: center;
  border-radius: 6px;
  padding: 0.4rem;
  color: var(--color-text-l);
}
.lyric-drag-handle:active {
  cursor: grabbing;
}
.lyric-drag-handle:hover {
  background: var(--color-hover);
  color: var(--color-text);
}
.section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.9rem;
}
.section-heading h2 {
  color: var(--color-text);
  font-size: 1rem;
  font-weight: 650;
}
.section-heading p,
.setting-row p {
  margin-top: 0.25rem;
  color: var(--color-text-l);
  font-size: 0.8125rem;
  line-height: 1.45;
}
.settings-card {
  border: 1px solid color-mix(in srgb, var(--color-border) 76%, transparent);
  border-radius: 14px;
  background: color-mix(in srgb, var(--color-bg-l) 24%, transparent);
  box-shadow: 0 1px 1px color-mix(in srgb, var(--color-black-20) 30%, transparent);
  backdrop-filter: blur(8px);
  transition: opacity 0.2s ease;
}
.settings-card.muted {
  opacity: 0.58;
}
.custom-background-chrome {
  border-top: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
  padding: 1.1rem 1.25rem 1.25rem;
}
.custom-background-chrome-heading h3 {
  color: var(--color-text);
  font-size: 0.9rem;
  font-weight: 550;
}
.custom-background-chrome-heading p {
  margin-top: 0.25rem;
  color: var(--color-text-l);
  font-size: 0.8125rem;
  line-height: 1.45;
}
.custom-background-color-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(8.5rem, 1fr));
  gap: 0.75rem;
  margin-top: 1rem;
  overflow-x: auto;
  padding-bottom: 0.15rem;
}
.custom-background-color-control {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.45rem;
  color: var(--color-text-l);
  font-size: 0.75rem;
}
.setting-row {
  display: flex;
  min-height: 76px;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
  padding: 1.1rem 1.25rem;
}
.setting-row h3 {
  color: var(--color-text);
  font-size: 0.9rem;
  font-weight: 550;
}
.setting-row-stack {
  align-items: flex-start;
}
.shortcut-card {
  overflow: hidden;
}
.shortcut-toolbar {
  display: flex;
  min-height: 76px;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
  border-bottom: 1px solid var(--color-border);
  padding: 1.1rem 1.25rem;
}
.shortcut-toolbar h3,
.shortcut-action {
  color: var(--color-text);
  font-size: 0.9rem;
  font-weight: 550;
}
.shortcut-toolbar p,
.shortcut-hint {
  margin-top: 0.25rem;
  color: var(--color-text-l);
  font-size: 0.8125rem;
  line-height: 1.45;
}
.shortcut-grid {
  display: grid;
  grid-template-columns: minmax(8rem, 1fr) minmax(9rem, 0.8fr) minmax(9rem, 0.8fr);
  align-items: center;
  gap: 0;
}
.shortcut-grid > span {
  padding: 0.65rem 1.25rem;
  color: var(--color-text-l);
  font-size: 0.75rem;
  text-align: center;
}
.shortcut-grid > span:first-child,
.shortcut-grid > .shortcut-action {
  text-align: left;
}
.shortcut-grid > .shortcut-action {
  color: var(--color-text);
  font-size: 0.9rem;
  font-weight: 550;
}
.shortcut-grid > :nth-child(-n + 3) {
  border-bottom: 1px solid var(--color-border);
}
.shortcut-grid > :nth-child(n + 4) {
  min-height: 54px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
  padding: 0.65rem 1.25rem;
}
.shortcut-grid > :nth-last-child(-n + 3) {
  border-bottom: 0;
}
.shortcut-grid > :is(div) {
  padding-right: 1.25rem;
}
.shortcut-grid > :nth-child(3n + 2),
.shortcut-grid > :nth-child(3n) {
  padding-left: 0.25rem;
}
.shortcut-hint {
  border-top: 1px solid var(--color-border);
  margin: 0;
  padding: 0.85rem 1.25rem;
}
.theme-options {
  display: flex;
  gap: 0.65rem;
}
.theme-option {
  display: grid;
  gap: 0.45rem;
  width: 104px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 0.5rem;
  color: var(--color-text-l);
  font-size: 0.75rem;
  text-align: left;
  transition:
    border-color 0.2s,
    box-shadow 0.2s,
    color 0.2s;
}
.theme-option:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
}
.theme-option.selected {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 20%, transparent);
  color: var(--color-primary);
}
.preview-window {
  display: flex;
  height: 47px;
  overflow: hidden;
  border-radius: 6px;
  padding: 8px;
  gap: 5px;
}
.preview-window i {
  width: 18%;
  border-radius: 3px;
}
.preview-window b {
  flex: 1;
  border-radius: 3px;
}
.light-preview .preview-window {
  background: rgba(248, 250, 249, 0.6);
}
.light-preview i {
  background: rgba(229, 233, 231, 0.6);
}
.light-preview b {
  background: rgba(255, 255, 255, 0.6);
}
.dark-preview .preview-window {
  background: #151a18;
}
.dark-preview i {
  background: #252d2a;
}
.dark-preview b {
  background: #1d2421;
}
.custom-preview .preview-window {
  background: linear-gradient(135deg, #37524d, #16231f);
}
.custom-preview i {
  background: rgb(255 255 255 / 18%);
}
.custom-preview b {
  background: rgb(255 255 255 / 10%);
}
.system-background-options {
  flex-wrap: wrap;
}
.system-background-preview--none .preview-window {
  background: var(--color-bg);
}
.system-background-preview--none i {
  background: var(--color-bg-l);
}
.system-background-preview--none b {
  background: var(--color-hover);
}
.system-background-preview--aurora .preview-window {
  background:
    radial-gradient(circle at 12% 14%, #56debc, transparent 37%),
    radial-gradient(circle at 84% 22%, #5b74ff, transparent 42%), #172345;
}
.system-background-preview--ocean .preview-window {
  background:
    radial-gradient(circle at 78% 15%, #5bd3ff, transparent 36%),
    radial-gradient(circle at 18% 82%, #2370c9, transparent 43%), #0d3c5e;
}
.system-background-preview--sunset .preview-window {
  background:
    radial-gradient(circle at 18% 20%, #ffbc70, transparent 35%),
    radial-gradient(circle at 82% 72%, #d3539e, transparent 42%), #73394c;
}
.system-background-preview--forest .preview-window {
  background:
    radial-gradient(circle at 22% 22%, #86cf69, transparent 35%),
    radial-gradient(circle at 83% 70%, #2c9183, transparent 40%), #1b4a35;
}
.system-background-preview--matrix .preview-window {
  background:
    linear-gradient(rgb(104 255 168 / 0.16) 1px, transparent 1px),
    linear-gradient(90deg, rgb(104 255 168 / 0.16) 1px, transparent 1px), #06150e;
  background-size: 9px 9px;
}
.system-background-preview--aurora i,
.system-background-preview--aurora b,
.system-background-preview--ocean i,
.system-background-preview--ocean b,
.system-background-preview--sunset i,
.system-background-preview--sunset b,
.system-background-preview--forest i,
.system-background-preview--forest b,
.system-background-preview--matrix i,
.system-background-preview--matrix b {
  background: rgb(255 255 255 / 16%);
}
.album-background-preview .preview-window {
  background: linear-gradient(135deg, #6e4467, #171524);
}
.album-background-preview i {
  background: linear-gradient(135deg, #f5a4a8, #553a73);
}
.album-background-preview b {
  background: rgb(255 255 255 / 15%);
}
.ambient-background-preview .preview-window {
  background:
    radial-gradient(circle at 20% 25%, #356fa9, transparent 48%),
    radial-gradient(circle at 80% 70%, #984e85, transparent 55%), #141827;
}
.ambient-background-preview i {
  background: rgb(255 255 255 / 17%);
}
.ambient-background-preview b {
  background: rgb(255 255 255 / 10%);
}
.liquid-background-preview .preview-window {
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(ellipse at 20% 32%, #467fcb 0%, transparent 48%),
    radial-gradient(ellipse at 82% 68%, #c54c90 0%, transparent 52%),
    radial-gradient(ellipse at 56% 8%, #43b9a1 0%, transparent 42%), #151827;
}
.liquid-background-preview i,
.liquid-background-preview b,
.liquid-background-preview em {
  position: absolute;
  display: block;
  border-radius: 999px;
  filter: blur(5px);
}
.liquid-background-preview i {
  inset: 20% 45% 18% -8%;
  background: rgb(130 183 255 / 50%);
}
.liquid-background-preview b {
  inset: 42% -12% -18% 40%;
  background: rgb(255 121 198 / 42%);
}
.liquid-background-preview em {
  inset: -20% 26% 56% 30%;
  background: rgb(111 255 207 / 35%);
}
.default-background-preview .preview-window {
  background: #1e2427;
}
.default-background-preview i {
  background: #30383d;
}
.default-background-preview b {
  background: #283035;
}
.desktop-lyrics-preview {
  display: grid;
  min-height: 116px;
  place-content: center;
  gap: 0.35rem;
  width: 100%;
  border-radius: 12px;
  padding: 1rem;
  background: linear-gradient(135deg, rgb(15 20 30 / 96%), rgb(38 28 56 / 88%));
  text-align: center;
}
.desktop-lyrics-preview strong {
  color: var(--desktop-active);
  font-size: var(--desktop-size);
}
.desktop-lyrics-preview--glow {
  text-shadow: 0 0 15px var(--desktop-active);
}
.desktop-lyrics-preview span {
  color: var(--desktop-inactive);
  font-size: 0.8125rem;
}
.background-row {
  border-bottom: 1px solid var(--color-border);
}
.slider-row {
  padding: 1rem 1.25rem;
}
.slider-row + .slider-row {
  padding-top: 0.25rem;
}
.slider-label {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.45rem;
  color: var(--color-text-l);
  font-size: 0.8125rem;
}
.slider-label strong {
  color: var(--color-text);
  font-weight: 550;
}
.secondary-button,
.reset-button,
.icon-button {
  border-radius: 7px;
  font-size: 0.78rem;
  transition:
    background-color 0.2s,
    color 0.2s;
}
.secondary-button {
  border: 1px solid var(--color-border);
  padding: 0.45rem 0.7rem;
  color: var(--color-text);
}
.secondary-button:hover,
.reset-button:hover,
.icon-button:hover {
  background: var(--color-hover);
}
.icon-button {
  width: 31px;
  color: var(--color-text-l);
  font-size: 1.15rem;
}
.reset-button {
  padding: 0.35rem 0.5rem;
  color: var(--color-text-l);
}
</style>
