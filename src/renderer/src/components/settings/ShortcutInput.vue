<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUIStore } from '@/stores/ui/uiStore'
import { useMessage } from '@/components/ui/useMessage'
import { formatShortcut, normalizeShortcut } from '@/utils/shortcut'

type ShortcutAction = 'previous' | 'toggle' | 'next' | 'volumeUp' | 'volumeDown'

const props = defineProps<{
  action: ShortcutAction
  scope: 'local' | 'global'
  disabled?: boolean
}>()
const ui = useUIStore()
const { t } = useI18n()
const { warning } = useMessage()
const input = ref<HTMLInputElement | null>(null)
const shortcuts = computed(() =>
  props.scope === 'global' ? ui.globalShortcutKeys : ui.shortcutKeys
)

function keydown(event: KeyboardEvent): void {
  event.preventDefault()
  event.stopPropagation()
  const shortcut = normalizeShortcut(event)
  if (!shortcut) return
  const duplicate = [
    ...Object.entries(ui.shortcutKeys).map(([action, value]) => ({
      scope: 'local',
      action,
      value
    })),
    ...Object.entries(ui.globalShortcutKeys).map(([action, value]) => ({
      scope: 'global',
      action,
      value
    }))
  ].some(
    (entry) =>
      (entry.scope !== props.scope || entry.action !== props.action) &&
      typeof entry.value === 'string' &&
      entry.value.toLowerCase() === shortcut.toLowerCase()
  )
  if (duplicate) {
    warning(t('settings.shortcutDuplicate', { shortcut: formatShortcut(shortcut) }))
    return
  }
  shortcuts.value[props.action] = shortcut
  input.value?.blur()
}
</script>

<template>
  <div class="relative">
    <input
      ref="input"
      readonly
      :disabled="disabled"
      :value="formatShortcut(shortcuts[action])"
      class="input-base h-8 w-full pr-7 text-center disabled:cursor-not-allowed"
      :placeholder="t('settings.pressShortcut')"
      @keydown="keydown"
    />
    <button
      v-if="shortcuts[action]"
      class="btn-hover absolute right-1 top-1/2 grid size-5 -translate-y-1/2 place-items-center text-xs"
      :disabled="disabled"
      :title="t('settings.clearShortcut')"
      @click="shortcuts[action] = ''"
    >
      ×
    </button>
  </div>
</template>
