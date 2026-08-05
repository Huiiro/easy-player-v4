<script setup lang="ts">
const stars = Array.from({ length: 24 }, (_, index) => ({
  id: index,
  x: `${(index * 29 + 5) % 100}%`,
  y: `${(index * 47 + 9) % 100}%`,
  size: `${1 + ((index * 3) % 3)}px`,
  delay: `${-index * 1.1}s`,
  duration: `${4.5 + (index % 6) * 1.1}s`
}))
</script>

<template>
  <div
    class="aurora-background pointer-events-none absolute -inset-6 z-0 overflow-hidden"
    aria-hidden="true"
  >
    <span class="aurora-background__ribbon aurora-background__ribbon--one" />
    <span class="aurora-background__ribbon aurora-background__ribbon--two" />
    <span class="aurora-background__ribbon aurora-background__ribbon--three" />
    <span
      v-for="star in stars"
      :key="star.id"
      class="aurora-background__star"
      :style="{
        left: star.x,
        top: star.y,
        width: star.size,
        height: star.size,
        animationDelay: star.delay,
        animationDuration: star.duration
      }"
    />
  </div>
</template>

<style scoped>
.aurora-background {
  contain: paint;
  background:
    radial-gradient(circle at 15% 19%, rgb(71 239 156 / 76%), transparent 34%),
    radial-gradient(circle at 12% 14%, rgb(86 222 188 / 72%), transparent 42%),
    radial-gradient(circle at 84% 22%, rgb(91 116 255 / 68%), transparent 42%),
    linear-gradient(135deg, #102536, #172345 52%, #15291f);
}
.aurora-background__ribbon {
  position: absolute;
  width: 86%;
  height: 30%;
  border-radius: 50%;
  filter: blur(28px);
  mix-blend-mode: screen;
  opacity: 0.42;
  transform: rotate(-16deg);
}
.aurora-background__ribbon--one {
  top: 12%;
  left: -18%;
  background: #4be5c4;
  animation: aurora-sway 16s ease-in-out infinite alternate;
}
.aurora-background__ribbon--two {
  top: 34%;
  right: -22%;
  background: #7386ff;
  animation: aurora-sway 20s ease-in-out -6s infinite alternate-reverse;
}
.aurora-background__ribbon--three {
  bottom: -8%;
  left: 14%;
  background: #52d66c;
  animation: aurora-sway 18s ease-in-out -10s infinite alternate;
}
.aurora-background__star {
  position: absolute;
  border-radius: 50%;
  background: rgb(229 255 238 / 0.88);
  box-shadow: 0 0 5px rgb(178 255 207 / 0.6);
  animation: aurora-twinkle ease-in-out infinite;
}
@keyframes aurora-sway {
  to {
    transform: translate(18%, 9%) rotate(-8deg) scale(1.12);
  }
}
@keyframes aurora-twinkle {
  0%,
  100% {
    opacity: 0.42;
  }
  50% {
    opacity: 0.92;
  }
}
@media (prefers-reduced-motion: reduce) {
  .aurora-background * {
    animation: none;
  }
}
</style>
