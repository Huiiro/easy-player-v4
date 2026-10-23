import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

/** The carousel owns motion; data fetching only waits for the commit boundary. */
export function useCardTransition(
  element: Ref<HTMLElement | null>,
  reduceMotion: () => boolean
): {
  leave: () => Promise<void>
  enter: () => Promise<void>
  restore: () => void
} {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)')
  const systemReduced = ref(media.matches)
  const syncMedia = (): void => {
    systemReduced.value = media.matches
  }
  media.addEventListener('change', syncMedia)
  let animation: Animation | undefined
  function stop(): void {
    animation?.cancel()
    animation = undefined
  }
  function snapshot(): Keyframe {
    const style = element.value && getComputedStyle(element.value)
    return { opacity: style?.opacity ?? '1', transform: style?.transform ?? 'none' }
  }
  async function animate(
    from: Keyframe,
    to: Keyframe,
    token: string,
    fallback: number,
    hold = false
  ): Promise<void> {
    stop()
    const target = element.value
    if (!target || reduceMotion() || systemReduced.value) return
    const configured = getComputedStyle(target).getPropertyValue(token).trim()
    const duration = Number.parseFloat(configured)
    const current = target.animate([from, to], {
      duration: Number.isFinite(duration)
        ? duration * (configured.endsWith('ms') ? 1 : 1000)
        : fallback,
      easing: hold ? 'cubic-bezier(0.4, 0, 1, 1)' : 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'both'
    })
    animation = current
    await current.finished.catch(() => undefined)
    if (animation === current && !hold) stop()
  }
  function leave(): Promise<void> {
    return animate(
      snapshot(),
      { opacity: 0, transform: 'translateY(-12px) scale(0.985)' },
      '--motion-duration-standard',
      200,
      true
    )
  }
  function enter(): Promise<void> {
    return animate(
      { opacity: 0, transform: 'translateY(16px) scale(0.985)' },
      { opacity: 1, transform: 'none' },
      '--motion-duration-emphasized',
      400
    )
  }
  function restore(): void {
    if (animation)
      void animate(snapshot(), { opacity: 1, transform: 'none' }, '--motion-duration-fast', 150)
  }
  watch(
    () => reduceMotion() || systemReduced.value,
    (reduced) => {
      if (reduced) stop()
    }
  )
  onBeforeUnmount(() => {
    // The mode wrapper can still be fading out after its slot unmounts. Freeze
    // the current pose so cancelling Web Animations does not flash it back to 1.
    if (animation && element.value) {
      const style = getComputedStyle(element.value)
      element.value.style.opacity = style.opacity
      element.value.style.transform = style.transform
    }
    stop()
    media.removeEventListener('change', syncMedia)
  })
  return { leave, enter, restore }
}
