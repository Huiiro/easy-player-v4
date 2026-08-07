<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseColorPicker from '@/components/ui/BaseColorPicker.vue'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { useUIStore } from '@/stores/ui/uiStore'

const model = defineModel<boolean>({ default: false })
const ui = useUIStore()
const { t } = useI18n()

const previewStyle = computed(() => ({
  '--lrc-default': ui.lyricsColors.default,
  '--lrc-highlight': ui.lyricsColors.highlight,
  '--lrc-translate': ui.lyricsColors.translation
}))
</script>

<template>
  <BaseDialog v-model="model" :title="t('playerPanel.lyricColorsTitle')" width="max-w-md">
    <div class="space-y-4 px-4 pb-4">
      <div class="space-y-3">
        <div class="flex items-center justify-between gap-4">
          <label class="text-sm text-text-l">{{ t('playerPanel.lyricColorDefault') }}</label>
          <BaseColorPicker v-model="ui.lyricsColors.default" show-alpha show-value teleport />
        </div>
        <div class="flex items-center justify-between gap-4">
          <label class="text-sm text-text-l">{{ t('playerPanel.lyricColorHighlight') }}</label>
          <BaseColorPicker v-model="ui.lyricsColors.highlight" show-alpha show-value teleport />
        </div>
        <div class="flex items-center justify-between gap-4">
          <label class="text-sm text-text-l">{{ t('playerPanel.lyricColorTranslation') }}</label>
          <BaseColorPicker v-model="ui.lyricsColors.translation" show-alpha show-value teleport />
        </div>
      </div>

      <div class="flex items-start justify-between gap-4 rounded-xl bg-hover/60 px-3 py-2.5">
        <div>
          <p class="text-sm font-medium">{{ t('playerPanel.lyricColorOverrideAuto') }}</p>
          <p class="mt-0.5 text-xs text-text-l">
            {{ t('playerPanel.lyricColorOverrideAutoHint') }}
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <button
            class="rounded-md px-2 py-1 text-xs text-text-l transition hover:bg-bg hover:text-text"
            @click="ui.resetLyricsColors()"
          >
            {{ t('playerPanel.lyricColorsReset') }}
          </button>
          <BaseSwitch v-model="ui.lyricsColors.overrideAutoContrast" size="sm" />
        </div>
      </div>

      <div class="lyrics-color-preview" :style="previewStyle">
        <p class="lyrics-color-preview__normal">{{ t('playerPanel.lyricColorPreviewPrevious') }}</p>
        <p class="lyrics-color-preview__highlight">
          {{ t('playerPanel.lyricColorPreviewCurrent') }}
        </p>
        <p class="lyrics-color-preview__translation">
          {{ t('playerPanel.lyricColorPreviewTranslation') }}
        </p>
      </div>
    </div>
  </BaseDialog>
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
