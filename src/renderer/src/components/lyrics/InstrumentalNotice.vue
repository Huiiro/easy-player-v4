<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import SvgIcon from '@/components/svg/SvgIcon.vue'
const { t } = useI18n()
</script>
<template>
  <div
    class="flex h-full min-h-40 flex-col items-center justify-center gap-3 text-text-l"
    role="status"
    data-instrumental
  >
    <SvgIcon name="common-music-notes" class-name="size-10 opacity-60" />
    <p class="text-lg">{{ t('lyrics.instrumental') }}</p>
    <p class="text-sm opacity-70">{{ t('lyrics.instrumentalHint') }}</p>
  </div>
</template>
