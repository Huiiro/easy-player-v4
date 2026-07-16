export function initGlobalRipple(): void {
  document.addEventListener('click', (e: MouseEvent) => {
    if (e.button !== 0) return

    for (let i = 0; i < 2; i++) {
      const ripple = document.createElement('span')

      const baseSize = 28
      const size = baseSize + i * 35
      const x = e.clientX - size / 2
      const y = e.clientY - size / 2

      ripple.style.cssText = `
        position: fixed;
        left: ${x}px;
        top: ${y}px;
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        pointer-events: none;
        background: transparent;
        border: 1px solid rgba(110, 110, 110, 0.92);
        transform: scale(0.2);
        opacity: 1;
        animation: ripple-wave 420ms cubic-bezier(0.1, 0.7, 0.2, 1) forwards;
        animation-delay: ${i * 60}ms;
        z-index: 9999;
        will-change: transform, opacity;
      `

      document.body.appendChild(ripple)

      ripple.addEventListener('animationend', () => {
        ripple.remove()
      })
    }
  })
}
