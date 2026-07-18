<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import ScanProgress from '@/components/scan/ScanProgress.vue'
import { useAutoHide } from '@/hooks/useAutoHide'
import { useUIStore } from '@/stores/ui/uiStore'
import { useRoute } from 'vue-router'
import router from '@/router'

const props = defineProps<{ autoHide?: boolean; hideDelay?: number }>()
const { visible } = useAutoHide({ enabled: () => props.autoHide, delay: props.hideDelay || 5000 })
const ui = useUIStore()
const route = useRoute()
const maximized = ref(false)
const scanVisible = ref(false)
const scanning = ref(false)
const scanCurrent = ref(0)
const scanTotal = ref(0)
const scanAdded = ref(0)
const scanDuplicates = ref(0)
const importingLocalFolder = ref(false)

const removeScanProgressListener = window.api.library.onScanProgress((progress) => {
  if (!importingLocalFolder.value) return
  scanVisible.value = true
  scanning.value = true
  scanCurrent.value = progress.current
  scanTotal.value = progress.total
  scanAdded.value = progress.added
  scanDuplicates.value = progress.duplicates
})
const removeWindowStateListener = window.api.window.onState((state) => {
  maximized.value = state.maximized
})
onBeforeUnmount(() => {
  removeScanProgressListener()
  removeWindowStateListener()
})

function go(path: string): void {
  if (ui.useCardView) ui.setCardStyle(false)
  if (route.path !== path) void router.push(path)
}
async function runWindowCommand(command: 'minimize' | 'toggle-maximize' | 'close'): Promise<void> {
  const state = await window.api.window.command(command)
  maximized.value = state.maximized
}
async function uploadLocalFiles(): Promise<void> {
  if (importingLocalFolder.value) return
  importingLocalFolder.value = true
  try {
    const response = await window.api.library.importLocalFolder()
    if (!response.cancelled) {
      scanVisible.value = true
      scanCurrent.value = response.result.total
      scanTotal.value = response.result.total
      scanAdded.value = response.result.added
      scanDuplicates.value = response.result.duplicates
    }
  } finally {
    importingLocalFolder.value = false
    if (scanVisible.value) scanning.value = false
  }
}
</script>

<template>
  <header class="titlebar" :class="visible ? '' : 'opacity-0 pointer-events-none'">
    <ScanProgress
      v-model:visible="scanVisible"
      :scanning="scanning"
      :current="scanCurrent"
      :total="scanTotal"
      :added="scanAdded"
      :duplicates="scanDuplicates"
    />

    <div class="titlebar-brand header-no-drag" @click="go('/home')">
      <span class="brand-mark">E</span><span class="brand-name">{{ ui.logoText }}</span>
    </div>
    <button
      v-if="!ui.useCardView"
      class="toolbar-button header-no-drag back-button"
      title="返回"
      aria-label="返回"
      @click="router.back()"
    >
      <svgIcon name="common-back" class-name="size-4" />
    </button>
    <div class="titlebar-drag" />
    <div class="titlebar-actions header-no-drag">
      <button class="toolbar-button" title="导入本地音乐" @click="uploadLocalFiles">
        <svgIcon name="common-plus" class-name="size-4" />
      </button>
      <button class="toolbar-button" title="设置" @click="go('/settings')">
        <svgIcon name="menu-settings" class-name="size-4" />
      </button>
      <button
        class="toolbar-button"
        :title="ui.useCardView ? '退出卡片模式' : '卡片模式'"
        @click="ui.toggleCardStyle"
      >
        <svgIcon
          name="common-carousel-horizontal"
          class-name="size-4"
          :class="ui.useCardView ? 'text-primary' : ''"
        />
      </button>
    </div>
    <div class="window-controls header-no-drag">
      <button
        class="window-control"
        title="最小化"
        aria-label="最小化"
        @click="runWindowCommand('minimize')"
      >
        <span class="window-minimize" />
      </button>
      <button
        class="window-control"
        :title="maximized ? '还原窗口' : '最大化'"
        :aria-label="maximized ? '还原窗口' : '最大化'"
        @click="runWindowCommand('toggle-maximize')"
      >
        <span class="window-maximize" :class="{ restored: maximized }" />
      </button>
      <button
        class="window-control close-control"
        title="关闭"
        aria-label="关闭"
        @click="runWindowCommand('close')"
      >
        <span class="window-close" />
      </button>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  display: flex;
  height: 42px;
  align-items: center;
  border-bottom: 1px solid color-mix(in srgb, var(--color-border) 82%, transparent);
  background: color-mix(in srgb, var(--color-bg) 82%, transparent);
  transition: opacity 0.2s ease;
  -webkit-app-region: drag;
}
.titlebar-brand {
  display: flex;
  min-width: max-content;
  align-items: center;
  gap: 0.55rem;
  padding-left: 0.9rem;
  color: var(--color-text);
  cursor: pointer;
}
.brand-mark {
  display: grid;
  width: 21px;
  height: 21px;
  place-items: center;
  border-radius: 6px;
  background: var(--color-primary);
  color: white;
  font-size: 0.7rem;
  font-weight: 750;
}
.brand-name {
  font-size: 0.85rem;
  font-weight: 650;
  letter-spacing: -0.01em;
}
.titlebar-drag {
  min-width: 1rem;
  flex: 1;
  height: 100%;
}
.back-button {
  margin-left: 0.2rem;
}
.titlebar-actions,
.window-controls {
  display: flex;
  align-self: stretch;
}
.toolbar-button,
.window-control {
  display: grid;
  width: 42px;
  place-items: center;
  color: var(--color-text-l);
  transition:
    color 0.16s ease,
    background 0.16s ease;
}
.toolbar-button:hover,
.window-control:hover {
  background: var(--color-hover);
  color: var(--color-text);
}
.window-control {
  width: 46px;
}
.close-control:hover {
  background: #e5484d;
  color: white;
}
.window-minimize {
  width: 11px;
  border-top: 1.5px solid currentColor;
}
.window-maximize {
  width: 11px;
  height: 11px;
  border: 1.4px solid currentColor;
}
.window-maximize.restored {
  position: relative;
  transform: translate(1px, -1px);
}
.window-maximize.restored::after {
  content: '';
  position: absolute;
  width: 8px;
  height: 8px;
  left: -4px;
  top: 3px;
  border: 1.4px solid currentColor;
  background: var(--color-bg);
}
.window-close {
  position: relative;
  width: 12px;
  height: 12px;
}
.window-close::before,
.window-close::after {
  content: '';
  position: absolute;
  top: 5px;
  left: 0;
  width: 12px;
  border-top: 1.4px solid currentColor;
  transform: rotate(45deg);
}
.window-close::after {
  transform: rotate(-45deg);
}
</style>
