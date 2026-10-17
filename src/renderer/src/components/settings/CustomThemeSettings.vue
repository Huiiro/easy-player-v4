<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseConfirmDialog from '@/components/ui/BaseConfirmDialog.vue'
import { useUIStore } from '@/stores/ui/uiStore'
import { MAX_THEME_BYTES } from '@/services/customTheme'
import SvgIcon from '@/components/svg/SvgIcon.vue'

const ui = useUIStore()
const { t } = useI18n()
const fileInput = ref<HTMLInputElement | null>(null)
const error = ref('')
const importing = ref(false)
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

async function importFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  importing.value = true
  error.value = ''
  try {
    if (file.name.toLowerCase().endsWith('.zip')) {
      if (file.size > 32 * 1024 * 1024) throw new Error('Theme ZIP exceeds 32 MB')
      const result = await window.api.themes.importPackage(new Uint8Array(await file.arrayBuffer()))
      if (!result.success || !result.data) throw new Error(result.error || 'Package import failed')
      try {
        ui.importCustomTheme(result.data.source, result.data.package)
      } catch (cause) {
        await window.api.themes.removePackage(result.data.package.id)
        throw cause
      }
    } else {
      if (file.size > MAX_THEME_BYTES) throw new Error('Theme exceeds 128 KB')
      ui.importCustomTheme(await file.text())
    }
  } catch (cause) {
    error.value = `${t('customTheme.importFailed')}: ${cause instanceof Error ? cause.message : String(cause)}`
  } finally {
    importing.value = false
    input.value = ''
  }
}
async function exportTheme(): Promise<void> {
  const theme = selected.value ?? {
    version: 1,
    name: 'Ocean Glass',
    background: 'replace',
    tokens: {
      '--color-primary': '#38bdf8',
      '--ep-sidebar-bg': 'color-mix(in srgb, var(--color-bg) 90%, #38bdf8)',
      '--ep-button-radius': '0.75rem',
      '--ep-dialog-radius': '1.5rem',
      '--ep-progress-fill': '#38bdf8'
    },
    rules: { '.ep-dialog-panel': { border: '1px solid var(--color-border)' } }
  }
  error.value = ''
  let blob: Blob
  const installed = selected.value?.package
  try {
    if (installed) {
      const result = await window.api.themes.exportPackage(installed.id)
      if (!result.success || !result.data) throw new Error(result.error || 'Package export failed')
      blob = new Blob([new Uint8Array(result.data)], { type: 'application/zip' })
    } else blob = new Blob([JSON.stringify(theme, null, 2)], { type: 'application/json' })
  } catch (cause) {
    error.value = String(cause)
    return
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${theme.name.replace(/[^a-z0-9\u4e00-\u9fff-]/gi, '_')}.theme.${installed ? 'zip' : 'json'}`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>

<template>
  <section :aria-label="t('customTheme.title')">
    <div
      role="note"
      class="mx-5 my-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-text"
    >
      <div class="flex items-center gap-1">
        <svg-icon name="common-warning" class-name="size-4.5 text-warning" />
        <p class="font-semibold">{{ t('customTheme.thirdPartyTitle') }}</p>
      </div>
      <p class="mt-1 text-xs">{{ t('customTheme.thirdPartyRisk') }}</p>
    </div>
    <div class="setting-row">
      <div>
        <h3>{{ t('customTheme.title') }}</h3>
        <p>{{ t('customTheme.description') }}</p>
      </div>
      <div class="flex shrink-0 flex-wrap gap-2">
        <input
          ref="fileInput"
          type="file"
          accept=".json,.zip,application/json,application/zip"
          class="hidden"
          @change="importFile"
        />
        <BaseButton
          size="sm"
          :disabled="importing || ui.customThemePreviewActive"
          @click="fileInput?.click()"
        >
          {{ t('customTheme.import') }}
        </BaseButton>
        <BaseButton size="sm" variant="secondary" @click="exportTheme">
          {{ t(selected ? 'customTheme.export' : 'customTheme.example') }}
        </BaseButton>
      </div>
    </div>
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
    <p v-if="error" role="alert" class="px-5 pb-4 text-sm text-danger">{{ error }}</p>
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
