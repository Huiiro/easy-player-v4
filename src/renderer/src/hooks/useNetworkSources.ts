import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import type { NetworkSourceInfo } from '../../../shared/networkSources'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- Preserve Vue ref inference.
export function useNetworkSources() {
  const { t } = useI18n()
  const sources = ref<NetworkSourceInfo[]>([])
  const loading = ref(true)
  const error = ref('')
  let request = 0
  let disposed = false
  let unsubscribe: (() => void) | undefined
  async function reload(): Promise<void> {
    const token = ++request
    loading.value = true
    error.value = ''
    try {
      const response = await window.api.networkSources.list()
      if (disposed || token !== request) return
      if (!response.success || !response.data)
        throw new Error(response.error || t('networkSources.loadFailed'))
      sources.value = response.data
    } catch (reason) {
      if (!disposed && token === request)
        error.value = reason instanceof Error ? reason.message : t('networkSources.loadFailed')
    } finally {
      if (!disposed && token === request) loading.value = false
    }
  }
  onMounted(() => {
    try {
      unsubscribe = window.api.networkSources.onChanged(() => {
        void reload()
      })
    } catch {
      error.value = t('networkSources.loadFailed')
      loading.value = false
      return
    }
    void reload()
  })
  onBeforeUnmount(() => {
    disposed = true
    unsubscribe?.()
  })
  return { sources, loading, error, reload }
}

export function networkSourceName(
  source: Pick<NetworkSourceInfo, 'id' | 'displayName'>,
  text: (key: string) => string
): string {
  const names: Record<string, string> = {
    netease: 'netease',
    kugou: 'kugou',
    qqmusic: 'qqmusic',
    bili: 'bili',
    youtube: 'youtube'
  }
  return Object.hasOwn(names, source.id)
    ? text('networkSources.names.' + names[source.id])
    : source.displayName
}
