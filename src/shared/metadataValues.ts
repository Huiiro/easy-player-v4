/** Each configured character is a separator, matching the library artist setting. */
export function splitMetadataValues(value: string | null | undefined, separators = ''): string[] {
  const text = value?.trim()
  if (!text) return []
  const parts = [...new Set(separators)].reduce(
    (values, separator) => values.flatMap((part) => part.split(separator)),
    [text]
  )
  return [...new Set(parts.map((part) => part.trim()).filter(Boolean))]
}

/** Keep every native tag value in the library's existing text column. */
export function joinMetadataValues(values: string[] | undefined): string | undefined {
  const names = [...new Set(values?.map((value) => value.trim()).filter(Boolean))]
  return names.length ? names.join(', ') : undefined
}

export const DEFAULT_GENRE_SEPARATOR = '/；;、,，'
export const NORMALIZED_METADATA_SEPARATOR = ' / '

/** Keep genre identity independent of tag spelling and the system locale. */
export function genreMatchKey(name: string): string {
  return name.trim().normalize('NFC').toLowerCase()
}

export function splitGenres(value: string | null | undefined, separators = ''): string[] {
  const names = new Map<string, string>()
  for (const name of splitMetadataValues(value, separators)) {
    const key = genreMatchKey(name)
    if (!names.has(key)) names.set(key, name)
  }
  return [...names.values()]
}
