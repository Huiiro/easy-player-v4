<script setup lang="ts">
import { useId } from 'vue'

withDefaults(defineProps<{ paused?: boolean }>(), { paused: false })
const id = useId()
// Scene geometry is built once. Only small schools, edge plants and a bounded
// light shaft move, using CSS transforms rather than a JavaScript frame loop.
const ripples = Array.from({ length: 9 }, (_, row) => {
  let path = `M-80 ${26 + row * row * 3.1}`
  for (let column = 0; column < 12; column++) {
    const bend = Math.sin(column * 1.9 + row * 1.6) * (5 + row * 1.2)
    path += `q35 ${bend - 8} 70 ${bend}t70 ${-bend}`
  }
  return { path, opacity: 0.2 - row * 0.015 }
})
const glints = Array.from({ length: 38 }, (_, index) => ({
  x: (index * 193 + 53) % 1440,
  y: 18 + ((index * 47) % 125),
  width: 9 + ((index * 23) % 67),
  opacity: 0.08 + (index % 4) * 0.025
}))
const schools = [
  { x: '12%', y: '37%', width: '170px', opacity: 0.27, delay: '-7s', duration: '34s', count: 7 },
  { x: '71%', y: '57%', width: '210px', opacity: 0.3, delay: '-18s', duration: '42s', count: 5 },
  { x: '47%', y: '24%', width: '112px', opacity: 0.16, delay: '-12s', duration: '38s', count: 6 }
]
const motes = Array.from({ length: 6 }, (_, index) => ({
  x: `${(index * 37 + 13) % 100}%`,
  y: `${25 + ((index * 23) % 65)}%`,
  size: `${index % 3 === 0 ? 3 : 2}px`,
  duration: `${18 + index * 3}s`,
  delay: `${-index * 4}s`
}))
const sandLight = Array.from({ length: 15 }, (_, index) => {
  const x = 340 + ((index * 137) % 800)
  const y = 815 + ((index * 31) % 72)
  return `M${x} ${y}q15-7 36-3t46-2m-46 2q5 4 20 6`
})
const kelp = [
  'M65 350C44 286 113 243 69 182S38 86 64 10C10 96 25 141 46 186S30 281 47 350Z',
  'M112 350C141 300 83 266 125 204S159 131 138 81C142 137 111 162 103 201S114 290 94 350Z',
  'M167 350C144 312 194 279 163 237S130 179 150 139C112 184 137 226 146 244S137 310 151 350Z'
]
</script>

<template>
  <div class="ocean-background" :class="{ 'ocean-background--paused': paused }" aria-hidden="true">
    <svg class="ocean-background__scenery" viewBox="0 0 1440 900" preserveAspectRatio="none">
      <defs>
        <linearGradient :id="`${id}-depth`" x2="0.1" y2="1">
          <stop stop-color="#286775" />
          <stop offset="0.24" stop-color="#104453" />
          <stop offset="0.65" stop-color="#092c3b" />
          <stop offset="1" stop-color="#061b29" />
        </linearGradient>
        <radialGradient :id="`${id}-surface`" cx="75%" cy="0%" r="75%">
          <stop stop-color="#8abebc" stop-opacity="0.48" />
          <stop offset="0.44" stop-color="#418c97" stop-opacity="0.16" />
          <stop offset="1" stop-color="#1b5567" stop-opacity="0" />
        </radialGradient>
        <linearGradient :id="`${id}-light`" x1="0" y1="0" x2="0" y2="1">
          <stop stop-color="#a7d7cc" stop-opacity="0.08" />
          <stop offset="0.35" stop-color="#94cec8" stop-opacity="0.04" />
          <stop offset="0.9" stop-color="#73bbc2" stop-opacity="0" />
        </linearGradient>
        <linearGradient :id="`${id}-floor`" x2="0" y2="1">
          <stop stop-color="#123e49" />
          <stop offset="1" stop-color="#071e2a" />
        </linearGradient>
      </defs>
      <path d="M0 0H1440V900H0Z" :fill="`url(#${id}-depth)`" />
      <path d="M0 0H1440V900H0Z" :fill="`url(#${id}-surface)`" />
      <g :fill="`url(#${id}-light)`">
        <path d="M922 0H978L636 696 444 760Z" />
        <path d="M1040 0H1076L970 753 850 810Z" opacity="0.65" />
        <path d="M1150 0H1183L1362 627 1210 720Z" opacity="0.7" />
      </g>
      <g fill="none" stroke="#a5d4d0" stroke-width="1.3">
        <path
          v-for="(ripple, index) in ripples"
          :key="index"
          :d="ripple.path"
          :opacity="ripple.opacity"
        />
      </g>
      <g fill="#b4dbd0">
        <rect
          v-for="(glint, index) in glints"
          :key="index"
          :x="glint.x"
          :y="glint.y"
          :width="glint.width"
          height="1.3"
          rx="0.65"
          :opacity="glint.opacity"
        />
      </g>
      <path
        d="M0 728Q171 677 357 742T751 754Q1069 697 1440 721V900H0Z"
        fill="#133d48"
        opacity="0.55"
      />
      <path
        d="M0 809Q210 753 394 809T790 807Q1148 730 1440 797V900H0Z"
        :fill="`url(#${id}-floor)`"
      />
      <path d="M0 705 53 694 106 736 154 748 187 807 263 830 294 900H0Z" fill="#092a35" />
      <path d="M0 705 53 694 106 736 64 724 30 751 0 747Z" fill="#1b4650" opacity="0.6" />
      <path
        d="M1440 687 1379 716 1343 763 1300 775 1253 844 1190 871 1172 900H1440Z"
        fill="#082631"
      />
      <path
        d="M1440 687 1379 716 1343 763 1375 748 1412 732 1440 733Z"
        fill="#204b52"
        opacity="0.45"
      />
      <path
        d="M0 863Q97 820 193 875L235 900H0ZM1273 900Q1312 839 1380 846L1440 818V900Z"
        fill="#061e29"
      />
      <g fill="none" stroke="#80b9b7" stroke-width="0.8" opacity="0.09">
        <path v-for="(shape, index) in sandLight" :key="index" :d="shape" />
      </g>
      <g fill="none" stroke="#0a313b" stroke-linecap="round" stroke-linejoin="round">
        <path
          d="M222 900Q219 865 229 837M224 875 204 861 200 847M224 865 241 852 244 836M229 839 221 829"
          stroke-width="5"
        />
        <path
          d="M1197 900 1191 866 1206 839M1192 877 1175 861 1172 844M1194 861 1221 854 1230 840M1204 843 1197 831"
          stroke-width="4"
        />
      </g>
    </svg>
    <div class="ocean-background__light" />
    <svg
      v-for="(school, index) in schools"
      :key="index"
      class="ocean-background__school"
      viewBox="0 0 240 100"
      :style="{
        left: school.x,
        top: school.y,
        width: school.width,
        opacity: school.opacity,
        animationDelay: school.delay,
        animationDuration: school.duration
      }"
    >
      <path
        v-for="fish in school.count"
        :key="fish"
        d="M0 0Q9-6 20 0Q9 6 0 0L-6 5-5 0-6-5ZM7-2 10-7 15-2Z"
        :transform="`translate(${22 + ((fish * 53) % 192)} ${18 + ((fish * 29) % 64)}) scale(${0.5 + (fish % 3) * 0.15})`"
      />
    </svg>
    <svg
      v-for="side in ['left', 'right']"
      :key="side"
      class="ocean-background__kelp"
      :class="`ocean-background__kelp--${side}`"
      viewBox="0 0 220 350"
    >
      <path v-for="(shape, index) in kelp" :key="index" :d="shape" />
      <path
        d="M60 277Q23 259 18 230 49 235 60 277M92 300Q127 278 135 249 102 258 92 300M150 302Q184 292 196 268 164 271 150 302"
        opacity="0.7"
      />
    </svg>
    <span
      v-for="(mote, index) in motes"
      :key="index"
      class="ocean-background__mote"
      :style="{
        left: mote.x,
        top: mote.y,
        width: mote.size,
        height: mote.size,
        animationDuration: mote.duration,
        animationDelay: mote.delay
      }"
    />
  </div>
</template>

<style scoped>
.ocean-background {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  contain: strict;
  background: #082a38;
}
.ocean-background__scenery {
  position: absolute;
  width: 100%;
  height: 100%;
}
.ocean-background__light {
  position: absolute;
  top: -8%;
  right: 20%;
  width: min(32%, 380px);
  height: min(92%, 780px);
  transform-origin: 80% 0;
  background: radial-gradient(
    ellipse 34% 95% at 76% 0%,
    rgb(164 221 207 / 12%),
    rgb(145 205 201 / 4%) 42%,
    transparent 76%
  );
  animation: ocean-light 18s ease-in-out infinite alternate;
}
.ocean-background__school {
  position: absolute;
  max-width: 25%;
  height: auto;
  fill: #8bb8ba;
  animation: ocean-school 38s ease-in-out infinite alternate;
}
.ocean-background__school:nth-of-type(3) {
  fill: #719ea8;
  animation-direction: alternate-reverse;
}
.ocean-background__kelp {
  position: absolute;
  bottom: -22px;
  width: min(19%, 240px);
  height: auto;
  fill: #0a3037;
  transform-origin: 50% 100%;
  animation: ocean-kelp 8s ease-in-out infinite alternate;
}
.ocean-background__kelp--left {
  left: -25px;
}
.ocean-background__kelp--right {
  scale: -1 1;
  right: -20px;
  fill: #082a32;
  animation-delay: -5s;
  animation-direction: alternate-reverse;
}
.ocean-background__mote {
  position: absolute;
  border-radius: 50%;
  background: #b1d5d1;
  opacity: 0.16;
  animation: ocean-drift 24s ease-in-out infinite alternate;
}
.ocean-background--paused * {
  animation-play-state: paused !important;
}
@keyframes ocean-light {
  from {
    transform: rotate(-4deg);
    opacity: 0.45;
  }
  to {
    transform: rotate(4deg);
    opacity: 0.85;
  }
}
@keyframes ocean-school {
  from {
    transform: translate3d(-35px, 6px, 0);
  }
  to {
    transform: translate3d(65px, -8px, 0);
  }
}
@keyframes ocean-kelp {
  from {
    transform: rotate(-2deg);
  }
  to {
    transform: rotate(2.5deg);
  }
}
@keyframes ocean-drift {
  from {
    transform: translate3d(-8px, 12px, 0);
    opacity: 0.08;
  }
  to {
    transform: translate3d(16px, -28px, 0);
    opacity: 0.24;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ocean-background * {
    animation: none;
  }
}
</style>
