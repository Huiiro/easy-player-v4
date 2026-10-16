export const THEME_SLOTS = {
  appBackground: { selector: '.ep-app-background', image: true, font: false },
  home: { selector: '.ep-home', image: true, font: true },
  sidebar: { selector: '.ep-sidebar', image: true, font: true },
  header: { selector: '.ep-header', image: true, font: true },
  footer: { selector: '.ep-footer', image: true, font: true },
  button: { selector: '.ep-button', image: true, font: true },
  dialog: { selector: '.ep-dialog-panel', image: true, font: true },
  drawer: { selector: '.ep-drawer-panel', image: true, font: true },
  menu: { selector: '.ep-menu', image: true, font: true },
  playbackThumb: { selector: '.ep-playback-progress', image: true, font: false },
  global: { selector: 'body', image: false, font: true }
} as const
export type ThemeSlot = keyof typeof THEME_SLOTS
export interface ThemeResource {
  type: 'font' | 'image'
  path: string
  weight?: string
  style?: 'normal' | 'italic'
}
export interface ThemeManifest {
  version: 1
  id: string
  theme: string
  resources: Record<string, ThemeResource>
  slots: Partial<Record<ThemeSlot, { image?: string; font?: string }>>
  text?: { appTitle?: string; homeWelcome?: string }
  licenses?: string[]
}
export interface InstalledThemePackage {
  id: string
  manifest: ThemeManifest
}
export const isPackageId = (id: unknown): id is string =>
  typeof id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id)
export function isThemeResourcePath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length <= 160 &&
    /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(path)
  )
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
export function parseThemeManifest(value: unknown): ThemeManifest {
  if (
    !object(value) ||
    value.version !== 1 ||
    typeof value.id !== 'string' ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.id) ||
    !isThemeResourcePath(value.theme) ||
    !value.theme.endsWith('.json') ||
    !object(value.resources) ||
    !object(value.slots)
  )
    throw new Error('Invalid theme manifest')
  if (Object.keys(value.resources).length > 64) throw new Error('Too many theme resources')
  const resources: Record<string, ThemeResource> = Object.create(null)
  for (const [id, resource] of Object.entries(value.resources)) {
    if (
      !/^[a-z][a-z0-9-]{0,63}$/.test(id) ||
      !object(resource) ||
      !isThemeResourcePath(resource.path)
    )
      throw new Error(`Invalid resource: ${id}`)
    const type = resource.type
    if (type !== 'font' && type !== 'image') throw new Error(`Invalid resource type: ${id}`)
    if (
      !(type === 'font' ? /\.(woff2?|ttf|otf)$/i : /\.(png|jpe?g|webp|gif)$/i).test(resource.path)
    )
      throw new Error(`Unsupported resource format: ${id}`)
    if (
      resource.weight !== undefined &&
      (typeof resource.weight !== 'string' ||
        !/^(?:[1-9]00|[1-9]00 [1-9]00)$/.test(resource.weight))
    )
      throw new Error('Invalid font weight')
    if (resource.style !== undefined && resource.style !== 'normal' && resource.style !== 'italic')
      throw new Error('Invalid font style')
    resources[id] = {
      type,
      path: resource.path,
      weight: resource.weight as string | undefined,
      style: resource.style as ThemeResource['style']
    }
  }
  const slots: ThemeManifest['slots'] = Object.create(null)
  for (const [slot, assignment] of Object.entries(value.slots)) {
    if (!Object.hasOwn(THEME_SLOTS, slot) || !object(assignment))
      throw new Error(`Unknown theme slot: ${slot}`)
    const target = THEME_SLOTS[slot as ThemeSlot]
    const result: { image?: string; font?: string } = {}
    for (const [kind, resourceId] of Object.entries(assignment)) {
      if (
        (kind !== 'image' && kind !== 'font') ||
        !target[kind] ||
        typeof resourceId !== 'string' ||
        resources[resourceId]?.type !== kind
      )
        throw new Error(`Invalid ${slot} resource assignment`)
      result[kind] = resourceId
    }
    slots[slot as ThemeSlot] = result
  }
  const text: NonNullable<ThemeManifest['text']> = {}
  if (value.text !== undefined) {
    if (!object(value.text)) throw new Error('Invalid theme text')
    for (const [slot, content] of Object.entries(value.text)) {
      if (
        (slot !== 'appTitle' && slot !== 'homeWelcome') ||
        typeof content !== 'string' ||
        content.length > 200 ||
        Array.from(content).some((char) => char.charCodeAt(0) < 9)
      )
        throw new Error(`Invalid text slot: ${slot}`)
      text[slot] = content
    }
  }
  const licenses = value.licenses ?? []
  if (
    !Array.isArray(licenses) ||
    licenses.length > 8 ||
    !licenses.every((file) => isThemeResourcePath(file) && file.endsWith('.txt'))
  )
    throw new Error('Invalid theme license files')
  return { version: 1, id: value.id, theme: value.theme, resources, slots, text, licenses }
}
export function themeResourceURL(id: string, path: string): string {
  if (!isPackageId(id) || !isThemeResourcePath(path)) throw new Error('Invalid theme resource URL')
  return `easy-player-media://theme/${id}/${path}`
}
