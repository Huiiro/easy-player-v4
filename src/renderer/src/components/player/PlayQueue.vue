<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { usePlayerStore } from '@/stores/player/playerStore'
import { useI18n } from 'vue-i18n'
import SvgIcon from '@/components/svg/SvgIcon.vue'

const { t } = useI18n()
const player = usePlayerStore()
const scroller = ref<{ scrollToItem: (index: number) => void } | null>(null)
const queueItems = computed(() =>
  player.queue.map((song, index) => ({
    song,
    index,
    key: `${song.id}:${index}`
  }))
)
const playAt = (index: number): void => void player.playQueueItem(index)
const removeAt = (index: number): void => void player.removeQueueItem(index)

function coverUrl(cover: string | null): string | null {
  return cover ? `easy-player-media://cover?path=${encodeURIComponent(cover)}` : null
}

async function scrollToCurrent(): Promise<void> {
  await nextTick()
  const currentIndex = player.currentQueueIndex
  if (currentIndex < 0) return
  scroller.value?.scrollToItem(currentIndex)
}

defineExpose({ scrollToCurrent })
</script>

<template>
  <p v-if="player.queue.length === 0" class="py-8 text-center text-sm text-text-l">
    {{ t('queue.empty') }}
  </p>
  <RecycleScroller
    v-else
    ref="scroller"
    v-slot="{ item }"
    class="h-full min-h-0 overflow-y-auto"
    :items="queueItems"
    :item-size="52"
    key-field="key"
  >
    <div
      class="flex h-[52px] items-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-hover select-none"
      :class="
        item.index === player.currentQueueIndex
          ? 'bg-[color:color-mix(in_srgb,var(--color-primary)_14%,transparent)] text-primary'
          : ''
      "
      @dblclick="playAt(item.index)"
    >
      <span class="w-5 shrink-0 text-right text-xs text-text-l2 tabular-nums">
        {{ item.index + 1 }}
      </span>
      <img
        v-if="coverUrl(item.song.cover)"
        :src="coverUrl(item.song.cover)!"
        class="size-8 shrink-0 rounded object-cover"
        :alt="item.song.title"
      />
      <span v-else class="grid size-8 shrink-0 place-items-center rounded bg-bg-l text-text-l">
        <SvgIcon name="common-music" class-name="size-4" />
      </span>
      <span class="min-w-0 flex-1 truncate">{{ item.song.title }}</span>
      <button
        class="btn-hover text-xs"
        :disabled="item.index === 0"
        @click="player.moveQueueItem(item.index, item.index - 1)"
        @dblclick.stop
      >
        ↑
      </button>
      <button
        class="btn-hover text-xs"
        :disabled="item.index === player.queue.length - 1"
        @click="player.moveQueueItem(item.index, item.index + 1)"
        @dblclick.stop
      >
        ↓
      </button>
      <button class="btn-hover text-xs text-red-400" @click="removeAt(item.index)" @dblclick.stop>
        ×
      </button>
    </div>
  </RecycleScroller>
</template>
