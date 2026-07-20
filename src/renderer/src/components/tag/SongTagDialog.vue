<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import eventBus from '@/utils/eventBus'

interface Tag {
  id: number
  name: string
  color: string | null
  isIncluded?: boolean
}
const props = defineProps<{ modelValue: boolean; songId: number | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; changed: [] }>()
const { t } = useI18n()
const tags = ref<Tag[]>([])
const loading = ref(false)
async function load(): Promise<void> {
  if (!props.songId) return
  loading.value = true
  try {
    const result = await window.api.database.command('listTags', { songId: props.songId })
    if (result.success) tags.value = result.data as Tag[]
  } finally {
    loading.value = false
  }
}
async function toggle(tag: Tag): Promise<void> {
  if (!props.songId) return
  const result = await window.api.database.command('toggleSongTag', {
    tagId: tag.id,
    songId: props.songId
  })
  if (result.success) {
    tag.isIncluded = Boolean(result.data)
    emit('changed')
    eventBus.emit('tagsChanged')
  }
}
watch(
  () => [props.modelValue, props.songId],
  ([open]) => open && void load(),
  { immediate: true }
)
</script>

<template>
  <BaseDialog
    :model-value="modelValue"
    :title="t('tags.editSong')"
    width="max-w-md"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <p v-if="loading" class="py-8 text-center text-sm text-text-l">
      {{ t('tags.loading') }}
    </p>
    <p v-else-if="!tags.length" class="py-8 text-center text-sm text-text-l">
      {{ t('tags.empty') }}
    </p>
    <div v-else class="flex flex-wrap gap-2">
      <button
        v-for="tag in tags"
        :key="tag.id"
        class="rounded-full border px-3 py-1.5 text-sm transition"
        :class="tag.isIncluded ? 'border-transparent text-white' : 'border-border'"
        :style="tag.isIncluded ? { backgroundColor: tag.color || '#7c3aed' } : undefined"
        @click="toggle(tag)"
      >
        {{ tag.isIncluded ? '✓ ' : '' }}{{ tag.name }}
      </button>
    </div>
  </BaseDialog>
</template>
