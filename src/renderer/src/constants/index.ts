declare const __APP_VERSION__: string
declare const __APP_BUILD__: string
export enum PlayMode {
  Sequential = 0,
  List = 1,
  Single = 2,
  Random = 3
}

export enum PlayerDisplayMode {
  Normal = 0,
  Lyrics = 1,
  Simple = 2,
  Dynamic = 3
}

export enum PlayerBgType {
  ALBUM = 'album',
  AMBIENT = 'ambient',
  LIQUID = 'liquid',
  MESH = 'mesh',
  PARTICLES = 'particles',
  CHEER = 'cheer'
}

export const PLAYER_BG_TYPES = [
  PlayerBgType.ALBUM,
  PlayerBgType.AMBIENT,
  PlayerBgType.LIQUID,
  PlayerBgType.MESH,
  PlayerBgType.PARTICLES,
  PlayerBgType.CHEER
] as const

export const DEFAULT_PLAYER_BG_TYPE = PlayerBgType.ALBUM
export const DEFAULT_PLAYER_CHEER_COLOR = '#FF532D'
export const DEFAULT_PLAYER_CHEER_COLORS = [
  DEFAULT_PLAYER_CHEER_COLOR,
  '#53E5D2',
  '#AF8AFF'
] as const
export const MAX_PLAYER_CHEER_COLORS = 4
export type PlayerCheerColorMode = 'single' | 'mixed'

export interface PlayerCheerLights {
  density: number
  uniformity: number
  brightness: number
}

export const DEFAULT_PLAYER_CHEER_LIGHTS: Readonly<PlayerCheerLights> = {
  density: 65,
  uniformity: 50,
  brightness: 100
}
export const MAX_PLAYER_CHEER_BRIGHTNESS = 150

function parsePlayerCheerColor(value: unknown): string | undefined {
  const hex = typeof value === 'string' ? value.trim() : ''
  return /^#[0-9a-f]{6}$/i.test(hex) ? hex.toUpperCase() : undefined
}

export function resolvePlayerCheerColor(value: unknown): string {
  return parsePlayerCheerColor(value) ?? DEFAULT_PLAYER_CHEER_COLOR
}

export function resolvePlayerCheerColorMode(value: unknown): PlayerCheerColorMode {
  return value === 'mixed' ? 'mixed' : 'single'
}

export function resolvePlayerCheerColors(value: unknown): string[] {
  const colors = Array.isArray(value)
    ? value
        .map(parsePlayerCheerColor)
        .filter((color): color is string => color !== undefined)
        .slice(0, MAX_PLAYER_CHEER_COLORS)
    : []
  if (!colors.length) return [...DEFAULT_PLAYER_CHEER_COLORS]
  if (colors.length === 1) {
    const [first, second] = DEFAULT_PLAYER_CHEER_COLORS
    colors.push(colors[0] === first ? second : first)
  }
  return colors
}

export function resolvePlayerCheerLights(value: unknown): PlayerCheerLights {
  const lights = value && typeof value === 'object' ? (value as Partial<PlayerCheerLights>) : {}
  const percent = (key: keyof PlayerCheerLights, max = 100): number => {
    const amount = lights[key]
    return typeof amount === 'number' && Number.isFinite(amount)
      ? Math.max(0, Math.min(max, Math.round(amount)))
      : DEFAULT_PLAYER_CHEER_LIGHTS[key]
  }
  return {
    density: percent('density'),
    uniformity: percent('uniformity'),
    brightness: percent('brightness', MAX_PLAYER_CHEER_BRIGHTNESS)
  }
}

export enum PlayerCoverStyle {
  STANDARD = 'standard',
  VINYL = 'vinyl'
}

export const DEFAULT_PLAYER_COVER_STYLE = PlayerCoverStyle.STANDARD

export enum PlayerCoverEffect {
  NONE = 'none',
  GLOW = 'glow'
}

export const DEFAULT_PLAYER_COVER_EFFECT = PlayerCoverEffect.GLOW

export function resolvePlayerCoverEffect(value: unknown): PlayerCoverEffect {
  return value === PlayerCoverEffect.NONE ? PlayerCoverEffect.NONE : DEFAULT_PLAYER_COVER_EFFECT
}

export function resolvePlayerCoverStyle(value: unknown): PlayerCoverStyle {
  return value === PlayerCoverStyle.VINYL ? PlayerCoverStyle.VINYL : DEFAULT_PLAYER_COVER_STYLE
}

export interface PlayerBgAvailability {
  coverAvailable?: boolean
  liquidAvailable?: boolean
  meshAvailable?: boolean
  particlesAvailable?: boolean
}

export function resolvePlayerBgType(
  value: unknown,
  availability: PlayerBgAvailability = {}
): PlayerBgType {
  if (value === 'stage') return PlayerBgType.CHEER
  const selected = PLAYER_BG_TYPES.includes(value as PlayerBgType)
    ? (value as PlayerBgType)
    : DEFAULT_PLAYER_BG_TYPE
  if (selected === PlayerBgType.ALBUM && availability.coverAvailable === false)
    return PlayerBgType.AMBIENT
  if (selected === PlayerBgType.LIQUID && availability.liquidAvailable === false)
    return PlayerBgType.AMBIENT
  if (selected === PlayerBgType.MESH && availability.meshAvailable === false)
    return PlayerBgType.AMBIENT
  if (selected === PlayerBgType.PARTICLES && availability.particlesAvailable === false)
    return PlayerBgType.AMBIENT
  return selected
}

export function resolvePlayerBgTypeBeforeCheer(value: unknown): PlayerBgType {
  const background = resolvePlayerBgType(value)
  return background === PlayerBgType.CHEER ? DEFAULT_PLAYER_BG_TYPE : background
}

export enum TagStyle {
  None = 1,
  Simple = 2,
  Full = 3
}
export const VERSION = __APP_VERSION__
export const BUILD_NUMBER = __APP_BUILD__
export const ENGINE_VERSION = '1.0.5'
