<script setup lang="ts">
const motes = Array.from({ length: 16 }, (_, index) => ({
  id: index,
  x: `${(index * 41 + 4) % 100}%`,
  y: `${45 + ((index * 17) % 48)}%`,
  delay: `${-index * 0.65}s`
}))
const buildings = Array.from({ length: 12 }, (_, index) => ({
  id: index,
  height: `${16 + ((index * 17) % 35)}%`,
  width: `${6 + ((index * 7) % 7)}%`,
  delay: `${-index * 0.35}s`
}))
</script>

<template>
  <div
    class="sunset-background pointer-events-none absolute -inset-6 z-0 overflow-hidden"
    aria-hidden="true"
  >
    <span class="sunset-background__sun" />
    <span class="sunset-background__cloud sunset-background__cloud--one" />
    <span class="sunset-background__cloud sunset-background__cloud--two" />
    <span class="sunset-background__neon-grid" />
    <span class="sunset-background__scan-lines" />
    <span class="sunset-background__skyline">
      <i
        v-for="building in buildings"
        :key="building.id"
        :style="{ height: building.height, width: building.width, animationDelay: building.delay }"
      />
    </span>
    <span
      v-for="mote in motes"
      :key="mote.id"
      class="sunset-background__mote"
      :style="{ left: mote.x, top: mote.y, animationDelay: mote.delay }"
    />
  </div>
</template>

<style scoped>
.sunset-background {
  background:
    radial-gradient(circle at 18% 20%, rgb(255 188 112 / 68%), transparent 35%),
    radial-gradient(circle at 82% 72%, rgb(211 83 158 / 62%), transparent 42%),
    linear-gradient(135deg, #3d1835, #73394c 50%, #182447);
}
.sunset-background__sun {
  position: absolute;
  top: 17%;
  left: 17%;
  width: 25vmin;
  height: 25vmin;
  border-radius: 50%;
  background: #ffcf79;
  box-shadow: 0 0 70px 22px rgb(255 135 100 / 0.38);
  animation: sunset-sun 12s ease-in-out infinite alternate;
}
.sunset-background__cloud {
  position: absolute;
  width: 54%;
  height: 13%;
  border-radius: 999px;
  background: rgb(81 33 85 / 0.27);
  filter: blur(11px);
}
.sunset-background__cloud--one {
  top: 26%;
  left: -17%;
  animation: sunset-cloud 28s linear infinite;
}
.sunset-background__cloud--two {
  top: 48%;
  right: -24%;
  opacity: 0.68;
  animation: sunset-cloud 35s linear -14s infinite reverse;
}
.sunset-background__neon-grid {
  position: absolute;
  right: -15%;
  bottom: -6%;
  left: -15%;
  z-index: 2;
  height: 46%;
  background:
    linear-gradient(rgb(255 68 208 / 0.7) 1px, transparent 2px),
    linear-gradient(90deg, rgb(59 239 255 / 0.62) 1px, transparent 2px);
  background-size:
    100% 22px,
    34px 100%;
  clip-path: polygon(40% 0, 60% 0, 100% 100%, 0 100%);
  transform: perspective(180px) rotateX(55deg);
  transform-origin: bottom;
  filter: drop-shadow(0 0 5px rgb(255 47 207 / 0.8));
  opacity: 0.92;
  animation: neon-grid 2.8s linear infinite;
}
.sunset-background__scan-lines {
  position: absolute;
  right: -12%;
  left: -12%;
  top: 78%;
  z-index: 1;
  height: 42%;
  background:
    linear-gradient(rgb(255 94 218 / 0.96) 1px, transparent 1px),
    linear-gradient(90deg, rgb(92 244 255 / 0.88) 1px, transparent 1px);
  background-size:
    100% 20px,
    32px 100%;
  border-top: 2px solid rgb(255 102 218 / 0.95);
  box-shadow:
    0 -4px 22px rgb(255 58 198 / 0.52),
    0 0 14px rgb(77 239 255 / 0.32);
  clip-path: polygon(30% 0, 70% 0, 100% 100%, 0 100%);
  opacity: 1;
  transform: perspective(520px) rotateX(42deg) translateZ(0);
  transform-origin: top;
  animation: scan-lines 2.6s linear infinite;
}
.sunset-background__scan-lines::before {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    to bottom,
    rgb(255 137 227 / 0.98) 0 1px,
    transparent 1px 20px
  );
  content: '';
  mix-blend-mode: screen;
  animation: scan-line-flicker 3.8s steps(1, end) infinite;
}
.sunset-background__skyline {
  position: absolute;
  left: 50%;
  z-index: 3;
  bottom: 20%;
  display: flex;
  width: 68%;
  align-items: end;
  justify-content: center;
  gap: 3px;
  height: 40%;
  transform: translateX(-50%);
}
.sunset-background__skyline i {
  position: relative;
  display: block;
  overflow: hidden;
  background:
    repeating-linear-gradient(
      90deg,
      transparent 0 7px,
      rgb(90 241 255 / 0.62) 7px 9px,
      transparent 9px 15px
    ),
    repeating-linear-gradient(
      0deg,
      transparent 0 8px,
      rgb(255 88 207 / 0.54) 8px 10px,
      transparent 10px 16px
    ),
    linear-gradient(to top, rgb(21 18 56 / 0.9), rgb(96 40 120 / 0.68));
  border-top: 1px solid rgb(86 239 255 / 0.7);
  box-shadow: 0 -2px 8px rgb(255 63 190 / 0.55);
  animation: neon-pulse 2.4s ease-in-out infinite alternate;
}
.sunset-background__mote {
  position: absolute;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #ffe0a7;
  box-shadow: 0 0 12px #ff9787;
  animation: sunset-mote 7s ease-in-out infinite;
}
@keyframes sunset-sun {
  to {
    transform: translate(18px, 10px) scale(0.94);
  }
}
@keyframes sunset-cloud {
  to {
    transform: translateX(125%);
  }
}
@keyframes sunset-mote {
  50% {
    transform: translate(20px, -36px) scale(1.8);
    opacity: 0.2;
  }
}
@keyframes neon-grid {
  to {
    background-position:
      0 22px,
      0 0;
  }
}
@keyframes neon-pulse {
  to {
    box-shadow:
      0 -2px 18px rgb(86 239 255 / 0.92),
      0 0 14px rgb(255 55 201 / 0.7);
  }
}
@keyframes scan-lines {
  to {
    background-position:
      0 20px,
      0 0;
  }
}
@keyframes scan-line-flicker {
  0%,
  16%,
  18%,
  62%,
  65%,
  100% {
    opacity: 0.2;
  }
  17%,
  63% {
    opacity: 0.95;
  }
}
@media (prefers-reduced-motion: reduce) {
  .sunset-background * {
    animation: none;
  }
}
</style>
