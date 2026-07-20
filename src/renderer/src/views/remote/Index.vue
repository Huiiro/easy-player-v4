<script setup lang="ts">
import { onMounted, ref } from 'vue'
import BaseDialog from '@/components/ui/BaseDialog.vue'
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
const sources = ref<MusicSource[]>([])
const dialogOpen = ref(false)
const deleteTarget = ref<MusicSource | null>(null)
const editing = ref<MusicSource | null>(null)
const testing = ref(false)
const syncingSourceId = ref<number | null>(null)
const cacheDirectory = ref('')
const cacheLimitGb = ref(2)
const cacheUsed = ref(0)
const form = ref({ name: '', baseUrl: '', user: '', secret: '' })

const formatBytes = (bytes: number): string =>
  bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

async function load(): Promise<void> {
  const [sourceResult, dirResult, limitResult, defaultDirectoryResult] = await Promise.all([
    window.api.database.command('listSources'),
    window.api.database.command('getSetting', { key: 'remote.cache-directory' }),
    window.api.database.command('getSetting', { key: 'remote.cache-limit-gb' }),
    window.api.remoteSource.defaultCacheDirectory()
  ])
  if (sourceResult.success) sources.value = sourceResult.data as MusicSource[]
  cacheDirectory.value =
    dirResult.success && typeof dirResult.data === 'string'
      ? dirResult.data
      : defaultDirectoryResult.data || ''
  cacheLimitGb.value =
    limitResult.success && typeof limitResult.data === 'number' ? limitResult.data : 2
  await refreshCacheSize()
}
async function refreshCacheSize(): Promise<void> {
  if (!cacheDirectory.value) {
    cacheUsed.value = 0
    return
  }
  const response = await window.api.remoteSource.cacheSize(cacheDirectory.value)
  cacheUsed.value = response.data || 0
}
function openCreate(): void {
  editing.value = null
  form.value = { name: '', baseUrl: '', user: '', secret: '' }
  dialogOpen.value = true
}
function openEdit(source: MusicSource): void {
  editing.value = source
  form.value = {
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
    type: 'navidrome',
    baseUrl: form.value.baseUrl.trim(),
    user: form.value.user.trim(),
    secret: form.value.secret
  }
  if (!payload.name || !payload.baseUrl || !payload.user || !payload.secret) {
    error('请完整填写 Navidrome 连接信息')
    return
  }
  const response = editing.value
    ? await window.api.database.command('updateSource', { ...editing.value, ...payload })
    : await window.api.database.command('createSource', payload)
  if (!response.success) {
    error(response.error || '保存音源失败')
    return
  }
  dialogOpen.value = false
  await load()
  success('音源已保存')
}
async function test(source: MusicSource | null = editing.value): Promise<void> {
  const config = source
    ? { baseUrl: source.baseUrl || '', user: source.user || '', secret: source.secret || '' }
    : form.value
  testing.value = true
  try {
    const response = await window.api.remoteSource.testNavidrome(config)
    if (!response.success) {
      error(response.error || '连接失败')
      return
    }
    success(`连接成功${response.data?.version ? `，服务器版本 ${response.data.version}` : ''}`)
  } finally {
    testing.value = false
  }
}
async function sync(source: MusicSource): Promise<void> {
  syncingSourceId.value = source.id
  try {
    const response = await window.api.remoteSource.sync(source.id)
    if (!response.success) {
      error(response.error || '同步失败')
      return
    }
    await load()
    success(`同步完成，已导入 ${response.data?.imported || 0} 首歌曲`)
  } finally {
    syncingSourceId.value = null
  }
}
async function remove(): Promise<void> {
  if (!deleteTarget.value) return
  const response = await window.api.database.command('deleteSource', { id: deleteTarget.value.id })
  if (!response.success) {
    error(response.error || '删除失败')
    return
  }
  deleteTarget.value = null
  await load()
  success('音源已删除')
}
async function chooseCacheDirectory(): Promise<void> {
  const response = await window.api.remoteSource.chooseCacheDirectory()
  if (!response.success || !response.data) return
  cacheDirectory.value = response.data
  await window.api.database.command('setSetting', {
    key: 'remote.cache-directory',
    value: cacheDirectory.value
  })
  await refreshCacheSize()
}
async function saveCacheLimit(): Promise<void> {
  cacheLimitGb.value = Math.max(0.5, Math.min(100, Number(cacheLimitGb.value) || 2))
  await window.api.database.command('setSetting', {
    key: 'remote.cache-limit-gb',
    value: cacheLimitGb.value
  })
  success('缓存设置已保存')
}
onMounted(() => void load())
</script>

<template>
  <section class="custom-scrollbar h-full overflow-y-auto p-7 text-[var(--color-text)]">
    <header class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold">远程音源</h1>
        <p class="mt-1 text-sm text-[var(--color-text-l)]">当前支持 Navidrome（Subsonic API）</p>
      </div>
      <button
        class="rounded-lg bg-[var(--color-primary)] px-3 py-2 text-sm text-white"
        @click="openCreate"
      >
        <SvgIcon name="common-plus" class-name="mr-1 size-4" />新增音源
      </button>
    </header>
    <section class="mb-6 rounded-xl border border-[var(--color-border)] p-4">
      <div class="mb-3 flex items-center justify-between">
        <div>
          <h2 class="font-semibold">本地缓存</h2>
          <p class="text-xs text-[var(--color-text-l)]">远程文件下载缓存的位置与上限。</p>
        </div>
        <span class="text-xs text-[var(--color-text-l)]">已使用 {{ formatBytes(cacheUsed) }}</span>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <input
          :value="cacheDirectory"
          readonly
          class="input-base h-8 min-w-64 flex-1"
          placeholder="默认 player_data/cache"
        /><button class="btn-hover px-2 py-1 text-sm" @click="chooseCacheDirectory">选择目录</button
        ><input
          v-model.number="cacheLimitGb"
          class="input-base h-8 w-20"
          type="number"
          min="0.5"
          max="100"
          step="0.5"
          @change="saveCacheLimit"
        /><span class="text-sm text-[var(--color-text-l)]">GB</span>
      </div>
    </section>
    <div
      v-if="!sources.length"
      class="rounded-xl border border-dashed border-[var(--color-border)] p-10 text-center text-sm text-[var(--color-text-l)]"
    >
      还没有远程音源，添加一个 Navidrome 服务器开始使用。
    </div>
    <div v-else class="space-y-3">
      <article
        v-for="source in sources"
        :key="source.id"
        class="rounded-xl border border-[var(--color-border)] p-4"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h2 class="font-semibold">{{ source.name }}</h2>
              <span
                class="rounded-full bg-[var(--color-primary)]/15 px-2 py-0.5 text-xs text-[var(--color-primary)]"
                >Navidrome</span
              >
            </div>
            <p class="mt-1 truncate text-sm text-[var(--color-text-l)]">{{ source.baseUrl }}</p>
            <p class="mt-2 text-xs text-[var(--color-text-l)]">
              歌曲 {{ source.songCount || 0 }} · 已导入 {{ source.importedCount || 0 }} · 最近连接
              {{ source.lastConnect || '—' }}
            </p>
          </div>
          <div class="flex gap-2">
            <button class="btn-hover px-2 py-1 text-sm" @click="openEdit(source)">编辑</button
            ><button class="btn-hover px-2 py-1 text-sm" :disabled="testing" @click="test(source)">
              测试连接</button
            ><button
              class="btn-hover px-2 py-1 text-sm"
              :disabled="syncingSourceId === source.id"
              @click="sync(source)"
            >
              {{ syncingSourceId === source.id ? '同步中…' : '同步曲库' }}</button
            ><button
              class="btn-hover px-2 py-1 text-sm text-red-400"
              @click="deleteTarget = source"
            >
              删除
            </button>
          </div>
        </div>
      </article>
    </div>
  </section>
  <BaseDialog
    v-model="dialogOpen"
    :title="editing ? '编辑远程音源' : '新增远程音源'"
    width="max-w-md"
    ><div class="space-y-3">
      <label class="block text-sm"
        >名称<input v-model="form.name" class="input-base mt-1 h-9 w-full" /></label
      ><label class="block text-sm"
        >服务器地址<input
          v-model="form.baseUrl"
          class="input-base mt-1 h-9 w-full"
          placeholder="https://music.example.com" /></label
      ><label class="block text-sm"
        >用户名<input v-model="form.user" class="input-base mt-1 h-9 w-full" /></label
      ><label class="block text-sm"
        >密码<input v-model="form.secret" class="input-base mt-1 h-9 w-full" type="password"
      /></label>
    </div>
    <template #footer
      ><button class="btn-hover px-3 py-1.5 text-sm" @click="dialogOpen = false">取消</button
      ><button class="btn-hover px-3 py-1.5 text-sm" :disabled="testing" @click="test()">
        测试连接</button
      ><button
        class="rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-sm text-white"
        @click="saveSource"
      >
        保存
      </button></template
    ></BaseDialog
  >
  <BaseDialog
    :model-value="Boolean(deleteTarget)"
    title="删除远程音源"
    width="max-w-sm"
    @update:model-value="!$event && (deleteTarget = null)"
    ><p class="text-sm text-[var(--color-text-l)]">
      确定删除音源“{{ deleteTarget?.name }}”吗？已导入的远程歌曲也会被移除。
    </p>
    <template #footer
      ><button class="btn-hover px-3 py-1.5 text-sm" @click="deleteTarget = null">取消</button
      ><button class="rounded-lg bg-red-500 px-3 py-1.5 text-sm text-white" @click="remove">
        删除
      </button></template
    ></BaseDialog
  >
</template>
