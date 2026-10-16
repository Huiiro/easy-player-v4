export interface FooterLayout {
  enabled: boolean
  mode: 'centered' | 'stacked'
  maxWidth: number
  progressWeight: number
  gap: number
}
export const DEFAULT_FOOTER_LAYOUT: FooterLayout = {
  enabled: false,
  mode: 'centered',
  maxWidth: 1320,
  progressWeight: 2.2,
  gap: 20
}
export function normalizeFooterLayout(value: unknown): FooterLayout {
  const input = value && typeof value === 'object' ? (value as Partial<FooterLayout>) : {}
  const number = (value: unknown, min: number, max: number, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.max(min, Math.min(max, value))
      : fallback
  return {
    enabled: input.enabled === true,
    mode: input.mode === 'stacked' ? 'stacked' : 'centered',
    maxWidth: number(input.maxWidth, 900, 1800, 1320),
    progressWeight: number(input.progressWeight, 1, 4, 2.2),
    gap: DEFAULT_FOOTER_LAYOUT.gap
  }
}
export function footerLayoutStyle(value: unknown): Record<string, string> {
  const layout = normalizeFooterLayout(value)
  if (!layout.enabled) return {}
  const stacked = layout.mode === 'stacked'
  return {
    '--ep-footer-max-width': `${layout.maxWidth}px`,
    '--ep-footer-gap': `${layout.gap}px`,
    '--ep-footer-columns': `32px minmax(0,1fr) minmax(180px,${layout.progressWeight}fr) minmax(0,1fr) 32px`,
    '--ep-footer-areas': stacked
      ? '"info info transport actions toggle"'
      : '"info info playback actions toggle"',
    '--ep-footer-playback-display': stacked ? 'contents' : 'grid',
    '--ep-footer-transport-area': stacked ? 'transport' : 'auto',
    '--ep-footer-progress-area': 'auto',
    '--ep-footer-progress-position': stacked ? 'absolute' : 'static',
    '--ep-footer-progress-inset': stacked ? '0 24px auto' : 'auto',
    '--ep-footer-progress-transform': stacked ? 'translateY(-50%)' : 'none',
    '--ep-footer-progress-columns': stacked ? 'minmax(0,1fr)' : '3.5rem minmax(0,1fr) 3.5rem',
    '--ep-footer-progress-gap': stacked ? '0px' : '8px',
    '--ep-footer-progress-times-display': stacked ? 'none' : 'block',
    '--ep-footer-top-time-display': stacked ? 'block' : 'none',
    '--ep-footer-unplayed-color': stacked ? 'transparent' : 'var(--ep-progress-track)',
    '--ep-footer-show-unplayed': stacked ? '0' : '1'
  }
}

// Let both sides use the space around the centered controls in top-line mode.
// Measure the time label too, since duration, locale and theme fonts affect it.
export function updateFooterSideWidths(footer: HTMLElement): void {
  const info = footer.querySelector<HTMLElement>('.ep-footer-info')
  const actions = footer.querySelector<HTMLElement>('.ep-footer-actions')
  const time = footer.querySelector<HTMLElement>('.ep-footer-top-time')
  const toggle = footer.querySelector<HTMLElement>('.ep-footer-toggle')
  const buttons = footer.querySelector<HTMLElement>('.ep-footer-transport-buttons')
  if (!time || !toggle || getComputedStyle(time).display === 'none') {
    info?.style.removeProperty('width')
    actions?.style.removeProperty('width')
    return
  }
  const gap = Number.parseFloat(getComputedStyle(footer).columnGap) || 0
  const scale = footer.getBoundingClientRect().width / footer.offsetWidth || 1
  const contentGap = Math.max(12, gap)
  if (info && buttons) {
    const available =
      (buttons.getBoundingClientRect().left - info.getBoundingClientRect().left) / scale
    const timeExtent =
      (time.getBoundingClientRect().right - buttons.getBoundingClientRect().right) / scale
    // Mirror the time region on the left, relaxing the inset when song info gets tight.
    const inset = Math.min(timeExtent, Math.max(0, available - contentGap - 200))
    info.style.width = `${Math.max(0, Math.floor(available - contentGap - inset))}px`
  }
  if (actions) {
    const available =
      (toggle.getBoundingClientRect().left - time.getBoundingClientRect().right) / scale -
      gap -
      contentGap
    actions.style.width = `${Math.max(32, Math.floor(available))}px`
  }
}
