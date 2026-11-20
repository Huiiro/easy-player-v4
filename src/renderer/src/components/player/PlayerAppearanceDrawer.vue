<script setup lang="ts">
import SettingRow from '@/components/settings/SettingRow.vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseDrawer from '@/components/ui/BaseDrawer.vue'
import BaseSegmentedControl from '@/components/ui/BaseSegmentedControl.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { PlayerBgType, PlayerCoverStyle, PlayerCoverEffect } from '@/constants'
import { useUIStore } from '@/stores/ui/uiStore'
import { usePlayerStore } from '@/stores/player/playerStore'
import { useAppearanceFontOptions } from './useAppearanceFontOptions'
import PlayerAppearanceSlider from './PlayerAppearanceSlider.vue'
import PlayerCheerSettings from './PlayerCheerSettings.vue'
import PlayerLyricsColorSettings from './PlayerLyricsColorSettings.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'

defineProps<{ bpm: number }>()
const open = defineModel<boolean>({ required: true })
const ui = useUIStore()
const player = usePlayerStore()
const { t } = useI18n()
const fontOptions = useAppearanceFontOptions()
const tabs = computed(
  () =>
    [
      { value: 'artwork', label: t('settings.groups.artwork') },
      { value: 'lyrics', label: t('settings.groups.lyricVisuals') }
    ] as const
)
const activeTab = ref<'artwork' | 'lyrics'>('artwork')
const lyricSourceOptions = computed(() =>
  (['auto', 'embedded', 'database', 'local', 'network'] as const).map((value) => ({
    value,
    label: t(value === 'auto' ? 'playerPanel.lyricSourceAuto' : `lyrics.source.${value}`)
  }))
)
const lyricScale = computed(() => ui.lyricsFontSize / 2.4)
const lyricSpacing = computed(() => ui.lyricsFontPadding / 30)
const alignmentOptions = computed(() => [
  { label: t('playerPanel.alignLeft'), value: 'left' },
  { label: t('playerPanel.alignCenter'), value: 'center' },
  { label: t('playerPanel.alignRight'), value: 'right' }
])
const lyricEffectOptions = computed(() => [
  { label: t('playerPanel.lyricEffectNone'), value: 'none' },
  { label: t('playerPanel.lyricEffectGlow'), value: 'glow' },
  { label: t('playerPanel.lyricEffectFollow'), value: 'follow' }
])
const playerLayoutOptions = computed(() => [
  { label: t('settings.playerLayoutClassic'), value: 'classic' },
  { label: t('settings.playerLayoutBottom'), value: 'bottom' }
])
const playerLyricsFontOptions = computed(() => [
  { label: t('settings.playerLyricsFontInherit'), value: '' },
  ...fontOptions.value.filter((option) => option.value !== '')
])
const playerLyricsFontWeightOptions = computed(() => [
  { label: t('settings.lyricsFontWeightLight'), value: 300 },
  { label: t('settings.lyricsFontWeightRegular'), value: 400 },
  { label: t('settings.lyricsFontWeightMedium'), value: 500 },
  { label: t('settings.lyricsFontWeightSemibold'), value: 600 },
  { label: t('settings.lyricsFontWeightBold'), value: 700 },
  { label: t('settings.lyricsFontWeightExtraBold'), value: 800 }
])
const spectrumStyleOptions = computed(() => [
  { label: t('settings.playerSpectrumBars'), value: 'bars' },
  { label: t('settings.playerSpectrumDots'), value: 'dots' }
])
const karaokeAnimationOptions = computed(() => [
  { label: t('settings.karaokeAnimationWave'), value: 'wave' },
  { label: t('settings.karaokeAnimationFloat'), value: 'float' }
])
const coverEffectOptions = computed(() => [
  { label: t('settings.playerCoverEffectNone'), value: PlayerCoverEffect.NONE },
  { label: t('settings.playerCoverEffectGlow'), value: PlayerCoverEffect.GLOW }
])
const playerCoverEffect = computed<PlayerCoverEffect>({
  get: () => ui.playerCoverEffect,
  set: (value) => ui.setPlayerCoverEffect(value)
})
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
</script>

<template>
  <BaseDrawer
    v-model="open"
    :title="t('settings.playerBackground')"
    :width="420"
    panel-class="player-appearance-drawer"
    body-class="pt-2"
  >
    <template #toolbar>
      <div class="appearance-toolbar">
        <BaseSegmentedControl
          v-model="activeTab"
          class="appearance-tabs"
          :options="tabs"
          :aria-label="t('settings.playerBackground')"
        />
      </div>
    </template>
    <div v-if="activeTab === 'artwork'" class="appearance-settings">
      <div class="setting-row theme-background-row">
        <div>
          <h3>{{ t('settings.playerBackgroundStyle') }}</h3>
        </div>
        <div
          class="theme-options player-background-options"
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
          <button
            type="button"
            class="theme-option mesh-background-preview"
            :class="{ selected: playerBackground === PlayerBgType.MESH }"
            :aria-checked="playerBackground === PlayerBgType.MESH"
            role="radio"
            @click="playerBackground = PlayerBgType.MESH"
          >
            <span class="preview-window"><i /><b /></span>
            <span>{{ t('settings.playerBackgroundMesh') }}</span>
          </button>
          <button
            type="button"
            class="theme-option particles-background-preview"
            :class="{ selected: playerBackground === PlayerBgType.PARTICLES }"
            :aria-checked="playerBackground === PlayerBgType.PARTICLES"
            role="radio"
            @click="playerBackground = PlayerBgType.PARTICLES"
          >
            <span class="preview-window"><i /><b /></span>
            <span>{{ t('settings.playerBackgroundParticles') }}</span>
          </button>
          <button
            type="button"
            class="theme-option cheer-background-preview"
            :class="{ selected: playerBackground === PlayerBgType.CHEER }"
            :aria-checked="playerBackground === PlayerBgType.CHEER"
            :style="{
              '--cheer-color': ui.activePlayerCheerColors[0],
              '--cheer-accent': ui.activePlayerCheerColors[1] ?? ui.activePlayerCheerColors[0]
            }"
            role="radio"
            @click="playerBackground = PlayerBgType.CHEER"
          >
            <span class="preview-window" aria-hidden="true" />
            <span>{{ t('settings.playerBackgroundCheer') }}</span>
          </button>
        </div>
        <PlayerCheerSettings v-if="playerBackground === PlayerBgType.CHEER" :bpm="bpm" />
      </div>
      <div class="setting-row theme-background-row">
        <div>
          <h3>{{ t('settings.playerCoverStyle') }}</h3>
        </div>
        <div
          class="theme-options player-cover-options"
          role="radiogroup"
          :aria-label="t('settings.playerCoverStyle')"
        >
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
      <SettingRow :label="t('settings.playerCoverEffect')">
        <BaseSelect
          v-model="playerCoverEffect"
          :aria-label="t('settings.playerCoverEffect')"
          :options="coverEffectOptions"
          class="min-w-0 w-full"
        />
      </SettingRow>
      <SettingRow :label="t('settings.playerLayout')">
        <BaseSelect
          v-model="ui.playerLayout"
          :options="playerLayoutOptions"
          :aria-label="t('settings.playerLayout')"
          class="min-w-0 w-full"
        />
      </SettingRow>
      <SettingRow :label="t('playerPanel.showAudioDetails')">
        <BaseSwitch
          v-model="ui.showPlayerAudioDetails"
          :aria-label="t('playerPanel.showAudioDetails')"
          class="justify-self-end"
        />
      </SettingRow>
    </div>
    <div v-else class="appearance-settings">
      <SettingRow :label="t('playerPanel.lyricSource')">
        <BaseSelect
          v-model="ui.lyricSourceMode"
          :options="lyricSourceOptions"
          :aria-label="t('playerPanel.lyricSource')"
          class="min-w-0 w-full"
        />
      </SettingRow>
      <PlayerAppearanceSlider
        :label="t('playerPanel.lyricFontSize')"
        :value-text="`${lyricScale.toFixed(1)}×`"
        :model-value="lyricScale"
        :min="0.6"
        :max="2"
        :step="0.1"
        @update:model-value="ui.setLyricsFontSize($event * 2.4)"
      />
      <PlayerAppearanceSlider
        :label="t('playerPanel.lyricSpacing')"
        :value-text="`${lyricSpacing.toFixed(1)}×`"
        :model-value="ui.lyricsFontPadding"
        :min="3"
        :max="78"
        :step="3"
        @update:model-value="ui.setLyricsFontPadding"
      />
      <SettingRow class="appearance-action-row" :label="t('settings.autoAdjustLyricsDisplay')">
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="appearance-icon-action ep-focusable"
            :aria-label="t('playerPanel.resetLyricsProportions')"
            :title="t('playerPanel.resetLyricsProportions')"
            @click="ui.adjustLyricsDisplay()"
          >
            <SvgIcon name="common-refresh" class-name="size-4" />
          </button>
          <button
            type="button"
            role="switch"
            class="appearance-icon-action ep-focusable"
            :aria-label="t('settings.autoAdjustLyricsDisplay')"
            :title="t('settings.autoAdjustLyricsDisplay')"
            :aria-checked="ui.autoAdjustLyricsDisplay"
            @click="ui.autoAdjustLyricsDisplay = !ui.autoAdjustLyricsDisplay"
          >
            <SvgIcon name="common-size" class-name="size-5" />
          </button>
        </div>
      </SettingRow>
      <SettingRow :label="t('playerPanel.showTranslation')">
        <BaseSwitch
          v-model="ui.showLyricsTranslation"
          :aria-label="t('playerPanel.showTranslation')"
          class="justify-self-end"
        />
      </SettingRow>
      <SettingRow :label="t('playerPanel.showRomanization')">
        <BaseSwitch
          v-model="ui.showLyricsRomanization"
          :aria-label="t('playerPanel.showRomanization')"
          class="justify-self-end"
        />
      </SettingRow>
      <SettingRow :label="t('settings.playerLyricsFont')">
        <BaseSelect
          v-model="ui.playerLyricsFontFamily"
          :options="playerLyricsFontOptions"
          :placeholder="t('settings.playerLyricsFontInherit')"
          :aria-label="t('settings.playerLyricsFont')"
          class="min-w-0 w-full"
        />
      </SettingRow>
      <SettingRow :label="t('settings.playerLyricsFontWeight')">
        <BaseSelect
          v-model="ui.playerLyricsFontWeight"
          :options="playerLyricsFontWeightOptions"
          :aria-label="t('settings.playerLyricsFontWeight')"
          class="min-w-0 w-full"
        />
      </SettingRow>
      <SettingRow :label="t('playerPanel.lyricAlignment')">
        <BaseSelect
          v-model="ui.lyricsAlignment"
          :options="alignmentOptions"
          :aria-label="t('playerPanel.lyricAlignment')"
          class="min-w-0 w-full"
        />
      </SettingRow>
      <SettingRow :label="t('playerPanel.lyricEffect')">
        <BaseSelect
          v-model="ui.lyricsStyle"
          :options="lyricEffectOptions"
          :aria-label="t('playerPanel.lyricEffect')"
          class="min-w-0 w-full"
        />
      </SettingRow>
      <SettingRow :label="t('settings.karaokeAnimation')">
        <BaseSelect
          v-model="ui.karaokeAnimation"
          :options="karaokeAnimationOptions"
          :aria-label="t('settings.karaokeAnimation')"
          class="min-w-0 w-full"
        />
      </SettingRow>
      <PlayerLyricsColorSettings />
      <div class="appearance-spectrum">
        <SettingRow :label="t('ap.rhythmVisuals')">
          <BaseSwitch
            v-model="player.rhythmVisualConfig.enabled"
            :aria-label="t('ap.rhythmVisuals')"
            class="justify-self-end"
          />
        </SettingRow>
        <SettingRow :label="t('playerPanel.showSpectrum')">
          <BaseSwitch
            v-model="ui.showPlayerSpectrum"
            :aria-label="t('playerPanel.showSpectrum')"
            class="justify-self-end"
          />
        </SettingRow>
        <SettingRow :label="t('settings.playerSpectrumStyle')">
          <BaseSelect
            v-model="ui.playerSpectrumStyle"
            :options="spectrumStyleOptions"
            :aria-label="t('settings.playerSpectrumStyle')"
            class="min-w-0 w-full"
          />
        </SettingRow>
      </div>
    </div>
  </BaseDrawer>
</template>

<style scoped>
.appearance-toolbar {
  padding: 0.75rem 1.25rem 0.5rem;
}
.appearance-settings :deep(.appearance-icon-action) {
  display: grid;
  width: 2rem;
  height: 2rem;
  place-items: center;
  border-radius: 0.5rem;
  color: var(--color-text-l);
  transition:
    background-color var(--motion-duration-fast) var(--motion-ease-standard),
    color var(--motion-duration-fast) var(--motion-ease-standard);
}
.appearance-settings :deep(.appearance-icon-action:hover) {
  background-color: color-mix(in srgb, var(--color-text) 8%, transparent);
  color: var(--color-text);
}
.appearance-settings :deep(.appearance-icon-action[aria-checked='true']) {
  background-color: color-mix(in srgb, var(--color-primary) 12%, transparent);
  color: var(--color-primary);
}
.appearance-settings :deep(.appearance-icon-action[aria-checked='true']:hover) {
  background-color: color-mix(in srgb, var(--color-primary) 20%, transparent);
}
.appearance-settings :deep(.setting-row) {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 48%);
  align-items: center;
  gap: 0.75rem;
  min-height: 3.4rem;
  padding: 0.625rem 0;
  font-size: 0.875rem;
}
.appearance-settings :deep(h3) {
  font-weight: 500;
}
.appearance-settings :deep(.appearance-action-row) {
  grid-template-columns: minmax(0, 1fr) auto;
}
.appearance-settings :deep(.appearance-action-row p) {
  margin-top: 0.125rem;
  color: var(--color-text-l);
  font-size: 0.75rem;
}
.appearance-spectrum {
  margin-top: 0.625rem;
  padding-top: 0.375rem;
  border-top: 1px solid var(--color-border);
}
.appearance-settings .theme-background-row {
  grid-template-columns: 1fr;
  margin-bottom: 0.625rem;
}
.theme-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-auto-rows: 5.75rem;
  gap: 0.625rem;
}
.theme-option {
  display: grid;
  grid-template-rows: 47px minmax(0, 1fr);
  gap: 0.375rem;
  min-width: 0;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 0.375rem;
  color: var(--color-text-l);
  font-size: 0.75rem;
  text-align: center;
}
.theme-option > span:last-child {
  align-self: center;
  line-height: 1.15;
}
.theme-option:hover,
.theme-option.selected {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.theme-option.selected {
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
}
.preview-window {
  display: flex;
  height: 47px;
  overflow: hidden;
  gap: 5px;
  padding: 8px;
  border-radius: 6px;
}
.preview-window i {
  width: 18%;
  border-radius: 3px;
}
.preview-window b {
  flex: 1;
  border-radius: 3px;
}
.cheer-background-preview .preview-window {
  background:
    linear-gradient(165deg, #080c18 14%, transparent 47%),
    radial-gradient(ellipse 1px 2.4px at 30% 55%, var(--cheer-color) 65%, transparent) center / 8px
      8px,
    radial-gradient(ellipse 1px 2px at 50% 30%, var(--cheer-accent) 45%, transparent) center / 11px
      9px,
    radial-gradient(
      ellipse at 50% 70%,
      color-mix(in srgb, var(--cheer-color) 29%, #0b1320),
      #080c18 80%
    );
}
.particles-background-preview .preview-window {
  background:
    radial-gradient(circle, rgb(115 188 225 / 75%) 0.8px, transparent 1.3px) center / 6px 6px,
    radial-gradient(ellipse at 35% 50%, #1c2540, #06080c 80%);
}
.particles-background-preview i {
  background: rgb(95 160 200 / 18%);
}
.particles-background-preview b {
  background: rgb(200 186 240 / 18%);
}
.mesh-background-preview .preview-window {
  background:
    radial-gradient(ellipse at 15% 65%, #c46485, transparent 68%),
    radial-gradient(ellipse at 85% 25%, #d1aa72, transparent 62%),
    linear-gradient(120deg, #47538b, #584572);
}
.mesh-background-preview i {
  background: rgb(255 255 255 / 16%);
}
.mesh-background-preview b {
  background: rgb(255 255 255 / 10%);
}
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
</style>
