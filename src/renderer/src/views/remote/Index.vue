<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import { useMessage } from '@/components/ui/useMessage'
import eventBus from '@/utils/eventBus'

import type { MusicSource, MusicSourceInput } from '../../../../shared/remoteSources'
import {
  REMOTE_PROTOCOLS,
  remoteConnectionIssue,
  emptyRemoteAuth,
  remoteProtocol,
  normalizeRemoteConnection
} from '../../../../shared/remoteSources'
import type { RemoteProviderId, RemoteAuthType } from '../../../../shared/remoteSources'

const { success, error } = useMessage()
const { t } = useI18n()
const sources = ref<MusicSource[]>([])
const dialogOpen = ref(false)
const deleteTarget = ref<MusicSource | null>(null)
const editing = ref<MusicSource | null>(null)
const testing = ref(false)
const saving = ref(false)
const syncingSourceId = ref<number | null>(null)
const providerFilter = ref('all')
const draggedSourceId = ref<number | null>(null)
const formProviderOptions = REMOTE_PROTOCOLS.map(({ id, label }) => ({ label, value: id }))
const providerOptions = [{ label: t('remote.all'), value: 'all' }, ...formProviderOptions]
const newForm = (): MusicSourceInput => ({
  type: 'navidrome',
  name: '',
  baseUrl: '',
  auth: emptyRemoteAuth('password'),
  hostKey: ''
})
const form = ref(newForm())
const protocol = computed(() => (remoteProtocol(form.value.type) || remoteProtocol('webdav'))!)
const authOptions = computed(() =>
  protocol.value.authTypes.map((type) => ({ value: type, label: t(`remote.authModes.${type}`) }))
)
const authType = computed({
  get: () => form.value.auth.type,
  set: (type: RemoteAuthType) => {
    form.value.auth = emptyRemoteAuth(type)
  }
})
watch(
  () => form.value.type,
  () => {
    if (!protocol.value.authTypes.includes(form.value.auth.type))
      form.value.auth = emptyRemoteAuth(protocol.value.authTypes[0])
    if (form.value.type !== 'sftp') form.value.hostKey = ''
  }
)
const filteredSources = computed(() =>
  providerFilter.value === 'all'
    ? sources.value
    : sources.value.filter((source) => source.type === providerFilter.value)
)

async function load(): Promise<boolean> {
  const sourceResult = await window.api.database.command('listSources')
  if (!sourceResult.success) {
    error(sourceResult.error || t('remote.loadFailed'))
    return false
  }
  sources.value = sourceResult.data as MusicSource[]
  return true
}
async function refreshSources(): Promise<void> {
  if (await load()) {
    eventBus.emit('musicSourcesChanged')
    success(t('remote.refreshed'))
  }
}
function openCreate(): void {
  editing.value = null
  form.value = newForm()
  dialogOpen.value = true
}
function openEdit(source: MusicSource): void {
  editing.value = source
  try {
    form.value = { ...normalizeRemoteConnection(source), name: source.name }
  } catch {
    const type: RemoteProviderId = remoteProtocol(source.type) ? source.type : 'webdav'
    form.value = {
      type,
      name: source.name,
      baseUrl: source.baseUrl || '',
      auth:
        source.auth && remoteProtocol(type)?.authTypes.includes(source.auth.type)
          ? { ...source.auth }
          : emptyRemoteAuth(remoteProtocol(type)?.authTypes[0] || 'password'),
      hostKey: source.hostKey || ''
    }
  }
  dialogOpen.value = true
}
function validateConnection(config: unknown): boolean {
  const issue = remoteConnectionIssue(config)
  if (!issue) return true
  const fields: Partial<Record<NonNullable<ReturnType<typeof remoteConnectionIssue>>, string>> = {
    'address-required': 'remote.serverUrl',
    username: 'remote.username',
    password: 'remote.password',
    token: 'remote.token',
    'private-key': 'remote.privateKey',
    'host-key-required': 'remote.hostKey'
  }
  const field = fields[issue]
  error(
    field
      ? t('remote.requiredField', { field: t(field) })
      : t(
          issue === 'address'
            ? 'remote.invalidAddress'
            : issue === 'host-key'
              ? 'remote.invalidHostKey'
              : issue === 'auth'
                ? 'remote.invalidAuthentication'
                : 'remote.invalidConfiguration'
        )
  )
  return false
}
function sourceError(cause: unknown, fallback: string): string {
  const message =
    cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : fallback
  if (/UNIQUE constraint failed: music_source\.name/i.test(message)) return t('remote.nameExists')
  if (/(?:UNIQUE|PRIMARY KEY) constraint failed: music_source\.id/i.test(message))
    return t('remote.idConflict')
  return message || fallback
}
async function saveSource(): Promise<void> {
  if (saving.value) return
  if (!form.value.name.trim()) {
    error(t('remote.requiredField', { field: t('remote.name') }))
    return
  }
  if (!validateConnection(form.value)) return
  saving.value = true
  try {
    // Project auth variants to primitive fields before crossing the preload bridge.
    const payload = { ...normalizeRemoteConnection(form.value), name: form.value.name.trim() }
    const response = editing.value
      ? await window.api.database.command('updateSource', { ...editing.value, ...payload })
      : await window.api.database.command('createSource', payload)
    if (!response.success) {
      error(sourceError(response.error, t('remote.saveFailed')))
      return
    }
    if (response.data === false) {
      error(t('remote.sourceNotFound'))
      return
    }
    dialogOpen.value = false
    eventBus.emit('musicSourcesChanged')
    await load()
    success(t('remote.saved'))
  } catch (cause) {
    error(sourceError(cause, t('remote.saveFailed')))
  } finally {
    saving.value = false
  }
}
async function test(source: MusicSource | null = null): Promise<void> {
  if (source?.credentialError) {
    error(
      t(
        source.credentialError === 'invalid-config'
          ? 'remote.invalidConfiguration'
          : source.credentialError === 'unavailable'
            ? 'remote.credentialsUnavailable'
            : 'remote.credentialsNeedPassword'
      )
    )
    return
  }
  const config = source
    ? { type: source.type, baseUrl: source.baseUrl, auth: source.auth, hostKey: source.hostKey }
    : form.value
  if (testing.value || !validateConnection(config)) return
  testing.value = true
  try {
    const response = await window.api.remoteSource.test(normalizeRemoteConnection(config))
    if (!response.success) {
      error(sourceError(response.error, t('remote.connectionFailed')))
      return
    }
    success(
      response.data?.version
        ? t('remote.connectionSucceededWithVersion', { version: response.data.version })
        : t('remote.connectionSucceeded')
    )
  } catch (cause) {
    error(sourceError(cause, t('remote.connectionFailed')))
  } finally {
    testing.value = false
  }
}
async function sync(source: MusicSource): Promise<void> {
  if (source.credentialError) {
    error(
      t(
        source.credentialError === 'invalid-config'
          ? 'remote.invalidConfiguration'
          : source.credentialError === 'unavailable'
            ? 'remote.credentialsUnavailable'
            : 'remote.credentialsNeedPassword'
      )
    )
    return
  }
  syncingSourceId.value = source.id
  try {
    const response = await window.api.remoteSource.sync(source.id)
    if (!response.success) {
      error(response.error || t('remote.syncFailed'))
      return
    }
    eventBus.emit('musicSourcesChanged')
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
  eventBus.emit('musicSourcesChanged')
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
  } else {
    eventBus.emit('musicSourcesChanged')
  }
}
onMounted(() => void load())
</script>

<template>
  <section class="custom-scrollbar h-full overflow-y-auto p-7 text-text">
    <header class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-bold">{{ t('remote.title') }}</h1>
        <p class="mt-1 text-sm text-text-l">{{ t('remote.supported') }}</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <label class="text-xs text-text-l">{{ t('remote.provider') }}</label>
        <BaseSelect
          v-model="providerFilter"
          :options="providerOptions"
          :aria-label="t('remote.provider')"
          size="sm"
          class="w-48"
        />
        <BaseButton size="sm" @click="openCreate">
          <template #left>
            <SvgIcon name="common-plus" class-name="size-4" />
          </template>
          {{ t('remote.add') }}
        </BaseButton>
        <BaseButton
          class="ep-header-button"
          variant="ghost"
          size="sm"
          icon-only
          :aria-label="t('remote.refresh')"
          :title="t('remote.refresh')"
          @click="refreshSources"
        >
          <SvgIcon name="common-refresh" class-name="size-4" />
          <span class="sr-only">{{ t('remote.refresh') }}</span>
        </BaseButton>
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
        class="remote-source-card rounded-xl border border-border p-4"
        :class="{ 'remote-source-card--dragging': draggedSourceId === source.id }"
        @dragstart="draggedSourceId = source.id"
        @dragend="draggedSourceId = null"
        @dragover.prevent
        @drop.prevent="dropSource(source.id)"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h2 class="font-semibold">{{ source.name }}</h2>
              <span class="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">
                {{
                  formProviderOptions.find((item) => item.value === source.type)?.label ||
                  source.type
                }}
              </span>
            </div>
            <p class="mt-1 truncate text-sm text-text-l">{{ source.baseUrl }}</p>
            <p v-if="source.credentialError" class="mt-2 text-sm text-warning" role="status">
              {{
                t(
                  source.credentialError === 'invalid-config'
                    ? 'remote.invalidConfiguration'
                    : source.credentialError === 'unavailable'
                      ? 'remote.credentialsUnavailable'
                      : 'remote.credentialsNeedPassword'
                )
              }}
            </p>
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
              :disabled="testing || Boolean(source.credentialError)"
              @click="test(source)"
            >
              <svg-icon name="common-connect" class-name="w-[12px] h-[12px]" />
              {{ t('remote.testConnection') }}
            </button>
            <button
              class="btn-hover flex items-center gap-1 px-2 py-1 text-sm"
              :disabled="syncingSourceId === source.id || Boolean(source.credentialError)"
              @click="sync(source)"
            >
              <svg-icon name="common-refresh" class-name="w-[12px] h-[12px]" />
              {{ syncingSourceId === source.id ? t('remote.syncing') : t('remote.sync') }}
            </button>
            <button
              class="btn-hover flex items-center gap-1 px-2 py-1 text-sm text-danger"
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
    :close-on-overlay="false"
    width="max-w-md"
  >
    <div class="space-y-3">
      <label class="block text-sm">
        {{ t('remote.provider') }}
        <BaseSelect
          v-model="form.type"
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
          :placeholder="protocol.placeholder"
        />
      </label>
      <p v-if="form.type === 'smb'" class="text-sm text-text-l">{{ t('remote.smbHint') }}</p>
      <p v-if="form.type === 'webdav'" class="text-sm text-text-l">
        {{ t('remote.webdavHint') }}
      </p>
      <label class="block text-sm">
        {{ t('remote.authentication') }}
        <BaseSelect v-model="authType" :options="authOptions" class="mt-1 w-full" />
      </label>
      <label v-if="'username' in form.auth" class="block text-sm">
        {{ t('remote.username') }}
        <input v-model="form.auth.username" class="input-base mt-1 h-9 w-full" autocomplete="off" />
      </label>
      <label v-if="'password' in form.auth" class="block text-sm">
        {{ t('remote.password') }}
        <input
          v-model="form.auth.password"
          class="input-base mt-1 h-9 w-full"
          type="password"
          autocomplete="new-password"
        />
      </label>
      <label v-if="'token' in form.auth" class="block text-sm">
        {{ t('remote.token') }}
        <input
          v-model="form.auth.token"
          class="input-base mt-1 h-9 w-full"
          type="password"
          autocomplete="new-password"
        />
      </label>
      <template v-if="form.auth.type === 'private-key'">
        <label class="block text-sm">
          {{ t('remote.privateKey') }}
          <textarea
            v-model="form.auth.privateKey"
            class="input-base mt-1 min-h-28 w-full font-mono text-xs"
            spellcheck="false"
          />
        </label>
        <label class="block text-sm">
          {{ t('remote.passphrase') }}
          <input
            v-model="form.auth.passphrase"
            class="input-base mt-1 h-9 w-full"
            type="password"
            autocomplete="new-password"
          />
        </label>
      </template>
      <label v-if="form.type === 'sftp'" class="block text-sm">
        {{ t('remote.hostKey') }}
        <input
          v-model="form.hostKey"
          class="input-base mt-1 h-9 w-full font-mono text-xs"
          placeholder="SHA256:..."
        />
        <p class="mt-1 text-xs text-text-l">{{ t('remote.hostKeyHint') }}</p>
      </label>
      <p v-if="editing?.credentialError" class="text-sm text-warning" role="status">
        {{ t('remote.credentialsNeedPassword') }}
      </p>
    </div>
    <template #footer>
      <button class="btn-hover px-3 py-1.5 text-sm" @click="dialogOpen = false">
        {{ t('common.cancel') }}
      </button>
      <button class="btn-hover px-3 py-1.5 text-sm" :disabled="testing" @click="test()">
        {{ t('remote.testConnection') }}
      </button>
      <button
        class="btn-hover-base rounded-lg ep-button--primary px-3 py-1.5 text-sm"
        :disabled="saving"
        :aria-busy="saving"
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
        class="btn-hover-base rounded-lg ep-button--danger px-3 py-1.5 text-sm"
        @click="remove"
      >
        {{ t('remote.delete') }}
      </button>
    </template>
  </BaseDialog>
</template>

<style scoped>
.remote-source-card {
  --remote-source-card-lift: -3px;
  transition:
    transform var(--motion-duration-standard) var(--motion-ease-standard),
    box-shadow var(--motion-duration-standard) var(--motion-ease-standard),
    border-color var(--motion-duration-standard) var(--motion-ease-standard);
}
@media (hover: hover) {
  .remote-source-card:not(.remote-source-card--dragging):hover {
    transform: translateY(var(--remote-source-card-lift));
    border-color: color-mix(in srgb, var(--color-primary) 30%, var(--color-border));
    box-shadow: 0 8px 20px rgb(0 0 0 / 10%);
  }
}
:global(.reduce-motion) .remote-source-card {
  --remote-source-card-lift: 0px;
  transition: none;
}
@media (prefers-reduced-motion: reduce) {
  .remote-source-card {
    --remote-source-card-lift: 0px;
    transition: none;
  }
}
</style>
