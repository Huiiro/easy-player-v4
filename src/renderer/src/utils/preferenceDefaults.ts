import { isRef, unref } from 'vue'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** Capture setup defaults before Pinia hydrates persisted preferences. */
export function capturePreferenceDefaults(
  state: Record<string, unknown>,
  keys: readonly string[]
): () => void {
  const defaults = Object.fromEntries(keys.map((key) => [key, clone(unref(state[key]))]))
  return () => {
    for (const key of keys) {
      const target = state[key]
      const value = clone(defaults[key])
      if (isRef(target)) target.value = value
      else if (target && typeof target === 'object') Object.assign(target, value)
    }
  }
}
