<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { useMessage } from '@/components/ui/useMessage'
import type { PluginInfo } from '../../../../shared/plugins'
import type { PluginLogEntry } from '../../../../shared/pluginLogs'

const open = defineModel<boolean>({ required: true })
const props = defineProps<{ plugins: PluginInfo[]; pluginId?: string }>()
const { t, locale } = useI18n()
const { error: showError, success: showSuccess } = useMessage()
const entries = ref<PluginLogEntry[]>([])
const pluginFilter = ref('')
const level = ref('all')
const query = ref('')
const loading = ref(false)
const failed = ref(false)
let revision = 0
let unsubscribe: (() => void) | undefined
const pluginOptions = computed(() => {
  const ids = new Set([
    ...props.plugins.map((plugin) => plugin.id),
    ...entries.value.map((entry) => entry.plugin.pluginId)
  ])
  if (pluginFilter.value) ids.add(pluginFilter.value)
  return [
    { value: '', label: t('plugins.logsAll') },
    ...[...ids].sort().map((id) => {
      const plugin = props.plugins.find((plugin) => plugin.id === id)
      return { value: id, label: plugin ? `${plugin.displayName} (${id})` : id }
    })
  ]
})
const levelOptions = computed(() => [
  { value: 'all', label: t('plugins.logsAllLevels') },
  ...['debug', 'info', 'warn', 'error'].map((value) => ({ value, label: value.toUpperCase() }))
])
const filtered = computed(() => {
  const search = query.value.trim().toLowerCase()
  return entries.value.filter(
    (entry) =>
      (!pluginFilter.value || entry.plugin.pluginId === pluginFilter.value) &&
      (level.value === 'all' || entry.level === level.value) &&
      (!search || `${entry.message} ${JSON.stringify(entry.plugin)}`.toLowerCase().includes(search))
  )
})
function receive(entry: PluginLogEntry): void {
  if (entries.value.some((item) => item.id === entry.id)) return
  entries.value.push(entry)
  entries.value.sort((a, b) => a.id - b.id)
  if (entries.value.length > 1000) entries.value.splice(0, entries.value.length - 1000)
}
function stop(): void {
  ++revision
  unsubscribe?.()
  unsubscribe = undefined
}
async function load(): Promise<void> {
  stop()
  const token = revision
  loading.value = true
  failed.value = false
  try {
    unsubscribe = window.api.log.onEntry((entry) => {
      if (token === revision && open.value && entry.plugin)
        receive({ ...entry, plugin: entry.plugin })
    })
    const result = await window.api.plugins.logs()
    if (token !== revision || !open.value) return
    if (!result.success || !Array.isArray(result.data)) throw new Error('Plugin logs unavailable')
    result.data.forEach(receive)
  } catch {
    if (token === revision && open.value) failed.value = true
  } finally {
    if (token === revision) loading.value = false
  }
}
function line(entry: PluginLogEntry): string {
  const { pluginId, version, sourceId, operation, code, elapsedMs, callId } = entry.plugin
  return `${new Date(entry.timestamp).toISOString()} [${entry.level.toUpperCase()}] ${pluginId}${version ? '@' + version : ''} ${[sourceId, operation, code, callId === undefined ? '' : '#' + callId, elapsedMs === undefined ? '' : elapsedMs + 'ms'].filter(Boolean).join(' ')} ${entry.message}`
}
async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(filtered.value.map(line).join('\n'))
    showSuccess(t('plugins.logsCopied'))
  } catch {
    showError(t('plugins.logsCopyFailed'))
  }
}
async function directory(): Promise<void> {
  try {
    if (!(await window.api.log.openDirectory()).success) throw new Error('Open failed')
  } catch {
    showError(t('plugins.logsDirectoryFailed'))
  }
}
watch(
  [open, () => props.pluginId],
  () => {
    if (open.value) {
      entries.value = []
      pluginFilter.value = props.pluginId ?? ''
      void load()
    } else stop()
  },
  { immediate: true }
)
onBeforeUnmount(stop)
</script>

<template>
  <BaseDialog v-model="open" :title="t('plugins.logs')" width="max-w-5xl">
    <p class="mb-3 text-xs leading-relaxed text-text-l">{{ t('plugins.logsHint') }}</p>
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <BaseSelect
        v-model="pluginFilter"
        class="min-w-0 max-w-full flex-1"
        :options="pluginOptions"
        :aria-label="t('plugins.logsPlugin')"
        size="sm"
        teleport
      />
      <BaseSelect
        v-model="level"
        class="w-32"
        :options="levelOptions"
        :aria-label="t('plugins.logsLevel')"
        size="sm"
        teleport
      />
      <BaseInput
        v-model="query"
        class="min-w-0 flex-1"
        :placeholder="t('plugins.logsSearch')"
        :aria-label="t('plugins.logsSearch')"
        size="sm"
      />
      <BaseButton size="sm" variant="ghost" :loading="loading" @click="load">{{
        t('networkSources.retry')
      }}</BaseButton>
    </div>
    <p v-if="failed" role="alert" class="mb-2 text-sm text-danger">
      {{ t('plugins.logsLoadFailed') }}
    </p>
    <div
      class="custom-scrollbar h-[50vh] overflow-auto rounded-lg border border-border bg-bg-d p-3 font-mono text-xs select-text"
      role="region"
      :aria-label="t('plugins.logs')"
    >
      <p v-if="!filtered.length" role="status" class="py-6 text-center text-text-l">
        {{ t(loading ? 'plugins.loading' : 'plugins.logsEmpty') }}
      </p>
      <div
        v-for="entry in filtered"
        :key="entry.id"
        class="mb-3 break-all whitespace-pre-wrap border-b border-border/40 pb-2"
      >
        <div class="mb-1 text-text-l">
          {{ new Date(entry.timestamp).toLocaleTimeString(locale) }} ·
          <span
            :class="
              entry.level === 'error' ? 'text-danger' : entry.level === 'warn' ? 'text-warning' : ''
            "
            >{{ entry.level.toUpperCase() }}</span
          >
          · {{ entry.plugin.pluginId
          }}<template v-if="entry.plugin.version">@{{ entry.plugin.version }}</template>
          <template v-if="entry.plugin.operation"> · {{ entry.plugin.operation }}</template>
          <template v-if="entry.plugin.sourceId"> · {{ entry.plugin.sourceId }}</template>
          <template v-if="entry.plugin.callId !== undefined">
            · #{{ entry.plugin.callId }}</template
          >
          <template v-if="entry.plugin.elapsedMs !== undefined">
            · {{ entry.plugin.elapsedMs }}ms</template
          >
          <template v-if="entry.plugin.code"> · {{ entry.plugin.code }}</template>
        </div>
        <div class="text-text">{{ entry.message }}</div>
      </div>
    </div>
    <template #footer>
      <BaseButton size="sm" variant="ghost" @click="directory">{{
        t('plugins.logsDirectory')
      }}</BaseButton>
      <BaseButton size="sm" variant="ghost" :disabled="!filtered.length" @click="copy">{{
        t('plugins.logsCopy')
      }}</BaseButton>
    </template>
  </BaseDialog>
</template>
