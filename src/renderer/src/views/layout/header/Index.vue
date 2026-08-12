<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import ScanProgress from '@/components/scan/ScanProgress.vue'
import { useAutoHide } from '@/hooks/useAutoHide'
import { useUIStore } from '@/stores/ui/uiStore'
import { useRoute } from 'vue-router'
import router from '@/router'
import { useI18n } from 'vue-i18n'
import { VERSION } from '@/consts'

const props = defineProps<{ autoHide?: boolean; hideDelay?: number }>()
const { visible } = useAutoHide({ enabled: () => props.autoHide, delay: props.hideDelay || 5000 })
const ui = useUIStore()
const { t } = useI18n()
const route = useRoute()
const maximized = ref(false)
const scanVisible = ref(false)
const scanning = ref(false)
const scanCurrent = ref(0)
const scanTotal = ref(0)
const scanAdded = ref(0)
const scanDuplicates = ref(0)
const importingLocalFolder = ref(false)
const isMac = navigator.userAgent.includes('Macintosh')
const headerStyle = computed(() =>
  ui.useMica
    ? {
        background: 'transparent',
        backdropFilter: 'none'
      }
    : undefined
)

const removeScanProgressListener = window.api.library.onScanProgress((progress) => {
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
async function enterMiniPlayer(): Promise<void> {
  await window.api.miniPlayer.enter()
}
async function uploadLocalFiles(): Promise<void> {
  if (importingLocalFolder.value) return
  importingLocalFolder.value = true
  try {
    const directory = await window.api.library.selectLocalMusicFolder()
    if (!directory) return
    scanVisible.value = true
    scanning.value = true
    scanCurrent.value = 0
    scanTotal.value = 0
    scanAdded.value = 0
    scanDuplicates.value = 0
    await nextTick()
    const response = await window.api.library.scanLocalMusicFolder(directory)
    scanCurrent.value = response.result.total
    scanTotal.value = response.result.total
    scanAdded.value = response.result.added
    scanDuplicates.value = response.result.duplicates
  } finally {
    importingLocalFolder.value = false
    if (scanVisible.value) scanning.value = false
  }
}
</script>

<template>
  <header
    class="app-header flex h-[42px] items-center border-b transition-opacity [-webkit-app-region:drag]"
    :class="[visible ? '' : 'pointer-events-none opacity-0', isMac ? 'app-header--mac' : '']"
    :style="headerStyle"
  >
    <Teleport to="body">
      <ScanProgress
        v-model:visible="scanVisible"
        :scanning="scanning"
        :current="scanCurrent"
        :total="scanTotal"
        :added="scanAdded"
        :duplicates="scanDuplicates"
      />
    </Teleport>

    <div
      class="flex min-w-max cursor-pointer items-center gap-2 text-text [-webkit-app-region:no-drag]"
      :class="isMac ? 'pl-[84px]' : 'pl-3.5'"
      @click="go('/home')"
    >
      <span
        class="grid size-[21px] place-items-center rounded-md bg-primary text-[0.7rem] font-bold text-white"
        >EY
      </span>
      <span class="text-[16px] font-semibold tracking-tight">{{ ui.logoText }}</span>
      <span class="text-[9px] mt-2">V {{ VERSION }}</span>
    </div>
    <button
      v-if="!ui.useCardView"
      class="ml-1 grid size-[42px] place-items-center text-text-l transition hover:bg-hover hover:text-text [-webkit-app-region:no-drag]"
      :title="t('header.back')"
      :aria-label="t('header.back')"
      @click="router.back()"
    >
      <svgIcon name="common-back" class-name="size-4" />
    </button>
    <div class="h-full min-w-4 flex-1" />
    <div class="flex self-stretch [-webkit-app-region:no-drag]">
      <button
        class="grid size-[42px] place-items-center text-text-l transition hover:bg-hover hover:text-text"
        :title="t('header.importLocalMusic')"
        @click="uploadLocalFiles"
      >
        <svgIcon name="common-plus" class-name="size-5" />
      </button>
      <button
        class="grid size-[42px] place-items-center text-text-l transition hover:bg-hover hover:text-text"
        :title="t('header.settings')"
        @click="go('/settings')"
      >
        <svgIcon name="menu-settings" class-name="size-4" />
      </button>
      <button
        class="grid size-[42px] place-items-center text-text-l transition hover:bg-hover hover:text-text"
        :title="ui.useCardView ? t('header.exitCardMode') : t('header.cardMode')"
        @click="ui.toggleCardStyle"
      >
        <svgIcon
          name="common-carousel-horizontal"
          class-name="size-5"
          :class="ui.useCardView ? 'text-primary' : ''"
        />
      </button>
    </div>
    <div v-if="!isMac" class="flex self-stretch [-webkit-app-region:no-drag]">
      <button
        class="grid w-[46px] place-items-center text-text-l transition hover:bg-hover hover:text-text"
        :title="t('header.miniPlayer')"
        :aria-label="t('header.miniPlayer')"
        @click="enterMiniPlayer"
      >
        <svgIcon name="common-mini-player" class-name="size-5" />
      </button>
    </div>
    <div v-if="!isMac" class="flex self-stretch [-webkit-app-region:no-drag]">
      <button
        class="grid w-[46px] place-items-center text-text-l transition hover:bg-hover hover:text-text"
        :title="t('header.minimize')"
        :aria-label="t('header.minimize')"
        @click="runWindowCommand('minimize')"
      >
        <span class="w-3 border-t-[1.5px] border-current" />
      </button>
      <button
        class="grid w-[46px] place-items-center text-text-l transition hover:bg-hover hover:text-text"
        :title="maximized ? t('header.restore') : t('header.maximize')"
        :aria-label="maximized ? t('header.restore') : t('header.maximize')"
        @click="runWindowCommand('toggle-maximize')"
      >
        <span
          class="relative size-[11px] border-[1.4px] border-current"
          :class="
            maximized
              ? 'translate-x-px -translate-y-px before:absolute before:-left-[5px] before:top-[3px] before:size-2 before:border-[1.4px] before:border-current before:bg-bg'
              : ''
          "
        />
      </button>
      <button
        class="grid w-[46px] place-items-center text-text-l transition hover:bg-[#e5484d] hover:text-white"
        :title="t('header.close')"
        :aria-label="t('header.close')"
        @click="runWindowCommand('close')"
      >
        <span
          class="relative size-3 before:absolute before:left-0 before:top-[5px] before:w-3 before:border-t-[1.4px] before:border-current before:rotate-45 after:absolute after:left-0 after:top-[5px] after:w-3 after:border-t-[1.4px] after:border-current after:-rotate-45"
        />
      </button>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  border-color: var(--app-chrome-border, color-mix(in srgb, var(--color-border) 82%, transparent));
  background: var(--app-header-bg, color-mix(in srgb, var(--color-bg) 82%, transparent));
  backdrop-filter: blur(18px);
  transition:
    background-color 0.3s ease,
    border-color 0.3s ease,
    opacity 0.2s ease;
}

/* The native macOS traffic lights occupy the left side of the 42px header. */
.app-header--mac {
  min-height: 42px;
}
</style>
