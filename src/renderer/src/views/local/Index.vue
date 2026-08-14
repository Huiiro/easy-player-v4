<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import FolderTree, { type FolderTreeNode } from '@/components/local/FolderTree.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import SongListView from '@/components/songlist/SongListView.vue'
import { useMessage } from '@/components/ui/useMessage'
import eventBus from '@/utils/eventBus'

interface LocalFolder {
  id: number
  pid: number | null
  name: string
  fullPath: string
  isRootPath: boolean
  songCount: number
}

const { t } = useI18n()
const { success } = useMessage()
const folders = ref<LocalFolder[]>([])
const sectionRef = ref<HTMLElement | null>(null)
const selectedFolderId = ref<number | null>(null)
const sidebarWidth = ref(Number(localStorage.getItem('easy-player:local-sidebar-width')) || 256)
const isResizing = ref(false)
const listRefreshKey = ref(0)
const tree = computed<FolderTreeNode[]>(() => {
  const nodes = new Map<number, FolderTreeNode>()
  folders.value.forEach((folder) => nodes.set(folder.id, { ...folder, children: [] }))
  const roots: FolderTreeNode[] = []
  folders.value.forEach((folder) => {
    const node = nodes.get(folder.id)!
    const parent = folder.pid === null ? undefined : nodes.get(folder.pid)
    if (parent) parent.children.push(node)
    else roots.push(node)
  })
  return roots
})
const selectedFolderName = computed(
  () => folders.value.find((folder) => folder.id === selectedFolderId.value)?.fullPath || ''
)

async function loadFolders(): Promise<void> {
  const response = await window.api.database.command('listLocalFolders')
  if (!response.success) return
  folders.value = response.data as LocalFolder[]
  if (!folders.value.some((folder) => folder.id === selectedFolderId.value)) {
    selectedFolderId.value = folders.value.find((folder) => folder.isRootPath)?.id ?? null
  }
}
async function rebuildFolders(): Promise<void> {
  const response = await window.api.database.command('rebuildLocalFolders')
  if (!response.success) return
  await loadFolders()
  eventBus.emit('scanFinished')
  success(t('localFiles.rebuildDone', { count: response.data as number }))
}
function startResize(event: PointerEvent): void {
  isResizing.value = true
  event.currentTarget instanceof HTMLElement &&
    event.currentTarget.setPointerCapture(event.pointerId)
}
function resize(event: PointerEvent): void {
  if (!isResizing.value) return
  const left = sectionRef.value?.getBoundingClientRect().left ?? 0
  sidebarWidth.value = Math.min(520, Math.max(180, event.clientX - left))
}
function endResize(): void {
  if (!isResizing.value) return
  isResizing.value = false
  listRefreshKey.value++
  localStorage.setItem('easy-player:local-sidebar-width', String(sidebarWidth.value))
}

onMounted(() => {
  void loadFolders()
  eventBus.on('scanFinished', loadFolders)
})
onBeforeUnmount(() => eventBus.off('scanFinished', loadFolders))
</script>

<template>
  <section ref="sectionRef" class="flex h-full min-h-0 text-text">
    <aside
      class="custom-scrollbar shrink-0 overflow-y-auto p-3"
      :style="{ width: `${sidebarWidth}px` }"
    >
      <div class="mb-3 flex items-center justify-between gap-2 px-1">
        <h1 class="text-lg font-bold">{{ t('localFiles.title') }}</h1>
        <button
          class="btn-hover grid size-7 place-items-center rounded-md"
          :title="t('localFiles.rebuild')"
          @click="rebuildFolders"
        >
          <SvgIcon name="common-update" class-name="size-4" />
        </button>
      </div>
      <p v-if="!tree.length" class="px-1 text-sm text-text-l">
        {{ t('localFiles.empty') }}
      </p>
      <FolderTree
        v-else
        :nodes="tree"
        :selected-id="selectedFolderId"
        @select="selectedFolderId = $event"
      />
      <div class="h-20" />
    </aside>
    <div
      class="local-resizer"
      :class="isResizing && 'is-resizing'"
      @pointerdown="startResize"
      @pointermove="resize"
      @pointerup="endResize"
      @pointercancel="endResize"
    />
    <main class="min-w-0 flex-1 h-full flex flex-col">
      <div
        v-if="selectedFolderName"
        class="border-b border-border px-5 py-2 text-xs text-text-l truncate flex-shrink-0"
      >
        {{ selectedFolderName }}
      </div>
      <SongListView
        v-if="selectedFolderId"
        :key="`${selectedFolderId}-${listRefreshKey}`"
        v-memo="[selectedFolderId, listRefreshKey]"
        :source="{ type: 'folder', id: selectedFolderId }"
        class="flex-1 min-h-0"
      />
      <p v-else class="p-6 text-sm text-text-l">{{ t('localFiles.empty') }}</p>
    </main>
  </section>
</template>

<style scoped>
.local-resizer {
  position: relative;
  z-index: 2;
  width: 1px;
  flex: none;
  cursor: col-resize;
  background: var(--color-border);
}
.local-resizer::after {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -4px;
  width: 9px;
  content: '';
}
.local-resizer:hover,
.local-resizer.is-resizing {
  background: var(--color-primary);
}
</style>
