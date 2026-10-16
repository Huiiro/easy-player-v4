export interface SearchIndexStatus {
  phase: 'queued' | 'indexing' | 'paused' | 'retrying' | 'ready' | 'error'
  total: number
  completed: number
  indexed: number
  pending: number
  retrying: number
  nextRetryAt: number | null
  currentTitle: string | null
  revision: number
}
