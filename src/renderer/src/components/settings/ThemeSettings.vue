<script setup lang="ts">
import SettingCard from './SettingCard.vue'
import SettingRow from './SettingRow.vue'
import { computed } from 'vue'
import CustomThemeSettings from './CustomThemeSettings.vue'
import { useI18n } from 'vue-i18n'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import BaseColorPicker from '@/components/ui/BaseColorPicker.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useMessage } from '@/components/ui/useMessage'
import type { ColorMode } from '@/services/appearance'
import type { WindowMaterial } from '../../../../shared/windowMaterial'
import { presetColors } from '@/consts/color'
import {
  availableBackgroundThemes,
  getSystemBackgroundTheme,
  type SystemBackground
} from '@/components/background/systemBackgroundRegistry'
import { useUIStore } from '@/stores/ui/uiStore'

const ui = useUIStore()
const { t, locale } = useI18n()
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
const missingPluginTheme = computed(
  () =>
    typeof ui.systemBackground === 'string' &&
    ui.systemBackground.startsWith('plugin:') &&
    getSystemBackgroundTheme(ui.systemBackground).id === 'none'
)
type ThemeBackgroundChoice = SystemBackground | 'custom'
const themeBackgroundOptions = computed<
  {
    id: ThemeBackgroundChoice
    label: string
    preview?: string
    author?: string
    pluginId?: string
    duplicate?: boolean
  }[]
>(() => {
  const options = [
    { id: 'none' as const, label: t('settings.systemBackgroundNone') },
    { id: 'custom' as const, label: t('settings.appearanceModeCustom') },
    ...availableBackgroundThemes.value
      .filter((background) => background.id !== 'none')
      .map((background) => ({
        id: background.id,
        preview: background.pluginTheme?.data.background,
        author: background.pluginTheme?.author?.name,
        pluginId: background.pluginTheme?.pluginId,
        label: background.labelKey
          ? t(background.labelKey)
          : background.names?.[locale.value.startsWith('zh') ? 'zh' : 'en'] ||
            background.displayName ||
            background.id
      }))
  ]
  const counts = new Map<string, number>()
  for (const option of options)
    counts.set(
      option.label.trim().toLowerCase(),
      (counts.get(option.label.trim().toLowerCase()) ?? 0) + 1
    )
  return options.map((option) => ({
    ...option,
    duplicate: (counts.get(option.label.trim().toLowerCase()) ?? 0) > 1
  }))
})
const modeOptions = computed(() => [
  { label: t('settings.appearanceModeLight'), value: 'light' },
  { label: t('settings.appearanceModeDark'), value: 'dark' },
  { label: t('settings.followSystemTheme'), value: 'system' }
])
const selectedMode = computed<ColorMode>({
  get: () => ui.colorMode,
  set: (mode) => ui.setColorMode(mode)
})
const accentOptions = computed(() =>
  ['auto', 'user', 'scene', 'song'].map((value) => ({
    value,
    label: t(`settings.accentSource_${value}`)
  }))
)
function isThemeBackgroundSelected(value: ThemeBackgroundChoice): boolean {
  const background = ui.appearancePreferences.background
  return value === 'custom'
    ? background.type === 'image' || background.type === 'video'
    : value === 'none'
      ? background.type === 'none'
      : background.type === 'preset' && background.id === value
}
function selectThemeBackground(value: ThemeBackgroundChoice): void {
  if (!ui.selectThemeBackground(value)) return
  if (value === 'custom') emit('navigate', 'customBackground')
}
</script>

<template>
  <SettingCard>
    <p v-if="missingPluginTheme" role="status" class="px-5 py-3 text-sm text-text-l">
      {{ t('plugins.themeMissing') }}
    </p>
    <p v-if="ui.pluginThemeLoadFailed" role="alert" class="px-5 py-3 text-sm text-danger">
      {{ t('plugins.themeLoadFailed') }}
    </p>
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
      <SettingRow
        :label="t('settings.appearanceMode')"
        :description="t('settings.followSystemThemeDescription')"
      >
        <BaseSelect
          v-model="selectedMode"
          :options="modeOptions"
          :aria-label="t('settings.appearanceMode')"
          class="w-56"
          teleport
        />
      </SettingRow>
      <SettingRow
        :label="t('settings.accentSource')"
        :description="t('settings.accentSourceDescription')"
      >
        <BaseSelect
          v-model="ui.accentSource"
          :options="accentOptions"
          :aria-label="t('settings.accentSource')"
          class="w-56"
          teleport
        />
      </SettingRow>
      <SettingRow
        :label="t('settings.themeColor')"
        :description="t('settings.themeColorDescription')"
      >
        <div>
          <BaseColorPicker v-model="ui.customThemeColor" :presets="presetColors" teleport />
        </div>
      </SettingRow>
      <div class="setting-row theme-background-row">
        <div>
          <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h3>{{ t('settings.themeBackground') }}</h3>
            <BaseButton
              class="reset-button"
              size="sm"
              variant="ghost"
              @click="emit('navigate', 'plugins')"
            >
              {{ t('plugins.manageThemes') }}
            </BaseButton>
          </div>
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
              background.id === 'none'
                ? 'dark-preview'
                : background.id === 'custom'
                  ? 'custom-preview'
                  : `system-background-preview--${background.id}`,
              { selected: isThemeBackgroundSelected(background.id) }
            ]"
            :title="
              background.pluginId
                ? [
                    background.label,
                    background.author || t('plugins.authorUnknown'),
                    background.pluginId
                  ].join(' · ')
                : undefined
            "
            :aria-checked="isThemeBackgroundSelected(background.id)"
            role="radio"
            @click="selectThemeBackground(background.id)"
          >
            <span
              class="preview-window"
              :class="background.preview && 'plugin-theme-preview'"
              :style="background.preview ? { background: background.preview } : undefined"
            >
              <i />
              <b />
            </span>
            <span>{{ background.label }}</span>
            <span
              v-if="background.pluginId && background.duplicate"
              class="block break-all text-xs text-text-l"
            >
              {{ background.pluginId }}
            </span>
          </button>
        </div>
      </div>
    </div>
    <CustomThemeSettings v-if="ui.customThemes.length" />
    <SettingRow
      v-if="ui.effectiveCustomTheme && ui.effectiveCustomTheme.background !== 'inherit'"
      :label="t('settings.useThemeBackground')"
      :description="t('settings.useThemeBackgroundDescription')"
    >
      <BaseSwitch
        :model-value="ui.customThemePreviewActive || ui.themeBackgroundEnabled"
        :disabled="ui.customThemePreviewActive"
        @update:model-value="ui.themeBackgroundEnabled = $event === true"
      />
    </SettingRow>
  </SettingCard>
</template>
