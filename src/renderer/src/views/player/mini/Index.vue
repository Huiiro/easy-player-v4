<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import SvgIcon from '@/components/svg/SvgIcon.vue'

interface MiniPlayerState {
  cover: string | null
  title: string
  artist: string
  isPlaying: boolean
}

const { t } = useI18n()
const state = ref<MiniPlayerState>({ cover: null, title: '', artist: '', isPlaying: false })
const coverUrl = computed(() =>
  state.value.cover
    ? `easy-player-media://cover?path=${encodeURIComponent(state.value.cover)}`
    : null
)

const removeUpdateListener = window.api.miniPlayer.onUpdate((data) => {
  if (!data || typeof data !== 'object') return
  const next = data as Partial<MiniPlayerState>
  state.value = {
    cover: typeof next.cover === 'string' ? next.cover : null,
    title: typeof next.title === 'string' ? next.title : '',
    artist: typeof next.artist === 'string' ? next.artist : '',
    isPlaying: next.isPlaying === true
  }
})

function action(type: 'previous' | 'toggle' | 'next'): void {
  window.api.miniPlayer.action(type)
}

function restore(): void {
  void window.api.miniPlayer.restore()
}

onMounted(() => window.api.miniPlayer.ready())
onUnmounted(removeUpdateListener)
</script>

<template>
  <main class="flex h-screen items-center gap-3 bg-bg px-3 text-text [-webkit-app-region:drag]">
    <div
      class="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-primary to-violet-500 text-white"
    >
      <img v-if="coverUrl" :src="coverUrl" class="size-full object-cover" alt="" />
      <SvgIcon v-else name="common-music" class-name="size-6" />
    </div>
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-semibold">{{ state.title || t('miniPlayer.noTrack') }}</p>
      <p class="mt-0.5 truncate text-xs text-text-l">
        {{ state.artist || t('miniPlayer.defaultArtist') }}
      </p>
      <div class="mt-2 flex items-center gap-3 [-webkit-app-region:no-drag]">
        <button class="mini-action" :title="t('miniPlayer.previous')" @click="action('previous')">
          <SvgIcon name="play-prev" class-name="size-3.5" />
        </button>
        <button
          class="mini-action mini-action--play"
          :title="state.isPlaying ? t('miniPlayer.pause') : t('miniPlayer.play')"
          @click="action('toggle')"
        >
          <SvgIcon :name="state.isPlaying ? 'play-pause' : 'play-play'" class-name="size-4" />
        </button>
        <button class="mini-action" :title="t('miniPlayer.next')" @click="action('next')">
          <SvgIcon name="play-next" class-name="size-3.5" />
        </button>
      </div>
    </div>
    <button
      class="mini-action shrink-0 [-webkit-app-region:no-drag]"
      :title="t('miniPlayer.restore')"
      @click="restore"
    >
      <SvgIcon name="common-mini-player-restore" class-name="size-4" />
    </button>
  </main>
</template>

<style scoped>
.mini-action {
  display: grid;
  width: 1.5rem;
  height: 1.5rem;
  place-items: center;
  border-radius: 9999px;
  color: var(--color-text-l);
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    transform 0.15s ease;
}
.mini-action:hover {
  color: var(--color-text);
  background: var(--color-hover);
  transform: scale(1.06);
}
.mini-action--play {
  color: white;
  background: var(--color-primary);
}
</style>
