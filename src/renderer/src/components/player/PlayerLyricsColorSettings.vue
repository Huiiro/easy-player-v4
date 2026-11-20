<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingRow from '@/components/settings/SettingRow.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import BaseColorPicker from '@/components/ui/BaseColorPicker.vue'
import BaseDisclosure from '@/components/ui/BaseDisclosure.vue'
import { useUIStore } from '@/stores/ui/uiStore'

const ui = useUIStore()
const { t } = useI18n()

const previewStyle = computed(() => ({
  '--lrc-default': ui.lyricsColors.default,
  '--lrc-highlight': ui.lyricsColors.highlight,
  '--lrc-translate': ui.lyricsColors.translation
}))
</script>

<template>
  <BaseDisclosure class="lyrics-colors" :label="t('playerPanel.lyricColorsTitle')">
    <div class="space-y-4 pt-1.5 pb-2.5">
      <div class="lyrics-color-preview" :style="previewStyle">
        <p class="lyrics-color-preview__normal">{{ t('playerPanel.lyricColorPreviewPrevious') }}</p>
        <p class="lyrics-color-preview__highlight">
          {{ t('playerPanel.lyricColorPreviewCurrent') }}
        </p>
        <p class="lyrics-color-preview__translation">
          {{ t('playerPanel.lyricColorPreviewTranslation') }}
        </p>
      </div>

      <div class="space-y-3">
        <div class="flex items-center justify-between gap-4">
          <label class="text-sm text-text-l">{{ t('playerPanel.lyricColorDefault') }}</label>
          <BaseColorPicker
            v-model="ui.lyricsColors.default"
            :aria-label="t('playerPanel.lyricColorDefault')"
            show-alpha
          />
        </div>
        <div class="flex items-center justify-between gap-4">
          <label class="text-sm text-text-l">{{ t('playerPanel.lyricColorHighlight') }}</label>
          <BaseColorPicker
            v-model="ui.lyricsColors.highlight"
            :aria-label="t('playerPanel.lyricColorHighlight')"
            show-alpha
          />
        </div>
        <div class="flex items-center justify-between gap-4">
          <label class="text-sm text-text-l">{{ t('playerPanel.lyricColorTranslation') }}</label>
          <BaseColorPicker
            v-model="ui.lyricsColors.translation"
            :aria-label="t('playerPanel.lyricColorTranslation')"
            show-alpha
          />
        </div>
      </div>

      <SettingRow
        v-slot="{ descriptionId }"
        class="appearance-action-row"
        :label="t('playerPanel.lyricColorOverrideAuto')"
        :description="t('playerPanel.lyricColorOverrideAutoHint')"
      >
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="appearance-icon-action ep-focusable"
            :aria-label="t('playerPanel.lyricColorsReset')"
            :title="t('playerPanel.lyricColorsReset')"
            @click="ui.resetLyricsColors()"
          >
            <SvgIcon name="common-refresh" class-name="size-4" />
          </button>
          <button
            type="button"
            role="switch"
            class="appearance-icon-action ep-focusable"
            :aria-label="t('playerPanel.lyricColorOverrideAuto')"
            :aria-describedby="descriptionId"
            :title="t('playerPanel.lyricColorOverrideAuto')"
            :aria-checked="ui.lyricsColors.overrideAutoContrast"
            @click="ui.lyricsColors.overrideAutoContrast = !ui.lyricsColors.overrideAutoContrast"
          >
            <SvgIcon name="common-dark-sun" class-name="size-6" />
          </button>
        </div>
      </SettingRow>
    </div>
  </BaseDisclosure>
</template>

<style scoped>
.lyrics-color-preview {
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--color-border) 75%, transparent);
  border-radius: 0.9rem;
  padding: 1rem;
  background:
    radial-gradient(circle at 75% 20%, rgb(255 255 255 / 10%), transparent 42%),
    linear-gradient(135deg, rgb(16 23 35), rgb(34 28 48));
  text-align: center;
}
.lyrics-color-preview p {
  margin: 0;
  line-height: 1.45;
}
.lyrics-color-preview__normal {
  color: var(--lrc-default);
  font-size: 0.95rem;
}
.lyrics-color-preview__highlight {
  color: var(--lrc-highlight);
  margin-top: 0.3rem !important;
  font-size: 1.35rem;
  font-weight: 700;
  text-shadow: 0 0 10px color-mix(in srgb, var(--lrc-highlight) 46%, transparent);
}
.lyrics-color-preview__translation {
  color: var(--lrc-translate);
  margin-top: 0.2rem !important;
  font-size: 0.78rem;
}
</style>
