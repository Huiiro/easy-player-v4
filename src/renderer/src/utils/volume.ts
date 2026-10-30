export function getVolumeLevel(volume: number): 'mute' | 'low' | 'middle' | 'high' {
  if (volume <= 0) return 'mute'
  if (volume <= 1 / 3) return 'low'
  if (volume <= 2 / 3) return 'middle'
  return 'high'
}
