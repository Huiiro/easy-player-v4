export interface AudioSettingsResult {
  success: boolean
  error?: string
}

export interface ApplyAudioProcessingProfileResult extends AudioSettingsResult {
  preamp?: { db: number; enabled: boolean }
}

export interface RestartAudioEngineResult extends AudioSettingsResult {
  restarted?: true
  resume?: { filePath: string; positionMs: number }
}

export const audioProcessingProfileNameLimit = 40
