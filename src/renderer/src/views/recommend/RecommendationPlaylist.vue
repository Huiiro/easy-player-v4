<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import SongListView from '@/components/songlist/SongListView.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import CollectionHeaderActions from '@/components/collection/CollectionHeaderActions.vue'
import { useStatisticsStore } from '@/stores/statistics/statisticsStore'
import { useUIStore } from '@/stores/ui/uiStore'
import type { RecommendationGroup } from '@/components/home/types'

const route = useRoute()
const router = useRouter()
const statistics = useStatisticsStore()
const { t } = useI18n()
const songList = ref<InstanceType<typeof SongListView> | null>(null)
const playing = ref(false)
const { recommendationPlaylistHeaderCollapsed: headerCollapsed } = storeToRefs(useUIStore())
const source = computed(() => {
  const { group, generatedFor } = route.params
  if (
    (group !== 'recommended' && group !== 'discovery') ||
    typeof generatedFor !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(generatedFor)
  )
    return null
  return { type: 'recommendation' as const, group: group as RecommendationGroup, generatedFor }
})
const title = computed(() => (source.value ? t(`recommendation.${source.value.group}`) : ''))
const coverUrl = computed(() =>
  typeof route.query.cover === 'string' && route.query.cover
    ? `easy-player-media://cover?path=${encodeURIComponent(route.query.cover)}`
    : null
)
async function playAll(): Promise<void> {
  if (playing.value || !statistics.enabled) return
  playing.value = true
  try {
    await songList.value?.playAll()
  } finally {
    playing.value = false
  }
}
</script>

<template>
  <section v-if="!source" class="p-8 text-sm text-text-l">
    {{ t('playlist.notFound') }}
  </section>
  <section v-else class="flex h-full min-h-0 flex-col text-text">
    <header
      class="flex shrink-0 flex-wrap items-center gap-4 px-6 transition-all duration-[var(--motion-duration-standard)]"
      :class="headerCollapsed ? 'py-3' : 'py-6'"
    >
      <div
        class="grid shrink-0 place-items-center overflow-hidden bg-bg-l shadow-lg"
        :class="headerCollapsed ? 'size-11 rounded-lg' : 'size-40 rounded-2xl'"
      >
        <img v-if="coverUrl" :src="coverUrl" :alt="title" class="size-full object-cover" />
        <SvgIcon
          v-else
          :name="source.group === 'recommended' ? 'play-like' : 'control-shuffle'"
          :class-name="headerCollapsed ? 'size-5 text-primary' : 'size-12 text-primary'"
        />
      </div>
      <div class="min-w-0 flex-1" :class="headerCollapsed ? 'basis-32' : 'basis-48'">
        <p v-if="!headerCollapsed" class="text-xs font-semibold text-text-l">
          {{ t('playlist.label') }}
        </p>
        <h1 class="truncate font-bold" :class="headerCollapsed ? 'text-base' : 'mt-2 text-3xl'">
          {{ title }}
        </h1>
        <p class="mt-2 text-sm text-text-l">{{ source.generatedFor }}</p>
        <p v-if="!statistics.enabled" class="mt-2 text-sm text-text-l">
          {{ t('settings.statisticsDisabled') }}
        </p>
      </div>
      <CollectionHeaderActions
        play-variant="primary"
        :playing="playing"
        :disabled="!songList || songList.loading || !statistics.enabled"
        :play-label="t('playlist.play')"
        :back-label="t('playlist.back')"
        @play="playAll"
        @back="router.back()"
      >
        <BaseButton
          variant="ghost"
          size="sm"
          icon-only
          :title="t(headerCollapsed ? 'playlist.expandHeader' : 'playlist.collapseHeader')"
          :aria-label="t(headerCollapsed ? 'playlist.expandHeader' : 'playlist.collapseHeader')"
          :aria-expanded="!headerCollapsed"
          @click="headerCollapsed = !headerCollapsed"
        >
          <SvgIcon
            :name="headerCollapsed ? 'common-expand-down' : 'common-expand-up'"
            class-name="size-4"
          />
        </BaseButton>
      </CollectionHeaderActions>
    </header>
    <SongListView
      :key="`${source.group}:${source.generatedFor}`"
      ref="songList"
      class="min-h-0 flex-1"
      :source="source"
    />
  </section>
</template>
