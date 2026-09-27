#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_resolution;
uniform vec3 u_color;

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    float luminance = dot(u_color, vec3(0.2126, 0.7152, 0.0722));
    vec3 pigment = mix(vec3(luminance), u_color, 0.74);
    // Achromatic covers get distinct graphite / warm ivory materials, rather
    // than the same flat gray. Keep the original brightness as the material cue.
    float chroma = max(u_color.r, max(u_color.g, u_color.b)) - min(u_color.r, min(u_color.g, u_color.b));
    float neutral = 1.0 - smoothstep(0.035, 0.12, chroma);
    vec3 neutralMaterial = mix(vec3(0.09, 0.13, 0.18), vec3(0.72, 0.66, 0.54), smoothstep(0.15, 0.85, luminance));
    pigment = mix(pigment, neutralMaterial, neutral);
    // Pale artwork must not turn the entire application into a light source.
    pigment *= 0.72 / max(0.72, max(pigment.r, max(pigment.g, pigment.b)));
    // An opaque, softly tinted material. Only a nearly imperceptible surface
    // falloff and static grain remain: no light bands, moving shapes or hotspots.
    vec3 color = vec3(0.055, 0.062, 0.064) + pigment * 0.16;
    float edge = smoothstep(0.25, 0.75, length(uv - 0.5));
    color *= (0.98 + uv.y * 0.02) * (1.0 - edge * 0.025);
    float grain = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    gl_FragColor = vec4(clamp(color + (grain - 0.5) * 1.2 / 255.0, 0.0, 1.0), 1.0);
}
