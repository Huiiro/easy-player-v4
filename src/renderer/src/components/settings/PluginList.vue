<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PluginInfo, OfficialPluginEntry } from '../../../../shared/plugins'
import { comparePluginVersions } from '../../../../shared/plugins'
import SettingRow from './SettingRow.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import BaseButton from '@/components/ui/BaseButton.vue'

type Plugin = PluginInfo | OfficialPluginEntry
const props = defineProps<{
  mode: 'installed' | 'official'
  items: readonly Plugin[]
  installed: readonly PluginInfo[]
  pluginLabel: (plugin: Plugin) => string
  loading: boolean
  busy: string
}>()
const page = defineModel<number>('page', { default: 1 })
const emit = defineEmits<{
  install: [id: string]
  uninstall: [plugin: PluginInfo]
  toggle: [id: string, enabled: boolean]
  logs: [id: string]
}>()
const { t } = useI18n()
const pageSize = 10
const pageCount = computed(() => Math.max(1, Math.ceil(props.items.length / pageSize)))
watch(
  [pageCount, page],
  () => {
    const next = Math.min(
      pageCount.value,
      Math.max(1, Number.isInteger(page.value) ? page.value : 1)
    )
    if (page.value !== next) page.value = next
  },
  { immediate: true }
)
const visiblePlugins = computed(() =>
  props.items.slice((page.value - 1) * pageSize, page.value * pageSize)
)
const installedVersions = computed(
  () => new Map(props.installed.map((plugin) => [plugin.id, plugin.version]))
)
function isInstalled(plugin: Plugin): plugin is PluginInfo {
  return 'state' in plugin
}
function isCurrent(plugin: Plugin): boolean {
  const version = installedVersions.value.get(plugin.id)
  return !!version && comparePluginVersions(version, plugin.version) >= 0
}
function capabilities(plugin: Plugin): string {
  return [...new Set(plugin.sources.flatMap((source) => source.capabilities))]
    .map((capability) => t('networkSources.capabilities.' + capability))
    .join(' / ')
}
function toggle(plugin: PluginInfo, enabled: boolean | string | number): void {
  if (typeof enabled === 'boolean') emit('toggle', plugin.id, enabled)
}
</script>

<template>
  <div class="plugin-list">
    <SettingRow
      v-for="plugin in visiblePlugins"
      :key="plugin.id"
      class="plugin-row"
      :label="pluginLabel(plugin)"
    >
      <template #description>
        <span class="plugin-meta">
          <span class="plugin-kind">{{
            t(plugin.kind === 'theme' ? 'plugins.theme' : 'plugins.provider')
          }}</span>
          <span class="tabular-nums">v{{ plugin.version }}</span>
          <span v-if="'size' in plugin">{{ Math.ceil(plugin.size / 1024) }} KB</span>
          <span>{{
            t(
              mode === 'installed' && isInstalled(plugin) && plugin.origin === 'third-party'
                ? 'plugins.thirdParty'
                : 'plugins.builtin'
            )
          }}</span>
          <span
            >{{ t('plugins.author') }}{{ plugin.author?.name || t('plugins.authorUnknown') }}</span
          >
        </span>
        <span class="plugin-meta">
          <span class="plugin-id" :title="plugin.id">{{ plugin.id }}</span>
          <span v-if="plugin.sources.length">{{ capabilities(plugin) }}</span>
        </span>
        <span
          v-if="mode === 'installed' && isInstalled(plugin) && plugin.error"
          role="alert"
          class="mt-1 block text-danger"
          >{{ t('plugins.errors.' + plugin.error) }}</span
        >
      </template>
      <template #default="{ labelId, descriptionId }">
        <div
          v-if="mode === 'installed' && isInstalled(plugin)"
          class="plugin-actions flex shrink-0 items-center gap-2"
        >
          <BaseButton
            class="reset-button"
            size="sm"
            variant="ghost"
            :disabled="loading || Boolean(busy)"
            @click="emit('uninstall', plugin)"
            >{{ t('plugins.uninstall') }}</BaseButton
          >
          <BaseButton
            class="reset-button"
            size="sm"
            variant="ghost"
            @click="emit('logs', plugin.id)"
            >{{ t('plugins.logs') }}</BaseButton
          >
          <BaseButton
            v-if="plugin.state === 'failed'"
            class="reset-button"
            variant="ghost"
            size="sm"
            :disabled="loading || Boolean(busy)"
            @click="emit('toggle', plugin.id, true)"
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
            @change="toggle(plugin, $event)"
          />
        </div>
        <BaseButton
          v-else
          class="reset-button plugin-actions"
          size="sm"
          variant="ghost"
          :loading="busy === plugin.id"
          :disabled="loading || Boolean(busy) || isCurrent(plugin)"
          @click="emit('install', plugin.id)"
        >
          {{
            isCurrent(plugin)
              ? t('plugins.installed')
              : installedVersions.has(plugin.id)
                ? t('plugins.update')
                : t('plugins.install')
          }}
        </BaseButton>
      </template>
    </SettingRow>
    <nav
      v-if="items.length > 10"
      class="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3"
      :aria-label="t('plugins.pagination')"
    >
      <span class="text-xs text-text-l" aria-live="polite">{{
        t('plugins.pageSummary', { total: items.length, page, pages: pageCount })
      }}</span>
      <div class="flex items-center gap-2">
        <BaseButton
          size="sm"
          variant="ghost"
          :disabled="loading || Boolean(busy) || page === 1"
          @click="page--"
          >{{ t('plugins.previousPage') }}</BaseButton
        >
        <BaseButton
          size="sm"
          variant="ghost"
          :disabled="loading || Boolean(busy) || page === pageCount"
          @click="page++"
          >{{ t('plugins.nextPage') }}</BaseButton
        >
      </div>
    </nav>
  </div>
</template>

<style scoped>
.plugin-list {
  container-type: inline-size;
}
.plugin-list .plugin-row {
  min-height: 0;
  gap: 1rem;
  padding: 0.7rem 1.25rem;
}
.plugin-row :deep(h3) {
  overflow-wrap: anywhere;
}
.plugin-list .plugin-row :deep(p) {
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
  .plugin-list .plugin-row {
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
