import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { EqBand } from '@/types/audio'
import { playerDataStorage } from '@/stores/persistence'

export interface EqPreset {
  id: string
  name: string
  bands: EqBand[]
}

const FREQUENCIES = [
  20, 31.5, 50, 80, 125, 200, 315, 500, 800, 1250, 2000, 3150, 5000, 8000, 10000, 12000, 14000,
  16000, 18000, 20000
]

function bandsFromGains(gains: number[]): EqBand[] {
  return FREQUENCIES.map((frequencyHz, index) => {
    const gainDb = gains[index] ?? 0
    return { enabled: Math.abs(gainDb) >= 0.0001, frequencyHz, gainDb, q: 1 }
  })
}

export const BUILT_IN_EQ_PRESETS: EqPreset[] = [
  { id: 'flat', name: 'flat', bands: bandsFromGains(Array(20).fill(0)) },
  {
    id: 'bass-boost',
    name: 'bassBoost',
    bands: bandsFromGains([6, 6, 5.5, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  },
  {
    id: 'treble-boost',
    name: 'trebleBoost',
    bands: bandsFromGains([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 1, 2, 3, 4, 4.5, 5, 5, 5, 5])
  },
  {
    id: 'vocal',
    name: 'vocal',
    bands: bandsFromGains([
      -2, -2, -1.5, -1, -0.5, 0, 1, 2, 3, 3.5, 4, 3.5, 2.5, 1, 0, -0.5, -1, -1, -1, -1
    ])
  },
  {
    id: 'classical',
    name: 'classical',
    bands: bandsFromGains([
      3, 3, 2.5, 2, 1.5, 1, 0, -1, -1.5, -1, 0, 1, 2, 2.5, 3, 3, 3, 2.5, 2.5, 2
    ])
  },
  {
    id: 'electronic',
    name: 'electronic',
    bands: bandsFromGains([4.5, 4.5, 4, 3, 1, 0, -1, -2, -1.5, 0, 1, 2, 3, 3.5, 3, 2.5, 2, 2, 2, 2])
  },
  {
    id: 'jazz',
    name: 'jazz',
    bands: bandsFromGains([
      3, 3, 2.5, 1.5, 0.5, 0, 1, 2, 2.5, 2, 1, 1.5, 2.5, 3, 3, 2.5, 2, 2, 2, 1.5
    ])
  },
  {
    id: 'pop',
    name: 'pop',
    bands: bandsFromGains([
      -1, -1, -0.5, 0, 1.5, 2.5, 3, 3, 2, 0.5, -0.5, -1, -0.5, 1, 2, 2.5, 2.5, 2, 2, 2
    ])
  },
  {
    id: 'rock',
    name: 'rock',
    bands: bandsFromGains([4, 4, 3.5, 3, 2, 0, -1.5, -2, -1, 1, 2.5, 3.5, 4, 4, 3.5, 3, 3, 3, 3, 3])
  }
]

function cloneBands(bands: EqBand[]): EqBand[] {
  return bands.map((band) => ({ ...band }))
}

export const useEqPresetStore = defineStore(
  'eq-presets',
  () => {
    const customPresets = ref<EqPreset[]>([])
    const allPresets = computed(() => [...BUILT_IN_EQ_PRESETS, ...customPresets.value])

    function savePreset(name: string, bands: EqBand[], id?: string): string {
      const presetId = id ?? `custom-${crypto.randomUUID()}`
      const preset: EqPreset = { id: presetId, name: name.trim(), bands: cloneBands(bands) }
      const index = customPresets.value.findIndex((item) => item.id === presetId)
      if (index >= 0) customPresets.value[index] = preset
      else customPresets.value.push(preset)
      return presetId
    }

    function deletePreset(id: string): void {
      const index = customPresets.value.findIndex((preset) => preset.id === id)
      if (index >= 0) customPresets.value.splice(index, 1)
    }

    return { customPresets, allPresets, savePreset, deletePreset }
  },
  {
    persist: {
      key: 'eq.presets.v1',
      storage: playerDataStorage,
      pick: ['customPresets']
    }
  }
)
