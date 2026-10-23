/** Shared public UI contracts. Business models belong to their feature modules. */
export type ControlSize = 'xs' | 'sm' | 'md' | 'lg'
export type FloatingSide = 'top' | 'bottom' | 'left' | 'right'
export type FloatingAlign = 'start' | 'center' | 'end'
export type PageTransition = 'none' | 'fade' | 'slide'

export function cssSize(value: string | number): string {
  return typeof value === 'number' ? `${value}px` : value
}
