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
    normalizeMetadataSeparator:
      typeof preferences.normalizeMetadataSeparator === 'boolean'
        ? preferences.normalizeMetadataSeparator
        : normalizeArtistSeparator === true || normalizeGenreSeparator === true
  }
}
