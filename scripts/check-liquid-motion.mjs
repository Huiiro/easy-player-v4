/* eslint @typescript-eslint/explicit-function-return-type: off -- Native Node.js regression checks. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(
  new URL('../src/renderer/src/components/background/liquidMotion.ts', import.meta.url),
  'utf8'
)
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }
}).outputText
const { createLiquidMotion, advanceLiquidMotion } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
)
const loud = { energy: 1, bass: 1, beat: 1 }
const quiet = { energy: 0, bass: 0, beat: 0 }

// Audio changes must produce the same small phase step at startup and after hours.
const early = createLiquidMotion(),
  late = createLiquidMotion()
late.time = 7200
late.phase = 2200
advanceLiquidMotion(early, loud, 1 / 60)
advanceLiquidMotion(late, loud, 1 / 60)
assert(Math.abs(early.phase - (late.phase - 2200)) < 1e-10)
assert(early.phase < 0.006)

// The exact filter response is independent of display frame rate.
const outputs = [30, 60, 144].map((fps) => {
  const state = createLiquidMotion()
  for (let i = 0; i < fps * 2; i++) advanceLiquidMotion(state, loud, 1 / fps)
  return state
})
for (const state of outputs) {
  assert(Math.abs(state.energy.value - outputs[0].energy.value) < 1e-10)
  assert(Math.abs(state.phase - outputs[0].phase) < 0.00002)
}

// Simulate 12 Hz analysis updates alternating between silence and strong beats.
const pulsed = createLiquidMotion()
let maxBeatStep = 0
for (let frame = 0; frame < 600; frame++) {
  const beforePhase = pulsed.phase,
    beforeBeat = pulsed.beat.value
  advanceLiquidMotion(pulsed, Math.floor(frame / 5) % 2 ? loud : quiet, 1 / 60)
  const delta = pulsed.phase - beforePhase
  assert(delta >= 0.28 / 60 - 1e-12 && delta <= 0.315 / 60 + 1e-12)
  maxBeatStep = Math.max(maxBeatStep, Math.abs(pulsed.beat.value - beforeBeat))
  for (const signal of [pulsed.energy, pulsed.bass, pulsed.beat]) {
    assert(Number.isFinite(signal.value) && signal.value >= -1e-10 && signal.value <= 1 + 1e-10)
  }
}
assert(maxBeatStep < 0.04)
const frozen = structuredClone(pulsed)
advanceLiquidMotion(pulsed, loud, 0)
assert.deepEqual(pulsed, frozen)
advanceLiquidMotion(pulsed, { energy: NaN, bass: Infinity, beat: -2 }, 60)
assert(Number.isFinite(pulsed.phase))
assert(pulsed.phase - frozen.phase <= 0.0315)
console.log('Liquid motion checks passed:', {
  maxBeatStep,
  longRunningPhaseStep: late.phase - 2200
})
