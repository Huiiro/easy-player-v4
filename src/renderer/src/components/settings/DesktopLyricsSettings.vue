<script setup lang="ts">
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
          <label class="flex items-center gap-2 my-3 text-xs text-text-l">
            <span>{{ t('settings.desktopLyricsSweep') }}</span>
            <BaseSwitch v-model="ui.desktopLyricsStyles.sweep" :size="'sm'" />
          </label>
        </div>
      </div>
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
</template>

<style scoped>
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
  line-height: 1.3;
}
.desktop-lyrics-preview--glow {
  text-shadow: 0 0 8px var(--desktop-active);
}
.desktop-lyrics-preview--sweep {
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
</style>
