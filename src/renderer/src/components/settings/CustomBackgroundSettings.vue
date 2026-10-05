<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseSlider from '@/components/ui/BaseSlider.vue'
import BaseColorPicker from '@/components/ui/BaseColorPicker.vue'
import { presetColors } from '@/consts/color'
import { useUIStore } from '@/stores/ui/uiStore'

const ui = useUIStore()
const { t } = useI18n()
const backgroundInput = ref<HTMLInputElement | null>(null)
function chooseBackground(): void {
  backgroundInput.value?.click()
}
function updateBackground(event: Event): void {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || !file.type.startsWith('image/')) return
  const reader = new FileReader()
  reader.onload = () => {
    ui.customBg.url = typeof reader.result === 'string' ? reader.result : ''
    ui.customBg.path = file.name
    ui.systemBackground = 'none'
    ui.useCustomBg = true
    ui.setTheme('dark')
  }
  reader.readAsDataURL(file)
}
function clearBackground(): void {
  ui.useCustomBg = false
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
    <div class="setting-row background-row">
      <div>
        <h3>{{ t('settings.backgroundImage') }}</h3>
        <p>{{ ui.customBg.path || t('noImageSelected') }}</p>
      </div>
      <div class="flex shrink-0 gap-2">
        <button class="secondary-button" type="button" @click="chooseBackground">
          {{ t('settings.selectImage') }}
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
        accept="image/*"
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
        :min="30"
        :max="130"
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
