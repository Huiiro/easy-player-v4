<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import SongListView from '@/components/songlist/SongListView.vue'
import { useMessage } from '@/components/ui/useMessage'

const { t } = useI18n()
const { success, error } = useMessage()
const clearDialogOpen = ref(false)
const listKey = ref(0)

async function clearHistory(): Promise<void> {
  const response = await window.api.database.command('clearRecentPlayedSongs')
  if (!response.success) {
    error(response.error || t('history.clearFailed'))
    return
  }
  clearDialogOpen.value = false
  listKey.value++
  success(t('history.cleared'))
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col text-text">
    <header class="flex items-center justify-between px-7 py-5">
      <div>
        <h1 class="text-xl font-bold">{{ t('history.title') }}</h1>
        <p class="mt-1 text-sm text-text-l">{{ t('history.description') }}</p>
      </div>
      <button
        class="btn-hover flex items-center gap-1.5 px-2 py-1.5 text-sm text-red-400"
        :title="t('history.clear')"
        @click="clearDialogOpen = true"
      >
        <SvgIcon name="common-delete" class-name="size-4" />
        {{ t('history.clear') }}
      </button>
    </header>
    <SongListView :key="listKey" :source="{ type: 'history' }" />
  </section>
  <BaseDialog v-model="clearDialogOpen" :title="t('history.clear')" width="max-w-sm">
    <p class="text-sm text-text-l">{{ t('history.clearConfirm') }}</p>
    <template #footer>
      <button class="btn-hover px-3 py-1.5 text-sm" @click="clearDialogOpen = false">
        {{ t('common.cancel') }}
      </button>
      <button class="rounded-lg bg-red-500 px-3 py-1.5 text-sm text-white" @click="clearHistory">
        {{ t('history.clear') }}
      </button>
    </template>
  </BaseDialog>
</template>
