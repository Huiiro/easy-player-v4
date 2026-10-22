import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'
import {
  availableWindowMaterials,
  resolveWindowMaterial,
  type WindowMaterial,
  type WindowMaterialState
} from '../../shared/windowMaterial'

type MaterialWindow = Pick<
  BrowserWindow,
  'isDestroyed' | 'setBackgroundColor' | 'setBackgroundMaterial' | 'setVibrancy'
>

export function createWindowMaterialManager(options: {
  platform: string
  release: string
  read: (key: string) => unknown
  write: (key: string, value: unknown) => void
  window: () => MaterialWindow | null
}): {
  state: () => WindowMaterialState
  creationOptions: (disabled: boolean) => BrowserWindowConstructorOptions
  apply: (material: WindowMaterial, backgroundColor?: string) => void
  select: (material: unknown) => WindowMaterialState
} {
  const available = availableWindowMaterials(options.platform, options.release)
  function state(): WindowMaterialState {
    const material = resolveWindowMaterial(
      options.read('window.material'),
      options.read('window.mica-enabled'),
      available
    )
    return { available: [...available], material, enabled: material !== 'none' }
  }
  function creationOptions(disabled: boolean): BrowserWindowConstructorOptions {
    const material = disabled ? 'none' : state().material
    if (material === 'vibrancy')
      return { backgroundColor: '#00000000', vibrancy: 'under-window', visualEffectState: 'active' }
    return material === 'none' ? {} : { backgroundMaterial: material }
  }
  function apply(material: WindowMaterial, backgroundColor = '#111614'): void {
    const window = options.window()
    if (!window || window.isDestroyed()) throw new Error('Window is unavailable')
    if (!available.includes(material)) throw new Error('Window material is unavailable')
    window.setBackgroundColor(material === 'vibrancy' ? '#00000000' : backgroundColor)
    if (options.platform === 'darwin')
      window.setVibrancy(material === 'vibrancy' ? 'under-window' : null)
    else if (available.includes('mica'))
      window.setBackgroundMaterial(
        material === 'acrylic' ? 'acrylic' : material === 'mica' ? 'mica' : 'none'
      )
  }
  function select(material: unknown): WindowMaterialState {
    if (!available.includes(material as WindowMaterial))
      throw new Error('Window material is unavailable')
    const previous = state().material
    try {
      apply(material as WindowMaterial)
    } catch (error) {
      try {
        apply(previous)
      } catch {
        /* Preserve the original native error. */
      }
      throw error
    }
    options.write('window.material', material)
    options.write('window.mica-enabled', material === 'mica')
    return state()
  }
  return { state, creationOptions, apply, select }
}
