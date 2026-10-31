/* ============================================================
 * AVATAR DE CONCIENCIA DIGITAL — Alba Studio
 * Rostro de partículas reconstruido desde assets/avatar/malla.json
 * (generado offline con tools/generar-malla.html) y animado de forma
 * procedural. Vive en la escena de la Galaxia, en la capa 1, detrás del
 * grafo; la Galaxia lo compone en su post-procesado.
 * ============================================================ */

import * as THREE from '../vendor/three.module.min.js';
import { GPUComputationRenderer } from '../vendor/GPUComputationRenderer.js';
import { VELOCITY, POSITION, POINTS_VS, POINTS_FS, QUAD_VS, PERSIST_FS, LOOK_FS } from './shaders.js';

export const AVATAR_LAYER = 1;
const LM_COUNT = 478;
const LM_TEX_W = 32, LM_TEX_H = 16;

// ------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const rand = (a, b) => a + Math.random() * (b - a);

// Ruido 1D de valor suave (determinista, barato) para la animación en CPU
function makeNoise1D(seed) {
    const tbl = new Float32Array(256);
    let s = seed * 9301 + 49297;
    for (let i = 0; i < 256; i++) { s = (s * 9301 + 49297) % 233280; tbl[i] = s / 233280 * 2 - 1; }
    return (x) => {
        const i = Math.floor(x), f = x - i;
        const a = tbl[i & 255], b = tbl[(i + 1) & 255];
        const u = f * f * (3 - 2 * f);
        return a + (b - a) * u;
    };
}
function fbm(n, x) { return n(x) * 0.6 + n(x * 2.13 + 17.3) * 0.28 + n(x * 4.37 + 41.1) * 0.12; }

function gaussian() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ------------------------------------------------------------
// Carga (lazy) de la malla y la foto
// ------------------------------------------------------------
async function loadAssets(base) {
    const res = await fetch(base + 'malla.json', { cache: 'force-cache' });
    if (!res.ok) throw new Error('malla.json no disponible');
    const mesh = await res.json();
    if (!mesh.landmarks || mesh.landmarks.length !== LM_COUNT * 3) throw new Error('malla.json inválida');
    const img = new Image();
    img.decoding = 'async';
    img.src = base + (mesh.texture && mesh.texture.file || 'rostro.webp');
    await img.decode();
    return { mesh, img };
}

// ------------------------------------------------------------
// Deformación procedural de los 478 landmarks (CPU, barata)
// ------------------------------------------------------------
class FaceRig {
    constructor(mesh) {
        this.rest = Float32Array.from(mesh.landmarks);
        this.out = new Float32Array(this.rest);
        const R = mesh.regions;
        this.R = R;
        const L = this.rest;
        const P = (i) => [L[i * 3], L[i * 3 + 1], L[i * 3 + 2]];

        // Ojos: ancho (distancia entre comisuras) para escalar la mirada
        const eyeW = (c) => Math.hypot(L[c[0] * 3] - L[c[1] * 3], L[c[0] * 3 + 1] - L[c[1] * 3 + 1]);
        this.eyes = [
            { up: R.rightEyeUpper, low: R.rightEyeLower, outer: R.rightEyeUpperOuter, iris: R.rightIris, w: eyeW(R.rightEyeCorners) },
            { up: R.leftEyeUpper, low: R.leftEyeLower, outer: R.leftEyeUpperOuter, iris: R.leftIris, w: eyeW(R.leftEyeCorners) }
        ];

        // Mandíbula: peso por landmark según distancia bajo la línea de la boca
        const mouthY = (L[13 * 3 + 1] + L[14 * 3 + 1]) / 2;
        const mouthX = (L[13 * 3] + L[14 * 3]) / 2;
        const chinY = L[152 * 3 + 1];
        const jawHalf = Math.abs(L[172 * 3] - L[397 * 3]) * 0.5 + 1e-3;
        const span = Math.max(0.02, mouthY - chinY);
        this.jawW = new Float32Array(LM_COUNT);
        this.lipUpW = new Float32Array(LM_COUNT);
        for (let i = 0; i < LM_COUNT; i++) {
            const [x, y] = P(i);
            const below = smoothstep(0.0, 0.18, (mouthY - y) / span);
            const lateral = Math.exp(-Math.pow((x - mouthX) / (jawHalf * 1.25), 2));
            const fall = 1 - smoothstep(1.0, 1.35, (mouthY - y) / span); // nada por debajo del mentón
            this.jawW[i] = below * lateral * Math.max(fall, 0.85);
        }
        for (const i of [...R.lipsLowerInner, ...R.lipsLowerOuter]) this.jawW[i] = 1;
        for (const i of [...R.lipsUpperInner, ...R.lipsUpperOuter]) { this.jawW[i] = 0; this.lipUpW[i] = 1; }
        for (const i of R.mouthCorners) { this.jawW[i] = 0.45; this.lipUpW[i] = 0; }

        // Cejas: elevación con caída suave hacia la frente cercana
        const brows = [...R.rightBrow, ...R.leftBrow];
        const browY = brows.reduce((s, i) => s + L[i * 3 + 1], 0) / brows.length;
        this.browW = new Float32Array(LM_COUNT);
        for (let i = 0; i < LM_COUNT; i++) {
            const [x, y] = P(i);
            if (y < browY - 0.035) continue;
            let dmin = Infinity;
            for (const b of brows) dmin = Math.min(dmin, Math.hypot(x - L[b * 3], y - L[b * 3 + 1]));
            this.browW[i] = Math.exp(-Math.pow(dmin / 0.07, 2));
        }
        // Pivote de la cabeza: detrás del centro del rostro
        this.pivot = [0, -0.05, -0.45];
    }

    // s: estado animado (ya suavizado)
    apply(s) {
        const L = this.rest, O = this.out;
        O.set(L);

        // Parpadeo: el superior baja al encuentro del inferior
        for (let e = 0; e < 2; e++) {
            const eye = this.eyes[e];
            const b = e === 0 ? s.blinkR : s.blinkL;
            let midDy = 0;
            for (let k = 0; k < eye.up.length; k++) {
                const u = eye.up[k] * 3, l = eye.low[k] * 3;
                const mx = L[u] + (L[l] - L[u]) * 0.78, my = L[u + 1] + (L[l + 1] - L[u + 1]) * 0.78;
                const dx = (mx - L[u]) * b, dy = (my - L[u + 1]) * b;
                O[u] += dx; O[u + 1] += dy;
                O[l] += (mx - L[l]) * b; O[l + 1] += (my - L[l + 1]) * b;
                const o = eye.outer[k] * 3;
                O[o] += dx * 0.5; O[o + 1] += dy * 0.5;
                if (k === 3) midDy = dy;
            }
            // Mirada: el iris se desplaza dentro del ojo
            const gx = s.gazeX * eye.w * 0.16, gy = s.gazeY * eye.w * 0.09;
            for (const i of eye.iris) {
                O[i * 3] += gx;
                O[i * 3 + 1] += gy + midDy * 0.35;
            }
        }

        // Boca: mandíbula abre, labio superior apenas sube
        if (s.jaw > 1e-4 || s.lip > 1e-4) {
            const jy = -s.jaw * 0.055, jz = -s.jaw * 0.018, ly = s.lip * 0.007;
            for (let i = 0; i < LM_COUNT; i++) {
                const w = this.jawW[i];
                if (w > 0) { O[i * 3 + 1] += jy * w; O[i * 3 + 2] += jz * w; }
                const wu = this.lipUpW[i];
                if (wu > 0) O[i * 3 + 1] += ly * wu;
            }
        }
        // Cejas
        if (s.brow > 1e-4) {
            const by = s.brow * 0.022;
            for (let i = 0; i < LM_COUNT; i++) if (this.browW[i] > 0) O[i * 3 + 1] += by * this.browW[i];
        }

        // Respiración + rotación de cabeza alrededor del pivote
        const sc = 1 + s.breath * 0.007, ty = s.breath * 0.006;
        const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
        const cx = Math.cos(s.pitch), sx = Math.sin(s.pitch);
        const cz = Math.cos(s.roll), sz = Math.sin(s.roll);
        const [px, py, pz] = this.pivot;
        for (let i = 0; i < LM_COUNT; i++) {
            let x = (O[i * 3] - px) * sc, y = (O[i * 3 + 1] - py) * sc, z = (O[i * 3 + 2] - pz) * sc;
            // roll (Z)
            let x1 = x * cz - y * sz, y1 = x * sz + y * cz;
            // pitch (X)
            let y2 = y1 * cx - z * sx, z2 = y1 * sx + z * cx;
            // yaw (Y)
            let x3 = x1 * cy + z2 * sy, z3 = -x1 * sy + z2 * cy;
            O[i * 3] = x3 + px; O[i * 3 + 1] = y2 + py + ty; O[i * 3 + 2] = z3 + pz;
        }
        return O;
    }
}

// ------------------------------------------------------------
// Muestreo de partículas sobre la superficie (una sola vez por tamaño)
// ------------------------------------------------------------
function buildParticles(mesh, size, onFace) {
    const L = mesh.landmarks, UV = mesh.uv, T = mesh.triangles, R = mesh.regions;
    const triCount = T.length / 3;
    const setOf = (...lists) => new Set(lists.flat());
    const eyeRing = setOf(R.rightEyeUpper, R.rightEyeLower, R.rightEyeCorners, R.leftEyeUpper, R.leftEyeLower, R.leftEyeCorners);
    const eyeNear = setOf([...eyeRing], R.rightEyeUpperOuter, R.leftEyeUpperOuter);
    const irisR = new Set(R.rightIris), irisL = new Set(R.leftIris);
    const lips = setOf(R.lipsUpperOuter, R.lipsUpperInner, R.lipsLowerOuter, R.lipsLowerInner, R.mouthCorners);
    const brows = setOf(R.rightBrow, R.leftBrow);

    const cdf = new Float64Array(triCount);
    const triRegion = new Uint8Array(triCount);
    let acc = 0;
    for (let t = 0; t < triCount; t++) {
        const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2];
        const ux = L[b * 3] - L[a * 3], uy = L[b * 3 + 1] - L[a * 3 + 1], uz = L[b * 3 + 2] - L[a * 3 + 2];
        const vx = L[c * 3] - L[a * 3], vy = L[c * 3 + 1] - L[a * 3 + 1], vz = L[c * 3 + 2] - L[a * 3 + 2];
        const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
        const vs = [a, b, c];
        let mult = 1, region = 0;
        if (vs.every(v => irisR.has(v))) { mult = 7; region = 1; }
        else if (vs.every(v => irisL.has(v))) { mult = 7; region = 2; }
        else if (vs.every(v => eyeRing.has(v))) { mult = 4.5; region = 3; }
        else if (vs.some(v => eyeNear.has(v))) { mult = 3.0; region = 3; }
        else if (vs.some(v => lips.has(v))) { mult = 2.6; region = 4; }
        else if (vs.some(v => brows.has(v))) { mult = 1.5; }
        acc += area * mult;
        cdf[t] = acc;
        triRegion[t] = region;
    }

    const count = size * size;
    const refA = new Float32Array(count * 4);
    const refB = new Float32Array(count * 4);
    const pos0 = new Float32Array(count * 4);
    const ref = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
        // triángulo por área ponderada (búsqueda binaria en la CDF)
        const r = Math.random() * acc;
        let lo = 0, hi = triCount - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < r) lo = mid + 1; else hi = mid; }
        const t = lo;
        // baricéntricas uniformes
        let u = Math.random(), v = Math.random();
        if (u + v > 1) { u = 1 - u; v = 1 - v; }
        const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2];
        const reg = triRegion[t];
        // grosor volumétrico: la mayoría pegada a la piel, una bruma más profunda
        const thick = reg === 1 || reg === 2 ? 0.002 : (Math.random() < 0.82 ? 0.006 : 0.03);
        const off = gaussian() * thick;
        refA.set([a, b, c, off], i * 4);
        refB.set([u, v, Math.random(), reg], i * 4);
        const w = 1 - u - v;
        uv[i * 2] = UV[a * 2] * w + UV[b * 2] * u + UV[c * 2] * v;
        uv[i * 2 + 1] = UV[a * 2 + 1] * w + UV[b * 2 + 1] * u + UV[c * 2 + 1] * v;
        ref[i * 3] = ((i % size) + 0.5) / size;
        ref[i * 3 + 1] = (Math.floor(i / size) + 0.5) / size;
        if (onFace) {
            // ya ensamblado (reconstrucción por rendimiento / sin entrada)
            for (let k = 0; k < 3; k++) {
                pos0[i * 4 + k] = onFace[a * 3 + k] * w + onFace[b * 3 + k] * u + onFace[c * 3 + k] * v +
                    (Math.random() - 0.5) * 0.01;
            }
            pos0[i * 4 + 3] = 1;
        } else {
            // posición inicial: ruido disperso alrededor del rostro
            const dir = new THREE.Vector3(gaussian(), gaussian(), gaussian()).normalize();
            const rad = 0.6 + Math.pow(Math.random(), 0.5) * 2.2;
            pos0.set([dir.x * rad * 1.6, dir.y * rad, dir.z * rad * 0.6, 1], i * 4);
        }
    }
    return { count, refA, refB, pos0, ref, uv };
}

// ------------------------------------------------------------
// API pública
// ------------------------------------------------------------
export async function createAvatar(opts) {
    const { renderer, scene, camera, isMobile, reducedMotion, debug, stage = 6 } = opts;
    const base = opts.base || 'assets/avatar/';

    if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2 requerido');
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const fullFloat = renderer.extensions.has('EXT_color_buffer_float') && !isIOS;
    if (!fullFloat && !renderer.extensions.has('EXT_color_buffer_half_float') &&
        !renderer.extensions.has('EXT_color_buffer_float')) throw new Error('Sin render targets flotantes');
    const simType = fullFloat ? THREE.FloatType : THREE.HalfFloatType;

    const { mesh, img } = await loadAssets(base);

    const photo = new THREE.Texture(img);
    photo.flipY = false;               // las UV vienen con v hacia abajo
    photo.minFilter = THREE.LinearFilter;
    photo.generateMipmaps = false;
    photo.needsUpdate = true;

    // Auto-nivel: rango de luminancia de la piel en ESTA foto (percentiles
    // sobre los landmarks), para que cualquier foto use toda la paleta.
    const lumRange = (() => {
        try {
            const c = document.createElement('canvas');
            c.width = 128; c.height = Math.max(1, Math.round(128 * img.naturalHeight / img.naturalWidth));
            const x = c.getContext('2d', { willReadFrequently: true });
            x.drawImage(img, 0, 0, c.width, c.height);
            const d = x.getImageData(0, 0, c.width, c.height).data;
            const v = [];
            for (let i = 0; i < LM_COUNT; i++) {
                const px = Math.min(c.width - 1, Math.max(0, Math.round(mesh.uv[i * 2] * c.width)));
                const py = Math.min(c.height - 1, Math.max(0, Math.round(mesh.uv[i * 2 + 1] * c.height)));
                const o = (py * c.width + px) * 4;
                v.push((0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]) / 255);
            }
            v.sort((a, b) => a - b);
            const lo = v[Math.floor(v.length * 0.03)], hi = v[Math.floor(v.length * 0.97)];
            return hi - lo > 0.08 ? [Math.max(0, lo - 0.03), Math.min(1, hi + 0.04)] : [0.03, 0.82];
        } catch (e) { return [0.03, 0.82]; }
    })();

    const rig = new FaceRig(mesh);
    const lmData = new Float32Array(LM_TEX_W * LM_TEX_H * 4);
    const lmTex = new THREE.DataTexture(lmData, LM_TEX_W, LM_TEX_H, THREE.RGBAFormat, THREE.FloatType);
    lmTex.minFilter = lmTex.magFilter = THREE.NearestFilter;

    // Grupo propio, enganchado a la cámara: el rostro siempre mira al
    // espectador mientras la galaxia orbita delante.
    const group = new THREE.Group();
    group.name = 'avatar';
    group.layers.set(AVATAR_LAYER);
    if (!camera.parent) scene.add(camera);
    camera.add(group);

    const S = {
        reduced: !!(reducedMotion && reducedMotion.matches),
        stage,
        // parámetros ajustables (lil-gui)
        params: {
            densidad: 1,
            inestabilidad: 0.45,
            glitch: 1,
            disolucion: 0.55,
            bloom: 0.55,
            opacidad: 1,
            persistencia: 0.82
        },
        // estado animado
        anim: { blinkR: 0, blinkL: 0, gazeX: 0, gazeY: 0, jaw: 0, lip: 0, brow: 0, breath: 0, yaw: 0, pitch: 0, roll: 0 },
        time: 0,
        assemble: 0,
        assembleStart: -1,
        instab: 0,
        focus: 0,
        nextBlink: rand(1.5, 3),
        blinkT: -1, blinkDouble: false,
        nextSpeech: rand(4, 8), speechStart: 0, speechEnd: -1,
        nextBrow: rand(6, 12), browT: -1,
        nextGlitch: rand(4, 10), glitchEnd: -1, glitchSeed: 0, microGlitch: 0,
        gazeTarget: { x: 0, y: 0 }, nextGazeMove: 0,
        pointerStr: 0,
        level: 0,
        lowFpsTime: 0, fpsEMA: 60, grace: 4,
        pausedSim: false,
        width: 2, height: 2, pixelRatio: 1, portrait: false
    };
    const noiseA = makeNoise1D(11), noiseB = makeNoise1D(23), noiseC = makeNoise1D(37);
    const noiseD = makeNoise1D(51), noiseE = makeNoise1D(73);

    const levels = isMobile ? [256, 128] : [512, 256, 128];

    // ---------- GPGPU + Points (reconstruibles al bajar de nivel) ----------
    let sys = null;
    function buildSystem(size, onFace) {
        disposeSystem();
        const p = buildParticles(mesh, size, onFace);
        const mk = (arr) => {
            const t = new THREE.DataTexture(arr, size, size, THREE.RGBAFormat, THREE.FloatType);
            t.minFilter = t.magFilter = THREE.NearestFilter;
            t.needsUpdate = true;
            return t;
        };
        const refA = mk(p.refA), refB = mk(p.refB);

        const gpu = new GPUComputationRenderer(size, size, renderer);
        gpu.setDataType(simType);
        const tPos = gpu.createTexture(); tPos.image.data.set(p.pos0);
        const tVel = gpu.createTexture();
        const velVar = gpu.addVariable('textureVelocity', VELOCITY, tVel);
        const posVar = gpu.addVariable('texturePosition', POSITION, tPos);
        gpu.setVariableDependencies(velVar, [posVar, velVar]);
        gpu.setVariableDependencies(posVar, [posVar, velVar]);
        Object.assign(velVar.material.uniforms, {
            tLand: { value: lmTex }, tRefA: { value: refA }, tRefB: { value: refB },
            uTime: { value: 0 }, uDt: { value: 0.016 }, uAssemble: { value: 0 }, uInstab: { value: 0 },
            uDissolve: { value: 0 }, uCurl: { value: 1 }, uStatic: { value: 0 },
            uPointer: { value: new THREE.Vector3(9, 9, 9) }, uPointerStr: { value: 0 }
        });
        Object.assign(posVar.material.uniforms, { uDt: { value: 0.016 } });
        const err = gpu.init();
        if (err) { gpu.dispose(); refA.dispose(); refB.dispose(); throw new Error(err); }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(p.ref, 3));
        geo.setAttribute('aUv', new THREE.BufferAttribute(p.uv, 2));
        geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);
        const mat = new THREE.ShaderMaterial({
            vertexShader: POINTS_VS, fragmentShader: POINTS_FS,
            transparent: true, depthWrite: false, depthTest: false,
            blending: THREE.AdditiveBlending,
            uniforms: {
                tLand: { value: lmTex }, tRefA: { value: refA }, tRefB: { value: refB },
                tPos: { value: null }, tVel: { value: null }, tPhoto: { value: photo },
                uUseSim: { value: 0 }, uSizePx: { value: 1 }, uRefDepth: { value: 1 },
                uPointSize: { value: 0.0042 }, uAlpha: { value: 0.2 },
                uBlinkR: { value: 0 }, uBlinkL: { value: 0 }, uTime: { value: 0 }, uJitter: { value: 0 },
                uLumLo: { value: lumRange[0] }, uLumHi: { value: lumRange[1] }
            }
        });
        const points = new THREE.Points(geo, mat);
        points.frustumCulled = false;
        points.layers.set(AVATAR_LAYER);
        group.add(points);
        // densidad: menos partículas -> algo más grandes y luminosas
        const k = p.count / (512 * 512);
        sys = { size, count: p.count, gpu, velVar, posVar, refA, refB, geo, mat, points,
            sizeMul: Math.pow(k, -0.32), alphaMul: Math.pow(k, -0.42), steps: 0 };
        applyDensity();
    }
    function disposeSystem() {
        if (!sys) return;
        group.remove(sys.points);
        sys.geo.dispose(); sys.mat.dispose();
        sys.refA.dispose(); sys.refB.dispose();
        sys.gpu.dispose();
        sys = null;
    }
    function applyDensity() {
        if (sys) sys.geo.setDrawRange(0, Math.max(1, Math.floor(sys.count * clamp(S.params.densidad, 0.05, 1))));
    }

    // ---------- Post-procesado propio de la capa ----------
    const rtOpts = { depthBuffer: false, stencilBuffer: false, type: THREE.HalfFloatType };
    if (!renderer.extensions.has('EXT_color_buffer_float') && !renderer.extensions.has('EXT_color_buffer_half_float')) rtOpts.type = THREE.UnsignedByteType;
    const rtRaw = new THREE.WebGLRenderTarget(2, 2, rtOpts);
    let rtPA = new THREE.WebGLRenderTarget(2, 2, rtOpts);
    let rtPB = new THREE.WebGLRenderTarget(2, 2, rtOpts);
    const rtOut = new THREE.WebGLRenderTarget(2, 2, rtOpts);
    const fxScene = new THREE.Scene();
    const fxCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const fxQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    fxQuad.frustumCulled = false;
    fxScene.add(fxQuad);
    const persistMat = new THREE.ShaderMaterial({
        vertexShader: QUAD_VS, fragmentShader: PERSIST_FS, depthTest: false, depthWrite: false,
        uniforms: { tCur: { value: null }, tPrev: { value: null }, uDecay: { value: 0.82 } }
    });
    const lookMat = new THREE.ShaderMaterial({
        vertexShader: QUAD_VS, fragmentShader: LOOK_FS, depthTest: false, depthWrite: false,
        uniforms: {
            tSrc: { value: null }, uRes: { value: new THREE.Vector2(2, 2) }, uTime: { value: 0 },
            uChroma: { value: 0 }, uGlitch: { value: 0 }, uGlitchSeed: { value: 0 },
            uFlicker: { value: 1 }, uGrain: { value: 0 }, uScan: { value: 0 }, uOpacity: { value: 1 }
        }
    });
    // escala de resolución de la capa (el rostro es suave: no necesita 1:1 en móvil)
    const resScale = isMobile ? 0.7 : 1;

    function resize(width, height, pixelRatio, portrait) {
        S.width = width; S.height = height; S.pixelRatio = pixelRatio; S.portrait = portrait;
        const w = Math.max(2, Math.floor(width * pixelRatio * resScale));
        const h = Math.max(2, Math.floor(height * pixelRatio * resScale));
        for (const rt of [rtRaw, rtPA, rtPB, rtOut]) rt.setSize(w, h);
        lookMat.uniforms.uRes.value.set(w, h);
        clearPersist();
        layout();
    }
    function clearPersist() {
        const prev = renderer.getRenderTarget();
        for (const rt of [rtPA, rtPB, rtOut]) { renderer.setRenderTarget(rt); renderer.clear(); }
        renderer.setRenderTarget(prev);
    }

    // ---------- Encaje en pantalla ----------
    const DEPTH = 150;  // muy por detrás de la galaxia (radio ~35 alrededor del origen)
    let faceScale = 1;
    function layout() {
        const visH = 2 * DEPTH * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        const visW = visH * (S.width / Math.max(1, S.height));
        let fh, y = 0;
        if (S.portrait) {
            // en vertical: más pequeño y arriba, deja libre el grafo
            fh = Math.min(visH * 0.4, visW * 0.95 / 0.82);
            y = visH * 0.5 - fh * 0.62;
        } else {
            fh = Math.min(visH * 0.74, visW * 0.9 / 0.82);
            y = visH * 0.01;
        }
        faceScale = fh;
        group.position.set(0, y, -DEPTH);
        group.scale.setScalar(fh);
        if (sys) {
            // px de pantalla por unidad local a la profundidad del rostro
            const rtH = rtRaw.height;
            sys.mat.uniforms.uSizePx.value = rtH / visH * fh;
            sys.mat.uniforms.uRefDepth.value = DEPTH;
        }
    }

    // ---------- Animación procedural ----------
    const _v = new THREE.Vector3(), _o = new THREE.Vector3(), _d = new THREE.Vector3();
    const _ndc = new THREE.Vector3();
    const pointerLocal = new THREE.Vector3(9, 9, 9);

    function animate(dt, input) {
        const t = S.time;
        const a = S.anim;
        const deform = S.stage >= 2 && !S.reduced;

        // ---- inestabilidad: alterna momentos nítidos y degradados ----
        const slow = fbm(noiseA, t * 0.06) * 0.5 + 0.5;
        let inst = S.params.inestabilidad * (0.15 + 1.4 * smoothstep(0.42, 0.78, slow));
        inst += S.focus * 0.28;                   // nodo seleccionado: se degrada
        S.instab = S.reduced ? 0 : clamp(smooth(S.instab, inst, 2, dt), 0, 1.2);

        if (!deform) {
            for (const k in a) a[k] = 0;
            return;
        }
        if (S.freeze) { Object.assign(a, S.freeze); return; } // solo ?debug: pose fija

        // ---- parpadeo: cada 3-6 s, 150 ms, a veces doble ----
        let blink = 0;
        if (S.blinkT < 0 && t >= S.nextBlink) {
            S.blinkT = 0;
            S.blinkDouble = Math.random() < 0.2;
            S.microGlitch = 0.08;                  // micro-glitch de 80 ms
        }
        if (S.blinkT >= 0) {
            S.blinkT += dt;
            const dur = 0.15;
            const total = S.blinkDouble ? dur * 2 + 0.09 : dur;
            let u = S.blinkT;
            if (S.blinkDouble && u > dur) u = u - dur - 0.09;
            if (u >= 0 && u <= dur) blink = Math.pow(Math.sin(Math.PI * u / dur), 0.7);
            if (S.blinkT >= total) { S.blinkT = -1; S.nextBlink = t + rand(3, 6); }
        }
        a.blinkR = blink;
        a.blinkL = blink * 0.97;

        // ---- respiración ~4 s ----
        a.breath = Math.sin(t * Math.PI * 2 / 4.1);

        // ---- cabeza: ruido de baja frecuencia, ±12° Y, ±6° X ----
        const yawT = fbm(noiseB, t * 0.09) * THREE.MathUtils.degToRad(12) + a.gazeX * THREE.MathUtils.degToRad(2.5);
        const pitchT = fbm(noiseC, t * 0.08) * THREE.MathUtils.degToRad(6) - a.gazeY * THREE.MathUtils.degToRad(1.5);
        a.yaw = smooth(a.yaw, clamp(yawT, -0.2094, 0.2094), 1.6, dt);
        a.pitch = smooth(a.pitch, clamp(pitchT, -0.1047, 0.1047), 1.6, dt);
        a.roll = smooth(a.roll, fbm(noiseD, t * 0.07) * 0.035, 1.2, dt);

        // ---- mirada: cursor (escritorio) o puntos aleatorios (táctil) ----
        if (input.mouse.active && !isMobile && S.stage >= 2) {
            _v.set(0, 0, 0);
            group.localToWorld(_v).project(camera);
            const fx = (_v.x * 0.5 + 0.5) * S.width, fy = (-_v.y * 0.5 + 0.5) * S.height;
            S.gazeTarget.x = clamp((input.mouse.x - fx) / (S.width * 0.45), -1, 1);
            S.gazeTarget.y = clamp(-(input.mouse.y - fy) / (S.height * 0.45), -1, 1);
        } else if (t >= S.nextGazeMove) {
            S.nextGazeMove = t + rand(1.4, 4.2);
            S.gazeTarget.x = Math.random() < 0.35 ? 0 : rand(-0.8, 0.8);
            S.gazeTarget.y = rand(-0.4, 0.35);
        }
        // sacadas: rápidas pero suavizadas
        a.gazeX = smooth(a.gazeX, S.gazeTarget.x, 9, dt);
        a.gazeY = smooth(a.gazeY, S.gazeTarget.y, 9, dt);

        // ---- habla sutil: murmullo de 2-4 s ----
        let jawT = 0;
        if (S.speechEnd < 0 && t >= S.nextSpeech) { S.speechStart = t; S.speechEnd = t + rand(2, 4); }
        if (S.speechEnd > 0) {
            const left = S.speechEnd - t;
            const env = smoothstep(0, 0.35, left) * smoothstep(0, 0.35, t - S.speechStart);
            const syll = Math.max(0, Math.sin(t * 13.5 + noiseE(t * 2.1) * 3)) * (0.55 + 0.45 * noiseE(t * 5.3 + 9));
            jawT = env * Math.max(0, syll) * 0.85;
            if (left <= 0) { S.speechEnd = -1; S.nextSpeech = t + rand(5, 11); }
        }
        a.jaw = smooth(a.jaw, jawT, 14, dt);
        a.lip = smooth(a.lip, jawT * 0.6, 10, dt);

        // ---- microexpresión: cejas ----
        let browT = 0;
        if (S.browT < 0 && t >= S.nextBrow) S.browT = 0;
        if (S.browT >= 0) {
            S.browT += dt;
            const dur = 1.6;
            browT = Math.sin(Math.PI * clamp(S.browT / dur, 0, 1));
            if (S.browT >= dur) { S.browT = -1; S.nextBrow = t + rand(7, 16); }
        }
        a.brow = smooth(a.brow, browT, 5, dt);
    }

    function updatePointer(dt, input) {
        let target = 0;
        if (S.stage >= 5 && input.mouse.active && input.mouse.x >= 0 && !S.reduced) {
            _ndc.set((input.mouse.x / S.width) * 2 - 1, -(input.mouse.y / S.height) * 2 + 1, 0.5);
            camera.updateMatrixWorld();
            _o.setFromMatrixPosition(camera.matrixWorld);
            _d.copy(_ndc).unproject(camera).sub(_o).normalize();
            group.updateMatrixWorld();
            const o = group.worldToLocal(_o.clone());
            const p = group.worldToLocal(_o.clone().add(_d));
            const dir = p.sub(o);
            if (Math.abs(dir.z) > 1e-6) {
                const k = (0.05 - o.z) / dir.z;   // plano frontal del rostro
                pointerLocal.copy(o).addScaledVector(dir, k);
                target = 1;
            }
        }
        S.pointerStr = smooth(S.pointerStr, target, 6, dt);
    }

    // ---------- Gobernador de rendimiento ----------
    function govern(dt) {
        if (!sys || S.stage < 3) return;
        const fps = 1 / Math.max(dt, 1e-3);
        S.fpsEMA = S.fpsEMA * 0.9 + fps * 0.1;
        if (S.grace > 0) { S.grace -= dt; return; }
        if (S.fpsEMA < 45) S.lowFpsTime += dt; else S.lowFpsTime = Math.max(0, S.lowFpsTime - dt * 2);
        if (S.lowFpsTime >= 3 && S.level < levels.length - 1) {
            S.level++;
            const keep = S.assemble;
            buildSystem(levels[S.level], keep > 0.98 ? rig.out : null);
            layout();
            // al reconstruir, el rostro reaparece casi ensamblado
            S.assemble = keep;
            S.lowFpsTime = 0; S.grace = 4; S.fpsEMA = 60;
            if (debugApi) debugApi.refresh();
        }
    }

    // ---------- Frame ----------
    // input: { mouse, focus (0..1), booted, dtReal }
    function update(dt, input) {
        S.time += dt;
        S.focus = smooth(S.focus, clamp(input.focus || 0, 0, 1), 3, dt);
        if (S.assembleStart < 0 && input.booted) S.assembleStart = S.time;
        const entering = S.stage >= 5 && !S.reduced;
        if (!entering) S.assemble = 1;
        else if (S.assembleStart >= 0) S.assemble = clamp((S.time - S.assembleStart) / 4.0, 0, 1);

        animate(dt, input);
        const lm = rig.apply(S.anim);
        for (let i = 0; i < LM_COUNT; i++) {
            lmData[i * 4] = lm[i * 3]; lmData[i * 4 + 1] = lm[i * 3 + 1]; lmData[i * 4 + 2] = lm[i * 3 + 2];
        }
        lmTex.needsUpdate = true;
        updatePointer(dt, input);
        govern(input.dtReal || dt);

        // glitch de franjas cada 4-10 s, 100-300 ms
        const fxOn = S.stage >= 4 && !S.reduced;
        if (fxOn && S.params.glitch > 0 && S.time >= S.nextGlitch) {
            S.glitchEnd = S.time + rand(0.1, 0.3);
            S.glitchSeed = Math.random() * 100;
            S.nextGlitch = S.time + rand(4, 10);
        }
        S.microGlitch = Math.max(0, S.microGlitch - dt);
    }

    function simulate(dt) {
        const u = sys.velVar.material.uniforms;
        const p = S.params;
        u.uTime.value = S.time;
        u.uDt.value = Math.min(dt, 1 / 30);
        u.uAssemble.value = S.assemble;
        u.uInstab.value = S.instab;
        // disolución: crece con la inestabilidad y el foco en la galaxia
        u.uDissolve.value = S.reduced ? 0 : clamp(p.disolucion * (0.06 + 0.42 * S.instab) + S.focus * 0.06, 0, 0.9);
        u.uCurl.value = 1;
        u.uStatic.value = S.reduced ? 1 : 0;
        u.uPointer.value.copy(pointerLocal);
        u.uPointerStr.value = S.pointerStr;
        sys.posVar.material.uniforms.uDt.value = u.uDt.value;
        sys.gpu.compute();
        sys.steps++;
    }

    let flick = 1;
    function render(dt) {
        if (!sys) return null;
        const useSim = S.stage >= 3;
        if (useSim) simulate(dt);

        const mu = sys.mat.uniforms;
        const glitchActive = S.time < S.glitchEnd;
        const fxOn = S.stage >= 4 && !S.reduced;
        mu.uUseSim.value = useSim ? 1 : 0;
        if (useSim) {
            mu.tPos.value = sys.gpu.getCurrentRenderTarget(sys.posVar).texture;
            mu.tVel.value = sys.gpu.getCurrentRenderTarget(sys.velVar).texture;
        }
        mu.uTime.value = S.time;
        mu.uBlinkR.value = S.anim.blinkR;
        mu.uBlinkL.value = S.anim.blinkL;
        mu.uPointSize.value = 0.0042 * sys.sizeMul;
        // entrada: el brillo acompaña a la convergencia
        const enter = S.stage >= 5 && !S.reduced ? 0.35 + 0.65 * smoothstep(0, 0.8, S.assemble) : 1;
        mu.uAlpha.value = 0.1 * sys.alphaMul * enter * (1 - S.focus * 0.3);
        mu.uJitter.value = fxOn ? (glitchActive ? 1 : 0) * S.params.glitch + (S.microGlitch > 0 ? 0.6 : 0) + S.instab * 0.04 : 0;

        // 1) partículas -> rtRaw
        const prevTarget = renderer.getRenderTarget();
        const prevMask = camera.layers.mask;
        camera.layers.set(AVATAR_LAYER);
        renderer.setRenderTarget(rtRaw);
        renderer.clear();
        renderer.render(scene, camera);
        camera.layers.mask = prevMask;

        // 2) persistencia de fósforo (ping-pong)
        let src = rtRaw;
        if (fxOn && S.params.persistencia > 0) {
            fxQuad.material = persistMat;
            persistMat.uniforms.tCur.value = rtRaw.texture;
            persistMat.uniforms.tPrev.value = rtPA.texture;
            persistMat.uniforms.uDecay.value = Math.pow(clamp(S.params.persistencia, 0, 0.97), dt * 60);
            renderer.setRenderTarget(rtPB);
            renderer.render(fxScene, fxCam);
            const tmp = rtPA; rtPA = rtPB; rtPB = tmp;
            src = rtPA;
        }

        // 3) look: aberración, glitch, flicker, scanlines, grano
        const lu = lookMat.uniforms;
        lu.tSrc.value = src.texture;
        lu.uTime.value = S.time;
        if (fxOn) {
            flick = smooth(flick, 0.86 + 0.14 * (fbm(noiseE, S.time * 0.9) * 0.5 + 0.5) - S.instab * 0.08, 6, dt);
            lu.uChroma.value = 0.0012 + 0.009 * S.instab + (S.microGlitch > 0 ? 0.006 : 0);
            lu.uGlitch.value = (glitchActive ? 1 : 0) * S.params.glitch + (S.microGlitch > 0 ? 0.35 : 0);
            lu.uGlitchSeed.value = S.glitchSeed + Math.floor(S.time * 30) * 0.37;
            lu.uFlicker.value = flick;
            lu.uGrain.value = 0.16 + 0.25 * S.instab;
            lu.uScan.value = 0.2;
        } else {
            lu.uChroma.value = 0; lu.uGlitch.value = 0; lu.uFlicker.value = 1;
            lu.uGrain.value = 0; lu.uScan.value = 0;
        }
        lu.uOpacity.value = S.params.opacidad * (1 - S.focus * 0.45);
        fxQuad.material = lookMat;
        renderer.setRenderTarget(rtOut);
        renderer.render(fxScene, fxCam);
        renderer.setRenderTarget(prevTarget);
        return rtOut.texture;
    }

    // ---------- Panel de ajustes (?debug) ----------
    let debugApi = null;
    if (debug) {
        try {
            const { default: GUI } = await import('../vendor/lil-gui.esm.min.js');
            const gui = new GUI({ title: 'Avatar' });
            const P = S.params;
            gui.add(P, 'densidad', 0.05, 1, 0.01).onChange(applyDensity);
            gui.add(P, 'inestabilidad', 0, 1, 0.01);
            gui.add(P, 'glitch', 0, 1, 0.01);
            gui.add(P, 'disolucion', 0, 1, 0.01).name('disolución');
            gui.add(P, 'bloom', 0, 2, 0.01);
            gui.add(P, 'opacidad', 0, 1, 0.01);
            gui.add(P, 'persistencia', 0, 0.95, 0.01);
            const info = { fps: '', particulas: '', fase: String(S.stage) };
            gui.add(info, 'fps').disable().listen();
            gui.add(info, 'particulas').name('partículas').disable().listen();
            gui.add(info, 'fase').disable();
            setInterval(() => {
                info.fps = S.fpsEMA.toFixed(0);
                info.particulas = sys ? `${sys.size}² = ${sys.count}` : '-';
            }, 500);
            debugApi = { gui, refresh() {} };
        } catch (e) { /* el panel es opcional */ }
    }

    const withEntrance = stage >= 5 && !S.reduced;
    buildSystem(levels[0], withEntrance ? null : rig.rest);
    S.level = 0;

    const api = {
        group,
        state: S,
        get params() { return S.params; },
        get bloom() { return S.params.bloom * (1 - S.focus * 0.4); },
        get ready() { return !!sys; },
        get _sys() { return debug ? sys : null; },
        _renderer: debug ? renderer : null,
        resize, update, render,
        setReducedMotion(v) { S.reduced = v; },
        // solo para depurar: congela una pose ({ blinkR, jaw, gazeX, ... }) o null
        freeze(pose) { S.freeze = pose ? Object.assign({}, S.anim, pose) : null; },
        dispose() {
            disposeSystem();
            camera.remove(group);
            for (const rt of [rtRaw, rtPA, rtPB, rtOut]) rt.dispose();
            persistMat.dispose(); lookMat.dispose(); photo.dispose(); lmTex.dispose();
            if (debugApi) debugApi.gui.destroy();
        }
    };
    return api;
}
