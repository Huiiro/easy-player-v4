<script setup lang="ts">
import type { PageTransition } from '@/components/ui/types'
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import { CachedPageSurface, PageSurface } from './pageSurface'
withDefaults(
  defineProps<{
    transition?: PageTransition
    cacheMax?: number
    getPageKey?: (route: RouteLocationNormalizedLoaded) => string
  }>(),
  {
    transition: 'slide',
    cacheMax: 3
  }
)
function defaultPageKey(route: RouteLocationNormalizedLoaded): string {
  return (
    String(route.name ?? route.path) +
    JSON.stringify(route.params) +
    JSON.stringify([route.query.name, route.query.artist])
  )
}
</script>

<template>
  <RouterView v-slot="{ Component, route }">
    <Transition :name="`ep-page-${route.meta.transition ?? transition}`" mode="out-in">
      <KeepAlive include="CachedPageSurface" :max="cacheMax">
        <component
          :is="route.meta.keepAlive === false ? PageSurface : CachedPageSurface"
          :key="(getPageKey ?? defaultPageKey)(route)"
        >
          <component :is="Component" />
        </component>
      </KeepAlive>
    </Transition>
  </RouterView>
</template>

<style>
.ep-page {
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: auto;
}
.ep-page-fade-enter-active,
.ep-page-slide-enter-active {
  transition:
    opacity var(--motion-duration-standard) var(--motion-ease-enter),
    transform var(--motion-duration-standard) var(--motion-ease-enter);
}
.ep-page-fade-leave-active,
.ep-page-slide-leave-active {
  transition: opacity var(--motion-duration-fast) var(--motion-ease-exit);
}
.ep-page-fade-enter-from,
.ep-page-fade-leave-to,
.ep-page-slide-enter-from,
.ep-page-slide-leave-to {
  opacity: 0;
}
.ep-page-slide-enter-from {
  transform: translateY(6px);
}
</style>
