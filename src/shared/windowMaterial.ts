export type WindowMaterial = 'none' | 'mica' | 'acrylic' | 'vibrancy'

export interface WindowMaterialState {
  available: WindowMaterial[]
  material: WindowMaterial
  enabled: boolean
}

export function availableWindowMaterials(platform: string, release: string): WindowMaterial[] {
  if (platform === 'darwin') return ['none', 'vibrancy']
  const build = Number(release.split('.')[2])
  if (platform === 'win32' && Number.isFinite(build) && build >= 22621)
    return ['none', 'mica', 'acrylic']
  return ['none']
}

export function resolveWindowMaterial(
  saved: unknown,
  legacyMica: unknown,
  available: WindowMaterial[]
): WindowMaterial {
  // The explicit Off value must take precedence over the old Mica switch.
  if (saved !== undefined && saved !== null)
    return available.includes(saved as WindowMaterial) ? (saved as WindowMaterial) : 'none'
  return legacyMica === true && available.includes('mica') ? 'mica' : 'none'
}
