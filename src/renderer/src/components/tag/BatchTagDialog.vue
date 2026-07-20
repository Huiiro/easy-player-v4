<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import eventBus from '@/utils/eventBus'

interface Tag {
  id: number
  name: string
  color: string | null
}
const props = defineProps<{ modelValue: boolean; songIds: number[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; changed: [] }>()
const { t } = useI18n()
const tags = ref<Tag[]>([])
const selectedId = ref<number | null>(null)
async function load(): Promise<void> {
  const result = await window.api.database.command('listTags')
  if (result.success) tags.value = result.data as Tag[]
}
async function apply(included: boolean): Promise<void> {
  if (!selectedId.value || !props.songIds.length) return
  const result = await window.api.database.command('setSongTag', {
    tagId: selectedId.value,
    songIds: [...props.songIds],
    included
  })
  if (result.success) {
    emit('changed')
    eventBus.emit('tagsChanged')
    emit('update:modelValue', false)
  }
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
    :title="t('tags.batchEdit')"
    width="max-w-md"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <p class="mb-3 text-sm text-text-l">
      {{ t('tags.batchHint', { count: songIds.length }) }}
    </p>
    <div class="flex flex-wrap gap-2">
      <button
        v-for="tag in tags"
        :key="tag.id"
        class="rounded-full border px-3 py-1.5 text-sm"
        :class="selectedId === tag.id ? 'border-primary ring-1 ring-primary' : 'border-border'"
        :style="selectedId === tag.id ? { color: tag.color || '#7c3aed' } : undefined"
        @click="selectedId = tag.id"
      >
        {{ tag.name }}
      </button>
    </div>
    <template #footer>
      <button
        class="btn-hover rounded-lg px-3 py-1.5 text-sm"
        :disabled="!selectedId"
        @click="apply(false)"
      >
        {{ t('tags.remove') }}
      </button>
      <button
        class="btn-hover rounded-lg bg-primary px-3 py-1.5 text-sm text-white disabled:opacity-40"
        :disabled="!selectedId"
        @click="apply(true)"
      >
        {{ t('tags.add') }}
      </button>
    </template>
  </BaseDialog>
</template>
