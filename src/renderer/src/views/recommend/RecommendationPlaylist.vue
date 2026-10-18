<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import SongListView from '@/components/songlist/SongListView.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useStatisticsStore } from '@/stores/statistics/statisticsStore'
import { useUIStore } from '@/stores/ui/uiStore'
import type { RecommendationGroup } from '@/views/home/types'

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
      class="flex shrink-0 items-center gap-6 px-6 transition-all duration-[var(--motion-duration-standard)]"
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
      <div class="min-w-0 flex-1">
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
        <BaseButton
          v-if="!headerCollapsed"
          class="mt-4"
          :disabled="playing || songList?.loading || !statistics.enabled"
          @click="playAll"
        >
          {{ t('playlist.play') }}
        </BaseButton>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <BaseButton
          v-if="headerCollapsed"
          :disabled="playing || songList?.loading || !statistics.enabled"
          @click="playAll"
        >
          {{ t('playlist.play') }}
        </BaseButton>
        <button
          class="btn-hover grid size-8 place-items-center"
          :title="t(headerCollapsed ? 'playlist.expandHeader' : 'playlist.collapseHeader')"
          @click="headerCollapsed = !headerCollapsed"
        >
          <SvgIcon
            :name="headerCollapsed ? 'common-expand-down' : 'common-expand-up'"
            class-name="size-4"
          />
        </button>
        <button class="btn-hover px-3 py-2 text-sm" @click="router.back()">
          {{ t('playlist.back') }}
        </button>
      </div>
    </header>
    <SongListView
      :key="`${source.group}:${source.generatedFor}`"
      ref="songList"
      class="min-h-0 flex-1"
      :source="source"
    />
  </section>
</template>
