<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import FolderTree, { type FolderTreeNode } from '@/components/local/FolderTree.vue'
import SongListView from '@/components/songlist/SongListView.vue'
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
const folders = ref<LocalFolder[]>([])
const selectedFolderId = ref<number | null>(null)
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

onMounted(() => {
  void loadFolders()
  eventBus.on('scanFinished', loadFolders)
})
onBeforeUnmount(() => eventBus.off('scanFinished', loadFolders))
</script>

<template>
  <section class="flex h-full min-h-0 text-text">
    <aside class="custom-scrollbar w-64 shrink-0 overflow-y-auto border-r border-border p-3">
      <h1 class="mb-3 px-1 text-lg font-bold">{{ t('localFiles.title') }}</h1>
      <p v-if="!tree.length" class="px-1 text-sm text-text-l">
        {{ t('localFiles.empty') }}
      </p>
      <FolderTree
        v-else
        :nodes="tree"
        :selected-id="selectedFolderId"
        @select="selectedFolderId = $event"
      />
    </aside>
    <main class="min-w-0 flex-1 h-full flex flex-col">
      <div
        v-if="selectedFolderName"
        class="border-b border-border px-5 py-2 text-xs text-text-l truncate flex-shrink-0"
      >
        {{ selectedFolderName }}
      </div>
      <SongListView
        v-if="selectedFolderId"
        :key="selectedFolderId"
        :source="{ type: 'folder', id: selectedFolderId }"
        class="flex-1 min-h-0"
      />
      <p v-else class="p-6 text-sm text-text-l">{{ t('localFiles.empty') }}</p>
    </main>
  </section>
</template>
