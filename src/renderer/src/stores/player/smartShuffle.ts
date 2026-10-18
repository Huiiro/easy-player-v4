export interface ShuffleSong {
  id: number
  artist: string | null
  album: string | null
  songStatus: number
}

export interface ShuffleScore {
  weight: number
  plays: number
  preference: number
}

/** Pure weighted sampling; the player commits round progress after playback succeeds. */
export function selectSmartNext(
  queue: ShuffleSong[],
  currentIndex: number,
  playedIds: Set<number>,
  scores: Map<number, ShuffleScore>,
  random: () => number = Math.random
): number {
  if (currentIndex < -1 || currentIndex >= queue.length) return -1
  let candidates = queue
    .map((song, index) => ({ song, index }))
    .filter(
      ({ song, index }) =>
        index !== currentIndex && song.songStatus !== 0 && !playedIds.has(song.id)
    )
  if (!candidates.length) {
    candidates = queue
      .map((song, index) => ({ song, index }))
      .filter(({ song, index }) => index !== currentIndex && song.songStatus !== 0)
  }
  if (!candidates.length) return -1

  const familiar = candidates.filter(({ song }) => {
    const score = scores.get(song.id)
    return score && score.preference !== -1 && (score.plays > 2 || score.preference === 1)
  })
  const familiarIds = new Set(familiar.map(({ song }) => song.id))
  const discovery = candidates.filter(
    ({ song }) =>
      !familiarIds.has(song.id) &&
      (scores.get(song.id)?.preference ?? 0) !== -1 &&
      (scores.get(song.id)?.plays ?? 0) <= 2
  )
  const roll = random()
  const pool =
    roll < 0.7 && familiar.length
      ? familiar
      : roll < 0.9 && discovery.length
        ? discovery
        : candidates
  const current = queue[currentIndex]
  const weighted = pool.map(({ song, index }) => {
    const score = scores.get(song.id)
    const sameArtist =
      current?.artist &&
      song.artist?.trim().toLocaleLowerCase() === current.artist.trim().toLocaleLowerCase()
    const sameAlbum =
      current?.album &&
      song.album?.trim().toLocaleLowerCase() === current.album.trim().toLocaleLowerCase()
    const diversity = sameArtist || sameAlbum ? 0.4 : 1
    const weight = Number.isFinite(score?.weight) ? score!.weight : 1
    return { index, weight: Math.max(0.02, weight * diversity) }
  })
  const total = weighted.reduce((sum, item) => sum + item.weight, 0)
  let target = random() * total
  for (const item of weighted) {
    target -= item.weight
    if (target <= 0) return item.index
  }
  return weighted[weighted.length - 1].index
}
