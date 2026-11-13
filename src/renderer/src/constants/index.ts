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
  PARTICLES = 'particles'
}

export const PLAYER_BG_TYPES = [
  PlayerBgType.ALBUM,
  PlayerBgType.AMBIENT,
  PlayerBgType.LIQUID,
  PlayerBgType.MESH,
  PlayerBgType.PARTICLES
] as const

export const DEFAULT_PLAYER_BG_TYPE = PlayerBgType.ALBUM

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

export enum TagStyle {
  None = 1,
  Simple = 2,
  Full = 3
}
export const VERSION = __APP_VERSION__
export const BUILD_NUMBER = __APP_BUILD__
export const ENGINE_VERSION = '1.0.5'
