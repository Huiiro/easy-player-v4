import { THEME_GLASS_TOKENS, type PluginThemeGlassToken } from '../../../../packages/plugin-sdk/src'
import { STUDIO_BLUR_RADIUS } from './liquidGlassProfile'

function token(name: PluginThemeGlassToken, fallback?: string): string {
  return `var(${name}, ${fallback ?? THEME_GLASS_TOKENS[name].value})`
}

const attribute = 'data-ep-glass-components'
const scope = `html[${attribute}="liquid-glass-studio"]`

/** The importable theme's component treatments, using the current theme palette. */
const css = `
${scope} {
  --ep-control-radius: ${token('--ep-glass-control-radius')} !important;
  --ep-button-radius: ${token('--ep-glass-button-radius')} !important;
  --ep-dialog-radius: ${token('--ep-glass-dialog-radius')} !important;
  --ep-floating-radius: ${token('--ep-glass-floating-radius')} !important;
  --ep-sidebar-item-radius: 12px !important;
  --ep-sidebar-bg: color-mix(in srgb, var(--color-bg) 4%, transparent) !important;
  --ep-sidebar-text: var(--color-text-l) !important;
  --ep-sidebar-active-bg: color-mix(in srgb, var(--color-primary) 16%, transparent) !important;
  --ep-sidebar-active-text: color-mix(in srgb, var(--color-text) 80%, var(--color-primary)) !important;
  --ep-dialog-bg: color-mix(in srgb, var(--color-bg) 8%, transparent) !important;
  --ep-overlay-bg: rgb(0 5 18 / 18%) !important;
  --ep-menu-glass-bg: color-mix(in srgb, var(--color-bg) 12%, transparent) !important;
  --ep-menu-glass-text: var(--color-text) !important;
  --ep-surface-shadow: ${token('--ep-glass-surface-shadow')} !important;
  --ep-progress-fill: ${token('--ep-glass-track-fill')} !important;
  --ep-switch-inactive: ${token('--ep-glass-switch-inactive')} !important;
  --ep-switch-thumb: ${token('--ep-glass-switch-thumb')} !important;
  --ep-range-thumb-bg: ${token('--ep-glass-thumb')} !important;
  --ep-skeleton-bg: ${token('--ep-glass-skeleton')} !important;
  --ep-progress-track: ${token('--ep-glass-track')} !important;
  --ep-progress-thumb: ${token('--ep-glass-thumb')} !important;
  --scrollbar-thumb: color-mix(in srgb, var(--color-text) 28%, transparent) !important;
  --scrollbar-thumb-hover: color-mix(in srgb, var(--color-text) 46%, transparent) !important;
}
/* This selector also covers portals before asynchronous surface discovery. */
${scope} :is(.ep-header, .ep-sidebar, .ep-footer, .ep-dialog-panel, .ep-drawer-panel, .ep-menu, .ep-popover, .ep-select-options, .ep-color-picker, .ep-message, .ep-glass-panel, .ep-backtop, .ep-tooltip) {
  isolation: isolate;
  background-color: color-mix(in srgb, var(--color-bg) var(--ep-studio-surface-tint, var(--ep-glass-chrome-tint, 4%)), transparent) !important;
  background-image: none !important;
  backdrop-filter: blur(calc(var(--ep-studio-blur-radius, 0) * var(--ep-glass-fallback-blur-unit))) saturate(1);
}
${scope} :is(.ep-header, .ep-sidebar, .ep-footer, .ep-dialog-panel, .ep-drawer-panel, .ep-menu, .ep-popover, .ep-select-options, .ep-color-picker, .ep-message, .ep-glass-panel, .ep-tooltip) {
  transition-property: color, background-color, border-color, box-shadow, opacity, transform, translate, scale, rotate, width, height, min-height, max-width, padding, gap, border-radius, grid-template-columns !important;
}
${scope} .ep-footer { border-radius: var(--ep-dialog-radius); --ep-studio-surface-tint: ${token('--ep-glass-footer-tint')}; }
${scope} .ep-sidebar {
  border-radius: 20px;
  border-right: 1px solid color-mix(in srgb, var(--color-text) 8%, transparent);
}
${scope} :is(.ep-dialog-panel, .ep-drawer-panel, .ep-glass-panel) {
  --ep-studio-surface-tint: ${token('--ep-glass-panel-tint')};
  --ep-studio-blur-radius: ${token('--ep-glass-floating-blur-radius', String(STUDIO_BLUR_RADIUS))};
  border: 1px solid color-mix(in srgb, var(--color-text) 10%, transparent);
}
${scope} :is(.ep-menu, .ep-popover, .ep-select-options, .ep-color-picker, .ep-message) {
  --ep-studio-surface-tint: ${token('--ep-glass-floating-tint')};
  --ep-studio-blur-radius: ${token('--ep-glass-floating-blur-radius', String(STUDIO_BLUR_RADIUS))};
  background-color: var(--ep-menu-glass-bg);
  border-radius: var(--ep-floating-radius);
}
${scope} .ep-menu--glass {
  color: var(--color-text);
  border-radius: var(--ep-floating-radius);
}
${scope} .ep-menu--glass .ep-menu-item:not(:disabled)[data-active='true'] {
  background: color-mix(in srgb, var(--color-text) 8%, transparent);
  color: var(--color-text);
}
${scope} .ep-menu--glass .ep-menu-item[data-selected='true'],
${scope} .ep-select-option[data-headlessui-state~='selected'] {
  background: color-mix(in srgb, var(--color-primary) 16%, transparent);
  color: var(--ep-sidebar-active-text);
}
${scope} .ep-select-option[data-headlessui-state~='active']:not([aria-disabled='true']):not([data-headlessui-state~='selected']) {
  background: color-mix(in srgb, var(--color-text) 8%, transparent);
  color: var(--color-text);
}
${scope} .ep-button--secondary {
  background-color: ${token('--ep-glass-control-bg')};
  background-image: ${token('--ep-glass-control-highlight')};
  border-color: ${token('--ep-glass-control-border')};
  box-shadow: ${token('--ep-glass-control-shadow')};
}
${scope} .ep-button--secondary:enabled:hover {
  background-color: color-mix(in srgb, var(--color-primary) 10%, transparent);
  border-color: color-mix(in srgb, var(--color-primary) 24%, transparent);
}
${scope} .ep-button--primary {
  box-shadow: ${token('--ep-glass-control-shadow', 'inset 0 1px 0 rgb(255 255 255 / 32%), 0 4px 16px color-mix(in srgb, var(--color-primary) 14%, transparent)')};
}
${scope} :is(.ep-input, .input-base) {
  background-color: ${token('--ep-glass-input-bg')};
  backdrop-filter: none;
  background-image: ${token('--ep-glass-control-highlight', 'linear-gradient(135deg, rgb(255 255 255 / 6%), rgb(255 255 255 / 1%))')};
  box-shadow: ${token('--ep-glass-control-shadow')};
  border-radius: var(--ep-control-radius);
}
${scope} :is(.ep-input, .input-base):where(:not(:focus):not([aria-invalid='true']):not(:invalid)) {
  border-color: ${token('--ep-glass-control-border')};
}
${scope} .ep-lyric-textarea {
  background-color: rgb(255 255 255 / 6%);
}
${scope} .ep-select { border-radius: var(--ep-control-radius); }
${scope} .ep-color-trigger {
  border-radius: var(--ep-control-radius);
  background-color: ${token('--ep-glass-control-bg')};
  background-image: ${token('--ep-glass-control-highlight')};
  box-shadow: ${token('--ep-glass-control-shadow')};
}
${scope} .ep-message { border-radius: ${token('--ep-glass-message-radius')}; }
${scope} .ep-tooltip {
  --ep-studio-surface-tint: ${token('--ep-glass-floating-tint')};
  --ep-studio-blur-radius: ${token('--ep-glass-floating-blur-radius', String(STUDIO_BLUR_RADIUS))};
  background-color: var(--ep-tooltip-bg, var(--ep-menu-glass-bg)) !important;
  border-color: var(--ep-tooltip-border, ${token('--ep-glass-control-border')}) !important;
  box-shadow: var(--ep-tooltip-shadow, ${token('--ep-glass-surface-shadow')}) !important;
}
${scope} .ep-backtop {
  --ep-studio-surface-tint: ${token('--ep-glass-chrome-tint')};
  --ep-studio-blur-radius: 0;
  background-color: color-mix(in srgb, var(--color-bg) ${token('--ep-glass-chrome-tint')}, transparent);
  background-image: ${token('--ep-glass-control-highlight')};
  border-color: ${token('--ep-glass-control-border')};
  box-shadow: ${token('--ep-glass-surface-shadow')};
}
${scope} .ep-backtop::before { background: color-mix(in srgb, var(--color-primary) 10%, transparent); }
${scope} :is(.ep-switch-track, .ep-switch-thumb, .ep-progress-thumb) {
  background-image: ${token('--ep-glass-control-highlight')};
  box-shadow: ${token('--ep-glass-control-shadow')};
  border: 1px solid ${token('--ep-glass-control-border')};
  box-sizing: border-box;
}
${scope} .ep-progress-track { box-shadow: inset 0 1px 2px rgb(0 0 0 / 12%); }
${scope} .ep-range::-webkit-slider-thumb {
  border: 1px solid ${token('--ep-glass-control-border')};
  box-shadow: ${token('--ep-glass-control-shadow')};
}
${scope} .ep-skeleton-block {
  background-image: ${token('--ep-glass-control-highlight')};
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 10%);
}
${scope}[class~='reduce-motion'] .ep-skeleton { animation: none; }
@media (prefers-reduced-motion: reduce) { ${scope} .ep-skeleton { animation: none; } }

`

export function mountGlassComponentEffects(): () => void {
  const root = document.documentElement
  const previous = root.getAttribute(attribute)
  const style = document.createElement('style')
  style.id = 'ep-glass-component-effects'
  style.textContent =
    css + `${scope}{--ep-glass-fallback-blur-unit:${1 / (3 * (window.devicePixelRatio || 1))}px}`
  document.head.append(style)
  root.setAttribute(attribute, 'liquid-glass-studio')
  return () => {
    style.remove()
    if (root.getAttribute(attribute) !== 'liquid-glass-studio') return
    if (previous === null) root.removeAttribute(attribute)
    else root.setAttribute(attribute, previous)
  }
}
