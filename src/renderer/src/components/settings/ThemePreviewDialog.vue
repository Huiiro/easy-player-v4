<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUIStore } from '@/stores/ui/uiStore'

const ui = useUIStore()
const { t } = useI18n()
const dialog = ref<HTMLDialogElement | null>(null)

watch(
  [() => ui.customThemePreviewActive, dialog],
  ([visible, element]) => {
    if (!element) return
    if (visible && !element.open) element.showModal()
    if (!visible && element.open) element.close()
  },
  { flush: 'post', immediate: true }
)

onBeforeUnmount(() => ui.cancelCustomThemePreview())
</script>

<template>
  <Teleport to="body">
    <!-- Native top layer + fixed styles keep this recovery UI outside the theme's ep-* hooks. -->
    <dialog
      ref="dialog"
      class="theme-safety-dialog"
      aria-labelledby="theme-preview-title"
      aria-describedby="theme-preview-description theme-preview-countdown"
      @cancel.prevent="ui.cancelCustomThemePreview"
    >
      <h2 id="theme-preview-title">{{ t('customTheme.previewTitle') }}</h2>
      <p id="theme-preview-description">
        {{
          t('customTheme.previewDescription', {
            name: ui.effectiveCustomThemeName || t('customTheme.default')
          })
        }}
      </p>
      <p class="theme-safety-warning">
        {{ t('customTheme.thirdPartyRisk') }}
      </p>
      <p id="theme-preview-countdown" role="timer">
        {{ t('customTheme.previewCountdown', { seconds: ui.customThemePreviewSeconds }) }}
      </p>
      <div class="theme-safety-actions">
        <button type="button" autofocus @click="ui.cancelCustomThemePreview">
          {{ t('customTheme.revert') }}
        </button>
        <button type="button" class="theme-safety-keep" @click="ui.confirmCustomThemePreview">
          {{ t('customTheme.keep') }}
        </button>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.theme-safety-dialog {
  position: fixed;
  inset: 0;
  width: min(460px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  overflow: auto;
  margin: auto;
  padding: 24px;
  border: 1px solid #475569;
  border-radius: 16px;
  background: #101827;
  color: #f1f5f9;
  color-scheme: dark;
  font:
    400 14px/1.6 system-ui,
    'Microsoft YaHei',
    sans-serif;
  text-align: left;
  box-shadow: 0 24px 64px #0009;
  animation: none;
  transition: none;
}
.theme-safety-dialog::backdrop {
  background: #0009;
}
.theme-safety-dialog h2 {
  margin: 0 0 12px;
  font:
    600 18px/1.5 system-ui,
    'Microsoft YaHei',
    sans-serif;
}
.theme-safety-dialog p {
  margin: 12px 0;
}
.theme-safety-warning {
  color: #fcd34d;
}
.theme-safety-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 20px;
}
.theme-safety-dialog button {
  padding: 8px 16px;
  border: 1px solid #64748b;
  border-radius: 8px;
  background: #1e293b;
  color: #f1f5f9;
  font:
    500 14px/1.5 system-ui,
    'Microsoft YaHei',
    sans-serif;
  cursor: pointer;
}
.theme-safety-dialog button:hover {
  background: #334155;
}
.theme-safety-dialog button:focus-visible {
  outline: 2px solid #93c5fd;
  outline-offset: 3px;
}
.theme-safety-dialog .theme-safety-keep {
  background: #1d4ed8;
  border-color: #60a5fa;
}
.theme-safety-dialog .theme-safety-keep:hover {
  background: #1e40af;
}
</style>
