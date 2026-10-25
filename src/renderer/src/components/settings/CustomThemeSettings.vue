<script setup lang="ts">
import SettingRow from './SettingRow.vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseConfirmDialog from '@/components/ui/BaseConfirmDialog.vue'
import { useUIStore } from '@/stores/ui/uiStore'

const ui = useUIStore()
const { t } = useI18n()
const deleteVisible = ref(false)
const themeToDelete = ref('')
const selected = computed(() => ui.effectiveCustomTheme)
const themeOptions = computed(() => [
  { label: t('customTheme.default'), value: '' },
  ...ui.customThemes.map((theme) => ({ label: theme.name, value: theme.name })),
  ...(selected.value && !ui.customThemes.some((theme) => theme.name === selected.value?.name)
    ? [{ label: selected.value.name, value: selected.value.name }]
    : [])
])

function requestDelete(): void {
  if (!selected.value) return
  themeToDelete.value = selected.value.name
  deleteVisible.value = true
}

function confirmDelete(): void {
  if (themeToDelete.value) ui.removeCustomTheme(themeToDelete.value)
}
</script>

<template>
  <section :aria-label="t('customTheme.title')">
    <SettingRow
      :label="t('customTheme.existingTitle')"
      :description="t('customTheme.existingDescription')"
    />
    <div class="setting-row">
      <span class="text-sm">{{ t('customTheme.active') }}</span>
      <div class="flex items-center gap-3">
        <BaseSelect
          :model-value="ui.effectiveCustomThemeName"
          :disabled="ui.customThemePreviewActive"
          :options="themeOptions"
          :aria-label="t('customTheme.active')"
          class="w-72"
          teleport
          @update:model-value="ui.selectCustomTheme(String($event))"
        />
        <BaseButton v-if="selected" size="sm" variant="danger" @click="requestDelete">
          {{ t('customTheme.remove') }}
        </BaseButton>
      </div>
    </div>
    <BaseConfirmDialog
      v-model="deleteVisible"
      :title="t('customTheme.deleteTitle')"
      :message="t('customTheme.confirmDelete', { name: themeToDelete })"
      :confirm-text="t('customTheme.remove')"
      variant="danger"
      @confirm="confirmDelete"
    />
  </section>
</template>
