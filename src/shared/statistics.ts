export const STATISTICS_SETTING_KEY = 'ui.statistics'

export interface StatisticsState {
  enabled: boolean
  generation: string
}

export function normalizeStatisticsState(value: unknown): StatisticsState {
  const state = value && typeof value === 'object' ? (value as Partial<StatisticsState>) : {}
  return {
    enabled: state.enabled !== false,
    generation: typeof state.generation === 'string' ? state.generation : 'initial'
  }
}
