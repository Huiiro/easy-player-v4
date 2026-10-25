<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PluginInfo, OfficialPluginEntry } from '../../../../shared/plugins'
import { comparePluginVersions } from '../../../../shared/plugins'
import SettingRow from './SettingRow.vue'
import PluginLogDialog from './PluginLogDialog.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseConfirmDialog from '@/components/ui/BaseConfirmDialog.vue'
import { useMessage } from '@/components/ui/useMessage'
import { networkSourceName } from '@/hooks/useNetworkSources'

const { t, locale } = useI18n()
const { error: showError, success: showSuccess } = useMessage()
const plugins = ref<PluginInfo[]>([])
const catalog = ref<OfficialPluginEntry[]>([])
const tab = ref<'installed' | 'official'>('installed')
const kindFilter = ref('all')
const logsOpen = ref(false)
const logsPlugin = ref<string>()
function viewLogs(id?: string): void {
  logsPlugin.value = id
  logsOpen.value = true
}
const uninstallVisible = ref(false)
const uninstallTarget = ref<PluginInfo | null>(null)
function requestUninstall(plugin: PluginInfo): void {
  if (busy.value || loading.value) return
  uninstallTarget.value = plugin
  uninstallVisible.value = true
}
async function confirmUninstall(): Promise<void> {
  if (!uninstallTarget.value || !(await manage('uninstall', uninstallTarget.value.id)))
    throw new Error(t('plugins.uninstallFailed'))
}
const kindOptions = computed(() => [
  { value: 'all', label: t('plugins.allTypes') },
  { value: 'provider', label: t('plugins.provider') },
  { value: 'theme', label: t('plugins.theme') }
])
function matchesKind(plugin: PluginInfo | OfficialPluginEntry): boolean {
  return (
    kindFilter.value === 'all' ||
    (plugin.kind === 'theme' ? 'theme' : 'provider') === kindFilter.value
  )
}
const filteredPlugins = computed(() => plugins.value.filter(matchesKind))
const filteredCatalog = computed(() => catalog.value.filter(matchesKind))
function capabilities(plugin: PluginInfo | OfficialPluginEntry): string {
  return [...new Set(plugin.sources.flatMap((source) => source.capabilities))]
    .map((capability) => t('networkSources.capabilities.' + capability))
    .join(' / ')
}
const catalogLoading = ref(false)
const loading = ref(true),
  busy = ref(''),
  loadError = ref(''),
  saveError = ref('')
const error = computed(() => saveError.value || loadError.value)
let revision = 0,
  disposed = false
let unsubscribe: (() => void) | undefined
function name(plugin: PluginInfo | OfficialPluginEntry): string {
  if (plugin.theme)
    return (
      plugin.theme.names?.[locale.value.startsWith('zh') ? 'zh' : 'en'] || plugin.theme.displayName
    )
  return plugin.sources.length === 1 ? networkSourceName(plugin.sources[0], t) : plugin.displayName
}
async function browse(refresh = false): Promise<void> {
  tab.value = 'official'
  catalogLoading.value = true
  saveError.value = ''
  try {
    const result = await window.api.plugins.catalog(refresh)
    if (disposed) return
    if (!result.success || !result.data) throw new Error(result.error || t('plugins.catalogFailed'))
    catalog.value = result.data
    if (refresh) showSuccess(t('plugins.refreshSuccess'))
  } catch (reason) {
    if (!disposed) {
      saveError.value = reason instanceof Error ? reason.message : t('plugins.catalogFailed')
      showError(saveError.value)
    }
  } finally {
    if (!disposed) catalogLoading.value = false
  }
}
async function manage(action: 'install' | 'uninstall' | 'import', id = ''): Promise<boolean> {
  if (busy.value) return false
  const plugin =
    plugins.value.find((plugin) => plugin.id === id) ??
    catalog.value.find((plugin) => plugin.id === id)
  const pluginName = plugin ? name(plugin) : id
  const updating = action === 'install' && !!installedVersion(id)
  const fallback = action === 'uninstall' ? 'plugins.uninstallFailed' : 'plugins.installFailed'
  busy.value = id || 'import'
  saveError.value = ''
  try {
    const result =
      action === 'import'
        ? await window.api.plugins.importPackage()
        : await window.api.plugins[action](id)
    if (disposed) return false
    if (!result.success) throw new Error(result.error || t(fallback))
    if ('cancelled' in result && result.cancelled) return false
    const message =
      action === 'import'
        ? 'plugins.importSuccess'
        : action === 'uninstall'
          ? 'plugins.uninstallSuccess'
          : updating
            ? 'plugins.updateSuccess'
            : 'plugins.installSuccess'
    showSuccess(t(message, { name: pluginName }))
    return true
  } catch (reason) {
    if (!disposed) {
      saveError.value = reason instanceof Error ? reason.message : t(fallback)
      showError(saveError.value)
    }
    return false
  } finally {
    if (!disposed) {
      await reload()
      busy.value = ''
    }
  }
}
function installedVersion(id: string): string | undefined {
  return plugins.value.find((plugin) => plugin.id === id)?.version
}
function isCurrent(plugin: OfficialPluginEntry): boolean {
  const current = installedVersion(plugin.id)
  return !!current && comparePluginVersions(current, plugin.version) >= 0
}
async function reload(): Promise<void> {
  const token = ++revision
  loading.value = true
  loadError.value = ''
  try {
    const result = await window.api.plugins.list()
    if (disposed || token !== revision) return
    if (!result.success || !result.data) throw new Error(result.error || t('plugins.loadFailed'))
    plugins.value = result.data
  } catch (reason) {
    if (!disposed && token === revision) {
      loadError.value = reason instanceof Error ? reason.message : t('plugins.loadFailed')
      showError(loadError.value)
    }
  } finally {
    if (!disposed && token === revision) loading.value = false
  }
}
async function change(id: string, enabled: boolean | string | number): Promise<void> {
  if (busy.value || typeof enabled !== 'boolean') return
  busy.value = id
  saveError.value = ''
  try {
    const result = await window.api.plugins.setEnabled(id, enabled)
    if (!result.success) throw new Error(result.error || t('plugins.saveFailed'))
    if (!disposed) {
      const plugin = plugins.value.find((plugin) => plugin.id === id)
      showSuccess(
        t(enabled ? 'plugins.enableSuccess' : 'plugins.disableSuccess', {
          name: plugin ? name(plugin) : id
        })
      )
    }
  } catch (reason) {
    if (!disposed) {
      saveError.value = reason instanceof Error ? reason.message : t('plugins.saveFailed')
      showError(saveError.value)
    }
  } finally {
    if (!disposed) {
      await reload()
      busy.value = ''
    }
  }
}
onMounted(() => {
  try {
    unsubscribe = window.api.plugins.onChanged(() => void reload())
    void reload()
  } catch {
    loading.value = false
    loadError.value = t('plugins.loadFailed')
  }
})
onBeforeUnmount(() => {
  disposed = true
  ++revision
  unsubscribe?.()
})
</script>

<template>
  <div class="plugin-settings">
    <div class="flex flex-wrap items-center gap-2 px-5 py-3">
      <BaseButton
        class="reset-button"
        size="sm"
        variant="ghost"
        :aria-pressed="tab === 'installed'"
        @click="tab = 'installed'"
        >{{ t('plugins.installed') }}</BaseButton
      >
      <BaseButton
        class="reset-button"
        size="sm"
        variant="ghost"
        :aria-pressed="tab === 'official'"
        :disabled="catalogLoading"
        @click="browse()"
        >{{ t('plugins.officialSource') }}</BaseButton
      >
      <BaseButton class="reset-button" size="sm" variant="ghost" @click="viewLogs()">{{
        t('plugins.logs')
      }}</BaseButton>
      <BaseSelect
        v-model="kindFilter"
        class="ml-auto w-40"
        size="sm"
        :options="kindOptions"
        :aria-label="t('plugins.typeFilter')"
        teleport
      />
      <BaseButton
        class="reset-button"
        size="sm"
        variant="ghost"
        :disabled="Boolean(busy)"
        @click="manage('import')"
        >{{ t('plugins.import') }}</BaseButton
      >
      <BaseButton
        v-if="tab === 'official'"
        class="reset-button"
        size="sm"
        variant="ghost"
        :loading="catalogLoading"
        :disabled="Boolean(busy)"
        @click="browse(true)"
        >{{ t('plugins.refresh') }}</BaseButton
      >
    </div>
    <p class="px-5 pb-2 text-xs leading-relaxed text-text-l">
      {{ t(tab === 'official' ? 'plugins.catalogHint' : 'plugins.hint') }}
    </p>
    <div
      v-if="error"
      role="alert"
      class="mx-5 my-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger"
    >
      <span>{{ error }}</span>
      <BaseButton
        v-if="loadError"
        class="reset-button"
        variant="ghost"
        size="sm"
        :loading="loading"
        @click="reload"
        >{{ t('networkSources.retry') }}</BaseButton
      >
    </div>
    <p
      v-if="loading && !plugins.length"
      role="status"
      class="flex items-center gap-2 px-5 py-4 text-sm text-text-l"
    >
      <span class="ep-spinner" />{{ t('plugins.loading') }}
    </p>
    <div
      v-if="tab === 'installed' && !loading && !plugins.length && !loadError"
      class="px-5 py-6 text-sm text-text-l"
    >
      <p>{{ t('plugins.empty') }}</p>
      <BaseButton class="reset-button mt-3" size="sm" variant="ghost" @click="browse()">{{
        t('plugins.browse')
      }}</BaseButton>
    </div>
    <p
      v-if="tab === 'installed' && !loading && plugins.length && !filteredPlugins.length"
      role="status"
      class="px-5 py-4 text-sm text-text-l"
    >
      {{ t('plugins.noTypeMatches') }}
    </p>
    <template v-if="tab === 'installed'">
      <SettingRow
        v-for="plugin in filteredPlugins"
        :key="plugin.id"
        class="plugin-row"
        :label="name(plugin)"
      >
        <template #description>
          <span class="plugin-meta">
            <span class="plugin-kind">{{
              t(plugin.kind === 'theme' ? 'plugins.theme' : 'plugins.provider')
            }}</span>
            <span class="tabular-nums">v{{ plugin.version }}</span>
            <span>{{
              t(plugin.origin === 'third-party' ? 'plugins.thirdParty' : 'plugins.builtin')
            }}</span>
            <span
              >{{ t('plugins.author')
              }}{{ plugin.author?.name || t('plugins.authorUnknown') }}</span
            >
          </span>
          <span class="plugin-meta">
            <span class="plugin-id" :title="plugin.id">{{ plugin.id }}</span>
            <span v-if="plugin.sources.length">{{ capabilities(plugin) }}</span>
          </span>
          <span v-if="plugin.error" role="alert" class="mt-1 block text-danger">{{
            t('plugins.errors.' + plugin.error)
          }}</span>
        </template>
        <template #default="{ labelId, descriptionId }">
          <div class="plugin-actions flex shrink-0 items-center gap-2">
            <BaseButton
              class="reset-button"
              size="sm"
              variant="ghost"
              :disabled="loading || Boolean(busy)"
              @click="requestUninstall(plugin)"
              >{{ t('plugins.uninstall') }}</BaseButton
            >
            <BaseButton
              class="reset-button"
              size="sm"
              variant="ghost"
              @click="viewLogs(plugin.id)"
              >{{ t('plugins.logs') }}</BaseButton
            >
            <BaseButton
              v-if="plugin.state === 'failed'"
              class="reset-button"
              variant="ghost"
              size="sm"
              :disabled="loading || Boolean(busy)"
              @click="change(plugin.id, true)"
              >{{ t('plugins.retry') }}</BaseButton
            >
            <span
              v-if="busy === plugin.id"
              class="ep-spinner inline-block"
              role="status"
              :aria-label="t('networkSources.saving')"
            />
            <BaseSwitch
              :model-value="plugin.enabled"
              :aria-labelledby="labelId"
              :aria-describedby="descriptionId"
              :disabled="loading || Boolean(busy)"
              @change="change(plugin.id, $event)"
            />
          </div>
        </template>
      </SettingRow>
    </template>
    <template v-else>
      <p
        v-if="catalogLoading && !catalog.length"
        role="status"
        class="flex items-center gap-2 px-5 py-4 text-sm text-text-l"
      >
        <span class="ep-spinner" />{{ t('plugins.loading') }}
      </p>
      <p
        v-else-if="!catalogLoading && !error && !filteredCatalog.length"
        role="status"
        class="px-5 py-4 text-sm text-text-l"
      >
        {{ t('plugins.noTypeMatches') }}
      </p>
      <SettingRow
        v-for="plugin in filteredCatalog"
        :key="plugin.id"
        class="plugin-row"
        :label="name(plugin)"
      >
        <template #description>
          <span class="plugin-meta">
            <span class="plugin-kind">{{
              t(plugin.kind === 'theme' ? 'plugins.theme' : 'plugins.provider')
            }}</span>
            <span class="tabular-nums">v{{ plugin.version }}</span>
            <span>{{ Math.ceil(plugin.size / 1024) }} KB</span>
            <span
              >{{ t('plugins.author')
              }}{{ plugin.author?.name || t('plugins.authorUnknown') }}</span
            >
          </span>
          <span class="plugin-meta">
            <span class="plugin-id" :title="plugin.id">{{ plugin.id }}</span>
            <span v-if="plugin.sources.length">{{ capabilities(plugin) }}</span>
          </span>
        </template>
        <BaseButton
          class="reset-button plugin-actions"
          size="sm"
          variant="ghost"
          :loading="busy === plugin.id"
          :disabled="loading || Boolean(busy) || catalogLoading || isCurrent(plugin)"
          @click="manage('install', plugin.id)"
          >{{
            isCurrent(plugin)
              ? t('plugins.installed')
              : installedVersion(plugin.id)
                ? t('plugins.update')
                : t('plugins.install')
          }}</BaseButton
        >
      </SettingRow>
    </template>
    <PluginLogDialog v-model="logsOpen" :plugins="plugins" :plugin-id="logsPlugin" />
    <BaseConfirmDialog
      v-model="uninstallVisible"
      :title="t('plugins.uninstallTitle')"
      :message="
        t('plugins.uninstallConfirm', {
          name: uninstallTarget ? name(uninstallTarget) : '',
          id: uninstallTarget?.id ?? ''
        })
      "
      :confirm-text="t('plugins.uninstall')"
      :confirm-action="confirmUninstall"
      :loading="Boolean(busy)"
      variant="danger"
    />
  </div>
</template>

<style scoped>
.plugin-settings {
  container-type: inline-size;
}
.plugin-settings .plugin-row {
  min-height: 0;
  gap: 1rem;
  padding: 0.7rem 1.25rem;
}
.plugin-row :deep(h3) {
  overflow-wrap: anywhere;
}
.plugin-settings .plugin-row :deep(p) {
  font-size: 0.75rem;
  line-height: 1.5;
}
.plugin-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.15rem 0.6rem;
}
.plugin-kind {
  color: var(--color-text);
}
.plugin-id {
  overflow-wrap: anywhere;
}
@container (max-width: 400px) {
  .plugin-settings .plugin-row {
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .plugin-row > :deep(.min-w-0) {
    width: 100%;
  }
  .plugin-actions {
    margin-left: auto;
    flex-wrap: wrap;
  }
}
</style>
