<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { usePlayerStore } from '@/stores/player/playerStore'
import BaseDrawer from '@/components/ui/BaseDrawer.vue'
import PlayQueue from '@/components/player/PlayQueue.vue'

defineProps<{ modelValue: boolean }>()
defineEmits<{ (e: 'update:modelValue', val: boolean): void }>()

const { t } = useI18n()
const player = usePlayerStore()
</script>

<template>
  <BaseDrawer
    :model-value="modelValue"
    direction="right"
    width="26rem"
    @update:model-value="(val) => $emit('update:modelValue', val)"
  >
    <template #header>
      <span class="text-lg font-semibold">{{ t('queue.title') }}</span>
      <button
        class="btn-hover text-xs"
        :disabled="player.queue.length === 0"
        @click="player.clearQueue"
      >
        {{ t('queue.clear') }}
      </button>
    </template>
    <PlayQueue />
  </BaseDrawer>
</template>
