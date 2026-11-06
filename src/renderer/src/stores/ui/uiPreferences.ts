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
