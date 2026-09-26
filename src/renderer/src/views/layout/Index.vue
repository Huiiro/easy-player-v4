<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'
import Header from '@/views/layout/header/Index.vue'
import Sidebar from '@/views/layout/sidebar/Index.vue'
import FootBar from '@/views/layout/footbar/Index.vue'
import PlayerPanel from '@/views/layout/playerPanel/Index.vue'
import DesktopLyricsSync from '@/components/lyrics/DesktopLyricsSync.vue'
import CardView from '@/views/layout/card/Index.vue'
import AppBackground from '@/components/background/AppBackground.vue'

import { useUIStore } from '@/stores/ui/uiStore'
import { usePlayerStore } from '@/stores/player/playerStore'
import i18n from '@/i18n'
import { useShortcuts } from '@/hooks/useShortcuts'
import { useMessage } from '@/components/ui/useMessage'

const ui = useUIStore()
const player = usePlayerStore()
const { error: showError } = useMessage()
let stopFileListener: (() => void) | undefined
let stopFileErrorListener: (() => void) | undefined
let filePlayback = Promise.resolve()
useShortcuts()

watch(
  () => ui.locale,
  (locale) => {
    i18n.global.locale = locale
    window.api.system.setLocale(locale)
  },
  { immediate: true }
)

// Hide the native caption area while the immersive player is open. On Windows
// the main process collapses the Window Controls Overlay itself.
watch(
  () => ui.showPlayer,
  (showPlayer) => window.api.window.setTrafficLightVisible(!showPlayer),
  { immediate: true }
)

onMounted(async () => {
  await ui.initializeTheme()
  player.subscribeToEvents()
  await player.loadRhythmVisualConfig()
  await player.initializePersistentState()
  const hasPendingFiles = await window.api.system.hasPendingAudioFiles()
  await player.restorePlaybackSession(ui.autoPlayOnRestore && !hasPendingFiles)
  stopFileListener = window.api.system.onOpenAudioFiles((songs) => {
    filePlayback = filePlayback
      .then(async () => {
        if (!songs.length) return
        player.addToQueue(songs, true)
        const index = player.queue.findIndex((song) => song.id === songs[0].id)
        if (index < 0 || !(await player.playQueueItem(index))) {
          showError(i18n.global.t('settings.openAudioFailed'))
        }
      })
      .catch(() => {
        showError(i18n.global.t('settings.openAudioFailed'))
      })
  })
  stopFileErrorListener = window.api.system.onOpenFilesError(() =>
    showError(i18n.global.t('settings.openAudioFailed'))
  )
  window.api.system.audioFilesReady(true)
  window.addEventListener('beforeunload', player.savePlaybackSessionSync)
})
onBeforeUnmount(() => {
  window.api.system.audioFilesReady(false)
  stopFileListener?.()
  stopFileErrorListener?.()
  window.removeEventListener('beforeunload', player.savePlaybackSessionSync)
  player.savePlaybackSessionSync()
  player.unsubscribe()
})
</script>

<template>
  <DesktopLyricsSync />
  <div
    class="relative flex flex-col w-full h-full overflow-hidden text-base text-[var(--color-text)]"
    :class="ui.hasBackground || ui.useMica ? 'bg-transparent' : 'bg-[var(--color-bg)]'"
    :style="ui.getCustomFontStyle"
  >
    <AppBackground />
    <!-- 主容器 -->
    <div class="relative z-[2] flex flex-col w-full h-full">
      <!-- 顶栏 -->
      <header class="shrink-0 z-20">
        <Header />
      </header>

      <!-- 内容区域 -->
      <section class="flex-1 min-h-0 flex overflow-hidden">
        <!-- 卡片模式 -->
        <CardView v-if="ui.useCardView" class="flex-1 min-h-0 overflow-auto" />

        <!-- 普通模式 -->
        <template v-else>
          <aside class="shrink-0 z-10">
            <Sidebar />
          </aside>

          <main class="flex-1 min-w-0 min-h-0 overflow-auto z-10">
            <router-view v-slot="{ Component, route }">
              <keep-alive v-if="route.meta.keepAlive !== false">
                <component :is="Component" />
              </keep-alive>

              <component :is="Component" v-else />
            </router-view>
          </main>
        </template>
      </section>

      <!-- 底栏 -->
      <footer
        class="footer-motion pointer-events-none absolute inset-x-0 bottom-0 z-20"
        :class="ui.showPlayer ? 'translate-y-[calc(100%+1rem)] opacity-0 pointer-events-none' : ''"
      >
        <FootBar />
      </footer>

      <Transition name="player-panel">
        <PlayerPanel v-if="ui.showPlayer" />
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.player-panel-enter-active,
.player-panel-leave-active {
  transition: opacity var(--motion-duration-theme) var(--motion-ease-standard);
}
.player-panel-enter-active :deep(.player-panel) {
  transition:
    transform var(--motion-duration-emphasized) var(--motion-ease-spring),
    opacity var(--motion-duration-theme) var(--motion-ease-enter);
}
.player-panel-leave-active :deep(.player-panel) {
  transition:
    transform var(--motion-duration-theme) var(--motion-ease-exit),
    opacity var(--motion-duration-fast) var(--motion-ease-exit);
}
.player-panel-enter-from,
.player-panel-leave-to {
  opacity: 0;
}
.player-panel-enter-from :deep(.player-panel),
.player-panel-leave-to :deep(.player-panel) {
  transform: translateY(calc(100% + 2rem));
  opacity: 0;
}
.footer-motion {
  pointer-events: none;
  transition:
    transform var(--motion-duration-slow) var(--motion-ease-spring),
    opacity var(--motion-duration-fast) var(--motion-ease-enter);
}
</style>
