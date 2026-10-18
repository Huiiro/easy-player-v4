export const rainyVertexShader = `#version 300 es
in vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`

// Adapted from the user's local rainy_window_shader_adapted.html.
// Rain functions originate from Heartfelt, Martijn Steinrucken (BigWings), 2017.
// https://www.shadertoy.com/view/ltffzl — original shader: CC BY-NC-SA 3.0.
// Preserve its field sampling and focus parameters; the host bounds pixel cost.
export const rainyFragmentShader = `#version 300 es
  precision highp float;

  uniform vec2 u_resolution;
  uniform vec2 u_imageSize;
  uniform float u_time;
  uniform sampler2D u_image;

  out vec4 outColor;

  // Explicit Hermite interpolation supports the reference's descending edges.
  float S(float start, float end, float value) {
    float t = clamp((value - start) / (end - start), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
  }

  vec2 imageUv(vec2 uv) {
    float scale = max(u_resolution.x / u_imageSize.x, u_resolution.y / u_imageSize.y);
    vec2 visible = u_resolution / (u_imageSize * scale);
    return clamp((uv - 0.5) * visible + 0.5, vec2(0.001), vec2(0.999));
  }
  #define USE_POST_PROCESSING

  vec3 N13(float p) {
     vec3 p3 = fract(vec3(p) * vec3(.1031,.11369,.13787));
     p3 += dot(p3, p3.yzx + 19.19);
     return fract(vec3((p3.x + p3.y)*p3.z, (p3.x+p3.z)*p3.y, (p3.y+p3.z)*p3.x));
  }

  float N(float t) {
      return fract(sin(t*12345.564)*7658.76);
  }

  float Saw(float b, float t) {
    return S(0., b, t)*S(1., b, t);
  }

  vec2 DropLayer2(vec2 uv, float t) {
      vec2 UV = uv;

      uv.y += t*0.75;
      vec2 a = vec2(6., 1.);
      vec2 grid = a*2.;
      vec2 id = floor(uv*grid);

      float colShift = N(id.x);
      uv.y += colShift;

      id = floor(uv*grid);
      vec3 n = N13(id.x*35.2+id.y*2376.1);
      vec2 st = fract(uv*grid)-vec2(.5, 0);

      float x = n.x-.5;

      float y = UV.y*20.;
      float wiggle = sin(y+sin(y));
      x += wiggle*(.5-abs(x))*(n.z-.5);
      x *= .7;
      float ti = fract(t+n.z);
      y = (Saw(.85, ti)-.5)*.9+.5;
      vec2 p = vec2(x, y);

      float d = length((st-p)*a.yx);

      float mainDrop = S(.4, .0, d);

      float r = sqrt(S(1., y, st.y));
      float cd = abs(st.x-x);
      float trail = S(.23*r, .15*r*r, cd);
      float trailFront = S(-.02, .02, st.y-y);
      trail *= trailFront*r*r;

      y = UV.y;
      float trail2 = S(.2*r, .0, cd);
      float droplets = max(0., (sin(y*(1.-y)*120.)-st.y))*trail2*trailFront*n.z;
      y = fract(y*10.)+(st.y-.5);
      float dd = length(st-vec2(x, y));
      droplets = S(.3, 0., dd);
      float m = mainDrop+droplets*r*trailFront;

      return vec2(m, trail);
  }

  float StaticDrops(vec2 uv, float t) {
    uv *= 40.;

    vec2 id = floor(uv);
    uv = fract(uv)-.5;
    vec3 n = N13(id.x*107.45+id.y*3543.654);
    vec2 p = (n.xy-.5)*.7;
    float d = length(uv-p);

    float fade = Saw(.025, fract(t+n.z));
    float c = S(.3, 0., d)*fract(n.z*10.)*fade;
    return c;
  }

  vec2 Drops(vec2 uv, float t, float l0, float l1, float l2) {
    float s = StaticDrops(uv, t)*l0;
    vec2 m1 = DropLayer2(uv, t)*l1;
    vec2 m2 = DropLayer2(uv*1.85, t)*l2;

    float c = s+m1.x+m2.x;
    c = S(.3, 1., c);

    return vec2(c, max(m1.y*l0, m2.y*l1));
  }

  void main() {
    vec2 fragCoord = gl_FragCoord.xy;
    vec2 uv = (fragCoord.xy-.5*u_resolution) / u_resolution.y;
    vec2 UV = fragCoord.xy/u_resolution;

    float T = u_time;

    float t = T*.2;

    float rainAmount = (sin(T*.05)*.3+.7);

    // Camera / framing kept subtle; stronger fogginess than the original version.
    float zoom = 0.96 + 0.04*sin(T*.08);
    uv *= zoom;
    UV = (UV-.5)*(0.94+0.03*sin(T*.09)) + .5;

    float maxBlur = mix(3.5, 7.0, rainAmount);
    float minBlur = 2.5;

    float staticDrops = S(-.5, 1., rainAmount)*2.0;
    float layer1 = S(.25, .75, rainAmount);
    float layer2 = S(.0, .5, rainAmount);

    vec2 c = Drops(uv, t, staticDrops, layer1, layer2);

    vec2 e = vec2(.0012, 0.);
    float cx = Drops(uv+e, t, staticDrops, layer1, layer2).x;
    float cy = Drops(uv+e.yx, t, staticDrops, layer1, layer2).x;
    vec2 n = vec2(cx-c.x, cy-c.x);

    float focus = mix(maxBlur-c.y, minBlur, S(.1, .2, c.x));

    // Stronger refraction / distortion than the earlier attempts.
    vec2 distort = n * mix(0.5, 1.2, rainAmount);
    vec3 col = textureLod(u_image, imageUv(clamp(UV + distort, 0.0, 1.0)), focus).rgb;

    #ifdef USE_POST_PROCESSING
      float tt = (T+3.)*.5;
      float colFade = sin(tt*.2)*.5+.5;
      col *= mix(vec3(1.), vec3(.84, .92, 1.18), colFade*0.55); // subtle cool lift
      float lightning = sin(tt*sin(tt*10.));
      lightning *= pow(max(0., sin(tt+sin(tt))), 10.);
      col *= 1. + lightning * 0.12;
      vec2 vv = UV - .5;
      col *= 1.0 - dot(vv, vv) * 0.65;
    #endif

    // Slight bloom-like lift for warm lights.
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col += pow(max(lum - 0.42, 0.0), 1.6) * vec3(0.09, 0.07, 0.05);

    outColor = vec4(col, 1.0);
  }
`
