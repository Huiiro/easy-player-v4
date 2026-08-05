<script setup lang="ts">
const bubbles = Array.from({ length: 26 }, (_, index) => ({
  id: index,
  x: `${(index * 31 + 8) % 100}%`,
  size: `${5 + ((index * 5) % 12)}px`,
  delay: `${-index * 1.2}s`,
  duration: `${10 + (index % 5) * 2}s`
}))
</script>

<template>
  <div
    class="ocean-background pointer-events-none absolute -inset-6 z-0 overflow-hidden"
    aria-hidden="true"
  >
    <span class="ocean-background__moon" />
    <span class="ocean-background__wave ocean-background__wave--back" />
    <span class="ocean-background__wave ocean-background__wave--front" />
    <span
      v-for="bubble in bubbles"
      :key="bubble.id"
      class="ocean-background__bubble"
      :style="{
        left: bubble.x,
        width: bubble.size,
        height: bubble.size,
        animationDelay: bubble.delay,
        animationDuration: bubble.duration
      }"
    />
  </div>
</template>

<style scoped>
.ocean-background {
  contain: paint;
  background:
    radial-gradient(circle at 78% 15%, rgb(91 211 255 / 62%), transparent 36%),
    radial-gradient(circle at 18% 82%, rgb(35 112 201 / 68%), transparent 43%),
    linear-gradient(135deg, #071c34, #0d3c5e 52%, #102c4d);
}
.ocean-background__moon {
  position: absolute;
  top: 11%;
  right: 15%;
  width: 18vmin;
  height: 18vmin;
  border-radius: 50%;
  background: rgb(184 237 255 / 0.38);
  box-shadow: 0 0 42px rgb(94 212 255 / 0.48);
  animation: ocean-moon 8s ease-in-out infinite alternate;
}
.ocean-background__wave {
  position: absolute;
  right: -20%;
  bottom: -14%;
  left: -20%;
  height: 44%;
  border-radius: 44% 56% 0 0;
  transform-origin: center bottom;
}
.ocean-background__wave--back {
  background: rgb(31 138 192 / 0.42);
  animation: ocean-wave 15s ease-in-out infinite alternate;
}
.ocean-background__wave--front {
  bottom: -22%;
  background: rgb(15 77 138 / 0.7);
  animation: ocean-wave 11s ease-in-out -4s infinite alternate-reverse;
}
.ocean-background__bubble {
  position: absolute;
  bottom: -10%;
  border: 1px solid rgb(191 239 255 / 0.56);
  border-radius: 50%;
  box-shadow:
    inset 2px 2px 4px rgb(255 255 255 / 0.38),
    0 0 8px rgb(84 206 255 / 0.18);
  animation-name: ocean-bubble;
  animation-timing-function: ease-in;
  animation-iteration-count: infinite;
}
@keyframes ocean-wave {
  to {
    transform: translateX(9%) rotate(4deg) scaleX(1.08);
  }
}
@keyframes ocean-moon {
  to {
    transform: translateY(12px);
    opacity: 0.7;
  }
}
@keyframes ocean-bubble {
  to {
    transform: translateY(-115vh) translateX(28px);
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ocean-background * {
    animation: none;
  }
}
</style>
