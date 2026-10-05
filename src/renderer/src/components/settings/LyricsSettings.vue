<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import { useUIStore } from '@/stores/ui/uiStore'
import Draggable from 'vuedraggable'

const ui = useUIStore()
const { t } = useI18n()
const karaokeAnimationOptions = computed(() => [
  { label: t('settings.karaokeAnimationWave'), value: 'wave' },
  { label: t('settings.karaokeAnimationFloat'), value: 'float' }
])
const lyricSourceKey = (source: string): string => source
</script>

<template>
  <div class="settings-card">
    <div class="setting-row">
      <div>
        <h3>{{ t('settings.karaokeAnimation') }}</h3>
        <p>{{ t('settings.karaokeAnimationDescription') }}</p>
      </div>
      <BaseSelect
        v-model="ui.karaokeAnimation"
        :options="karaokeAnimationOptions"
        teleport
        class="w-64"
      />
    </div>
    <div class="setting-row">
      <div>
        <h3>{{ t('settings.autoSearchNetworkLyrics') }}</h3>
        <p>{{ t('settings.autoSearchNetworkLyricsDescription') }}</p>
      </div>
      <BaseSwitch v-model="ui.autoSearchNetworkLyrics" size="md" />
    </div>
    <div class="setting-row">
      <div>
        <h3>{{ t('settings.lyricsPriority') }}</h3>
        <p>{{ t('settings.lyricsPriorityDescription') }}</p>
      </div>
    </div>
    <Draggable v-model="ui.lyricSourceOrder" :item-key="lyricSourceKey" handle=".lyric-drag-handle">
      <template #item="{ element: source, index }">
        <div class="setting-row">
          <div class="flex items-center gap-3">
            <button class="lyric-drag-handle" :title="t('settings.lyricsDrag')">
              <SvgIcon name="common-drag" class-name="size-4" />
            </button>
            <div>
              <h3>{{ t(`lyrics.source.${source}`) }}</h3>
              <p>
                {{ index === 0 ? t('settings.lyricsFirst') : t('settings.lyricsFallback') }}
              </p>
            </div>
          </div>
        </div>
      </template>
    </Draggable>
  </div>
</template>

<style scoped>
.lyric-drag-handle {
  display: grid;
  cursor: grab;
  place-items: center;
  border-radius: 6px;
  padding: 0.4rem;
  color: var(--color-text-l);
}
.lyric-drag-handle:active {
  cursor: grabbing;
}
.lyric-drag-handle:hover {
  background: var(--color-hover);
  color: var(--color-text);
}
</style>
