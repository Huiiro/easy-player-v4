<script setup lang="ts">
import Header from '@/views/layout/header/Index.vue'
import Sidebar from '@/views/layout/sidebar/Index.vue'
import FootBar from '@/views/layout/footbar/Index.vue'
import CardView from '@/views/layout/card/Index.vue'

import { useUIStore } from '@/stores/ui/uiStore'

const ui = useUIStore()
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
      <footer class="shrink-0 z-20">
        <FootBar />
      </footer>
    </div>
  </div>
</template>
