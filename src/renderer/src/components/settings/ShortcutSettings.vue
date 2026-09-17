<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import ShortcutInput from './ShortcutInput.vue'
import { useUIStore } from '@/stores/ui/uiStore'
const ui = useUIStore()
const { t } = useI18n()
const actions = [
  { key: 'previous', label: 'settings.shortcutPrevious' },
  { key: 'toggle', label: 'settings.shortcutToggle' },
  { key: 'next', label: 'settings.shortcutNext' },
  { key: 'volumeUp', label: 'settings.shortcutVolumeUp' },
  { key: 'volumeDown', label: 'settings.shortcutVolumeDown' }
] as const
function reset(): void {
  Object.assign(ui.shortcutKeys, {
    previous: 'ctrl+left',
    toggle: 'space',
    next: 'ctrl+right',
    volumeUp: 'ctrl+up',
    volumeDown: 'ctrl+down'
  })
  Object.assign(ui.globalShortcutKeys, {
    previous: '',
    toggle: '',
    next: '',
    volumeUp: '',
    volumeDown: ''
  })
  ui.useGlobalShortcutKeys = false
}
</script>
<template>
  <div class="settings-card shortcut-card">
    <div class="toolbar">
      <div>
        <h3>{{ t('settings.globalShortcuts') }}</h3>
        <p>{{ t('settings.globalShortcutsDescription') }}</p>
      </div>
      <div class="flex items-center gap-3">
        <button class="secondary-button" @click="reset">
          {{ t('settings.resetShortcutDefaults') }}
        </button>
        <BaseSwitch v-model="ui.useGlobalShortcutKeys" size="md" />
      </div>
    </div>
    <div class="shortcut-grid">
      <span>-</span>
      <span>{{ t('settings.localShortcuts') }}</span>
      <span>{{ t('settings.globalShortcuts') }}</span>
      <template v-for="item in actions" :key="item.key">
        <span class="action">{{ t(item.label) }}</span>
        <ShortcutInput :action="item.key" scope="local" />
        <ShortcutInput :action="item.key" scope="global" :disabled="!ui.useGlobalShortcutKeys" />
      </template>
    </div>
    <!--    <p class="hint">{{ t('settings.shortcutSpecialKeys') }}</p>-->
  </div>
</template>

<style scoped>
.settings-card {
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: color-mix(in srgb, var(--color-bg-l) 35%, transparent);
}
.toolbar {
  display: flex;
  min-height: 76px;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
  padding: 1.1rem 1.25rem;
}
.toolbar h3,
.action {
  color: var(--color-text);
  font-size: 0.9rem;
  font-weight: 550;
}
.toolbar p,
.hint {
  margin-top: 0.25rem;
  color: var(--color-text-l);
  font-size: 0.8125rem;
  line-height: 1.45;
}
.secondary-button {
  border: 1px solid var(--color-border);
  border-radius: 7px;
  padding: 0.45rem 0.7rem;
  color: var(--color-text);
  font-size: 0.78rem;
}
.shortcut-grid {
  display: grid;
  grid-template-columns: minmax(8rem, 1fr) minmax(9rem, 0.8fr) minmax(9rem, 0.8fr);
  align-items: center;
}
.shortcut-grid > span {
  padding: 0.65rem 1.25rem;
  color: var(--color-text-l);
  font-size: 0.75rem;
  text-align: center;
}
.shortcut-grid > .action {
  text-align: left;
  color: var(--color-text);
  font-size: 0.9rem;
}
.shortcut-grid > :nth-child(n + 4) {
  min-height: 54px;
  padding: 0.65rem 1.25rem;
}
.hint {
  margin: 0;
  padding: 0.85rem 1.25rem;
}
</style>
