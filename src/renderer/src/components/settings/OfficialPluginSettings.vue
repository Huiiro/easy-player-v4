<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PluginInfo, OfficialPluginEntry } from '../../../../shared/plugins'
import { comparePluginVersions } from '../../../../shared/plugins'
import SettingRow from './SettingRow.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useMessage } from '@/components/ui/useMessage'
import { networkSourceName } from '@/hooks/useNetworkSources'

const { t } = useI18n()
const { error: showError } = useMessage()
const plugins = ref<PluginInfo[]>([])
const catalog = ref<OfficialPluginEntry[]>([])
const tab = ref<'installed' | 'official'>('installed')
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
  } catch (reason) {
    if (!disposed) {
      saveError.value = reason instanceof Error ? reason.message : t('plugins.catalogFailed')
      showError(saveError.value)
    }
  } finally {
    if (!disposed) catalogLoading.value = false
  }
}
async function manage(action: 'install' | 'uninstall' | 'import', id = ''): Promise<void> {
  if (busy.value) return
  busy.value = id || 'import'
  saveError.value = ''
  try {
    const result =
      action === 'import'
        ? await window.api.plugins.importPackage()
        : await window.api.plugins[action](id)
    if (!result.success) throw new Error(result.error || t('plugins.installFailed'))
  } catch (reason) {
    if (!disposed) {
      saveError.value = reason instanceof Error ? reason.message : t('plugins.installFailed')
      showError(saveError.value)
    }
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
  <div>
    <p class="px-5 pt-4 text-xs leading-relaxed text-text-l">{{ t('plugins.hint') }}</p>
    <div class="flex flex-wrap items-center gap-2 px-5 pt-4">
      <BaseButton
        size="sm"
        :variant="tab === 'installed' ? 'secondary' : 'ghost'"
        :aria-pressed="tab === 'installed'"
        @click="tab = 'installed'"
        >{{ t('plugins.installed') }}</BaseButton
      >
      <BaseButton
        size="sm"
        :variant="tab === 'official' ? 'secondary' : 'ghost'"
        :aria-pressed="tab === 'official'"
        :disabled="catalogLoading"
        @click="browse()"
        >{{ t('plugins.officialSource') }}</BaseButton
      >
      <BaseButton size="sm" variant="ghost" :disabled="Boolean(busy)" @click="manage('import')">{{
        t('plugins.import')
      }}</BaseButton>
      <BaseButton
        v-if="tab === 'official'"
        size="sm"
        variant="ghost"
        :loading="catalogLoading"
        :disabled="Boolean(busy)"
        @click="browse(true)"
        >{{ t('plugins.refresh') }}</BaseButton
      >
    </div>
    <div
      v-if="error"
      role="alert"
      class="mx-5 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger"
    >
      <span>{{ error }}</span>
      <BaseButton
        v-if="loadError"
        variant="secondary"
        size="sm"
        :loading="loading"
        @click="reload"
        >{{ t('networkSources.retry') }}</BaseButton
      >
    </div>
    <p
      v-if="loading && !plugins.length"
      role="status"
      class="flex items-center gap-2 px-5 py-6 text-sm text-text-l"
    >
      <span class="ep-spinner" />{{ t('plugins.loading') }}
    </p>
    <div
      v-if="tab === 'installed' && !loading && !plugins.length && !loadError"
      class="px-5 py-6 text-sm text-text-l"
    >
      <p>{{ t('plugins.empty') }}</p>
      <BaseButton class="mt-3" size="sm" variant="secondary" @click="browse()">{{
        t('plugins.browse')
      }}</BaseButton>
    </div>
    <template v-if="tab === 'installed'">
      <SettingRow v-for="plugin in plugins" :key="plugin.id" :label="name(plugin)">
        <template #description>
          <span class="flex flex-wrap items-center gap-x-2 gap-y-1"
            ><span>{{ t('plugins.builtin') }}</span
            ><span class="tabular-nums">v{{ plugin.version }}</span></span
          >
          <span class="mt-2 flex flex-wrap gap-1.5">
            <span
              v-for="capability in [
                ...new Set(plugin.sources.flatMap((source) => source.capabilities))
              ]"
              :key="capability"
              class="rounded-md border border-border bg-bg px-2 py-0.5 text-xs text-text-l"
              >{{ t('networkSources.capabilities.' + capability) }}</span
            >
          </span>
          <span v-if="plugin.error" role="alert" class="mt-2 block text-danger">{{
            t('plugins.errors.' + plugin.error)
          }}</span>
        </template>
        <template #default="{ labelId, descriptionId }">
          <div class="flex shrink-0 items-center gap-3">
            <BaseButton
              size="sm"
              variant="ghost"
              :disabled="loading || Boolean(busy)"
              @click="manage('uninstall', plugin.id)"
              >{{ t('plugins.uninstall') }}</BaseButton
            >
            <BaseButton
              v-if="plugin.state === 'failed'"
              variant="secondary"
              size="sm"
              :disabled="loading || Boolean(busy)"
              @click="change(plugin.id, true)"
              >{{ t('plugins.retry') }}</BaseButton
            >
            <span class="text-xs text-text-l" aria-live="polite"
              ><span
                v-if="busy === plugin.id"
                class="ep-spinner inline-block"
                :aria-label="t('networkSources.saving')"
              /><template v-else>{{ t('plugins.states.' + plugin.state) }}</template></span
            >
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
      <p class="px-5 py-3 text-xs text-text-l">{{ t('plugins.catalogHint') }}</p>
      <SettingRow v-for="plugin in catalog" :key="plugin.id" :label="name(plugin)">
        <template #description>
          <span
            >{{ t('plugins.builtin') }} · v{{ plugin.version }} ·
            {{ Math.ceil(plugin.size / 1024) }} KB</span
          >
          <span class="mt-2 flex flex-wrap gap-1.5">
            <span
              v-for="capability in [
                ...new Set(plugin.sources.flatMap((source) => source.capabilities))
              ]"
              :key="capability"
              class="rounded-md border border-border bg-bg px-2 py-0.5 text-xs text-text-l"
              >{{ t('networkSources.capabilities.' + capability) }}</span
            >
          </span>
        </template>
        <BaseButton
          size="sm"
          variant="secondary"
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
  </div>
</template>
