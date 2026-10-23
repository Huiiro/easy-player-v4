<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { usePlayerStore } from '@/stores/player/playerStore'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
const player = usePlayerStore()
const { t } = useI18n()
</script>
<template>
  <div class="space-y-4 text-xs">
    <label class="flex flex-wrap items-center gap-3">
      <BaseSelect
        v-model="player.replayGainConfig.mode"
        teleport
        :options="[
          { value: 'off', label: t('ap.off') },
          { value: 'track', label: t('ap.track') },
          { value: 'album', label: t('ap.album') }
        ]"
        class="w-40"
        @change="player.setReplayGain()"
      />
    </label>
    <BaseSwitch
      v-model="player.replayGainConfig.preventClipping"
      class="w-fit text-left"
      @change="player.setReplayGain()"
    >
      {{ t('ap.preventClipping') }}
    </BaseSwitch>
    <p class="text-text-l">
      {{
        player.replayGainConfig.active
          ? `${player.replayGainConfig.appliedGainDb.toFixed(2)} dB ${t('ap.applied')}`
          : t('ap.noMatchingTags')
      }}
    </p>
  </div>
</template>
