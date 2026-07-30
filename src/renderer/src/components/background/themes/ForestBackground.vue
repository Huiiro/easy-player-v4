<script setup lang="ts">
const fireflies = Array.from({ length: 15 }, (_, index) => ({
  id: index,
  x: `${(index * 43 + 7) % 100}%`,
  y: `${22 + ((index * 31) % 68)}%`,
  delay: `${-index * 0.9}s`
}))
const trees = Array.from({ length: 9 }, (_, index) => ({
  id: index,
  x: `${index * 13 - 4}%`,
  scale: 0.65 + ((index * 3) % 6) / 10
}))
</script>

<template>
  <div
    class="forest-background pointer-events-none absolute -inset-6 z-0 overflow-hidden"
    aria-hidden="true"
  >
    <span class="forest-background__canopy forest-background__canopy--near" />
    <span class="forest-background__canopy forest-background__canopy--far" />
    <span class="forest-background__mountain forest-background__mountain--far" />
    <span class="forest-background__mountain forest-background__mountain--near" />
    <span
      v-for="tree in trees"
      :key="tree.id"
      class="forest-background__tree"
      :style="{ left: tree.x, transform: `scale(${tree.scale})` }"
    />
    <span class="forest-background__mist" />
    <span
      v-for="firefly in fireflies"
      :key="firefly.id"
      class="forest-background__firefly"
      :style="{ left: firefly.x, top: firefly.y, animationDelay: firefly.delay }"
    />
  </div>
</template>

<style scoped>
.forest-background {
  background:
    radial-gradient(circle at 22% 22%, rgb(134 207 105 / 62%), transparent 35%),
    radial-gradient(circle at 83% 70%, rgb(44 145 131 / 62%), transparent 40%),
    linear-gradient(135deg, #102b27, #1b4a35 50%, #20351d);
}
.forest-background__canopy {
  position: absolute;
  width: 67%;
  height: 48%;
  border-radius: 42% 58% 44% 56%;
  background: rgb(6 44 31 / 0.47);
  filter: blur(7px);
}
.forest-background__canopy--near {
  top: -20%;
  left: -12%;
  animation: forest-sway 15s ease-in-out infinite alternate;
}
.forest-background__canopy--far {
  right: -18%;
  bottom: -17%;
  opacity: 0.73;
  animation: forest-sway 19s ease-in-out -7s infinite alternate-reverse;
}
.forest-background__mountain {
  position: absolute;
  bottom: 17%;
  width: 74%;
  height: 42%;
  background: rgb(10 59 42 / 0.54);
  clip-path: polygon(0 100%, 27% 34%, 43% 69%, 68% 0, 100% 100%);
}
.forest-background__mountain--far {
  left: -18%;
  opacity: 0.55;
  transform: scale(1.08);
}
.forest-background__mountain--near {
  right: -26%;
  bottom: 10%;
  background: rgb(5 44 31 / 0.73);
}
.forest-background__tree {
  position: absolute;
  bottom: 9%;
  width: 42px;
  height: 108px;
  transform-origin: bottom;
}
.forest-background__tree::before {
  position: absolute;
  bottom: 22px;
  left: 3px;
  width: 36px;
  height: 76px;
  background: rgb(5 43 28 / 0.88);
  clip-path: polygon(50% 0, 100% 75%, 68% 75%, 100% 100%, 0 100%, 32% 75%, 0 75%);
  content: '';
}
.forest-background__tree::after {
  position: absolute;
  bottom: 0;
  left: 18px;
  width: 7px;
  height: 30px;
  background: #0b3827;
  content: '';
}
.forest-background__mist {
  position: absolute;
  top: 44%;
  left: -20%;
  width: 140%;
  height: 24%;
  background: linear-gradient(90deg, transparent, rgb(185 255 195 / 0.13), transparent);
  filter: blur(16px);
  animation: forest-mist 21s ease-in-out infinite alternate;
}
.forest-background__firefly {
  position: absolute;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #dcff9c;
  box-shadow: 0 0 13px 4px rgb(180 255 111 / 0.47);
  animation: forest-firefly 6s ease-in-out infinite;
}
@keyframes forest-sway {
  to {
    transform: translate(7%, 5%) rotate(4deg);
  }
}
@keyframes forest-mist {
  to {
    transform: translateX(13%) translateY(-12px);
    opacity: 0.45;
  }
}
@keyframes forest-firefly {
  50% {
    transform: translate(25px, -20px) scale(0.45);
    opacity: 0.18;
  }
}
@media (prefers-reduced-motion: reduce) {
  .forest-background * {
    animation: none;
  }
}
</style>
