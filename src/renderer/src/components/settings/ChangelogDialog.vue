<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import { VERSION } from '@/consts'
import { parseChangelog } from '@/utils/changelog'
import changelogZh from '../../../../../docs/changelog.zh.md?raw'
import changelogEn from '../../../../../docs/changelog.en.md?raw'

const open = defineModel<boolean>({ required: true })
const { t, locale } = useI18n()
const entries = computed(() =>
  parseChangelog(locale.value.startsWith('zh') ? changelogZh : changelogEn)
)
</script>

<template>
  <BaseDialog v-model="open" :title="t('settings.changelog')" width="max-w-3xl">
    <div class="custom-scrollbar max-h-[65vh] overflow-y-auto pr-2">
      <div v-if="entries.length" class="space-y-6 select-text">
        <section v-for="entry in entries" :key="entry.version">
          <div class="mb-3 flex items-center gap-2">
            <h3 class="text-base font-semibold text-text">v{{ entry.version }}</h3>
            <span
              v-if="entry.version === VERSION"
              class="rounded-md bg-primary/10 px-2 py-0.5 text-xs text-primary"
            >
              {{ t('settings.currentVersion') }}
            </span>
          </div>
          <ul class="list-disc space-y-2 pl-5 text-sm leading-relaxed text-text-l">
            <li v-for="(note, index) in entry.notes" :key="index" class="break-words">
              {{ note }}
            </li>
          </ul>
        </section>
      </div>
      <p v-else class="py-8 text-center text-sm text-text-l">
        {{ t('settings.changelogEmpty') }}
      </p>
    </div>
  </BaseDialog>
</template>
