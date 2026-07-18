<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseSlider from '@/components/ui/BaseSlider.vue'
import { useUIStore } from '@/stores/ui/uiStore'

const ui = useUIStore()
const { locale } = useI18n()
const backgroundInput = ref<HTMLInputElement | null>(null)
const language = computed<'zh' | 'en'>({
  get: () => (locale.value === 'en' ? 'en' : 'zh'),
  set: (value) => {
    locale.value = value
    ui.locale = value
  }
})
const themeMode = computed({
  get: () => (ui.useCustomBg ? 'custom' : ui.useDarkMode ? 'dark' : 'light'),
  set: (value: 'light' | 'dark' | 'custom') => {
    if (value === 'custom') {
      ui.useCustomBg = true
      ui.setTheme('dark')
      return
    }
    ui.useCustomBg = false
    ui.setTheme(value)
  }
})

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
    themeMode.value = 'custom'
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
  <main class="custom-scrollbar h-full overflow-y-auto">
    <div class="mx-auto w-full max-w-4xl px-6 py-8 pb-28 sm:px-10">
      <div class="mb-8">
        <p class="text-xs font-semibold tracking-[0.14em] text-[var(--color-primary)]">
          PREFERENCES
        </p>
        <h1 class="mt-2 text-2xl font-semibold tracking-tight text-[var(--color-text)]">设置</h1>
        <p class="mt-2 text-sm text-[var(--color-text-l)]">
          调整界面外观与主题，让播放器更贴合你的使用环境。
        </p>
      </div>

      <section class="settings-section">
        <div class="section-heading">
          <div>
            <h2>语言</h2>
            <p>选择播放器界面使用的显示语言。</p>
          </div>
        </div>

        <div class="settings-card">
          <div class="setting-row">
            <div>
              <h3>界面语言</h3>
              <p>切换后立即应用到当前播放器会话。</p>
            </div>
            <div class="language-options" role="radiogroup" aria-label="界面语言">
              <button
                type="button"
                class="language-option"
                :class="{ selected: language === 'zh' }"
                :aria-checked="language === 'zh'"
                role="radio"
                @click="language = 'zh'"
              >
                简体中文
              </button>
              <button
                type="button"
                class="language-option"
                :class="{ selected: language === 'en' }"
                :aria-checked="language === 'en'"
                role="radio"
                @click="language = 'en'"
              >
                English
              </button>
            </div>
          </div>
        </div>
      </section>

      <section class="settings-section">
        <div class="section-heading">
          <div>
            <h2>主题设置</h2>
            <p>选择明暗方案和界面的强调色。</p>
          </div>
          <button class="reset-button" type="button" @click="ui.resetTheme">恢复默认</button>
        </div>

        <div class="settings-card">
          <div class="setting-row setting-row-stack">
            <div>
              <h3>外观模式</h3>
              <p>自定义背景默认遵循深色方案，以保证内容清晰易读。</p>
            </div>
            <div class="theme-options" role="radiogroup" aria-label="外观模式">
              <button
                type="button"
                class="theme-option light-preview"
                :class="{ selected: themeMode === 'light' }"
                :aria-checked="themeMode === 'light'"
                role="radio"
                @click="themeMode = 'light'"
              >
                <span class="preview-window"><i /><b /></span><span>浅色</span>
              </button>
              <button
                type="button"
                class="theme-option dark-preview"
                :class="{ selected: themeMode === 'dark' }"
                :aria-checked="themeMode === 'dark'"
                role="radio"
                @click="themeMode = 'dark'"
              >
                <span class="preview-window"><i /><b /></span><span>深色</span>
              </button>
              <button
                type="button"
                class="theme-option custom-preview"
                :class="{ selected: themeMode === 'custom' }"
                :aria-checked="themeMode === 'custom'"
                role="radio"
                @click="themeMode = 'custom'"
              >
                <span class="preview-window"><i /><b /></span><span>自定义</span>
              </button>
            </div>
          </div>

          <div class="setting-row">
            <div>
              <h3>主题色</h3>
              <p>用于进度、选中状态和主要操作。</p>
            </div>
            <label class="color-control">
              <input v-model="ui.customThemeColor" type="color" aria-label="自定义主题色" />
              <span>{{ ui.customThemeColor || '#24a56a' }}</span>
            </label>
          </div>
        </div>
      </section>

      <section class="settings-section">
        <div class="section-heading">
          <div>
            <h2>自定义背景</h2>
            <p>可使用自己的图片，并在不牺牲可读性的前提下调整效果。</p>
          </div>
          <span class="text-xs text-[var(--color-text-l)]">{{
            ui.useCustomBg ? '已启用' : '未启用'
          }}</span>
        </div>

        <div class="settings-card" :class="{ muted: !ui.useCustomBg }">
          <div class="setting-row background-row">
            <div>
              <h3>背景图片</h3>
              <p>{{ ui.customBg.path || '尚未选择图片' }}</p>
            </div>
            <div class="flex shrink-0 gap-2">
              <button class="secondary-button" type="button" @click="chooseBackground">
                选择图片
              </button>
              <button
                v-if="ui.customBg.url"
                class="icon-button"
                type="button"
                title="移除背景"
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
              <span>亮度</span><strong>{{ ui.customBg.brightness }}%</strong>
            </div>
            <BaseSlider
              v-model="ui.customBg.brightness"
              :min="45"
              :max="130"
              :step="1"
              size="sm"
              :disabled="!ui.useCustomBg"
            />
          </div>
          <div class="slider-row">
            <div class="slider-label">
              <span>模糊度</span><strong>{{ ui.customBg.blur }} px</strong>
            </div>
            <BaseSlider
              v-model="ui.customBg.blur"
              :min="0"
              :max="28"
              :step="1"
              size="sm"
              :disabled="!ui.useCustomBg"
            />
          </div>
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.settings-section {
  margin-top: 2.5rem;
}
.section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.9rem;
}
.section-heading h2 {
  color: var(--color-text);
  font-size: 1rem;
  font-weight: 650;
}
.section-heading p,
.setting-row p {
  margin-top: 0.25rem;
  color: var(--color-text-l);
  font-size: 0.8125rem;
  line-height: 1.45;
}
.settings-card {
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: color-mix(in srgb, var(--color-bg-l) 86%, transparent);
  box-shadow: 0 1px 1px color-mix(in srgb, var(--color-black-20) 30%, transparent);
  transition: opacity 0.2s ease;
}
.settings-card.muted {
  opacity: 0.58;
}
.setting-row {
  display: flex;
  min-height: 76px;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
  padding: 1.1rem 1.25rem;
  border-bottom: 1px solid var(--color-border);
}
.setting-row h3 {
  color: var(--color-text);
  font-size: 0.9rem;
  font-weight: 550;
}
.setting-row-stack {
  align-items: flex-start;
}
.theme-options {
  display: flex;
  gap: 0.65rem;
}
.language-options {
  display: flex;
  gap: 0.5rem;
}
.language-option {
  min-width: 92px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 0.45rem 0.7rem;
  color: var(--color-text-l);
  font-size: 0.78rem;
  transition:
    border-color 0.2s,
    box-shadow 0.2s,
    color 0.2s;
}
.language-option:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
}
.language-option.selected {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 20%, transparent);
  color: var(--color-primary);
}
.theme-option {
  display: grid;
  gap: 0.45rem;
  width: 104px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 0.5rem;
  color: var(--color-text-l);
  font-size: 0.75rem;
  text-align: left;
  transition:
    border-color 0.2s,
    box-shadow 0.2s,
    color 0.2s;
}
.theme-option:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
}
.theme-option.selected {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 20%, transparent);
  color: var(--color-primary);
}
.preview-window {
  display: flex;
  height: 47px;
  overflow: hidden;
  border-radius: 6px;
  padding: 8px;
  gap: 5px;
}
.preview-window i {
  width: 18%;
  border-radius: 3px;
}
.preview-window b {
  flex: 1;
  border-radius: 3px;
}
.light-preview .preview-window {
  background: #f8faf9;
}
.light-preview i {
  background: #e5e9e7;
}
.light-preview b {
  background: #fff;
}
.dark-preview .preview-window {
  background: #151a18;
}
.dark-preview i {
  background: #252d2a;
}
.dark-preview b {
  background: #1d2421;
}
.custom-preview .preview-window {
  background: linear-gradient(135deg, #37524d, #16231f);
}
.custom-preview i {
  background: rgb(255 255 255 / 18%);
}
.custom-preview b {
  background: rgb(255 255 255 / 10%);
}
.color-control {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 122px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 0.35rem 0.55rem;
  color: var(--color-text-l);
  font:
    500 0.75rem ui-monospace,
    monospace;
}
.color-control input {
  width: 24px;
  height: 24px;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
}
.background-row {
  border-bottom: 1px solid var(--color-border);
}
.slider-row {
  padding: 1rem 1.25rem;
}
.slider-row + .slider-row {
  padding-top: 0.25rem;
}
.slider-label {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.55rem;
  color: var(--color-text-l);
  font-size: 0.8125rem;
}
.slider-label strong {
  color: var(--color-text);
  font-weight: 550;
}
.secondary-button,
.reset-button,
.icon-button {
  border-radius: 7px;
  font-size: 0.78rem;
  transition:
    background-color 0.2s,
    color 0.2s;
}
.secondary-button {
  border: 1px solid var(--color-border);
  padding: 0.45rem 0.7rem;
  color: var(--color-text);
}
.secondary-button:hover,
.reset-button:hover,
.icon-button:hover {
  background: var(--color-hover);
}
.icon-button {
  width: 31px;
  color: var(--color-text-l);
  font-size: 1.15rem;
}
.reset-button {
  padding: 0.35rem 0.5rem;
  color: var(--color-text-l);
}
@media (max-width: 580px) {
  .setting-row {
    align-items: flex-start;
    flex-direction: column;
    gap: 0.8rem;
  }
  .setting-row-stack {
    gap: 1rem;
  }
  .theme-options {
    width: 100%;
  }
  .language-options {
    width: 100%;
  }
  .theme-option {
    flex: 1;
  }
  .language-option {
    flex: 1;
  }
  .color-control {
    width: 100%;
  }
  .background-row {
    flex-direction: row;
    align-items: center;
  }
  .section-heading {
    flex-direction: column;
  }
  .settings-section {
    margin-top: 2rem;
  }
}
</style>
