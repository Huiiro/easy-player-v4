export const particleVertex = `
precision mediump float;
attribute vec2 aPosition;
attribute float aSeed;
attribute vec2 aVelocity;
uniform float uAspect;
uniform float uScale;
uniform float uEnergy;
uniform float uPhase;
varying vec3 vColor;
varying float vBrightness;
varying vec2 vDirection;
varying float vStretch;
vec3 hueToRGB(float hue) {
  return clamp(abs(fract(hue + vec3(0.0, 0.666667, 0.333333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
}
void main() {
  gl_Position = vec4(aPosition.x / uAspect, aPosition.y, 0.0, 1.0);
  float speed = length(aVelocity);
  vStretch = 1.0 + min(speed * 85.0, 2.5);
  vDirection = speed > 0.00001 ? aVelocity / speed : vec2(1.0, 0.0);
  gl_PointSize = (1.15 + pow(aSeed, 5.0) * 2.8 + uEnergy * 0.75) * uScale * vStretch;
  float hue = fract(aSeed * 0.14 + aPosition.x / uAspect * 0.24 + aPosition.y * 0.19 + sin(uPhase * 0.4 + aPosition.x * 0.7) * 0.12 + uPhase * 0.0159154943 + uEnergy * 0.08 + 0.48);
  vColor = mix(vec3(1.0), hueToRGB(hue), 0.68 + uEnergy * 0.16);
  vBrightness = 0.35 + pow(aSeed, 2.0) * 0.65;
}`

export const particleFragment = `
precision mediump float;
uniform float uEnergy;
uniform float uPulse;
varying vec3 vColor;
varying float vBrightness;
varying vec2 vDirection;
varying float vStretch;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  // Point coordinates face down, while the simulation uses an upward Y axis.
  vec2 direction = vec2(vDirection.x, -vDirection.y);
  float radius = length(vec2(dot(p, direction), dot(p, vec2(-direction.y, direction.x)) * vStretch));
  float core = 1.0 - smoothstep(0.06, 0.33, radius);
  float halo = (1.0 - smoothstep(0.1, 0.5, radius)) * 0.24;
  float alpha = (core + halo) * (0.4 + uEnergy * 0.4) * vBrightness;
  vec3 color = mix(vColor, vec3(1.0), uPulse * 0.2);
  gl_FragColor = vec4(color, alpha);
}`
