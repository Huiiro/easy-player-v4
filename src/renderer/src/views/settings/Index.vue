<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { useUIStore } from '@/stores/ui/uiStore'
import { ENGINE_VERSION, VERSION } from '@/consts'
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

const ui = useUIStore()
const { locale, t } = useI18n()
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
  { id: 'lyrics', label: t('settings.lyrics') },
  { id: 'desktop-lyrics', label: t('settings.desktopLyrics') },
  { id: 'shortcuts', label: t('settings.shortcuts') },
  { id: 'library', label: t('settings.library') },
  { id: 'cache', label: t('settings.cacheManagement') },
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
          <PlayerAppearanceSettings />
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
          <ThemeSettings @navigate="navigateTo" />
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
          <CustomBackgroundSettings />
        </section>
        <!-- lyrics -->
        <section id="lyrics" class="settings-section">
          <div class="section-heading">
            <div>
              <h2>{{ t('settings.lyrics') }}</h2>
              <p>{{ t('settings.lyricsDescription') }}</p>
            </div>
          </div>
          <LyricsSettings />
        </section>
        <!-- desktop lyrics -->
        <section id="desktop-lyrics" class="settings-section">
          <div class="section-heading">
            <div>
              <h2>{{ t('settings.desktopLyrics') }}</h2>
              <p>{{ t('settings.desktopLyricsDescription') }}</p>
            </div>
          </div>
          <DesktopLyricsSettings :font-options="fontOptions" />
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
        <!-- library -->
        <section id="library" class="settings-section">
          <div class="section-heading">
            <div>
              <h2>{{ t('settings.library') }}</h2>
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
              <h2>{{ t('settings.cacheManagement') }}</h2>
              <p>{{ t('settings.cacheManagementDescription') }}</p>
            </div>
          </div>
          <div class="settings-card"><CacheSettings /></div>
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

<style src="@/styles/settings.css"></style>

<style scoped>
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
</style>
