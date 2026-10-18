<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import type { RecommendationCard, RecommendationGroup } from './types'

const props = defineProps<{
  cards: RecommendationCard[]
  activeCard: string | null
  pending: boolean
  playlistBusy: boolean
  isPlaying: boolean
}>()
const emit = defineEmits<{ play: [card: RecommendationCard] }>()
const { t } = useI18n()
const router = useRouter()
const recommendationIcons: Record<RecommendationGroup, string> = {
  recommended: 'play-like',
  discovery: 'control-shuffle'
}
function recommendationCardKey(card: RecommendationCard): string {
  return `${card.group}:${card.generatedFor}`
}
function recommendationCardName(card: RecommendationCard): string {
  return `${t(`recommendation.${card.group}`)} · ${card.generatedFor}`
}
function recommendationCoverUrl(card: RecommendationCard): string | null {
  const cover = card.songs.find((song) => song.cover)?.cover
  return cover ? `easy-player-media://cover?path=${encodeURIComponent(cover)}` : null
}
</script>

<template>
  <section class="xl:col-span-2">
    <div class="mb-3 flex items-center justify-between">
      <h2 class="text-lg font-semibold">{{ t('recommendation.title') }}</h2>
      <button class="text-sm text-text-l hover:text-primary" @click="router.push('/recommend')">
        {{ t('home.viewRecommendations') }}
      </button>
    </div>
    <div class="flex flex-wrap gap-4">
      <article v-for="card in props.cards" :key="recommendationCardKey(card)" class="w-36 shrink-0">
        <button
          class="group relative grid size-36 place-items-center overflow-hidden rounded-xl bg-bg-l disabled:cursor-not-allowed disabled:opacity-50"
          :aria-label="
            props.activeCard === recommendationCardKey(card) && props.isPlaying
              ? t('footer.pause')
              : t('home.playRecommendation', { name: recommendationCardName(card) })
          "
          :title="
            props.activeCard === recommendationCardKey(card) && props.isPlaying
              ? t('footer.pause')
              : t('home.playRecommendation', { name: recommendationCardName(card) })
          "
          :disabled="props.pending || props.playlistBusy || card.total === 0"
          @click="emit('play', card)"
        >
          <img
            v-if="recommendationCoverUrl(card)"
            :src="recommendationCoverUrl(card)!"
            class="size-full object-cover transition-transform duration-[var(--motion-duration-standard)] group-hover:scale-105"
            :alt="t(`recommendation.${card.group}`)"
          />
          <SvgIcon
            v-else
            :name="recommendationIcons[card.group]"
            class-name="size-12 text-primary"
          />
          <span
            v-if="card.total > 0"
            class="playlist-cover-overlay pointer-events-none absolute inset-0 bg-black/45 opacity-0 transition-opacity duration-[var(--motion-duration-standard)] group-hover:opacity-100 group-focus-visible:opacity-100"
            aria-hidden="true"
          />
          <span
            v-if="card.total > 0"
            class="playlist-cover-action pointer-events-none absolute left-1/2 top-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 scale-90 place-items-center rounded-full bg-primary text-white opacity-0 shadow-lg transition-all duration-[var(--motion-duration-standard)] group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100"
          >
            <SvgIcon
              :name="
                props.activeCard === recommendationCardKey(card) && props.isPlaying
                  ? 'play-pause'
                  : 'play-play'
              "
              class-name="size-6"
            />
          </span>
        </button>
        <button
          class="mt-2 block w-full truncate text-center text-sm font-medium hover:text-primary focus-visible:text-primary disabled:cursor-not-allowed"
          :class="props.activeCard === recommendationCardKey(card) ? 'text-primary' : ''"
          :aria-label="recommendationCardName(card)"
          :title="recommendationCardName(card)"
          @click="
            router.push({
              name: 'RecommendationPlaylist',
              params: { group: card.group, generatedFor: card.generatedFor },
              query: { cover: card.songs.find((song) => song.cover)?.cover || undefined }
            })
          "
        >
          {{ t(`recommendation.${card.group}`) }}
        </button>
        <p class="text-center text-xs text-text-l">{{ card.generatedFor }}</p>
        <p class="text-center text-xs text-text-l">
          {{ t('home.recommendationCount', { count: card.total }) }}
        </p>
      </article>
    </div>
  </section>
</template>
