const keyAliases: Record<string, string> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ' ': 'space',
  Escape: 'esc'
}

export function normalizeShortcut(event: KeyboardEvent): string {
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return ''
  const modifiers = [
    event.ctrlKey ? 'ctrl' : '',
    event.altKey ? 'alt' : '',
    event.metaKey ? 'meta' : '',
    event.shiftKey ? 'shift' : ''
  ].filter(Boolean)
  return [...modifiers, keyAliases[event.key] || event.key.toLowerCase()].join('+')
}

export function formatShortcut(shortcut: string): string {
  const labels: Record<string, string> = {
    ctrl: 'CTRL',
    alt: 'ALT',
    shift: 'SHIFT',
    meta: 'META',
    space: 'SPACE',
    esc: 'ESC',
    up: '↑',
    down: '↓',
    left: '←',
    right: '→'
  }
  return shortcut
    .split('+')
    .filter(Boolean)
    .map((key) => labels[key.toLowerCase()] || key.toUpperCase())
    .join(' + ')
}
