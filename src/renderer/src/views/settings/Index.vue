<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseConfirmDialog from '@/components/ui/BaseConfirmDialog.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import { useUIStore } from '@/stores/ui/uiStore'
import { BUILD_NUMBER, ENGINE_VERSION, VERSION } from '@/consts'
import PlaybackSettings from '@/components/settings/PlaybackSettings.vue'
import PlayerAppearanceSettings from '@/components/settings/PlayerAppearanceSettings.vue'
import LyricsSettings from '@/components/settings/LyricsSettings.vue'
import DesktopLyricsSettings from '@/components/settings/DesktopLyricsSettings.vue'
import ThemeSettings from '@/components/settings/ThemeSettings.vue'
import CustomBackgroundSettings from '@/components/settings/CustomBackgroundSettings.vue'
import ShortcutSettings from '@/components/settings/ShortcutSettings.vue'
import SystemSettings from '@/components/settings/SystemSettings.vue'
import CacheSettings from '@/components/settings/CacheSettings.vue'
import LibrarySettings from '@/components/settings/LibrarySettings.vue'
import StatisticsSettings from '@/components/settings/StatisticsSettings.vue'

const ui = useUIStore()
const repositoryUrl = 'https://github.com/Huiiro/easy-player-v4'
const themeDocumentationUrl = `${repositoryUrl}/blob/master/docs/custom-themes.md`
const { locale, t } = useI18n()
const activeSection = ref('playback')
const resetThemeVisible = ref(false)
const settingsScroller = ref<HTMLElement | null>(null)
let sectionObserver: IntersectionObserver | undefined
let navigatingBySidebar = false
let sidebarScrollTimer: number | undefined
// Heading sizes follow the playback icon's 26 / 20 ratio; nav sizes compensate for SVG whitespace.
const sectionIcons = {
  playback: { name: 'common-headphone', size: 26, navSize: 20 },
  fonts: { name: 'menu-font', size: 15.6, navSize: 12 },
  language: { name: 'common-locale', size: 19.5, navSize: 15 },
  background: { name: 'menu-display', size: 19.5, navSize: 15 },
  theme: { name: 'common-dark-sun', size: 36.4, navSize: 28 },
  customBackground: { name: 'common-theme', size: 28.6, navSize: 22 },
  lyrics: { name: 'common-lyrics-music', size: 19.5, navSize: 15 },
  'desktop-lyrics': { name: 'common-lyrics2', size: 23.4, navSize: 18 },
  shortcuts: { name: 'common-shortcuts', size: 23.4, navSize: 18 },
  library: { name: 'menu-library', size: 23.4, navSize: 18 },
  cache: { name: 'common-database', size: 23.4, navSize: 18 },
  system: { name: 'common-settings', size: 20.8, navSize: 16 },
  other: { name: 'common-info', size: 26, navSize: 20 }
} as const
const navigationSections = computed(() =>
  [
    { id: 'playback', label: t('settings.playback') },
    { id: 'fonts', label: t('settings.fonts') },
    { id: 'language', label: t('settings.language') },
    { id: 'background', label: t('settings.playerBackground') },
    { id: 'theme', label: t('settings.theme') },
    { id: 'customBackground', label: t('settings.customBackground') },
    { id: 'lyrics', label: t('settings.lyrics') },
    { id: 'desktop-lyrics', label: t('settings.desktopLyrics') },
    { id: 'shortcuts', label: t('settings.shortcuts') },
    { id: 'library', label: t('settings.library') },
    { id: 'cache', label: t('settings.cacheManagement') },
    { id: 'system', label: t('settings.system') },
    { id: 'other', label: t('settings.other') }
  ].map((section) => ({
    ...section,
    icon: sectionIcons[section.id as keyof typeof sectionIcons]
  }))
)
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
    class="settings-page custom-scrollbar h-full overflow-y-auto"
    @scroll="onSettingsScroll"
  >
    <div
      class="mx-auto grid w-full max-w-7xl grid-cols-[11.5rem_minmax(0,1fr)] gap-10 px-6 pt-[var(--settings-top-offset)] sm:px-10"
    >
      <aside class="settings-nav">
        <p class="settings-nav-title">{{ t('settings.navigation') }}</p>
        <button
          v-for="section in navigationSections"
          :key="section.id"
          type="button"
          class="settings-nav-item"
          :class="activeSection === section.id && 'active'"
          :aria-current="activeSection === section.id ? 'location' : undefined"
          @click="navigateTo(section.id)"
        >
          <span class="settings-nav-icon">
            <SvgIcon :name="section.icon.name" :size="section.icon.navSize" class-name="shrink-0" />
          </span>
          <span>{{ section.label }}</span>
        </button>
      </aside>
      <!-- Keep bottom spacing inside the content column so it does not push the sticky nav up. -->
      <div class="min-w-0 flex-1 pb-28">
        <!-- header -->
        <div class="mb-8">
          <p class="text-xs font-semibold tracking-[0.14em] text-primary">PREFERENCES</p>
          <h1 class="mt-2 flex items-center gap-2 text-2xl font-semibold tracking-tight text-text">
            <SvgIcon name="menu-settings" :size="28" class-name="shrink-0" />
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
              <h2>
                <SvgIcon
                  :name="sectionIcons.playback.name"
                  :size="sectionIcons.playback.size"
                  class-name="settings-heading-icon"
                />
                <span>{{ t('settings.playback') }}</span>
              </h2>
              <p>{{ t('settings.playbackDescription') }}</p>
            </div>
          </div>
          <PlaybackSettings />
        </section>
        <!-- font -->
        <section id="fonts" class="settings-section">
          <div class="section-heading">
            <div>
              <h2>
                <SvgIcon
                  :name="sectionIcons.fonts.name"
                  :size="sectionIcons.fonts.size"
                  class-name="settings-heading-icon"
                />
                <span>{{ t('settings.fonts') }}</span>
              </h2>
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
              <h2>
                <SvgIcon
                  :name="sectionIcons.language.name"
                  :size="sectionIcons.language.size"
                  class-name="settings-heading-icon"
                />
                <span>{{ t('settings.language') }}</span>
              </h2>
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
              <h2>
                <SvgIcon
                  :name="sectionIcons.background.name"
                  :size="sectionIcons.background.size"
                  class-name="settings-heading-icon"
                />
                <span>{{ t('settings.playerBackground') }}</span>
              </h2>
              <p>{{ t('settings.playerBackgroundDescription') }}</p>
            </div>
          </div>
          <PlayerAppearanceSettings />
        </section>
        <!-- theme -->
        <section id="theme" class="settings-section">
          <div class="section-heading">
            <div>
              <h2>
                <SvgIcon
                  :name="sectionIcons.theme.name"
                  :size="sectionIcons.theme.size"
                  class-name="settings-heading-icon"
                />
                <span>{{ t('settings.theme') }}</span>
              </h2>
              <p>{{ t('settings.themeDescription') }}</p>
            </div>
            <button class="reset-button" type="button" @click="resetThemeVisible = true">
              {{ t('settings.restoreDefault') }}
            </button>
          </div>
          <ThemeSettings @navigate="navigateTo" />
        </section>
        <!-- custom background -->
        <section id="customBackground" class="settings-section">
          <div class="section-heading">
            <div>
              <h2>
                <SvgIcon
                  :name="sectionIcons.customBackground.name"
                  :size="sectionIcons.customBackground.size"
                  class-name="settings-heading-icon"
                />
                <span>{{ t('settings.customBackground') }}</span>
              </h2>
              <p>{{ t('settings.customBackgroundDescription') }}</p>
            </div>
            <span class="text-xs text-text-l">
              {{ ui.useCustomBg ? t('settings.enabled') : t('settings.disabled') }}
            </span>
          </div>
          <CustomBackgroundSettings />
        </section>
        <!-- lyrics -->
        <section id="lyrics" class="settings-section">
          <div class="section-heading">
            <div>
              <h2>
                <SvgIcon
                  :name="sectionIcons.lyrics.name"
                  :size="sectionIcons.lyrics.size"
                  class-name="settings-heading-icon"
                />
                <span>{{ t('settings.lyrics') }}</span>
              </h2>
              <p>{{ t('settings.lyricsDescription') }}</p>
            </div>
          </div>
          <LyricsSettings />
        </section>
        <!-- desktop lyrics -->
        <section id="desktop-lyrics" class="settings-section">
          <div class="section-heading">
            <div>
              <h2>
                <SvgIcon
                  :name="sectionIcons['desktop-lyrics'].name"
                  :size="sectionIcons['desktop-lyrics'].size"
                  class-name="settings-heading-icon"
                />
                <span>{{ t('settings.desktopLyrics') }}</span>
              </h2>
              <p>{{ t('settings.desktopLyricsDescription') }}</p>
            </div>
          </div>
          <DesktopLyricsSettings :font-options="fontOptions" />
        </section>
        <!-- shortcuts -->
        <section id="shortcuts" class="settings-section">
          <div class="section-heading">
            <div>
              <h2>
                <SvgIcon
                  :name="sectionIcons.shortcuts.name"
                  :size="sectionIcons.shortcuts.size"
                  class-name="settings-heading-icon"
                />
                <span>{{ t('settings.shortcuts') }}</span>
              </h2>
              <p>{{ t('settings.shortcutsDescription') }}</p>
            </div>
          </div>
          <ShortcutSettings />
        </section>
        <!-- library -->
        <section id="library" class="settings-section">
          <div class="section-heading">
            <div>
              <h2>
                <SvgIcon
                  :name="sectionIcons.library.name"
                  :size="sectionIcons.library.size"
                  class-name="settings-heading-icon"
                />
                <span>{{ t('settings.library') }}</span>
              </h2>
              <p>{{ t('settings.libraryDescription') }}</p>
            </div>
          </div>
          <div class="settings-card">
            <LibrarySettings />
          </div>
        </section>
        <!-- cache -->
        <section id="cache" class="settings-section">
          <div class="section-heading">
            <div>
              <h2>
                <SvgIcon
                  :name="sectionIcons.cache.name"
                  :size="sectionIcons.cache.size"
                  class-name="settings-heading-icon"
                />
                <span>{{ t('settings.cacheManagement') }}</span>
              </h2>
              <p>{{ t('settings.cacheManagementDescription') }}</p>
            </div>
          </div>
          <div class="settings-card"><CacheSettings /></div>
        </section>
        <!-- system -->
        <section id="system" class="settings-section">
          <div class="section-heading">
            <div>
              <h2>
                <SvgIcon
                  :name="sectionIcons.system.name"
                  :size="sectionIcons.system.size"
                  class-name="settings-heading-icon"
                />
                <span>{{ t('settings.system') }}</span>
              </h2>
              <p>{{ t('settings.systemDescription') }}</p>
            </div>
          </div>
          <div class="settings-card"><SystemSettings /></div>
        </section>
        <!-- other -->
        <section id="other" class="settings-section">
          <div class="section-heading">
            <div>
              <h2>
                <SvgIcon
                  :name="sectionIcons.other.name"
                  :size="sectionIcons.other.size"
                  class-name="settings-heading-icon"
                />
                <span>{{ t('settings.other') }}</span>
              </h2>
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
            <div class="setting-row">
              <div>
                <h3>{{ t('settings.buildNumber') }}</h3>
              </div>
              <span class="select-text font-mono text-text">{{ BUILD_NUMBER }}</span>
            </div>
            <StatisticsSettings />
            <div class="setting-row">
              <h3 class="flex items-center gap-2">GitHub</h3>
              <div class="flex flex-wrap items-center justify-end gap-2">
                <a
                  :href="repositoryUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="secondary-button"
                >
                  <SvgIcon name="third-github" class-name="size-4 shrink-0" />
                  {{ t('settings.repository') }}
                </a>
                <a
                  :href="themeDocumentationUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="secondary-button"
                >
                  <SvgIcon name="third-github" class-name="size-4 shrink-0" />
                  {{ t('settings.themeDocumentation') }}
                </a>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </main>
  <BaseConfirmDialog
    v-model="resetThemeVisible"
    :title="t('settings.restoreDefault')"
    :message="t('settings.confirmResetTheme')"
    :confirm-text="t('settings.restoreDefault')"
    @confirm="ui.resetTheme"
  />
</template>

<style src="@/styles/settings.css"></style>

<style scoped>
.settings-page {
  /* Keep page padding and the sticky offset equal to avoid movement near scrollTop = 0. */
  --settings-top-offset: 2rem;
}
.settings-nav {
  position: sticky;
  top: var(--settings-top-offset);
  display: flex;
  flex: 0 0 11.5rem;
  align-self: flex-start;
  flex-direction: column;
  gap: 0.2rem;
  border-left: 1px solid var(--color-border);
  padding-left: 0.65rem;
}
.settings-nav-title {
  margin: 0 0 0.45rem 0.35rem;
  color: var(--color-text-l);
  font-size: 0.75rem;
  font-weight: 650;
  letter-spacing: 0.08em;
}
.settings-nav-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  border-radius: 7px;
  padding: 0.35rem 0.65rem;
  color: var(--color-text-l);
  font-size: 0.8575rem;
  line-height: 1.2;
  text-align: left;
}
.settings-nav-icon {
  display: inline-flex;
  width: 1.5rem;
  height: 1.5rem;
  flex: 0 0 1.5rem;
  align-items: center;
  justify-content: center;
  color: inherit;
}
.settings-nav-item:hover,
.settings-nav-item.active {
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
  color: var(--color-primary);
}
</style>
