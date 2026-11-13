interface WaveGlyph {
  index: number
  start: number
  duration: number
}
export interface LyricWaveRun {
  glyphs: WaveGlyph[]
  end: number
}
export type LyricWaveTimeline = LyricWaveRun[]

export const LYRIC_WAVE_TAIL_MS = 600
const SMOOTHING_MS = 240
const SAMPLES = 16
// A fixed media-time filter keeps the same motion at every refresh rate and
// survives pause/seeks without carrying stale animation state.
const WEIGHTS = Array.from(
  { length: SAMPLES + 1 },
  (_, index) => Math.sin((Math.PI * index) / SAMPLES) ** 2 / (SAMPLES / 2)
)

export function createLyricWaveTimeline(
  entries: { start: number; duration: number }[]
): LyricWaveTimeline {
  const runs: LyricWaveTimeline = []
  entries.forEach((entry, index) => {
    let run = runs.at(-1)
    if (!run || entry.start - run.end > 80) {
      run = { glyphs: [], end: entry.start }
      runs.push(run)
    }
    run.glyphs.push({ index, start: entry.start, duration: Math.max(1, entry.duration) })
    run.end = Math.max(run.end, entry.start + Math.max(1, entry.duration))
  })
  return runs
}

function rawCenter(time: number, run: LyricWaveRun): number {
  const first = run.glyphs[0]
  const last = run.glyphs[run.glyphs.length - 1]
  if (time < first.start) return first.index - 1
  if (time >= run.end) {
    const t = Math.max(0, Math.min(1, (time - run.end) / (LYRIC_WAVE_TAIL_MS - SMOOTHING_MS)))
    const eased = t * t * t * (t * (t * 6 - 15) + 10)
    return last.index + 5 * Math.max(0, Math.min(1, eased))
  }
  for (let index = run.glyphs.length - 1; index >= 0; index--) {
    const glyph = run.glyphs[index]
    if (time < glyph.start) continue
    const end = run.glyphs[index + 1]?.start ?? run.end
    return (
      glyph.index -
      1 +
      Math.max(0, Math.min(1, (time - glyph.start) / Math.max(1, end - glyph.start)))
    )
  }
  return first.index - 1
}

export function sampleLyricWave(
  time: number,
  timeline: LyricWaveTimeline,
  centers: Float64Array
): void {
  timeline.forEach((run, index) => {
    let center = 0
    for (let sample = 0; sample <= SAMPLES; sample++)
      center += rawCenter(time - (sample * SMOOTHING_MS) / SAMPLES, run) * WEIGHTS[sample]
    centers[index] = center
  })
}

export function lyricWaveLift(
  time: number,
  index: number,
  centers: Float64Array,
  timeline: LyricWaveTimeline
): number {
  let lift = 0
  for (let runIndex = 0; runIndex < timeline.length; runIndex++) {
    const run = timeline[runIndex]
    if (index < run.glyphs[0].index || index > run.glyphs[run.glyphs.length - 1].index) continue
    const center = centers[runIndex]
    const t = Math.max(0, Math.min(1, (time - run.glyphs[0].start) / SMOOTHING_MS))
    const entrance = Math.max(0, Math.min(1, t * t * t * (t * (t * 6 - 15) + 10)))
    const distance = index - center
    const width = distance < 0 ? 1.9 : 0.82
    const limit = distance < 0 ? 5 : 3
    const taper = Math.max(0, Math.min(1, limit - Math.abs(distance)))
    // One shared crest raises its neighbors together. Only the remote edge is
    // tapered, preserving the original rounded crest and long trailing slope.
    lift = Math.max(
      lift,
      entrance * Math.exp(-0.5 * (distance / width) ** 2) * taper * taper * (3 - 2 * taper)
    )
  }
  return lift
}
