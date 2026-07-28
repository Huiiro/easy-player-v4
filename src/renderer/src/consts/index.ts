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
  AMBIENT = 'ambient',
  IMMERSE = 'immerse',
  ALBUM = 'album',
  CUSTOM = 'custom',
  DEFAULT = 'default'
}

export enum TagStyle {
  None = 1,
  Simple = 2,
  Full = 3
}
export const VERSION = __APP_VERSION__
export const ENGINE_VERSION = '1.0.1'
