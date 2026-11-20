<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseColorPicker from '@/components/ui/BaseColorPicker.vue'
import BaseDisclosure from '@/components/ui/BaseDisclosure.vue'
import BaseSegmentedControl from '@/components/ui/BaseSegmentedControl.vue'
import PlayerAppearanceSlider from './PlayerAppearanceSlider.vue'
import {
  DEFAULT_PLAYER_CHEER_COLOR,
  MAX_PLAYER_CHEER_BRIGHTNESS,
  MAX_PLAYER_CHEER_COLORS,
  type PlayerCheerLights
} from '@/constants'
import { useUIStore } from '@/stores/ui/uiStore'

defineProps<{ bpm: number }>()
const ui = useUIStore()
const { t } = useI18n()
const colorModes = computed(
  () =>
    [
      { value: 'single', label: t('playerPanel.cheerSingleColor') },
      { value: 'mixed', label: t('playerPanel.cheerMixedColors') }
    ] as const
)
const controls = [
  { key: 'density', label: 'playerPanel.cheerDensity', max: 100 },
  { key: 'uniformity', label: 'playerPanel.cheerUniformity', max: 100 },
  { key: 'brightness', label: 'playerPanel.cheerBrightness', max: MAX_PLAYER_CHEER_BRIGHTNESS }
] as const

function setLight(key: keyof PlayerCheerLights, value: number): void {
  ui.setPlayerCheerLights({ ...ui.playerCheerLights, [key]: value })
}
const presets = [
  DEFAULT_PLAYER_CHEER_COLOR,
  '#53E5D2',
  '#6BB7FF',
  '#AF8AFF',
  '#FF70AA',
  '#FF685F',
  '#FFD473',
  '#F3FAFF'
]

function changeColor(index: number, color: string): void {
  ui.setPlayerCheerColors(
    ui.playerCheerColors.map((value, slot) => (slot === index ? color : value))
  )
}

function addColor(): void {
  const colors = ui.playerCheerColors
  const next = presets.find((color) => !colors.includes(color))
  if (next && colors.length < MAX_PLAYER_CHEER_COLORS) ui.setPlayerCheerColors([...colors, next])
}
</script>

<template>
  <BaseDisclosure
    class="player-cheer-settings rounded-lg px-3"
    :label="t('playerPanel.cheerSettings')"
  >
    <div class="space-y-4 py-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-sm">{{ t('playerPanel.cheerColorMode') }}</span>
        <BaseSegmentedControl
          class="cheer-color-modes"
          :options="colorModes"
          :model-value="ui.playerCheerColorMode"
          :aria-label="t('playerPanel.cheerColorMode')"
          @update:model-value="ui.setPlayerCheerColorMode"
        />
      </div>
      <div
        v-if="ui.playerCheerColorMode === 'single'"
        class="flex items-center justify-between gap-4"
      >
        <span class="text-sm">{{ t('playerPanel.cheerColor') }}</span>
        <BaseColorPicker
          :model-value="ui.playerCheerColor"
          :presets="presets"
          :aria-label="t('playerPanel.cheerColor')"
          @update:model-value="ui.setPlayerCheerColor"
        />
      </div>
      <div v-else class="space-y-2">
        <div
          v-for="(color, index) in ui.playerCheerColors"
          :key="index"
          class="flex items-center justify-between gap-2 text-sm"
        >
          <span>{{ t('playerPanel.cheerColorSlot', { number: index + 1 }) }}</span>
          <div class="flex items-center gap-1">
            <BaseColorPicker
              :model-value="color"
              :presets="presets"
              :aria-label="t('playerPanel.cheerColorSlot', { number: index + 1 })"
              @update:model-value="changeColor(index, $event)"
            />
            <BaseButton
              size="xs"
              variant="ghost"
              :disabled="ui.playerCheerColors.length <= 2"
              :aria-label="t('playerPanel.cheerRemoveColor', { number: index + 1 })"
              @click="
                ui.setPlayerCheerColors(ui.playerCheerColors.filter((_, slot) => slot !== index))
              "
            >
              {{ t('settings.remove') }}
            </BaseButton>
          </div>
        </div>
        <BaseButton
          size="sm"
          variant="secondary"
          :disabled="ui.playerCheerColors.length >= MAX_PLAYER_CHEER_COLORS"
          @click="addColor"
        >
          {{ t('playerPanel.cheerAddColor') }}
        </BaseButton>
      </div>
      <div>
        <PlayerAppearanceSlider
          v-for="{ key, label, max } in controls"
          :key="key"
          :label="t(label)"
          :model-value="ui.playerCheerLights[key]"
          :value-text="`${ui.playerCheerLights[key]}%`"
          :max="max"
          @update:model-value="setLight(key, $event)"
        />
      </div>
      <dl class="flex items-center justify-between gap-4 text-sm text-text-l">
        <dt>{{ t('playerPanel.cheerTempo') }}</dt>
        <dd class="tabular-nums">{{ bpm >= 55 && bpm <= 220 ? Math.round(bpm) : '—' }}</dd>
      </dl>
    </div>
  </BaseDisclosure>
</template>
