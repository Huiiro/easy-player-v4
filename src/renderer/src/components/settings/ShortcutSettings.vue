<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import ShortcutInput from './ShortcutInput.vue'
import { useUIStore } from '@/stores/ui/uiStore'
import { DEFAULT_LOCAL_SHORTCUTS, DEFAULT_GLOBAL_SHORTCUTS } from '../../../../shared/shortcuts'
const ui = useUIStore()
const { t } = useI18n()
const actions = [
  { key: 'toggle', label: 'settings.shortcutToggle' },
  { key: 'previous', label: 'settings.shortcutPrevious' },
  { key: 'next', label: 'settings.shortcutNext' },
  { key: 'volumeUp', label: 'settings.shortcutVolumeUp' },
  { key: 'volumeDown', label: 'settings.shortcutVolumeDown' },
  { key: 'seekBackward', label: 'settings.shortcutSeekBackward' },
  { key: 'seekForward', label: 'settings.shortcutSeekForward' },
  { key: 'like', label: 'settings.shortcutLike' },
  { key: 'dislike', label: 'settings.shortcutDislike' },
  { key: 'toggleDesktopLyrics', label: 'settings.shortcutDesktopLyrics' },
  { key: 'enableLightweight', label: 'settings.shortcutLightweight' }
] as const
function reset(): void {
  Object.assign(ui.shortcutKeys, DEFAULT_LOCAL_SHORTCUTS)
  Object.assign(ui.globalShortcutKeys, DEFAULT_GLOBAL_SHORTCUTS)
  ui.useGlobalShortcutKeys = false
}
</script>
<template>
  <div class="settings-card shortcut-card">
    <div class="setting-row">
      <div>
        <h3>{{ t('settings.globalShortcuts') }}</h3>
        <p>{{ t('settings.globalShortcutsDescription') }}</p>
      </div>
      <div class="flex items-center gap-3">
        <button class="btn-hover-base text-sm" type="button" @click="reset">
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
}
.action {
  color: var(--color-text);
  font-size: 0.9rem;
  font-weight: 550;
}
.hint {
  margin-top: 0.25rem;
  color: var(--color-text-l);
  font-size: 0.8125rem;
  line-height: 1.45;
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
