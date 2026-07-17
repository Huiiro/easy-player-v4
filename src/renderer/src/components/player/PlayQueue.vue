<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { usePlayerStore } from '@/stores/player/playerStore'

const { t } = useI18n()
const player = usePlayerStore()
const playAt = (index: number): void => void player.playQueueItem(index)
const removeAt = (index: number): void => void player.removeQueueItem(index)
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col">
    <header class="flex items-center justify-between gap-3 pb-3">
      <p class="text-sm font-semibold text-[var(--color-text)]">{{ t('queue.title') }}</p>
      <div>
        <button
          class="btn-hover text-xs"
          :disabled="player.queue.length === 0"
          @click="player.clearQueue"
        >
          {{ t('queue.clear') }}
        </button>
      </div>
    </header>
    <p v-if="player.queue.length === 0" class="py-8 text-center text-sm text-[var(--color-text-l)]">
      {{ t('queue.empty') }}
    </p>
    <div v-else class="custom-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
      <div
        v-for="(song, index) in player.queue"
        :key="song.id"
        class="flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-[var(--color-hover)]"
        :class="
          index === player.currentQueueIndex
            ? 'bg-[color:color-mix(in_srgb,var(--color-primary)_14%,transparent)] text-[var(--color-primary)]'
            : ''
        "
        @dblclick="playAt(index)"
      >
        <span class="min-w-0 flex-1 truncate">{{ index + 1 }}. {{ song.title }}</span>
        <button
          class="btn-hover text-xs"
          :disabled="index === 0"
          @click="player.moveQueueItem(index, index - 1)"
          @dblclick.stop
        >
          ↑
        </button>
        <button
          class="btn-hover text-xs"
          :disabled="index === player.queue.length - 1"
          @click="player.moveQueueItem(index, index + 1)"
          @dblclick.stop
        >
          ↓
        </button>
        <button class="btn-hover text-xs text-red-400" @click="removeAt(index)" @dblclick.stop>
          ×
        </button>
      </div>
    </div>
  </section>
</template>
