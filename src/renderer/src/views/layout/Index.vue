<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue'
import { usePlaybackLifecycle } from '@/hooks/usePlaybackLifecycle'
import Header from '@/views/layout/header/Index.vue'
import Sidebar from '@/views/layout/sidebar/Index.vue'
import AppPageOutlet from '@/components/layout/AppPageOutlet.vue'
import PlayerPanelTransition from '@/components/layout/PlayerPanelTransition.vue'
import LayoutModeTransition from '@/components/layout/LayoutModeTransition.vue'
import AppBackground from '@/components/background/AppBackground.vue'

const FootBar = defineAsyncComponent(() => import('@/views/layout/footbar/Index.vue'))

const PlayerPanel = defineAsyncComponent(() => import('@/views/layout/playerPanel/Index.vue'))

const DesktopLyricsSync = defineAsyncComponent(
  () => import('@/components/lyrics/DesktopLyricsSync.vue')
)

const CardView = defineAsyncComponent(() => import('@/views/layout/card/Index.vue'))

const { ui } = usePlaybackLifecycle()
const footerState = ref({ collapsed: false, hidden: false })
const backgroundContentDark = ref(ui.resolvedAppearance.contentDark)
</script>

<template>
  <DesktopLyricsSync v-if="!ui.extremePlayback && ui.useDesktopLyrics" />
  <div
    class="app-layout relative flex flex-col w-full h-full overflow-hidden text-base text-[var(--color-text)]"
    :data-background-contrast="
      !ui.resolvedAppearance.dark && backgroundContentDark ? 'dark' : undefined
    "
    :class="ui.nativeMaterialEnabled ? 'bg-transparent' : 'bg-[var(--color-bg)]'"
    :style="ui.getCustomFontStyle"
  >
    <!-- Keep the outgoing page intact; extreme.html owns the replacement UI. -->
    <AppBackground @contrast="backgroundContentDark = $event" />
    <!-- 主容器 -->
    <div
      class="relative z-[2] flex flex-col w-full h-full"
      :style="{
        '--song-list-backtop-bottom':
          footerState.collapsed || footerState.hidden ? '1.25rem' : '7rem'
      }"
    >
      <!-- 顶栏 -->
      <header class="shrink-0 z-20">
        <Header />
      </header>

      <!-- 内容区域 -->
      <section class="flex-1 min-h-0 flex overflow-hidden">
        <!-- 卡片模式 -->
        <LayoutModeTransition :card="ui.useCardView" :reduce-motion="ui.reduceMotion">
          <template #card><CardView class="flex-1 min-h-0 overflow-auto" /></template>

          <!-- 普通模式 -->
          <aside class="shrink-0 z-10">
            <Sidebar />
          </aside>

          <main class="flex-1 min-w-0 min-h-0 overflow-hidden z-10">
            <AppPageOutlet />
          </main>
        </LayoutModeTransition>
      </section>

      <!-- 底栏 -->
      <footer
        class="footer-motion pointer-events-none absolute inset-x-0 bottom-0 z-20"
        :class="ui.showPlayer ? 'translate-y-[calc(100%+1rem)] opacity-0 pointer-events-none' : ''"
      >
        <FootBar @layout-change="footerState = $event" />
      </footer>

      <PlayerPanelTransition :open="ui.showPlayer">
        <PlayerPanel />
      </PlayerPanelTransition>
    </div>
  </div>
</template>

<style scoped>
.footer-motion {
  pointer-events: none;
  transition:
    transform var(--motion-duration-slow) var(--motion-ease-spring),
    opacity var(--motion-duration-fast) var(--motion-ease-enter);
}
</style>
