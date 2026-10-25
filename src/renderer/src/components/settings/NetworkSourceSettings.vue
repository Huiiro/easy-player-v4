<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingRow from './SettingRow.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useMessage } from '@/components/ui/useMessage'
import { useNetworkSources, networkSourceName } from '@/hooks/useNetworkSources'

const { t } = useI18n()
const { error: showError } = useMessage()
const { sources, loading, error, reload } = useNetworkSources()
const busy = ref('')
const saveError = ref('')
const failure = computed(() => saveError.value || error.value)
watch(error, (value) => {
  if (value) showError(value)
})
async function retryLoad(): Promise<void> {
  saveError.value = ''
  await reload()
}
async function change(sourceId: string, enabled: boolean | string | number): Promise<void> {
  if (busy.value || typeof enabled !== 'boolean') return
  busy.value = sourceId
  saveError.value = ''
  try {
    const response = await window.api.networkSources.setEnabled(sourceId, enabled)
    if (!response.success) throw new Error(response.error || t('networkSources.saveFailed'))
    await reload()
  } catch (reason) {
    saveError.value = reason instanceof Error ? reason.message : t('networkSources.saveFailed')
    showError(saveError.value)
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <div class="network-source-settings">
    <p class="px-5 pt-3 pb-1 text-xs leading-relaxed text-text-l">
      {{ t('networkSources.changeHint') }}
    </p>
    <div
      v-if="failure"
      role="alert"
      class="mx-5 my-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger"
    >
      <span>{{ failure }}</span>
      <BaseButton
        v-if="error && !saveError"
        size="sm"
        variant="secondary"
        :loading="loading"
        :disabled="Boolean(busy)"
        @click="retryLoad"
        >{{ t('networkSources.retry') }}</BaseButton
      >
    </div>
    <p
      v-if="loading && !sources.length"
      role="status"
      class="flex items-center gap-2 px-5 py-4 text-sm text-text-l"
    >
      <span class="ep-spinner" aria-hidden="true" />{{ t('networkSources.loading') }}
    </p>
    <p v-else-if="!sources.length && !failure" class="px-5 py-4 text-sm text-text-l">
      {{ t('networkSources.empty') }}
    </p>
    <SettingRow
      v-for="source in sources"
      :key="source.id"
      class="network-source-row"
      :label="networkSourceName(source, t)"
    >
      <template #description>
        <span class="network-source-meta">
          <span>{{ t('networkSources.builtin') }}</span>
          <span v-if="source.version" class="tabular-nums">v{{ source.version }}</span>
          <span>{{
            source.capabilities
              .map((capability) => t('networkSources.capabilities.' + capability))
              .join(' / ')
          }}</span>
        </span>
        <span
          v-if="source.pluginState && source.pluginState !== 'active'"
          class="mt-0.5 block text-text-l"
          >{{ t('plugins.sourceInactive') }}</span
        >
      </template>
      <template #default="{ labelId, descriptionId }">
        <div class="flex shrink-0 items-center gap-2">
          <span class="text-xs text-text-l" aria-live="polite"
            ><span
              v-if="busy === source.id"
              class="ep-spinner inline-block"
              :aria-label="t('networkSources.saving')"
            /><template v-else>{{
              source.enabled ? t('networkSources.enabled') : t('networkSources.disabled')
            }}</template></span
          >
          <BaseSwitch
            :model-value="source.enabled"
            :aria-labelledby="labelId"
            :aria-describedby="descriptionId"
            :disabled="
              loading ||
              Boolean(busy) ||
              Boolean(source.pluginState && source.pluginState !== 'active')
            "
            @change="change(source.id, $event)"
          />
        </div>
      </template>
    </SettingRow>
  </div>
</template>

<style scoped>
.network-source-settings .network-source-row {
  min-height: 0;
  gap: 1rem;
  padding: 0.7rem 1.25rem;
}
.network-source-row :deep(h3) {
  overflow-wrap: anywhere;
}
.network-source-settings .network-source-row :deep(p) {
  font-size: 0.75rem;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.network-source-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.15rem 0.6rem;
}
</style>
