<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import BaseColorPicker from '@/components/ui/BaseColorPicker.vue'
import { presetColors } from '@/consts/color'
import {
  systemBackgroundThemes,
  type SystemBackground
} from '@/components/background/systemBackgroundRegistry'
import { useUIStore } from '@/stores/ui/uiStore'

const ui = useUIStore()
const { t } = useI18n()
const emit = defineEmits<{ navigate: [sectionId: string] }>()
type ThemeBackgroundChoice = SystemBackground | 'light' | 'dark' | 'custom'
const themeBackgroundOptions = computed(() => [
  { id: 'light' as const, label: t('settings.appearanceModeLight') },
  { id: 'dark' as const, label: t('settings.appearanceModeDark') },
  { id: 'custom' as const, label: t('settings.appearanceModeCustom') },
  ...systemBackgroundThemes
    .filter((background) => background.id !== 'none')
    .map((background) => ({ ...background, label: t(background.labelKey) }))
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
    emit('navigate', 'customBackground')
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
</script>

<template>
  <div class="settings-card" :class="{ muted: ui.followSystemTheme || ui.useMica }">
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
    <div class="setting-row" :class="{ 'pointer-events-none opacity-55': ui.useMica }">
      <div>
        <h3>{{ t('settings.themeColor') }}</h3>
        <p>{{ t('settings.themeColorDescription') }}</p>
      </div>
      <div>
        <BaseColorPicker v-model="ui.customThemeColor" :presets="presetColors" teleport />
      </div>
    </div>
    <div
      class="setting-row theme-background-row"
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
  </div>
</template>
