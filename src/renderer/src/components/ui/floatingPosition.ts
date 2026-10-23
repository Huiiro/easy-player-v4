import type { FloatingAlign, FloatingSide } from './types'

interface Rect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/** Viewport coordinates; DOM observation and teleporting are owned by FloatingPanel. */
export function floatingPosition(
  anchor: Rect,
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
  side: FloatingSide,
  align: FloatingAlign,
  gap = 8,
  padding = 8
): { left: number; top: number; side: FloatingSide; availableHeight: number } {
  const spaces = {
    top: anchor.top - gap - padding,
    bottom: viewport.height - anchor.bottom - gap - padding,
    left: anchor.left - gap - padding,
    right: viewport.width - anchor.right - gap - padding
  }
  const opposite: Record<FloatingSide, FloatingSide> = {
    top: 'bottom',
    bottom: 'top',
    left: 'right',
    right: 'left'
  }
  const needed = side === 'top' || side === 'bottom' ? panel.height : panel.width
  if (spaces[side] < needed && spaces[opposite[side]] > spaces[side]) side = opposite[side]
  const vertical = side === 'top' || side === 'bottom'
  const alignOffset = (length: number, size: number): number =>
    align === 'end' ? length - size : align === 'center' ? (length - size) / 2 : 0
  let left = vertical
    ? anchor.left + alignOffset(anchor.width, panel.width)
    : side === 'left'
      ? anchor.left - gap - panel.width
      : anchor.right + gap
  let top = vertical
    ? side === 'top'
      ? anchor.top - gap - panel.height
      : anchor.bottom + gap
    : anchor.top + alignOffset(anchor.height, panel.height)
  left = Math.max(padding, Math.min(left, viewport.width - panel.width - padding))
  top = Math.max(padding, Math.min(top, viewport.height - panel.height - padding))
  return {
    left,
    top,
    side,
    availableHeight: Math.max(0, vertical ? spaces[side] : viewport.height - padding * 2)
  }
}
