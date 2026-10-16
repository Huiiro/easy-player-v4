export const SHORTCUT_ACTIONS = [
  'toggle',
  'previous',
  'next',
  'volumeUp',
  'volumeDown',
  'seekBackward',
  'seekForward',
  'like',
  'dislike',
  'toggleDesktopLyrics',
  'enableLightweight'
] as const

export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number]

export const DEFAULT_LOCAL_SHORTCUTS: Record<ShortcutAction, string> = {
  toggle: 'space',
  previous: 'ctrl+left',
  next: 'ctrl+right',
  volumeUp: 'ctrl+up',
  volumeDown: 'ctrl+down',
  seekBackward: 'left',
  seekForward: 'right',
  like: 'ctrl+l',
  dislike: 'ctrl+d',
  toggleDesktopLyrics: 'ctrl+g',
  enableLightweight: 'ctrl+e'
}

export const DEFAULT_GLOBAL_SHORTCUTS = Object.fromEntries(
  SHORTCUT_ACTIONS.map((action) => [action, ''])
) as Record<ShortcutAction, string>
