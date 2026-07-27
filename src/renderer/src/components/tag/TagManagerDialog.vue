<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Draggable from 'vuedraggable'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import eventBus from '@/utils/eventBus'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import { presetColors } from '@/consts/color'
import BaseColorPicker from '@/components/ui/BaseColorPicker.vue'
import { useMessage } from '@/components/ui/useMessage'

interface Tag {
  id: number
  name: string
  color: string | null
  description: string | null
  tagOrder: number | null
}

const props = defineProps<{ modelValue: boolean; selectedIds: number[] }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'update:selectedIds': [value: number[]]
}>()
const { t } = useI18n()
const { warning, error: showError } = useMessage()
const tags = ref<Tag[]>([])
const loading = ref(false)
const name = ref('')
const color = ref('#7c3aed')
const tagPendingDelete = ref<Tag | null>(null)

const selected = computed(() => new Set(props.selectedIds))
function hasDuplicateName(value: string, excludeId?: number): boolean {
  const normalized = value.trim().toLocaleLowerCase()
  return tags.value.some(
    (tag) => tag.id !== excludeId && tag.name.trim().toLocaleLowerCase() === normalized
  )
}
async function load(): Promise<void> {
  loading.value = true
  try {
    const result = await window.api.database.command('listTags')
    if (result.success) tags.value = result.data as Tag[]
  } finally {
    loading.value = false
  }
}
async function create(): Promise<void> {
  const value = name.value.trim()
  if (!value) return
  if (hasDuplicateName(value)) {
    warning(t('tags.duplicateName'))
    return
  }
  const result = await window.api.database.command('createTag', { name: value, color: color.value })
  if (result.success) {
    name.value = ''
    await load()
    eventBus.emit('tagsChanged')
  } else {
    showError(result.error || t('tags.duplicateName'))
  }
}
async function update(tag: Tag): Promise<void> {
  const value = tag.name.trim()
  if (!value) {
    await load()
    return
  }
  if (hasDuplicateName(value, tag.id)) {
    warning(t('tags.duplicateName'))
    await load()
    return
  }
  const result = await window.api.database.command('updateTag', {
    id: tag.id,
    input: { name: value, color: tag.color }
  })
  if (result.success) eventBus.emit('tagsChanged')
  else {
    showError(result.error || t('tags.duplicateName'))
    await load()
  }
}
async function confirmRemove(): Promise<void> {
  const tag = tagPendingDelete.value
  if (!tag) return
  const result = await window.api.database.command('deleteTag', { id: tag.id })
  if (result.success) {
    emit(
      'update:selectedIds',
      props.selectedIds.filter((id) => id !== tag.id)
    )
    await load()
    eventBus.emit('tagsChanged')
  }
  tagPendingDelete.value = null
}
function toggleFilter(id: number): void {
  const next = new Set(props.selectedIds)
  next.has(id) ? next.delete(id) : next.add(id)
  emit('update:selectedIds', [...next])
}
async function persistOrder(): Promise<void> {
  const result = await window.api.database.command('reorderTags', {
    ids: tags.value.map((tag) => tag.id)
  })
  if (result.success) eventBus.emit('tagsChanged')
}
watch(
  () => props.modelValue,
  (open) => open && void load(),
  { immediate: true }
)
</script>

<template>
  <BaseDialog
    :model-value="modelValue"
    :title="t('tags.title')"
    :close-on-overlay="false"
    width="max-w-xl"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <p class="mb-4 text-sm text-text-l">{{ t('tags.filterHint') }}</p>
    <div class="mb-4 flex gap-2">
      <input
        v-model="name"
        class="input-base min-w-0 flex-1"
        :placeholder="t('tags.namePlaceholder')"
        @keyup.enter="create"
      />
      <BaseColorPicker v-model="color" :presets="presetColors" class="shrink-0" />
      <button class="btn-hover-base rounded-lg bg-primary px-3 text-sm text-white" @click="create">
        {{ t('tags.create') }}
      </button>
    </div>
    <p v-if="loading" class="py-8 text-center text-sm text-text-l">
      {{ t('tags.loading') }}
    </p>
    <p v-else-if="!tags.length" class="py-8 text-center text-sm text-text-l">
      {{ t('tags.empty') }}
    </p>
    <div v-else class="custom-scrollbar max-h-[50vh] overflow-y-auto pr-1">
      <Draggable
        v-model="tags"
        item-key="id"
        handle=".tag-drag-handle"
        :animation="150"
        class="space-y-2"
        @end="persistOrder"
      >
        <template #item="{ element: tag }">
          <li
            class="flex items-center gap-2 rounded-xl border p-2 transition-colors"
            :class="
              selected.has(tag.id) ? 'border-primary bg-primary/10 shadow-sm' : 'border-border'
            "
          >
            <button
              class="tag-drag-handle btn-hover cursor-grab px-1 text-text-l active:cursor-grabbing"
              :aria-label="t('tags.dragSort')"
            >
              ⋮⋮
            </button>
            <button
              class="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs text-white ring-2 ring-transparent"
              :class="selected.has(tag.id) ? 'ring-primary ring-offset-2 ring-offset-bg' : ''"
              :style="{ backgroundColor: tag.color || '#7c3aed' }"
              :title="t('tags.toggleFilter')"
              @click="toggleFilter(tag.id)"
            >
              <svg-icon v-if="selected.has(tag.id)" name="common-select" class-name="size-3" />
            </button>
            <input
              v-model="tag.name"
              class="input-base h-8 min-w-0 flex-1"
              :aria-label="t('tags.name')"
              @change="update(tag)"
            />
            <BaseColorPicker
              v-model="tag.color"
              :presets="presetColors"
              teleport
              class="shrink-0"
              @change="update(tag)"
            />
            <button
              class="btn-hover px-1 text-sm text-red-400"
              :aria-label="t('tags.delete')"
              @click="tagPendingDelete = tag"
            >
              <svg-icon name="common-close" class-name="size-3" />
            </button>
          </li>
        </template>
      </Draggable>
    </div>
    <template #footer>
      <button
        class="btn-hover rounded-lg px-3 py-1.5 text-sm"
        @click="emit('update:selectedIds', [])"
      >
        {{ t('tags.clearFilter') }}
      </button>
      <button
        class="btn-hover rounded-lg px-3 py-1.5 text-sm"
        @click="emit('update:modelValue', false)"
      >
        {{ t('common.close') }}
      </button>
    </template>
  </BaseDialog>
  <BaseDialog
    :model-value="Boolean(tagPendingDelete)"
    :title="t('tags.delete')"
    width="max-w-sm"
    @update:model-value="!$event && (tagPendingDelete = null)"
  >
    <p class="text-sm text-text-l">
      {{ t('tags.confirmDelete', { name: tagPendingDelete?.name ?? '' }) }}
    </p>
    <template #footer>
      <button class="btn-hover rounded-lg px-3 py-1.5 text-sm" @click="tagPendingDelete = null">
        {{ t('tags.cancel') }}
      </button>
      <button
        class="btn-hover-base rounded-lg bg-red-500 px-3 py-1.5 text-sm text-white"
        @click="confirmRemove"
      >
        {{ t('tags.delete') }}
      </button>
    </template>
  </BaseDialog>
</template>
