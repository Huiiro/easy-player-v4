declare const __APP_VERSION__: string
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
  LIQUID = 'liquid'
}

export const PLAYER_BG_TYPES = [
  PlayerBgType.ALBUM,
  PlayerBgType.AMBIENT,
  PlayerBgType.LIQUID
] as const

export const DEFAULT_PLAYER_BG_TYPE = PlayerBgType.ALBUM

export interface PlayerBgAvailability {
  coverAvailable?: boolean
  liquidAvailable?: boolean
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
  return selected
}

export enum TagStyle {
  None = 1,
  Simple = 2,
  Full = 3
}
export const VERSION = __APP_VERSION__
export const ENGINE_VERSION = '1.0.2'
