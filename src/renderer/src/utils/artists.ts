export function splitArtists(artist: string | null | undefined, separators: string): string[] {
  const value = artist?.trim()
  if (!value) return []
  if (!separators) return [value]
  const parts = [...new Set(separators)].reduce(
    (values, separator) => values.flatMap((part) => part.split(separator)),
    [value]
  )
  return [...new Set(parts.map((part) => part.trim()).filter(Boolean))]
}

export function formatArtists(
  artist: string | null | undefined,
  separators: string,
  normalizeSeparator: boolean
): string {
  if (!normalizeSeparator) return artist?.trim() ?? ''
  return splitArtists(artist, separators).join(' / ')
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
  let current = ''
  const pushArtist = (): void => {
    const name = current.trim()
    if (name)
      tokens.push({ type: 'artist', text: normalizeSeparator ? name : current, artist: name })
    current = ''
  }
  for (const character of value) {
    if (!separatorSet.has(character)) {
      current += character
      continue
    }
    pushArtist()
    tokens.push({ type: 'separator', text: normalizeSeparator ? ' / ' : character })
  }
  pushArtist()
  return tokens
}
