<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { useMessage } from '@/components/ui/useMessage'
import { useUIStore } from '@/stores/ui/uiStore'
import type { LogEntry } from '@/types/audio'

const ui = useUIStore()
const { t } = useI18n()
const { error: showError } = useMessage()
const logLevel = ref<LogEntry['level']>('info')
const logLevelBusy = ref(true)
const associationBusy = ref(false)
async function openDefaultApps(): Promise<void> {
  associationBusy.value = true
  try {
    const result = await window.api.system.openDefaultApps()
    if (!result.success) showError(t('settings.fileAssociationFailed'))
  } catch {
    showError(t('settings.fileAssociationFailed'))
  } finally {
    associationBusy.value = false
  }
}
const logLevelOptions = computed(() => [
  { label: t('settings.logLevelDebug'), value: 'debug' },
  { label: t('settings.logLevelInfo'), value: 'info' },
  { label: t('settings.logLevelWarn'), value: 'warn' },
  { label: t('settings.logLevelError'), value: 'error' }
])

async function changeLogLevel(value: string | number | (string | number)[]): Promise<void> {
  if (value !== 'debug' && value !== 'info' && value !== 'warn' && value !== 'error') return
  if (logLevelBusy.value || value === logLevel.value) return
  logLevelBusy.value = true
  try {
    const result = await window.api.log.setLevel(value)
    if (result.success && result.level) logLevel.value = result.level
    else showError(t('settings.logLevelSaveFailed'))
  } catch {
    showError(t('settings.logLevelSaveFailed'))
  } finally {
    logLevelBusy.value = false
  }
}

onMounted(async () => {
  try {
    logLevel.value = await window.api.log.getLevel()
  } catch {
    showError(t('settings.logLevelLoadFailed'))
  } finally {
    logLevelBusy.value = false
  }
})
type UpdateStatus = { state: string; version: string; percent?: number; message?: string }
const updateStatus = ref<UpdateStatus>({ state: 'idle', version: '' })
const updateBusy = ref(false)
let stopListening: (() => void) | undefined

async function checkForUpdate(): Promise<void> {
  updateBusy.value = true
  const result = await window.api.appUpdate.check()
  if (!result.success) updateStatus.value = { state: 'error', version: '', message: result.error }
  else if (result.data) updateStatus.value = result.data as UpdateStatus
  updateBusy.value = false
}
async function downloadUpdate(): Promise<void> {
  updateBusy.value = true
  const result = await window.api.appUpdate.download()
  if (!result.success) updateStatus.value = { state: 'error', version: '', message: result.error }
  updateBusy.value = false
}
async function installUpdate(): Promise<void> {
  await window.api.appUpdate.install()
}
onMounted(async () => {
  stopListening = window.api.appUpdate.onStatus(
    (status) => (updateStatus.value = status as UpdateStatus)
  )
  const result = await window.api.appUpdate.status()
  if (result.data) updateStatus.value = result.data as UpdateStatus
})
onBeforeUnmount(() => stopListening?.())
watch(
  () => ui.closeToTray,
  (enabled) => void window.api.system.setCloseToTray(enabled),
  { immediate: true }
)
watch(
  () => ui.autoStart,
  (enabled) => void window.api.system.setAutoStart(enabled),
  { immediate: true }
)
</script>

<template>
  <div v-if="ui.platform === 'win'" class="system-row">
    <div>
      <h3>{{ t('settings.fileAssociation') }}</h3>
      <p>{{ t('settings.fileAssociationDescription') }}</p>
    </div>
    <button
      class="btn-hover-base text-sm text-nowrap"
      :disabled="associationBusy"
      @click="openDefaultApps"
    >
      {{ t('settings.configureFileAssociation') }}
    </button>
  </div>
  <div class="system-row">
    <div>
      <h3>{{ t('settings.closeToTray') }}</h3>
      <p>{{ t('settings.closeToTrayDescription') }}</p>
    </div>
    <BaseSwitch v-model="ui.closeToTray" size="md" />
  </div>
  <div class="system-row">
    <div>
      <h3>{{ t('settings.autoStart') }}</h3>
      <p>{{ t('settings.autoStartDescription') }}</p>
    </div>
    <BaseSwitch v-model="ui.autoStart" size="md" />
  </div>
  <div class="system-row">
    <div>
      <h3>{{ t('settings.logLevel') }}</h3>
      <p>{{ t('settings.logLevelDescription') }}</p>
    </div>
    <BaseSelect
      :model-value="logLevel"
      :options="logLevelOptions"
      :disabled="logLevelBusy"
      :aria-label="t('settings.logLevel')"
      teleport
      class="w-48 shrink-0"
      @update:model-value="changeLogLevel"
    />
  </div>
  <div class="system-row">
    <div>
      <h3>{{ t('settings.appUpdate') }}</h3>
      <p v-if="updateStatus.state === 'available'">
        {{ t('settings.updateAvailable', { version: updateStatus.version }) }}
      </p>
      <p v-else-if="updateStatus.state === 'downloading'">
        {{ t('settings.updateDownloading', { percent: Math.round(updateStatus.percent || 0) }) }}
      </p>
      <p v-else-if="updateStatus.state === 'downloaded'">
        {{ t('settings.updateDownloaded', { version: updateStatus.version }) }}
      </p>
      <p v-else-if="updateStatus.state === 'not-available'">
        {{ t('settings.updateNotAvailable') }}
      </p>
      <p v-else-if="updateStatus.state === 'error'">{{ updateStatus.message }}</p>
      <p v-else>{{ t('settings.appUpdateDescription') }}</p>
    </div>
    <button
      v-if="updateStatus.state === 'available'"
      class="btn-hover-base text-sm text-nowrap"
      :disabled="updateBusy"
      @click="downloadUpdate"
    >
      {{ t('settings.downloadUpdate') }}
    </button>
    <button
      v-else-if="updateStatus.state === 'downloaded'"
      class="btn-hover-base text-sm text-nowrap"
      @click="installUpdate"
    >
      {{ t('settings.restartAndInstall') }}
    </button>
    <button
      v-else
      class="btn-hover-base text-sm text-nowrap"
      :disabled="
        updateBusy || updateStatus.state === 'checking' || updateStatus.state === 'downloading'
      "
      @click="checkForUpdate"
    >
      {{ t('settings.checkForUpdates') }}
    </button>
  </div>
</template>

<style scoped>
.system-row {
  display: flex;
  min-height: 76px;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
  padding: 1.1rem 1.25rem;
}
.system-row h3 {
  color: var(--color-text);
  font-size: 0.9rem;
  font-weight: 550;
}
.system-row p {
  margin-top: 0.25rem;
  color: var(--color-text-l);
  font-size: 0.8125rem;
  line-height: 1.45;
}
</style>
