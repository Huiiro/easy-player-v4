<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import Header from '@/views/layout/header/Index.vue'
import Sidebar from '@/views/layout/sidebar/Index.vue'
import FootBar from '@/views/layout/footbar/Index.vue'
import PlayerPanel from '@/views/layout/playerPanel/Index.vue'
import CardView from '@/views/layout/card/Index.vue'

import { useUIStore } from '@/stores/ui/uiStore'
import { usePlayerStore } from '@/stores/player/playerStore'

const ui = useUIStore()
const player = usePlayerStore()

onMounted(() => player.subscribeToEvents())
onBeforeUnmount(() => player.unsubscribe())
</script>

<template>
  <div
    class="relative flex flex-col w-full h-full overflow-hidden text-base"
    :style="ui.getCustomFontStyle"
  >
    <!-- 背景层 -->
    <div
      class="absolute inset-0 -z-10 bg-cover bg-center transition-all duration-300"
      :style="ui.useCustomBg ? ui.getCustomBgStyle : undefined"
    />
    <!-- 动态背景 -->
    <!--<DynamicBackground />-->

    <!-- 主容器 -->
    <div class="relative flex flex-col w-full h-full">
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
        class="footer-motion absolute inset-x-0 bottom-0 z-20"
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
  transition: opacity 0.24s ease;
}
.player-panel-enter-active :deep(.player-panel) {
  transition:
    transform 0.38s cubic-bezier(0.34, 1.56, 0.64, 1),
    opacity 0.24s ease-out;
}
.player-panel-leave-active :deep(.player-panel) {
  transition:
    transform 0.24s cubic-bezier(0.4, 0, 1, 1),
    opacity 0.18s ease-in;
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
    transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
    opacity 0.18s ease-out;
}
</style>
