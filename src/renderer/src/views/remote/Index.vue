<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import { useMessage } from '@/components/ui/useMessage'

interface MusicSource {
  id: number
  name: string
  type: string | null
  baseUrl: string | null
  user: string | null
  secret: string | null
  status: string | null
  importedCount: number
  songCount: number
  lastConnect: string | null
  sourceOrder: number
  server: string | null
  authType: string | null
}

const { success, error } = useMessage()
const { t } = useI18n()
const sources = ref<MusicSource[]>([])
const dialogOpen = ref(false)
const deleteTarget = ref<MusicSource | null>(null)
const editing = ref<MusicSource | null>(null)
const testing = ref(false)
const syncingSourceId = ref<number | null>(null)
const providerFilter = ref('all')
const draggedSourceId = ref<number | null>(null)
const providerOptions = [
  { label: t('remote.all'), value: 'all' },
  { label: 'Navidrome', value: 'navidrome' }
]
const formProviderOptions = [{ label: 'Navidrome', value: 'navidrome' }]
const form = ref({ provider: 'navidrome', name: '', baseUrl: '', user: '', secret: '' })
const filteredSources = computed(() =>
  providerFilter.value === 'all'
    ? sources.value
    : sources.value.filter((source) => source.type === providerFilter.value)
)

async function load(): Promise<void> {
  const sourceResult = await window.api.database.command('listSources')
  if (sourceResult.success) sources.value = sourceResult.data as MusicSource[]
}
async function refreshSources(): Promise<void> {
  await load()
  success(t('remote.refreshed'))
}
function openCreate(): void {
  editing.value = null
  form.value = { provider: 'navidrome', name: '', baseUrl: '', user: '', secret: '' }
  dialogOpen.value = true
}
function openEdit(source: MusicSource): void {
  editing.value = source
  form.value = {
    provider: source.type || 'navidrome',
    name: source.name,
    baseUrl: source.baseUrl || '',
    user: source.user || '',
    secret: source.secret || ''
  }
  dialogOpen.value = true
}
async function saveSource(): Promise<void> {
  const payload = {
    name: form.value.name.trim(),
    type: form.value.provider,
    baseUrl: form.value.baseUrl.trim(),
    user: form.value.user.trim(),
    secret: form.value.secret
  }
  if (!payload.name || !payload.baseUrl || !payload.user || !payload.secret) {
    error(t('remote.connectionRequired'))
    return
  }
  const response = editing.value
    ? await window.api.database.command('updateSource', { ...editing.value, ...payload })
    : await window.api.database.command('createSource', payload)
  if (!response.success) {
    error(response.error || t('remote.saveFailed'))
    return
  }
  dialogOpen.value = false
  await load()
  success(t('remote.saved'))
}
async function test(source: MusicSource | null = editing.value): Promise<void> {
  const config = source
    ? { baseUrl: source.baseUrl || '', user: source.user || '', secret: source.secret || '' }
    : form.value
  testing.value = true
  try {
    const response = await window.api.remoteSource.testNavidrome(config)
    if (!response.success) {
      error(response.error || t('remote.connectionFailed'))
      return
    }
    success(
      response.data?.version
        ? t('remote.connectionSucceededWithVersion', { version: response.data.version })
        : t('remote.connectionSucceeded')
    )
  } finally {
    testing.value = false
  }
}
async function sync(source: MusicSource): Promise<void> {
  syncingSourceId.value = source.id
  try {
    const response = await window.api.remoteSource.sync(source.id)
    if (!response.success) {
      error(response.error || t('remote.syncFailed'))
      return
    }
    await load()
    success(t('remote.syncSucceeded', { count: response.data?.imported || 0 }))
  } finally {
    syncingSourceId.value = null
  }
}
async function remove(): Promise<void> {
  if (!deleteTarget.value) return
  const response = await window.api.database.command('deleteSource', { id: deleteTarget.value.id })
  if (!response.success) {
    error(response.error || t('remote.deleteFailed'))
    return
  }
  deleteTarget.value = null
  await load()
  success(t('remote.deleted'))
}
async function dropSource(targetId: number): Promise<void> {
  const sourceId = draggedSourceId.value
  draggedSourceId.value = null
  if (!sourceId || sourceId === targetId) return
  const sourceIndex = sources.value.findIndex((item) => item.id === sourceId)
  const targetIndex = sources.value.findIndex((item) => item.id === targetId)
  if (sourceIndex < 0 || targetIndex < 0) return
  const [moved] = sources.value.splice(sourceIndex, 1)
  sources.value.splice(targetIndex, 0, moved)
  const response = await window.api.database.command('reorderSources', {
    items: sources.value.map((item, sourceOrder) => ({ id: item.id, sourceOrder }))
  })
  if (!response.success) {
    error(response.error || t('remote.reorderFailed'))
    await load()
  }
}
onMounted(() => void load())
</script>

<template>
  <section class="custom-scrollbar h-full overflow-y-auto p-7 text-text">
    <header class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold">{{ t('remote.title') }}</h1>
        <p class="mt-1 text-sm text-text-l">{{ t('remote.supported') }}</p>
      </div>
      <div class="flex items-center gap-4">
        <label class="text-sm text-text-l">{{ t('remote.provider') }}</label>
        <BaseSelect v-model="providerFilter" :options="providerOptions" class="w-36" />
        <button
          class="btn-hover grid size-8 place-items-center"
          :aria-label="t('remote.refresh')"
          :title="t('remote.refresh')"
          @click="refreshSources"
        >
          <SvgIcon name="common-refresh" class-name="size-4" />
          <span class="sr-only">{{ t('remote.refresh') }}</span>
        </button>
        <button
          class="btn-hover-base flex items-center rounded-lg bg-primary px-3 py-2 text-sm text-white"
          @click="openCreate"
        >
          <SvgIcon name="common-plus" class-name="mr-1 size-4" />
          {{ t('remote.add') }}
        </button>
      </div>
    </header>

    <div
      v-if="!sources.length"
      class="rounded-xl border border-dashed border-border p-10 text-center text-sm text-text-l"
    >
      {{ t('remote.empty') }}
    </div>
    <div v-else class="space-y-3">
      <article
        v-for="source in filteredSources"
        :key="source.id"
        draggable="true"
        class="rounded-xl border border-border p-4"
        @dragstart="draggedSourceId = source.id"
        @dragover.prevent
        @drop.prevent="dropSource(source.id)"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h2 class="font-semibold">{{ source.name }}</h2>
              <span class="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">
                {{ source.type }}
              </span>
            </div>
            <p class="mt-1 truncate text-sm text-text-l">{{ source.baseUrl }}</p>
            <p class="mt-2 text-xs text-text-l">
              {{
                t('remote.sourceStats', {
                  songs: source.songCount || 0,
                  imported: source.importedCount || 0,
                  lastConnect: source.lastConnect || '—'
                })
              }}
            </p>
          </div>
          <div class="flex gap-2">
            <button
              class="btn-hover flex items-center gap-1 px-2 py-1 text-sm"
              @click="openEdit(source)"
            >
              <svg-icon name="common-edit" class-name="w-[12px] h-[12px]" />
              {{ t('remote.edit') }}
            </button>
            <button
              class="btn-hover flex items-center gap-1 px-2 py-1 text-sm"
              :disabled="testing"
              @click="test(source)"
            >
              <svg-icon name="common-connect" class-name="w-[12px] h-[12px]" />
              {{ t('remote.testConnection') }}
            </button>
            <button
              class="btn-hover flex items-center gap-1 px-2 py-1 text-sm"
              :disabled="syncingSourceId === source.id"
              @click="sync(source)"
            >
              <svg-icon name="common-refresh" class-name="w-[12px] h-[12px]" />
              {{ syncingSourceId === source.id ? t('remote.syncing') : t('remote.sync') }}
            </button>
            <button
              class="btn-hover flex items-center gap-1 px-2 py-1 text-sm text-red-400"
              @click="deleteTarget = source"
            >
              <svg-icon name="common-delete" class-name="w-[12px] h-[12px]" />
              {{ t('remote.delete') }}
            </button>
          </div>
        </div>
      </article>
    </div>
  </section>
  <BaseDialog
    v-model="dialogOpen"
    :title="editing ? t('remote.edit') : t('remote.add')"
    width="max-w-md"
  >
    <div class="space-y-3">
      <label class="block text-sm">
        {{ t('remote.provider') }}
        <BaseSelect
          v-model="form.provider"
          :options="formProviderOptions"
          :disabled="Boolean(editing)"
          class="mt-1 w-full"
        />
      </label>
      <label class="block text-sm">
        {{ t('remote.name') }}<input v-model="form.name" class="input-base mt-1 h-9 w-full" />
      </label>
      <label class="block text-sm">
        {{ t('remote.serverUrl') }}
        <input
          v-model="form.baseUrl"
          class="input-base mt-1 h-9 w-full"
          placeholder="https://music.example.com"
        />
      </label>
      <label class="block text-sm">
        {{ t('remote.username') }}
        <input v-model="form.user" class="input-base mt-1 h-9 w-full" />
      </label>
      <label class="block text-sm">
        {{ t('remote.password') }}
        <input v-model="form.secret" class="input-base mt-1 h-9 w-full" type="password" />
      </label>
    </div>
    <template #footer>
      <button class="btn-hover px-3 py-1.5 text-sm" @click="dialogOpen = false">
        {{ t('common.cancel') }}
      </button>
      <button class="btn-hover px-3 py-1.5 text-sm" :disabled="testing" @click="test()">
        {{ t('remote.testConnection') }}
      </button>
      <button
        class="btn-hover-base rounded-lg bg-primary px-3 py-1.5 text-sm text-white"
        @click="saveSource"
      >
        {{ t('common.save') }}
      </button>
    </template>
  </BaseDialog>
  <BaseDialog
    :model-value="Boolean(deleteTarget)"
    :title="t('remote.delete')"
    width="max-w-sm"
    @update:model-value="!$event && (deleteTarget = null)"
  >
    <p class="text-sm text-text-l">
      {{ t('remote.confirmDelete', { name: deleteTarget?.name || '' }) }}
    </p>
    <template #footer>
      <button class="btn-hover px-3 py-1.5 text-sm" @click="deleteTarget = null">
        {{ t('common.cancel') }}
      </button>
      <button
        class="btn-hover-base rounded-lg bg-red-500 px-3 py-1.5 text-sm text-white"
        @click="remove"
      >
        {{ t('remote.delete') }}
      </button>
    </template>
  </BaseDialog>
</template>
