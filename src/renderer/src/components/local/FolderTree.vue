<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SvgIcon from '@/components/svg/SvgIcon.vue'

export interface FolderTreeNode {
  id: number
  name: string
  songCount: number
  children: FolderTreeNode[]
}

const props = defineProps<{
  nodes: FolderTreeNode[]
  selectedId: number | null
  expandedIds: Set<number>
  depth?: number
}>()

const emit = defineEmits<{
  select: [id: number]
  toggle: [id: number]
  contextmenu: [node: FolderTreeNode, event: MouseEvent]
}>()
const { t } = useI18n()
const level = computed(() => props.depth ?? 0)
</script>

<template>
  <ul class="space-y-0.5">
    <li v-for="node in nodes" :key="node.id">
      <div
        class="group flex min-w-0 items-center rounded-md pr-2 hover:bg-hover"
        :class="
          selectedId === node.id
            ? 'bg-[color:color-mix(in_srgb,var(--color-primary)_14%,transparent)] text-primary'
            : ''
        "
        :style="{ paddingLeft: `${level * 14 + 4}px` }"
        @contextmenu.prevent="emit('contextmenu', node, $event)"
      >
        <button
          class="grid size-6 shrink-0 place-items-center"
          :class="node.children.length ? '' : 'invisible'"
          :aria-label="expandedIds.has(node.id) ? t('localFiles.collapse') : t('localFiles.expand')"
          :aria-expanded="node.children.length ? expandedIds.has(node.id) : undefined"
          @click.stop="emit('toggle', node.id)"
        >
          <SvgIcon
            name="arrow-arrow-right-light"
            class-name="size-3"
            :class="expandedIds.has(node.id) ? 'rotate-90' : ''"
          />
        </button>
        <button
          class="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-sm"
          @click="emit('select', node.id)"
        >
          <SvgIcon name="menu-folder" class-name="size-4 shrink-0" />
          <span class="truncate">{{ node.name }}</span>
          <span class="ml-auto text-xs text-text-l">{{ node.songCount }}</span>
        </button>
      </div>
      <FolderTree
        v-if="node.children.length && expandedIds.has(node.id)"
        :nodes="node.children"
        :selected-id="selectedId"
        :expanded-ids="expandedIds"
        :depth="level + 1"
        @select="emit('select', $event)"
        @toggle="emit('toggle', $event)"
        @contextmenu="(folder, event) => emit('contextmenu', folder, event)"
      />
    </li>
  </ul>
</template>
