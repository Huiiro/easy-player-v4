import { defineStore } from 'pinia'
import { onScopeDispose, ref } from 'vue'
import type { UpdateStatus } from '../../../main/service/updateService'

/** Shared, transient download state for the reminder and header. */
export const useAppUpdateStore = defineStore('app-update', () => {
  const status = ref<UpdateStatus | null>(null)
  const busy = ref(false)
  const actionError = ref<string | null>(null)
  const downloadAttempted = ref(false)
  let downloadVersion = ''
  let revision = 0

  function receive(next: UpdateStatus): void {
    revision++
    status.value = next
    if (next.state === 'downloading' || next.state === 'downloaded') {
      downloadAttempted.value = true
      downloadVersion = next.version
      actionError.value = null
    } else if (next.state === 'error' && downloadAttempted.value) actionError.value = next.message
  }

  const unsubscribe = window.api.appUpdate.onStatus((next) => receive(next as UpdateStatus))
  onScopeDispose(unsubscribe)
  const initialRevision = revision
  void window.api.appUpdate
    .status()
    .then((result) => {
      if (result.success && result.data && revision === initialRevision)
        receive(result.data as UpdateStatus)
    })
    .catch(() => {})

  async function downloadUpdate(
    version = downloadVersion || status.value?.version || ''
  ): Promise<void> {
    if (busy.value || status.value?.state === 'downloading' || status.value?.state === 'downloaded')
      return
    busy.value = true
    actionError.value = null
    downloadAttempted.value = true
    downloadVersion = version
    receive({ state: 'downloading', version, percent: 0 })
    try {
      const result = await window.api.appUpdate.download()
      if (!result.success) throw new Error(result.error || '')
      if (result.data) receive(result.data as UpdateStatus)
    } catch (error) {
      receive({
        state: 'error',
        version,
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      busy.value = false
    }
  }

  async function installUpdate(): Promise<void> {
    if (busy.value || status.value?.state !== 'downloaded') return
    busy.value = true
    actionError.value = null
    try {
      const result = await window.api.appUpdate.install()
      if (!result.success) throw new Error(result.error || '')
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : String(error)
    } finally {
      busy.value = false
    }
  }

  return { status, busy, actionError, downloadAttempted, downloadUpdate, installUpdate }
})
