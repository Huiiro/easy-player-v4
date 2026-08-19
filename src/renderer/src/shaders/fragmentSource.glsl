precision mediump float;
uniform vec2 u_resolution;
uniform float u_time, u_energy, u_bass, u_beat;
uniform vec3 u_color_a, u_color_b, u_color_c, u_color_d;
uniform sampler2D u_cover, u_cover_blurred;
uniform float u_cover_loaded;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float hash1(float n) {
  return fract(sin(n * 127.1) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float bb = hash(i + vec2(1., 0.));
  float c = hash(i + vec2(0., 1.));
  float d = hash(i + vec2(1., 1.));
  return mix(mix(a, bb, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.;
  v += noise(p) * .55;
  p = p * 1.82 + vec2(11.7, 7.3);
  v += noise(p) * .30;
  p = p * 1.91 + vec2(5.1, 13.2);
  v += noise(p) * .15;
  return v;
}

vec2 flow(vec2 p, float t) {
  float h = .04;
  float x1 = fbm(p + vec2(h, 0.) + vec2(t * .09, -t * .055));
  float x2 = fbm(p - vec2(h, 0.) + vec2(t * .09, -t * .055));
  float y1 = fbm(p + vec2(0., h) + vec2(t * .09, -t * .055));
  float y2 = fbm(p - vec2(0., h) + vec2(t * .09, -t * .055));
  vec2 v = vec2(y1 - y2, x2 - x1) * 2.5;
  v += vec2(noise(p * .32 + vec2(t * .023, 4.1)) - .5, noise(p * .32 + vec2(-t * .019, 8.3)) - .5) * .30;
  return v;
}

float easeMove(float x) {
  float s = sin(x);
  return s * (.68 + .32 * abs(s));
}

vec2 blobPosition(float id, float t) {
  float s = id * 2.17 + 1.3;
  float r1 = hash1(id * 17.3 + 2.1);
  float r2 = hash1(id * 31.7 + 4.7);
  float r3 = hash1(id * 53.9 + 8.2);
  float ax = .19 + r1 * .055;
  float ay = .22 + r2 * .065;
  float sx = .105 + r3 * .045;
  float sy = .085 + r1 * .04;
  float px;
  float py;

  if(id < .5) {
    px = .28 + easeMove(t * (.115 + r1 * .018) + s) * ax;
    py = .30 + easeMove(t * (.083 + r2 * .014) + s * 1.73) * ay;
  } else if(id < 1.5) {
    px = .72 - easeMove(t * (.101 + r2 * .018) + s) * ax;
    py = .31 + easeMove(t * (.091 + r3 * .015) + s * 1.31) * ay;
  } else if(id < 2.5) {
    px = .31 + easeMove(t * (.097 + r3 * .016) + s) * ax;
    py = .70 - easeMove(t * (.108 + r1 * .017) + s * 1.57) * ay;
  } else {
    px = .70 - easeMove(t * (.109 + r1 * .017) + s) * ax;
    py = .69 - easeMove(t * (.087 + r2 * .016) + s * 1.47) * ay;
  }

  px += sin(t * (.041 + r2 * .014) + s * 2.3) * sx;
  py += cos(t * (.037 + r3 * .012) + s * 1.9) * sy;
  float turn = t * (.062 + r3 * .018) + s * 2.7;
  float turnPower = sin(t * (.071 + r1 * .015) + s) * .035;
  px += cos(turn) * turnPower;
  py += sin(turn) * turnPower;
  vec2 f = flow((vec2(px, py) - .5) * 1.35 + vec2(s, -s * .61), t * .72 + s);
  float drag = .055 + u_energy * .025 + u_bass * .018;
  px += f.x * drag;
  py += f.y * drag;
  float push = u_beat * (.018 + u_bass * .012);
  px += cos(turn) * push;
  py += sin(turn) * push;
  return clamp(vec2(px, py), .025, .975);
}

vec4 blobRandom(float id) {
  return vec4(hash1(id * 13.17 + 2.1), hash1(id * 29.71 + 7.4), hash1(id * 47.23 + 11.8), hash1(id * 71.91 + 19.2));
}

float contour(vec2 q, float id, float t) {
  vec4 r = blobRandom(id);
  float a = atan(q.y, q.x);
  float seed = r.x * 17. + r.y * 9.;
  float n1 = sin(a * (1.7 + r.x * 1.5) + seed + t * (.035 + r.y * .014));
  float n2 = sin(a * (3.1 + r.z * 1.7) + seed * 1.71 - t * (.028 + r.x * .012));
  float n3 = sin(a * (5.0 + r.w * 1.8) + seed * 2.13 + t * .021);
  float large = fbm(vec2(cos(a) * 1.1 +
    sin(t * .031 + seed), sin(a) * 1.1 +
    cos(t * .027 + seed)) +
    id * 4.3);
  return n1 * .047 + n2 * .021 + n3 * .009 + (large - .5) * .022;
}

float blob(vec2 p, float id, float t) {
  vec2 center = blobPosition(id, t);
  vec2 q = p - center;
  vec2 f = flow(q * 1.18 + vec2(id * 3.7, -id * 2.1), t + id * 3.2);
  float speed = length(f);
  q -= f * (.055 + u_energy * .035 + u_bass * .025 + speed * .018);
  float ang = atan(f.y, f.x);
  float cs = cos(ang);
  float sn = sin(ang);
  vec2 m = mat2(cs, -sn, sn, cs) * q;
  float stretch = .035 + speed * .20 + u_bass * .035 + u_beat * .055;
  m.x *= 1. + stretch;
  m.y *= 1. - stretch * .38;
  q = mat2(cs, sn, -sn, cs) * m;
  float shear = sin(t * (.075 + id * .013) + id * 2.3) * .16;
  q.x += q.y * shear;
  float rot = sin(t * (.061 + id * .009) + id * 1.7) * .22 + (id - 1.5) * .08;
  cs = cos(rot);
  sn = sin(rot);
  q = mat2(cs, -sn, sn, cs) * q;
  float d = length(q);
  float radius = .405 + u_energy * .018 + u_bass * .023 + u_beat * .035;
  radius += contour(q, id, t);
  radius += dot(q, normalize(f + vec2(.0001))) * speed * .055;
  return radius - d;
}

float mask(float x) {
  return smoothstep(-.045, .035, x);
}

vec3 coverSample(vec2 uv) {
  return texture2D(u_cover_blurred, clamp(uv, .02, .98)).rgb;
}

vec3 broadCover(vec2 uv) {
  vec2 c = clamp(uv, .035, .965);
  vec2 x = vec2(.045, 0.);
  vec2 y = vec2(0., .045);
  vec3 v = coverSample(c) * .38;
  v += coverSample(c + x) * .12;
  v += coverSample(c - x) * .12;
  v += coverSample(c + y) * .12;
  v += coverSample(c - y) * .12;
  v += coverSample(c + x + y) * .07;
  v += coverSample(c - x - y) * .07;
  return v;
}

vec3 colorBlend(float a, float b, float c, float d) {
  float mx = max(max(a, b), max(c, d));
  float wa = exp((a - mx) * 8.);
  float wb = exp((b * .84 - mx) * 8.);
  float wc = exp((c * .57 - mx) * 8.);
  float wd = exp((d * .34 - mx) * 8.);
  float s = wa + wb + wc + wd;
  return (u_color_a * wa + u_color_b * wb + u_color_c * wc + u_color_d * wd) / s;
}

float boundary(float a, float b) {
  float overlap = min(a, b);
  float diff = abs(a - b);
  return overlap * smoothstep(.28, .012, diff);
}

vec3 boundaryColor(float a, float b, vec3 ca, vec3 cb) {
  float k = smoothstep(-.12, .12, b - a);
  return mix(ca, cb, k);
}

void main() {
  vec2 screenUv = gl_FragCoord.xy / u_resolution.xy;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 uv = screenUv;
  uv.x *= aspect;
  float t = u_time * .78;

  float energy = clamp(u_energy, 0., 1.);
  float bass = clamp(u_bass, 0., 1.);
  float beat = clamp(u_beat, 0., 1.);
  vec2 center = uv - vec2(aspect * .5, .5);
  vec2 gv = flow(center * 1.05, t);
  uv -= gv * (.065 + energy * .025 + bass * .025 + beat * .025);
  vec2 p = uv;
  p.x /= aspect;

  float a = mask(blob(p, 0., t));
  float b = mask(blob(p, 1., t));
  float c = mask(blob(p, 2., t));
  float d = mask(blob(p, 3., t));

  /* 主辅色占比 */
  float aw = a * 1.38;
  float bw = b * .93;
  float cw = c * .58;
  float dw = d * .36;

  float total = aw + bw + cw + dw;
  vec3 color = colorBlend(aw, bw, cw, dw);
  float coverage = smoothstep(.015, .18, total);
  vec3 bg = mix(u_color_a * .30 +
    u_color_b * .20, u_color_b * .48 +
    u_color_c * .12, smoothstep(.25, .75, fbm(p * .38 + vec2(t * .025, -t * .019))));
  color = mix(bg, color, coverage);
  float ab = boundary(a, b);
  float ac = boundary(a, c) * .42;
  float ad = boundary(a, d) * .28;
  float bc = boundary(b, c) * .34;
  float bd = boundary(b, d) * .22;
  float cd = boundary(c, d) * .16;
  float edgeTotal = ab + ac + ad + bc + bd + cd;
  vec3 edgeColor = boundaryColor(a, b, u_color_a, u_color_b);
  edgeColor = mix(edgeColor, u_color_c, smoothstep(.15, .75, ac + bc));
  edgeColor = mix(edgeColor, u_color_d, smoothstep(.12, .55, ad + bd + cd));
  color = mix(color, edgeColor, clamp(edgeTotal * .105 +
    ab * u_bass * .055 +
    ab * u_beat * .08, 0., .16));
  float liquid = fbm(p * 1.05 + gv * .45 + vec2(t * .034, -t * .025));
  color *= .88 + liquid * .25;
  vec2 coverUv = p + flow(p * .72, t * .68) * .07;
  vec3 cover = broadCover(coverUv);
  color = mix(color, cover, u_cover_loaded * .50);
  color = mix(color, color * cover * 1.4, u_cover_loaded * .12);
  color *= .92 + energy * .12;
  color *= 1. + bass * .065;
  color *= 1. + beat * .11;

  float pulse = exp(-length(center) * 2.3) * beat;
  color += color * pulse * .10;
  float lum = dot(color, vec3(.2126, .7152, .0722));
  color = mix(vec3(lum), color, 1.08 + bass * .05);
  color = 1. - exp(-color * 1.4);
  float vignette = 1. - smoothstep(.26, 1.02, distance(screenUv, vec2(.47, .51)));
  color *= .78 + vignette * .22;
  gl_FragColor = vec4(color, 1.);
}
