<script setup lang="ts">
import { computed, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { useMessage } from '@/components/ui/useMessage'
import { useSourceMetadata } from './useSourceMetadata'
import { networkSourceName } from '@/hooks/useNetworkSources'

const props = defineProps<{ modelValue: boolean; songId: number | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; saved: [] }>()
const { t } = useI18n()
const { error: showError } = useMessage()
const {
  sources,
  sourceId,
  query,
  results,
  detail,
  assets,
  selected,
  loading,
  searching,
  fetching,
  saving,
  fetchingLyrics,
  fetchingCover,
  error,
  errorTitle,
  searched,
  snapshot,
  rows,
  selectedCount,
  allSelected,
  partiallySelected,
  canSave,
  search,
  choose,
  fetchLyrics,
  fetchCover,
  selectAll,
  cancelPending,
  save
} = useSourceMetadata(
  toRef(props, 'songId'),
  toRef(props, 'modelValue'),
  (key) => t('metadataEdit.' + key),
  () => {
    emit('saved')
    emit('update:modelValue', false)
  },
  (message) => {
    showError(message, 5000)
  }
)
const sourceOptions = computed(() =>
  sources.value.map((source) => ({ value: source.id, label: networkSourceName(source, t) }))
)
const checkboxClass =
  'size-4 shrink-0 cursor-pointer rounded border-border accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50'
function duration(ms?: number): string {
  if (!ms) return ''
  const seconds = Math.round(ms / 1000)
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')
}
function toggleAll(event: Event): void {
  selectAll((event.target as HTMLInputElement).checked)
}
</script>

<template>
  <BaseDialog
    :model-value="modelValue"
    :title="t('metadataEdit.networkMatch')"
    width="max-w-4xl"
    :close-on-overlay="false"
    :close-on-esc="!saving"
    :show-close="!saving"
    @update:model-value="!saving && emit('update:modelValue', $event)"
  >
    <div class="flex max-h-[70vh] min-h-0 flex-col gap-4">
      <p class="shrink-0 text-sm text-text-l">{{ t('metadataEdit.networkHint') }}</p>
      <div class="flex shrink-0 flex-wrap items-end gap-2">
        <div class="w-36 max-w-full shrink-0 space-y-1.5">
          <p class="text-xs text-text-l">{{ t('metadataEdit.networkSource') }}</p>
          <BaseSelect
            v-model="sourceId"
            class="w-full"
            :options="sourceOptions"
            :aria-label="t('metadataEdit.networkSource')"
            :disabled="loading || saving"
          />
        </div>
        <div class="min-w-40 flex-1 space-y-1.5">
          <p class="text-xs text-text-l">{{ t('metadataEdit.networkQueryLabel') }}</p>
          <BaseInput
            v-model="query"
            :clearable="false"
            :disabled="saving || loading"
            :aria-label="t('metadataEdit.networkQueryLabel')"
            :placeholder="t('metadataEdit.networkQuery')"
            @keyup.enter="!saving && !searching && search()"
          />
        </div>
        <BaseButton
          :loading="searching"
          :disabled="loading || saving || !sourceId || !query.trim()"
          @click="search"
          >{{ t('metadataEdit.networkSearch') }}</BaseButton
        >
        <BaseButton
          v-if="searching || fetching || fetchingLyrics || fetchingCover"
          variant="secondary"
          @click="cancelPending"
          >{{ t('common.cancelRequest') }}</BaseButton
        >
      </div>

      <div
        v-if="error"
        role="alert"
        class="shrink-0 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm"
      >
        <p class="font-medium text-danger">{{ errorTitle }}</p>
        <p v-if="error !== errorTitle" class="mt-1 break-words text-text">{{ error }}</p>
      </div>

      <div class="custom-scrollbar min-h-0 space-y-4 overflow-y-auto p-0.5">
        <p v-if="loading" role="status" class="flex items-center gap-2 py-4 text-sm text-text-l">
          <span class="ep-spinner" aria-hidden="true" />{{ t('metadataEdit.loading') }}
        </p>
        <div
          v-if="results.length"
          class="custom-scrollbar max-h-36 overflow-y-auto rounded-lg border border-border"
        >
          <button
            v-for="item in results"
            :key="item.resource.sourceId + ':' + item.resource.resourceId"
            type="button"
            :disabled="saving"
            :aria-pressed="detail?.resource.resourceId === item.resource.resourceId"
            class="ep-focusable flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2.5 text-left text-sm transition-colors last:border-b-0 hover:bg-hover-bg disabled:cursor-not-allowed disabled:opacity-50"
            :class="detail?.resource.resourceId === item.resource.resourceId ? 'bg-primary/10' : ''"
            @click="choose(item)"
          >
            <span class="min-w-0">
              <span class="block truncate font-medium">{{ item.title }}</span>
              <span class="mt-0.5 block truncate text-xs text-text-l"
                >{{ item.artist }} · {{ item.album }}</span
              >
            </span>
            <span class="shrink-0 text-xs tabular-nums text-text-l">{{
              duration(item.durationMs)
            }}</span>
          </button>
        </div>
        <p
          v-else-if="searched && !searching && !error"
          class="rounded-lg border border-border py-6 text-center text-sm text-text-l"
        >
          {{ t('metadataEdit.networkEmpty') }}
        </p>
        <p v-if="fetching" role="status" class="flex items-center gap-2 py-4 text-sm text-text-l">
          <span class="ep-spinner" aria-hidden="true" />{{
            t('metadataEdit.networkDetailsLoading')
          }}
        </p>

        <div v-if="detail" class="space-y-3">
          <div
            class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg-l/30 p-3"
          >
            <div class="min-w-0 flex-1">
              <p class="break-words text-sm font-medium">{{ detail.title }}</p>
              <p class="mt-1 break-words text-xs text-text-l">
                {{ detail.artist }} · {{ detail.album }}
              </p>
              <p v-if="detail.releaseDate" class="mt-1 text-xs tabular-nums text-text-l">
                {{ detail.releaseDate }}
              </p>
            </div>
            <div class="flex flex-wrap gap-2">
              <BaseButton
                size="sm"
                variant="secondary"
                :loading="fetchingLyrics"
                :disabled="saving || Boolean(assets.lyrics)"
                @click="fetchLyrics"
              >
                {{
                  assets.lyrics
                    ? t('metadataEdit.networkLyricsReady')
                    : t('metadataEdit.networkGetLyrics')
                }}
              </BaseButton>
              <BaseButton
                v-if="detail.artwork"
                size="sm"
                variant="secondary"
                :loading="fetchingCover"
                :disabled="saving || Boolean(assets.coverDataUrl)"
                @click="fetchCover"
              >
                {{
                  assets.coverDataUrl
                    ? t('metadataEdit.networkCoverReady')
                    : t('metadataEdit.networkGetCover')
                }}
              </BaseButton>
            </div>
          </div>
          <p class="text-xs text-text-l">{{ t('metadataEdit.networkSelectionHint') }}</p>
          <p v-if="!snapshot" class="text-sm text-danger">
            {{ t('metadataEdit.networkSnapshotFailed') }}
          </p>
          <template v-else-if="rows.length">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-xs text-text-l">{{
                t('metadataEdit.networkSelectedCount', { count: selectedCount, total: rows.length })
              }}</span>
              <BaseButton
                size="sm"
                variant="ghost"
                :disabled="saving"
                @click="selectAll(!allSelected)"
              >
                {{
                  allSelected
                    ? t('metadataEdit.networkClearSelection')
                    : t('metadataEdit.networkSelectAll')
                }}
              </BaseButton>
            </div>
            <div class="custom-scrollbar max-h-64 overflow-auto rounded-lg border border-border">
              <table class="w-full table-fixed text-left text-sm">
                <thead class="sticky top-0 z-10 bg-bg-l text-xs text-text-l">
                  <tr>
                    <th scope="col" class="w-32 p-3">
                      <label class="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          :class="checkboxClass"
                          :checked="allSelected"
                          :indeterminate="partiallySelected"
                          :disabled="saving"
                          :aria-label="t('metadataEdit.networkSelectAll')"
                          @change="toggleAll"
                        />
                        {{ t('metadataEdit.networkField') }}
                      </label>
                    </th>
                    <th scope="col" class="p-3">{{ t('metadataEdit.networkCurrent') }}</th>
                    <th scope="col" class="p-3">{{ t('metadataEdit.networkIncoming') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in rows"
                    :key="row.field"
                    class="border-t border-border align-top transition-colors"
                    :class="selected.includes(row.field) ? 'bg-primary/5' : ''"
                  >
                    <th scope="row" class="p-3 text-left font-normal">
                      <label class="flex cursor-pointer items-center gap-2">
                        <input
                          v-model="selected"
                          type="checkbox"
                          :class="checkboxClass"
                          :value="row.field"
                          :disabled="saving"
                        />
                        {{
                          t(
                            'metadataEdit.' +
                              (row.field === 'coverDataUrl' ? 'networkCover' : row.field)
                          )
                        }}
                      </label>
                    </th>
                    <td class="break-words p-3 text-text-l">
                      <span v-if="row.field === 'coverDataUrl'">{{
                        t(
                          snapshot.hasCover
                            ? 'metadataEdit.networkExistingCover'
                            : 'metadataEdit.networkBlank'
                        )
                      }}</span>
                      <pre
                        v-else-if="row.field === 'lyrics'"
                        class="custom-scrollbar max-h-28 overflow-auto whitespace-pre-wrap font-sans text-xs"
                        >{{ row.current || t('metadataEdit.networkBlank') }}</pre>
                      <span v-else>{{ row.current ?? t('metadataEdit.networkBlank') }}</span>
                    </td>
                    <td class="break-words p-3">
                      <img
                        v-if="row.field === 'coverDataUrl'"
                        :src="String(row.incoming)"
                        :alt="t('metadataEdit.networkCover')"
                        class="size-20 rounded-lg object-cover"
                      />
                      <pre
                        v-else-if="row.field === 'lyrics'"
                        class="custom-scrollbar max-h-28 overflow-auto whitespace-pre-wrap font-sans text-xs"
                        >{{ row.incoming }}</pre>
                      <span v-else>{{ row.incoming }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
          <p v-else class="rounded-lg border border-border py-5 text-center text-sm text-text-l">
            {{ t('metadataEdit.networkNoChanges') }}
          </p>
        </div>
      </div>
    </div>
    <template #footer>
      <div class="flex w-full flex-wrap items-center justify-between gap-3">
        <p class="text-xs text-text-l">{{ t('metadataEdit.networkWriteHint') }}</p>
        <div class="ml-auto flex shrink-0 gap-2">
          <BaseButton
            variant="secondary"
            :disabled="saving"
            @click="emit('update:modelValue', false)"
            >{{ t('metadataEdit.cancel') }}</BaseButton
          >
          <BaseButton :disabled="!canSave" :loading="saving" @click="save">{{
            t('metadataEdit.networkSaveSelected')
          }}</BaseButton>
        </div>
      </div>
    </template>
  </BaseDialog>
</template>
