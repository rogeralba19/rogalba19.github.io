/* ============================================================
 * AVATAR — fragmentos GLSL compartidos
 * ============================================================ */

// Simplex 3D con gradiente analítico (Ashima Arts / Stefan Gustavson, MIT).
// El gradiente permite curl noise con 3 evaluaciones en vez de 18.
export const NOISE = /* glsl */`
vec4 av_perm(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
vec4 av_tis(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoiseG(vec3 v, out vec3 gradient) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod(i, 289.0);
    vec4 p = av_perm(av_perm(av_perm(
        i.z + vec4(0.0, i1.z, i2.z, 1.0)) +
        i.y + vec4(0.0, i1.y, i2.y, 1.0)) +
        i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = av_tis(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    vec4 m2 = m * m;
    vec4 m4 = m2 * m2;
    vec4 pdotx = vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3));
    vec4 temp = m2 * m * pdotx;
    gradient = -8.0 * (temp.x * x0 + temp.y * x1 + temp.z * x2 + temp.w * x3);
    gradient += m4.x * p0 + m4.y * p1 + m4.z * p2 + m4.w * p3;
    gradient *= 42.0;
    return 42.0 * dot(m4, pdotx);
}
float snoise(vec3 v) { vec3 g; return snoiseG(v, g); }
vec3 curlNoise(vec3 p) {
    vec3 g1, g2, g3;
    snoiseG(p, g1);
    snoiseG(p + vec3(31.416, -47.853, 12.793), g2);
    snoiseG(p + vec3(-233.145, -113.408, -185.31), g3);
    return vec3(g3.y - g2.z, g1.z - g3.x, g2.x - g1.y);
}
`;

// Posición objetivo de una partícula sobre la malla deformada.
// tLand: 32x16 texels con los 478 landmarks deformados (espacio local).
// tRefA: (índice a, índice b, índice c, offset normal); tRefB: (u, v, semilla, región).
export const TARGET = /* glsl */`
uniform sampler2D tLand;
uniform sampler2D tRefA;
uniform sampler2D tRefB;
vec3 av_lm(float i) {
    vec2 c = vec2(mod(i, 32.0) + 0.5, floor(i / 32.0) + 0.5) / vec2(32.0, 16.0);
    return texture2D(tLand, c).xyz;
}
vec3 av_target(vec4 A, vec4 B, out vec3 nrm) {
    vec3 a = av_lm(A.x), b = av_lm(A.y), c = av_lm(A.z);
    vec3 n = cross(b - a, c - a);
    float ln = length(n);
    nrm = ln > 1e-9 ? n / ln : vec3(0.0, 0.0, 1.0);
    return a * (1.0 - B.x - B.y) + b * B.x + c * B.y + nrm * A.w;
}
`;

export const VELOCITY = /* glsl */`
${TARGET}
uniform float uTime;
uniform float uDt;
uniform float uAssemble;   // 0 = polvo disperso, 1 = rostro ensamblado
uniform float uInstab;     // 0..1
uniform float uDissolve;   // 0..1 fracción de rostro liberada
uniform float uCurl;
uniform float uStatic;     // reduced motion: posición = objetivo
uniform vec3 uPointer;     // cursor en espacio local
uniform float uPointerStr;
${NOISE}
void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 P = texture2D(texturePosition, uv);
    vec4 V = texture2D(textureVelocity, uv);
    vec4 A = texture2D(tRefA, uv);
    vec4 B = texture2D(tRefB, uv);
    vec3 nrm;
    vec3 target = av_target(A, B, nrm);
    float dt = max(uDt, 1e-4);

    if (uStatic > 0.5) {
        gl_FragColor = vec4((target - P.xyz) / dt, 0.0);
        return;
    }

    // Máscara de disolución: ruido simplex animado sobre la superficie
    float d = snoise(target * 2.4 + vec3(0.0, uTime * 0.11, uTime * 0.07)) * 0.5 + 0.5;
    float thr = 1.0 - uDissolve;
    float released = uDissolve > 0.001 ? smoothstep(thr, thr + 0.07, d) : 0.0;
    float edge = uDissolve > 0.001 ? exp(-pow((d - thr) / 0.035, 2.0)) : 0.0;

    // Resorte hacia la malla (se afloja en lo disuelto)
    float ease = uAssemble * uAssemble * (3.0 - 2.0 * uAssemble);
    float k = mix(0.6, 46.0, ease) * (1.0 - released * 0.97);
    vec3 acc = (target - P.xyz) * k;

    // Curl noise: respiración del polvo + dispersión de lo liberado
    float curlAmt = uCurl * (0.04 + 0.22 * uInstab) + released * 0.55 + (1.0 - ease) * 1.6;
    acc += curlNoise(P.xyz * 1.7 + vec3(0.0, 0.0, uTime * 0.09)) * curlAmt;
    acc += (nrm * 0.18 + vec3(0.0, 0.12, 0.0)) * released;

    // Cursor: toca la señal y la dispersa
    vec3 dp = P.xyz - uPointer;
    dp.z *= 0.35;
    float r2 = dot(dp, dp);
    acc += normalize(dp + 1e-5) * uPointerStr * exp(-r2 / 0.0065) * 9.0;

    vec3 v = V.xyz + acc * dt;
    v *= exp(-dt * mix(2.2, 8.5, ease));
    gl_FragColor = vec4(v, edge);
}
`;

export const POSITION = /* glsl */`
uniform float uDt;
void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 P = texture2D(texturePosition, uv);
    vec4 V = texture2D(textureVelocity, uv);
    gl_FragColor = vec4(P.xyz + V.xyz * uDt, 1.0);
}
`;

export const POINTS_VS = /* glsl */`
${TARGET}
uniform sampler2D tPos;
uniform sampler2D tVel;
uniform sampler2D tPhoto;
uniform float uUseSim;
uniform float uSizePx;     // px por unidad local a profundidad de referencia
uniform float uRefDepth;
uniform float uPointSize;
uniform float uAlpha;
uniform float uBlinkR;
uniform float uBlinkL;
uniform float uTime;
uniform float uJitter;
uniform float uLumLo;
uniform float uLumHi;
attribute vec2 aUv;
varying vec3 vColor;
varying float vAlpha;

vec3 palette(float t) {
    // negro azulado -> azul profundo -> cian #00aaff -> hielo -> blanco menta
    vec3 c0 = vec3(0.004, 0.02, 0.06);
    vec3 c1 = vec3(0.0, 0.16, 0.42);
    vec3 c2 = vec3(0.0, 0.62, 1.0);
    vec3 c3 = vec3(0.55, 0.92, 1.0);
    vec3 c4 = vec3(0.86, 1.0, 0.94);
    if (t < 0.25) return mix(c0, c1, t / 0.25);
    if (t < 0.55) return mix(c1, c2, (t - 0.25) / 0.3);
    if (t < 0.85) return mix(c2, c3, (t - 0.55) / 0.3);
    return mix(c3, c4, (t - 0.85) / 0.15);
}

void main() {
    vec2 ref = position.xy;
    vec4 A = texture2D(tRefA, ref);
    vec4 B = texture2D(tRefB, ref);
    vec3 nrm;
    vec3 target = av_target(A, B, nrm);
    vec3 p = target;
    float edge = 0.0;
    if (uUseSim > 0.5) {
        p = texture2D(tPos, ref).xyz;
        edge = texture2D(tVel, ref).w;
    }
    float seed = B.z;
    float region = B.w;

    // glitch: desplazamiento por franjas horizontales
    if (uJitter > 0.0) {
        float band = floor(p.y * 38.0 + floor(uTime * 24.0) * 7.0);
        float h = fract(sin(band * 91.7) * 43758.5453);
        p.x += (h - 0.5) * 0.09 * uJitter * step(0.62, h);
    }

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float depthK = uRefDepth / max(-mv.z, 1e-3);
    gl_PointSize = max(1.0, uPointSize * uSizePx * depthK * (0.55 + 0.9 * seed));
    gl_Position = projectionMatrix * mv;

    float lum = dot(texture2D(tPhoto, aUv).rgb, vec3(0.299, 0.587, 0.114));
    lum = smoothstep(uLumLo, uLumHi, lum);
    vec3 col = palette(lum);
    float a = uAlpha * (0.18 + 0.82 * lum);

    // polvo liberado: más tenue cuanto más lejos de la malla
    float disp = length(p - target);
    a *= 1.0 - smoothstep(0.03, 0.6, disp) * 0.7;
    // borde de disolución brillante
    col += vec3(0.35, 1.0, 0.85) * edge * 1.6;
    a += edge * uAlpha * 1.4;

    // iris: tinte del verde del sitio y cierre con el párpado
    if (region > 0.5 && region < 2.5) {
        float blink = region < 1.5 ? uBlinkR : uBlinkL;
        col = mix(col, vec3(0.0, 1.0, 0.533), 0.35);
        a *= (1.0 - blink) * 1.25;
    }
    vColor = col;
    vAlpha = a;
}
`;

export const POINTS_FS = /* glsl */`
precision highp float;
varying vec3 vColor;
varying float vAlpha;
void main() {
    vec2 q = gl_PointCoord - 0.5;
    float d = length(q) * 2.0;
    if (d > 1.0) discard;
    float a = exp(-d * d * 3.2) * (1.0 - smoothstep(0.75, 1.0, d));
    gl_FragColor = vec4(vColor, a * vAlpha);
}
`;

export const QUAD_VS = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Persistencia tipo fósforo: el frame nuevo sobre la estela que decae
export const PERSIST_FS = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tCur;
uniform sampler2D tPrev;
uniform float uDecay;
void main() {
    vec3 c = texture2D(tCur, vUv).rgb;
    vec3 p = texture2D(tPrev, vUv).rgb * uDecay;
    // la estela se enfría hacia el azul del sitio
    p *= vec3(0.82, 0.94, 1.0);
    gl_FragColor = vec4(max(c, p), 1.0);
}
`;

// Look de la capa del avatar: aberración cromática, franjas de glitch,
// parpadeo de intensidad, scanlines finas y grano animado.
export const LOOK_FS = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uRes;
uniform float uTime;
uniform float uChroma;
uniform float uGlitch;
uniform float uGlitchSeed;
uniform float uFlicker;
uniform float uGrain;
uniform float uScan;
uniform float uOpacity;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
    vec2 uv = vUv;
    if (uGlitch > 0.0) {
        float rows = mix(10.0, 46.0, hash(vec2(uGlitchSeed, 1.7)));
        float band = floor(uv.y * rows);
        float h = hash(vec2(band, uGlitchSeed));
        if (h < 0.38) uv.x += (hash(vec2(band * 1.7, uGlitchSeed + 3.1)) - 0.5) * 0.12 * uGlitch;
    }
    vec2 dir = uv - 0.5;
    float ca = uChroma + uGlitch * 0.012;
    vec3 c;
    c.r = texture2D(tSrc, uv + dir * ca).r;
    c.g = texture2D(tSrc, uv).g;
    c.b = texture2D(tSrc, uv - dir * ca).b;
    float lum = max(max(c.r, c.g), c.b);
    // scanlines finas en píxeles de pantalla
    float s = 0.5 + 0.5 * sin(gl_FragCoord.y * 3.14159 * 0.66);
    c *= 1.0 - uScan * (1.0 - s);
    // grano animado (más visible donde hay rostro)
    float g = hash(gl_FragCoord.xy + fract(uTime * 7.31) * 113.0) - 0.5;
    c += g * uGrain * (lum * 0.9 + 0.025);
    c *= uFlicker * uOpacity;
    gl_FragColor = vec4(max(c, 0.0), 1.0);
}
`;
