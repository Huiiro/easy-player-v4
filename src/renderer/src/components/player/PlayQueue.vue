<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { usePlayerStore } from '@/stores/player/playerStore'
import { useI18n } from 'vue-i18n'
import SvgIcon from '@/components/svg/SvgIcon.vue'

const { t } = useI18n()
const player = usePlayerStore()
const queueRef = ref<HTMLElement | null>(null)
const playAt = (index: number): void => void player.playQueueItem(index)
const removeAt = (index: number): void => void player.removeQueueItem(index)

function coverUrl(cover: string | null): string | null {
  return cover ? `easy-player-media://cover?path=${encodeURIComponent(cover)}` : null
}

async function scrollToCurrent(): Promise<void> {
  await nextTick()
  const currentIndex = player.currentQueueIndex
  if (currentIndex < 0) return
  const item = queueRef.value?.querySelector<HTMLElement>(`[data-queue-index="${currentIndex}"]`)
  item?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

defineExpose({ scrollToCurrent })
</script>

<template>
  <p v-if="player.queue.length === 0" class="py-8 text-center text-sm text-text-l">
    {{ t('queue.empty') }}
  </p>
  <div v-else ref="queueRef" class="space-y-1">
    <div
      v-for="(song, index) in player.queue"
      :key="song.id"
      :data-queue-index="index"
      class="flex items-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-hover select-none"
      :class="
        index === player.currentQueueIndex
          ? 'bg-[color:color-mix(in_srgb,var(--color-primary)_14%,transparent)] text-primary'
          : ''
      "
      @dblclick="playAt(index)"
    >
      <span class="w-5 shrink-0 text-right text-xs text-text-l2 tabular-nums">{{ index + 1 }}</span>
      <img
        v-if="coverUrl(song.cover)"
        :src="coverUrl(song.cover)!"
        class="size-8 shrink-0 rounded object-cover"
        :alt="song.title"
      />
      <span v-else class="grid size-8 shrink-0 place-items-center rounded bg-bg-l text-text-l">
        <SvgIcon name="common-music" class-name="size-4" />
      </span>
      <span class="min-w-0 flex-1 truncate">{{ song.title }}</span>
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
</template>
