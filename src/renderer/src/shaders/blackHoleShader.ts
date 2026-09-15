import {
  CAMERA_RADIUS,
  CRITICAL_IMPACT,
  IMPACT_CURVE,
  IMPACT_EPSILON,
  MAX_IMPACT,
  MAX_PHI,
  ORBIT_HEIGHT,
  ORBIT_WIDTH
} from '@/components/background/themes/blackHoleGeodesics'

export const vertexShader = `#version 300 es
in vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`

export const fragmentShader = `#version 300 es
precision highp float;
uniform vec2 u_resolution;
uniform vec2 u_pointer;
uniform float u_time;
uniform sampler2D u_paths;
uniform sampler2D u_ends;
out vec4 outColor;

const float PI = 3.14159265359;
const float CAMERA = ${CAMERA_RADIUS.toFixed(8)};
const float CRITICAL = ${CRITICAL_IMPACT.toFixed(10)};
const float MAX_IMPACT = ${MAX_IMPACT.toFixed(10)};
const float CURVE = ${IMPACT_CURVE.toFixed(8)};
const float EPSILON = ${IMPACT_EPSILON.toFixed(8)};
const float MAX_PHI = ${MAX_PHI.toFixed(10)};
const int WIDTH = ${ORBIT_WIDTH};
const int HEIGHT = ${ORBIT_HEIGHT};

float hash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                 mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                 mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}

float fbm(vec3 p) {
  return noise(p) * 0.57 + noise(p * 2.03 + 7.1) * 0.28 + noise(p * 4.07 + 13.7) * 0.15;
}

// Inverse of impactAtColumn. Never interpolate across the capture/escape discontinuity.
float orbitColumn(float b) {
  bool outer = b >= CRITICAL;
  float extent = (outer ? MAX_IMPACT - CRITICAL : CRITICAL) - EPSILON;
  float distance = max(0.0, abs(b - CRITICAL) - EPSILON);
  float t = clamp(log(1.0 + distance / CURVE) / log(1.0 + extent / CURVE), 0.0, 1.0);
  float halfWidth = float(WIDTH / 2);
  return outer ? halfWidth + t * (halfWidth - 1.0) : (1.0 - t) * (halfWidth - 1.0);
}

vec2 orbitEnd(float column) {
  int x = int(floor(column));
  return mix(texelFetch(u_ends, ivec2(x, 0), 0).rg,
             texelFetch(u_ends, ivec2(min(x + 1, WIDTH - 1), 0), 0).rg, fract(column));
}

vec2 orbitAt(float column, float phi) {
  vec2 texel = vec2(column, clamp(phi / MAX_PHI, 0.0, 1.0) * float(HEIGHT - 1));
  ivec2 a = ivec2(floor(texel));
  ivec2 b = min(a + 1, ivec2(WIDTH - 1, HEIGHT - 1));
  vec2 f = fract(texel);
  return mix(mix(texelFetch(u_paths, a, 0).rg, texelFetch(u_paths, ivec2(b.x, a.y), 0).rg, f.x),
             mix(texelFetch(u_paths, ivec2(a.x, b.y), 0).rg, texelFetch(u_paths, b, 0).rg, f.x), f.y);
}

// Continuous 3D directional noise avoids a longitude seam in the galaxy.
vec3 sky(vec3 direction, float angularPixel) {
  vec3 galacticNormal = normalize(vec3(0.32, 0.86, -0.39));
  float latitude = dot(direction, galacticNormal);
  float clouds = fbm(direction * 7.0 + 8.0);
  float band = exp(-latitude * latitude * 18.0);
  float dust = smoothstep(0.35, 0.68, fbm(direction * 19.0));
  float lane = exp(-pow((latitude + (clouds - 0.5) * 0.13) * 24.0, 2.0));
  vec3 color = vec3(0.0015, 0.002, 0.005);
  color += mix(vec3(0.024, 0.035, 0.085), vec3(0.14, 0.087, 0.055), clouds)
         * band * (0.3 + clouds) * (1.0 - lane * dust * 0.87);

  // Cubic directional cells, with a pixel footprint to soften minified stars.
  for (int layer = 0; layer < 2; layer++) {
    float scale = layer == 0 ? 145.0 : 270.0;
    vec3 grid = direction * scale;
    vec3 cell = floor(grid);
    float seed = hash(cell + float(layer) * 37.0);
    vec3 center = vec3(hash(cell + 1.3), hash(cell + 5.7), hash(cell + 9.2)) * 0.5 + 0.25;
    float footprint = clamp(angularPixel * scale, 0.035, 0.8);
    float width = 0.085 + footprint * 0.5;
    float star = exp(-dot(fract(grid) - center, fract(grid) - center) / (width * width));
    star *= 0.008 / (width * width) * step(0.91 - band * 0.055, seed);
    color += mix(vec3(0.55,0.7,1.0), vec3(1.0,0.76,0.48), hash(cell + 17.0)) * star * 1.5;
  }
  return color;
}

// Three Planck samples give a compact thermal color approximation, normalized to luminance.
vec3 thermalColor(float temperature) {
  vec3 wavelength = vec3(0.615, 0.545, 0.455);
  vec3 radiance = 1.0 / (pow(wavelength, vec3(5.0)) * (exp(14388.0 / (wavelength * temperature)) - 1.0));
  return radiance / max(dot(radiance, vec3(0.2126, 0.7152, 0.0722)), 0.00001);
}

vec4 diskEmission(vec3 radial, vec3 tangent, vec2 orbit) {
  float radius = 1.0 / orbit.x;
  if (radius <= 3.0 || radius >= 11.5) return vec4(0.0);
  vec3 point = radial * radius;
  float angle = atan(point.z, point.x);
  // Keplerian shear advects turbulent structures at different angular speeds.
  float phase = angle - u_time * 2.4 / pow(radius, 1.5);
  vec3 material = vec3(cos(phase), sin(phase), radius * 0.9);
  float turbulence = fbm(material * vec3(8.0, 8.0, 2.0) + vec3(0,0,u_time * 0.055));
  float filaments = 0.86 + 0.14 * sin(radius * 13.0 + turbulence * 12.0 + phase * 3.0);
  float density = mix(0.28, 1.35, smoothstep(0.22, 0.82, turbulence)) * filaments;
  float edge = smoothstep(3.0, 3.45, radius) * (1.0 - smoothstep(8.0, 11.5, radius));

  // Photon direction in the local static orthonormal frame, toward the camera.
  float lapse = sqrt(1.0 - orbit.x);
  vec3 photon = -normalize(-radial * orbit.y / lapse + tangent * orbit.x);
  vec3 azimuth = normalize(vec3(-point.z, 0.0, point.x));
  float speed = sqrt(0.5 / (radius - 1.0));
  float doppler = sqrt(1.0 - speed * speed) / (1.0 - speed * dot(azimuth, photon));
  float shift = lapse / sqrt(1.0 - 1.0 / CAMERA) * doppler;
  // Bolometric intensity transforms by g^4; the shifted temperature controls color.
  float flux = pow(3.0 / radius, 3.0) * (1.0 - sqrt(3.0 / radius));
  float temperature = 11000.0 * pow(max(flux, 0.00001), 0.25);
  float opacity = 1.0 - exp(-edge * density * 0.65 / max(abs(photon.y), 0.2));
  vec3 emission = thermalColor(clamp(temperature * shift, 1200.0, 16000.0));
  emission *= flux * 35.0 * pow(shift, 4.0) * density;
  return vec4(emission * opacity, opacity);
}

vec3 trace(float impact, vec3 radialBasis, vec3 tangentBasis) {
  float column = orbitColumn(impact);
  vec2 end = orbitEnd(column);
  float crossing = mod(atan(-radialBasis.y, tangentBasis.y) + PI, PI);
  vec3 light = vec3(0.0);
  float transmission = 1.0;
  // Crossings are exactly pi apart in a spherical metric. Trace in observer order.
  for (int image = 0; image < 4; image++) {
    float phi = crossing + float(image) * PI;
    if (phi >= end.x || transmission < 0.015) break;
    vec2 orbit = orbitAt(column, phi);
    if (orbit.x <= 0.0 || orbit.x >= 1.0) continue;
    vec3 radial = radialBasis * cos(phi) + tangentBasis * sin(phi);
    vec3 tangent = -radialBasis * sin(phi) + tangentBasis * cos(phi);
    vec4 disk = diskEmission(radial, tangent, orbit);
    light += transmission * disk.rgb;
    transmission *= 1.0 - disk.a;
  }
  // Captured rays terminate at the horizon; only escaped rays see the lensed galaxy.
  if (end.y > 0.999) {
    vec3 escaped = radialBasis * cos(end.x) + tangentBasis * sin(end.x);
    float angularPixel = 1.0 / min(u_resolution.x, u_resolution.y);
    angularPixel *= 1.0 + 0.15 / max(abs(impact - CRITICAL), 0.005);
    light += transmission * sky(escaped, angularPixel);
  }
  return light;
}

void main() {
  vec2 screen = (gl_FragCoord.xy - u_resolution * 0.5) / min(u_resolution.x, u_resolution.y);
  float yaw = u_pointer.x * 0.32;
  float elevation = 0.23 + u_pointer.y * 0.16;
  vec3 camera = vec3(sin(yaw) * cos(elevation), sin(elevation), cos(yaw) * cos(elevation));
  vec3 right = normalize(cross(vec3(0,1,0), camera));
  vec3 up = cross(camera, right);
  vec3 ray = normalize(-camera * 1.1 + screen.x * right + screen.y * up);
  vec3 transverse = ray - camera * dot(ray, camera);
  float sinAlpha = length(transverse);
  vec3 tangent = sinAlpha > 0.000001 ? transverse / sinAlpha : up;
  float impact = MAX_IMPACT * sinAlpha;
  vec3 light = trace(impact, camera, tangent);
  // Supersample only the critical annulus, where higher-order images are subpixel thin.
  float footprint = max(fwidth(impact), 0.0001);
  if (abs(impact - CRITICAL) < footprint * 1.5) {
    light = (light + trace(max(0.0001, impact - footprint * 0.33), camera, tangent)
                   + trace(impact + footprint * 0.33, camera, tangent)) / 3.0;
  }
  float vignette = 1.0 - 0.3 * smoothstep(0.3, 1.1, length(screen));
  vec3 mapped = vec3(1.0) - exp(-light * vignette * 1.05);
  outColor = vec4(pow(max(mapped, vec3(0.0)), vec3(1.0 / 2.2)), 1.0);
}
`
