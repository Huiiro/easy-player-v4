<script setup lang="ts">
import { computed, ref } from 'vue'
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
  depth?: number
}>()

const emit = defineEmits<{ select: [id: number] }>()
const { t } = useI18n()
const expanded = ref<Set<number>>(new Set(props.nodes.map((node) => node.id)))
const level = computed(() => props.depth ?? 0)

function toggle(id: number): void {
  const next = new Set(expanded.value)
  next.has(id) ? next.delete(id) : next.add(id)
  expanded.value = next
}
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
      >
        <button
          class="grid size-6 shrink-0 place-items-center"
          :class="node.children.length ? '' : 'invisible'"
          :aria-label="expanded.has(node.id) ? t('localFiles.collapse') : t('localFiles.expand')"
          @click.stop="toggle(node.id)"
        >
          <SvgIcon
            name="arrow-arrow-right-light"
            class-name="size-3"
            :class="expanded.has(node.id) ? 'rotate-90' : ''"
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
        v-if="node.children.length && expanded.has(node.id)"
        :nodes="node.children"
        :selected-id="selectedId"
        :depth="level + 1"
        @select="emit('select', $event)"
      />
    </li>
  </ul>
</template>
