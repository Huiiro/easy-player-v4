import { isSystemBackground } from '@/components/background/systemBackgroundRegistry'

/** Migrate the former artist/genre switches before Pinia picks persisted fields. */
export function deserializeUIPreferences(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const { normalizeArtistSeparator, normalizeGenreSeparator, ...preferences } = parsed as Record<
    string,
    unknown
  >
  return {
    ...preferences,
    playerLyricsFontWeight:
      typeof preferences.playerLyricsFontWeight === 'number' &&
      [300, 400, 500, 600, 700, 800].includes(preferences.playerLyricsFontWeight)
        ? preferences.playerLyricsFontWeight
        : 700,
    interfaceEffect:
      preferences.interfaceEffect === 'liquid-glass-studio' ? 'liquid-glass-studio' : 'none',
    autoCheckUpdates:
      typeof preferences.autoCheckUpdates === 'boolean' ? preferences.autoCheckUpdates : true,
    ignoredUpdateVersions: Array.isArray(preferences.ignoredUpdateVersions)
      ? preferences.ignoredUpdateVersions.filter(
          (version): version is string => typeof version === 'string'
        )
      : [],
    systemBackground: isSystemBackground(preferences.systemBackground)
      ? preferences.systemBackground
      : 'none',
    normalizeMetadataSeparator:
      typeof preferences.normalizeMetadataSeparator === 'boolean'
        ? preferences.normalizeMetadataSeparator
        : normalizeArtistSeparator === true || normalizeGenreSeparator === true
  }
}
