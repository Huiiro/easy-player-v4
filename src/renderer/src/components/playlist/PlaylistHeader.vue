<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import SvgIcon from '@/components/svg/SvgIcon.vue'

withDefaults(
  defineProps<{
    collapsed: boolean
    title: string
    coverUrl?: string | null
    icon?: string
    playing?: boolean
  }>(),
  { coverUrl: null, icon: 'common-music', playing: false }
)
const emit = defineEmits<{
  'update:collapsed': [value: boolean]
  selectCover: []
  play: []
  back: []
}>()
const { t } = useI18n()
const playButtonClass =
  'btn-hover-base rounded-lg bg-primary px-3 py-1.5 text-sm text-white hover:text-white disabled:opacity-50'
</script>

<template>
  <header
    class="flex shrink-0 gap-6 px-6 transition-all duration-[var(--motion-duration-standard)]"
    :class="collapsed ? 'items-center py-3' : 'items-end py-6'"
  >
    <button
      type="button"
      class="group relative grid shrink-0 place-items-center overflow-hidden bg-bg-l shadow-lg transition-all duration-[var(--motion-duration-standard)]"
      :class="collapsed ? 'size-11 rounded-lg' : 'size-40 rounded-2xl'"
      :title="t('playlist.setCover')"
      @click="emit('selectCover')"
    >
      <img v-if="coverUrl" :src="coverUrl" class="size-full object-cover" :alt="title" />
      <SvgIcon
        v-else
        :name="icon"
        :class-name="collapsed ? 'size-5 text-text-l' : 'size-12 text-text-l'"
      />
      <span
        class="absolute inset-0 grid place-items-center bg-black/45 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
      >
        {{ t('playlist.changeCover') }}
      </span>
    </button>
    <slot name="cover-input" />
    <div class="min-w-0 flex-1">
      <p v-if="!collapsed" class="ml-1 text-xs font-semibold tracking-[.12em] text-text-l">
        {{ t('playlist.label') }}
      </p>
      <div class="flex min-w-0 items-center gap-2" :class="collapsed ? '' : 'mt-2'">
        <slot name="title" :collapsed="collapsed">
          <h1 class="truncate font-bold" :class="collapsed ? 'text-base' : 'text-3xl'">
            {{ title }}
          </h1>
        </slot>
      </div>
      <template v-if="!collapsed">
        <slot name="details" />
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" :class="playButtonClass" :disabled="playing" @click="emit('play')">
            {{ t('playlist.play') }}
          </button>
          <slot name="actions" />
        </div>
      </template>
    </div>
    <div class="flex shrink-0 items-center gap-1">
      <button
        type="button"
        class="btn-hover grid size-8 place-items-center"
        :title="t(collapsed ? 'playlist.expandHeader' : 'playlist.collapseHeader')"
        :aria-label="t(collapsed ? 'playlist.expandHeader' : 'playlist.collapseHeader')"
        :aria-expanded="!collapsed"
        @click="emit('update:collapsed', !collapsed)"
      >
        <SvgIcon
          :name="collapsed ? 'common-expand-down' : 'common-expand-up'"
          class-name="size-4"
        />
      </button>
      <button
        v-if="collapsed"
        type="button"
        :class="playButtonClass"
        :disabled="playing"
        @click="emit('play')"
      >
        {{ t('playlist.play') }}
      </button>
    </div>
    <button
      v-if="!collapsed"
      type="button"
      class="btn-hover mb-1 flex shrink-0 items-center gap-1 text-sm"
      @click="emit('back')"
    >
      <SvgIcon name="common-back" class-name="size-3.5" />
      {{ t('playlist.back') }}
    </button>
  </header>
</template>
