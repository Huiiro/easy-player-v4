<script setup lang="ts">
import SettingGroup from '@/components/settings/SettingGroup.vue'
import SettingCard from './SettingCard.vue'
import SettingRow from './SettingRow.vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSlider from '@/components/ui/BaseSlider.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import BaseColorPicker from '@/components/ui/BaseColorPicker.vue'
import { presetColors } from '@/constants/colors'
import { useUIStore } from '@/stores/ui/uiStore'
import { useAnimationActivity } from '@/hooks/useAnimationActivity'

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
const previewHovered = ref(false)
const previewActive = useAnimationActivity(() => ui.pauseAnimationsOnBlur !== false)
const previewBackgroundVisible = computed(
  () => !ui.desktopLyricsStyles.autoHideBackground || previewHovered.value
)
</script>

<template>
  <SettingCard>
    <SettingGroup :title="t('settings.desktopLyricsPreview')">
      <div
        class="desktop-lyrics-preview-stage"
        @mouseenter="previewHovered = true"
        @mouseleave="previewHovered = false"
      >
        <div
          class="desktop-lyrics-preview"
          :class="{
            'desktop-lyrics-preview--background': previewBackgroundVisible,
            'desktop-lyrics-preview--sweep': ui.desktopLyricsStyles.sweep,
            'desktop-lyrics-preview--glow':
              ui.desktopLyricsStyles.glow && !ui.desktopLyricsStyles.sweep,
            'desktop-lyrics-preview--paused': !previewActive || ui.reduceMotion
          }"
          :style="{
            '--desktop-active': ui.desktopLyricsStyles.activeColor,
            '--desktop-inactive': ui.desktopLyricsStyles.inactiveColor,
            fontSize: `${ui.desktopLyricsStyles.fontSize}px`,
            fontWeight: ui.desktopLyricsStyles.fontBold ? 700 : 500,
            fontFamily: desktopLyricsPreviewFontFamily
          }"
        >
          <strong class="desktop-lyrics-preview-current">
            {{ t('settings.desktopLyricsPreviewLine') }}
            <span class="desktop-lyrics-preview-highlight" aria-hidden="true">
              {{ t('settings.desktopLyricsPreviewLine') }}
            </span>
          </strong>
          <span class="desktop-lyrics-preview-secondary">
            {{
              t(
                ui.desktopLyricsStyles.showTranslation
                  ? 'settings.desktopLyricsPreviewTranslation'
                  : 'settings.desktopLyricsPreviewNext'
              )
            }}
          </span>
        </div>
      </div>
    </SettingGroup>
    <SettingGroup :title="t('settings.groups.visibility')">
      <SettingRow
        :label="t('settings.desktopLyricsEnabled')"
        :description="t('settings.desktopLyricsEnabledDescription')"
      >
        <BaseSwitch v-model="ui.useDesktopLyrics" size="md" />
      </SettingRow>
    </SettingGroup>
    <SettingGroup :title="t('settings.groups.lyricStyle')" class="desktop-lyrics-style-settings">
      <SettingRow :label="t('settings.desktopLyricsFontFamily')">
        <BaseSelect
          v-model="ui.desktopLyricsStyles.fontFamily"
          :options="desktopLyricsFontOptions"
          :placeholder="t('settings.desktopLyricsFontInherit')"
          teleport
          class="desktop-lyrics-font-select w-64"
        />
      </SettingRow>
      <SettingRow :label="t('settings.desktopLyricsFontSize')">
        <div class="desktop-lyrics-size-control">
          <BaseSlider
            v-model="ui.desktopLyricsStyles.fontSize"
            :min="24"
            :max="64"
            :step="1"
            size="sm"
            :aria-label="t('settings.desktopLyricsFontSize')"
          />
          <strong>{{ ui.desktopLyricsStyles.fontSize }}px</strong>
        </div>
      </SettingRow>
      <div class="desktop-lyrics-colors setting-row-group">
        <SettingRow :label="t('settings.desktopLyricsActiveColor')">
          <BaseColorPicker
            v-model="ui.desktopLyricsStyles.activeColor"
            :presets="presetColors"
            teleport
            :show-value="false"
            :aria-label="t('settings.desktopLyricsActiveColor')"
          />
        </SettingRow>
        <SettingRow :label="t('settings.desktopLyricsInactiveColor')">
          <BaseColorPicker
            v-model="ui.desktopLyricsStyles.inactiveColor"
            :presets="presetColors"
            teleport
            :show-value="false"
            :aria-label="t('settings.desktopLyricsInactiveColor')"
          />
        </SettingRow>
      </div>
      <div class="desktop-lyrics-toggles">
        <div class="desktop-lyrics-effect-row setting-row-group">
          <SettingRow :label="t('settings.desktopLyricsBold')">
            <BaseSwitch
              v-model="ui.desktopLyricsStyles.fontBold"
              :aria-label="t('settings.desktopLyricsBold')"
            />
          </SettingRow>
          <SettingRow :label="t('settings.desktopLyricsGlow')">
            <BaseSwitch
              v-model="ui.desktopLyricsStyles.glow"
              :aria-label="t('settings.desktopLyricsGlow')"
            />
          </SettingRow>
        </div>
        <div class="desktop-lyrics-effect-row setting-row-group">
          <SettingRow :label="t('settings.desktopLyricsSweep')">
            <BaseSwitch
              v-model="ui.desktopLyricsStyles.sweep"
              :aria-label="t('settings.desktopLyricsSweep')"
            />
          </SettingRow>
          <SettingRow :label="t('settings.desktopLyricsTranslation')">
            <BaseSwitch
              v-model="ui.desktopLyricsStyles.showTranslation"
              :aria-label="t('settings.desktopLyricsTranslation')"
            />
          </SettingRow>
        </div>
        <div class="desktop-lyrics-effect-row setting-row-group">
          <SettingRow :label="t('settings.desktopLyricsAutoHide')">
            <BaseSwitch
              v-model="ui.desktopLyricsStyles.autoHideBackground"
              :aria-label="t('settings.desktopLyricsAutoHide')"
            />
          </SettingRow>
        </div>
      </div>
    </SettingGroup>
  </SettingCard>
</template>

<style scoped>
.desktop-lyrics-style-settings :deep(.setting-row) {
  min-height: 56px;
  padding-block: 0.75rem;
}
.desktop-lyrics-font-select {
  width: min(100%, 16rem);
}
.desktop-lyrics-size-control {
  display: flex;
  min-width: 0;
  width: min(100%, 16rem);
  align-items: center;
  gap: 0.75rem;
}
.desktop-lyrics-size-control strong {
  min-width: 3rem;
  color: var(--color-text-l);
  font-size: 0.8125rem;
  font-weight: 550;
  text-align: right;
}
.desktop-lyrics-size-control :deep(.ep-slider) {
  flex: 1;
  min-width: 0;
}
.desktop-lyrics-colors,
.desktop-lyrics-effect-row {
  display: grid;
  min-width: 0;
}
.desktop-lyrics-colors {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.desktop-lyrics-effect-row {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.desktop-lyrics-preview-stage {
  margin: 0 1.25rem 1.25rem;
  padding: 0.75rem 1rem;
  overflow: hidden;
  border-radius: 12px;
}
.desktop-lyrics-preview {
  display: grid;
  justify-items: center;
  min-width: 0;
  place-content: center;
  gap: 0.35rem;
  width: 100%;
  border-radius: 12px;
  padding: clamp(0.5rem, 0.35em, 1rem) 1rem;
  background: transparent;
  transition: background-color var(--motion-duration-standard);
  text-align: center;
  overflow-wrap: anywhere;
}
.desktop-lyrics-preview--background {
  background: rgb(0 0 0 / 30%);
}
.desktop-lyrics-preview-current {
  position: relative;
  display: inline-block;
  max-width: 100%;
  color: var(--desktop-inactive);
  font-weight: inherit;
  line-height: 1.3;
}
.desktop-lyrics-preview-highlight {
  position: absolute;
  inset: 0;
  color: var(--desktop-active);
  clip-path: inset(0);
}
.desktop-lyrics-preview--glow .desktop-lyrics-preview-highlight {
  text-shadow: 0 0 8px var(--desktop-active);
}
.desktop-lyrics-preview--sweep .desktop-lyrics-preview-highlight {
  animation: desktop-lyrics-preview-sweep 4s linear infinite;
}
.desktop-lyrics-preview--paused .desktop-lyrics-preview-highlight {
  animation-play-state: paused;
}
.desktop-lyrics-preview-secondary {
  max-width: 100%;
  color: var(--desktop-inactive);
  line-height: 1.3;
}
@keyframes desktop-lyrics-preview-sweep {
  0%,
  10% {
    clip-path: inset(0 100% 0 0);
  }
  90%,
  100% {
    clip-path: inset(0);
  }
}
@media (max-width: 640px) {
  .desktop-lyrics-colors :deep(.setting-row),
  .desktop-lyrics-toggles :deep(.setting-row) {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }
}
</style>
