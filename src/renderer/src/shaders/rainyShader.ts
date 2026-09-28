export const rainyVertexShader = `#version 300 es
in vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`

// The supplied Heartfelt shader informed the glass-rain direction. These shapes,
// image compositing and lighting are implemented for this theme's fixed backdrop.
export const rainyFragmentShader = `#version 300 es
precision highp float;
uniform vec2 u_resolution;
uniform vec2 u_imageSize;
uniform float u_time;
uniform sampler2D u_image;
out vec4 outColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float softNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 blend = fract(p);
  blend = blend * blend * (3.0 - 2.0 * blend);
  return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), blend.x),
             mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0)), blend.x), blend.y);
}

vec2 imageUv(vec2 uv) {
  float scale = max(u_resolution.x / u_imageSize.x, u_resolution.y / u_imageSize.y);
  vec2 visible = u_resolution / (u_imageSize * scale);
  return (uv - 0.5) * visible + 0.5;
}

vec3 backdrop(vec2 uv, float lod) {
  return textureLod(u_image, clamp(imageUv(uv), vec2(0.001), vec2(0.999)), lod).rgb;
}

vec2 rainLayer(vec2 p, float time, vec2 grid, float seed) {
  p *= grid;
  p.y += time * (0.42 + seed * 0.16);
  p.y += hash(vec2(floor(p.x), seed)) * 0.7;
  vec2 cell = floor(p);
  vec2 local = fract(p);
  float random = hash(cell + seed);
  vec2 center = vec2(0.24 + 0.52 * hash(cell + seed + 3.1),
                     0.22 + 0.48 * hash(cell + seed + 7.3));
  center.x += 0.035 * sin(time * 0.7 + cell.y * 1.9);
  float radius = mix(0.11, 0.23, hash(cell + seed + 9.7));
  vec2 offset = (local - center) / vec2(radius * 0.72, radius * 1.18);
  float bodyHeight = pow(max(0.0, 1.0 - dot(offset, offset)), 1.6);
  float body = smoothstep(0.0, 0.48, bodyHeight);
  float wiggle = sin(local.y * 13.0 + random * 6.28) * 0.018;
  float tailWidth = mix(0.055, 0.018, smoothstep(center.y, 1.0, local.y));
  float trail = (1.0 - smoothstep(tailWidth * 0.4, tailWidth, abs(local.x - center.x - wiggle)))
              * smoothstep(center.y - 0.04, center.y + 0.05, local.y)
              * (1.0 - smoothstep(center.y + 0.15, 1.15, local.y));
  float dropVisibility = smoothstep(0.08, 0.38, random);
  return vec2(max(body, trail * 0.5) * dropVisibility,
              (bodyHeight + trail * 0.18) * dropVisibility);
}

float fineDrops(vec2 p, float time) {
  p *= vec2(68.0, 43.0);
  vec2 cell = floor(p);
  vec2 point = vec2(hash(cell + 1.8), hash(cell + 5.2));
  float life = fract(hash(cell + 9.1) + time * 0.085);
  float fade = smoothstep(0.0, 0.16, life) * (1.0 - smoothstep(0.75, 1.0, life));
  float d = length((fract(p) - point) * vec2(1.0, 1.3));
  return (1.0 - smoothstep(0.08, 0.23, d)) * fade * step(0.18, hash(cell + 12.4));
}

float fallingRain(vec2 p, float time) {
  vec2 q = p * vec2(105.0, 14.0);
  q.y += time * 6.8;
  vec2 cell = floor(q);
  float random = hash(cell);
  float x = fract(q.x) - hash(cell + 3.7);
  float streak = (1.0 - smoothstep(0.005, 0.034, abs(x)))
               * smoothstep(0.08, 0.38, fract(q.y))
               * (1.0 - smoothstep(0.56, 0.96, fract(q.y)));
  return streak * step(0.7, random);
}

// Lamp positions are in the source image, so their glow stays aligned when the
// cover crop changes with the window size.
float lightHalo(vec2 imagePoint, vec2 light, float radius) {
  vec2 offset = (imagePoint - light) * vec2(u_imageSize.x / u_imageSize.y, 1.0);
  float distanceFromLight = length(offset) / radius;
  float bloom = exp(-distanceFromLight * distanceFromLight * 1.8);
  float core = exp(-distanceFromLight * distanceFromLight * 18.0);
  return bloom * 0.65 + core * 0.35;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 rainUv = (gl_FragCoord.xy - u_resolution * 0.5) / u_resolution.y;
  vec2 large = rainLayer(rainUv + 4.2, u_time * 0.7, vec2(9.0, 4.0), 0.3);
  vec2 small = rainLayer(rainUv + 8.7, u_time, vec2(17.0, 8.0), 4.1);
  float fine = fineDrops(rainUv, u_time);
  float drops = clamp(large.x * 0.82 + small.x * 0.52 + fine * 0.28, 0.0, 1.0);
  float height = large.y * 0.9 + small.y * 0.55 + fine * 0.12;
  // A smooth water height avoids the hard embossed rings produced by the coverage mask.
  vec2 normal = vec2(dFdx(height), dFdy(height));
  vec2 refracted = uv + normal * vec2(0.045, 0.055);

  vec3 clear = backdrop(refracted, 0.0);
  // The source photo already has optical defocus; only add a little glass haze.
  vec3 fog = backdrop(uv, 2.0);
  vec3 color = mix(fog, clear, 0.55 + drops * 0.24);
  float mist = softNoise(uv * vec2(4.0, 3.0) + vec2(u_time * 0.018, -u_time * 0.009));
  float distanceHaze = exp(-pow((uv.y - 0.55) * 2.4, 2.0)) * smoothstep(0.2, 0.65, uv.x);
  color = mix(color, vec3(0.08, 0.14, 0.23),
              smoothstep(0.27, 0.78, mist) * distanceHaze * (1.0 - drops * 0.5) * 0.22);
  vec3 glow = backdrop(uv, 5.0);
  float bright = smoothstep(0.34, 0.78, dot(glow, vec3(0.2126, 0.7152, 0.0722)));
  color += glow * bright * 0.23;
  vec2 imagePoint = imageUv(uv);
  float warmHalo =
      lightHalo(imagePoint, vec2(0.032, 0.695), 0.065) * 0.75
    + lightHalo(imagePoint, vec2(0.553, 0.671), 0.09) * 0.9
    + lightHalo(imagePoint, vec2(0.612, 0.584), 0.055) * 0.55
    + lightHalo(imagePoint, vec2(0.325, 0.541), 0.06) * 0.4
    + lightHalo(imagePoint, vec2(0.585, 0.288), 0.07) * 0.65
    + lightHalo(imagePoint, vec2(0.675, 0.286), 0.07) * 0.65;
  color += vec3(1.0, 0.56, 0.29) * warmHalo * 0.29;
  float localLight = 0.18 + smoothstep(0.22, 0.65, dot(glow, vec3(0.2126, 0.7152, 0.0722)))
                   + min(warmHalo, 1.0) * 0.45;
  float glint = clamp(dot(normal, vec2(-0.6, 0.8)) * 5.5, 0.0, 1.0) * drops;
  color += vec3(1.0, 0.83, 0.67) * glint * localLight * 0.2;
  color *= 1.0 - clamp(dot(normal, vec2(0.6, -0.8)) * 3.0, 0.0, 1.0) * drops * 0.1;
  float rainLight = clamp(bright + warmHalo * 0.7, 0.0, 1.0);
  vec3 rainColor = mix(vec3(0.28, 0.39, 0.5), vec3(1.0, 0.77, 0.51), rainLight);
  color += rainColor * fallingRain(rainUv, u_time) * 0.22;

  float pulse = pow(max(0.0, sin(u_time * 0.33 + sin(u_time * 0.71))), 24.0) * 0.055;
  color += vec3(0.65, 0.72, 0.84) * pulse;

  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float highlight = smoothstep(0.22, 0.78, luminance);
  color *= mix(vec3(0.68, 0.73, 0.82), vec3(0.86, 0.83, 0.79), highlight);
  color *= mix(vec3(1.0), vec3(0.74, 0.79, 0.91), smoothstep(0.48, 0.98, uv.y) * 0.6);
  color = pow(max(color, vec3(0.0)), vec3(1.08));
  color *= mix(0.68, 1.0, smoothstep(0.0, 0.72, 1.0 - length((uv - 0.5) * vec2(1.0, 0.8))));
  outColor = vec4(color, 1.0);
}
`
