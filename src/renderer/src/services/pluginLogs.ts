/** Only host-owned theme wrappers report failures; sandbox frames cannot access IPC. */
export function reportThemeFailure(
  theme: { pluginId: string; revision: string },
  code: string,
  detail?: unknown
): void {
  const message =
    detail instanceof Error
      ? detail.message
      : typeof detail === 'string' || typeof detail === 'number'
        ? String(detail)
        : code
  try {
    window.api?.plugins?.reportThemeFailure?.(
      theme.pluginId,
      theme.revision,
      code,
      message.slice(0, 4096)
    )
  } catch {
    /* Diagnostic delivery must not interrupt the static fallback. */
  }
}
