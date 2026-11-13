<script setup lang="ts">
import {
  fingerprintFailureLabel,
  fingerprintWarningLabel
} from '../../../../shared/duplicateFingerprintErrors'
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import BasePopover from '@/components/ui/BasePopover.vue'
import { DialogTitle } from '@headlessui/vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import SettingCard from './SettingCard.vue'
import SettingRow from './SettingRow.vue'
import { useMessage } from '@/components/ui/useMessage'
import { usePlayerStore } from '@/stores/player/playerStore'
import eventBus from '@/utils/eventBus'
import type {
  DuplicateFileGroup,
  DuplicateFileProgress,
  DuplicateFileReport,
  FingerprintConcurrency,
  DuplicateTaskState
} from '../../../../shared/duplicateFiles'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const { t, locale } = useI18n()
const { success, warning, error } = useMessage()
const player = usePlayerStore()
const report = ref<DuplicateFileReport | null>(null)
const failureDetails = computed(
  () => new Map((report.value?.fingerprintFailures ?? []).map((item) => [item.path, [item]]))
)
const task = ref<DuplicateTaskState | null>(null)
const pending = ref(false)
const scanning = computed(
  () => pending.value || task.value?.status === 'running' || task.value?.settling === true
)
const resumable = computed(
  () => task.value && ['paused', 'interrupted', 'cancelled', 'failed'].includes(task.value.status)
)
const cleaning = ref(false)
const exporting = ref(false)
const deep = ref(false)
const force = ref(false)
const sampleSeconds = ref<60 | 120>(60)
const concurrency = ref<FingerprintConcurrency>(2)
const progress = ref<DuplicateFileProgress>({ phase: 'checking', current: 0, total: 0 })
// Checked IDs are cleanup candidates; the durable API stores the complementary retained IDs.
const selected = ref(new Set<number>())
const cleanupSongs = computed(
  () =>
    report.value?.groups.flatMap((group) =>
      group.files.filter((file) => selected.value.has(file.id))
    ) ?? []
)
const cleanupIds = computed(() => cleanupSongs.value.map((file) => file.id))
const detailsOpen = ref(false)
const detailsPanelId = useId()
const hasSimilarSelection = computed(() =>
  report.value?.groups.some(
    (group) => group.kind !== 'exact' && group.files.some((file) => selected.value.has(file.id))
  )
)
const confirmOpen = ref(false)
const confirmation = ref<HTMLElement | null>(null)
const deleteLocalFiles = ref(false)
const page = ref(0)
const content = ref<HTMLElement | null>(null)
watch(page, async () => {
  await nextTick()
  const body = content.value?.closest('.ep-dialog-body')
  if (body) body.scrollTop = 0
})
const pageCount = computed(() => Math.max(1, Math.ceil((report.value?.groups.length ?? 0) / 20)))
const visibleGroups = computed(
  () => report.value?.groups.slice(page.value * 20, (page.value + 1) * 20) ?? []
)
const sampleOptions = computed(() => [
  { value: 60, label: t('duplicates.sample60') },
  { value: 120, label: t('duplicates.sample120') }
])
const concurrencyOptions = computed(() =>
  [1, 2, 4].map((value) => ({ value, label: t(`duplicates.concurrency${value}`) }))
)
const scanPhases = computed(() =>
  deep.value
    ? ['checking', 'hashing', 'fingerprinting', 'indexing', 'matching']
    : ['checking', 'hashing']
)
const phaseIndex = computed(() => scanPhases.value.indexOf(progress.value.phase))
const progressPercent = computed(() =>
  progress.value.total > 0
    ? Math.min(100, Math.max(0, Math.round((progress.value.current / progress.value.total) * 100)))
    : 0
)
const summaryStats = computed(() =>
  report.value
    ? [
        { label: 'scanned', value: report.value.scanned },
        { label: 'groups', value: report.value.groups.length },
        { label: 'extraCopies', value: report.value.extraFiles },
        { label: 'extraSize', value: bytes(report.value.extraBytes) }
      ]
    : []
)
let disposed = false
let configuredTaskId: string | undefined
function applyTask(value: DuplicateTaskState | null): void {
  if (value && task.value?.id === value.id && task.value.revision > value.revision) return
  task.value = value
  if (value?.progress) progress.value = value.progress
}
async function refresh(): Promise<void> {
  try {
    const details = await window.api.library.getDuplicateTaskDetails()
    if (disposed) return
    if (
      details.task &&
      task.value?.id === details.task.id &&
      task.value.revision > details.task.revision
    )
      return
    applyTask(details.task)
    if (details.report?.id !== report.value?.id) {
      report.value = details.report
      detailsOpen.value = false
      const retained = details.retainedIds === null ? null : new Set(details.retainedIds)
      selected.value = new Set(
        retained
          ? (details.report?.groups.flatMap((group) =>
              group.files.filter((file) => !retained.has(file.id)).map((file) => file.id)
            ) ?? [])
          : []
      )
      page.value = 0
    }
    if (details.task && configuredTaskId !== details.task.id) {
      configuredTaskId = details.task.id
      deep.value = details.task.options.deep === true
      force.value = details.task.options.force === true
      sampleSeconds.value = details.task.options.sampleSeconds === 120 ? 120 : 60
      concurrency.value = details.task.options.concurrency ?? 2
    }
  } catch {
    if (!disposed) notifyFailure('failed')
  }
}
const offTask = window.api.library.onDuplicateTask((value) => {
  applyTask(value)
  if (!value) {
    report.value = null
    selected.value = new Set()
  } else if (
    value.status === 'completed' &&
    value.reportId !== report.value?.id &&
    props.modelValue
  )
    void refresh()
})
let saving = Promise.resolve()
function persistSelection(): void {
  if (!report.value) return
  const id = report.value.id
  const ids = report.value.groups.flatMap((group) =>
    group.files.filter((file) => !selected.value.has(file.id)).map((file) => file.id)
  )
  saving = saving
    .then(async () => {
      const response = await window.api.library.saveDuplicateSelection(id, ids)
      if (!response.success) notifyFailure(response.error)
    })
    .catch(() => notifyFailure('failed'))
}

function bytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MiB`
  return `${(value / 1024 ** 3).toFixed(2)} GiB`
}
function duration(value: number | null): string {
  return value == null
    ? '—'
    : `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`
}
function notifyFailure(code: string): void {
  if (code !== 'cancelled') error(t(`duplicates.errors.${code}`))
}
async function scan(): Promise<void> {
  if (scanning.value || cleaning.value) return
  pending.value = true
  confirmOpen.value = false
  await saving
  try {
    const response = await window.api.library.startDuplicateTask({
      deep: deep.value,
      sampleSeconds: sampleSeconds.value,
      concurrency: concurrency.value,
      force: force.value
    })
    if (disposed) return
    if (!response.success) {
      notifyFailure(response.error)
      return
    }
    report.value = null
    selected.value = new Set()
    applyTask(response.data)
    if (task.value?.status === 'completed') await refresh()
  } catch {
    if (!disposed) notifyFailure('failed')
  } finally {
    pending.value = false
  }
}
async function pauseScan(): Promise<void> {
  pending.value = true
  try {
    const response = await window.api.library.pauseDuplicateTask()
    if (!response.success) notifyFailure(response.error)
  } catch {
    notifyFailure('failed')
  } finally {
    pending.value = false
  }
}
async function resumeScan(): Promise<void> {
  pending.value = true
  try {
    const response = await window.api.library.resumeDuplicateTask()
    if (response.success) applyTask(response.data)
    else notifyFailure(response.error)
  } catch {
    notifyFailure('failed')
  } finally {
    pending.value = false
  }
}
async function clearCache(): Promise<void> {
  try {
    const response = await window.api.library.clearDuplicateCache()
    if (response.success) success(t('duplicates.cacheCleared'))
    else notifyFailure(response.error)
  } catch {
    notifyFailure('failed')
  }
}
async function updateOpen(open: boolean): Promise<void> {
  if (cleaning.value) return
  if (!open) await saving
  emit('update:modelValue', open)
}
function keepAndClose(): void {
  confirmOpen.value = false
  void updateOpen(false)
}
function requestCleanup(): void {
  deleteLocalFiles.value = false
  confirmOpen.value = true
  void nextTick(() => confirmation.value?.scrollIntoView({ block: 'nearest' }))
}
function toggle(group: DuplicateFileGroup, id: number): void {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else if (group.files.filter((file) => next.has(file.id)).length < group.files.length - 1)
    next.add(id)
  selected.value = next
  persistSelection()
}
function groupHasSelection(group: DuplicateFileGroup): boolean {
  return group.files.some((file) => selected.value.has(file.id))
}
function toggleGroup(group: DuplicateFileGroup): void {
  const next = new Set(selected.value)
  if (groupHasSelection(group)) {
    for (const file of group.files) next.delete(file.id)
  } else {
    // Keep one copy; group selection must obey the same rule as individual rows.
    for (const file of group.files.slice(1)) next.add(file.id)
  }
  selected.value = next
  persistSelection()
}
function resetSelection(): void {
  if (!report.value || scanning.value || cleaning.value) return
  selected.value = new Set()
  confirmOpen.value = false
  deleteLocalFiles.value = false
  persistSelection()
}
function groupEvidence(group: DuplicateFileGroup): string {
  if (group.hash) return `SHA-256: ${group.hash.slice(0, 16)}…`
  if (group.audioMatch)
    return t('duplicates.audioEvidence', {
      score: (group.audioMatch.score * 100).toFixed(1),
      coverage: (group.audioMatch.coverage * 100).toFixed(1),
      offset: group.audioMatch.offsetSeconds.toFixed(1)
    })
  return t('duplicates.similarReason', { seconds: group.durationSpread })
}
async function exportReport(): Promise<void> {
  if (!report.value) return
  exporting.value = true
  try {
    const response = await window.api.library.exportDuplicateReport(
      report.value.id,
      locale.value.startsWith('en') ? 'en' : 'zh'
    )
    if (!response.success) notifyFailure(response.error)
    else if (response.data) success(t('duplicates.exported'))
  } catch {
    notifyFailure('failed')
  } finally {
    exporting.value = false
  }
}
async function cleanup(): Promise<void> {
  if (!report.value || !cleanupIds.value.length || cleaning.value) return
  cleaning.value = true
  try {
    const response = await window.api.library.cleanDuplicateFiles({
      reportId: report.value.id,
      songIds: [...cleanupIds.value],
      deleteLocalFiles: deleteLocalFiles.value
    })
    if (!response.success) {
      notifyFailure(response.error)
      return
    }
    const removed = new Set(response.data.deletedIds)
    for (let index = player.queue.length - 1; index >= 0; index--) {
      if (removed.has(player.queue[index].id)) await player.removeQueueItem(index)
    }
    eventBus.emit('scanFinished')
    eventBus.emit('playlistsChanged')
    eventBus.emit('tagsChanged')
    success(t('duplicates.cleaned', { count: response.data.deletedIds.length }))
    if (response.data.failedFiles.length) warning(t('songList.deleteLocalFileFailed'))
    confirmOpen.value = false
    report.value = null
    selected.value = new Set()
  } catch {
    notifyFailure('failed')
  } finally {
    cleaning.value = false
  }
}
watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return
    await refresh()
    if (!disposed && !task.value && !report.value) void scan()
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  disposed = true
  offTask()
})
</script>

<template>
  <BaseDialog
    :model-value="modelValue"
    :title="t('duplicates.title')"
    width="max-w-7xl"
    panel-class="duplicate-dialog flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden"
    header-class="shrink-0 border-b border-border"
    body-class="min-h-0 overflow-y-auto custom-scrollbar"
    :close-on-overlay="false"
    :close-on-esc="!cleaning"
    :show-close="!cleaning"
    @update:model-value="updateOpen"
  >
    <template #header>
      <div class="flex items-center gap-2">
        <DialogTitle class="ep-dialog-title text-lg font-semibold">
          {{ t('duplicates.title') }}
        </DialogTitle>
        <BasePopover
          class="duplicate-report-help"
          trigger="hover"
          placement="bottom"
          width="w-80"
          padding="sm"
          :teleport="true"
        >
          <template #trigger>
            <span class="sr-only">{{ t('duplicates.selectionHelp') }}</span>
            <SvgIcon name="common-info" class-name="pointer-events-none block size-4" />
          </template>
          <p class="text-xs leading-relaxed">{{ t('duplicates.readOnly') }}</p>
        </BasePopover>
      </div>
    </template>
    <div ref="content" class="space-y-2.5 text-sm">
      <details class="settings-page duplicate-settings" :open="!report">
        <summary
          class="ep-focusable flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 rounded-lg py-1"
        >
          <span class="font-medium">{{ t('duplicates.scanOptions') }}</span>
          <span class="flex items-center gap-2 text-xs text-text-l">
            {{ t(deep ? 'duplicates.deepScan' : 'duplicates.quickScan') }}
            <span v-if="deep" class="tabular-nums">· {{ sampleSeconds }} s</span>
            <SvgIcon name="arrow-arrow-down" class-name="duplicate-options-chevron size-4" />
          </span>
        </summary>
        <SettingCard class="mt-3">
          <div class="grid md:grid-cols-2">
            <SettingRow :label="t('duplicates.deepScan')" :description="t('duplicates.deepHint')">
              <BaseSwitch
                v-model="deep"
                :aria-label="t('duplicates.deepScan')"
                :disabled="scanning || cleaning"
              />
            </SettingRow>
            <SettingRow :label="t('duplicates.forceScan')" :description="t('duplicates.forceHint')">
              <BaseSwitch
                v-model="force"
                :aria-label="t('duplicates.forceScan')"
                :disabled="scanning || cleaning"
              />
            </SettingRow>
          </div>
          <div class="grid border-t border-border md:grid-cols-2">
            <SettingRow :label="t('duplicates.sampleLength')">
              <BaseSelect
                v-model="sampleSeconds"
                :options="sampleOptions"
                :aria-label="t('duplicates.sampleLength')"
                class="w-44 shrink-0"
                size="sm"
                :teleport="true"
                :disabled="!deep || scanning || cleaning"
              />
            </SettingRow>
            <SettingRow :label="t('duplicates.concurrency')">
              <BaseSelect
                v-model="concurrency"
                :options="concurrencyOptions"
                :aria-label="t('duplicates.concurrency')"
                class="w-44 shrink-0"
                size="sm"
                :teleport="true"
                :disabled="!deep || scanning || cleaning"
              />
            </SettingRow>
          </div>
        </SettingCard>
        <div class="mt-2 flex flex-wrap items-center justify-between gap-2 px-1">
          <p class="text-xs leading-relaxed text-text-l">{{ t('duplicates.settingsHint') }}</p>
          <BaseButton
            variant="ghost"
            size="sm"
            :disabled="scanning || cleaning"
            @click="clearCache"
          >
            {{ t('duplicates.clearCache') }}
          </BaseButton>
        </div>
        <details v-if="deep" class="px-1 text-xs leading-relaxed text-text-l">
          <summary class="ep-focusable cursor-pointer py-1">{{ t('duplicates.deepHelp') }}</summary>
          <p class="mt-1">{{ t('duplicates.deepDescription') }}</p>
          <p class="mt-1">{{ t('duplicates.concurrencyDescription') }}</p>
        </details>
      </details>
      <div
        v-if="scanning || resumable"
        class="rounded-xl border border-border p-4 sm:p-5"
        role="status"
      >
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div class="flex min-w-0 items-center gap-3">
            <span v-if="scanning && !pending" class="ep-spinner text-primary" aria-hidden="true" />
            <SvgIcon v-else name="common-time" class-name="size-5 shrink-0 text-text-l" />
            <div>
              <p class="font-medium">
                {{
                  scanning
                    ? t(`duplicates.${progress.phase}`)
                    : t(`duplicates.taskStatus.${task!.status}`)
                }}
              </p>
              <p class="mt-1 text-xs tabular-nums text-text-l">
                {{ progress.current }} / {{ progress.total }}
                <span v-if="progress.phase === 'matching' && progress.comparedPairs != null">
                  · {{ t('duplicates.comparedPairs', { count: progress.comparedPairs }) }}
                </span>
              </p>
            </div>
          </div>
          <BaseButton
            v-if="scanning"
            variant="secondary"
            size="sm"
            :disabled="pending || task?.settling"
            @click="pauseScan"
          >
            {{ t('duplicates.pause') }}
          </BaseButton>
          <BaseButton v-else size="sm" :loading="pending" @click="resumeScan">
            {{ t('duplicates.resume') }}
          </BaseButton>
        </div>
        <div v-if="progress.phase === 'checking'" class="mb-3 space-y-1 text-xs text-text-l">
          <p v-if="progress.waitingForPlayback" class="text-warning">
            {{ t('duplicates.checkingPaused') }}
          </p>
          <p v-else-if="progress.activeChecks != null">
            {{ t('duplicates.checkingActive', { count: progress.activeChecks }) }}
          </p>
          <p v-if="progress.currentPath" class="break-all" :title="progress.currentPath">
            {{ progress.currentPath }}
          </p>
        </div>
        <div
          class="ep-progress-track h-1.5 overflow-hidden rounded-full"
          role="progressbar"
          :aria-label="t('duplicates.scanning')"
          :aria-valuenow="progress.current"
          :aria-valuemin="0"
          :aria-valuemax="Math.max(1, progress.total)"
        >
          <div
            class="ep-progress-fill h-full rounded-full"
            :style="{ width: `${progressPercent}%` }"
          />
        </div>
        <ol
          class="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-text-l"
          :aria-label="t('duplicates.scanStages')"
        >
          <li
            v-for="(phase, index) in scanPhases"
            :key="phase"
            class="flex items-center gap-1.5"
            :class="index === phaseIndex ? 'text-primary' : ''"
            :aria-current="index === phaseIndex ? 'step' : undefined"
          >
            <SvgIcon
              v-if="index < phaseIndex"
              name="common-check"
              class-name="size-3.5 text-success"
            />
            <span
              v-else
              class="size-1.5 rounded-full"
              :class="index === phaseIndex ? 'bg-primary' : 'bg-border'"
              aria-hidden="true"
            />
            {{ t(`duplicates.${phase}`) }}
          </li>
        </ol>
        <p v-if="task?.error" class="mt-3 text-warning">
          {{ t(`duplicates.errors.${task.error}`) }}
        </p>
        <p v-if="task?.recovering" class="mt-3 text-xs text-text-l">
          {{ t('duplicates.recovering') }}
        </p>
        <p
          v-if="task?.recovering && task.resumeProgress"
          class="mt-1 text-xs tabular-nums text-text-l"
        >
          {{ t('duplicates.checkpoint') }}: {{ t(`duplicates.${task.resumeProgress.phase}`) }}
          {{ task.resumeProgress.current }} / {{ task.resumeProgress.total }}
        </p>
        <p class="mt-3 text-xs leading-relaxed text-text-l">
          {{ t(scanning ? 'duplicates.backgroundDescription' : 'duplicates.resumeDescription') }}
        </p>
      </div>
      <template v-else-if="report">
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div
            v-for="stat in summaryStats"
            :key="stat.label"
            class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-lg border border-border bg-text/5 px-3 py-2"
          >
            <p class="text-xs text-text-l">{{ t(`duplicates.${stat.label}`) }}</p>
            <p class="text-base font-semibold tabular-nums">{{ stat.value }}</p>
          </div>
        </div>
        <div
          class="duplicate-report-meta grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2"
        >
          <div
            class="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-l"
          >
            <span class="tabular-nums">{{ new Date(report.createdAt).toLocaleString() }}</span>
            <span>
              {{
                t('duplicates.reportKinds', {
                  exact: report.exactGroups,
                  similar: report.similarGroups
                })
              }}
              <template v-if="report.mode === 'deep'">
                · {{ t('duplicates.audioCount', { count: report.audioGroups ?? 0 }) }}
              </template>
            </span>
          </div>
          <BaseButton
            variant="ghost"
            size="xs"
            class="duplicate-report-details self-start"
            :aria-expanded="detailsOpen"
            :aria-controls="detailsPanelId"
            @click="detailsOpen = !detailsOpen"
          >
            <SvgIcon
              name="arrow-arrow-down"
              class-name="mr-1 size-3.5"
              :class="detailsOpen ? 'rotate-180' : ''"
            />
            {{ t('duplicates.reportDetails') }}
          </BaseButton>
          <div
            v-if="detailsOpen"
            :id="detailsPanelId"
            class="col-span-2 space-y-2 rounded-lg border border-border p-3 text-xs leading-relaxed text-text-l"
          >
            <p>{{ t('duplicates.hashRule') }}</p>
            <p v-if="report.matchingStats" class="text-xs text-text-l">
              {{ t('duplicates.matchingWork', report.matchingStats) }}
            </p>
            <ul v-if="report.checkingStats?.slowFiles.length" class="space-y-1">
              <li v-for="file in report.checkingStats.slowFiles" :key="file.path" class="break-all">
                {{
                  t('duplicates.checkingSlow', {
                    seconds: (file.elapsedMs / 1000).toFixed(1),
                    path: file.path
                  })
                }}
              </li>
            </ul>
            <p v-if="report.timings" class="text-xs text-text-l">
              {{
                t('duplicates.scanTimings', {
                  checking: (report.timings.checkingMs / 1000).toFixed(1),
                  hashing: (report.timings.hashingMs / 1000).toFixed(1),
                  fingerprint: (report.timings.fingerprintMs / 1000).toFixed(1),
                  matching: (report.timings.matchingMs / 1000).toFixed(1),
                  total: (report.timings.totalMs / 1000).toFixed(1)
                })
              }}
            </p>
            <p v-if="report.mode === 'deep' && report.sampleSeconds" class="text-xs text-text-l">
              {{ t('duplicates.analyzedLength', { seconds: report.sampleSeconds }) }}
              <span v-if="report.concurrency">
                · {{ t('duplicates.reportConcurrency', { count: report.concurrency }) }}
              </span>
            </p>
            <p v-if="report.cacheHits" class="text-xs text-text-l">
              {{ t('duplicates.cacheSummary', report.cacheHits) }}
            </p>
            <p v-if="report.mode === 'deep'" class="text-xs text-text-l">
              {{
                t('duplicates.audioSummary', {
                  files: report.fingerprinted,
                  groups: report.audioGroups
                })
              }}
            </p>
            <details v-if="report.fingerprintWarnings?.length" class="text-xs text-text-l">
              <summary class="cursor-pointer text-warning">
                {{
                  t('duplicates.fingerprintWarnings', { count: report.fingerprintWarnings.length })
                }}
              </summary>
              <ul class="max-h-40 space-y-2 overflow-auto custom-scrollbar">
                <li
                  v-for="(notice, index) in report.fingerprintWarnings"
                  :key="index"
                  class="break-all py-1"
                >
                  <p>{{ notice.path }}</p>
                  <p class="text-warning">{{ fingerprintWarningLabel(notice.reason, locale) }}</p>
                  <details v-if="notice.stderr">
                    <summary class="cursor-pointer">
                      {{ t('duplicates.failureDiagnostic') }}
                    </summary>
                    <pre class="whitespace-pre-wrap break-all">{{ notice.stderr }}</pre>
                  </details>
                </li>
              </ul>
            </details>
            <details v-if="report.fingerprintSkipped?.length" class="text-xs text-text-l">
              <summary>
                {{
                  t('duplicates.fingerprintSkipped', { count: report.fingerprintSkipped.length })
                }}
              </summary>
              <ul class="max-h-32 overflow-auto">
                <li v-for="file in report.fingerprintSkipped" :key="file" class="break-all py-1">
                  <p>{{ file }}</p>
                  <template v-for="failure in failureDetails.get(file) ?? []" :key="failure.path">
                    <p class="text-warning">
                      {{ fingerprintFailureLabel(failure.reason, locale) }}
                      <span v-if="failure.exitCode != null">
                        · {{ t('duplicates.failureExitCode', { code: failure.exitCode }) }}
                      </span>
                    </p>
                    <details v-if="failure.stderr || failure.message" class="mt-1">
                      <summary class="cursor-pointer">
                        {{ t('duplicates.failureDiagnostic') }}
                      </summary>
                      <pre class="whitespace-pre-wrap break-all text-xs">
                        {{ failure.stderr || failure.message }}
                      </pre>
                    </details>
                  </template>
                  <p v-if="!failureDetails.has(file)">{{ t('duplicates.failureLegacy') }}</p>
                </li>
              </ul>
            </details>
          </div>
        </div>
        <p
          v-if="!report.groups.length"
          role="status"
          class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-10 text-center text-text-l"
        >
          <SvgIcon name="common-check" class-name="size-8 text-success" />
          {{ t('duplicates.none') }}
        </p>
        <div v-if="report.groups.length" class="space-y-4">
          <section
            v-for="(group, index) in visibleGroups"
            :key="group.id"
            class="duplicate-group overflow-hidden rounded-xl border border-border"
          >
            <div
              class="duplicate-group-header flex items-center gap-2 bg-text/5 px-3 py-1.5 text-xs"
            >
              <h3
                class="min-w-0 truncate font-medium"
                :title="
                  t('duplicates.group', { index: page * 20 + index + 1, count: group.files.length })
                "
              >
                {{
                  t('duplicates.group', { index: page * 20 + index + 1, count: group.files.length })
                }}
              </h3>
              <span
                class="shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5"
                :class="
                  group.kind === 'exact'
                    ? 'border-success/20 bg-success/5 text-success'
                    : 'border-warning/20 bg-warning/5 text-warning'
                "
                :title="groupEvidence(group)"
              >
                {{ t(`duplicates.${group.kind}`) }}
              </span>
              <span
                class="hidden min-w-0 flex-1 truncate text-text-l sm:block"
                :title="groupEvidence(group)"
                >{{ groupEvidence(group) }}</span
              >
              <BaseButton
                variant="ghost"
                size="xs"
                class="ml-auto shrink-0"
                :disabled="confirmOpen || cleaning"
                :title="t('duplicates.groupSelectionHint')"
                @click="toggleGroup(group)"
              >
                {{
                  t(groupHasSelection(group) ? 'duplicates.uncheckGroup' : 'duplicates.checkGroup')
                }}
              </BaseButton>
            </div>
            <div class="overflow-x-auto custom-scrollbar">
              <table class="duplicate-table w-full text-left text-xs">
                <colgroup>
                  <col style="width: 4%" />
                  <col style="width: 48%" />
                  <col style="width: 26%" />
                  <col style="width: 15%" />
                  <col style="width: 7%" />
                </colgroup>
                <thead class="text-text-l">
                  <tr>
                    <th class="p-3">{{ t('duplicates.selectClean') }}</th>
                    <th class="p-3">{{ t('duplicates.file') }}</th>
                    <th class="p-3">{{ t('duplicates.metadata') }}</th>
                    <th class="p-3">{{ t('duplicates.quality') }}</th>
                    <th class="p-3">{{ t('duplicates.decision') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="file in group.files"
                    :key="file.id"
                    class="duplicate-file border-t border-border"
                    :class="selected.has(file.id) ? 'bg-warning/5' : ''"
                  >
                    <td class="p-4 duplicate-file-choice">
                      <input
                        type="checkbox"
                        class="ep-focusable size-4 cursor-pointer rounded accent-primary disabled:cursor-not-allowed"
                        :aria-label="t('duplicates.selectFile', { path: file.audio })"
                        :checked="selected.has(file.id)"
                        :disabled="
                          confirmOpen ||
                          cleaning ||
                          (!selected.has(file.id) &&
                            group.files.filter((item) => !selected.has(item.id)).length <= 1)
                        "
                        @change="toggle(group, file.id)"
                      />
                    </td>
                    <td class="p-4 duplicate-file-name">
                      <p class="font-medium leading-normal">{{ file.title }}</p>
                      <p class="break-all leading-normal text-text-l">{{ file.audio }}</p>
                      <p class="flex flex-wrap gap-x-3 text-text-l">
                        <span v-if="file.sha256" :title="file.sha256"
                          >SHA-256: {{ file.sha256.slice(0, 16) }}…</span
                        >
                      </p>
                    </td>
                    <td class="p-4 duplicate-file-metadata">
                      <p>{{ file.artist || '—' }}</p>
                      <p class="text-text-l">{{ file.album || '—' }}</p>
                      <p class="tabular-nums text-text-l">{{ duration(file.duration) }}</p>
                    </td>
                    <td class="p-4 whitespace-nowrap duplicate-file-quality">
                      <p>
                        {{ file.format || '—' }}
                        <span class="ml-1 text-text-l">{{ file.bitrate ?? '—' }} kbps</span>
                      </p>
                      <p class="text-text-l">
                        {{ file.sampleRate ?? '—' }} Hz · {{ file.bitDepth ?? '—' }} bit
                      </p>
                      <p class="tabular-nums text-text-l">{{ bytes(file.size) }}</p>
                    </td>
                    <td class="p-4 duplicate-file-decision">
                      <p
                        class="flex items-center gap-1.5 whitespace-nowrap"
                        :class="selected.has(file.id) ? 'text-warning' : 'text-success'"
                      >
                        <span
                          class="size-1.5 shrink-0 rounded-full bg-current"
                          aria-hidden="true"
                        />
                        {{
                          t(
                            selected.has(file.id)
                              ? 'duplicates.pendingCleanup'
                              : 'duplicates.retained'
                          )
                        }}
                      </p>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
        <div v-if="pageCount > 1" class="flex items-center justify-center gap-3">
          <BaseButton variant="ghost" size="sm" :disabled="page === 0" @click="page--">
            {{ t('duplicates.previous') }}
          </BaseButton>
          <span>{{ page + 1 }} / {{ pageCount }}</span>
          <BaseButton variant="ghost" size="sm" :disabled="page + 1 >= pageCount" @click="page++">
            {{ t('duplicates.next') }}
          </BaseButton>
        </div>
        <details v-if="report.skipped.length" class="text-xs text-text-l">
          <summary class="cursor-pointer">
            {{ t('duplicates.skipped', { count: report.skipped.length }) }}
          </summary>
          <ul class="mt-2 max-h-32 overflow-y-auto custom-scrollbar">
            <li v-for="(file, index) in report.skipped" :key="index" class="break-all">
              {{ file.path }} · {{ t(`duplicates.${file.reason}`) }}
            </li>
          </ul>
        </details>
        <div
          v-if="confirmOpen"
          ref="confirmation"
          role="group"
          :aria-label="t('duplicates.confirmTitle')"
          class="space-y-3 rounded-xl border border-danger/25 bg-danger/5 p-4"
        >
          <p class="font-medium leading-relaxed">{{ t('duplicates.confirmTitle') }}</p>
          <p v-if="hasSimilarSelection" class="text-warning">
            {{ t('duplicates.similarConfirm') }}
          </p>
          <p>
            {{
              t(
                deleteLocalFiles
                  ? 'duplicates.confirmDeleteFiles'
                  : 'duplicates.confirmLibraryOnly',
                { count: cleanupIds.length }
              )
            }}
          </p>
          <div class="space-y-2">
            <p class="text-xs text-text-l">
              {{ t('duplicates.cleanupSongs', { count: cleanupSongs.length }) }}
            </p>
            <ul
              class="max-h-40 space-y-2 overflow-y-auto rounded-lg border border-border p-3 custom-scrollbar"
              :aria-label="t('duplicates.cleanupSongs', { count: cleanupSongs.length })"
            >
              <li v-for="song in cleanupSongs" :key="song.id">
                <p class="break-words font-medium">{{ song.title || song.audio }}</p>
                <p class="break-all text-xs text-text-l">{{ song.audio }}</p>
              </li>
            </ul>
          </div>
          <div class="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
            <span>{{ t('songList.deleteLocalFile') }}</span>
            <BaseSwitch
              v-model="deleteLocalFiles"
              :aria-label="t('songList.deleteLocalFile')"
              :disabled="cleaning"
            />
          </div>
          <div class="flex justify-end gap-2">
            <BaseButton variant="cancel" :disabled="cleaning" @click="confirmOpen = false">
              {{ t('common.cancel') }}
            </BaseButton>
            <BaseButton variant="danger" size="sm" :loading="cleaning" @click="cleanup">
              {{ t('duplicates.confirmClean') }}
            </BaseButton>
          </div>
        </div>
      </template>
      <div v-else class="py-6 text-center">
        <BaseButton @click="scan">{{ t('duplicates.start') }}</BaseButton>
      </div>
    </div>
    <template #footer>
      <p v-if="report?.groups.length && !scanning" class="mr-auto text-xs text-text-l">
        {{ t('duplicates.pendingCount', { count: cleanupIds.length }) }}
      </p>
      <BaseButton
        variant="ghost"
        size="sm"
        :disabled="scanning || cleaning || exporting || !report"
        :loading="exporting"
        @click="exportReport"
      >
        {{ t('duplicates.export') }}
      </BaseButton>
      <BaseButton
        variant="secondary"
        size="sm"
        :disabled="scanning || cleaning || exporting"
        @click="scan"
      >
        {{ t('duplicates.rescan') }}
      </BaseButton>
      <BaseButton
        :variant="scanning ? 'primary' : 'secondary'"
        size="sm"
        :disabled="cleaning"
        @click="keepAndClose"
      >
        {{ t(scanning ? 'duplicates.runInBackground' : 'duplicates.keepAndClose') }}
      </BaseButton>
      <BaseButton
        v-if="report?.groups.length && !scanning"
        variant="secondary"
        size="sm"
        :disabled="!cleanupIds.length || cleaning"
        @click="resetSelection"
      >
        {{ t('duplicates.resetSelection') }}
      </BaseButton>
      <BaseButton
        v-if="report?.groups.length && !scanning"
        variant="danger"
        size="sm"
        :disabled="!cleanupIds.length || cleaning || confirmOpen"
        @click="requestCleanup"
      >
        {{ t('duplicates.cleanSelected', { count: cleanupIds.length }) }}
      </BaseButton>
    </template>
  </BaseDialog>
</template>

<style src="@/styles/settings.css"></style>

<style>
/* Shared settings rows and controls keep their global geometry and theme materials. */
.duplicate-report-help {
  display: inline-flex;
  align-items: center;
  line-height: 0;
}
.duplicate-report-help .ep-popover-trigger {
  display: inline-flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  border-radius: var(--ep-control-radius);
  color: var(--color-text-l);
  cursor: help;
  line-height: 1;
}
.duplicate-report-help .ep-popover-trigger:is(:hover, :focus-visible) {
  color: var(--color-primary);
}

.duplicate-settings > summary::-webkit-details-marker {
  display: none;
}
.duplicate-options-chevron {
  transition: transform var(--motion-duration-fast) var(--motion-ease-standard);
}
.duplicate-settings[open] .duplicate-options-chevron {
  transform: rotate(180deg);
}
.duplicate-settings .setting-row {
  min-height: 68px;
  flex-wrap: nowrap;
  gap: 1rem;
  padding: 0.9rem 1rem;
}
.duplicate-settings .setting-row > :first-child {
  flex: 1;
  min-width: 0;
}
.duplicate-settings .ep-switch {
  flex-shrink: 0;
}
.duplicate-settings .setting-row h3 {
  font-size: 0.8125rem;
}
.duplicate-settings .setting-row p {
  font-size: 0.75rem;
}
.duplicate-dialog .ep-dialog-footer {
  flex-shrink: 0;
  border-top: 1px solid var(--color-border);
}
.duplicate-dialog .ep-dialog-footer > div {
  flex-wrap: wrap;
}
.duplicate-dialog .ep-dialog-header,
.duplicate-dialog .ep-dialog-footer {
  padding: 0.5rem 0.75rem;
}
.duplicate-dialog .ep-dialog-body {
  padding: 0.75rem;
  scrollbar-gutter: stable;
}
.duplicate-report-details {
  white-space: nowrap;
}
.duplicate-table .duplicate-file-decision {
  vertical-align: middle;
  text-align: left;
}
.duplicate-file-decision p {
  justify-content: flex-start;
}
.duplicate-table .duplicate-file-choice {
  vertical-align: middle;
}
.duplicate-file-choice input {
  display: block;
}
.duplicate-group-header {
  white-space: nowrap;
}
.duplicate-table {
  width: 100%;
  min-width: 48rem;
  table-layout: fixed;
}
.duplicate-table td {
  overflow-wrap: anywhere;
}
.duplicate-table th {
  padding: 0.4rem 0.75rem;
  font-weight: 500;
  background: color-mix(in srgb, var(--color-text) 5%, transparent);
}
.duplicate-group {
  position: relative;
}
.duplicate-table td {
  padding: 0.5rem 0.75rem;
  vertical-align: top;
}
.duplicate-file {
  transition: background-color var(--motion-duration-fast) var(--motion-ease-standard);
}
.duplicate-file:hover {
  background: var(--color-hover);
}
@media (max-width: 639px) {
  .duplicate-settings .setting-row {
    min-height: 64px;
  }
  .duplicate-table {
    min-width: 0;
  }
  .duplicate-table colgroup {
    display: none;
  }
  .duplicate-table,
  .duplicate-table tbody {
    display: block;
    width: 100%;
  }
  .duplicate-table thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .duplicate-file {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
  .duplicate-table td {
    min-width: 0;
    max-width: none;
    padding: 0.35rem 0.75rem;
  }
  .duplicate-table .duplicate-file-choice {
    position: absolute;
    top: 50%;
    right: 0.75rem;
    transform: translateY(-50%);
    padding: 0;
  }
  .duplicate-table .duplicate-file-name {
    grid-column: 1 / -1;
    padding-top: 0.6rem;
    padding-right: 2.5rem;
  }
  .duplicate-table .duplicate-file-quality {
    white-space: normal;
    padding-right: 2.5rem;
  }
  .duplicate-table .duplicate-file-decision {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 1rem;
    padding-bottom: 0.6rem;
  }
  .duplicate-file-decision p {
    margin: 0;
  }
}
</style>
