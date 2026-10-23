import { NORMALIZED_METADATA_SEPARATOR, splitMetadataValues } from '../../../shared/metadataValues'

export const splitArtists = splitMetadataValues

export function formatArtists(
  artist: string | null | undefined,
  separators: string,
  normalizeSeparator: boolean
): string {
  if (!normalizeSeparator) return artist?.trim() ?? ''
  return splitArtists(artist, separators).join(NORMALIZED_METADATA_SEPARATOR)
}

export type ArtistDisplayToken =
  { type: 'artist'; text: string; artist: string } | { type: 'separator'; text: string }

export function artistDisplayTokens(
  artist: string | null | undefined,
  separators: string,
  normalizeSeparator: boolean
): ArtistDisplayToken[] {
  const value = artist?.trim()
  if (!value) return []
  const separatorSet = new Set(separators)
  const tokens: ArtistDisplayToken[] = []
  if (normalizeSeparator) {
    for (const name of splitArtists(value, separators)) {
      if (tokens.length) tokens.push({ type: 'separator', text: NORMALIZED_METADATA_SEPARATOR })
      tokens.push({ type: 'artist', text: name, artist: name })
    }
    return tokens
  }
  let current = ''
  const pushArtist = (): void => {
    const name = current.trim()
    if (name) tokens.push({ type: 'artist', text: current, artist: name })
    current = ''
  }
  for (const character of value) {
    if (!separatorSet.has(character)) {
      current += character
      continue
    }
    pushArtist()
    tokens.push({ type: 'separator', text: character })
  }
  pushArtist()
  return tokens
}
