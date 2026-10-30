<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AutoMixRuntimeStatus } from '../../../../shared/autoMixRuntime'
import BaseConfirmDialog from '@/components/ui/BaseConfirmDialog.vue'

const { t } = useI18n()
const status = ref<AutoMixRuntimeStatus>()
const uninstallVisible = ref(false)
const localError = ref('')
const downloading = computed(
  () => status.value && ['checking', 'downloading', 'installing'].includes(status.value.phase)
)
const busy = computed(
  () =>
    downloading.value ||
    (status.value && ['uninstalling', 'clearing-cache'].includes(status.value.phase))
)
const progress = computed(() =>
  status.value?.totalBytes
    ? Math.min(100, Math.round((status.value.receivedBytes / status.value.totalBytes) * 100))
    : 0
)
let unsubscribe: (() => void) | undefined
let revision = 0
async function applyStatus(action: () => Promise<AutoMixRuntimeStatus>): Promise<void> {
  const before = revision
  localError.value = ''
  try {
    const value = await action()
    if (before === revision) status.value = value
  } catch (error) {
    localError.value = String(error)
  }
}
onMounted(async () => {
  unsubscribe = window.api.audio.onEvent('stemRuntimeChanged', (value) => {
    revision++
    status.value = value
  })
  await applyStatus(window.api.audio.getStemRuntimeStatus)
})
onBeforeUnmount(() => unsubscribe?.())
async function download(): Promise<void> {
  await applyStatus(window.api.audio.downloadStemRuntime)
}
async function cancel(): Promise<void> {
  await applyStatus(window.api.audio.cancelStemRuntimeDownload)
}
async function uninstall(): Promise<void> {
  await applyStatus(window.api.audio.uninstallStemRuntime)
}
</script>

<template>
  <div class="rounded-lg border border-border p-3 space-y-2" aria-live="polite">
    <div class="flex items-center justify-between gap-3">
      <span class="font-medium">{{ t('ap.stemComponentTitle') }}</span>
      <div class="flex items-center gap-3">
        <span v-if="status?.installed && !busy" class="text-text-l">{{
          t('ap.stemComponentReady')
        }}</span>
        <button
          v-if="!busy && (status?.installed || status?.hasFiles)"
          type="button"
          class="btn-hover-base px-3 py-1 text-red-400"
          @click="uninstallVisible = true"
        >
          {{ t('ap.stemComponentUninstall') }}
        </button>
        <button
          v-else-if="!busy"
          type="button"
          class="btn-hover-base px-3 py-1"
          :disabled="!status?.supported"
          @click="download"
        >
          {{ t('ap.stemComponentDownload') }}
        </button>
        <button
          v-else-if="downloading"
          type="button"
          class="btn-hover-base px-3 py-1"
          @click="cancel"
        >
          {{ t('ap.stemComponentCancel') }}
        </button>
      </div>
    </div>
    <p class="text-text-l">{{ t('ap.stemComponentDescription') }}</p>
    <p v-if="status && !status.supported" class="text-text-l">
      {{ t('ap.stemComponentUnsupported') }}
    </p>
    <template v-if="busy">
      <p class="text-text-l">
        {{ t(`ap.stemComponent_${status?.phase}`) }}
        <span v-if="status?.phase === 'downloading'"
          >{{ progress }}% · {{ (status.receivedBytes / 1024 ** 2).toFixed(1) }} /
          {{ (status.totalBytes / 1024 ** 2).toFixed(1) }} MiB</span
        >
      </p>
      <progress
        v-if="downloading && status?.totalBytes"
        class="w-full"
        :value="progress"
        max="100"
        :aria-label="t('ap.stemComponent_downloading')"
      />
    </template>
    <p v-if="status?.error || localError" role="alert" class="text-red-400">
      {{ t('ap.stemComponentFailed') }} {{ status?.error || localError }}
    </p>
  </div>
  <BaseConfirmDialog
    v-model="uninstallVisible"
    :title="t('ap.stemComponentUninstall')"
    :message="t('ap.stemComponentUninstallConfirm')"
    :confirm-text="t('ap.stemComponentUninstall')"
    variant="danger"
    :confirm-action="uninstall"
  />
</template>
