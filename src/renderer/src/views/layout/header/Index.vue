<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import ScanProgress from '@/components/scan/ScanProgress.vue'
import { useAutoHide } from '@/hooks/useAutoHide'
import { useUIStore } from '@/stores/ui/uiStore'
import { useRoute } from 'vue-router'
import router from '@/router'

const props = defineProps<{
  autoHide?: boolean
  hideDelay?: number
}>()

const { visible } = useAutoHide({
  enabled: () => props.autoHide,
  delay: props.hideDelay || 5000
})

const ui = useUIStore()
const route = useRoute()
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

onBeforeUnmount(removeScanProgressListener)

const go = (path: string): void => {
  if (ui.useCardView) ui.setCardStyle(false)
  if (route.path !== path) router.push(path)
}
const miniMode = (): void => {
  // TODO
}

const minimize = (): void => {
  // TODO
}

const maximize = (): void => {
  // TODO
}

const close = async (): Promise<void> => {
  // TODO
}
const uploadLocalFiles = async (): Promise<void> => {
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
  <header
    class="h-10 text-text flex items-center justify-between px-3 header-drag z-10 transition-opacity duration-300"
    :class="[visible ? 'opacity-100' : 'opacity-0 pointer-events-none']"
  >
    <ScanProgress
      v-model:visible="scanVisible"
      :scanning="scanning"
      :current="scanCurrent"
      :total="scanTotal"
      :added="scanAdded"
      :duplicates="scanDuplicates"
    />
    <!-- 左侧组件 -->
    <div class="flex items-center space-x-2">
      <!-- LOGO -->
      <h1
        class="text-lg font-bold mr-2 cursor-pointer hover:text-primary header-no-drag transition-all duration-300 ease-out hover:scale-102 active:scale-100 select-none"
        @click="go('/home')"
      >
        {{ ui.logoText }}
      </h1>
      <!-- 后退按钮 -->
      <button v-if="!ui.useCardView" class="ml-1 header-no-drag btn-hover" @click="router.back()">
        <svgIcon name="common-back" class-name="w-4 h-4 icon" />
      </button>
    </div>

    <!-- 右侧组件 -->
    <div class="flex items-center justify-center header-no-drag">
      <div class="flex space-x-3">
        <!-- 上传文件 -->
        <button class="btn-hover" @click="uploadLocalFiles">
          <svgIcon name="common-plus" class-name="w-5 h-5 icon" />
        </button>
        <!-- 设置按钮 -->
        <button class="btn-hover" @click="go('/settings')">
          <svgIcon name="menu-settings" class-name="w-4 h-4 icon" />
        </button>
        <!-- 卡片按钮 -->
        <button class="btn-hover" @click="ui.toggleCardStyle">
          <svgIcon
            name="common-carousel-horizontal"
            class-name="w-[18px] h-[18px] icon"
            :class="ui.useCardView ? 'text-primary' : ''"
          />
        </button>
        <div />
      </div>
      <div class="flex space-x-3">
        <!-- 迷你模式 -->
        <button class="btn-hover" @click="miniMode">
          <svgIcon name="common-mini-player" class-name="w-5 h-5 icon" />
        </button>
        <!-- 最小化 -->
        <button class="btn-hover" @click="minimize">
          <svgIcon name="common-minimize" class-name="w-5 h-5 icon" />
        </button>
        <!-- 全屏 -->
        <button class="btn-hover" @click="maximize">
          <svgIcon name="menu-fullscreen" class-name="w-[18px] h-[18px] icon" />
        </button>
        <!-- 关闭 -->
        <button class="btn-hover" @click="close">
          <svgIcon name="menu-close" class-name="w-[18px] h-[18px] icon" />
        </button>
      </div>
    </div>
  </header>
</template>
