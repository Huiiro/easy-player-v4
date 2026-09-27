<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const now = ref(new Date())
const time = computed(() =>
  [now.value.getHours(), now.value.getMinutes(), now.value.getSeconds()]
    .map((value) => String(value).padStart(2, '0'))
    .join(':')
)
let timer: ReturnType<typeof setTimeout> | undefined
function tick(): void {
  now.value = new Date()
  // Align each update with the wall clock, including after sleep or a delayed frame.
  timer = setTimeout(tick, 1000 - (Date.now() % 1000))
}
onMounted(tick)
onBeforeUnmount(() => {
  if (timer !== undefined) clearTimeout(timer)
})
</script>

<template>
  <section class="home-clock" :aria-label="t('home.layout.clock')">
    <time class="home-clock-time" :datetime="time" aria-live="off">{{ time }}</time>
  </section>
</template>

<style scoped>
.home-clock {
  display: grid;
  place-items: center;
  min-width: 0;
  padding: 1.25rem 0;
  container-type: inline-size;
}
.home-clock-time {
  color: var(--color-text);
  font-family: inherit;
  font-size: clamp(2rem, 8cqi, 4rem);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.025em;
  line-height: 1.2;
  white-space: nowrap;
}
</style>
