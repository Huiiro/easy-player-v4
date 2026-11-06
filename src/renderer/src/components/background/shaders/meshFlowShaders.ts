// Artwork material, separable blur, then a moving textured mesh.
export const quadVertex = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`

export const materialFragment = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_previous;
uniform sampler2D u_current;
uniform float u_mix;
uniform float u_time;
uniform float u_pulse;
vec2 rotate(vec2 p, float angle) {
  float c = cos(angle), s = sin(angle);
  return mat2(c, s, -s, c) * p;
}
vec3 artwork(vec2 uv) {
  uv = clamp(uv, 0.0, 1.0);
  return mix(texture2D(u_previous, uv).rgb, texture2D(u_current, uv).rgb, u_mix);
}
void main() {
  vec2 p = v_uv - 0.5;
  float scale = 1.0 + u_pulse * 0.12;
  vec3 base = artwork(rotate(p, u_time * 0.045) / (1.5 * scale) + 0.5);
  vec2 a = rotate(p - vec2(-0.23, 0.17), -u_time * 0.061) / scale;
  vec2 b = rotate(p - vec2(0.27, -0.22), u_time * 0.037 + 1.6) / scale;
  float wa = 1.0 - smoothstep(0.24, 0.61, length(a));
  float wb = 1.0 - smoothstep(0.20, 0.65, length(b));
  base = mix(base, artwork(a * 0.95 + 0.5), wa * 0.8);
  base = mix(base, artwork(b * 1.1 + 0.5), wb * 0.72);
  gl_FragColor = vec4(base, 1.0);
}`

export const blurFragment = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_texture;
uniform vec2 u_direction;
void main() {
  vec3 color = vec3(0.0);
  float weight = 0.0;
  for (int i = -10; i <= 10; i++) {
    float x = float(i);
    float w = exp(-x * x / 40.0);
    color += texture2D(u_texture, v_uv + u_direction * x * 1.8).rgb * w;
    weight += w;
  }
  gl_FragColor = vec4(color / weight, 1.0);
}`

export const meshVertex = `
attribute vec2 a_position;
varying vec2 v_uv;
uniform float u_time;
uniform float u_aspect;
void main() {
  vec2 uv = a_position * 0.5 + 0.5;
  vec2 p = a_position;
  float t = u_time * 0.13;
  // Keep the border fixed outside the viewport while the interior stretches smoothly.
  float envelope = sin(uv.x * 3.14159265) * sin(uv.y * 3.14159265);
  p.x += envelope * (sin(p.y * 2.4 + t) * 0.22 + cos(p.x * 1.7 - t * 0.71) * 0.13);
  p.y += envelope * (cos(p.x * 2.1 - t * 0.83) * 0.21 + sin(p.y * 1.9 + t * 0.57) * 0.12);
  // Crop to fill the viewport without stretching the square material.
  if (u_aspect > 1.0) p.y *= u_aspect;
  else p.x /= u_aspect;
  v_uv = uv;
  gl_Position = vec4(p * 1.12, 0.0, 1.0);
}`

export const meshFragment = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_texture;
void main() {
  vec3 color = texture2D(u_texture, v_uv).rgb;
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float edge = smoothstep(0.15, 0.68, distance(v_uv, vec2(0.5)));
  color *= 0.83 - edge * smoothstep(0.1, 0.65, luminance) * 0.22;
  float noise = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  gl_FragColor = vec4(color + (noise - 0.5) / 255.0, 1.0);
}`
