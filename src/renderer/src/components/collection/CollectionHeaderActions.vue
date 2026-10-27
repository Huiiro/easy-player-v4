<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import BaseButton from '@/components/ui/BaseButton.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'

withDefaults(
  defineProps<{
    playing?: boolean
    disabled?: boolean
    playLabel?: string
    backLabel?: string
  }>(),
  { playing: false, disabled: false }
)
const emit = defineEmits<{ play: []; back: [] }>()
const { t } = useI18n()
</script>

<template>
  <div class="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2">
    <slot />
    <BaseButton variant="ghost" size="sm" @click="emit('back')">
      {{ backLabel || t('library.back') }}
    </BaseButton>
    <BaseButton size="sm" :disabled="disabled" :loading="playing" @click="emit('play')">
      <template v-if="!playing" #left>
        <SvgIcon name="play-play" class-name="size-4" />
      </template>
      {{ playLabel || t('songList.play') }}
    </BaseButton>
  </div>
</template>
