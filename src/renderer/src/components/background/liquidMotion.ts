export interface MotionSignal {
  value: number
  velocity: number
}

export interface LiquidMotion {
  time: number
  phase: number
  energy: MotionSignal
  bass: MotionSignal
  beat: MotionSignal
}

export const LIQUID_BASE_SPEED = 0.28
export const LIQUID_ENERGY_SPEED = 0.035

export function createLiquidMotion(): LiquidMotion {
  return {
    time: 0,
    phase: 0,
    energy: { value: 0, velocity: 0 },
    bass: { value: 0, velocity: 0 },
    beat: { value: 0, velocity: 0 }
  }
}

// Exact critically damped response over dt. Both position and velocity stay
// continuous when the low-rate audio analysis delivers a new target.
function smooth(signal: MotionSignal, input: number, rate: number, dt: number): void {
  const target = Number.isFinite(input) ? Math.max(0, Math.min(1, input)) : 0
  const offset = signal.value - target
  const decay = Math.exp(-rate * dt)
  const travel = (signal.velocity + rate * offset) * dt
  signal.value = target + (offset + travel) * decay
  signal.velocity = (signal.velocity - rate * travel) * decay
}

export function advanceLiquidMotion(
  state: LiquidMotion,
  input: { energy: number; bass: number; beat: number },
  seconds: number
): void {
  const dt = Number.isFinite(seconds) ? Math.max(0, Math.min(seconds, 0.1)) : 0
  if (!dt) return
  const previousEnergy = state.energy.value
  smooth(state.energy, input.energy, 6, dt)
  smooth(state.bass, input.bass, 5, dt)
  smooth(state.beat, input.beat, 7, dt)
  state.time += dt
  // Integrate speed, never multiply elapsed time by a changing audio value.
  state.phase +=
    (LIQUID_BASE_SPEED + (previousEnergy + state.energy.value) * 0.5 * LIQUID_ENERGY_SPEED) * dt
}
