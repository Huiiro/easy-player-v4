<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PluginInfo, OfficialPluginEntry } from '../../../../shared/plugins'
import PluginList from './PluginList.vue'
import PluginLogDialog from './PluginLogDialog.vue'
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
const installedPage = ref(1)
const officialPage = ref(1)
watch(kindFilter, () => {
  installedPage.value = 1
  officialPage.value = 1
})
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
    <template v-if="tab === 'official'">
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
    </template>
    <PluginList
      v-if="tab === 'installed'"
      v-model:page="installedPage"
      mode="installed"
      :items="filteredPlugins"
      :installed="plugins"
      :plugin-label="name"
      :loading="loading"
      :busy="busy"
      @uninstall="requestUninstall"
      @toggle="change"
      @logs="viewLogs"
    />
    <PluginList
      v-else
      v-model:page="officialPage"
      mode="official"
      :items="filteredCatalog"
      :installed="plugins"
      :plugin-label="name"
      :loading="loading || catalogLoading"
      :busy="busy"
      @install="manage('install', $event)"
    />
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
