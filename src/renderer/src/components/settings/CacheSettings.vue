<script setup lang="ts">
import BaseButton from '@/components/ui/BaseButton.vue'
import SettingRow from './SettingRow.vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseConfirmDialog from '@/components/ui/BaseConfirmDialog.vue'
import type { AutoMixRuntimeStatus, AutoMixStemCacheInfo } from '../../../../shared/autoMixRuntime'

const { t } = useI18n()
const cacheDirectory = ref('')
const cacheLimitGb = ref(2)
const cacheUsed = ref(0)
const stemCache = ref<AutoMixStemCacheInfo>()
const stemStatus = ref<AutoMixRuntimeStatus>()
const stemError = ref('')
const clearStemVisible = ref(false)
const stemClearing = ref(false)
const stemBusy = computed(
  () =>
    stemClearing.value ||
    (stemStatus.value &&
      ['checking', 'downloading', 'installing', 'uninstalling', 'clearing-cache'].includes(
        stemStatus.value.phase
      ))
)
let unsubscribe: (() => void) | undefined
let cacheRevision = 0
async function loadStemCache(): Promise<void> {
  const revision = ++cacheRevision
  try {
    const info = await window.api.audio.getStemCacheInfo()
    if (revision === cacheRevision) {
      stemCache.value = info
      stemError.value = ''
    }
  } catch (error) {
    if (revision === cacheRevision) stemError.value = String(error)
  }
}
async function clearStemCache(): Promise<void> {
  cacheRevision++
  stemClearing.value = true
  try {
    const result = await window.api.audio.clearStemCache()
    if (!result.success) throw new Error(result.error)
    stemCache.value = result.data
    stemError.value = ''
  } catch (error) {
    stemError.value = String(error)
  } finally {
    stemClearing.value = false
  }
}
const formatBytes = (bytes: number): string =>
  bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
async function loadCache(): Promise<void> {
  const [directory, limit, fallback] = await Promise.all([
    window.api.database.command('getSetting', { key: 'remote.cache-directory' }),
    window.api.database.command('getSetting', { key: 'remote.cache-limit-gb' }),
    window.api.remoteSource.defaultCacheDirectory()
  ])
  cacheDirectory.value =
    directory.success && typeof directory.data === 'string' ? directory.data : fallback.data || ''
  cacheLimitGb.value = limit.success && typeof limit.data === 'number' ? limit.data : 2
  const size = await window.api.remoteSource.cacheSize(cacheDirectory.value)
  cacheUsed.value = size.data || 0
}
async function chooseCacheDirectory(): Promise<void> {
  const result = await window.api.remoteSource.chooseCacheDirectory()
  if (!result.success || !result.data) return
  await window.api.database.command('setSetting', {
    key: 'remote.cache-directory',
    value: result.data
  })
  await loadCache()
}
async function saveCacheLimit(): Promise<void> {
  cacheLimitGb.value = Math.max(0.5, Math.min(100, Number(cacheLimitGb.value) || 2))
  await window.api.database.command('setSetting', {
    key: 'remote.cache-limit-gb',
    value: cacheLimitGb.value
  })
}
onMounted(() => {
  void loadCache()
  void loadStemCache()
  let updated = false
  unsubscribe = window.api.audio.onEvent('stemRuntimeChanged', (value) => {
    updated = true
    stemStatus.value = value
  })
  void window.api.audio
    .getStemRuntimeStatus()
    .then((value) => {
      if (!updated) stemStatus.value = value
    })
    .catch((error) => {
      stemError.value = String(error)
    })
})
onBeforeUnmount(() => unsubscribe?.())
</script>

<template>
  <div class="file-management">
    <div class="setting-row">
      <div>
        <h3>{{ t('remote.cacheDirectory') }}</h3>
        <p>{{ t('remote.cacheUsed', { size: formatBytes(cacheUsed) }) }}</p>
      </div>
      <div class="file-path-control">
        <input :value="cacheDirectory" readonly class="input-base" />
        <BaseButton size="sm" variant="ghost" type="button" @click="chooseCacheDirectory">
          {{ t('remote.chooseDirectory') }}
        </BaseButton>
      </div>
    </div>
    <SettingRow :label="t('remote.cacheLimit')" :description="t('remote.cacheDescription')">
      <div class="flex items-center gap-2">
        <input
          v-model.number="cacheLimitGb"
          class="input-base h-7 max-w-18"
          type="number"
          min="0.5"
          max="20"
          step="0.5"
          @change="saveCacheLimit"
        />
        <span>G</span>
      </div>
    </SettingRow>
    <SettingRow :label="t('ap.stemCacheTitle')" :description="t('ap.stemCacheDescription')">
      <div class="flex items-center gap-3">
        <span class="text-xs text-text-l">{{
          stemCache
            ? t('ap.stemCacheUsage', { size: formatBytes(stemCache.bytes), count: stemCache.files })
            : '—'
        }}</span>
        <BaseButton
          size="sm"
          variant="ghost"
          type="button"
          :disabled="stemBusy"
          @click="loadStemCache"
        >
          {{ t('ap.stemCacheRefresh') }}
        </BaseButton>
        <BaseButton
          size="sm"
          variant="danger"
          type="button"
          :disabled="stemBusy || !stemCache?.files"
          @click="clearStemVisible = true"
        >
          {{ t('ap.stemCacheClear') }}
        </BaseButton>
      </div>
    </SettingRow>
    <p v-if="stemError" class="text-sm text-red-400" role="alert">
      {{ t('ap.stemCacheFailed') }} {{ stemError }}
    </p>
  </div>
  <BaseConfirmDialog
    v-model="clearStemVisible"
    :title="t('ap.stemCacheClear')"
    :message="t('ap.stemCacheConfirm')"
    :confirm-text="t('ap.stemCacheClear')"
    variant="danger"
    :confirm-action="clearStemCache"
  />
</template>

<style scoped>
.file-path-control,
.file-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 0 0 auto;
}
.file-path-control .input-base {
  width: 34rem;
}
</style>
