<script setup lang="ts">
import { computed } from 'vue'
import CustomThemeSettings from './CustomThemeSettings.vue'
import { useI18n } from 'vue-i18n'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import BaseColorPicker from '@/components/ui/BaseColorPicker.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { useMessage } from '@/components/ui/useMessage'
import type { WindowMaterial } from '../../../../shared/windowMaterial'
import { presetColors } from '@/consts/color'
import {
  systemBackgroundThemes,
  type SystemBackground
} from '@/components/background/systemBackgroundRegistry'
import { useUIStore } from '@/stores/ui/uiStore'

const ui = useUIStore()
const { t } = useI18n()
const { error } = useMessage()
const windowMaterialOptions = computed(() =>
  ui.availableWindowMaterials.map((material) => ({
    value: material,
    label: t(`settings.windowMaterial_${material}`)
  }))
)
async function selectWindowMaterial(value: unknown): Promise<void> {
  if (typeof value !== 'string' || !ui.availableWindowMaterials.includes(value as WindowMaterial))
    return
  try {
    await ui.setNativeWindowMaterial(value as WindowMaterial)
  } catch {
    error(t('settings.windowMaterialFailed'))
  }
}
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
  if (!ui.selectThemeBackground(value)) return
  if (value === 'custom') emit('navigate', 'customBackground')
}
</script>

<template>
  <div class="settings-card">
    <div v-if="ui.availableWindowMaterials.length > 1" class="setting-row">
      <div>
        <h3>{{ t('settings.windowMaterial') }}</h3>
        <p>{{ t('settings.windowMaterialDescription') }}</p>
      </div>
      <BaseSelect
        :model-value="ui.nativeWindowMaterial"
        :options="windowMaterialOptions"
        :disabled="ui.windowMaterialPending"
        :aria-label="t('settings.windowMaterial')"
        class="w-56"
        teleport
        @update:model-value="selectWindowMaterial"
      />
    </div>
    <div>
      <div class="setting-row" :class="{ 'opacity-55': ui.useMica }">
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
      <div class="setting-row">
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
        :class="{ 'pointer-events-none opacity-55': ui.followSystemTheme || ui.useMica }"
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
            :disabled="ui.followSystemTheme || ui.useMica"
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
    <hr class="mx-5 my-4 border-0 border-t border-border" />
    <CustomThemeSettings />
  </div>
</template>
