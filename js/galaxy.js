/* ============================================================
 * GALAXIA DE CONOCIMIENTO — Alba Studio
 * Grafo 3D force-directed de conocimiento técnico.
 * Three.js (vendorizado) + Canvas 2D overlay para etiquetas/HUD.
 * Sin build step: módulo ES servido tal cual por GitHub Pages.
 * ============================================================ */

import * as THREE from './vendor/three.module.min.js';

(function () {
    'use strict';

    // ============================================
    // POOL DE CONOCIMIENTO
    // ============================================
    const DOMAIN_NAMES = [
        'Informática', 'Inteligencia Artificial', 'Ciberseguridad', 'Robótica',
        'Electrónica', 'Eléctrica', 'Mecánica', 'Física', 'Matemáticas',
        'Diseño & Multimedia', 'Trading'
    ];
    const D = {};
    DOMAIN_NAMES.forEach((n, i) => { D[n] = i; });

    const SATELLITES = {
        'Informática': ['Algoritmos', 'Linux', 'Recursión', 'Compiladores', 'Concurrencia', 'Redes', 'Protocolos', 'Kernel', 'Virtualización', 'Abstracción', 'Lógica Booleana', 'Datos', 'Paradigmas', 'POO', 'Optimización', 'Complejidad', 'Sintaxis', 'Depuración', 'Automatización'],
        'Ciberseguridad': ['Criptografía', 'Encriptación', 'Hacking Ético', 'Exploits', 'Firewalls', 'Malware', 'Pentesting', 'OSINT', 'Autenticación', 'Hashing', 'Vulnerabilidades', 'Forense', 'Phishing', 'Zero-Day'],
        'Inteligencia Artificial': ['Redes Neuronales', 'Deep Learning', 'Backpropagation', 'Embeddings', 'Transformers', 'Gradientes', 'Entrenamiento', 'Inferencia', 'Clasificación', 'Regresión', 'Clustering', 'Visión Artificial', 'NLP', 'Agentes', 'Heurísticas', 'Overfitting', 'Tokens', 'Atención', 'Refuerzo', 'Generativa'],
        'Robótica': ['Cinemática', 'Servocontrol', 'Trayectorias', 'Odometría', 'PID', 'Percepción', 'Navegación', 'Manipulación', 'Locomoción', 'SLAM', 'Telemetría', 'Mecatrónica', 'Autonomía', 'DOF'],
        'Electrónica': ['Semiconductores', 'Amplificación', 'Modulación', 'Filtrado', 'Conmutación', 'Rectificación', 'Oscilación', 'Retroalimentación', 'Impedancia', 'Lógica Digital', 'Microcontrol', 'Embebidos', 'Analógica', 'Frecuencia', 'Ruido', 'Acoplamiento', 'Polarización'],
        'Eléctrica': ['Voltaje', 'Corriente', 'Inducción', 'Trifásica', 'Reactancia', 'Potencia', 'Resonancia', 'Aislación', 'Distribución', 'Protecciones', 'Tierra', 'Eficiencia', 'Cargas'],
        'Mecánica': ['Cinemática', 'Dinámica', 'Estática', 'Torque', 'Fricción', 'Termodinámica', 'Hidráulica', 'Neumática', 'Elasticidad', 'Fatiga', 'Resistencia', 'Tolerancias', 'Vibración', 'Inercia', 'Transmisión', 'Tribología', 'Presión'],
        'Física': ['Electromagnetismo', 'Ondas', 'Óptica', 'Entropía', 'Energía', 'Campos', 'Cuántica', 'Relatividad', 'Resonancia', 'Interferencia', 'Difracción', 'Momentum', 'Gravedad', 'Plasma', 'Espectro', 'Fotones'],
        'Matemáticas': ['Cálculo', 'Álgebra Lineal', 'Vectores', 'Matrices', 'Fourier', 'Probabilidad', 'Estadística', 'Fractales', 'Derivadas', 'Integrales', 'Topología', 'Geometría', 'Trigonometría', 'Series', 'Límites', 'Logaritmos', 'Primos', 'Caos', 'Infinito'],
        'Diseño & Multimedia': ['Composición', 'Tipografía', 'Cromática', 'Contraste', 'Jerarquía', 'UX', 'Retícula', 'Minimalismo', 'Vectorial', 'Render', 'Iluminación', 'Perspectiva', 'Animación', 'Interpolación', 'Shaders', 'Encuadre', 'Ritmo', 'Semiótica'],
        'Trading': ['Volatilidad', 'Liquidez', 'Tendencias', 'Soportes', 'Resistencias', 'Momentum', 'Divergencias', 'Fibonacci', 'Backtesting', 'Order Flow', 'Spread', 'Apalancamiento', 'Correlación', 'Riesgo', 'Psicotrading', 'Velas', 'Ciclos']
    };

    // Puentes explícitos: conceptos que cosen varios dominios en una sola mente.
    const BRIDGES = [
        ['Electromecánica', ['Eléctrica', 'Mecánica']],
        ['Mecatrónica', ['Robótica', 'Mecánica', 'Electrónica']],
        ['Fourier', ['Matemáticas', 'Física', 'Diseño & Multimedia']],
        ['DSP', ['Electrónica', 'Matemáticas', 'Diseño & Multimedia']],
        ['Probabilidad', ['Matemáticas', 'Trading', 'Inteligencia Artificial']],
        ['PID', ['Robótica', 'Eléctrica', 'Matemáticas']],
        ['Resonancia', ['Física', 'Eléctrica', 'Mecánica']],
        ['Shaders', ['Diseño & Multimedia', 'Informática', 'Matemáticas']],
        ['Termodinámica', ['Física', 'Mecánica']],
        ['Criptografía', ['Ciberseguridad', 'Matemáticas']],
        ['Hacking Ético', ['Ciberseguridad', 'Informática']],
        ['Redes', ['Ciberseguridad', 'Informática']],
        ['Impedancia', ['Electrónica', 'Eléctrica']],
        ['Conmutación', ['Electrónica', 'Eléctrica']],
        ['Diagnóstico', ['Electrónica', 'Eléctrica', 'Mecánica']],
        ['Calibración', ['Electrónica', 'Eléctrica', 'Mecánica']],
        ['Mantenimiento', ['Electrónica', 'Eléctrica', 'Mecánica']]
    ];

    // Un mismo concepto en varios dominios = UN nodo con varios soles.
    const POOL = new Map(); // label -> Set(domainIdx)
    for (const dom in SATELLITES) {
        for (const label of SATELLITES[dom]) {
            if (!POOL.has(label)) POOL.set(label, new Set());
            POOL.get(label).add(D[dom]);
        }
    }
    for (const [label, doms] of BRIDGES) {
        if (!POOL.has(label)) POOL.set(label, new Set());
        for (const dom of doms) POOL.get(label).add(D[dom]);
    }
    const POOL_LABELS = [...POOL.keys()];

    // ============================================
    // PRESUPUESTO DE RENDIMIENTO
    // ============================================
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ||
        (window.matchMedia && window.matchMedia('(pointer:coarse)').matches);
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 4;

    let nodeCap;
    if (!isMobile) nodeCap = Math.floor(POOL_LABELS.length * 0.92);
    else if (mem <= 2 || cores <= 4) nodeCap = 85;
    else nodeCap = 120;

    const MAXN = POOL_LABELS.length + DOMAIN_NAMES.length + 8;
    const MAXE = MAXN * 3;

    let maxLabels = isMobile ? 26 : 44;
    let sweepEnabled = true;

    // ============================================
    // ESCENA
    // ============================================
    const glCanvas = document.getElementById('webgl-canvas');
    const overlayCanvas = document.getElementById('overlay-canvas');
    const ctx = overlayCanvas.getContext('2d');

    const renderer = new THREE.WebGLRenderer({
        canvas: glCanvas, antialias: !isMobile, alpha: true, powerPreference: 'high-performance'
    });
    renderer.setClearColor(0x000000, 0); // alpha 0: deja ver la futura capa de foto (#photo-layer)
    let pixelRatio = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2);
    renderer.setPixelRatio(pixelRatio);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);

    let width = 0, height = 0, aspect = 1, portrait = false;

    // ============================================
    // ESTADO GLOBAL
    // ============================================
    let time = 0;
    const bootT = { sweepStart: 0.35, sweepEnd: 1.55, pulseAt: 2.15, done: 2.6 };
    let booted = false;

    const nodes = [];            // vivos
    const edges = [];
    const nodeByLabel = new Map();
    const labelCooldown = new Map(); // label -> tiempo en que murió
    let sunCount = 0;

    const pulses = [];           // ondas viajando por aristas
    let hoverNode = null;
    let hoverBeat = 0;
    let focusAmt = 0;            // 0..1 modo Obsidian (atenuar el resto)
    let nextThought = 4.5;
    let thoughtLabel = '—';
    let nextSweep = 24;          // barrido de mantenimiento
    let sweepX = -1;             // posición 0..1 del barrido (pantalla), -1 = inactivo
    let sweepAlpha = 0;
    let nextSpawn = 0;
    let growthT = 0;             // tiempo desde fin de boot
    let nextRecycle = 0;

    const mouse = { x: -1, y: -1, nx: 0, ny: 0, active: false };
    const gyro = { x: 0, y: 0, ok: false };
    const par = { x: 0, y: 0 }; // parallax suavizado

    // Anclas de soles (esfera fibonacci, escalada según orientación)
    const anchorScale = new THREE.Vector3(1, 1, 1);
    const anchorTarget = new THREE.Vector3(1, 1, 1);
    const R = 26;

    function sunAnchor(i, out) {
        const n = DOMAIN_NAMES.length;
        const y = 1 - 2 * (i + 0.5) / n;
        const r = Math.sqrt(Math.max(0, 1 - y * y));
        const th = i * 2.39996323;
        out.set(Math.cos(th) * r * R * anchorScale.x,
                y * R * anchorScale.y,
                Math.sin(th) * r * R * 0.75 * anchorScale.z);
        return out;
    }

    // ============================================
    // NODOS Y ARISTAS
    // ============================================
    let nextId = 0;

    function makeNode(label, domains, isSun, pos) {
        return {
            id: nextId++, label, domains, isSun,
            pos: pos.clone(), vel: new THREE.Vector3(),
            anchor: isSun ? pos.clone() : null,
            anchorIdx: -1,
            size: isSun ? 1.7 : 1.0, sizeT: isSun ? 1.7 : 1.0,
            seed: Math.random(),
            birth: 0, bornVisible: false, dying: false,
            bornAt: time,
            glow: 0, dim: 1, dimT: 1,
            edges: [],
            pendingEdges: []   // aristas secundarias que se trazan tras materializarse
        };
    }

    function addNode(node) {
        nodes.push(node);
        nodeByLabel.set(node.label, node);
        if (node.isSun) sunCount++;
        return node;
    }

    function connect(a, b, drawSpeed) {
        if (a === b || edges.length >= MAXE) return null;
        for (const e of a.edges) if (e.a === b || e.b === b) return null;
        const e = {
            a, b,
            rest: (a.isSun || b.isSun) ? 6.5 : 7.5,
            progress: 0, drawSpeed: drawSpeed || 1.6,
            glow: 0, dim: 1, dimT: 1,
            pulsePos: -1, pulseStr: 0
        };
        edges.push(e);
        a.edges.push(e); b.edges.push(e);
        return e;
    }

    function neighbors(n) {
        return n.edges.map(e => (e.a === n ? e.b : e.a));
    }

    function degree(n) { return n.edges.length; }

    // ============================================
    // GRAFO INICIAL (lo que materializa el boot)
    // ============================================
    const usedAtBoot = new Set();

    function seedGalaxy() {
        const v = new THREE.Vector3();
        // Soles
        for (let i = 0; i < DOMAIN_NAMES.length; i++) {
            sunAnchor(i, v);
            const n = makeNode(DOMAIN_NAMES[i], new Set([i]), true, v);
            n.anchorIdx = i;
            addNode(n);
        }
        // Base mínima: un puñado de satélites (1 en ~7 dominios) + 1 puente,
        // para que el crecimiento posterior se aprecie de verdad
        const domOrder = shuffle([...Array(DOMAIN_NAMES.length).keys()]);
        for (const i of domOrder.slice(0, 7)) {
            const cand = POOL_LABELS.filter(l => POOL.get(l).has(i) && !usedAtBoot.has(l) && POOL.get(l).size === 1);
            if (cand.length) spawnLabel(cand[(Math.random() * cand.length) | 0], true);
        }
        const bridgeCand = POOL_LABELS.filter(l => POOL.get(l).size >= 2 && !usedAtBoot.has(l));
        shuffle(bridgeCand);
        if (bridgeCand.length) spawnLabel(bridgeCand[0], true);
    }

    function shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = (Math.random() * (i + 1)) | 0;
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    // ============================================
    // NACIMIENTO DE NODOS (crecimiento orgánico)
    // ============================================
    function pickParent(domains) {
        // Nodo existente afín: comparte dominio. Prefiere satélites (60%) para
        // que el crecimiento se vea encadenado, no radial desde los soles.
        const shared = nodes.filter(n => !n.dying && n.birth > 0.6 &&
            [...n.domains].some(d => domains.has(d)));
        if (!shared.length) return null;
        const sats = shared.filter(n => !n.isSun);
        const from = (sats.length && Math.random() < 0.6) ? sats : shared;
        return from[(Math.random() * from.length) | 0];
    }

    function spawnLabel(label, atBoot) {
        if (nodeByLabel.has(label)) return null;
        const domains = POOL.get(label);
        if (!domains) return null;
        const parent = pickParent(domains) ||
            nodes.find(n => n.isSun && domains.has([...n.domains][0]));
        if (!parent) return null;

        usedAtBoot.add(label);
        const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
        // sesgo hacia fuera del centro para que la galaxia se expanda
        dir.normalize().multiplyScalar(4.5).add(
            parent.pos.clone().normalize().multiplyScalar(2.2));
        const pos = parent.pos.clone().add(dir);
        const n = addNode(makeNode(label, domains, false, pos));
        if (!atBoot) n.bornVisible = true; // en boot los materializa el barrido

        // Arista principal: se traza desde el padre en tiempo real
        const main = connect(parent, n, atBoot ? 1.6 : 2.2);
        if (main) main.primary = true;
        if (!atBoot) parent.glow = Math.max(parent.glow, 0.9); // pulso del padre al "pensar" el hijo

        // Aristas secundarias: sus soles (multi-dominio = todos) + un afín
        for (const d of domains) {
            const sun = nodeByLabel.get(DOMAIN_NAMES[d]);
            if (sun && sun !== parent && (domains.size > 1 || Math.random() < 0.85)) {
                n.pendingEdges.push(sun);
            }
        }
        if (Math.random() < 0.35) {
            const kin = nodes.filter(o => o !== n && o !== parent && !o.isSun && !o.dying &&
                o.birth > 0.6 && [...o.domains].some(d => domains.has(d)));
            if (kin.length) n.pendingEdges.push(kin[(Math.random() * kin.length) | 0]);
        }
        return n;
    }

    function spawnFromPool() {
        const cand = POOL_LABELS.filter(l => !nodeByLabel.has(l) &&
            (!labelCooldown.has(l) || time - labelCooldown.get(l) > 25));
        if (!cand.length) return null;
        return spawnLabel(cand[(Math.random() * cand.length) | 0], false);
    }

    // ============================================
    // RECICLAJE PERPETUO — olvidar lo irrelevante
    // ============================================
    function recycleOne() {
        // Periferia: satélite no protegido, pocas conexiones, lejos del centro,
        // con edad mínima. Los puentes multi-sol quedan a salvo (cosen la galaxia).
        const cand = nodes.filter(n => !n.isSun && !n.dying && n.birth >= 1 &&
            time - n.bornAt > 20 &&
            [...n.domains].length < 2 &&
            degree(n) <= 3 && n !== hoverNode);
        if (!cand.length) return;
        cand.sort((a, b) =>
            (degree(a) - degree(b)) || (b.pos.length() - a.pos.length()));
        const victim = cand[(Math.random() * Math.min(4, cand.length)) | 0];
        victim.dying = true;
    }

    function removeNode(n) {
        for (const e of n.edges) {
            const other = e.a === n ? e.b : e.a;
            other.edges.splice(other.edges.indexOf(e), 1);
            edges.splice(edges.indexOf(e), 1);
        }
        n.edges.length = 0;
        nodes.splice(nodes.indexOf(n), 1);
        nodeByLabel.delete(n.label);
        labelCooldown.set(n.label, time);
        if (hoverNode === n) hoverNode = null;
    }

    // ============================================
    // PROMOCIÓN A SOL — evento raro y notorio
    // Máximo 12 soles simultáneos; los 11 dominios originales (anchorIdx >= 0)
    // están siempre protegidos. Un sol promovido puede degradarse si el
    // reciclaje le quita conexiones.
    // ============================================
    const MAX_SUNS = 12;

    function maybePromote(n) {
        if (n.isSun || n.dying || degree(n) < 10 || sunCount >= MAX_SUNS) return;
        n.isSun = true;
        n.sizeT = 1.7;                       // crece animado hasta ~x1.7 (sutil)
        n.anchor = n.pos.clone();            // se estabiliza donde está
        sunCount++;
        // ascensión notoria: destello y onda hacia sus vecinos
        n.glow = 1.25;
        emitFrom(n, 1, 1.0, 4);
        thoughtLabel = n.label;
    }

    let nextDemoteCheck = 0;
    function checkDemotions() {
        if (time < nextDemoteCheck) return;
        nextDemoteCheck = time + 6;
        for (const n of nodes) {
            if (n.isSun && n.anchorIdx < 0 && !n.dying && degree(n) < 6) {
                n.isSun = false;
                n.sizeT = 1.0;
                n.anchor = null;
                sunCount--;
            }
        }
    }

    // ============================================
    // SISTEMA DE PULSOS — un mecanismo, dos gatillos
    // ============================================
    function firePulse(fromNode, edge, hops, str) {
        if (edge.progress < 0.95) return;
        pulses.push({
            edge, from: fromNode, to: (edge.a === fromNode ? edge.b : edge.a),
            t0: time, dur: 0.5 + edge.rest * 0.012, hops, str
        });
    }

    function emitFrom(node, hops, str, maxFan) {
        const es = node.edges.filter(e => e.progress > 0.95);
        shuffle(es);
        let fan = 0;
        for (const e of es) {
            if (fan >= (maxFan || 3)) break;
            firePulse(node, e, hops, str);
            fan++;
        }
        node.glow = Math.max(node.glow, str);
    }

    function updatePulses(dt) {
        for (const e of edges) { e.pulsePos = -1; e.pulseStr = 0; }
        for (let i = pulses.length - 1; i >= 0; i--) {
            const p = pulses[i];
            const u = (time - p.t0) / p.dur;
            if (u >= 1) {
                p.to.glow = Math.min(1.25, p.to.glow + p.str);
                if (p.hops > 0) {
                    const es = p.to.edges.filter(e => e !== p.edge && e.progress > 0.95);
                    shuffle(es);
                    for (let k = 0; k < Math.min(2, es.length); k++) {
                        firePulse(p.to, es[k], p.hops - 1, p.str * 0.72);
                    }
                }
                pulses.splice(i, 1);
            } else {
                const pos = (p.edge.a === p.from) ? u : 1 - u;
                p.edge.pulsePos = pos;
                p.edge.pulseStr = Math.max(p.edge.pulseStr, p.str);
                p.edge.glow = Math.max(p.edge.glow, p.str * 0.55);
            }
        }
    }

    // ============================================
    // FÍSICA FORCE-DIRECTED
    // ============================================
    const _f = new THREE.Vector3();
    const _d = new THREE.Vector3();

    function physics(dt) {
        const n = nodes.length;
        // Repulsión suave (O(n²), n <= ~220: barato)
        for (let i = 0; i < n; i++) {
            const a = nodes[i];
            for (let j = i + 1; j < n; j++) {
                const b = nodes[j];
                _d.subVectors(a.pos, b.pos);
                const d2 = Math.max(_d.lengthSq(), 0.5);
                if (d2 > 220) continue;
                const f = 42 / d2;
                _d.multiplyScalar(f / Math.sqrt(d2));
                a.vel.addScaledVector(_d, dt);
                b.vel.addScaledVector(_d, -dt);
            }
        }
        // Muelles de aristas
        for (const e of edges) {
            _d.subVectors(e.b.pos, e.a.pos);
            const len = Math.max(_d.length(), 0.01);
            const f = (len - e.rest) * 1.1;
            _d.multiplyScalar(f / len);
            e.a.vel.addScaledVector(_d, dt);
            e.b.vel.addScaledVector(_d, -dt);
        }
        for (const nd of nodes) {
            // Soles anclados a su posición de cluster
            if (nd.isSun) {
                if (nd.anchorIdx >= 0) sunAnchor(nd.anchorIdx, _f);
                else _f.copy(nd.anchor);
                _d.subVectors(_f, nd.pos);
                nd.vel.addScaledVector(_d, dt * 2.2);
            } else {
                // gravedad débil al centro
                nd.vel.addScaledVector(nd.pos, -dt * 0.06);
            }
            // deriva orgánica: la galaxia respira
            const s = nd.seed * 6.283;
            nd.vel.x += Math.sin(time * 0.31 + s) * dt * 0.35;
            nd.vel.y += Math.cos(time * 0.24 + s * 1.7) * dt * 0.3;
            nd.vel.z += Math.sin(time * 0.27 + s * 0.6) * dt * 0.35;

            nd.vel.multiplyScalar(Math.exp(-dt * 2.4));
            nd.pos.addScaledVector(nd.vel, dt);
        }
    }

    // ============================================
    // GEOMETRÍA GPU
    // ============================================
    const nodeGeo = new THREE.BufferGeometry();
    const nPos = new Float32Array(MAXN * 3);
    const nSize = new Float32Array(MAXN);
    const nSeed = new Float32Array(MAXN);
    const nGlow = new Float32Array(MAXN);
    const nDim = new Float32Array(MAXN);
    const nBirth = new Float32Array(MAXN);
    const nSun = new Float32Array(MAXN);
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(nPos, 3).setUsage(THREE.DynamicDrawUsage));
    nodeGeo.setAttribute('aSize', new THREE.BufferAttribute(nSize, 1).setUsage(THREE.DynamicDrawUsage));
    nodeGeo.setAttribute('aSeed', new THREE.BufferAttribute(nSeed, 1).setUsage(THREE.DynamicDrawUsage));
    nodeGeo.setAttribute('aGlow', new THREE.BufferAttribute(nGlow, 1).setUsage(THREE.DynamicDrawUsage));
    nodeGeo.setAttribute('aDim', new THREE.BufferAttribute(nDim, 1).setUsage(THREE.DynamicDrawUsage));
    nodeGeo.setAttribute('aBirth', new THREE.BufferAttribute(nBirth, 1).setUsage(THREE.DynamicDrawUsage));
    nodeGeo.setAttribute('aSun', new THREE.BufferAttribute(nSun, 1).setUsage(THREE.DynamicDrawUsage));

    const nodeMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: {
            uTime: { value: 0 }, uPix: { value: 1 },
            uFogNear: { value: 30 }, uFogFar: { value: 120 }
        },
        vertexShader: `
            attribute float aSize;
            attribute float aSeed;
            attribute float aGlow;
            attribute float aDim;
            attribute float aBirth;
            attribute float aSun;
            uniform float uTime;
            uniform float uPix;
            uniform float uFogNear;
            uniform float uFogFar;
            varying float vGlow;
            varying float vDim;
            varying float vBirth;
            varying float vSun;
            varying float vSeed;
            varying float vFog;
            void main() {
                vec3 p = position;
                float g = 1.0 - aBirth;
                if (g > 0.002) {
                    // glitch de digitalización mientras se materializa / desvanece
                    float n1 = fract(sin(dot(p.xy, vec2(12.9898, 78.233)) + floor(uTime * 30.0)) * 43758.5453);
                    p += (vec3(n1, fract(n1 * 7.31), fract(n1 * 3.17)) - 0.5) * g * 1.6;
                }
                vec4 mv = modelViewMatrix * vec4(p, 1.0);
                float dist = max(-mv.z, 1.0);
                float breathe = 1.0 + 0.06 * sin(uTime * 1.4 + aSeed * 6.283);
                // niebla de profundidad: gradiente continuo cerca -> lejos
                vFog = clamp((uFogFar - dist) / max(uFogFar - uFogNear, 1.0), 0.0, 1.0);
                gl_PointSize = aSize * breathe * uPix * (500.0 / dist) * (0.6 + 0.4 * aBirth) * (0.75 + 0.45 * vFog);
                gl_Position = projectionMatrix * mv;
                vGlow = aGlow; vDim = aDim; vBirth = aBirth; vSun = aSun; vSeed = aSeed;
            }`,
        fragmentShader: `
            precision highp float;
            uniform float uTime;
            varying float vGlow;
            varying float vDim;
            varying float vBirth;
            varying float vSun;
            varying float vSeed;
            varying float vFog;
            void main() {
                vec2 c = gl_PointCoord - 0.5;
                float d = length(c);
                if (d > 0.5) discard;
                float core = 1.0 - smoothstep(0.0, 0.17, d);
                float halo = 1.0 - smoothstep(0.05, 0.5, d);
                vec3 cyan  = vec3(0.05, 0.62, 1.0);   // #00aaff holográfico
                vec3 green = vec3(0.0, 1.0, 0.533);   // #00ff88
                vec3 base = mix(cyan, green, vSun * 0.8);
                float flick = 1.0;
                if (vBirth < 1.0) {
                    flick = 0.35 + 0.65 * step(0.3, fract(sin(floor(uTime * 24.0) + vSeed * 99.0) * 437.585));
                }
                float energy = 1.0 + vSun * 0.5 + vGlow * 1.5;
                vec3 col = base * (core * 2.6 + halo * 1.05) * energy;
                col += vec3(1.0) * core * vGlow * 0.7;
                // lo cercano brilla; lo lejano se hunde en la niebla
                float fogFade = 0.14 + 0.86 * vFog;
                col *= 0.5 + 0.5 * vFog;
                float alpha = (core + halo * 0.65) * vDim * vBirth * flick * fogFade;
                gl_FragColor = vec4(col * flick, alpha);
            }`
    });
    const nodePoints = new THREE.Points(nodeGeo, nodeMat);
    nodePoints.frustumCulled = false;
    scene.add(nodePoints);

    const edgeGeo = new THREE.BufferGeometry();
    const ePos = new Float32Array(MAXE * 6);
    const eT = new Float32Array(MAXE * 2);
    const eProg = new Float32Array(MAXE * 2);
    const eGlow = new Float32Array(MAXE * 2);
    const eDim = new Float32Array(MAXE * 2);
    const ePulse = new Float32Array(MAXE * 2);
    const ePStr = new Float32Array(MAXE * 2);
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3).setUsage(THREE.DynamicDrawUsage));
    edgeGeo.setAttribute('aT', new THREE.BufferAttribute(eT, 1).setUsage(THREE.DynamicDrawUsage));
    edgeGeo.setAttribute('aProg', new THREE.BufferAttribute(eProg, 1).setUsage(THREE.DynamicDrawUsage));
    edgeGeo.setAttribute('aGlow', new THREE.BufferAttribute(eGlow, 1).setUsage(THREE.DynamicDrawUsage));
    edgeGeo.setAttribute('aDim', new THREE.BufferAttribute(eDim, 1).setUsage(THREE.DynamicDrawUsage));
    edgeGeo.setAttribute('aPulse', new THREE.BufferAttribute(ePulse, 1).setUsage(THREE.DynamicDrawUsage));
    edgeGeo.setAttribute('aPStr', new THREE.BufferAttribute(ePStr, 1).setUsage(THREE.DynamicDrawUsage));

    const edgeMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: {
            uTime: { value: 0 },
            uFogNear: { value: 30 }, uFogFar: { value: 120 }
        },
        vertexShader: `
            attribute float aT;
            attribute float aProg;
            attribute float aGlow;
            attribute float aDim;
            attribute float aPulse;
            attribute float aPStr;
            uniform float uFogNear;
            uniform float uFogFar;
            varying float vT;
            varying float vProg;
            varying float vGlow;
            varying float vDim;
            varying float vPulse;
            varying float vPStr;
            varying float vFog;
            void main() {
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                float dist = max(-mv.z, 1.0);
                vFog = clamp((uFogFar - dist) / max(uFogFar - uFogNear, 1.0), 0.0, 1.0);
                gl_Position = projectionMatrix * mv;
                vT = aT; vProg = aProg; vGlow = aGlow; vDim = aDim; vPulse = aPulse; vPStr = aPStr;
            }`,
        fragmentShader: `
            precision highp float;
            varying float vT;
            varying float vProg;
            varying float vGlow;
            varying float vDim;
            varying float vPulse;
            varying float vPStr;
            varying float vFog;
            void main() {
                if (vT > vProg) discard;  // trazado progresivo
                float pulse = 0.0;
                if (vPulse >= 0.0) {
                    pulse = exp(-pow((vT - vPulse) * 9.0, 2.0)) * vPStr;
                }
                // punta brillante mientras la arista se está trazando
                float tip = (vProg < 0.999) ? exp(-pow((vT - vProg) * 26.0, 2.0)) * 0.9 : 0.0;
                // glow tenue permanente: la trama de la red siempre se insinúa
                float base = 0.26 + vGlow * 0.4;
                vec3 cold = vec3(0.0, 0.55, 1.0);
                vec3 hot  = vec3(0.45, 1.0, 0.85);
                vec3 col = mix(cold, hot, clamp(pulse + tip + vGlow * 0.35, 0.0, 1.0));
                float fogFade = 0.1 + 0.9 * vFog;
                float a = (base + pulse * 1.5 + tip) * vDim * fogFade;
                gl_FragColor = vec4(col * (0.9 + (pulse + tip) * 1.8 + vGlow * 0.5) * (0.55 + 0.45 * vFog), a);
            }`
    });
    const edgeLines = new THREE.LineSegments(edgeGeo, edgeMat);
    edgeLines.frustumCulled = false;
    scene.add(edgeLines);

    // Estrellas de fondo — profundidad de galaxia, estáticas y baratas
    const starGeo = new THREE.BufferGeometry();
    const STARS = isMobile ? 140 : 260;
    const sPos = new Float32Array(STARS * 3);
    for (let i = 0; i < STARS; i++) {
        const v = new THREE.Vector3().randomDirection().multiplyScalar(90 + Math.random() * 140);
        sPos[i * 3] = v.x; sPos[i * 3 + 1] = v.y; sPos[i * 3 + 2] = v.z;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    const starMat = new THREE.PointsMaterial({
        color: 0x3a6a8a, size: 1.2, sizeAttenuation: false,
        transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false
    });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    // ============================================
    // PROYECCIÓN / ETIQUETAS (LOD) — overlay 2D
    // ============================================
    const _proj = new THREE.Vector3();
    const screenPos = []; // {n, x, y, dist, visible}

    function projectNodes() {
        screenPos.length = 0;
        for (const n of nodes) {
            _proj.copy(n.pos).project(camera);
            if (_proj.z > 1) continue;
            const x = (_proj.x * 0.5 + 0.5) * width;
            const y = (-_proj.y * 0.5 + 0.5) * height;
            if (x < -60 || x > width + 60 || y < -30 || y > height + 30) continue;
            screenPos.push({ n, x, y, dist: camera.position.distanceTo(n.pos) });
        }
    }

    function drawLabels(camR) {
        const inFocus = hoverSet();
        const nearSat = camR * 0.8, farSat = camR * 1.02;
        const nearSun = camR * 1.05, farSun = camR * 1.45;
        const cands = [];
        for (const s of screenPos) {
            const n = s.n;
            if (n.birth < 0.55) continue;
            const near = n.isSun ? nearSun : nearSat;
            const far = n.isSun ? farSun : farSat;
            let a = 1 - THREE.MathUtils.smoothstep(s.dist, near, far);
            const depth = THREE.MathUtils.clamp((fogFar - s.dist) / Math.max(fogFar - fogNear, 1), 0, 1);
            a *= 0.3 + 0.7 * depth; // etiqueta lejana más desvanecida (continuo)
            const focused = inFocus && inFocus.has(n);
            if (inFocus) a = focused ? Math.max(a, 0.95) : a * (1 - focusAmt * 0.55);
            a *= Math.min(1, (n.birth - 0.55) / 0.45) * n.dim;
            if (a < 0.04) continue;
            cands.push({ s, a, depth, pri: (focused ? 2 : 0) + (n.isSun ? 1 : 0) });
        }
        cands.sort((p, q) => (q.pri - p.pri) || (p.s.dist - q.s.dist));
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const boxes = []; // anti-colisión: no superponer etiquetas
        let drawn = 0;
        for (let i = 0; i < cands.length && drawn < maxLabels; i++) {
            const { s, a, depth } = cands[i];
            const n = s.n;
            let x = s.x, y = s.y - 8;
            const w = n.label.length * (n.isSun ? 7.3 : 6.1) + 6;
            x = Math.max(w * 0.5 + 4, Math.min(width - w * 0.5 - 4, x));
            let clash = false;
            for (const b of boxes) {
                if (Math.abs(x - b.x) < (w + b.w) * 0.5 && Math.abs(y - b.y) < 13) { clash = true; break; }
            }
            if (clash) continue;
            boxes.push({ x, y, w });
            drawn++;
            if (n.birth < 1) { // micro-glitch de la etiqueta al nacer
                x += (Math.random() - 0.5) * 5;
                if (Math.random() < 0.25) continue;
            }
            // lo cercano se lee más grande y nítido
            const fs = Math.round((n.isSun ? 12 : 10) * (0.8 + 0.4 * depth));
            if (n.isSun) {
                ctx.font = `bold ${fs}px "Courier New", monospace`;
                ctx.fillStyle = `rgba(0, 255, 136, ${(0.85 * a).toFixed(3)})`;
            } else {
                ctx.font = `${fs}px "Courier New", monospace`;
                ctx.fillStyle = `rgba(175, 220, 255, ${(0.8 * a).toFixed(3)})`;
            }
            if (n.glow > 0.4) {
                ctx.shadowColor = 'rgba(0, 220, 255, 0.9)';
                ctx.shadowBlur = 8 * n.glow;
            } else ctx.shadowBlur = 0;
            ctx.fillText(n.label, x, y);
        }
        ctx.shadowBlur = 0;
    }

    function hoverSet() {
        if (!hoverNode) return null;
        const set = new Set([hoverNode]);
        for (const nb of neighbors(hoverNode)) set.add(nb);
        return set;
    }

    // ============================================
    // OVERLAY: retícula de boot + barrido de escaneo
    // ============================================
    function drawGrid(alpha) {
        if (alpha <= 0.003) return;
        ctx.strokeStyle = `rgba(0, 170, 255, ${(alpha * 0.16).toFixed(3)})`;
        ctx.lineWidth = 1;
        const step = 64;
        ctx.beginPath();
        for (let x = (width / 2) % step; x < width; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
        for (let y = (height / 2) % step; y < height; y += step) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
        ctx.stroke();
    }

    function drawSweep() {
        if (sweepX < 0 || sweepAlpha <= 0.01) return;
        const x = sweepX * width;
        const w = Math.max(90, width * 0.09);
        const g = ctx.createLinearGradient(x - w, 0, x + w * 0.3, 0);
        g.addColorStop(0, 'rgba(0,170,255,0)');
        g.addColorStop(0.82, `rgba(0,190,255,${(0.16 * sweepAlpha).toFixed(3)})`);
        g.addColorStop(0.9, `rgba(160,240,255,${(0.32 * sweepAlpha).toFixed(3)})`);
        g.addColorStop(1, 'rgba(0,170,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - w, 0, w * 1.3, height);
    }

    // ============================================
    // HUD
    // ============================================
    const hud = {
        status: document.getElementById('hud-status'),
        nodes: document.getElementById('hud-nodes'),
        edges: document.getElementById('hud-edges'),
        suns: document.getElementById('hud-suns'),
        thought: document.getElementById('hud-thought')
    };
    let typeTimer = null;
    function typeText(el, text, cps) {
        if (!el) return;
        if (typeTimer) clearInterval(typeTimer);
        let i = 0;
        el.textContent = '';
        typeTimer = setInterval(() => {
            i++;
            el.textContent = text.slice(0, i);
            if (i >= text.length) { clearInterval(typeTimer); typeTimer = null; }
        }, 1000 / cps);
    }

    let hudTick = 0;
    function updateHUD() {
        if (time < hudTick) return;
        hudTick = time + 0.35;
        if (hud.nodes) hud.nodes.textContent = nodes.length;
        if (hud.edges) hud.edges.textContent = edges.length;
        if (hud.suns) hud.suns.textContent = sunCount;
        if (hud.thought) hud.thought.textContent = thoughtLabel;
    }

    // ============================================
    // CRECIMIENTO
    // ============================================
    function growthStep() {
        const t = growthT;
        // fase activa larga (~45 s a buen ritmo), luego freno logarítmico
        const interval = 0.5 * (1 + Math.pow(t / 45, 1.8));
        if (nodes.length < nodeCap && time >= nextSpawn) {
            if (spawnFromPool()) nextSpawn = time + Math.min(interval, 6);
            else nextSpawn = time + 2;
        }
        const poolExhausted = !POOL_LABELS.some(l => !nodeByLabel.has(l) &&
            (!labelCooldown.has(l) || time - labelCooldown.get(l) > 25));
        if ((nodes.length >= nodeCap || poolExhausted) && time >= nextRecycle) {
            recycleOne();
            nextRecycle = time + 3 + Math.random() * 2.5;
        }
        checkDemotions();
    }

    // ============================================
    // BUCLE PRINCIPAL
    // ============================================
    let camAngle = 0.6;
    let camR = 68;
    let fogNear = 30, fogFar = 120;
    let camSpin = null; // giro suave para traer el nodo seleccionado al frente

    function updateCamera(dt) {
        const spread = R * Math.max(anchorScale.x, anchorScale.y) + 14;
        const targetR = portrait ? spread * 1.7 : spread * 1.35;
        camR += (targetR - camR) * Math.min(1, dt * 1.2);

        // niebla de profundidad centrada en el volumen de la galaxia
        fogNear = Math.max(6, camR - spread * 0.6);
        fogFar = camR + spread * 1.05;
        nodeMat.uniforms.uFogNear.value = fogNear;
        nodeMat.uniforms.uFogFar.value = fogFar;
        edgeMat.uniforms.uFogNear.value = fogNear;
        edgeMat.uniforms.uFogFar.value = fogFar;

        if (camSpin) {
            const u = Math.min(1, (time - camSpin.t0) / camSpin.dur);
            const e = u * u * (3 - 2 * u); // easing suave
            camAngle = camSpin.from + (camSpin.to - camSpin.from) * e;
            if (u >= 1) camSpin = null;
        } else {
            const orbit = booted ? (hoverNode ? 0 : 0.032) : 0.008;
            camAngle += dt * orbit;
        }

        const px = mouse.active ? mouse.nx : gyro.x;
        const py = mouse.active ? mouse.ny : gyro.y;
        par.x += (px - par.x) * Math.min(1, dt * 2.5);
        par.y += (py - par.y) * Math.min(1, dt * 2.5);

        const a = camAngle + par.x * 0.28;
        const elev = 0.18 + par.y * 0.22 + Math.sin(time * 0.11) * 0.05;
        camera.position.set(
            Math.sin(a) * camR * Math.cos(elev),
            Math.sin(elev) * camR,
            Math.cos(a) * camR * Math.cos(elev)
        );
        camera.lookAt(0, 0, 0);
    }

    function updateNodesState(dt) {
        anchorScale.lerp(anchorTarget, Math.min(1, dt * 1.4));

        for (let i = nodes.length - 1; i >= 0; i--) {
            const n = nodes[i];
            if (n.dying) {
                n.birth -= dt * 1.1;
                for (const e of n.edges) e.dimT = 0;
                if (n.birth <= 0) { removeNode(n); continue; }
            } else if (n.birth < 1 && n.bornVisible) {
                n.birth = Math.min(1, n.birth + dt * 2.8);
            }
            n.glow *= Math.exp(-dt * 2.1);
            n.size += (n.sizeT - n.size) * Math.min(1, dt * 2);
            n.dim += (n.dimT - n.dim) * Math.min(1, dt * 5);

            // aristas secundarias: se trazan una vez materializado
            if (n.birth > 0.85 && n.pendingEdges.length) {
                const target = n.pendingEdges.shift();
                if (nodes.includes(target)) {
                    connect(n, target, 1.4);
                    maybePromote(target);
                }
                maybePromote(n);
            }
        }
        for (const e of edges) {
            if (e.a.bornVisible && e.b.bornVisible && e.a.birth > 0.4 && e.b.birth > 0.4) {
                e.progress = Math.min(1, e.progress + dt * e.drawSpeed);
            }
            e.glow *= Math.exp(-dt * 2.6);
            e.dim += (e.dimT - e.dim) * Math.min(1, dt * 5);
        }
    }

    function updateFocus(dt) {
        const set = hoverSet();
        focusAmt += ((set ? 1 : 0) - focusAmt) * Math.min(1, dt * (set ? 5 : 1.6));
        for (const n of nodes) {
            n.dimT = set ? (set.has(n) ? 1 : 1 - focusAmt * 0.55) : 1;
        }
        for (const e of edges) {
            if (e.dimT === 0 && (e.a.dying || e.b.dying)) continue; // muriendo
            const lit = set && (e.a === hoverNode || e.b === hoverNode);
            e.dimT = set ? (lit ? 1.6 : 1 - focusAmt * 0.62) : 1;
            if (lit) e.glow = Math.max(e.glow, 0.35);
        }
        // latido del hover: onda periódica, no flash
        if (hoverNode) {
            if (time >= hoverBeat) {
                for (const e of hoverNode.edges) firePulse(hoverNode, e, 0, 0.95);
                hoverNode.glow = Math.max(hoverNode.glow, 1);
                hoverBeat = time + 1.7;
            }
        }
    }

    function pickHover() {
        if (!mouse.active || mouse.x < 0) { hoverNode = null; return; }
        let best = null, bestD = (isMobile ? 34 : 26);
        for (const s of screenPos) {
            if (s.n.birth < 0.8 || s.n.dying) continue;
            const dx = s.x - mouse.x, dy = s.y - mouse.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < bestD) { bestD = d; best = s.n; }
        }
        if (best !== hoverNode) {
            hoverNode = best;
            hoverBeat = time; // primer latido inmediato
            if (best) bringToFront(best);
        }
    }

    // Si el nodo seleccionado está en la parte trasera, gira la cámara
    // hasta traerlo al frente. Al soltar, la cámara se queda donde quedó.
    function bringToFront(n) {
        const na = Math.atan2(n.pos.x, n.pos.z);
        let delta = na - ((camAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        delta = ((delta + Math.PI * 3) % (Math.PI * 2)) - Math.PI; // camino más corto
        if (Math.abs(delta) < 0.55) return; // ya está razonablemente al frente
        camSpin = {
            from: camAngle, to: camAngle + delta,
            t0: time, dur: 0.7 + 0.35 * Math.min(1, Math.abs(delta) / Math.PI)
        };
    }

    function spontaneousThought() {
        if (time < nextThought || !booted) return;
        nextThought = time + 3.5 + Math.random() * 4;
        const alive = nodes.filter(n => n.birth >= 1 && !n.dying && degree(n) > 0);
        if (!alive.length) return;
        const n = alive[(Math.random() * alive.length) | 0];
        emitFrom(n, Math.random() < 0.5 ? 2 : 1, 1.0, 3);
        thoughtLabel = n.label;
    }

    function maintenanceSweep(dt) {
        if (!booted) return;
        if (sweepX < 0 && sweepEnabled && time >= nextSweep) {
            sweepX = 0; sweepAlpha = 0.55;
            nextSweep = time + 26 + Math.random() * 14;
        }
        if (sweepX >= 0) {
            sweepX += dt / 2.6;
            for (const s of screenPos) {
                const d = Math.abs(s.x / width - sweepX);
                if (d < 0.02) s.n.glow = Math.min(1, s.n.glow + 0.28);
            }
            if (sweepX > 1.15) { sweepX = -1; sweepAlpha = 0; }
        }
    }

    // ============================================
    // BOOT — génesis por barrido de digitalización
    // ============================================
    function bootStep() {
        if (booted) return;
        const u = (time - bootT.sweepStart) / (bootT.sweepEnd - bootT.sweepStart);
        if (u >= 0 && u <= 1.1) {
            sweepX = u; sweepAlpha = 1;
            // materializa los nodos que el plano ya barrió
            for (const s of screenPos) {
                if (!s.n.bornVisible && s.x / width <= u) s.n.bornVisible = true;
            }
        }
        if (u > 1.1) { sweepX = -1; sweepAlpha = 0; }
        // seguridad: nada se queda sin nacer
        if (time > bootT.sweepEnd + 0.2) for (const n of nodes) n.bornVisible = true;

        if (time >= bootT.pulseAt && !bootStep.pulsed) {
            bootStep.pulsed = true;
            for (const n of nodes) if (n.isSun) emitFrom(n, 1, 0.9, 2);
            typeText(hud.status, `SCAN COMPLETE — ${nodes.length} NODES / ${edges.length} EDGES`, 48);
        }
        if (time >= bootT.done) {
            booted = true;
            growthT = 0;
            nextSpawn = time + 0.4;
            setTimeout(() => { if (hud.status && !typeTimer) typeText(hud.status, 'ONLINE', 20); }, 2600);
        }
    }

    // ============================================
    // BUFFERS → GPU
    // ============================================
    function writeBuffers() {
        const n = nodes.length;
        for (let i = 0; i < n; i++) {
            const nd = nodes[i];
            nPos[i * 3] = nd.pos.x; nPos[i * 3 + 1] = nd.pos.y; nPos[i * 3 + 2] = nd.pos.z;
            nSize[i] = nd.size * (1 + Math.min(degree(nd), 10) * 0.02);
            nSeed[i] = nd.seed;
            nGlow[i] = nd.glow;
            nDim[i] = nd.dim;
            nBirth[i] = nd.bornVisible ? Math.max(0, nd.birth) : 0;
            nSun[i] = nd.isSun ? 1 : 0;
        }
        nodeGeo.setDrawRange(0, n);
        for (const key of ['position', 'aSize', 'aSeed', 'aGlow', 'aDim', 'aBirth', 'aSun']) {
            nodeGeo.attributes[key].needsUpdate = true;
        }

        const m = edges.length;
        for (let i = 0; i < m; i++) {
            const e = edges[i];
            const i6 = i * 6, i2 = i * 2;
            ePos[i6] = e.a.pos.x; ePos[i6 + 1] = e.a.pos.y; ePos[i6 + 2] = e.a.pos.z;
            ePos[i6 + 3] = e.b.pos.x; ePos[i6 + 4] = e.b.pos.y; ePos[i6 + 5] = e.b.pos.z;
            eT[i2] = 0; eT[i2 + 1] = 1;
            eProg[i2] = eProg[i2 + 1] = e.progress;
            eGlow[i2] = eGlow[i2 + 1] = e.glow;
            const dimA = e.dim * Math.max(0, e.a.birth) * Math.max(0, e.b.birth);
            eDim[i2] = eDim[i2 + 1] = dimA;
            ePulse[i2] = ePulse[i2 + 1] = e.pulsePos;
            ePStr[i2] = ePStr[i2 + 1] = e.pulseStr;
        }
        edgeGeo.setDrawRange(0, m * 2);
        for (const key of ['position', 'aT', 'aProg', 'aGlow', 'aDim', 'aPulse', 'aPStr']) {
            edgeGeo.attributes[key].needsUpdate = true;
        }
    }

    // ============================================
    // GOVERNOR DE RENDIMIENTO — degradar con elegancia
    // ============================================
    let fpsEMA = 60, fpsFrames = 0, fpsLast = 0, nextGovern = 8;
    function govern(now) {
        fpsFrames++;
        if (now - fpsLast >= 1000) {
            const fps = fpsFrames * 1000 / (now - fpsLast);
            fpsEMA = fpsEMA * 0.7 + fps * 0.3;
            fpsFrames = 0; fpsLast = now;
        }
        if (time > nextGovern) {
            nextGovern = time + 3;
            if (fpsEMA < 40 && nodeCap > 70) {
                nodeCap = Math.max(70, Math.floor(nodeCap * 0.85));
                maxLabels = Math.max(18, maxLabels - 6);
                nextRecycle = Math.min(nextRecycle, time + 0.5);
            }
            if (fpsEMA < 27) {
                sweepEnabled = false;
                if (pixelRatio > 1) { pixelRatio = 1; renderer.setPixelRatio(1); }
            }
        }
    }

    // ============================================
    // EVENTOS
    // ============================================
    function resize() {
        width = window.innerWidth;
        height = window.innerHeight;
        aspect = width / height;
        portrait = height > width;
        renderer.setSize(width, height, false);
        overlayCanvas.width = width;
        overlayCanvas.height = height;
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
        nodeMat.uniforms.uPix.value = pixelRatio * Math.min(1, height / 900) + 0.45;
        // La galaxia se acomoda a la orientación: ancha en horizontal, alta en vertical
        if (portrait) anchorTarget.set(0.62, 1.28, 0.9);
        else anchorTarget.set(1.22, 0.78, 1);
    }

    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 250));

    window.addEventListener('mousemove', (e) => {
        mouse.x = e.clientX; mouse.y = e.clientY;
        mouse.nx = (e.clientX / width) * 2 - 1;
        mouse.ny = -((e.clientY / height) * 2 - 1);
        mouse.active = true;
    });
    window.addEventListener('mouseleave', () => { mouse.active = false; hoverNode = null; });
    window.addEventListener('touchmove', (e) => {
        if (e.touches.length) {
            mouse.x = e.touches[0].clientX; mouse.y = e.touches[0].clientY;
            mouse.nx = (mouse.x / width) * 2 - 1;
            mouse.ny = -((mouse.y / height) * 2 - 1);
            mouse.active = true;
        }
    }, { passive: true });
    window.addEventListener('touchend', () => { mouse.active = false; hoverNode = null; });

    // Click / tap: dispara un pensamiento en el nodo más cercano
    window.addEventListener('pointerdown', (e) => {
        if (e.target !== document.body && e.target !== glCanvas && e.target !== overlayCanvas) return;
        let best = null, bestD = 60;
        for (const s of screenPos) {
            const dx = s.x - e.clientX, dy = s.y - e.clientY;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < bestD) { bestD = d; best = s.n; }
        }
        if (best) { emitFrom(best, 2, 1.1, 3); thoughtLabel = best.label; }
    });

    // Giroscopio (parallax móvil); iOS pedirá permiso solo si el SO lo permite sin gesto
    window.addEventListener('deviceorientation', (e) => {
        if (e.gamma === null || e.beta === null) return;
        gyro.ok = true;
        gyro.x = THREE.MathUtils.clamp(e.gamma / 32, -1, 1);
        gyro.y = THREE.MathUtils.clamp((e.beta - 45) / 42, -1, 1);
    });

    // ============================================
    // ARRANQUE
    // ============================================
    resize();
    anchorScale.copy(anchorTarget);
    seedGalaxy();
    // pre-asentar la física para que el boot revele una galaxia ya formada
    for (let i = 0; i < 90; i++) physics(1 / 45);
    typeText(hud.status, 'SCANNING...', 24);

    let lastTs = 0;
    function frame(ts) {
        requestAnimationFrame(frame);
        const dt = Math.min((ts - lastTs) / 1000 || 0.016, 1 / 25);
        lastTs = ts;
        time += dt;

        physics(dt);
        updateNodesState(dt);
        updateCamera(dt);

        projectNodes();
        bootStep();
        if (booted) {
            growthT += dt;
            growthStep();
            pickHover();
            spontaneousThought();
        }
        updateFocus(dt);
        updatePulses(dt);
        maintenanceSweep(dt);

        nodeMat.uniforms.uTime.value = time;
        writeBuffers();
        renderer.render(scene, camera);

        // Overlay 2D: retícula (boot), barrido y etiquetas
        ctx.clearRect(0, 0, width, height);
        const gridA = time < 2 ? 1 : Math.max(0, 1 - (time - 2) / 1.5);
        drawGrid(gridA);
        drawSweep();
        drawLabels(camR);

        updateHUD();
        govern(ts);
    }
    requestAnimationFrame(frame);
})();
