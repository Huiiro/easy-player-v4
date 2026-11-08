<script setup lang="ts">
import { gsap } from 'gsap'
import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  value: number | null
  format: (value: number) => string
  loading: boolean
  reduceMotion: boolean
}>()
const amount = { value: 0 }
const text = ref(props.format(0))
const accessibleText = ref(text.value)
const media = window.matchMedia('(prefers-reduced-motion: reduce)')
const systemReduced = ref(media.matches)
let animation: gsap.core.Tween | undefined
let active = true
let target: number | null = 0
let formatter = props.format

function stop(): void {
  animation?.kill()
  animation = undefined
}
function settle(): void {
  stop()
  amount.value = target ?? 0
  text.value = target === null ? '—' : formatter(amount.value)
  accessibleText.value = text.value
}
function syncReducedMotion(): void {
  systemReduced.value = media.matches
}
function visibilityChanged(): void {
  if (document.hidden) settle()
}
watch(
  () =>
    [props.value, props.loading, props.reduceMotion, systemReduced.value, props.format] as const,
  ([value, loading, reduceMotion, systemReduced, format], previous) => {
    stop()
    // Refreshes keep the last rendered value, including an interrupted count-up.
    if (loading) return
    // Compare source totals, not GSAP's rounded intermediate decimal values.
    const replay = previous?.[1] && target === value && value !== null && value > 0
    target = value
    formatter = format
    accessibleText.value = value === null ? '—' : format(value)
    if (value === null || reduceMotion || systemReduced || !active || document.hidden) {
      settle()
      return
    }
    // Keep the old text during loading, then replay the count-up if a refresh
    // returns the same total. Ordinary rerenders must not restart the animation.
    if (replay) amount.value = 0
    text.value = format(amount.value)
    if (amount.value === value) return
    animation = gsap.to(amount, {
      value,
      duration: 1.6,
      ease: 'power3.out',
      onUpdate: () => {
        text.value = format(amount.value)
      },
      onComplete: () => {
        amount.value = value
        text.value = format(value)
        animation = undefined
      }
    })
  },
  { immediate: true }
)
onMounted(() => {
  media.addEventListener('change', syncReducedMotion)
  document.addEventListener('visibilitychange', visibilityChanged)
})
onActivated(() => {
  active = true
})
onDeactivated(() => {
  active = false
  settle()
})
onBeforeUnmount(() => {
  stop()
  media.removeEventListener('change', syncReducedMotion)
  document.removeEventListener('visibilitychange', visibilityChanged)
})
</script>

<template>
  <span class="home-stat-number">
    <span class="sr-only">{{ accessibleText }}</span>
    <span aria-hidden="true">{{ text }}</span>
  </span>
</template>

<style scoped>
.home-stat-number {
  white-space: pre;
}
</style>
