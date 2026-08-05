<script setup lang="ts">
const codeTokens = ['0101', 'A7F2', '110X', 'E8F2', '7C9D', 'AF03', '9B41', '0011', 'C2E0', '4D7A']
const codeColumns = Array.from({ length: 14 }, (_, index) => ({
  id: index,
  x: `${5 + index * 8.2}%`,
  delay: `${-index * 1.35}s`,
  duration: `${10 + (index % 4) * 2.2}s`,
  opacity: 0.24 + (index % 3) * 0.1,
  code: Array.from(
    { length: 12 },
    (_, row) => codeTokens[(index * 3 + row * 7) % codeTokens.length]
  ).join('\n')
}))
const scanBars = [
  { id: 'top', top: '18%', delay: '0s' },
  { id: 'middle', top: '46%', delay: '-2.7s' },
  { id: 'bottom', top: '72%', delay: '-5.1s' }
]
</script>

<template>
  <div
    class="matrix-background pointer-events-none absolute -inset-6 z-0 overflow-hidden"
    aria-hidden="true"
  >
    <span class="matrix-background__grid" />
    <span
      v-for="scan in scanBars"
      :key="scan.id"
      class="matrix-background__scan"
      :style="{ top: scan.top, animationDelay: scan.delay }"
    />
    <span class="matrix-background__vertical-scan" />
    <span class="matrix-background__core" />
    <span
      v-for="column in codeColumns"
      :key="column.id"
      class="matrix-background__code"
      :style="{
        left: column.x,
        opacity: column.opacity,
        animationDelay: column.delay,
        animationDuration: column.duration
      }"
    >
      {{ column.code }}
    </span>
  </div>
</template>

<style scoped>
.matrix-background {
  contain: paint;
  background:
    radial-gradient(ellipse at 50% 48%, rgb(19 124 76 / 0.24), transparent 37%),
    linear-gradient(135deg, #020b08, #071911 54%, #020806);
}
.matrix-background__grid {
  position: absolute;
  inset: 11% 10%;
  border: 1px solid rgb(84 255 165 / 0.13);
  background:
    linear-gradient(rgb(72 255 153 / 0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgb(72 255 153 / 0.08) 1px, transparent 1px);
  background-size: 36px 36px;
  box-shadow:
    inset 0 0 50px rgb(19 227 113 / 0.08),
    0 0 45px rgb(24 236 119 / 0.07);
}
.matrix-background__core {
  position: absolute;
  top: 50%;
  left: 50%;
  width: min(48vw, 540px);
  height: min(28vw, 280px);
  border: 1px solid rgb(113 255 178 / 0.24);
  background: linear-gradient(135deg, rgb(9 48 29 / 0.22), transparent 66%);
  box-shadow:
    0 0 35px rgb(36 255 137 / 0.12),
    inset 0 0 28px rgb(66 255 146 / 0.06);
  transform: translate(-50%, -50%);
}
.matrix-background__core::before,
.matrix-background__core::after {
  position: absolute;
  width: 18px;
  height: 18px;
  border-color: #86ffc1;
  border-style: solid;
  content: '';
}
.matrix-background__core::before {
  top: -1px;
  left: -1px;
  border-width: 1px 0 0 1px;
}
.matrix-background__core::after {
  right: -1px;
  bottom: -1px;
  border-width: 0 1px 1px 0;
}
.matrix-background__scan {
  position: absolute;
  right: 11%;
  left: 11%;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgb(140 255 190 / 0.9), transparent);
  box-shadow: 0 0 13px rgb(82 255 156 / 0.74);
  animation: matrix-scan 7.5s ease-in-out infinite;
}
.matrix-background__vertical-scan {
  position: absolute;
  top: 12%;
  bottom: 12%;
  left: 16%;
  width: 1px;
  background: linear-gradient(transparent, rgb(113 255 178 / 0.72), transparent);
  box-shadow: 0 0 10px rgb(65 255 145 / 0.54);
  animation: matrix-vertical-scan 9s ease-in-out infinite;
}
.matrix-background__code {
  position: absolute;
  top: -32%;
  color: #8cffbd;
  font-family: 'Cascadia Code', Consolas, monospace;
  font-size: 11px;
  letter-spacing: 0.15em;
  line-height: 1.82;
  text-align: center;
  text-shadow: 0 0 8px rgb(75 255 147 / 0.62);
  white-space: pre-line;
  animation-name: matrix-rain;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}
@keyframes matrix-rain {
  to {
    transform: translateY(148vh);
  }
}
@keyframes matrix-scan {
  0%,
  100% {
    transform: translateX(-8%);
    opacity: 0.12;
  }
  50% {
    transform: translateX(8%);
    opacity: 0.9;
  }
}
@keyframes matrix-vertical-scan {
  0%,
  100% {
    transform: translateX(0);
    opacity: 0.18;
  }
  50% {
    transform: translateX(68vw);
    opacity: 0.8;
  }
}
@media (prefers-reduced-motion: reduce) {
  .matrix-background * {
    animation: none;
  }
}
</style>
