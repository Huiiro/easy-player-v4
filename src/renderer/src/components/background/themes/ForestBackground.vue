<script setup lang="ts">
import { useId } from 'vue'

withDefaults(defineProps<{ paused?: boolean }>(), { paused: false })
const id = useId()
const forestFloor = 'M0 644Q260 562 510 613T968 589Q1230 571 1440 632V900H0Z'
const farTrees = Array.from({ length: 19 }, (_, index) => ({
  x: index * 83 - 30,
  y: 170 + ((index * 37) % 160),
  width: 60 + ((index * 19) % 58),
  height: 270 + ((index * 31) % 180)
}))
const midTrees = [
  { x: -65, y: 25, width: 210, height: 720 },
  { x: 105, y: 95, width: 174, height: 650 },
  { x: 260, y: 168, width: 148, height: 540 },
  { x: 411, y: 245, width: 115, height: 435 },
  { x: 958, y: 190, width: 135, height: 510 },
  { x: 1092, y: 70, width: 190, height: 670 },
  { x: 1240, y: -25, width: 230, height: 780 }
]
// Uneven, drooping branch tiers form three reusable silhouettes. Keeping the
// geometry static avoids rebuilding paths while the few saplings sway.
function createPineShape(seed: number): string {
  const tiers = Array.from({ length: 11 }, (_, index) => ({
    y: 27 + index * 27 + Math.sin(index * 2.1 + seed) * 3,
    center: 60 + Math.sin(index * 0.6 + seed) * 2,
    left: (6 + index * 4.4) * (0.88 + Math.sin(index * 1.7 + seed) * 0.12),
    right: (6 + index * 4.5) * (0.9 + Math.cos(index * 1.3 + seed) * 0.1)
  }))
  let shape = 'M60 3'
  for (const { y, center: c, left: w } of tiers) {
    shape += `L${c - w * 0.62} ${y - 7}Q${c - w * 0.85} ${y + 4} ${c - w * 1.06} ${y + 13}L${c - w * 0.83} ${y + 10}L${c - w * 0.94} ${y + 19}Q${c - w * 0.78} ${y + 17} ${c - w * 0.65} ${y + 21}`
  }
  shape += 'L30 326 48 322 58 329 70 322 91 326 78 316'
  for (const { y, center: c, right: w } of tiers.toReversed()) {
    shape += `L${c + w * 0.65} ${y + 21}Q${c + w * 0.78} ${y + 17} ${c + w * 0.94} ${y + 19}L${c + w * 0.83} ${y + 10}L${c + w * 1.06} ${y + 13}Q${c + w * 0.85} ${y + 4} ${c + w * 0.62} ${y - 7}`
  }
  return `${shape}Q63 9 60 3Z`
}
const pineShapes = Array.from({ length: 3 }, (_, index) => createPineShape(index * 1.9))
const stillTrees = midTrees.filter((_, index) => index < 2 || index > 4)
const swayingTrees = midTrees.slice(2, 5)
const canopyClusters = [
  { x: 66, y: 87, rx: 79, ry: 41 },
  { x: 186, y: 61, rx: 73, ry: 35 },
  { x: 289, y: 80, rx: 58, ry: 26 },
  { x: 1214, y: 37, rx: 91, ry: 32 },
  { x: 1332, y: 88, rx: 87, ry: 42 }
].map((cluster, seed) => {
  const points = Array.from({ length: 18 }, (_, index) => {
    const angle = (index / 18) * Math.PI * 2
    const reach = 0.86 + 0.14 * Math.sin(index * 2.4 + seed * 1.7)
    return {
      x: cluster.x + Math.cos(angle) * cluster.rx * reach,
      y: cluster.y + Math.sin(angle) * cluster.ry * reach
    }
  })
  const last = points[points.length - 1]
  let shape = `M${(last.x + points[0].x) / 2} ${(last.y + points[0].y) / 2}`
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length]
    shape += `Q${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`
  })
  return `${shape}Z`
})
const fireflies = Array.from({ length: 8 }, (_, index) => ({
  x: `${18 + ((index * 37) % 66)}%`,
  y: `${49 + ((index * 19) % 35)}%`,
  delay: `${-index * 1.73}s`,
  duration: `${7 + (index % 4) * 1.7}s`
}))
const fernLeaves = Array.from({ length: 11 }, (_, index) => {
  // Sample the same quadratic curve as the leaf stalk so each pair attaches
  // to it, rather than floating beside a separately transformed frond.
  const depth = (index + 1) / 13
  const rest = 1 - depth
  const x = rest * rest * 106 + 2 * rest * depth * 96 + depth * depth * 91
  const y = rest * rest * 16 + 2 * rest * depth * 91 + depth * depth * 178
  const reach = Math.pow(Math.sin(depth * Math.PI), 0.85) * 44
  return `M${x} ${y}Q${x - reach * 0.55} ${y - 17} ${x - reach} ${y - 11}Q${x - reach * 0.6} ${y - 6} ${x} ${y + 1}ZM${x} ${y + 3}Q${x + reach * 0.55} ${y - 14} ${x + reach * 0.93} ${y - 9}Q${x + reach * 0.56} ${y - 4} ${x} ${y + 4}Z`
})
</script>

<template>
  <div class="forest-background" :class="{ 'is-paused': paused }" aria-hidden="true">
    <!-- Static silhouettes retain fine detail without a per-frame drawing loop. -->
    <svg class="forest-scenery" viewBox="0 0 1440 900" preserveAspectRatio="none">
      <defs>
        <symbol
          v-for="(shape, index) in pineShapes"
          :id="`${id}-pine-${index}`"
          :key="index"
          viewBox="0 0 120 400"
          preserveAspectRatio="none"
        >
          <path fill="var(--pine-bark, #4c483d)" d="M57 400 60 68 62 68 65 400Z" />
          <path :d="shape" />
        </symbol>
        <linearGradient :id="`${id}-floor`" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#425f48" />
          <stop offset="1" stop-color="#1a3429" />
        </linearGradient>
        <clipPath :id="`${id}-ground-clip`">
          <path :d="forestFloor" />
        </clipPath>
        <linearGradient :id="`${id}-path`" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#9b9b71" stop-opacity="0" />
          <stop offset="0.18" stop-color="#9b9b71" stop-opacity="0.17" />
          <stop offset="0.45" stop-color="#888c64" stop-opacity="0.42" />
          <stop offset="1" stop-color="#6c7050" stop-opacity="0.68" />
        </linearGradient>
        <linearGradient :id="`${id}-mist`" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#b6c5ab" stop-opacity="0" />
          <stop offset="0.55" stop-color="#b6c5ab" stop-opacity="0.16" />
          <stop offset="1" stop-color="#b6c5ab" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path fill="#567366" d="M0 437Q210 349 410 413T802 391Q1100 356 1440 424V702H0Z" />
      <g fill="#486b59" style="--pine-bark: #526354">
        <use
          v-for="(tree, index) in farTrees"
          :key="index"
          :href="`#${id}-pine-${index % 3}`"
          v-bind="tree"
        />
      </g>
      <path :fill="`url(#${id}-floor)`" :d="forestFloor" />
      <path
        :fill="`url(#${id}-path)`"
        :clip-path="`url(#${id}-ground-clip)`"
        d="M786 642C767 660 785 679 752 695C689 729 621 772 633 900H829C729 804 733 778 786 738C839 702 828 671 790 642Z"
      />
      <path
        fill="#526b48"
        d="M0 694Q148 626 343 662L548 724Q259 668 0 772ZM1024 666Q1215 604 1440 653V747Q1222 668 1024 666Z"
      />
      <g fill="#304f3e">
        <path
          d="m320 738 21-19 27 7 18 20Z M1032 741l27-12 40 13 5 9h-72Z M844 673l15-8 23 12-28 1Z"
        />
        <path d="M559 821q28-26 56-5l15 15h-74Z M967 851q32-27 69 0l9 14h-88Z" />
      </g>
      <path :fill="`url(#${id}-mist)`" d="M0 431H1440V657H0Z" />
    </svg>
    <div class="forest-light">
      <svg viewBox="0 0 600 800" preserveAspectRatio="none">
        <defs>
          <linearGradient :id="`${id}-ray`" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#e6d9a5" stop-opacity="0" />
            <stop offset="0.45" stop-color="#e6d9a5" stop-opacity="0.16" />
            <stop offset="0.55" stop-color="#e6d9a5" stop-opacity="0.19" />
            <stop offset="1" stop-color="#e6d9a5" stop-opacity="0" />
          </linearGradient>
          <linearGradient :id="`${id}-ray-fade`" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="white" />
            <stop offset="0.48" stop-color="white" />
            <stop offset="1" stop-color="black" />
          </linearGradient>
          <mask :id="`${id}-ray-mask`">
            <path :fill="`url(#${id}-ray-fade)`" d="M0 0H600V800H0Z" />
          </mask>
        </defs>
        <g :fill="`url(#${id}-ray)`" :mask="`url(#${id}-ray-mask)`">
          <path d="M366-30h28L202 800H46Z" />
          <path d="M458-30h18L362 800H252Z" />
          <path d="M540-30h12L510 710H445Z" />
        </g>
      </svg>
    </div>
    <div class="forest-mist" />
    <svg
      v-for="(tree, index) in swayingTrees"
      :key="index"
      class="forest-sapling"
      :style="{
        left: `${tree.x / 14.4}%`,
        top: `${tree.y / 9}%`,
        width: `${tree.width / 14.4}%`,
        height: `${tree.height / 9}%`,
        animationDelay: `${-index * 3.7}s`,
        animationDuration: `${10 + index * 2.5}s`
      }"
      viewBox="0 0 120 400"
      preserveAspectRatio="none"
      fill="#294d3c"
    >
      <use :href="`#${id}-pine-${index}`" width="120" height="400" />
    </svg>
    <!-- Near trunks and foliage occlude the mist and light, with opaque fills. -->
    <svg
      class="forest-scenery forest-scenery--near"
      viewBox="0 0 1440 900"
      preserveAspectRatio="none"
    >
      <g fill="#294d3c" style="--pine-bark: #4c483d">
        <use
          v-for="(tree, index) in stillTrees"
          :key="index"
          :href="`#${id}-pine-${index % 3}`"
          v-bind="tree"
        />
      </g>
      <g fill="#1c3b2e">
        <path fill="#3b3830" d="M35-20h62Q65 208 110 451L145 900H66L63 524Q35 315 35-20Z" />
        <path
          fill="#3c3931"
          d="M1334-20h59Q1388 199 1356 420L1332 900h-82l49-394Q1338 288 1334-20Z"
        />
        <path
          fill="#404034"
          d="M70 211Q160 158 218 61l9-55h14l-7 69Q167 202 85 246ZM1309 312Q1226 238 1172 99l-33-72 13-8 43 72q62 124 127 173Z"
        />
        <path
          d="M0 43Q73-8 145 32 215-1 279 39 364 10 410 64 375 119 297 106 251 152 181 116 112 145 52 100L0 122Z"
        />
        <path d="M1043 0h397v171q-68-6-97-53-62 36-105-9-78 21-107-28-68 4-88-42Z" />
        <path d="M0 860Q220 785 450 892L476 900H0ZM1008 900Q1190 804 1440 835V900Z" />
      </g>
      <g fill="none" stroke="#938269" stroke-opacity="0.28" stroke-width="3">
        <path
          d="M56 15q-5 194 22 327l7 166m-9 47 21 252M1360 7q2 152-22 282l-22 215m-3 54-26 270"
        />
      </g>
      <g fill="#274735">
        <path v-for="(cluster, index) in canopyClusters" :key="index" :d="cluster" />
      </g>
      <g fill="#3c5840" opacity="0.58">
        <path
          d="M163 100q22-18 39-6-16 15-39 6m70-29q19-17 37-5-14 13-37 5m51 29q20-15 38-4-16 14-38 4M1210 80q18-18 38-5-18 16-38 5m80 43q23-14 42 0-22 10-42 0"
        />
      </g>
    </svg>
    <svg
      v-for="side in ['left', 'right']"
      :key="side"
      class="forest-fern"
      :class="`forest-fern--${side}`"
      viewBox="0 0 200 180"
    >
      <g fill="#35523a">
        <path d="M106 16Q101 22 105 31Q111 23 106 16Z" />
        <path v-for="(leaf, index) in fernLeaves" :key="index" :d="leaf" />
      </g>
      <path
        d="M91 178Q96 91 106 16"
        fill="none"
        stroke="#6f7950"
        stroke-opacity="0.48"
        stroke-width="1.4"
      />
    </svg>
    <span
      v-for="(fly, index) in fireflies"
      :key="index"
      class="forest-firefly"
      :style="{
        left: fly.x,
        top: fly.y,
        animationDelay: fly.delay,
        animationDuration: fly.duration
      }"
    />
  </div>
</template>

<style scoped>
.forest-background {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  contain: strict;
  background:
    radial-gradient(ellipse 42% 56% at 64% 21%, rgb(190 198 150 / 29%), transparent 85%),
    linear-gradient(160deg, #344d45, #567466 44%, #294c3d 75%, #1a3229);
}
.forest-scenery {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.forest-sapling {
  position: absolute;
  transform-origin: 50% 100%;
  --pine-bark: #4c483d;
  animation: forest-tree-sway 12s ease-in-out infinite alternate;
}
.forest-light {
  position: absolute;
  left: 38%;
  top: -4%;
  width: 45%;
  height: 88%;
  opacity: 0.8;
  animation: forest-light-breathe 18s ease-in-out infinite alternate;
}
.forest-light svg {
  width: 100%;
  height: 100%;
}
.forest-mist {
  position: absolute;
  left: -4%;
  top: 51%;
  width: 108%;
  height: 20%;
  background: radial-gradient(ellipse at center, rgb(184 201 169 / 10%), transparent 70%);
  animation: forest-mist-drift 26s ease-in-out infinite alternate;
}
.forest-fern {
  position: absolute;
  bottom: -3%;
  width: clamp(120px, 20%, 280px);
  height: auto;
  transform-origin: 50% 100%;
  animation: forest-fern-sway 8s ease-in-out infinite alternate;
}
.forest-fern--left {
  left: 4%;
}
.forest-fern--right {
  right: 1%;
  animation-delay: -3.7s;
  animation-duration: 11s;
}
.forest-firefly {
  position: absolute;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  opacity: 0.6;
  background: radial-gradient(
    circle,
    #f0dfab 0 4%,
    rgb(222 208 141 / 35%) 12%,
    rgb(202 193 125 / 8%) 34%,
    transparent 70%
  );
  animation: forest-firefly-drift 9s ease-in-out infinite;
}
@keyframes forest-tree-sway {
  from {
    transform: rotate(-0.45deg);
  }
  to {
    transform: rotate(0.65deg);
  }
}
@keyframes forest-light-breathe {
  to {
    transform: translate(5px, 2px);
    opacity: 0.48;
  }
}
@keyframes forest-mist-drift {
  to {
    transform: translate(3%, -5px);
    opacity: 0.55;
  }
}
@keyframes forest-fern-sway {
  from {
    transform: rotate(-1.4deg);
  }
  to {
    transform: rotate(2deg);
  }
}
@keyframes forest-firefly-drift {
  0%,
  100% {
    transform: translate(0, 0);
    opacity: 0.12;
  }
  35% {
    transform: translate(13px, -18px);
    opacity: 0.75;
  }
  70% {
    transform: translate(-6px, -30px);
    opacity: 0.28;
  }
}
.is-paused * {
  animation-play-state: paused;
}
@media (prefers-reduced-motion: reduce) {
  .forest-background * {
    animation: none;
  }
}
</style>
