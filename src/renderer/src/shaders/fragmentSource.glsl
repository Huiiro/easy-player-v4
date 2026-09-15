precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_energy;
uniform float u_bass;
uniform float u_beat;
uniform vec3 u_color_a;
uniform vec3 u_color_b;
uniform vec3 u_color_c;
uniform sampler2D u_cover;
uniform sampler2D u_cover_blurred;
uniform float u_cover_loaded;

vec3 rgbToHsv(vec3 color) {
  vec4 k = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(color.bg, k.wz), vec4(color.gb, k.xy), step(color.b, color.g));
  vec4 q = mix(vec4(p.xyw, color.r), vec4(color.r, p.yzx), step(p.x, color.r));
  float delta = q.x - min(q.w, q.y);
  float epsilon = 1.0e-5;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * delta + epsilon)), delta / (q.x + epsilon), q.x);
}

vec3 hsvToRgb(vec3 color) {
  vec3 p = abs(fract(color.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return color.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), color.y);
}

vec3 neighbourColour(vec3 source) {
  vec3 hsv = rgbToHsv(source);
  float originalSaturation = hsv.y;
  hsv.x = fract(hsv.x + 0.072);
  hsv.y = clamp(hsv.y * 0.91 + 0.08, 0.0, 1.0);
  hsv.z = clamp(hsv.z * 0.86 + 0.07, 0.16, 0.96);
  vec3 shifted = hsvToRgb(hsv);
  vec3 neutral = clamp(source * 0.72 + vec3(0.095), 0.0, 1.0);
  return mix(neutral, shifted, smoothstep(0.06, 0.22, originalSaturation));
}

vec2 sineFold(vec2 point, float phase, float strength) {
  point.x += sin(point.y + phase) * strength;
  point.y += sin(point.x + phase) * strength;
  return point;
}

float angularWave(vec2 point, float frequency) {
  // The swapped atan arguments intentionally preserve the reference's angular
  // orientation. Each deformation changes the origin of the following wave.
  return sin(atan(point.x, point.y) * frequency);
}

vec3 sampleArtwork(vec2 uv) {
  vec2 q = clamp(uv, 0.03, 0.97);
  vec2 offset = vec2(0.045, 0.0);
  vec3 color = texture2D(u_cover_blurred, q).rgb * 0.60;
  color += texture2D(u_cover_blurred, q + offset).rgb * 0.10;
  color += texture2D(u_cover_blurred, q - offset).rgb * 0.10;
  color += texture2D(u_cover_blurred, q + offset.yx).rgb * 0.10;
  color += texture2D(u_cover_blurred, q - offset.yx).rgb * 0.10;
  return color;
}

void main() {
  float minimumSide = max(min(u_resolution.x, u_resolution.y), 1.0);
  vec2 point = (gl_FragCoord.xy * 2.0 - u_resolution.xy) / minimumSide;
  vec2 screenUv = gl_FragCoord.xy / max(u_resolution, vec2(1.0));

  float energy = clamp(u_energy, 0.0, 1.0);
  float bass = clamp(u_bass, 0.0, 1.0);
  float beat = clamp(u_beat, 0.0, 1.0);
  // u_time is an integrated phase: audio changes speed without jumping position.
  float time = u_time;
  float strength = 1.0 + energy * 0.04 + bass * 0.055 + beat * 0.025;
  float beatPhase = beat * 0.04;

  vec3 support = neighbourColour(u_color_c);
  vec3 accumulated = vec3(0.0);

  point = sineFold(point, time * 1.20 + beatPhase, strength);
  accumulated += angularWave(point, 2.0) * u_color_a;

  point = sineFold(point, time * 1.40 - beatPhase * 0.70, strength);
  accumulated += angularWave(point, 3.0) * u_color_b;

  point = sineFold(point, time * 1.60 + beatPhase * 0.50, strength);
  accumulated += angularWave(point, 4.0) * u_color_c;

  point = sineFold(point, time * 1.80 - beatPhase * 0.35, strength);
  accumulated += angularWave(point, 5.0) * support;

  // Signed accumulation plus framebuffer clipping creates the milky planes,
  // near-black valleys, and razor-thin folds seen in the reference.
  vec3 color = accumulated * 0.50 + 0.50;

  vec3 artwork = sampleArtwork(screenUv);
  float artworkLight = dot(artwork, vec3(0.2126, 0.7152, 0.0722));
  vec3 artworkTint = mix(vec3(artworkLight), artwork, 0.82);
  vec3 artworkModulated = color * (0.62 + artworkTint * 0.82);
  color = mix(color, artworkModulated, u_cover_loaded * 0.46);
  color = mix(color, artworkTint, u_cover_loaded * 0.07);

  float pulse = exp(-dot(point, point) * 0.14) * beat;
  color *= 1.0 + pulse * 0.035 + energy * 0.025;
  gl_FragColor = vec4(color, 1.0);
}
