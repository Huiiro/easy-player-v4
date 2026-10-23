<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { usePlayerStore } from '@/stores/player/playerStore'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import DspKnobField from './DspKnobField.vue'
const player = usePlayerStore()
const { t } = useI18n()
</script>
<template>
  <div class="space-y-4 text-xs">
    <p class="text-text-l">{{ t('ap.pauseFadeDesc') }}</p>
    <div class="flex items-center gap-3">
      <BaseSwitch
        v-model="player.transitionConfig.pauseFadeEnabled"
        class="w-fit text-left"
        @change="player.setTransitionConfig()"
      >
        {{ t('ap.pauseFade') }}
      </BaseSwitch>
    </div>
    <DspKnobField
      v-if="player.transitionConfig.pauseFadeEnabled"
      v-model="player.transitionConfig.pauseFadeMs"
      :label="t('ap.pauseFadeDuration')"
      :description="t('ap.pauseFadeDesc')"
      :min="50"
      :max="1000"
      :step="10"
      unit="ms"
      @change="player.setTransitionConfig()"
    />
    <div class="flex items-center gap-3">
      <BaseSwitch
        v-model="player.transitionConfig.gaplessEnabled"
        class="w-fit text-left"
        @change="player.setTransitionConfig()"
      >
        {{ t('ap.gapless') }}
      </BaseSwitch>
    </div>
    <div class="flex items-center gap-3">
      <BaseSwitch
        v-model="player.transitionConfig.crossfadeEnabled"
        class="w-fit text-left"
        :disabled="!player.transitionConfig.gaplessEnabled"
        @change="player.setTransitionConfig()"
      >
        {{ t('ap.crossfade') }}
      </BaseSwitch>
    </div>
    <div v-if="player.transitionConfig.crossfadeEnabled" class="flex items-center gap-3">
      <BaseSwitch
        v-model="player.transitionConfig.crossfadeAuto"
        class="w-fit text-left"
        @change="player.setTransitionConfig()"
      >
        {{ t('ap.crossfadeAuto') }}
      </BaseSwitch>
    </div>
    <div
      v-if="player.transitionConfig.crossfadeEnabled && player.transitionConfig.crossfadeAuto"
      class="space-y-1"
    >
      <BaseSwitch
        v-model="player.transitionConfig.crossfadeVocalCue"
        class="w-fit text-left"
        @change="player.setTransitionConfig()"
      >
        {{ t('ap.crossfadeVocalCue') }}
      </BaseSwitch>
      <p class="text-text-l">{{ t('ap.crossfadeVocalCueDesc') }}</p>
    </div>
    <DspKnobField
      v-if="player.transitionConfig.crossfadeEnabled"
      v-model="player.transitionConfig.crossfadeMs"
      :label="t('ap.crossfade')"
      :description="t('ap.crossfadeAutoDesc')"
      :min="0"
      :max="30000"
      :step="100"
      unit="ms"
      @change="player.setTransitionConfig()"
    />
  </div>
</template>
