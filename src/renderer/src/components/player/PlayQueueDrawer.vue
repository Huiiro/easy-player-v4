<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePlayerStore } from '@/stores/player/playerStore'
import BaseDrawer from '@/components/ui/BaseDrawer.vue'
import PlayQueue from '@/components/player/PlayQueue.vue'

const props = defineProps<{ modelValue: boolean }>()
defineEmits<{ (e: 'update:modelValue', val: boolean): void }>()

const { t } = useI18n()
const player = usePlayerStore()
const queue = ref<{ scrollToCurrent: () => Promise<void> } | null>(null)

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return
    await nextTick()
    requestAnimationFrame(() => void queue.value?.scrollToCurrent())
  }
)
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
    <PlayQueue ref="queue" />
  </BaseDrawer>
</template>
