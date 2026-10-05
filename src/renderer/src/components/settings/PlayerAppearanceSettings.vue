<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { PlayerBgType, PlayerCoverStyle } from '@/consts'
import { useUIStore } from '@/stores/ui/uiStore'

const ui = useUIStore()
const { t } = useI18n()
const playerBackground = computed<PlayerBgType>({
  get: () => ui.playerBgType,
  set: (value) => {
    ui.setPlayerBgType(value)
  }
})
const playerCoverStyle = computed<PlayerCoverStyle>({
  get: () => ui.playerCoverStyle,
  set: (value) => ui.setPlayerCoverStyle(value)
})
const openFooterAnywhere = computed({
  get: () => ui.footerOpenMode === 'cover',
  set: (enabled: boolean) => (ui.footerOpenMode = enabled ? 'cover' : 'all')
})
</script>

<template>
  <div class="settings-card">
    <div class="setting-row setting-row-stack">
      <div>
        <h3>{{ t('settings.playerBackgroundStyle') }}</h3>
        <p>{{ t('settings.playerBackgroundStyleDescription') }}</p>
      </div>
      <div
        class="theme-options"
        role="radiogroup"
        :aria-label="t('settings.playerBackgroundStyle')"
      >
        <button
          type="button"
          class="theme-option album-background-preview"
          :class="{ selected: playerBackground === PlayerBgType.ALBUM }"
          :aria-checked="playerBackground === PlayerBgType.ALBUM"
          role="radio"
          @click="playerBackground = PlayerBgType.ALBUM"
        >
          <span class="preview-window"><i /><b /></span>
          <span>{{ t('settings.playerBackgroundAlbum') }}</span>
        </button>
        <button
          type="button"
          class="theme-option ambient-background-preview"
          :class="{ selected: playerBackground === PlayerBgType.AMBIENT }"
          :aria-checked="playerBackground === PlayerBgType.AMBIENT"
          role="radio"
          @click="playerBackground = PlayerBgType.AMBIENT"
        >
          <span class="preview-window"><i /><b /></span>
          <span>{{ t('settings.playerBackgroundAmbient') }}</span>
        </button>
        <button
          type="button"
          class="theme-option liquid-background-preview"
          :class="{ selected: playerBackground === PlayerBgType.LIQUID }"
          :aria-checked="playerBackground === PlayerBgType.LIQUID"
          role="radio"
          @click="playerBackground = PlayerBgType.LIQUID"
        >
          <span class="preview-window"><i /><b /><em /></span>
          <span>{{ t('settings.playerBackgroundLiquid') }}</span>
        </button>
      </div>
    </div>
    <div class="setting-row setting-row-stack">
      <div>
        <h3>{{ t('settings.playerCoverStyle') }}</h3>
        <p>{{ t('settings.playerCoverStyleDescription') }}</p>
      </div>
      <div class="theme-options" role="radiogroup" :aria-label="t('settings.playerCoverStyle')">
        <button
          type="button"
          class="theme-option standard-cover-preview"
          :class="{ selected: playerCoverStyle === PlayerCoverStyle.STANDARD }"
          :aria-checked="playerCoverStyle === PlayerCoverStyle.STANDARD"
          role="radio"
          @click="playerCoverStyle = PlayerCoverStyle.STANDARD"
        >
          <span class="preview-window">
            <span class="cover-preview-artwork" aria-hidden="true" />
            <span class="cover-preview-lyrics" aria-hidden="true">
              <span /><span /><span /><span />
            </span>
          </span>
          <span>{{ t('settings.playerCoverStyleStandard') }}</span>
        </button>
        <button
          type="button"
          class="theme-option vinyl-cover-preview"
          :class="{ selected: playerCoverStyle === PlayerCoverStyle.VINYL }"
          :aria-checked="playerCoverStyle === PlayerCoverStyle.VINYL"
          role="radio"
          @click="playerCoverStyle = PlayerCoverStyle.VINYL"
        >
          <span class="preview-window">
            <span class="cover-preview-artwork" aria-hidden="true" />
            <span class="cover-preview-lyrics" aria-hidden="true">
              <span /><span /><span /><span />
            </span>
          </span>
          <span>{{ t('settings.playerCoverStyleVinyl') }}</span>
        </button>
      </div>
    </div>
    <div class="setting-row">
      <div>
        <h3>{{ t('settings.autoAdjustLyricsDisplay') }}</h3>
        <p>{{ t('settings.autoAdjustLyricsDisplayDescription') }}</p>
      </div>
      <BaseSwitch v-model="ui.autoAdjustLyricsDisplay" size="md" />
    </div>
    <div class="setting-row">
      <div>
        <h3>{{ t('settings.footerOpenAnywhere') }}</h3>
        <p>{{ t('settings.footerOpenModeDescription') }}</p>
      </div>
      <BaseSwitch v-model="openFooterAnywhere" size="md" />
    </div>
    <div class="setting-row">
      <div>
        <h3>{{ t('settings.autoHideFooter') }}</h3>
        <p>{{ t('settings.autoHideFooterDescription') }}</p>
      </div>
      <BaseSwitch v-model="ui.autoHideFooter" size="md" />
    </div>
  </div>
</template>

<style scoped>
.album-background-preview .preview-window {
  background: linear-gradient(135deg, #6e4467, #171524);
}
.album-background-preview i {
  background: linear-gradient(135deg, #f5a4a8, #553a73);
}
.album-background-preview b {
  background: rgb(255 255 255 / 15%);
}
.standard-cover-preview .preview-window,
.vinyl-cover-preview .preview-window {
  display: grid;
  grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr);
  align-items: center;
  gap: 5px;
  background: radial-gradient(circle at 25% 45%, rgb(111 73 121 / 0.35), transparent 55%), #161923;
}
.cover-preview-artwork {
  position: relative;
  display: block;
  width: min(100%, 30px);
  aspect-ratio: 1;
  justify-self: center;
}
.standard-cover-preview .cover-preview-artwork {
  border-radius: 4px;
  background: linear-gradient(135deg, #df9fa7, #594272);
}
.vinyl-cover-preview .cover-preview-artwork {
  border-radius: 50%;
  background:
    repeating-radial-gradient(circle, rgb(255 255 255 / 0.045) 0 1px, transparent 2px 4px),
    radial-gradient(circle, #282b31, #111318 75%);
  box-shadow: 0 0 0 1px rgb(255 255 255 / 0.13);
}
.vinyl-cover-preview .cover-preview-artwork::after {
  position: absolute;
  inset: 29%;
  border: 2px solid #171a20;
  border-radius: 50%;
  background: linear-gradient(135deg, #df9fa7, #594272);
  content: '';
}
.cover-preview-lyrics {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}
.cover-preview-lyrics span {
  display: block;
  width: 78%;
  height: 3px;
  border-radius: 999px;
  background: rgb(231 224 236 / 0.32);
}
.cover-preview-lyrics span:nth-child(2) {
  width: 96%;
  height: 4px;
  background: rgb(248 241 250 / 0.9);
}
.cover-preview-lyrics span:nth-child(3) {
  width: 88%;
}
.cover-preview-lyrics span:nth-child(4) {
  width: 60%;
}
.ambient-background-preview .preview-window {
  background:
    radial-gradient(circle at 20% 25%, #356fa9, transparent 48%),
    radial-gradient(circle at 80% 70%, #984e85, transparent 55%), #141827;
}
.ambient-background-preview i {
  background: rgb(255 255 255 / 17%);
}
.ambient-background-preview b {
  background: rgb(255 255 255 / 10%);
}
.liquid-background-preview .preview-window {
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(ellipse at 20% 32%, #467fcb 0%, transparent 48%),
    radial-gradient(ellipse at 82% 68%, #c54c90 0%, transparent 52%),
    radial-gradient(ellipse at 56% 8%, #43b9a1 0%, transparent 42%), #151827;
}
.liquid-background-preview i,
.liquid-background-preview b,
.liquid-background-preview em {
  position: absolute;
  display: block;
  border-radius: 999px;
  filter: blur(5px);
}
.liquid-background-preview i {
  inset: 20% 45% 18% -8%;
  background: rgb(130 183 255 / 50%);
}
.liquid-background-preview b {
  inset: 42% -12% -18% 40%;
  background: rgb(255 121 198 / 42%);
}
.liquid-background-preview em {
  inset: -20% 26% 56% 30%;
  background: rgb(111 255 207 / 35%);
}
.default-background-preview .preview-window {
  background: #1e2427;
}
.default-background-preview i {
  background: #30383d;
}
.default-background-preview b {
  background: #283035;
}
</style>
