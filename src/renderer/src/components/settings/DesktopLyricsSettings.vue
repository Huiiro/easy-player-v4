<script setup lang="ts">
import SettingCard from './SettingCard.vue'
import SettingRow from './SettingRow.vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSlider from '@/components/ui/BaseSlider.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import BaseColorPicker from '@/components/ui/BaseColorPicker.vue'
import { presetColors } from '@/consts/color'
import { useUIStore } from '@/stores/ui/uiStore'

const props = defineProps<{ fontOptions: { label: string; value: string }[] }>()
const ui = useUIStore()
const { t } = useI18n()
const desktopLyricsFontOptions = computed(() => [
  { label: t('settings.desktopLyricsFontInherit'), value: '' },
  ...props.fontOptions.filter((opt) => opt.value !== '')
])
const desktopLyricsPreviewFontFamily = computed(() =>
  ui.resolveFontStack(ui.desktopLyricsStyles.fontFamily || ui.customFontFamily)
)
const desktopLyricsPreviewFontSize = computed(() =>
  Math.max(13, Math.round(ui.desktopLyricsStyles.fontSize * 0.55))
)
</script>

<template>
  <SettingCard>
    <SettingRow
      :label="t('settings.desktopLyricsEnabled')"
      :description="t('settings.desktopLyricsEnabledDescription')"
    >
      <BaseSwitch v-model="ui.useDesktopLyrics" size="md" />
    </SettingRow>
    <div class="desktop-lyrics-layout">
      <div class="desktop-lyrics-controls">
        <div class="desktop-lyrics-font-row">
          <span class="desktop-lyrics-label">{{ t('settings.desktopLyricsFontFamily') }}</span>
          <BaseSelect
            v-model="ui.desktopLyricsStyles.fontFamily"
            :options="desktopLyricsFontOptions"
            :placeholder="t('settings.desktopLyricsFontInherit')"
            teleport
            class="w-64"
          />
        </div>
        <div class="desktop-lyrics-size-row">
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
        </div>
        <div class="desktop-lyrics-colors">
          <label class="desktop-lyrics-color-control">
            <span>{{ t('settings.desktopLyricsActiveColor') }}</span>
            <BaseColorPicker
              v-model="ui.desktopLyricsStyles.activeColor"
              :presets="presetColors"
              teleport
            />
          </label>
          <label class="desktop-lyrics-color-control">
            <span>{{ t('settings.desktopLyricsInactiveColor') }}</span>
            <BaseColorPicker
              v-model="ui.desktopLyricsStyles.inactiveColor"
              :presets="presetColors"
              teleport
            />
          </label>
        </div>
        <div class="desktop-lyrics-toggles">
          <label class="desktop-lyrics-toggle">
            <span>{{ t('settings.desktopLyricsBold') }}</span>
            <BaseSwitch v-model="ui.desktopLyricsStyles.fontBold" size="sm" />
          </label>
          <label class="desktop-lyrics-toggle">
            <span>{{ t('settings.desktopLyricsGlow') }}</span>
            <BaseSwitch v-model="ui.desktopLyricsStyles.glow" size="sm" />
          </label>
          <label class="desktop-lyrics-toggle">
            <span>{{ t('settings.desktopLyricsSweep') }}</span>
            <BaseSwitch v-model="ui.desktopLyricsStyles.sweep" size="sm" />
          </label>
          <label class="desktop-lyrics-toggle">
            <span>{{ t('settings.desktopLyricsTranslation') }}</span>
            <BaseSwitch v-model="ui.desktopLyricsStyles.showTranslation" size="sm" />
          </label>
          <label class="desktop-lyrics-toggle">
            <span>{{ t('settings.desktopLyricsAutoHide') }}</span>
            <BaseSwitch v-model="ui.desktopLyricsStyles.autoHideBackground" size="sm" />
          </label>
        </div>
      </div>
      <div class="desktop-lyrics-preview-panel">
        <span class="desktop-lyrics-preview-label">{{ t('settings.desktopLyricsPreview') }}</span>
        <div
          class="desktop-lyrics-preview"
          :style="{
            '--desktop-active': ui.desktopLyricsStyles.activeColor,
            '--desktop-inactive': ui.desktopLyricsStyles.inactiveColor,
            '--desktop-size': `${desktopLyricsPreviewFontSize}px`,
            fontFamily: desktopLyricsPreviewFontFamily
          }"
        >
          <strong
            :class="[
              ui.desktopLyricsStyles.glow &&
                !ui.desktopLyricsStyles.sweep &&
                'desktop-lyrics-preview--glow',
              ui.desktopLyricsStyles.sweep && 'desktop-lyrics-preview--sweep'
            ]"
            :style="{ fontWeight: ui.desktopLyricsStyles.fontBold ? 700 : 500 }"
            >{{ t('settings.desktopLyricsPreviewLine') }}</strong
          >
          <span
            v-if="ui.desktopLyricsStyles.showTranslation"
            :style="{ fontWeight: ui.desktopLyricsStyles.fontBold ? 700 : 500 }"
          >
            {{ t('settings.desktopLyricsPreviewTranslation') }}
          </span>
          <span v-else :style="{ fontWeight: ui.desktopLyricsStyles.fontBold ? 700 : 500 }">
            {{ t('settings.desktopLyricsPreviewNext') }}
          </span>
        </div>
      </div>
    </div>
  </SettingCard>
</template>

<style scoped>
.desktop-lyrics-layout {
  display: grid;
  gap: 1.5rem;
  padding: 1.25rem;
}
.desktop-lyrics-controls {
  min-width: 0;
}
.desktop-lyrics-font-row {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.desktop-lyrics-label,
.desktop-lyrics-color-control,
.desktop-lyrics-toggle {
  color: var(--color-text-l);
  font-size: 0.8125rem;
}
.desktop-lyrics-font-select {
  width: min(100%, 15rem);
}
.desktop-lyrics-size-row,
.desktop-lyrics-colors,
.desktop-lyrics-toggles {
  margin-top: 1.25rem;
}
.desktop-lyrics-colors,
.desktop-lyrics-toggles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem;
}
.desktop-lyrics-color-control,
.desktop-lyrics-toggle {
  display: flex;
  min-width: 0;
  min-height: 2.5rem;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.desktop-lyrics-color-control {
  align-items: flex-start;
  flex-direction: column;
}
.desktop-lyrics-toggle--wide {
  grid-column: 1 / -1;
}
.desktop-lyrics-preview-panel {
  display: grid;
  min-width: 0;
  align-content: start;
  gap: 0.6rem;
}
.desktop-lyrics-preview-label {
  color: var(--color-text-l);
  font-size: 0.75rem;
}
.desktop-lyrics-preview {
  display: grid;
  min-height: 160px;
  place-content: center;
  gap: 0.35rem;
  width: 100%;
  border-radius: 12px;
  padding: 1rem;
  background: linear-gradient(135deg, rgb(15 20 30 / 96%), rgb(38 28 56 / 88%));
  text-align: center;
  overflow-wrap: anywhere;
}
.desktop-lyrics-preview strong {
  color: var(--desktop-active);
  font-size: var(--desktop-size);
  line-height: 1.3;
}
.desktop-lyrics-preview--glow {
  text-shadow: 0 0 8px var(--desktop-active);
}
.desktop-lyrics-preview strong.desktop-lyrics-preview--sweep {
  color: transparent;
  background: linear-gradient(90deg, var(--desktop-active) 0 56%, var(--desktop-inactive) 56% 100%);
  background-clip: text;
  -webkit-background-clip: text;
}
.desktop-lyrics-preview span {
  color: var(--desktop-inactive);
  font-size: var(--desktop-size);
  line-height: 1.3;
}
@media (min-width: 1050px) {
  .desktop-lyrics-layout {
    grid-template-columns: minmax(0, 1.3fr) minmax(15rem, 0.8fr);
  }
}
@media (max-width: 600px) {
  .desktop-lyrics-font-row {
    align-items: stretch;
    flex-direction: column;
  }
  .desktop-lyrics-font-select {
    width: 100%;
  }
  .desktop-lyrics-colors,
  .desktop-lyrics-toggles {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
