<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseSlider from '@/components/ui/BaseSlider.vue'
import BaseColorPicker from '@/components/ui/BaseColorPicker.vue'
import { presetColors } from '@/consts/color'
import { useUIStore } from '@/stores/ui/uiStore'
import { useMessage } from '@/components/ui/useMessage'

const ui = useUIStore()
const { t } = useI18n()
const { error: showError } = useMessage()
const backgroundInput = ref<HTMLInputElement | null>(null)
const importingBackground = ref(false)
const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg'])
function retireVideo(): void {
  if (ui.customBg.kind !== 'video' || !ui.customBg.url) return
  const oldUrl = ui.customBg.url
  // Let the old video element leave the transition before removing its backing file.
  setTimeout(() => void window.api.files.removeBackgroundVideo(oldUrl), 1500)
}
function chooseBackground(): void {
  backgroundInput.value?.click()
}
function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Invalid image'))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
async function updateBackground(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || importingBackground.value) return
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension !== 'mp4' && !imageExtensions.has(extension || '')) {
    showError(t('settings.backgroundUnsupportedFormat'))
    return
  }
  importingBackground.value = true
  try {
    let url: string
    if (extension === 'mp4') {
      const result = await window.api.files.importBackgroundVideo(
        window.api.audio.getFilePath(file)
      )
      if (!result.success || !result.data) {
        showError(result.error || t('settings.backgroundImportFailed'))
        return
      }
      url = result.data.url
    } else {
      url = await readImage(file)
    }
    retireVideo()
    ui.customBg.kind = extension === 'mp4' ? 'video' : 'image'
    ui.customBg.url = url
    ui.customBg.path = file.name
    ui.systemBackground = 'none'
    ui.useCustomBg = true
    ui.setTheme('dark')
  } catch {
    showError(t('settings.backgroundImportFailed'))
  } finally {
    importingBackground.value = false
  }
}
function clearBackground(): void {
  retireVideo()
  ui.useCustomBg = false
  ui.customBg.kind = 'image'
  ui.customBg.url = ''
  ui.customBg.path = ''
  ui.customBg.blur = 0
  ui.customBg.brightness = 100
  if (backgroundInput.value) backgroundInput.value.value = ''
}
</script>

<template>
  <div
    class="settings-card"
    :class="{
      muted: !ui.useCustomBg || ui.followSystemTheme,
      'pointer-events-none': ui.followSystemTheme
    }"
  >
    <div class="setting-row">
      <div>
        <h3>{{ t('settings.backgroundMedia') }}</h3>
        <p>{{ ui.customBg.path || t('settings.noBackgroundSelected') }}</p>
      </div>
      <div class="flex shrink-0 gap-2">
        <button
          class="secondary-button"
          type="button"
          :disabled="importingBackground"
          @click="chooseBackground"
        >
          {{ t('settings.selectBackground') }}
        </button>
        <button
          v-if="ui.customBg.url"
          class="icon-button"
          type="button"
          :title="t('settings.removeBackground')"
          @click="clearBackground"
        >
          ×
        </button>
      </div>
      <input
        ref="backgroundInput"
        class="hidden"
        type="file"
        accept=".png,.jpg,.jpeg,.webp,.gif,.bmp,.avif,.svg,.mp4"
        @change="updateBackground"
      />
    </div>

    <div class="slider-row">
      <div class="slider-label">
        <span>{{ t('settings.brightness') }}</span>
        <strong>{{ ui.customBg.brightness }}%</strong>
      </div>
      <BaseSlider
        v-model="ui.customBg.brightness"
        :min="10"
        :max="110"
        :step="1"
        size="sm"
        :disabled="!ui.useCustomBg"
      />
    </div>
    <div class="slider-row">
      <div class="slider-label">
        <span>{{ t('settings.blur') }}</span>
        <strong>{{ ui.customBg.blur }} px</strong>
      </div>
      <BaseSlider
        v-model="ui.customBg.blur"
        :min="0"
        :max="30"
        :step="1"
        size="sm"
        :disabled="!ui.useCustomBg"
      />
    </div>
    <div class="custom-background-chrome">
      <div class="custom-background-chrome-heading">
        <h3>{{ t('settings.backgroundChrome') }}</h3>
        <p>{{ t('settings.backgroundChromeDescription') }}</p>
      </div>
      <div class="custom-background-color-grid">
        <label class="custom-background-color-control">
          <span>{{ t('settings.headerBackground') }}</span>
          <BaseColorPicker
            v-model="ui.customBg.headerBackground"
            :presets="presetColors"
            show-alpha
            teleport
            :disabled="!ui.useCustomBg"
          />
        </label>
        <label class="custom-background-color-control">
          <span>{{ t('settings.footerBackground') }}</span>
          <BaseColorPicker
            v-model="ui.customBg.footerBackground"
            :presets="presetColors"
            show-alpha
            teleport
            :disabled="!ui.useCustomBg"
          />
        </label>
        <label class="custom-background-color-control">
          <span>{{ t('settings.globalBorder') }}</span>
          <BaseColorPicker
            v-model="ui.customBg.chromeBorder"
            :presets="presetColors"
            show-alpha
            teleport
            :disabled="!ui.useCustomBg"
          />
        </label>
      </div>
    </div>
  </div>
</template>
