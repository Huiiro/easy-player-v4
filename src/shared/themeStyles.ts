export const themeSelectorPattern =
  /^\.ep-[a-z][a-z0-9-]*(?::(?:hover|focus-visible|disabled))?(?: \.ep-[a-z][a-z0-9-]*(?::(?:hover|focus-visible|disabled))?)*$/
export const themeTokenPattern = /^--(?:color|btn|scrollbar|app|ep|lrc|motion)-[a-z0-9-]+$/
// Keep theme files declarative and local: no imports, URLs, escaping or CSS injection.
export function safeThemeValue(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 500 &&
    !/[;{}<>@\\!]/.test(value) &&
    !Array.from(value).some((char) => char.charCodeAt(0) < 32) &&
    !/(?:url|image-set|expression)\s*\(/i.test(value) &&
    !/\/\*/.test(value)
  )
}
