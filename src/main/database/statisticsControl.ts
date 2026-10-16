import { randomUUID } from 'node:crypto'
import { getDatabase } from './index'
import { getAppSetting, setAppSetting } from './repository/settings'
import {
  STATISTICS_SETTING_KEY,
  normalizeStatisticsState,
  type StatisticsState
} from '../../shared/statistics'

export function getStatisticsState(): StatisticsState {
  return normalizeStatisticsState(getAppSetting(STATISTICS_SETTING_KEY))
}

export function setStatisticsEnabled(enabled: boolean): StatisticsState {
  if (typeof enabled !== 'boolean') throw new Error('Invalid statistics setting')
  const current = getStatisticsState()
  if (current.enabled === enabled) return current
  const state = { enabled, generation: randomUUID() }
  setAppSetting(STATISTICS_SETTING_KEY, state)
  return state
}

export function canRecordStatistics(generation: unknown): boolean {
  const current = getStatisticsState()
  return current.enabled && generation === current.generation
}

export function clearStatisticsData(): StatisticsState {
  const db = getDatabase()
  return db.transaction(() => {
    const state = { ...getStatisticsState(), generation: randomUUID() }
    db.prepare('DELETE FROM play_history').run()
    db.prepare('DELETE FROM history').run()
    db.prepare('UPDATE song SET play_times = 0').run()
    db.prepare('DELETE FROM recommendation_daily').run()
    // Old in-flight playback events cannot repopulate cleared data.
    setAppSetting(STATISTICS_SETTING_KEY, state)
    return state
  })()
}
