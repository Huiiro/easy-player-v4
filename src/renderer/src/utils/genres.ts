import { NORMALIZED_METADATA_SEPARATOR, splitGenres } from '../../../shared/metadataValues'

export function formatGenres(
  genre: string | null | undefined,
  separators: string,
  normalizeSeparator: boolean
): string {
  return normalizeSeparator
    ? splitGenres(genre, separators).join(NORMALIZED_METADATA_SEPARATOR)
    : (genre?.trim() ?? '')
}
