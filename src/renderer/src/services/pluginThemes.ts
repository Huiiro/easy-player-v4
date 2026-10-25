import { pluginThemes } from '@/components/background/systemBackgroundRegistry'

/** A window owns its subscription; runtime data never enters persisted preferences. */
export function connectPluginThemes(onState: (failed: boolean) => void): () => void {
  let disposed = false
  let revision = 0
  async function reload(): Promise<void> {
    const token = ++revision
    try {
      const response = await window.api.plugins.themes()
      if (disposed || token !== revision) return
      if (!response.success || !response.data) throw new Error('Theme plugins unavailable')
      pluginThemes.value = response.data
      onState(false)
    } catch {
      if (!disposed && token === revision) {
        pluginThemes.value = []
        onState(true)
      }
    }
  }
  if (!window.api?.plugins?.themes) return () => undefined
  const unsubscribe = window.api.plugins.onChanged(() => {
    void reload()
  })
  void reload()
  return () => {
    disposed = true
    ++revision
    unsubscribe()
  }
}
