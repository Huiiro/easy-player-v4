import { ref, computed, watch, onScopeDispose, type Ref } from 'vue'
import { createSourceRequestScope } from '@/services/sourceRequests'
import {
  sourceMetadataDiff,
  selectedSourcePatch,
  type SourceDiffField
} from '@/services/sourceMetadata'
import type {
  SourceTrackSummary,
  SourceTrackDetail,
  SourceMetadataSnapshot
} from '../../../../shared/sourceMetadata'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- Keep Vue ref inference for this composable.
export function useSourceMetadata(
  songId: Ref<number | null>,
  visible: Ref<boolean>,
  text: (key: string) => string,
  onSaved: () => void,
  onFailure?: (message: string) => void
) {
  const requests = createSourceRequestScope()
  onScopeDispose(cancelPending)
  const sources = ref<{ id: string; displayName: string }[]>([])
  const sourceId = ref('')
  const query = ref('')
  const snapshot = ref<SourceMetadataSnapshot>()
  const results = ref<SourceTrackSummary[]>([])
  const detail = ref<SourceTrackDetail>()
  const assets = ref<{ lyrics?: string; coverDataUrl?: string }>({})
  const selected = ref<SourceDiffField[]>([])
  const loading = ref(false)
  const searching = ref(false)
  const fetching = ref(false)
  const saving = ref(false)
  const fetchingLyrics = ref(false)
  const fetchingCover = ref(false)
  const error = ref('')
  const errorTitle = ref('')
  const searched = ref(false)
  const rows = computed(() => sourceMetadataDiff(snapshot.value, detail.value, assets.value))
  const selectedCount = computed(
    () => rows.value.filter((row) => selected.value.includes(row.field)).length
  )
  const allSelected = computed(
    () => rows.value.length > 0 && selectedCount.value === rows.value.length
  )
  const partiallySelected = computed(() => selectedCount.value > 0 && !allSelected.value)
  const patch = computed(() => selectedSourcePatch(rows.value, selected.value))
  const canSave = computed(() =>
    Boolean(
      snapshot.value &&
      Object.keys(patch.value).length &&
      !loading.value &&
      !fetching.value &&
      !fetchingLyrics.value &&
      !fetchingCover.value &&
      !saving.value
    )
  )
  let session = 0,
    searchId = 0,
    detailId = 0
  const current = (token: number): boolean => token === session && visible.value
  const message = (reason: unknown): string =>
    reason instanceof Error && reason.message.trim() ? reason.message : text('networkFailed')
  function reportError(reason: unknown, title: string): void {
    errorTitle.value = text(title)
    error.value = message(reason)
    onFailure?.(
      error.value === errorTitle.value ? error.value : errorTitle.value + ': ' + error.value
    )
  }

  watch(
    [visible, songId],
    async ([open, id]) => {
      requests.cancelAll()
      const token = ++session
      ++searchId
      ++detailId
      loading.value = false
      searching.value = false
      fetching.value = false
      fetchingLyrics.value = false
      fetchingCover.value = false
      results.value = []
      detail.value = undefined
      assets.value = {}
      selected.value = []
      snapshot.value = undefined
      error.value = ''
      searched.value = false
      if (!open || id === null) return
      loading.value = true
      try {
        const [list, file] = await Promise.all([
          window.api.metadata.listSources(),
          window.api.metadata.sourceSnapshot(id)
        ])
        if (!current(token)) return
        if (!list.success || !file.success)
          throw new Error(list.error || file.error || text('networkFailed'))
        if (!list.data?.length) throw new Error(text('networkNoSources'))
        sources.value = list.data ?? []
        sourceId.value = sources.value[0]?.id ?? ''
        snapshot.value = file.data
        const base = file.data?.metadata ?? {}
        query.value = [base.title, base.artist].filter(Boolean).join(' ')
      } catch (reason) {
        if (current(token)) reportError(reason, 'networkLoadFailed')
      } finally {
        if (current(token)) loading.value = false
      }
    },
    { immediate: true }
  )

  watch(sourceId, () => {
    requests.cancelAll()
    error.value = ''
    ++searchId
    ++detailId
    results.value = []
    detail.value = undefined
    assets.value = {}
    selected.value = []
    searching.value = false
    fetching.value = false
    fetchingLyrics.value = false
    fetchingCover.value = false
    searched.value = false
  })

  function cancelPending(): void {
    requests.cancelAll()
    ++searchId
    ++detailId
    if (searching.value) searched.value = false
    searching.value = false
    fetching.value = false
    fetchingLyrics.value = false
    fetchingCover.value = false
  }
  async function search(): Promise<void> {
    if (!query.value.trim() || !sourceId.value) return
    cancelPending()
    const call = requests.start('search')
    const token = session,
      request = ++searchId
    ++detailId
    results.value = []
    detail.value = undefined
    assets.value = {}
    selected.value = []
    fetching.value = false
    fetchingLyrics.value = false
    fetchingCover.value = false
    searching.value = true
    searched.value = true
    error.value = ''
    try {
      const response = await window.api.metadata.searchTracks(
        sourceId.value,
        query.value,
        call.options
      )
      if (!current(token) || request !== searchId) return
      if (!response.success) throw new Error(response.error || text('networkFailed'))
      results.value = response.data ?? []
    } catch (reason) {
      if (current(token) && request === searchId) reportError(reason, 'networkSearchFailed')
    } finally {
      call.finish()
      if (current(token) && request === searchId) searching.value = false
    }
  }
  async function choose(item: SourceTrackSummary): Promise<void> {
    requests.cancel('detail')
    requests.cancel('lyrics')
    requests.cancel('cover')
    const call = requests.start('detail')
    const token = session,
      request = ++detailId
    detail.value = undefined
    assets.value = {}
    selected.value = []
    error.value = ''
    fetchingLyrics.value = false
    fetchingCover.value = false
    fetching.value = true
    try {
      // Nested values in Vue refs are proxies; send a plain resource DTO through IPC.
      const response = await window.api.metadata.getTrack({ ...item.resource }, call.options)
      if (!current(token) || request !== detailId) return
      if (!response.success || !response.data)
        throw new Error(response.error || text('networkFailed'))
      detail.value = response.data
    } catch (reason) {
      if (current(token) && request === detailId) reportError(reason, 'networkDetailsFailed')
    } finally {
      call.finish()
      if (current(token) && request === detailId) fetching.value = false
    }
  }
  async function fetchLyrics(): Promise<void> {
    if (!detail.value || fetchingLyrics.value) return
    const token = session,
      request = detailId
    const call = requests.start('lyrics')
    fetchingLyrics.value = true
    error.value = ''
    try {
      const response = await window.api.metadata.getTrackLyrics(
        { ...detail.value.resource },
        call.options
      )
      if (!current(token) || request !== detailId) return
      if (!response.success || !response.data?.lrc)
        throw new Error(response.error || text('networkNoLyrics'))
      assets.value = { ...assets.value, lyrics: response.data.lrc }
    } catch (reason) {
      if (current(token) && request === detailId) reportError(reason, 'networkLyricsFailed')
    } finally {
      call.finish()
      if (current(token) && request === detailId) fetchingLyrics.value = false
    }
  }
  async function fetchCover(): Promise<void> {
    if (!detail.value?.artwork || fetchingCover.value) return
    const token = session,
      request = detailId
    const call = requests.start('cover')
    fetchingCover.value = true
    error.value = ''
    try {
      const response = await window.api.metadata.downloadCover(
        detail.value.artwork.imageUrl,
        call.options
      )
      if (!current(token) || request !== detailId) return
      if (!response.success || !response.data)
        throw new Error(response.error || text('networkFailed'))
      assets.value = { ...assets.value, coverDataUrl: response.data.dataUrl }
    } catch (reason) {
      if (current(token) && request === detailId) reportError(reason, 'networkCoverFailed')
    } finally {
      call.finish()
      if (current(token) && request === detailId) fetchingCover.value = false
    }
  }
  function selectAll(checked = true): void {
    if (saving.value) return
    selected.value = checked ? rows.value.map((row) => row.field) : []
  }
  async function save(): Promise<void> {
    if (!canSave.value || songId.value === null || !snapshot.value) return
    const token = session
    const request = {
      songId: songId.value,
      expectedRevision: snapshot.value.revision,
      patch: { ...patch.value }
    }
    saving.value = true
    error.value = ''
    try {
      const response = await window.api.metadata.applySource(request)
      if (!current(token)) return
      if (!response.success) throw new Error(response.error || text('saveFailed'))
      onSaved()
    } catch (reason) {
      if (current(token)) reportError(reason, 'saveFailed')
    } finally {
      saving.value = false
    }
  }
  return {
    sources,
    sourceId,
    query,
    results,
    detail,
    assets,
    selected,
    loading,
    searching,
    fetching,
    saving,
    fetchingLyrics,
    fetchingCover,
    error,
    errorTitle,
    selectedCount,
    allSelected,
    partiallySelected,
    searched,
    snapshot,
    rows,
    canSave,
    search,
    choose,
    fetchLyrics,
    fetchCover,
    selectAll,
    cancelPending,
    save
  }
}
