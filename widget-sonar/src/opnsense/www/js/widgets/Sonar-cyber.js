/*
 * Copyright (C) 2026 Igor Toledo <contato@igor.eti.br>
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice,
 *    this list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES,
 * INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY
 * AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
 * AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY,
 * OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

/*
 * Sonar MAX CYBER view (loaded on demand by Sonar.js).
 *
 * First-person cyberspace. A neon perspective grid runs toward the viewer under a glowing horizon and
 * a sky of digital stars. The firewall CORE floats over the grid: a wireframe icosahedron (with a
 * counter-rotating dodecahedron inside) wrapped in a SHIELD, a honeycomb of hexagonal cells on a barrel
 * where every cell is a destination port (service). All 3D is projected here, no libraries.
 *
 * Traffic: inbound connections rise on the horizon and run down the grid lanes to the core. Blocked
 * ones slam into the shield: the port's cell flares, cracks into shards, the region glitches (RGB split
 * and sliced jitter for a few frames) and a shock wave runs through the honeycomb. Passed ones go
 * through the shield into the core, which pulses and emits a ring; NAT swings wide around the shield
 * and enters. Outbound connections leave the core through their port's cell and run to the horizon.
 * Colors follow the theme (pass / block / NAT, accent = text-primary); glows are additive on dark themes.
 *
 * HUD: corner brackets, faint scanlines, a THREAT LEVEL arc (blocked per minute, decays by itself and
 * heats the shield), large monospace counters that jitter during a burst, a ticker with the last
 * attacks and a mini radar with the attackers' bearings (hash of the address, like the Sonar view).
 *
 * Fullscreen ("war room", host.fullscreen): title bar with clock and uptime, the scene in the middle
 * (~60% of the width) and cached HUD panels drawn on the canvas around it: threat level with a 60 s
 * sparkline, top attackers, targeted ports, blocking rules, the live feed ticker, a bigger radar, a
 * 24x7 heat map and (when the host exposes host.telemetry) a compact SYSTEM block with CPU, memory
 * and WAN throughput. Text panels are images refreshed at 1 Hz; only the scene animates per frame.
 *
 * Reduced motion: static scene (grid, core and shield still, no trails, no glitch), HUD and hot cells.
 *
 * DEEP SPACE (default scene; SCENE / this.scene = 'grid' brings back the grid floor and horizon above): the
 * core is this firewall, travelling through space. Stars stream out of a vanishing point (near ones faster,
 * with a short streak), Orion drifts very slowly in the far layer, and rare decorations (a comet, small ships,
 * lightning in a far nebula) cross behind everything; none of them is an event. The most active remote hosts
 * of the last 5 min are planets in slow orbits around the core (LAN in the inner ring, cool blue/green;
 * internet outside, coloured by how much of their traffic was blocked; size by volume; fade in/out, no jumps).
 * Every live event is a shot between the host's planet (or deep space) and the core: blocked = red missile
 * that explodes on the shield, inbound passed / NAT = green-cyan ship that glides in and docks on the surface,
 * outbound = packet train fired from the core to the host. Planets and shots have tooltips; a click picks the
 * address for the AI analyst. Reduced motion: planets and stars still, no shots, no decorations.
 */

const TAU = Math.PI * 2;
const PHI = (1 + Math.sqrt(5)) / 2;
const LIVE_MS = 1500;                 // only events newer than this are animated
const COLS = 24, ROWS = 7, NCELLS = COLS * ROWS;     // honeycomb (168 cells)
const MAX_TRAILS = 80, MAX_FX = 40, MAX_SHOCKS = 8, MAX_RINGS = 12, MAX_BLIPS = 60, MAX_PARTS = 60;
const RATE_MS = 60000, UNIQ_MS = 300000, DECAY = 120000, HEAT_MS = 2200, SHOCK_MS = 700;
const H_CAM = 2.5;                    // camera height over the grid (world units; the shield radius is 1)
const LANE = 0.6;                     // grid spacing (world units)
const SPEED = 0.0011;                 // grid speed (world units per ms)
const FEED_N = 14, ATTACK_N = 8, BOOT_MS = 1200;
const SAMPLES = 5;                    // points per trail (head + tail)
const TRAIL_A = [0.95, 0.62, 0.34, 0.13];
// deep space scene (default): planets = the most active remote hosts, the core = this firewall
const SCENE = 'space';                // 'space' | 'grid' (the old neon grid floor and horizon)
const STARS_MAX = 340, STAR_V = 0.000032;              // flowing stars; z units per ms
const DECAY_H = 150000, PLANET_FADE = 900, PSPR = 1.9;  // host weight decay, fade in/out, sprite half size / radius
const DOCK_MS = 900, MAX_DOCKS = 12, MAX_FREE = 100;
const PKINDS = ['lan', 'pass', 'warn', 'block'];
// Orion (RA hours, Dec degrees, magnitude, colour): Betelgeuse, Rigel, Bellatrix, Saiph, Alnitak, Alnilam, Mintaka, Meissa
const ORION = [[5.919, 7.407, 0.5, [255, 168, 118]], [5.242, -8.202, 0.13, [176, 204, 255]], [5.419, 6.350, 1.64, [198, 214, 255]],
    [5.796, -9.670, 2.06, [192, 210, 255]], [5.679, -1.943, 1.77, [200, 216, 255]], [5.603, -1.202, 1.69, [205, 220, 255]],
    [5.533, -0.299, 2.23, [205, 220, 255]], [5.585, 9.934, 3.39, [200, 215, 255]]];
const ORION_M42 = [5.588, -5.39];
const ORION_LINES = [7, 0, 7, 2, 0, 4, 2, 6, 4, 5, 5, 6, 4, 3, 6, 1];
const byScore = (a, b) => b.sc - a.sc;
const byDepth = (a, b) => b.wz - a.wz;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
// OPNsense's Response.php runs htmlspecialchars over the JSON of /api/: undo it for text drawn on the canvas
const unesc = (s) => (typeof s === 'string' ? s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&') : s);
const AI_URL = '/api/policyanalyzer/ai/brief';
const AI_POLL = 60000, AI_POLL_RUN = 10000, AI_REFRESH = 600000, AI_RETRY = 15000, AI_ASK_MAX = 600000;

function fnv(s) {
    // 32-bit FNV-1a
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
}

function mulberry(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function parseRgb(s) {
    const m = String(s || '').match(/[\d.]+/g);
    if (!m || m.length < 3) { return null; }
    return [+m[0], +m[1], +m[2], m.length > 3 ? +m[3] : 1];
}

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const pad2 = (n) => (n < 10 ? '0' : '') + n;
const hms = (d) => pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
const hmsUTC = (d) => pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds());
const dur = (ms) => { const s = Math.floor(ms / 1000); return pad2(Math.floor(s / 3600)) + ':' + pad2(Math.floor(s / 60) % 60) + ':' + pad2(s % 60); };
const bps = (v) => (v < 1e3 ? v.toFixed(0) + ' b/s' : v < 1e6 ? (v / 1e3).toFixed(1) + ' Kb/s' : v < 1e9 ? (v / 1e6).toFixed(1) + ' Mb/s' : (v / 1e9).toFixed(2) + ' Gb/s');

// wireframe polyhedron: unit vertices + edge index pairs (edges found by length on the raw coordinates)
function polyhedron(raw, edge) {
    const v = [], e = [];
    for (const p of raw) { const l = Math.hypot(p[0], p[1], p[2]); v.push(p[0] / l, p[1] / l, p[2] / l); }
    for (let i = 0; i < raw.length; i++) {
        for (let j = i + 1; j < raw.length; j++) {
            const d = Math.hypot(raw[i][0] - raw[j][0], raw[i][1] - raw[j][1], raw[i][2] - raw[j][2]);
            if (Math.abs(d - edge) < 1e-6) { e.push(i, j); }
        }
    }
    return { v: Float32Array.from(v), e: Uint8Array.from(e), n: raw.length };
}
const ICO = polyhedron([[-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0], [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
    [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1]], 2);
const DOD = (() => {
    const p = [], q = 1 / PHI;
    for (const a of [-1, 1]) { for (const b of [-1, 1]) { for (const c of [-1, 1]) { p.push([a, b, c]); } } }
    for (const a of [-1, 1]) { for (const b of [-1, 1]) { p.push([0, a * q, b * PHI]); p.push([a * q, b * PHI, 0]); p.push([a * PHI, 0, b * q]); } }
    return polyhedron(p, 2 * q);
})();

// rotation matrix Rx(ax) * Ry(ay), row major
function rotM(ax, ay, o) {
    const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay);
    o[0] = cy; o[1] = 0; o[2] = sy;
    o[3] = sx * sy; o[4] = cx; o[5] = -sx * cy;
    o[6] = -cx * sy; o[7] = sx; o[8] = cx * cy;
}

// point inside a convex polygon given as a flat [x0, y0, x1, y1, ...] slice (either winding)
function inConvex(p, o, n, x, y) {
    let sign = 0;
    for (let i = 0; i < n; i++) {
        const ax = p[o + i * 2], ay = p[o + i * 2 + 1], bx = p[o + ((i + 1) % n) * 2], by = p[o + ((i + 1) % n) * 2 + 1];
        const cr = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
        if (cr !== 0) {
            const s = cr > 0 ? 1 : -1;
            if (sign === 0) { sign = s; } else if (s !== sign) { return false; }
        }
    }
    return true;
}

function bumpMap(m, key, limit) {
    if (key === '' || key == null) { return; }
    m.set(key, (m.get(key) || 0) + 1);
    if (m.size > limit) { m.delete(m.keys().next().value); }
}

export default class CyberView {
    constructor(host) {
        this.host = host;
        this.t0 = performance.now();
        this.total = 0;
        // honeycomb cells (fixed slots), lattice and per-frame projections
        this.cells = [];
        for (let j = 0; j < ROWS; j++) {
            for (let i = 0; i < COLS; i++) {
                this.cells.push({ idx: j * COLS + i, i, j, key: '', port: '', svc: '', n: 0, c: { pass: 0, block: 0, nat: 0, other: 0 },
                    w: 0, wt: 0, heat: 0, heatT: -1e9, hk: 'block', last: '', lastIn: false, proto: '' });
            }
        }
        this.byKey = new Map();
        this.lat = new Float32Array(NCELLS * 6 * 4);   // per corner: cos, sin, radius, v
        this.cen = new Float32Array(NCELLS * 4);       // per cell centre: cos, sin, radius, v
        this.cp = new Float32Array(NCELLS * 12);       // projected corners
        this.cc = new Float32Array(NCELLS * 3);        // projected centre + depth
        this.cw = new Float32Array(NCELLS * 5);        // world centre + normal (x, y, z, nx, nz)
        this.front = new Uint8Array(NCELLS);
        this.shine = new Float32Array(NCELLS);         // shock wave brightness
        // animation
        this.trails = []; this.fx = []; this.shocks = []; this.rings = []; this.blips = [];
        this.nextT0 = 0; this.corePulse = -1e9; this.bootT = -1e9;
        // statistics
        this.times = []; this.blocks = []; this.uniq = new Map(); this.attackers = new Map(); this.rules = new Map();
        this.attacks = []; this.feed = []; this.hmin = new Map(); this.hhour = new Map();
        this.inAtt = new Map();          // 'port/proto' -> timestamps of inbound attempts (last 5 min, bounded)
        this.expoHitAt = -1e9;           // last live attempt on an exposed service (the panel blinks)
        // AI analyst (Policy Analyzer plugin, optional): read-only brief; avail null = not asked yet, false = absent
        this.ai = { avail: null, rec: null, focusRec: null, sel: null, focus: null, inflight: false, lastCached: -1e9,
            lastRefresh: -1e9, askAt: 0, askRetry: 0, err: null, wrapKey: '', wrap: null };
        // caches
        this.sprites = new Map(); this.labels = new Map(); this.caches = new Map();
        this.bg = null; this.bgKey = ''; this.scan = null; this.scanKey = ''; this.tick = null; this.tmp = null;
        this.M1 = new Float64Array(9); this.M2 = new Float64Array(9); this.pv = new Float32Array(20 * 3);
        this.P = null; this.pKey = '';
        // deep space: hosts (last 5 min), planets (persistent, pooled), star field, decorations
        this.scene = SCENE; this.sceneAt = '';
        this.hostStats = new Map(); this.planets = []; this.planetBy = new Map(); this.planetFree = [];
        this.pOrd = []; this.candL = []; this.candI = []; this.planetsAt = -1e9;
        this.slotL = new Uint8Array(4); this.slotI = new Uint8Array(8);
        this.pSpr = new Array(PKINDS.length * 3 * 4).fill(null); this.pSprKey = '';
        this.lblR = new Float32Array(48);
        this.shotFree = []; this.docks = []; this.lsM = []; this.lsS = []; this.lsO = []; this.so = new Float64Array(9);
        this.stX = new Float32Array(STARS_MAX); this.stY = new Float32Array(STARS_MAX); this.stZ = new Float32Array(STARS_MAX);
        this.stN = 0; this.lastNow = 0; this.neb = new Float32Array(9);
        this.comet = { on: false, t0: 0, dur: 0, x0: 0, y0: 0, dx: 0, dy: 0, a: 0 }; this.nextComet = 0;
        this.ships = [0, 1].map(() => ({ on: false, t0: 0, x: 0, y: 0, vx: 0, vy: 0, a: 0, sz: 4, ph: 0 })); this.nextShip = 0;
        this.thunder = { on: false, t0: 0, dur: 0, x: 0, y: 0, pts: new Float32Array(40), n: 0, b0: 0, bn: 0 }; this.nextThunder = 0;
        this.orion = null; this.orionKey = ''; this.cometCv = null; this.cometKey = ''; this.spr = null; this.sprKey = '';
        this.hover = null; this.drawn = false; this.sideHidden = false; this.sidePrev = ''; this.teleOn = false; this.teleTimer = 0;
        // the boot sequence plays when the widget enters fullscreen, not when the view is created already in it
        this.wasFs = !!host.fullscreen;
        try { this.font = getComputedStyle(host.el).fontFamily || 'sans-serif'; } catch (e) { this.font = 'sans-serif'; }
        this.mono = host.monoFont || '';
        if (!this.mono && host.el) {
            try {
                const cd = document.createElement('code'); cd.style.display = 'none'; host.el.appendChild(cd);
                this.mono = getComputedStyle(cd).fontFamily.replace(/"/g, "'"); cd.remove();
            } catch (e) { this.mono = ''; }
        }
        if (!this.mono) { this.mono = 'monospace'; }
        this._lattice();
        this.resize();
    }

    /* ------------------------------------------------------------------ geometry */

    // hexagonal lattice on the barrel, in (theta, v) space; pointy-top hexes, odd rows shifted half a cell
    _lattice() {
        const dth = TAU / COLS, ath = dth / Math.sqrt(3);
        this.Hs = 0.65;                                   // world height per unit of v
        const av = ath / this.Hs, dv = 1.5 * av;
        const rad = (v) => Math.sqrt(Math.max(0.04, 1 - 0.5 * v * v));
        for (const c of this.cells) {
            const th = (c.i + (c.j & 1) * 0.5) * dth, v = (c.j - (ROWS - 1) / 2) * dv;
            const o = c.idx * 4;
            this.cen[o] = Math.cos(th); this.cen[o + 1] = Math.sin(th); this.cen[o + 2] = rad(v); this.cen[o + 3] = v;
            for (let k = 0; k < 6; k++) {
                const a = (Math.PI / 6) + k * (Math.PI / 3), ct = th + ath * Math.cos(a), cv = v + av * Math.sin(a);
                const q = (c.idx * 6 + k) * 4;
                this.lat[q] = Math.cos(ct); this.lat[q + 1] = Math.sin(ct); this.lat[q + 2] = rad(cv); this.lat[q + 3] = cv;
            }
        }
    }

    /* clock of the firewall: /api/diagnostics/system/system_time gives "Sun Nov 8 2:09:12 -03 2026" (PHP date
     * in the configured time zone); the offset is derived once and refreshed every 30 min (DST) */
    _fwClock() {
        const nowMs = Date.now();
        if (!this._fwTzAt || nowMs - this._fwTzAt > 30 * 60000) {
            this._fwTzAt = nowMs;
            fetch('/api/diagnostics/system/system_time', {credentials: 'same-origin', headers: {Accept: 'application/json'}})
                .then((r) => (r.ok ? r.json() : null)).then((j) => {
                    const m = j && typeof j.datetime === 'string' &&
                        j.datetime.match(/^\w+\s+(\w{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(\S+)\s+(\d{4})$/);
                    if (!m) { return; }
                    const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(m[1]);
                    if (mon < 0) { return; }
                    const fwMs = Date.UTC(+m[7], mon, +m[2], +m[3], +m[4], +m[5]);
                    const offsetMin = Math.round((fwMs - Date.now()) / 60000 / 15) * 15;
                    let label = m[6];
                    const num = label.match(/^([+-])(\d{2})(\d{2})?$/);
                    if (num) {   // numeric abbreviation (e.g. America/Sao_Paulo prints "-03"): GMT-3
                        label = 'GMT' + num[1] + (+num[2]) + (num[3] && num[3] !== '00' ? ':' + num[3] : '');
                    }
                    this._fwTz = {label: label.toUpperCase(), offsetMin};
                }).catch(() => { /* keep the browser clock */ });
        }
        return this._fwTz || null;
    }

    resize() {
        const h = this.host;
        const w = Math.max(10, h.w || 10), hh = Math.max(10, h.h || 10);
        const fs = !!h.fullscreen;
        this.gw = w; this.gh = hh; this.fs = fs;
        const s = fs ? Math.max(0.55, Math.min(1.8, Math.min(w / 1600, hh / 900))) : 1;
        this.s = s;
        const L = this.L = { fs, s };
        if (fs) {
            // text classes in CSS px: scaled with the screen, but never below a legible floor (1366x768 -> s = 0.85)
            const fz = (base, min) => Math.round(Math.max(min, base * s));
            this.FZ = { head: fz(13, 12), row: fz(14.5, 13), label: fz(12, 11), small: fz(11, 10.5), big: fz(26, 21),
                sys: fz(13, 12), tick: fz(14.5, 13), title: fz(14, 13), brand: fz(23, 19), pad: fz(12, 10) };
            this.rowsN = hh < 900 ? 6 : 8;            // short screens list fewer rows instead of smaller text
            // the canvas is the whole screen: 1 px outer margin (the frame lines sit on the edge), small gaps inside
            const T = Math.max(40, Math.round(44 * s)), F = Math.max(32, Math.round(34 * s));
            const M = 1, G = Math.max(4, Math.round(6 * s)), side = Math.round(Math.max(w * 0.215, 290));
            L.margin = M;
            L.title = { y0: 0, y1: T };
            L.foot = { y0: hh - F, y1: hh };
            L.scene = { x0: M + side + G, y0: T, x1: w - M - side - G, y1: hh - F };
            const ly = T + G, colH = hh - F - G - ly;
            const sysH = h.telemetry ? Math.round(colH * 0.30) : 0;
            const thH = Math.round(colH * (sysH ? 0.34 : 0.4));
            const atH = colH - thH - sysH - G * (sysH ? 2 : 1);
            L.threat = { x: M, y: ly, w: side, h: thH };
            L.attackers = { x: M, y: ly + thH + G, w: side, h: atH };
            L.system = sysH ? { x: M, y: ly + colH - sysH, w: side, h: sysH } : null;
            const rx = w - M - side, ex = this._expoData();
            const crH = Math.round(colH * (ex ? 0.25 : 0.30)), ptH = Math.round(colH * (ex ? 0.26 : 0.40));
            const exH = ex ? Math.round(colH * 0.27) : 0, ruH = colH - crH - ptH - exH - G * (ex ? 3 : 2);
            L.ports = { x: rx, y: ly, w: side, h: ptH };
            L.exposure = ex ? { x: rx, y: ly + ptH + G, w: side, h: exH } : null;
            L.rules = { x: rx, y: ly + ptH + G + (ex ? exH + G : 0), w: side, h: ruH };
            L.corner = { x: rx, y: ly + colH - crH, w: side, h: crH };
        } else {
            L.scene = { x0: 0, y0: 0, x1: w, y1: hh };
            L.gauge = { x: 54, y: 56, r: 30 };
            L.radar = { x: w - 46, y: hh - 46, r: 30 };
            L.counters = { x: w - 14, y: 14 };
            L.ticker = { x0: 14, x1: w - 96, y: hh - 12, h: 16 };
            L.status = { x: 14, y: hh - 32 };
        }
        // perspective: camera at the origin looking down +z, grid at y = -H_CAM, shield radius 1 at depth zc
        const sc = L.scene, sw = sc.x1 - sc.x0, sh = sc.y1 - sc.y0, space = this.scene !== 'grid';
        this.sceneAt = this.scene;
        this.vx = sc.x0 + sw / 2;
        this.f = Math.max(w, hh) * 0.6;
        // space: a smaller core a bit higher (room for the orbits and for the AI panel docked at the bottom)
        this.Rpx = Math.max(20, Math.min(sw * (fs ? 0.2 : 0.17), sh * (fs ? 0.25 : 0.21))) * (space ? 0.8 : 1);
        this.zc = this.f / this.Rpx;
        this.yc = -0.9;
        this.hy = space ? Math.round(sc.y0 + sh * (fs ? 0.43 : 0.47) + this.yc * this.Rpx) : Math.round(sc.y0 + sh * (fs ? 0.38 : 0.40));
        // orbits (world units, shield radius = 1): the outer ring fits the scene width at the core's depth
        this.OS = Math.max(2.5, Math.min(4.2, (sw / 2) / this.Rpx * 0.92));
        this.Rc = 0.56;
        this.zNear = this.f * H_CAM / Math.max(20, hh - this.hy);
        this.zFar = this.f * H_CAM / 1.5;
        this.cx = this.vx;
        this.cy = this.hy - this.f * this.yc / this.zc;
        this.gy = this.hy + this.f * H_CAM / this.zc;
        if (space) { this._starsInit(); }
        this.orionKey = ''; this.cometKey = '';
        this.bgKey = ''; this.scanKey = ''; this.caches.clear(); this.tick = null; this.labels.clear();
        if (fs && !this.wasFs) { this.bootT = performance.now(); }
        this.wasFs = fs;
        this._sidePanel(fs);
        if (!fs) { this._teleStop(); }
    }

    // host.exposure (feature-detected): the Policy Analyzer report in exposure.data (or the report itself),
    // firewall services with reachability and CVE counts; null when there is no report
    _expoData() {
        const X = this.host.exposure;
        const E = X && X.data !== undefined ? X.data : X;
        return E && Array.isArray(E.services) && E.services.length ? E : null;
    }

    // One exposure service in a common shape, whatever the report gives:
    //   Policy Analyzer report: {service, label, port, proto, internet_reachable, admin, scope, cves: count,
    //   kev: count}, the severity coming from findings[] (evidence.service + port/ports);
    //   older or hand-made shapes: cves = {critical, high, medium, low} or a list of {severity|cvss, kev}.
    // sev: 3 = KEV / critical / high finding on a reachable service, 2 = high, 1 = medium/low, 0 = none.
    static _norm(sv, worst) {
        const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
        const port = sv.port !== '' && sv.port != null ? String(sv.port) : '';
        const o = { sv, name: String(sv.label || sv.name || sv.service || '?'), port, proto: String(sv.proto || ''),
            reach: String(sv.internet_reachable || 'no'), admin: !!sv.admin, scope: String(sv.scope || ''),
            sevs: null, total: 0, kev: 0, sev: 0 };
        const c = sv.cves;
        if (Array.isArray(c)) {
            o.sevs = [0, 0, 0, 0];
            for (const r of c) {
                const sev = String((r && (r.severity || r.cvss_severity)) || '').toLowerCase(), sc = r && r.cvss != null ? Number(r.cvss) : null;
                const i = sev.startsWith('crit') ? 0 : sev.startsWith('high') ? 1 : sev.startsWith('med') || sev.startsWith('mod') ? 2 :
                    sev.startsWith('low') ? 3 : sc != null ? (sc >= 9 ? 0 : sc >= 7 ? 1 : sc >= 4 ? 2 : 3) : 2;
                o.sevs[i]++;
                if (r && r.kev) { o.kev++; }
            }
            o.total = c.length;
        } else if (c && typeof c === 'object') {
            o.sevs = [num(c.critical), num(c.high), num(c.medium), num(c.low)];
            o.total = o.sevs.reduce((x, y) => x + y, 0);
        } else {
            o.total = num(c);
        }
        if (Array.isArray(sv.kev)) { o.kev = Math.max(o.kev, sv.kev.length); } else if (sv.kev === true) { o.kev = Math.max(o.kev, 1); } else { o.kev = Math.max(o.kev, num(sv.kev)); }
        const fsev = { high: 2, medium: 1, low: 1 }[worst] || 0;
        const csev = o.sevs ? (o.sevs[0] ? 3 : o.sevs[1] ? 2 : (o.sevs[2] || o.sevs[3]) ? 1 : 0) : (o.total ? 1 : 0);
        o.sev = Math.max(csev, fsev, o.kev ? 3 : 0, fsev === 2 && o.reach === 'yes' ? 3 : 0);
        o.findSev = worst || '';
        return o;
    }

    // normalized services, sorted: reachable (yes, maybe), then admin, then the rest; worst first inside
    _expoList(E) {
        if (this.expoNormSrc === E && this.expoNorm) { return this.expoNorm; }
        const rank = { high: 3, medium: 2, low: 1, info: 0 }, worst = new Map();
        for (const f of Array.isArray(E.findings) ? E.findings : []) {
            const ev = f && f.evidence;
            if (!ev || !ev.service || !(f.severity in rank)) { continue; }
            const ports = Array.isArray(ev.ports) ? ev.ports : [ev.port];
            for (const pt of ports) {
                const key = ev.service + '|' + (pt == null ? '' : String(pt));
                const cur = worst.get(key);
                if (!cur || rank[f.severity] > rank[cur]) { worst.set(key, f.severity); }
            }
        }
        const group = (o) => (o.reach === 'yes' ? 0 : o.reach === 'maybe' ? 1 : o.admin ? 2 : 3);
        const list = E.services.slice(0, 200).map((sv) => CyberView._norm(sv, worst.get(String(sv.service) + '|' + (sv.port == null ? '' : String(sv.port))) ||
            worst.get(String(sv.service) + '|')));
        list.sort((a, b) => group(a) - group(b) || b.sev - a.sev || b.kev - a.kev || b.total - a.total || a.name.localeCompare(b.name));
        this.expoNormSrc = E; this.expoNorm = list;
        return list;
    }

    // once a second: port -> worst service; exposed ports (reachable, or with a severity) get a shield cell
    _exposure(now) {
        const E = this._expoData();
        if (!E) { this.expo = null; return; }
        if (this.expo && this.expoSrc === E && now - this.expoAt < 1000) { return; }
        this.expoSrc = E; this.expoAt = now;
        const m = new Map();
        for (const o of this._expoList(E)) {
            if (!o.port || (o.reach === 'no' && o.sev < 1)) { continue; }
            const rank = o.sev + (o.reach === 'yes' ? 0.5 : o.reach === 'maybe' ? 0.25 : 0);
            const cur = m.get(o.port);
            if (!cur || rank > cur.rank) { m.set(o.port, { sev: Math.max(o.sev, o.reach === 'yes' ? 1 : 0), rank, sv: o }); }
            if (m.size >= 48) { break; }
        }
        for (const port of m.keys()) { const c = this._cell(port, port, now); if (!c.wt) { c.wt = now; } }
        for (const ex of m.values()) { ex.attacked = this._attempts(ex.sv, now).n > 0; }
        this.expo = m;
    }

    // inbound attempts on a service's port in the last 5 min (same protocol when the service names one)
    _attempts(o, now) {
        if (!o.port) { return { n: 0, last: -1e9 }; }
        const want = String(o.proto || '').toLowerCase(), cut = now - UNIQ_MS;
        let n = 0, last = -1e9;
        for (const [k2, arr] of this.inAtt) {
            const i = k2.indexOf('/');
            if (k2.slice(0, i) !== o.port || (want && want !== 'any' && k2.slice(i + 1) !== want)) { continue; }
            while (arr.length && arr[0] < cut) { arr.shift(); }
            n += arr.length;
            if (arr.length) { last = Math.max(last, arr[arr.length - 1]); }
        }
        return { n, last };
    }

    static _reachable(o) { return o.reach === 'yes' || o.reach === 'maybe'; }

    // The host's HTML side panel is hidden in fullscreen (the canvas draws its own panels). On leaving, the
    // host's own _resize() has already set it (it runs before the views' resize()), so only `restore` (this view
    // stopped drawing while the widget stays in fullscreen) puts the previous display back.
    _sidePanel(fs, restore) {
        const side = this.host.side;
        if (!side || !side.style) { return; }
        if (fs) {
            if (!this.sideHidden) { this.sidePrev = side.style.display; this.sideHidden = true; }
            else if (side.style.display !== 'none') { this.sidePrev = side.style.display; }
            side.style.display = 'none';
        } else if (this.sideHidden) {
            if (restore && side.style.display === 'none') { side.style.display = this.sidePrev || 'block'; }
            this.sideHidden = false;
        }
    }

    _teleStop() {
        if (this.teleTimer) { clearTimeout(this.teleTimer); this.teleTimer = 0; }
        if (this.teleOn) {
            this.teleOn = false;
            try { this.host.telemetry && this.host.telemetry.stop && this.host.telemetry.stop(); } catch (e) { /* ignore */ }
        }
    }

    // telemetry runs only while this view is drawn in fullscreen; a watchdog stops it when the drawing stops
    _tele(fs) {
        const T = this.host.telemetry;
        if (!T) { return null; }
        if (!fs) { this._teleStop(); return null; }
        if (!this.teleOn) { this.teleOn = true; try { T.start && T.start(); } catch (e) { /* ignore */ } }
        if (this.teleTimer) { clearTimeout(this.teleTimer); }
        this.teleTimer = setTimeout(() => { this.teleTimer = 0; this._teleStop(); if (this.host.fullscreen) { this._sidePanel(false, true); } }, 3000);
        return T;
    }

    /* ------------------------------------------------------------------ data */

    _cell(key, port, t) {
        let c = this.byKey.get(key);
        if (c) { return c; }
        const start = fnv(key) % NCELLS;
        let low = null, lw = Infinity;
        for (let k = 0; k < NCELLS; k++) {
            const cand = this.cells[(start + k) % NCELLS];
            if (!cand.key) { c = cand; break; }
            const w = cand.w * Math.exp(-Math.max(0, t - cand.wt) / DECAY);
            if (w < lw) { lw = w; low = cand; }
        }
        if (!c) { c = low; this.byKey.delete(c.key); if (this.hover && this.hover.cell === c) { this.hover = null; } }
        c.key = key; c.port = port; c.svc = port ? ((this.host.constructor && this.host.constructor.SVC) || {})[port] || '' : '';
        c.n = 0; c.c = { pass: 0, block: 0, nat: 0, other: 0 }; c.w = 0; c.wt = t; c.heat = 0; c.heatT = -1e9; c.last = ''; c.lastIn = false;
        this.byKey.set(key, c);
        return c;
    }

    _heat(c, act, now, v) {
        c.heat = Math.min(1, c.heat * Math.exp(-Math.max(0, now - c.heatT) / HEAT_MS) + v);
        c.heatT = now; c.hk = act;
    }

    add(ev) {
        if (!ev) { return; }
        const h = this.host, real = performance.now();
        const t = typeof ev.now === 'number' ? Math.min(ev.now, real) : real;
        const act = ev.action === 'pass' || ev.action === 'block' || ev.action === 'nat' ? ev.action : 'other';
        const ip = String(ev.remote ?? ''), inbound = !!ev.inbound;
        const port = ev.port !== '' && ev.port != null ? String(ev.port) : '';
        const proto = String(ev.proto || '').toLowerCase();
        const wall = Date.now() - (real - t);
        this.total++;
        if (t > real - RATE_MS) { this.times.push(t); if (act === 'block') { this.blocks.push(t); } }
        if (act === 'block') {
            bumpMap(this.rules, ev.label || '', 300);
            if (inbound && ip) {
                if (this.uniq.size >= 500 && !this.uniq.has(ip)) { this.uniq.delete(this.uniq.keys().next().value); }
                this.uniq.set(ip, t);
                let a = this.attackers.get(ip);
                if (!a) { a = { ip, n: 0, t, cc: undefined, port }; this.attackers.set(ip, a); if (this.attackers.size > 300) { this.attackers.delete(this.attackers.keys().next().value); } }
                a.n++; a.t = t; a.port = port;
                this.attacks.unshift({ wall, ip, port, cc: undefined });
                if (this.attacks.length > ATTACK_N) { this.attacks.length = ATTACK_N; }
                this.blips.push({ ip, ang: (fnv(ip) / 4294967296) * TAU, t, port });
                if (this.blips.length > MAX_BLIPS) { this.blips.shift(); }
                const m = Math.floor(wall / 60000), hr = Math.floor(wall / 3600000);
                bumpMap(this.hmin, m, 200); bumpMap(this.hhour, hr, 200);
            }
        }
        if (inbound && port) {
            // inbound attempts per port and protocol, crossed with the exposure report (exposed and under attack)
            const k2 = port + '/' + (proto || '?');
            let arr = this.inAtt.get(k2);
            if (!arr) {
                if (this.inAtt.size >= 300) { this.inAtt.delete(this.inAtt.keys().next().value); }
                arr = []; this.inAtt.set(k2, arr);
            }
            arr.push(t);
            if (arr.length > 500) { arr.splice(0, arr.length - 500); }
            if (this.expo && this.expo.has(port) && t > real - LIVE_MS) { this.expoHitAt = real; this.expoAt = -1e9; }
        }
        if (ip) { this._hostAdd(ip, act, inbound, t, port, proto); }
        this.feed.unshift({ wall, act, ip, port, inbound, cc: undefined });
        if (this.feed.length > FEED_N) { this.feed.length = FEED_N; }
        // the port's cell (protocol name when the event has no port)
        const key = port || (proto ? proto.toUpperCase() : '?');
        const cell = this._cell(key, port, t);
        cell.n++; cell.c[act]++; cell.last = ip; cell.lastIn = inbound; cell.proto = proto;
        if (t >= cell.wt) { cell.w = cell.w * Math.exp(-(t - cell.wt) / DECAY) + 1; cell.wt = t; } else { cell.w += Math.exp(-(cell.wt - t) / DECAY); }
        const live = t > real - LIVE_MS;
        if (!live) {
            if (act === 'block' && real - t < HEAT_MS * 3) { this._heat(cell, act, real, 0.6 * Math.exp(-(real - t) / HEAT_MS)); }
            return;
        }
        if (h.reducedMotion) { this._heat(cell, act, real, act === 'block' ? 1 : 0.5); return; }
        // trail: bursts leave one after another, late ones only warm the cell
        const t0 = Math.max(real, this.nextT0 + 45);
        if (t0 - real > 1400) { this._heat(cell, act, real, act === 'block' ? 0.8 : 0.3); return; }
        this.nextT0 = t0;
        if (this.trails.length >= MAX_TRAILS) {
            const old = this.trails.shift();
            if (this.hover && this.hover.trail === old) { this.hover = null; }
            this._shotFree(old);
        }
        const hs = fnv(ip + '|' + port), fan = ((hs % 2001) / 1000) - 1;
        if (this.scene !== 'grid') {
            this.trails.push(this._shotNew(ip, inbound, act, port, key, cell, t0, fan, ev, proto));
            return;
        }
        this.trails.push({ ip, inbound, act, port, key, cell, t0, dur: inbound ? 1900 : 1600, fan, cc: undefined,
            label: String(ev.label || ''), proto, iface: String(ev.iface || ''), pts: new Float32Array(SAMPLES * 2), on: false, passed: false });
    }

    /* ------------------------------------------------------------------ palette and caches */

    _palette() {
        const h = this.host, k = h.colors, fs = this.fs;
        const dark = !!(h.dark || (fs && h.fsDark));
        const key = `${k.pass}|${k.block}|${k.nat}|${k.beam}|${k.text}|${k.bg}|${dark}|${fs}`;
        if (this.pKey === key) { return this.P; }
        this.pKey = key;
        let bg = parseRgb(k.bg);
        if (!bg || bg[3] < 0.5 || (dark && (bg[0] + bg[1] + bg[2]) > 300)) { bg = dark ? [15, 19, 26, 1] : [246, 247, 249, 1]; }
        if (fs && dark) { bg = mix(bg, [0, 0, 0], 0.5); }
        const text = parseRgb(k.text) || (dark ? [225, 228, 232] : [33, 37, 41]);
        const beam = parseRgb(k.beam) || [60, 150, 255];
        const block = parseRgb(k.block) || [220, 50, 50];
        const pass = parseRgb(k.pass) || [40, 170, 80];
        const nat = parseRgb(k.nat) || [60, 140, 220];
        this.P = { dark, bg, text, beam, block, pass, nat, other: mix(text, bg, 0.3),
            col: { pass: css(pass), block: css(block), nat: css(nat), other: css(mix(text, bg, 0.3)) }, tr: {} };
        for (const a of ['pass', 'block', 'nat', 'other']) {
            const rgb = a === 'other' ? this.P.other : this.P[a];
            this.P.tr[a] = { line: TRAIL_A.map((x) => css(rgb, x * (dark ? 1 : 0.9))), glow: TRAIL_A.map((x) => css(rgb, 0.22 * x)) };
        }
        this.bgKey = ''; this.scanKey = ''; this.sprites.clear(); this.labels.clear(); this.caches.clear(); this.tick = null;
        return this.P;
    }

    _color(act) { return this.P.col[act] || this.P.col.other; }

    // glow sprite rendered at the device pixel size it is drawn at
    _sprite(color, d, white) {
        const dark = this.P.dark, S = Math.max(4, Math.round(d * (window.devicePixelRatio || 1) / 2) * 2);
        const key = `${color}|${white ? 1 : 0}|${S}`;
        let sp = this.sprites.get(key);
        if (sp) { return sp; }
        sp = document.createElement('canvas');
        sp.width = sp.height = S;
        const g = sp.getContext('2d'), wa = (a) => this.host._withAlpha(color, a);
        const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
        if (white) {
            gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.12, 'rgba(255,255,255,0.95)');
            gr.addColorStop(0.25, wa(0.9)); gr.addColorStop(0.5, wa(0.3)); gr.addColorStop(1, wa(0));
        } else if (dark) {
            gr.addColorStop(0, wa(1)); gr.addColorStop(0.18, wa(0.8)); gr.addColorStop(0.45, wa(0.25)); gr.addColorStop(1, wa(0));
        } else {
            gr.addColorStop(0, wa(1)); gr.addColorStop(0.25, wa(0.85)); gr.addColorStop(0.5, wa(0.3)); gr.addColorStop(1, wa(0));
        }
        g.fillStyle = gr; g.fillRect(0, 0, S, S);
        if (this.sprites.size > 200) { this.sprites.clear(); }
        this.sprites.set(key, sp);
        return sp;
    }

    _put(c, sp, x, y, scale = 1) {
        const dpr = window.devicePixelRatio || 1, d = sp.width / dpr * scale;
        c.drawImage(sp, Math.round((x - d / 2) * dpr) / dpr, Math.round((y - d / 2) * dpr) / dpr, d, d);
    }

    // small text rendered once into an image (port labels on the cells)
    _label(text, color, size) {
        const key = `${text}|${color}|${size}`;
        let l = this.labels.get(key);
        if (l) { return l; }
        const dpr = window.devicePixelRatio || 1, cv = document.createElement('canvas');
        let g = cv.getContext('2d');
        g.font = `700 ${size}px ${this.mono}`;
        const w = Math.ceil(g.measureText(text).width) + 4, hh = Math.ceil(size * 1.5);
        cv.width = Math.ceil(w * dpr); cv.height = Math.ceil(hh * dpr);
        g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.font = `700 ${size}px ${this.mono}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.lineWidth = 3; g.lineJoin = 'round'; g.strokeStyle = this.P.dark ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.85)';
        g.strokeText(text, w / 2, hh / 2);
        g.fillStyle = color; g.fillText(text, w / 2, hh / 2);
        l = { cv, w, h: hh };
        if (this.labels.size > 300) { this.labels.clear(); }
        this.labels.set(key, l);
        return l;
    }

    // sky, horizon, stars, converging lanes, ground shadow, vignette and corner brackets: one static layer
    _background() {
        const P = this.P, dpr = window.devicePixelRatio || 1, w = this.gw, hh = this.gh, fs = this.fs, s = this.s;
        const key = `${w}x${hh}@${dpr}|${this.pKey}`;
        if (this.bg && this.bgKey === key) { return this.bg; }
        const cv = this.bg || document.createElement('canvas');
        cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr);
        const g = cv.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        const dark = P.dark, beam = P.beam, hy = this.hy, vx = this.vx;
        let gr;
        if (this.scene !== 'grid') { this._spaceBg(g, w, hh); } else {
            const sky = dark ? mix(P.bg, [0, 0, 0], 0.35) : mix(P.bg, [255, 255, 255], 0.3);
            g.fillStyle = css(P.bg); g.fillRect(0, 0, w, hh);
            // sky: darker at the top, accent haze on the horizon
            gr = g.createLinearGradient(0, 0, 0, hy);
            gr.addColorStop(0, css(sky)); gr.addColorStop(0.75, css(mix(sky, beam, dark ? 0.06 : 0.05))); gr.addColorStop(1, css(mix(P.bg, beam, dark ? 0.32 : 0.22)));
            g.fillStyle = gr; g.fillRect(0, 0, w, hy);
            // ground haze fading away from the horizon
            gr = g.createLinearGradient(0, hy, 0, hh);
            gr.addColorStop(0, css(mix(P.bg, beam, dark ? 0.28 : 0.2))); gr.addColorStop(0.25, css(mix(P.bg, beam, dark ? 0.08 : 0.07))); gr.addColorStop(1, css(P.bg));
            g.fillStyle = gr; g.fillRect(0, hy, w, hh - hy);
            // digital stars: tiny squares, a few crosses and faint hex glyphs
            const rnd = mulberry(0xc1be7), n = Math.min(fs ? 900 : 400, Math.round(w * hy / (fs ? 900 : 1300)));
            for (let i = 0; i < n; i++) {
                const x = Math.round(rnd() * w), y = Math.round(rnd() * hy * 0.96), r = rnd(), a = 0.08 + rnd() * rnd() * (dark ? 0.6 : 0.35);
                g.fillStyle = dark ? css(mix([225, 235, 255], beam, 0.25), a) : css(mix(P.text, beam, 0.4), a * 0.8);
                if (r < 0.86) { const d = r < 0.55 ? 1 : 2; g.fillRect(x, y, d, d); }
                else if (r < 0.95) { g.fillRect(x - 2, y, 5, 1); g.fillRect(x, y - 2, 1, 5); }
                else { g.font = `${8 + Math.round(rnd() * 3)}px ${this.mono}`; g.globalAlpha = 0.5; g.fillText('0123456789abcdef'[Math.floor(rnd() * 16)], x, y); g.globalAlpha = 1; }
            }
            // horizon: glow band + crisp line
            for (let i = 4; i >= 0; i--) {
                g.fillStyle = css(beam, (dark ? 0.05 : 0.04) * (5 - i));
                g.fillRect(0, hy - 1 - i * 2, w, 2 + i * 4);
            }
            g.fillStyle = css(dark ? mix(beam, [255, 255, 255], 0.5) : beam, 0.95); g.fillRect(0, hy - 0.5, w, 1.5);
            // converging lanes
            const f = this.f, zn = this.zNear, zf = this.zFar;
            g.beginPath();
            for (let k = -40; k <= 40; k++) {
                const x = k * LANE, xb = vx + f * x / zn;
                if (xb < -w || xb > 2 * w) { continue; }
                g.moveTo(vx + f * x / zf, hy + 1.5); g.lineTo(xb, hh);
            }
            g.strokeStyle = css(dark ? beam : mix(P.text, beam, 0.5), dark ? 0.22 : 0.3); g.lineWidth = 1; g.stroke();
            // ground shadow / landing pad under the core
            const gyy = this.gy, rx = this.Rpx * 1.15, ry = this.Rpx * 0.3;
            gr = g.createRadialGradient(vx, gyy, 0, vx, gyy, rx);
            gr.addColorStop(0, css(beam, dark ? 0.4 : 0.3)); gr.addColorStop(0.5, css(beam, dark ? 0.14 : 0.1)); gr.addColorStop(1, css(beam, 0));
            g.save(); g.translate(vx, gyy); g.scale(1, ry / rx); g.translate(-vx, -gyy);
            g.fillStyle = gr; g.beginPath(); g.arc(vx, gyy, rx, 0, TAU); g.fill();
            g.restore();
            g.beginPath(); g.ellipse(vx, gyy, rx * 0.9, ry * 0.9, 0, 0, TAU);
            g.strokeStyle = css(beam, 0.45); g.lineWidth = 1; g.stroke();
            g.beginPath(); g.ellipse(vx, gyy, rx * 0.5, ry * 0.5, 0, 0, TAU);
            g.strokeStyle = css(beam, 0.3); g.setLineDash([4, 5]); g.stroke(); g.setLineDash([]);
        }
        // rim glow of the shield (a soft halo around its silhouette) and a faint inner haze
        const sr = this.Rpx * 1.02;
        gr = g.createRadialGradient(this.cx, this.cy, sr * 0.6, this.cx, this.cy, sr * 1.25);
        gr.addColorStop(0, css(beam, 0)); gr.addColorStop(0.55, css(beam, dark ? 0.05 : 0.04));
        gr.addColorStop(0.78, css(beam, dark ? 0.2 : 0.12)); gr.addColorStop(1, css(beam, 0));
        g.fillStyle = gr; g.beginPath(); g.arc(this.cx, this.cy, sr * 1.25, 0, TAU); g.fill();
        // vignette (stronger in fullscreen)
        gr = g.createRadialGradient(w / 2, hh / 2, Math.min(w, hh) * 0.35, w / 2, hh / 2, Math.max(w, hh) * 0.75);
        gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, dark ? `rgba(0,0,0,${fs ? 0.6 : 0.4})` : `rgba(20,20,40,${fs ? 0.22 : 0.12})`);
        g.fillStyle = gr; g.fillRect(0, 0, w, hh);
        // corner brackets
        if (!fs) {
            const B = 16, m = 5;
            g.strokeStyle = css(beam, 0.85); g.lineWidth = 1.5; g.lineCap = 'square';
            g.beginPath();
            g.moveTo(m, m + B); g.lineTo(m, m); g.lineTo(m + B, m);
            g.moveTo(w - m - B, m); g.lineTo(w - m, m); g.lineTo(w - m, m + B);
            g.moveTo(m, hh - m - B); g.lineTo(m, hh - m); g.lineTo(m + B, hh - m);
            g.moveTo(w - m - B, hh - m); g.lineTo(w - m, hh - m); g.lineTo(w - m, hh - m - B);
            g.stroke();
        } else {
            // frame of the whole war room
            g.strokeStyle = css(beam, 0.35); g.lineWidth = 1;
            g.strokeRect(0.5, this.L.title.y1 + 0.5, w - 1, this.L.foot.y0 - this.L.title.y1 - 1);
            g.fillStyle = css(beam, 0.08); g.fillRect(0, 0, w, this.L.title.y1); g.fillRect(0, this.L.foot.y0, w, hh - this.L.foot.y0);
            g.fillStyle = css(beam, 0.6); g.fillRect(0, this.L.title.y1 - 1, w, 1); g.fillRect(0, this.L.foot.y0, w, 1);
            const B = 22 * s, m = 1;
            g.strokeStyle = css(beam, 0.9); g.lineWidth = 2;
            g.beginPath();
            g.moveTo(m, m + B); g.lineTo(m, m); g.lineTo(m + B, m);
            g.moveTo(w - m - B, m); g.lineTo(w - m, m); g.lineTo(w - m, m + B);
            g.moveTo(m, hh - m - B); g.lineTo(m, hh - m); g.lineTo(m + B, hh - m);
            g.moveTo(w - m - B, hh - m); g.lineTo(w - m, hh - m); g.lineTo(w - m, hh - m - B);
            g.stroke();
        }
        this.bg = cv; this.bgKey = key;
        return cv;
    }

    // scanline overlay (device pixel lines every 3 CSS px)
    _scanlines() {
        const dpr = window.devicePixelRatio || 1, w = this.gw, hh = this.gh, P = this.P;
        const key = `${w}x${hh}@${dpr}|${P.dark}|${this.fs}`;
        if (this.scan && this.scanKey === key) { return this.scan; }
        const cv = this.scan || document.createElement('canvas');
        cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr);
        const g = cv.getContext('2d');
        g.clearRect(0, 0, cv.width, cv.height);
        g.fillStyle = P.dark ? `rgba(0,0,0,${this.fs ? 0.2 : 0.11})` : `rgba(20,30,60,${this.fs ? 0.06 : 0.035})`;
        const step = Math.round(3 * dpr);
        for (let y = 0; y < cv.height; y += step) { g.fillRect(0, y, cv.width, 1); }
        this.scan = cv; this.scanKey = key;
        return cv;
    }

    // panel image refreshed at most once a second (or when its size changes); painter(g, w, h, entry)
    _cached(name, x, y, w, h, now, period, painter) {
        const dpr = window.devicePixelRatio || 1;
        let e = this.caches.get(name);
        const pw = Math.ceil(w * dpr), ph = Math.ceil(h * dpr);
        if (!e) { e = { cv: document.createElement('canvas'), at: -1e9, rows: [], phase: this.caches.size * 137 }; this.caches.set(name, e); }
        if (e.cv.width !== pw || e.cv.height !== ph || now - e.at >= period) {
            if (e.cv.width !== pw || e.cv.height !== ph) { e.cv.width = pw; e.cv.height = ph; }
            const g = e.cv.getContext('2d');
            g.setTransform(dpr, 0, 0, dpr, 0, 0);
            g.clearRect(0, 0, w, h);
            e.rows = []; e.x = x; e.y = y; e.w = w; e.h = h;
            painter(g, w, h, e);
            // panels refresh out of step with each other, so one frame never repaints them all
            e.at = e.at < 0 ? now + (e.phase % 400) : now;
        }
        this.host.ctx.drawImage(e.cv, Math.round(x), Math.round(y), w, h);
        return e;
    }

    /* ------------------------------------------------------------------ statistics */

    _rates(now) {
        const cut = now - RATE_MS;
        while (this.times.length && this.times[0] < cut) { this.times.shift(); }
        while (this.blocks.length && this.blocks[0] < cut) { this.blocks.shift(); }
        if (this.uniq.size && (!this.uniqAt || now - this.uniqAt > 5000)) {
            this.uniqAt = now;
            for (const [ip, t] of this.uniq) { if (t < now - UNIQ_MS) { this.uniq.delete(ip); } }
        }
        const blk = this.blocks.length, ev = this.times.length;
        const lvl = blk < 5 ? 0 : blk < 20 ? 1 : blk < 60 ? 2 : 3;
        let burst = 0;
        for (let i = this.blocks.length - 1; i >= 0 && this.blocks[i] > now - 900; i--) { burst++; }
        return { blk, ev, uniq: this.uniq.size, lvl, heat: clamp01(blk / 60), gauge: Math.min(1, Math.sqrt(blk / 100)), burst: burst >= 3 };
    }

    _levelColor(lvl) {
        const P = this.P;
        return [P.pass, P.beam, mix([240, 160, 30], P.block, P.dark ? 0.15 : 0.3), P.block][lvl];   // low, guarded, high (amber), critical
    }

    _levelName(lvl) {
        const t = this.host.translations || {};
        return [t.low ?? 'Low', t.guarded ?? 'Guarded', t.high ?? 'High', t.critical ?? 'Critical'][lvl];
    }

    _cc(o) {
        if (o.cc !== undefined) { return o.cc; }
        const h = this.host;
        let cc = null;
        try { cc = h._country ? h._country(o.ip) : null; } catch (e) { cc = null; }
        if (cc) { o.cc = cc; } else if (h.geo) { o.cc = null; }
        return cc;
    }

    _flag(cc) { try { return this.host._flag(cc); } catch (e) { return ''; } }

    /* ------------------------------------------------------------------ drawing */

    draw(now) {
        const h = this.host, c = h.ctx, k = h.colors;
        if (!c || !k) { return; }
        if (h.w !== this.gw || h.h !== this.gh || !!h.fullscreen !== this.fs || this.scene !== this.sceneAt || (this.fs && (!!h.telemetry !== !!this.L.system || !!this._expoData() !== !!this.L.exposure))) { this.resize(); }
        this._exposure(now);
        const P = this._palette(), fs = this.fs, rm = !!h.reducedMotion, w = this.gw, hh = this.gh;
        if (fs) { this._sidePanel(true); }
        const T = this._tele(fs);
        const R = this._rates(now);
        const boot = fs && !rm ? clamp01((now - this.bootT) / BOOT_MS) : 1;
        const space = this.scene !== 'grid', dt = Math.max(0, Math.min(50, now - (this.lastNow || now)));
        this.lastNow = now;
        c.save();
        c.lineCap = 'butt'; c.lineJoin = 'bevel';
        c.clearRect(0, 0, w, hh);
        c.drawImage(this._background(), 0, 0, w, hh);
        if (space) {
            // deep space: Orion, flowing stars, comets, ships and nebula lightning (all decorative, behind the planets)
            this._space(c, now, rm, dt, boot);
            this._planetsTick(now);
        } else {
            if (boot < 1) {
                // boot: the grid switches on from the bottom up
                c.save(); c.beginPath(); c.rect(0, hh - (hh - this.hy + 4) * Math.min(1, boot * 1.6), w, hh); c.clip();
            }
            this._grid(c, now, rm, R);
            if (boot < 1) { c.restore(); }
            if (fs && !rm) { this._particles(c, now); }
        }
        if (boot > 0.3) {
            c.save();
            if (boot < 1) { c.globalAlpha = (boot - 0.3) / 0.7; }
            if (fs) { const sc = this.L.scene; c.beginPath(); c.rect(sc.x0, sc.y0, sc.x1 - sc.x0, sc.y1 - sc.y0); c.clip(); }   // trails stay out of the panels
            this._projectShield(now, rm);
            this._shock(now);
            if (space) { this._planetsUpdate(now, rm, dt); this._planetsDraw(c, now, true); }
            this._shield(c, now, 0, R);
            this._core(c, now, rm, R);
            if (!rm && !space) { this._trails(c, now); }
            this._shield(c, now, 1, R);
            if (space) { this._planetsDraw(c, now, false); if (!rm) { this._shots(c, now); } }
            if (!rm) { this._fx(c, now); }
            c.restore();
        }
        if (fs) { this._aiTick(now); this._hudFull(c, now, R, T, boot); } else { this._hud(c, now, R); }
        if (!rm) { this._glitches(c, now); }
        c.drawImage(this._scanlines(), 0, 0, w, hh);
        if (!this.total) {
            c.font = `12px ${this.font}`; c.textAlign = 'center'; c.textBaseline = 'middle';
            c.fillStyle = css(P.text, 0.6);
            c.fillText((h.translations || {}).waiting ?? 'Waiting for firewall log events…', this.vx, space ? this.cy + this.Rpx * 1.35 : this.hy + 26);
        }
        c.restore();
        this.drawn = true;
    }

    // moving horizontal grid lines (the converging lanes are in the static layer)
    _grid(c, now, rm, R) {
        const P = this.P, f = this.f, hy = this.hy, w = this.gw, hh = this.gh, H = H_CAM;
        const off = rm ? 0 : (now * SPEED) % LANE;
        const col = P.dark ? P.beam : mix(P.text, P.beam, 0.5);
        c.lineWidth = 1;
        // lines fade with distance (three bands); near ones also get a glow pass
        const bands = [[], [], []], zn = this.zNear * 0.5;
        for (let k = 1; k < 80; k++) {
            const z = k * LANE - off + zn;
            if (z <= zn) { continue; }
            const y = hy + f * H / z;
            if (y > hh + 2) { continue; }
            if (f * H * LANE / (z * z) < 2.2) { break; }
            bands[z < 6 ? 0 : z < 14 ? 1 : 2].push(Math.round(y) + 0.5);
        }
        const alpha = P.dark ? [0.42, 0.26, 0.13] : [0.42, 0.26, 0.13];
        for (let b = 2; b >= 0; b--) {
            if (!bands[b].length) { continue; }
            c.beginPath();
            for (const y of bands[b]) { c.moveTo(0, y); c.lineTo(w, y); }
            if (b === 0) { c.strokeStyle = css(col, P.dark ? 0.16 : 0.1); c.lineWidth = 3; c.stroke(); }
            c.strokeStyle = css(col, alpha[b]); c.lineWidth = 1; c.stroke();
        }
        // the shield's heat tints the horizon haze
        if (R.heat > 0.05) {
            c.fillStyle = css(P.block, 0.18 * R.heat);
            c.fillRect(0, hy - 6, w, 12);
        }
    }

    // slow drifting motes in the fullscreen scene (stateless: position is a function of time)
    _particles(c, now) {
        const P = this.P, sc = this.L.scene, sw = sc.x1 - sc.x0, sh = sc.y1 - sc.y0;
        c.fillStyle = css(P.beam, 0.5);
        for (let i = 0; i < MAX_PARTS; i++) {
            const r1 = ((i * 7919) % 1000) / 1000, r2 = ((i * 104729) % 1000) / 1000, r3 = ((i * 31) % 7) / 7;
            const y = sc.y1 - ((r2 * sh + now * (0.006 + r3 * 0.012)) % sh);
            const x = sc.x0 + r1 * sw + Math.sin(now * 0.0007 + i) * 12;
            c.globalAlpha = 0.15 + 0.35 * (0.5 + 0.5 * Math.sin(now * 0.003 + i * 2.1));
            c.fillRect(Math.round(x), Math.round(y), r3 > 0.6 ? 2 : 1, r3 > 0.6 ? 2 : 1);
        }
        c.globalAlpha = 1;
    }

    _projectShield(now, rm) {
        const rot = 0.5 + (rm ? 0 : now * 0.00012);
        const cr = Math.cos(rot), sr = Math.sin(rot);
        const f = this.f, vx = this.vx, hy = this.hy, zc = this.zc, yc = this.yc, Hs = this.Hs;
        const lat = this.lat, cen = this.cen, Pp = this.cp, C = this.cc, W = this.cw, F = this.front;
        for (let c = 0; c < NCELLS; c++) {
            for (let k = 0; k < 6; k++) {
                const o = (c * 6 + k) * 4, cs = lat[o], sn = lat[o + 1], r = lat[o + 2];
                const cph = cs * cr - sn * sr, sph = sn * cr + cs * sr;
                const z = zc + r * sph, q = (c * 6 + k) * 2;
                Pp[q] = vx + f * r * cph / z; Pp[q + 1] = hy - f * (yc + Hs * lat[o + 3]) / z;
            }
            const o = c * 4, cs = cen[o], sn = cen[o + 1], r = cen[o + 2];
            const cph = cs * cr - sn * sr, sph = sn * cr + cs * sr;
            const x = r * cph, y = yc + Hs * cen[o + 3], z = zc + r * sph;
            C[c * 3] = vx + f * x / z; C[c * 3 + 1] = hy - f * y / z; C[c * 3 + 2] = z;
            W[c * 5] = x; W[c * 5 + 1] = y; W[c * 5 + 2] = z; W[c * 5 + 3] = cph; W[c * 5 + 4] = sph;
            F[c] = (r + zc * sph) < 0 ? 1 : 0;
        }
    }

    // shock waves running through the honeycomb after an impact (distance in lattice units)
    _shock(now) {
        const S = this.shine;
        S.fill(0);
        if (!this.shocks.length) { return; }
        this.shocks = this.shocks.filter((s) => now - s.t0 < SHOCK_MS);
        for (const s of this.shocks) {
            const age = (now - s.t0) / SHOCK_MS, rr = age * 7, fade = 1 - age;
            for (let c = 0; c < NCELLS; c++) {
                const cell = this.cells[c];
                let di = Math.abs(cell.i - s.i); if (di > COLS / 2) { di = COLS - di; }
                const dj = Math.abs(cell.j - s.j), d = Math.sqrt(di * di + dj * dj * 0.75) - rr;
                const g = Math.exp(-d * d / 0.8) * fade;
                if (g > 0.02) { S[c] = Math.min(1, S[c] + g); }
            }
        }
    }

    _shield(c, now, front, R) {
        const P = this.P, Pp = this.cp, C = this.cc, F = this.front, S = this.shine, dark = P.dark, fs = this.fs;
        const wire = mix(dark ? P.beam : mix(P.text, P.beam, 0.6), P.block, R.heat * 0.35);
        const hv = this.hover && this.hover.cell ? this.hover.cell : null;
        // fills: active cells glow by weight, hot cells flash in the action color, shock waves add.
        // Cells are grouped by their (quantized) fill style so each group is a single fill call.
        const hot = [], groups = this.fillGroups || (this.fillGroups = new Map());
        for (const g of groups.values()) { g.length = 0; }
        const dim = front ? 1 : 0.35;
        for (let i = 0; i < NCELLS; i++) {
            if (F[i] !== front) { continue; }
            const cell = this.cells[i];
            let a = 0, col = null;
            if (cell.key) {
                const wgt = cell.w * Math.exp(-Math.max(0, now - cell.wt) / DECAY);
                const base = Math.min(0.3, 0.06 + 0.05 * Math.log2(1 + wgt));
                const heat = cell.heat * Math.exp(-Math.max(0, now - cell.heatT) / HEAT_MS);
                col = heat > 0.05 ? (P[cell.hk] || P.other) : (cell.c.block > cell.c.pass + cell.c.nat ? mix(P.block, wire, 0.5) : wire);
                a = base + heat * 0.7;
                if (front && (heat > 0.08 || wgt > 0.5)) { hot.push([heat * 2 + wgt, i, heat]); }
            }
            if (S[i] > 0.02) { col = col ? mix(col, P.beam, 0.5) : P.beam; a += S[i] * 0.32; }
            if (cell === hv) { col = col || P.beam; a = Math.max(a, 0.5); }
            a = Math.round(Math.min(0.9, a) * dim * 20) / 20;
            if (a <= 0) { continue; }
            const key = css(col, a);
            let g = groups.get(key);
            if (!g) { if (groups.size > 64) { groups.clear(); } g = []; groups.set(key, g); }
            g.push(i);
        }
        for (const [key, list] of groups) {
            if (!list.length) { continue; }
            c.beginPath();
            for (const i of list) {
                const o = i * 12;
                c.moveTo(Pp[o], Pp[o + 1]);
                for (let k = 1; k < 6; k++) { c.lineTo(Pp[o + k * 2], Pp[o + k * 2 + 1]); }
                c.closePath();
            }
            c.fillStyle = key; c.fill();
        }
        // wires: each cell draws its right, top-right and top-left edges; the bottom row adds its bottom ones
        c.beginPath();
        for (let i = 0; i < NCELLS; i++) {
            if (F[i] !== front) { continue; }
            const o = i * 12;
            c.moveTo(Pp[o + 10], Pp[o + 11]); c.lineTo(Pp[o], Pp[o + 1]); c.lineTo(Pp[o + 2], Pp[o + 3]); c.lineTo(Pp[o + 4], Pp[o + 5]);
            if (this.cells[i].j === 0) { c.moveTo(Pp[o + 6], Pp[o + 7]); c.lineTo(Pp[o + 8], Pp[o + 9]); c.lineTo(Pp[o + 10], Pp[o + 11]); }
        }
        if (front) {
            // (the neon halo of the shield is a static rim glow in the background layer: wide strokes are costly)
            c.strokeStyle = css(wire, dark ? 0.8 : 0.65); c.lineWidth = fs ? 1.4 : 1.1; c.stroke();
        } else {
            c.strokeStyle = css(wire, dark ? 0.22 : 0.2); c.lineWidth = 1; c.stroke();
        }
        // exposed services (host.exposure): the port's cell is outlined by severity; critical/KEV pulses
        if (this.expo && this.expo.size) {
            const pulse = this.host.reducedMotion ? 1 : 0.65 + 0.35 * Math.sin(now * 0.005);
            const fast = this.host.reducedMotion ? 1 : 0.45 + 0.55 * Math.abs(Math.sin(now * 0.011));
            for (const [port, ex] of this.expo) {
                const cell = this.byKey.get(port);
                // exposed (reachable) and under attack in the last 5 min: fast, strong pulse in the threat color
                const hit = ex.attacked && CyberView._reachable(ex.sv);
                if (!cell || F[cell.idx] !== front || (ex.sev < 1 && !hit)) { continue; }
                const sev = Math.floor(ex.sev), col = hit || sev >= 3 ? P.block : sev === 2 ? mix(P.block, P.beam, 0.45) : P.beam;
                const o = cell.idx * 12;
                c.beginPath(); c.moveTo(Pp[o], Pp[o + 1]);
                for (let q = 1; q < 6; q++) { c.lineTo(Pp[o + q * 2], Pp[o + q * 2 + 1]); }
                c.closePath();
                const a = (front ? 1 : 0.35) * (hit ? fast : sev >= 3 ? pulse : 0.85);
                c.fillStyle = css(col, (hit ? 0.45 : 0.22) * a); c.fill();
                if (dark && front) { c.strokeStyle = css(col, (hit ? 0.45 : 0.3) * a); c.lineWidth = hit ? 7 : 5; c.stroke(); }
                c.strokeStyle = css(hit && dark ? mix(col, [255, 255, 255], 0.35) : col, 0.95 * a); c.lineWidth = hit ? 2.6 : sev >= 3 ? 2 : 1.4; c.stroke();
                if (front && !hot.some((x) => x[1] === cell.idx)) { hot.push([0.4 * sev, cell.idx, 0]); }
            }
        }
        // port labels on the hottest front cells
        if (front && hot.length) {
            hot.sort((a, b) => b[0] - a[0]);
            const n = Math.min(fs ? 10 : 7, hot.length), size = fs ? Math.round(9 * this.s) : 8;
            for (let q = 0; q < n; q++) {
                const i = hot[q][1], cell = this.cells[i];
                if (!cell.key) { continue; }
                const l = this._label(cell.key.length > 5 ? cell.key.slice(0, 5) : cell.key, dark ? '#fff' : css(P.text), size);
                c.drawImage(l.cv, Math.round(C[i * 3] - l.w / 2), Math.round(C[i * 3 + 1] - l.h / 2), l.w, l.h);
            }
        }
    }

    _poly(c, M, R, Pm, col, lw, glow) {
        const pv = this.pv, f = this.f, vx = this.vx, hy = this.hy, zc = this.zc, yc = this.yc, V = Pm.v, n = Pm.n;
        for (let i = 0; i < n; i++) {
            const x = V[i * 3], y = V[i * 3 + 1], z = V[i * 3 + 2];
            const rx = (M[0] * x + M[1] * y + M[2] * z) * R, ry = (M[3] * x + M[4] * y + M[5] * z) * R, rz = (M[6] * x + M[7] * y + M[8] * z) * R;
            const wz = zc + rz;
            pv[i * 3] = vx + f * rx / wz; pv[i * 3 + 1] = hy - f * (yc + ry) / wz; pv[i * 3 + 2] = rz;
        }
        const E = Pm.e;
        for (let side = 0; side < 2; side++) {
            c.beginPath();
            for (let e = 0; e < E.length; e += 2) {
                const a = E[e], b = E[e + 1], back = (pv[a * 3 + 2] + pv[b * 3 + 2]) > 0 ? 1 : 0;
                if (back !== side) { continue; }
                c.moveTo(pv[a * 3], pv[a * 3 + 1]); c.lineTo(pv[b * 3], pv[b * 3 + 1]);
            }
            if (side === 1) { c.strokeStyle = css(col, 0.3); c.lineWidth = lw * 0.8; c.stroke(); }
            else {
                if (glow) { c.strokeStyle = css(col, 0.22); c.lineWidth = lw * 3.5; c.stroke(); }
                c.strokeStyle = css(this.P.dark ? mix(col, [255, 255, 255], 0.35) : col, 0.95); c.lineWidth = lw; c.stroke();
            }
        }
    }

    _core(c, now, rm, R) {
        const P = this.P, dark = P.dark, cx = this.cx, cy = this.cy, Rpx = this.Rpx, t = rm ? 900 : now;
        const pulse = Math.exp(-Math.max(0, now - this.corePulse) / 500);
        const accent = mix(P.beam, P.block, Math.round(R.heat * 8) / 16);   // quantized: one cached glow per step
        c.save();
        if (dark) { c.globalCompositeOperation = 'lighter'; }
        c.globalAlpha = (dark ? 0.55 : 0.45) + 0.4 * pulse;
        this._put(c, this._sprite(css(accent), Rpx * this.Rc * 3.6), cx, cy, pulse > 0.03 ? 1 + 0.12 * pulse : 1);
        c.globalAlpha = 1;
        // rings emitted by passed connections
        if (this.rings.length) {
            this.rings = this.rings.filter((r) => now - r.t0 < 650);
            for (const r of this.rings) {
                const u = (now - r.t0) / 650, rad = Rpx * (this.Rc + (1.25 - this.Rc) * u);
                c.beginPath(); c.ellipse(cx, cy, rad, rad * 0.92, 0, 0, TAU);
                c.strokeStyle = this.host._withAlpha(r.col, 0.8 * (1 - u)); c.lineWidth = 1.5 + 2 * (1 - u); c.stroke();
            }
        }
        rotM(t * 0.00031, t * 0.00047, this.M1);
        rotM(-t * 0.0002, -t * 0.00058, this.M2);
        this._poly(c, this.M2, this.Rc * 0.58, DOD, mix(accent, P.text, 0.3), 0.8, false);
        this._poly(c, this.M1, this.Rc * (1 + 0.06 * pulse), ICO, accent, 1.3, dark);
        // vertices of the outer shell
        c.fillStyle = dark ? '#fff' : css(accent);
        for (let i = 0; i < ICO.n; i++) { if (this.pv[i * 3 + 2] < 0) { c.fillRect(Math.round(this.pv[i * 3]) - 1, Math.round(this.pv[i * 3 + 1]) - 1, 2, 2); } }
        c.restore();
    }

    // control points of a trail (cubic bezier in world space); the cell end follows the shield's rotation
    _controls(tr, o) {
        const W = this.cw, i = tr.cell.idx * 5;
        const cxw = W[i], cyw = W[i + 1], czw = W[i + 2], nx = W[i + 3], nz = W[i + 4];
        // far end: on the ground just under the horizon, fanned across the whole width
        const fan = tr.fan, side = fan < 0 ? -1 : 1, zc = this.zc, yc = this.yc, H = H_CAM;
        const z0 = this.f * H / 4, x0 = fan * this.gw * 0.62 * z0 / this.f, xn = fan * 2.2;
        if (tr.inbound) {
            o[0] = x0; o[1] = -H; o[2] = z0;
            if (tr.act === 'nat') {
                o[3] = side * 3.2; o[4] = -H * 0.6; o[5] = zc + 1.6;
                o[6] = cxw + nx * 1.8; o[7] = cyw + 0.3; o[8] = czw + nz * 1.8;
                o[9] = 0; o[10] = yc; o[11] = zc;
            } else {
                o[3] = xn; o[4] = -H + 0.05; o[5] = zc + 2.6;
                o[6] = cxw + nx * 1.0; o[7] = cyw - 0.2; o[8] = czw + nz * 1.0;
                if (tr.act === 'block') { o[9] = cxw; o[10] = cyw; o[11] = czw; } else { o[9] = 0; o[10] = yc; o[11] = zc; }
            }
        } else if (tr.act === 'block') {
            o[0] = 0; o[1] = yc; o[2] = zc;
            o[3] = cxw * 0.35; o[4] = yc + (cyw - yc) * 0.35; o[5] = zc + (czw - zc) * 0.35;
            o[6] = cxw - nx * 0.3; o[7] = cyw; o[8] = czw - nz * 0.3;
            o[9] = cxw; o[10] = cyw; o[11] = czw;
        } else {
            o[0] = 0; o[1] = yc; o[2] = zc;
            o[3] = cxw + nx * 1.3; o[4] = cyw - 0.2; o[5] = czw + nz * 1.3;
            o[6] = xn; o[7] = -H + 0.05; o[8] = zc + 2.6;
            o[9] = x0; o[10] = -H; o[11] = z0;
        }
    }

    _trails(c, now) {
        if (!this.trails.length) { return; }
        const P = this.P, dark = P.dark, f = this.f, vx = this.vx, hy = this.hy, o = this.ctl || (this.ctl = new Float64Array(12));
        const keep = [], byCol = { pass: [], block: [], nat: [], other: [] };
        for (const tr of this.trails) {
            const age = now - tr.t0;
            if (age < 0) { keep.push(tr); continue; }
            const u = age / tr.dur;
            if (u >= 1) { this._arrive(tr, now); continue; }
            this._controls(tr, o);
            const pts = tr.pts;
            for (let s = 0; s < SAMPLES; s++) {
                let v = u - s * 0.055;
                if (v < 0) { v = 0; }
                const e = tr.inbound ? Math.pow(v, 0.72) : 1 - Math.pow(1 - v, 1.35);
                const a = (1 - e) * (1 - e) * (1 - e), b = 3 * (1 - e) * (1 - e) * e, d = 3 * (1 - e) * e * e, g = e * e * e;
                const x = a * o[0] + b * o[3] + d * o[6] + g * o[9], y = a * o[1] + b * o[4] + d * o[7] + g * o[10], z = a * o[2] + b * o[5] + d * o[8] + g * o[11];
                const zz = Math.max(0.2, z);
                pts[s * 2] = vx + f * x / zz; pts[s * 2 + 1] = hy - f * y / zz;
            }
            // passing through the port's cell lights it (passed / NAT: inbound at the end, outbound at the start)
            if (!tr.passed && tr.act !== 'block' && (tr.inbound ? u > 0.86 : u > 0.22)) { tr.passed = true; this._heat(tr.cell, tr.act, now, 0.45); }
            tr.on = true;
            keep.push(tr);
            byCol[tr.act].push(tr);
        }
        this.trails = keep;
        const hv = this.hover && this.hover.trail;
        c.save();
        if (dark) { c.globalCompositeOperation = 'lighter'; }
        for (const act in byCol) {
            const list = byCol[act];
            if (!list.length) { continue; }
            const col = this._color(act), str = P.tr[act];
            for (let s = 0; s < SAMPLES - 1; s++) {
                c.beginPath();
                for (const tr of list) { const p = tr.pts; c.moveTo(p[s * 2], p[s * 2 + 1]); c.lineTo(p[s * 2 + 2], p[s * 2 + 3]); }
                if (dark && s === 0) { c.strokeStyle = str.glow[0]; c.lineWidth = 6; c.stroke(); }
                c.strokeStyle = str.line[s]; c.lineWidth = dark ? 1.6 : 2; c.stroke();
            }
            const sp = this._sprite(col, act === 'block' ? 15 : 12, dark);
            for (const tr of list) { this._put(c, sp, tr.pts[0], tr.pts[1], tr === hv ? 1.6 : 1); }
        }
        c.restore();
    }

    _arrive(tr, now) {
        const cell = tr.cell, idx = cell.idx;
        if (tr.act === 'block') {
            this._heat(cell, 'block', now, 1);
            const n = tr.inbound ? 10 : 5, sh = new Float32Array(n * 4);
            for (let i = 0; i < n; i++) { sh[i * 4] = Math.random() * TAU; sh[i * 4 + 1] = 40 + Math.random() * 90; sh[i * 4 + 2] = 3 + Math.random() * 7; sh[i * 4 + 3] = (Math.random() - 0.5) * 2; }
            this.fx.push({ c: idx, t0: now, dur: tr.inbound ? 720 : 500, big: tr.inbound, sh, gl: tr.inbound ? 3 : 0 });
            if (this.fx.length > MAX_FX) { this.fx.shift(); }
            if (tr.inbound) {
                this.shocks.push({ i: cell.i, j: cell.j, t0: now });
                if (this.shocks.length > MAX_SHOCKS) { this.shocks.shift(); }
            }
        } else if (tr.inbound) {
            this.corePulse = now;
            this.rings.push({ t0: now, col: this._color(tr.act) });
            if (this.rings.length > MAX_RINGS) { this.rings.shift(); }
        }
        if (this.hover && this.hover.trail === tr) { this.hover = null; }
    }

    _fx(c, now) {
        if (!this.fx.length) { return; }
        const P = this.P, dark = P.dark, C = this.cc, fs = this.fs, s = this.s;
        this.fx = this.fx.filter((f) => now - f.t0 < f.dur);
        c.save();
        if (dark) { c.globalCompositeOperation = 'lighter'; }
        for (const f of this.fx) {
            const age = now - f.t0, p = age / f.dur, q = 1 - p, x = f.px !== undefined ? f.px : C[f.c * 3], y = f.px !== undefined ? f.py : C[f.c * 3 + 1];
            // flash
            const d = (f.big ? 26 : 16) * (fs ? s : 1) * (1 + 1.6 * Math.min(1, p * 3));
            c.globalAlpha = q * q;
            this._put(c, this._sprite(P.col.block, d, true), x, y);
            if (fs && f.big && dark) { c.globalAlpha = 0.45 * q; this._put(c, this._sprite(P.col.block, 120 * s), x, y); }
            // shards
            c.globalAlpha = Math.min(1, q * 1.4);
            c.strokeStyle = dark ? css(mix(P.block, [255, 255, 255], 0.5)) : P.col.block;
            c.lineWidth = 1.2;
            c.beginPath();
            const sh = f.sh, t = age / 1000, k = 1 - 0.45 * p;
            for (let i = 0; i < sh.length; i += 4) {
                const a = sh[i] + sh[i + 3] * t, v = sh[i + 1] * (fs ? s : 1), dist = v * t * k, len = sh[i + 2] * (fs ? s : 1);
                const ca = Math.cos(a), sa = Math.sin(a);
                c.moveTo(x + ca * dist, y + sa * dist + 60 * t * t); c.lineTo(x + ca * (dist + len), y + sa * (dist + len) + 60 * t * t);
            }
            c.stroke();
            // cracks on the cell for the first instant
            if (p < 0.5) {
                c.globalAlpha = (0.5 - p) * 2;
                c.strokeStyle = dark ? 'rgba(255,255,255,0.9)' : P.col.block; c.lineWidth = 1;
                c.beginPath();
                for (let i = 0; i < 5; i++) {
                    const a = (i / 5) * TAU + sh[i * 4] * 0.1, r = 6 + sh[i * 4 + 2] * 1.5;
                    c.moveTo(x, y); c.lineTo(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5 + 2); c.lineTo(x + Math.cos(a + 0.4) * r, y + Math.sin(a + 0.4) * r);
                }
                c.stroke();
            }
        }
        c.restore();
    }

    // glitch: a few frames of sliced jitter (and RGB split on dark themes) around fresh impacts
    _glitches(c, now) {
        const P = this.P, C = this.cc, dpr = window.devicePixelRatio || 1, s = this.fs ? this.s : 1;
        const W = this.gw, Hh = this.gh;
        for (const f of this.fx) {
            if (f.gl <= 0 || now - f.t0 > 170) { continue; }
            f.gl--;
            const rw = Math.round(110 * s), rh = Math.round(60 * s);
            const fx0 = f.px !== undefined ? f.px : C[f.c * 3], fy0 = f.px !== undefined ? f.py : C[f.c * 3 + 1];
            const x0 = Math.max(0, Math.min(W - rw, Math.round(fx0 - rw / 2))), y0 = Math.max(0, Math.min(Hh - rh, Math.round(fy0 - rh / 2)));
            if (rw <= 0 || rh <= 0) { continue; }
            const src = c.canvas;
            if (P.dark) {
                // RGB split through a scratch canvas: red copy to the left, cyan copy to the right
                const tc = this.tmp || (this.tmp = document.createElement('canvas'));
                const tw = Math.round(rw * dpr), th = Math.round(rh * dpr);
                if (tc.width !== tw || tc.height !== th) { tc.width = tw; tc.height = th; }
                const g = tc.getContext('2d');
                for (let ch = 0; ch < 2; ch++) {
                    g.globalCompositeOperation = 'copy';
                    g.drawImage(src, x0 * dpr, y0 * dpr, tw, th, 0, 0, tw, th);
                    g.globalCompositeOperation = 'multiply';
                    g.fillStyle = ch ? '#00ffff' : '#ff0000'; g.fillRect(0, 0, tw, th);
                    c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.55;
                    c.drawImage(tc, 0, 0, tw, th, x0 + (ch ? 4 : -4) * s, y0, rw, rh);
                    c.restore();
                }
            }
            // sliced jitter
            const slices = 3, sh = Math.floor(rh / slices);
            for (let i = 0; i < slices; i++) {
                const shift = Math.round(((((f.t0 * 7 + i * 131 + f.gl * 17) % 23) / 23) - 0.5) * 14 * s);
                if (!shift) { continue; }
                const sy = y0 + i * sh;
                c.drawImage(src, x0 * dpr, sy * dpr, rw * dpr, sh * dpr, x0 + shift, sy, rw, sh);
            }
        }
    }

    /* ------------------------------------------------------------------ deep space scene */

    // IPv4 private/reserved (the host's own test when it has one), IPv6 link-local / ULA / loopback
    _priv(ip) {
        const h = this.host;
        if (ip.indexOf(':') >= 0) { return /^(fe[89ab]|f[cd]|::1$|::$)/i.test(ip); }
        try { if (h._ip4 && h._isPrivate) { const v = h._ip4(ip); return v === null ? true : h._isPrivate(v); } } catch (e) { /* own test below */ }
        const p = ip.split('.').map(Number);
        if (p.length !== 4) { return true; }
        return p[0] === 10 || p[0] === 127 || p[0] === 0 || p[0] >= 224 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
            (p[0] === 192 && p[1] === 168) || (p[0] === 169 && p[1] === 254) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
    }

    // per remote host: counts in the recent window (reset after 5 min of silence) and a decaying weight
    _hostAdd(ip, act, inbound, t, port, proto) {
        let r = this.hostStats.get(ip);
        if (r) {
            this.hostStats.delete(ip);            // re-insert: the map stays in least-recently-seen order
            if (t - r.t > UNIQ_MS) { r.n = 0; r.blk = 0; r.pas = 0; r.out = 0; r.inb = 0; r.w = 0; }
        } else {
            if (this.hostStats.size >= 400) { this.hostStats.delete(this.hostStats.keys().next().value); }
            r = { ip, n: 0, blk: 0, pas: 0, out: 0, inb: 0, w: 0, t, sc: 0, priv: this._priv(ip), cc: undefined, port: '', proto: '' };
        }
        this.hostStats.set(ip, r);
        r.w = (t >= r.t ? r.w * Math.exp(-(t - r.t) / DECAY_H) : r.w) + 1;
        r.t = Math.max(r.t, t); r.n++; r.port = port; r.proto = proto;
        if (inbound) { r.inb++; } else if (act !== 'block') { r.out++; }
        if (act === 'block') { r.blk++; } else if (inbound) { r.pas++; }
    }

    _pkind(r) {
        if (r.priv) { return 0; }
        const all = r.blk + r.pas + r.out, q = all ? r.blk / all : 0;
        return q >= 0.6 ? 3 : q >= 0.25 ? 2 : 1;
    }

    // once a second: the most active hosts of the last 5 min become planets (LAN inside, internet outside)
    _planetsTick(now) {
        if (now - this.planetsAt < 1000) { return; }
        this.planetsAt = now;
        const fs = this.fs, short = this.gh < 640;
        const nL = fs ? (short ? 3 : 4) : 3, nI = fs ? (short ? 6 : 8) : 5;
        const L = this.candL, I = this.candI, cut = now - UNIQ_MS;
        L.length = 0; I.length = 0;
        for (const r of this.hostStats.values()) {
            if (r.t < cut) { continue; }
            // hysteresis: a host that is already a planet keeps its place unless clearly overtaken
            r.sc = r.w * Math.exp(-Math.max(0, now - r.t) / DECAY_H) * (this.planetBy.has(r.ip) ? 1.35 : 1);
            (r.priv ? L : I).push(r);
        }
        L.sort(byScore); I.sort(byScore);
        if (L.length > nL) { L.length = nL; }
        if (I.length > nI) { I.length = nI; }
        for (const p of this.planets) {
            p.alive = false;
            if (p.rec && !p.rec.priv && p.rec.cc === undefined) { p.lblT = ''; }   // the country may be known now
        }
        for (let q = 0; q < 2; q++) {
            const list = q ? I : L, slots = q ? this.slotI : this.slotL, ns = q ? nI : nL;
            for (const r of list) {
                let p = this.planetBy.get(r.ip);
                if (p) { p.alive = true; p.rec = r; continue; }
                let k = -1;
                for (let i = 0; i < ns; i++) { if (!slots[i]) { k = i; break; } }
                if (k < 0) { continue; }                     // every ring is taken (some still fading out)
                slots[k] = 1;
                p = this.planetFree.pop() || { lbl: null, lblT: '', lblP: '' };
                const hs = fnv(r.ip);
                const rad = q ? 2.05 + k * (this.OS - 2.05) / Math.max(1, nI - 1) : 1.42 + k * 0.17;
                p.rec = r; p.ip = r.ip; p.lan = !q; p.slot = k; p.alive = true; p.a = this.host.reducedMotion ? 1 : 0;
                p.r = rad; p.th0 = (hs / 4294967296) * TAU; p.om = 0.00011 / Math.pow(rad, 1.5);
                p.inc = (((hs >>> 8) % 1000) / 1000 - 0.5) * 0.3; p.var = (hs >>> 4) % 3;
                p.rad = 0.06; p.kind = this._pkind(r); p.flash = -1e9; p.fcol = 'pass';
                p.wx = 0; p.wy = 0; p.wz = this.zc; p.sx = -1e4; p.sy = -1e4; p.sr = 0; p.lblT = '';
                this.planets.push(p); this.planetBy.set(r.ip, p);
            }
        }
    }

    // fade, size, kind and orbit position of every planet; the draw order (far first) goes to pOrd
    _planetsUpdate(now, rm, dt) {
        const T = rm ? 900 : now, f = this.f, vx = this.vx, hy = this.hy, zc = this.zc, yc = this.yc, ps = this.planets;
        for (let i = ps.length - 1; i >= 0; i--) {
            const p = ps[i];
            if (rm) { p.a = p.alive ? 1 : 0; } else { p.a = clamp01(p.a + (p.alive ? dt : -dt) / PLANET_FADE); }
            if (!p.alive && p.a <= 0) {
                (p.lan ? this.slotL : this.slotI)[p.slot] = 0;
                this.planetBy.delete(p.ip);
                ps[i] = ps[ps.length - 1]; ps.length--;
                if (this.hover && this.hover.planet === p) { this.hover = null; }
                p.rec = null;
                if (this.planetFree.length < 24) { this.planetFree.push(p); }
                continue;
            }
            const r = p.rec, want = Math.min(0.14, (p.lan ? 0.04 : 0.045) + 0.02 * Math.log2(1 + r.n));
            p.rad += (want - p.rad) * (rm ? 1 : Math.min(1, dt / 600));
            p.kind = this._pkind(r);
            const th = p.th0 + p.om * T, X = p.r * Math.cos(th), D = p.r * Math.sin(th);
            const Y = yc + D * 0.3 + X * p.inc, Z = zc + D * 0.6;
            p.wx = X; p.wy = Y; p.wz = Z;
            const e = 1 - (1 - p.a) * (1 - p.a);
            p.sx = vx + f * X / Z; p.sy = hy - f * Y / Z; p.sr = Math.max(2.5, f * p.rad / Z) * (0.35 + 0.65 * e);
        }
        const o = this.pOrd;
        o.length = 0;
        for (const p of ps) { o.push(p); }
        o.sort(byDepth);
    }

    _pcolor(kind, v) {
        const P = this.P;
        if (kind === 0) { return mix(P.nat, [[70, 150, 255], [60, 200, 175], [120, 130, 245]][v], 0.55); }
        if (kind === 1) { return mix(P.pass, P.beam, 0.35); }
        if (kind === 2) { return mix([240, 150, 40], P.block, 0.25); }
        return mix(P.block, [255, 90, 60], 0.2);
    }

    // a planet image (lit from the left, i.e. the side turned to the core once rotated); 4 resolutions
    _planetSprite(kind, v, d) {
        const dpr = window.devicePixelRatio || 1, need = d * PSPR * dpr;
        const b = need <= 28 ? 0 : need <= 56 ? 1 : need <= 112 ? 2 : 3, idx = (kind * 3 + v) * 4 + b;
        if (this.pSprKey !== this.pKey) { this.pSpr.fill(null); this.pSprKey = this.pKey; }
        let cv = this.pSpr[idx];
        if (cv) { return cv; }
        const S = [28, 56, 112, 224][b], R = S / (2 * PSPR), c0 = S / 2, P = this.P, base = this._pcolor(kind, v);
        cv = document.createElement('canvas'); cv.width = cv.height = S;
        const g = cv.getContext('2d');
        // atmosphere
        let gr = g.createRadialGradient(c0, c0, R * 0.85, c0, c0, R * 1.75);
        gr.addColorStop(0, css(base, P.dark ? 0.32 : 0.22)); gr.addColorStop(0.35, css(base, P.dark ? 0.1 : 0.07)); gr.addColorStop(1, css(base, 0));
        g.fillStyle = gr; g.beginPath(); g.arc(c0, c0, R * 1.75, 0, TAU); g.fill();
        // body
        gr = g.createRadialGradient(c0 - R * 0.45, c0 - R * 0.2, R * 0.05, c0 - R * 0.1, c0, R * 1.12);
        gr.addColorStop(0, css(mix(base, [255, 255, 255], 0.55))); gr.addColorStop(0.35, css(base));
        gr.addColorStop(0.8, css(mix(base, [0, 0, 0], 0.62))); gr.addColorStop(1, css(mix(base, [0, 0, 0], 0.85)));
        g.fillStyle = gr; g.beginPath(); g.arc(c0, c0, R, 0, TAU); g.fill();
        // surface: bands, craters or a storm
        g.save(); g.beginPath(); g.arc(c0, c0, R, 0, TAU); g.clip();
        const rnd = mulberry(kind * 31 + v * 7 + 1);
        if (v === 0) {
            for (let i = 0; i < 5; i++) {
                g.fillStyle = css(i & 1 ? mix(base, [255, 255, 255], 0.4) : mix(base, [0, 0, 0], 0.4), 0.22);
                g.fillRect(c0 - R, c0 + (i - 2.5) * R * 0.38 + rnd() * R * 0.1, 2 * R, R * (0.1 + rnd() * 0.12));
            }
        } else if (v === 1) {
            for (let i = 0; i < 7; i++) {
                const x = c0 + (rnd() - 0.5) * R * 1.5, y = c0 + (rnd() - 0.5) * R * 1.5, rr = R * (0.08 + rnd() * 0.16);
                g.fillStyle = css(mix(base, [0, 0, 0], 0.5), 0.3); g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
                g.strokeStyle = css(mix(base, [255, 255, 255], 0.5), 0.25); g.lineWidth = Math.max(0.5, R * 0.03); g.stroke();
            }
        } else {
            g.fillStyle = css(mix(base, [255, 255, 255], 0.35), 0.18); g.fillRect(c0 - R, c0 - R * 0.35, 2 * R, R * 0.14);
            g.fillStyle = css(mix(base, [0, 0, 0], 0.3), 0.2); g.fillRect(c0 - R, c0 + R * 0.25, 2 * R, R * 0.2);
            g.fillStyle = css(mix(base, [255, 255, 255], 0.5), 0.35); g.beginPath(); g.ellipse(c0 - R * 0.2, c0 + R * 0.05, R * 0.24, R * 0.12, 0, 0, TAU); g.fill();
        }
        // night side
        gr = g.createLinearGradient(c0 - R, 0, c0 + R, 0);
        gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${P.dark ? 0.6 : 0.4})`);
        g.fillStyle = gr; g.fillRect(c0 - R, c0 - R, 2 * R, 2 * R);
        g.restore();
        // rim light on the lit side
        g.beginPath(); g.arc(c0, c0, R * 0.97, Math.PI * 0.62, Math.PI * 1.38);
        g.strokeStyle = css(mix(base, [255, 255, 255], 0.6), 0.75); g.lineWidth = Math.max(0.6, R * 0.07); g.stroke();
        this.pSpr[idx] = cv;
        return cv;
    }

    // cached sprites of the space layer (rebuilt with the palette or the device pixel ratio)
    _spaceSprites() {
        const dpr = window.devicePixelRatio || 1;
        if (this.spr && this.sprKey === this.pKey && this.sprDpr === dpr) { return this.spr; }
        const P = this.P, ok = mix(P.pass, P.beam, 0.35);
        this.spr = { okc: css(ok), ok: this._sprite(css(ok), 16, false), okHot: this._sprite(css(ok), 10, P.dark),
            miss: this._sprite(P.col.block, 15, P.dark), beam: this._sprite(css(P.beam), 10, false),
            red: this._sprite(P.col.block, 24, false), bolt: this._sprite('rgb(190,170,255)', 60, false),
            line: TRAIL_A.map((x) => css(ok, x * 0.8)), laser: css(P.beam, P.dark ? 0.2 : 0.3), beamc: css(P.beam),
            ring: css(P.beam, 0.6), dock: css(ok, 0.85), okTri: css(mix(ok, [255, 255, 255], P.dark ? 0.55 : 0.1)),
            flash: { pass: this._sprite(P.col.pass, 24, false), nat: this._sprite(P.col.nat, 24, false), other: this._sprite(P.col.other, 24, false),
                block: this._sprite(P.col.block, 24, false), beam: this._sprite(css(P.beam), 24, false) },
            // planet rings: [back, front] stroke per kind and variant
            rings: PKINDS.flatMap((_, k) => [0, 1, 2].map((v) => [css(this._pcolor(k, v), 0.35), css(this._pcolor(k, v), 0.6)])) };
        this.sprKey = this.pKey; this.sprDpr = dpr;
        return this.spr;
    }

    _planetsDraw(c, now, back) {
        const o = this.pOrd;
        if (!o.length) { return; }
        const P = this.P, dark = P.dark, zc = this.zc, cx = this.cx, cy = this.cy, hv = this.hover && this.hover.planet, sp = this._spaceSprites();
        for (const p of o) {
            if ((p.wz > zc) !== back || p.a <= 0) { continue; }
            const sr = p.sr, d = sr * 2 * PSPR, ring = p.var === 2 && !p.lan && sr > 6;
            c.globalAlpha = p.a * (back ? 0.88 : 1);
            if (ring) {
                c.beginPath(); c.ellipse(p.sx, p.sy, sr * 1.8, sr * 0.5, -0.35, Math.PI, TAU);
                c.strokeStyle = sp.rings[p.kind * 3 + p.var][0]; c.lineWidth = Math.max(1, sr * 0.14); c.stroke();
            }
            c.save();
            c.translate(p.sx, p.sy); c.rotate(Math.atan2(cy - p.sy, cx - p.sx) - Math.PI);
            c.drawImage(this._planetSprite(p.kind, p.var, sr), -d / 2, -d / 2, d, d);
            c.restore();
            if (ring) {
                c.beginPath(); c.ellipse(p.sx, p.sy, sr * 1.8, sr * 0.5, -0.35, 0, Math.PI);
                c.strokeStyle = sp.rings[p.kind * 3 + p.var][1]; c.lineWidth = Math.max(1, sr * 0.14); c.stroke();
            }
            // launch / arrival flash
            const fl = now - p.flash;
            if (fl >= 0 && fl < 450) {
                c.save(); if (dark) { c.globalCompositeOperation = 'lighter'; }
                c.globalAlpha = p.a * (1 - fl / 450);
                this._put(c, sp.flash[p.fcol] || sp.flash.other, p.sx, p.sy, Math.max(1, sr / 6));
                c.restore();
            }
            if (p === hv) {
                c.globalAlpha = 1; c.beginPath(); c.arc(p.sx, p.sy, sr + 4, 0, TAU);
                c.strokeStyle = css(P.beam, 0.9); c.lineWidth = 1.2; c.stroke();
            }
        }
        c.globalAlpha = 1;
        if (!back) { this._planetLabels(c); }
    }

    // short labels (flag + country, else the address) under the planets that have room; nearest first
    _planetLabels(c) {
        const o = this.pOrd, R = this.lblR, P = this.P, size = this.fs ? Math.max(10, Math.round(10 * this.s)) : 9, min = this.fs ? 4.5 : 5;
        let n = 0;
        for (let i = o.length - 1; i >= 0; i--) {
            const p = o[i];
            if (p.a < 0.6 || p.sr < min || !p.rec) { continue; }
            if (p.lblP !== this.pKey || !p.lblT) {
                const r = p.rec, cc = r.priv ? null : this._cc(r);
                const txt = cc ? `${this._flag(cc)} ${cc}` : (r.ip.length > 15 ? '…' + r.ip.slice(-14) : r.ip);
                if (txt !== p.lblT || p.lblP !== this.pKey) { p.lblT = txt; p.lblP = this.pKey; p.lbl = this._label(txt, P.dark ? 'rgba(235,240,250,0.9)' : css(P.text, 0.9), size); }
            }
            const l = p.lbl, x0 = p.sx - l.w / 2, y0 = p.sy + p.sr * 1.15 + 2, x1 = x0 + l.w, y1 = y0 + l.h;
            let clash = false;
            for (let k = 0; k < n; k++) { if (x0 < R[k * 4 + 2] && x1 > R[k * 4] && y0 < R[k * 4 + 3] && y1 > R[k * 4 + 1]) { clash = true; break; } }
            if (clash) { continue; }
            if (n < 12) { R[n * 4] = x0; R[n * 4 + 1] = y0; R[n * 4 + 2] = x1; R[n * 4 + 3] = y1; n++; }
            c.globalAlpha = Math.min(1, (p.a - 0.6) / 0.3);
            c.drawImage(l.cv, Math.round(x0), Math.round(y0), l.w, l.h);
        }
        c.globalAlpha = 1;
    }

    _planetHtml(r, t, k, mono) {
        const cc = r.priv ? null : this._cc(r);
        return this._ipHtml(r.ip, r.inb >= r.out, r.blk > r.pas ? 'block' : 'pass', r.port, r.proto, '', cc, r.n, t, k, mono) +
            `<span style="color:${k.block}">${esc(t.blocked ?? 'blocked')}: ${r.blk}</span> · <span style="color:${k.pass}">${esc(t.passed ?? 'passed')}: ${r.pas}</span>` +
            ` · ${esc(t.outbound ?? 'Outbound')}: ${r.out}<br>` +
            `<span style="opacity:.7">${esc(r.priv ? (t.lanhost ?? 'Local host') : (t.nethost ?? 'Internet host'))} · ${esc(t.last5 ?? 'last 5 min')}</span><br>`;
    }

    /* projectiles: inbound from the host's planet (or from deep space) to the core, outbound from the core to it */

    _shotNew(ip, inbound, act, port, key, cell, t0, fan, ev, proto) {
        const tr = this.shotFree.pop() || { pts: new Float32Array(SAMPLES * 2) };
        tr.space = true; tr.ip = ip; tr.inbound = inbound; tr.act = act; tr.port = port; tr.key = key; tr.cell = cell; tr.t0 = t0;
        tr.dur = act === 'block' ? (inbound ? 1500 : 650) : (inbound ? 2300 : 1700);
        tr.fan = fan; tr.cc = undefined; tr.label = String(ev.label || ''); tr.proto = proto; tr.iface = String(ev.iface || '');
        tr.on = false; tr.passed = false; tr.useCell = -1; tr.ea = (fnv(ip) / 4294967296) * TAU;
        return tr;
    }

    _shotFree(tr) {
        if (tr && tr.space && this.shotFree.length < MAX_FREE) { tr.cell = null; this.shotFree.push(tr); }
    }

    // world path of a shot: o = [S, C, E] (quadratic bezier)
    _shotPath(tr, o) {
        const zc = this.zc, yc = this.yc, p = this.planetBy.get(tr.ip);
        let hx, hy, hz;                                             // the host end
        if (p && p.a > 0.25) { hx = p.wx; hy = p.wy; hz = p.wz; }
        else {
            // deep space: far behind the core, towards the edge of the scene (direction = hash of the address)
            const zf = zc + 14, sc = this.L.scene, kx = (sc.x1 - sc.x0) * 0.55 * zf / this.f, ky = (sc.y1 - sc.y0) * 0.5 * zf / this.f;
            hx = Math.cos(tr.ea) * kx; hy = yc + Math.sin(tr.ea) * ky; hz = zf;
        }
        // direction core -> host, pushed to the camera's hemisphere so the impact / docking point is visible
        let dx = hx, dy = hy - yc, dz = hz - zc, l = Math.hypot(dx, dy, dz) || 1;
        dx /= l; dy /= l; dz /= l;
        if (dz > -0.45) { dz = -0.45; l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l; }
        let sx, sy, sz, ex, ey, ez;
        if (tr.inbound) {
            sx = hx; sy = hy; sz = hz;
            if (tr.act === 'block' && tr.useCell === 1) { const W = this.cw, i = tr.cell.idx * 5; ex = W[i]; ey = W[i + 1]; ez = W[i + 2]; }
            else { const R = tr.act === 'block' ? 1.03 : 1.0; ex = dx * R; ey = yc + dy * R; ez = zc + dz * R; }
        } else if (tr.act === 'block') {
            sx = 0; sy = yc; sz = zc; ex = dx * 1.03; ey = yc + dy * 1.03; ez = zc + dz * 1.03;
        } else {
            sx = dx; sy = yc + dy; sz = zc + dz; ex = hx; ey = hy; ez = hz;
        }
        // control point: the middle, pushed sideways (welcome ships arc wide, missiles fly almost straight)
        const k = tr.act === 'block' ? 0.12 : tr.inbound ? 0.38 : 0.16;
        const mx = (sx + ex) / 2, my = (sy + ey) / 2, mz = (sz + ez) / 2, px = -(ey - sy), py = ex - sx, pl = Math.hypot(px, py) || 1;
        const off = Math.hypot(ex - sx, ey - sy, ez - sz) * k * (tr.fan < 0 ? -1 : 1) * (0.5 + Math.abs(tr.fan) * 0.5);
        o[0] = sx; o[1] = sy; o[2] = sz; o[3] = mx + px / pl * off; o[4] = my + py / pl * off; o[5] = mz - 0.3; o[6] = ex; o[7] = ey; o[8] = ez;
    }

    _shots(c, now) {
        const tl = this.trails, P = this.P, dark = P.dark, f = this.f, vx = this.vx, hy = this.hy, o = this.so, F = this.front;
        const M = this.lsM, S = this.lsS, O = this.lsO;
        M.length = 0; S.length = 0; O.length = 0;
        let n = 0;
        for (let i = 0; i < tl.length; i++) {
            const tr = tl[i], age = now - tr.t0;
            if (age < 0) { tl[n++] = tr; continue; }
            if (!tr.space) { continue; }                           // a grid trail left over from a scene switch
            if (tr.useCell < 0) { tr.useCell = tr.act === 'block' && tr.inbound && F[tr.cell.idx] ? 1 : 0; }
            this._shotPath(tr, o);
            const u = age / tr.dur;
            if (u >= 1) { this._arriveSpace(tr, now, o); this._shotFree(tr); continue; }
            if (!tr.on) {
                tr.on = true;
                const p = tr.inbound ? this.planetBy.get(tr.ip) : null;
                if (p) { p.flash = now; p.fcol = tr.act; }        // the host fires
            }
            // samples along the path: missiles accelerate, ships slow down to dock, packets leave fast
            const blk = tr.act === 'block', gap = blk ? 0.035 : tr.inbound ? 0.06 : 0.07, pts = tr.pts;
            for (let s = 0; s < SAMPLES; s++) {
                let v = u - s * gap;
                if (v < 0) { v = 0; }
                const e = blk ? Math.pow(v, 1.6) : tr.inbound ? 1 - Math.pow(1 - v, 2.2) : 1 - Math.pow(1 - v, 1.35);
                const a = (1 - e) * (1 - e), b = 2 * (1 - e) * e, d = e * e;
                const z = Math.max(0.2, a * o[2] + b * o[5] + d * o[8]);
                pts[s * 2] = vx + f * (a * o[0] + b * o[3] + d * o[6]) / z; pts[s * 2 + 1] = hy - f * (a * o[1] + b * o[4] + d * o[7]) / z;
            }
            if (!tr.inbound) { const z0 = Math.max(0.2, o[2]); tr.s0x = vx + f * o[0] / z0; tr.s0y = hy - f * o[1] / z0; }
            if (!tr.passed && !blk && tr.inbound && u > 0.9) { tr.passed = true; this._heat(tr.cell, tr.act, now, 0.45); }
            tl[n++] = tr;
            (blk ? M : tr.inbound ? S : O).push(tr);
        }
        tl.length = n;
        const sp = this._spaceSprites(), hv = this.hover && this.hover.trail;
        c.save();
        if (dark) { c.globalCompositeOperation = 'lighter'; }
        // BLOCKED: red missiles with a short hot tail
        if (M.length) {
            const str = P.tr.block;
            for (let s = 0; s < SAMPLES - 1; s++) {
                c.beginPath();
                for (const tr of M) { const p = tr.pts; c.moveTo(p[s * 2], p[s * 2 + 1]); c.lineTo(p[s * 2 + 2], p[s * 2 + 3]); }
                if (dark && s === 0) { c.strokeStyle = str.glow[0]; c.lineWidth = 6; c.stroke(); }
                c.strokeStyle = str.line[s]; c.lineWidth = s ? 1.6 : 2.4; c.stroke();
            }
            for (const tr of M) { this._put(c, sp.miss, tr.pts[0], tr.pts[1], tr === hv ? 1.6 : 1); }
        }
        // WELCOME: green-cyan ships (a soft long tail and a small arrowhead) gliding in to dock
        if (S.length) {
            for (let s = 0; s < SAMPLES - 1; s++) {
                c.beginPath();
                for (const tr of S) { const p = tr.pts; c.moveTo(p[s * 2], p[s * 2 + 1]); c.lineTo(p[s * 2 + 2], p[s * 2 + 3]); }
                c.strokeStyle = sp.line[s]; c.lineWidth = dark ? 1.4 : 1.8; c.stroke();
            }
            for (const tr of S) { this._put(c, sp.ok, tr.pts[0], tr.pts[1], tr === hv ? 1.6 : 1); }
            c.beginPath();
            for (const tr of S) {
                const p = tr.pts;
                let dx = p[0] - p[2], dy = p[1] - p[3];
                const l = Math.hypot(dx, dy);
                if (l < 0.01) { continue; }
                dx /= l; dy /= l;
                const k = this.fs ? 4.5 * this.s : 4;
                c.moveTo(p[0] + dx * k, p[1] + dy * k);
                c.lineTo(p[0] - dx * k * 0.8 - dy * k * 0.7, p[1] - dy * k * 0.8 + dx * k * 0.7);
                c.lineTo(p[0] - dx * k * 0.35, p[1] - dy * k * 0.35);
                c.lineTo(p[0] - dx * k * 0.8 + dy * k * 0.7, p[1] - dy * k * 0.8 - dx * k * 0.7);
                c.closePath();
            }
            c.fillStyle = sp.okTri; c.fill();
        }
        // SENDING: the core fires packet trains (a thin laser and three dots) out to the host
        if (O.length) {
            c.beginPath();
            for (const tr of O) { c.moveTo(tr.s0x, tr.s0y); c.lineTo(tr.pts[0], tr.pts[1]); }
            c.strokeStyle = sp.laser; c.lineWidth = 1; c.stroke();
            c.fillStyle = sp.beamc;
            for (const tr of O) {
                const p = tr.pts, d = tr === hv ? 4 : 2.6;
                for (let s = 0; s < 3; s++) { c.fillRect(p[s * 4] - d / 2, p[s * 4 + 1] - d / 2, d, d); }
                this._put(c, sp.beam, p[0], p[1], tr === hv ? 1.6 : 1);
            }
            // launch ring on the core's surface
            c.beginPath();
            for (const tr of O) {
                const u = (now - tr.t0) / tr.dur;
                if (u > 0.22) { continue; }
                const x = tr.s0x, y = tr.s0y, rr = 3 + 40 * u * (this.fs ? this.s : 1);
                c.moveTo(x + rr, y); c.ellipse(x, y, rr, rr * 0.6, 0, 0, TAU);
            }
            c.strokeStyle = sp.ring; c.lineWidth = 1.2; c.stroke();
        }
        // docking rings where welcome ships landed
        if (this.docks.length) {
            let m = 0;
            for (let i = 0; i < this.docks.length; i++) {
                const d = this.docks[i], q = (now - d.t0) / DOCK_MS;
                if (q >= 1) { continue; }
                this.docks[m++] = d;
                c.globalAlpha = (1 - q) * 0.9;
                c.beginPath(); c.ellipse(d.x, d.y, 3 + 20 * q * (this.fs ? this.s : 1), (3 + 20 * q * (this.fs ? this.s : 1)) * 0.55, 0, 0, TAU);
                c.strokeStyle = sp.dock; c.lineWidth = 1.5; c.stroke();
                c.globalAlpha = (1 - q) * 0.6; this._put(c, sp.okHot, d.x, d.y, 1.4);
            }
            this.docks.length = m;
            c.globalAlpha = 1;
        }
        c.restore();
    }

    _arriveSpace(tr, now, o) {
        const z = Math.max(0.2, o[8]), x = this.vx + this.f * o[6] / z, y = this.hy - this.f * o[7] / z, cell = tr.cell;
        if (tr.act === 'block') {
            // DEFENCE: the missile explodes on the shield (same flash, shards, glitch and shock wave as the grid scene)
            this._heat(cell, 'block', now, 1);
            const n = tr.inbound ? 10 : 5, sh = new Float32Array(n * 4);
            for (let i = 0; i < n; i++) { sh[i * 4] = Math.random() * TAU; sh[i * 4 + 1] = 40 + Math.random() * 90; sh[i * 4 + 2] = 3 + Math.random() * 7; sh[i * 4 + 3] = (Math.random() - 0.5) * 2; }
            this.fx.push({ c: cell.idx, px: x, py: y, t0: now, dur: tr.inbound ? 720 : 500, big: tr.inbound, sh, gl: tr.inbound ? 3 : 0 });
            if (this.fx.length > MAX_FX) { this.fx.shift(); }
            if (tr.inbound) { this.shocks.push({ i: cell.i, j: cell.j, t0: now }); if (this.shocks.length > MAX_SHOCKS) { this.shocks.shift(); } }
        } else if (tr.inbound) {
            // WELCOME: docks on the surface; the core pulses
            this.corePulse = now;
            this.rings.push({ t0: now, col: this._color(tr.act) });
            if (this.rings.length > MAX_RINGS) { this.rings.shift(); }
            if (this.docks.length >= MAX_DOCKS) { this.docks.shift(); }
            this.docks.push({ x, y, t0: now });
        } else {
            const p = this.planetBy.get(tr.ip);
            if (p) { p.flash = now; p.fcol = 'beam'; }
        }
        if (this.hover && this.hover.trail === tr) { this.hover = null; }
    }

    /* decorative layer: Orion, flowing stars, comets, small ships and lightning in a far nebula */

    _starsInit() {
        const sc = this.L.scene, sw = sc.x1 - sc.x0, sh = sc.y1 - sc.y0;
        // vanishing point (where we travel to): up and to the right of the core, outside its disc
        this.vpx = this.cx + sw * 0.24; this.vpy = this.cy - sh * 0.24;
        this.stN = Math.min(STARS_MAX, Math.round(sw * sh / (this.fs ? 1700 : 2100)));
        for (let i = 0; i < this.stN; i++) { this._starNew(i, 0.06 + Math.random() * 0.94); }
    }

    _starNew(i, z) {
        const sc = this.L.scene;
        this.stZ[i] = z;
        this.stX[i] = (sc.x0 + Math.random() * (sc.x1 - sc.x0) - this.vpx) * z;
        this.stY[i] = (sc.y0 + Math.random() * (sc.y1 - sc.y0) - this.vpy) * z;
    }

    _space(c, now, rm, dt, boot) {
        const sc = this.L.scene, sw = sc.x1 - sc.x0, sh = sc.y1 - sc.y0, s = this.fs ? this.s : 1;
        c.save();
        c.beginPath(); c.rect(sc.x0, sc.y0, sw, sh); c.clip();
        if (boot < 1) { c.globalAlpha = boot; }
        const ga = c.globalAlpha;
        // Orion: the farthest layer, drifting left very slowly and wrapping around
        const ori = this._orion();
        const per = sw + ori.w, ox = rm ? sc.x0 + sw * 0.62 : sc.x1 - ((now * 0.003 * s + sw * 0.4) % per);
        c.drawImage(ori.cv, ox, sc.y0 + sh * 0.05, ori.w, ori.h);
        // lightning in a far nebula (150-300 ms, rare)
        if (!rm) { this._thunderDraw(c, now, s); }
        // stars flowing out of the vanishing point (we move forward); near ones are faster, brighter and streak
        const X = this.stX, Y = this.stY, Z = this.stZ, n = this.stN, vpx = this.vpx, vpy = this.vpy;
        if (!rm) {
            const dz = STAR_V * dt;
            for (let i = 0; i < n; i++) {
                const z = Z[i] - dz;
                if (z < 0.03) { this._starNew(i, 1); continue; }
                Z[i] = z;
                const x = vpx + X[i] / z, y = vpy + Y[i] / z;
                if (x < sc.x0 - 4 || x > sc.x1 + 4 || y < sc.y0 - 4 || y > sc.y1 + 4) { this._starNew(i, 1); }
            }
        }
        const sk = this.starCol && this.starKey === this.pKey ? this.starCol : this._starColors();
        for (let b = 0; b < 4; b++) {
            const zl = 1 - (b + 1) * 0.25, zh = 1 - b * 0.25;
            c.beginPath();
            let lines = false;
            for (let i = 0; i < n; i++) {
                const z = Z[i];
                if (z <= zl || z > zh) { continue; }
                const x = vpx + X[i] / z, y = vpy + Y[i] / z;
                if (!rm && z < 0.2) { lines = true; continue; }
                const d = z < 0.4 ? 2 : z < 0.7 ? 1.5 : 1;
                c.rect(x, y, d, d);
            }
            c.fillStyle = sk[b]; c.fill();
            if (lines) {
                c.beginPath();
                for (let i = 0; i < n; i++) {
                    const z = Z[i];
                    if (z <= zl || z > zh || z >= 0.2) { continue; }
                    const z2 = z * 1.05;                                // short streak, proportional to the speed
                    c.moveTo(vpx + X[i] / z2, vpy + Y[i] / z2); c.lineTo(vpx + X[i] / z, vpy + Y[i] / z);
                }
                c.strokeStyle = sk[b > 0 ? b - 1 : 0]; c.lineWidth = 1.2; c.stroke();
            }
        }
        if (!rm) {
            this._comet(c, now, s, sc, sw, sh);
            this._shipsDraw(c, now, s, sc, sw, sh, dt);
        }
        c.globalAlpha = ga;
        c.restore();
    }

    _starColors() {
        const P = this.P, dark = P.dark, base = dark ? [228, 236, 255] : mix(P.text, P.beam, 0.3);
        this.starCol = [0.25, 0.45, 0.7, 0.95].map((a) => css(base, a * (dark ? 1 : 0.7)));
        this.starKey = this.pKey;
        return this.starCol;
    }

    // Orion pre-rendered once (positions from RA/Dec, flat projection around the belt)
    _orion() {
        const dpr = window.devicePixelRatio || 1, sc = this.L.scene, sh = sc.y1 - sc.y0, k = Math.max(6, sh * 0.016);
        if (this.orion && this.orionKey === this.pKey && this.orion.k === k && this.orion.dpr === dpr) { return this.orion; }
        const P = this.P, dark = P.dark, m = 18;
        const px = (ra, dec) => -(ra - 5.6) * 15 * k, py = (dec) => -dec * k;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const st of ORION) { const x = px(st[0]), y = py(st[1]); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        const w = Math.ceil(x1 - x0 + 2 * m), h = Math.ceil(y1 - y0 + 2 * m), X = (ra) => px(ra) - x0 + m, Y = (dec) => py(dec) - y0 + m;
        const cv = (this.orion && this.orion.cv) || document.createElement('canvas');
        cv.width = Math.ceil(w * dpr); cv.height = Math.ceil(h * dpr);
        const g = cv.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
        const A = dark ? 1 : 0.55;
        // M42: diffuse glow under the belt
        const mx = X(ORION_M42[0]), my = Y(ORION_M42[1]);
        let gr = g.createRadialGradient(mx, my, 0, mx, my, k * 1.6);
        gr.addColorStop(0, `rgba(255,170,215,${0.3 * A})`); gr.addColorStop(0.4, `rgba(190,130,230,${0.12 * A})`); gr.addColorStop(1, 'rgba(150,110,230,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(mx, my, k * 1.6, 0, TAU); g.fill();
        g.fillStyle = `rgba(235,225,255,${0.6 * A})`; g.fillRect(mx - 0.5, my - 0.5, 1.5, 1.5); g.fillRect(mx + k * 0.35, my - k * 0.5, 1, 1);
        // constellation lines, very faint
        g.beginPath();
        for (let i = 0; i < ORION_LINES.length; i += 2) {
            const a = ORION[ORION_LINES[i]], b = ORION[ORION_LINES[i + 1]];
            g.moveTo(X(a[0]), Y(a[1])); g.lineTo(X(b[0]), Y(b[1]));
        }
        g.strokeStyle = dark ? 'rgba(170,190,240,0.09)' : css(P.text, 0.08); g.lineWidth = 1; g.stroke();
        // stars: halo + core by magnitude
        for (const st of ORION) {
            const x = X(st[0]), y = Y(st[1]), br = clamp01((3.6 - st[2]) / 3.5), rr = 1 + br * 2.2 * Math.max(1, k / 11);
            gr = g.createRadialGradient(x, y, 0, x, y, rr * 4);
            gr.addColorStop(0, css(st[3], 0.55 * A * (0.4 + br))); gr.addColorStop(1, css(st[3], 0));
            g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr * 4, 0, TAU); g.fill();
            g.fillStyle = css(dark ? mix(st[3], [255, 255, 255], 0.4) : mix(st[3], P.text, 0.6), 0.95 * A);
            g.beginPath(); g.arc(x, y, rr * 0.6, 0, TAU); g.fill();
        }
        this.orion = { cv, w, h, k, dpr }; this.orionKey = this.pKey;
        return this.orion;
    }

    _comet(c, now, s, sc, sw, sh) {
        const C = this.comet;
        if (!this.nextComet) { this.nextComet = now + 4000 + Math.random() * 6000; }
        if (!C.on && now >= this.nextComet) {
            // from beyond one side to the other, a shallow random slope
            const ltr = Math.random() < 0.5, y = sc.y0 + sh * (0.05 + Math.random() * 0.6), ang = (ltr ? 0 : Math.PI) + (Math.random() - 0.3) * 0.7 * (ltr ? 1 : -1);
            C.on = true; C.t0 = now; C.dur = 2600 + Math.random() * 1800; C.a = ang;
            C.x0 = ltr ? sc.x0 - 40 : sc.x1 + 40; C.y0 = y;
            const L = (sw + 120) / C.dur; C.dx = Math.cos(ang) * L; C.dy = Math.sin(ang) * L;
        }
        if (!C.on) { return; }
        const age = now - C.t0;
        if (age > C.dur) { C.on = false; this.nextComet = now + 8000 + Math.random() * 12000; return; }
        const cv = this._cometSprite(s), x = C.x0 + C.dx * age, y = C.y0 + C.dy * age;
        const ga = c.globalAlpha;
        c.globalAlpha = ga * Math.min(1, age / 300, (C.dur - age) / 400) * 0.85;
        c.save(); c.translate(x, y); c.rotate(C.a);
        c.drawImage(cv, -cv.lw, -cv.lh / 2, cv.lw, cv.lh);
        c.restore();
        c.globalAlpha = ga;
    }

    _cometSprite(s) {
        const dpr = window.devicePixelRatio || 1;
        if (this.cometCv && this.cometKey === this.pKey && this.cometCv.s === s && this.cometCv.dpr === dpr) { return this.cometCv; }
        const P = this.P, lw = Math.round(150 * Math.max(0.7, s)), lh = 14, cv = document.createElement('canvas');
        cv.width = Math.ceil(lw * dpr); cv.height = Math.ceil(lh * dpr); cv.lw = lw; cv.lh = lh; cv.s = s; cv.dpr = dpr;
        const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
        const col = P.dark ? [200, 225, 255] : mix(P.text, [80, 120, 200], 0.4);
        let gr = g.createLinearGradient(0, 0, lw, 0);
        gr.addColorStop(0, css(col, 0)); gr.addColorStop(0.8, css(col, 0.35)); gr.addColorStop(1, css(col, 0.8));
        g.fillStyle = gr;
        g.beginPath(); g.moveTo(0, lh / 2); g.lineTo(lw - 4, lh / 2 - 3.5); g.lineTo(lw - 4, lh / 2 + 3.5); g.closePath(); g.fill();
        g.fillRect(0, lh / 2 - 0.5, lw - 3, 1);
        gr = g.createRadialGradient(lw - 5, lh / 2, 0, lw - 5, lh / 2, 6);
        gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, css(col, 0.7)); gr.addColorStop(1, css(col, 0));
        g.fillStyle = gr; g.beginPath(); g.arc(lw - 5, lh / 2, 6, 0, TAU); g.fill();
        this.cometCv = cv; this.cometKey = this.pKey;
        return cv;
    }

    // small ships crossing at random (at most 2), a dim silhouette with a blinking engine light
    _shipsDraw(c, now, s, sc, sw, sh, dt) {
        if (!this.nextShip) { this.nextShip = now + 2500 + Math.random() * 5000; }
        if (now >= this.nextShip) {
            this.nextShip = now + 6000 + Math.random() * 9000;
            const sp = this.ships[0].on ? this.ships[1] : this.ships[0];
            if (!sp.on) {
                const a = Math.random() * TAU, v = (0.03 + Math.random() * 0.04) * s, R = Math.hypot(sw, sh) / 2 + 10;
                const mx = (sc.x0 + sc.x1) / 2, my = (sc.y0 + sc.y1) / 2, j = (Math.random() - 0.5) * sh * 0.8;
                // starts outside the scene, heading across it (with a sideways offset)
                sp.on = true; sp.t0 = now; sp.a = a; sp.vx = Math.cos(a) * v; sp.vy = Math.sin(a) * v;
                sp.x = mx - Math.cos(a) * R - Math.sin(a) * j; sp.y = my - Math.sin(a) * R + Math.cos(a) * j;
                sp.sz = (3 + Math.random() * 3) * Math.max(0.8, s); sp.ph = Math.random() * 1000;
            }
        }
        const P = this.P, body = P.dark ? 'rgba(170,180,200,0.5)' : css(P.text, 0.35), ga = c.globalAlpha;
        for (const sp of this.ships) {
            if (!sp.on) { continue; }
            sp.x += sp.vx * dt; sp.y += sp.vy * dt;
            // gone once it is outside the scene and moving away from it
            if ((sp.x < sc.x0 - 30 || sp.x > sc.x1 + 30 || sp.y < sc.y0 - 30 || sp.y > sc.y1 + 30) &&
                (sp.x - (sc.x0 + sc.x1) / 2) * sp.vx + (sp.y - (sc.y0 + sc.y1) / 2) * sp.vy > 0) { sp.on = false; continue; }
            if (now - sp.t0 > 60000) { sp.on = false; continue; }
            const z = sp.sz;
            c.save(); c.translate(sp.x, sp.y); c.rotate(sp.a);
            c.beginPath(); c.moveTo(z, 0); c.lineTo(-z * 0.7, -z * 0.55); c.lineTo(-z * 0.35, 0); c.lineTo(-z * 0.7, z * 0.55); c.closePath();
            c.fillStyle = body; c.fill();
            const on = ((now + sp.ph) % 900) < 450;
            c.fillStyle = on ? 'rgba(255,225,170,0.85)' : 'rgba(255,225,170,0.25)';
            c.fillRect(-z * 0.6 - 1.5, -0.75, 1.5, 1.5);
            c.restore();
        }
        c.globalAlpha = ga;
    }

    // lightning inside one of the far nebulae: a soft flash and a short branched bolt
    _thunderDraw(c, now, s) {
        const T = this.thunder;
        if (!this.nextThunder) { this.nextThunder = now + 5000 + Math.random() * 8000; }
        if (!T.on && now >= this.nextThunder) {
            const nb = this.neb, k = Math.random() < 0.6 ? 0 : 1, rr = nb[k * 3 + 2];
            T.on = true; T.t0 = now; T.dur = 150 + Math.random() * 150;
            T.x = nb[k * 3] + (Math.random() - 0.5) * rr * 0.6; T.y = nb[k * 3 + 1] + (Math.random() - 0.5) * rr * 0.5;
            // main bolt (8 points) + one branch (4 points) from its middle
            const P2 = T.pts, a = Math.random() * TAU, step = rr * 0.09;
            let x = T.x, y = T.y, n = 0;
            for (let i = 0; i < 8; i++) { P2[n++] = x; P2[n++] = y; const b = a + (Math.random() - 0.5) * 1.3; x += Math.cos(b) * step; y += Math.sin(b) * step; }
            T.n = 8; T.b0 = n;
            x = P2[6]; y = P2[7];
            const a2 = a + (Math.random() < 0.5 ? 0.8 : -0.8);
            for (let i = 0; i < 4; i++) { P2[n++] = x; P2[n++] = y; const b = a2 + (Math.random() - 0.5) * 1.2; x += Math.cos(b) * step * 0.7; y += Math.sin(b) * step * 0.7; }
            T.bn = 4;
        }
        if (!T.on) { return; }
        const p = (now - T.t0) / T.dur;
        if (p >= 1) { T.on = false; this.nextThunder = now + 10000 + Math.random() * 15000; return; }
        const sp = this._spaceSprites(), ga = c.globalAlpha, fl = (1 - p) * (p < 0.4 || p > 0.6 ? 1 : 0.45);
        c.save();
        if (this.P.dark) { c.globalCompositeOperation = 'lighter'; }
        c.globalAlpha = ga * 0.35 * fl;
        this._put(c, sp.bolt, T.x, T.y, 2.2 * s);
        c.globalAlpha = ga * 0.7 * fl;
        const P2 = T.pts;
        c.beginPath();
        c.moveTo(P2[0], P2[1]); for (let i = 1; i < T.n; i++) { c.lineTo(P2[i * 2], P2[i * 2 + 1]); }
        c.moveTo(P2[T.b0], P2[T.b0 + 1]); for (let i = 1; i < T.bn; i++) { c.lineTo(P2[T.b0 + i * 2], P2[T.b0 + i * 2 + 1]); }
        c.strokeStyle = 'rgba(225,215,255,0.9)'; c.lineWidth = 1.2; c.stroke();
        c.restore();
        c.globalAlpha = ga;
    }

    // static layer of the space scene: deep background, faint nebulae, a dusting of far stars
    _spaceBg(g, w, hh) {
        const P = this.P, dark = P.dark, sc = this.L.scene, sw = sc.x1 - sc.x0, sh = sc.y1 - sc.y0;
        const deep = dark ? mix(P.bg, [2, 3, 10], 0.45) : mix(P.bg, [255, 255, 255], 0.25);
        g.fillStyle = css(deep); g.fillRect(0, 0, w, hh);
        let gr = g.createLinearGradient(0, sc.y0, 0, sc.y1);
        gr.addColorStop(0, css(mix(deep, [20, 10, 60], dark ? 0.25 : 0.05))); gr.addColorStop(1, css(mix(deep, P.beam, dark ? 0.06 : 0.04)));
        g.fillStyle = gr; g.fillRect(sc.x0, sc.y0, sw, sh);
        const nb = this.neb;
        nb[0] = sc.x0 + sw * 0.82; nb[1] = sc.y0 + sh * 0.2; nb[2] = sh * 0.3;
        nb[3] = sc.x0 + sw * 0.16; nb[4] = sc.y0 + sh * 0.7; nb[5] = sh * 0.27;
        nb[6] = sc.x0 + sw * 0.55; nb[7] = sc.y0 + sh * 0.92; nb[8] = sh * 0.2;
        const cols = [[150, 90, 230], mix(P.beam, [40, 200, 180], 0.5), [210, 80, 160]], A = dark ? 0.075 : 0.05;
        const rnd = mulberry(0x5ace);
        for (let k = 0; k < 3; k++) {
            for (let j = 0; j < 3; j++) {
                const x = nb[k * 3] + (rnd() - 0.5) * nb[k * 3 + 2] * 0.9, y = nb[k * 3 + 1] + (rnd() - 0.5) * nb[k * 3 + 2] * 0.6, r = nb[k * 3 + 2] * (0.5 + rnd() * 0.6);
                gr = g.createRadialGradient(x, y, 0, x, y, r);
                gr.addColorStop(0, css(cols[k], A)); gr.addColorStop(0.5, css(cols[k], A * 0.45)); gr.addColorStop(1, css(cols[k], 0));
                g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
            }
        }
        // a faint band of the galaxy across the scene
        g.save(); g.translate(sc.x0 + sw / 2, sc.y0 + sh / 2); g.rotate(-0.42); g.scale(1, 0.16);
        gr = g.createRadialGradient(0, 0, 0, 0, 0, sw * 0.7);
        gr.addColorStop(0, css(dark ? [200, 210, 255] : P.text, dark ? 0.05 : 0.03)); gr.addColorStop(1, css(dark ? [200, 210, 255] : P.text, 0));
        g.fillStyle = gr; g.beginPath(); g.arc(0, 0, sw * 0.7, 0, TAU); g.fill();
        g.restore();
        // far dust: motionless tiny stars
        const n = Math.min(900, Math.round(sw * sh / 1100));
        for (let i = 0; i < n; i++) {
            const x = sc.x0 + rnd() * sw, y = sc.y0 + rnd() * sh, a = 0.05 + rnd() * rnd() * (dark ? 0.4 : 0.25);
            g.fillStyle = dark ? css(mix([225, 235, 255], P.beam, 0.15), a) : css(mix(P.text, P.beam, 0.4), a * 0.8);
            g.fillRect(Math.round(x), Math.round(y), 1, 1);
        }
    }

    /* ------------------------------------------------------------------ HUD (normal) */

    _hud(c, now, R) {
        const P = this.P, t = this.host.translations || {}, L = this.L, dark = P.dark;
        const lc = this._levelColor(R.lvl), G = L.gauge, gs = G.r + 16;
        // threat gauge (image refreshed 4 times a second; the critical label blinks by alpha)
        c.save();
        if (R.lvl === 3 && !this.host.reducedMotion) { c.globalAlpha = 0.7 + 0.3 * Math.abs(Math.sin(now * 0.006)); }
        this._cached('gauge', G.x - gs, G.y - gs, gs * 2, gs * 2 + 16, now, 250, (g) => {
            const x = gs, y = gs, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
            g.lineCap = 'round';
            g.beginPath(); g.arc(x, y, G.r, a0, a1); g.strokeStyle = css(P.text, 0.15); g.lineWidth = 5; g.stroke();
            if (R.gauge > 0) {
                g.beginPath(); g.arc(x, y, G.r, a0, a0 + (a1 - a0) * R.gauge);
                if (dark) { g.strokeStyle = css(lc, 0.25); g.lineWidth = 10; g.stroke(); }
                g.strokeStyle = css(lc, 0.95); g.lineWidth = 5; g.stroke();
            }
            g.lineCap = 'butt';
            g.beginPath();
            for (let i = 0; i <= 4; i++) {
                const a = a0 + (a1 - a0) * i / 4;
                g.moveTo(x + Math.cos(a) * (G.r + 6), y + Math.sin(a) * (G.r + 6)); g.lineTo(x + Math.cos(a) * (G.r + 9), y + Math.sin(a) * (G.r + 9));
            }
            g.strokeStyle = css(P.text, 0.5); g.lineWidth = 1; g.stroke();
            g.textAlign = 'center'; g.textBaseline = 'middle';
            g.font = `700 17px ${this.mono}`; g.fillStyle = css(lc); g.fillText(String(R.blk), x, y - 2);
            g.font = `8.5px ${this.font}`; g.fillStyle = css(P.text, 0.7); g.fillText(this._fit(g, String(t.threat ?? 'Threat level').toUpperCase(), G.r * 2.15), x, y + 11);
            g.font = `700 10.5px ${this.font}`; g.fillStyle = css(lc); g.fillText(this._levelName(R.lvl).toUpperCase(), x, y + G.r + 12);
        });
        c.restore();
        // counters (right): events/min, blocked/min, unique attackers; they jitter with an RGB ghost during a burst
        const cw = 160, ch = 104, jit = R.burst && !this.host.reducedMotion ? (Math.round(now / 40) % 3) - 1 : 0;
        const e = this._cached('counters', L.counters.x - cw + jit * 2, L.counters.y, cw, ch, now, 250, (g) => {
            const rows = [[R.ev, t.evmin ?? 'events/min', P.text], [R.blk, t.blkmin ?? 'blocked/min', P.block], [R.uniq, t.uniq ?? 'attackers', P.beam]];
            g.textAlign = 'right'; g.textBaseline = 'middle';
            let y = 0;
            for (const [v, lbl, col] of rows) {
                g.font = `700 19px ${this.mono}`; g.fillStyle = css(col); g.fillText(String(v), cw, y + 10);
                g.font = `9.5px ${this.font}`; g.fillStyle = css(P.text, 0.72); g.fillText(String(lbl).toUpperCase(), cw, y + 25);
                y += 34;
            }
        });
        if (jit && dark) {
            c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.35;
            c.drawImage(e.cv, Math.round(L.counters.x - cw - 3), L.counters.y + 1, cw, ch);
            c.restore();
        }
        // status line
        this._cached('status', L.status.x, L.status.y - 8, 420, 16, now, 1000, (g) => {
            g.textAlign = 'left'; g.textBaseline = 'middle';
            g.font = `10px ${this.mono}`; g.fillStyle = css(P.text, 0.62);
            g.fillText(`${String(t.shield ?? 'Shield').toUpperCase()} · ${this.byKey.size} ${t.portsunit ?? 'ports'} · ${String(t.core ?? 'Core').toUpperCase()} ${R.lvl < 3 ? (t.online ?? 'online').toUpperCase() : (t.underattack ?? 'under attack').toUpperCase()}`, 0, 8);
        });
        // ticker: last attacks; radar
        this._ticker(c, now, L.ticker.x0, L.ticker.x1, L.ticker.y, 11, this.attacks, false);
        this._radar(c, now, L.radar.x, L.radar.y, L.radar.r, 1);
    }

    _tickerStrip(items, size, full) {
        const P = this.P, dpr = window.devicePixelRatio || 1;
        const key = items.map((i) => `${i.wall}|${i.ip}|${i.port}|${this._cc(i) || ''}|${i.act || ''}`).join(';') + `|${size}|${full}|${this.pKey}`;
        if (this.tick && this.tick.key === key) { return this.tick; }
        const cv = (this.tick && this.tick.cv) || document.createElement('canvas');
        let g = cv.getContext('2d');
        const font = `${size}px ${this.mono}`;
        g.font = font;
        const parts = items.map((it) => {
            const cc = this._cc(it), tm = hms(new Date(it.wall));
            const act = full ? (it.act === 'block' ? 'BLOCK' : it.act === 'nat' ? 'NAT' : it.act === 'pass' ? 'PASS' : it.act.toUpperCase()) : '';
            const dir = full ? (it.inbound ? '↓' : '↑') : '';
            return { tm, act, dir, body: `${it.ip}${it.port ? ':' + it.port : ''}`, cc: cc ? `${this._flag(cc)} ${cc}` : '', col: this._color(it.act || 'block') };
        });
        const seg = [];
        let total = 0;
        for (const p of parts) {
            const widths = [g.measureText(p.tm + ' ').width, p.act ? g.measureText(p.act + ' ').width : 0, p.dir ? g.measureText(p.dir + ' ').width : 0,
                g.measureText(p.body + ' ').width, p.cc ? g.measureText(p.cc).width + size * 0.5 : 0, g.measureText('   ·   ').width];
            seg.push({ p, widths, x: total });
            total += widths.reduce((a, b) => a + b, 0);
        }
        const strip = Math.max(1, Math.ceil(total)), hgt = Math.ceil(size * 1.6);
        cv.width = Math.ceil(strip * dpr); cv.height = Math.ceil(hgt * dpr);
        g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.font = font; g.textBaseline = 'middle'; g.textAlign = 'left';
        for (const { p, widths, x } of seg) {
            let xx = x;
            g.fillStyle = css(P.text, 0.55); g.fillText(p.tm, xx, hgt / 2); xx += widths[0];
            if (p.act) { g.fillStyle = p.col; g.fillText(p.act, xx, hgt / 2); xx += widths[1]; }
            if (p.dir) { g.fillStyle = css(P.text, 0.6); g.fillText(p.dir, xx, hgt / 2); xx += widths[2]; }
            g.fillStyle = full ? css(P.text, 0.95) : p.col; g.fillText(p.body, xx, hgt / 2); xx += widths[3];
            if (p.cc) { g.fillStyle = css(P.text, 0.8); g.fillText(p.cc, xx, hgt / 2); xx += widths[4]; }
            g.fillStyle = css(P.beam, 0.6); g.fillText('·', xx + widths[5] / 2 - size * 0.25, hgt / 2);
        }
        this.tick = { key, cv, w: strip, h: hgt };
        return this.tick;
    }

    // continuous right-to-left ticker of the items, clipped to [x0, x1]
    _ticker(c, now, x0, x1, y, size, items, full) {
        if (!items.length) { return; }
        const st = this._tickerStrip(items, size, full), vw = x1 - x0;
        if (vw <= 10) { return; }
        const dpr = window.devicePixelRatio || 1, speed = (full ? 42 : 30) * (this.fs ? this.s : 1) / 1000;
        const period = st.w + vw * 0.35;
        let off = this.host.reducedMotion ? 0 : (now * speed) % period;
        c.save(); c.beginPath(); c.rect(x0, y - st.h / 2, vw, st.h); c.clip();
        for (let xx = x0 + vw - off; xx < x1; xx += period) {
            const dx = Math.round(xx * dpr) / dpr;
            c.drawImage(st.cv, dx, Math.round((y - st.h / 2) * dpr) / dpr, st.w, st.h);
        }
        // a second copy on the left when the first one has scrolled past
        let xx = x0 + vw - off - period;
        while (xx + st.w > x0) { c.drawImage(st.cv, Math.round(xx * dpr) / dpr, Math.round((y - st.h / 2) * dpr) / dpr, st.w, st.h); xx -= period; }
        c.restore();
    }

    _radar(c, now, x, y, r, sc) {
        const P = this.P, dark = P.dark, rm = !!this.host.reducedMotion;
        c.beginPath(); c.arc(x, y, r, 0, TAU); c.fillStyle = css(P.bg, 0.5); c.fill();
        c.strokeStyle = css(P.beam, 0.5); c.lineWidth = 1; c.stroke();
        c.beginPath(); c.arc(x, y, r * 0.5, 0, TAU); c.strokeStyle = css(P.beam, 0.3); c.stroke();
        c.beginPath(); c.moveTo(x - r, y); c.lineTo(x + r, y); c.moveTo(x, y - r); c.lineTo(x, y + r); c.strokeStyle = css(P.beam, 0.2); c.stroke();
        const sweep = rm ? -Math.PI / 2 : (now * 0.0016) % TAU;
        if (!rm) {
            for (let i = 0; i < 6; i++) {
                c.beginPath(); c.moveTo(x, y); c.arc(x, y, r, sweep - (i + 1) * 0.16, sweep - i * 0.16); c.closePath();
                c.fillStyle = css(P.beam, 0.22 * (1 - i / 6)); c.fill();
            }
            c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(sweep) * r, y + Math.sin(sweep) * r);
            c.strokeStyle = css(P.beam, 0.9); c.lineWidth = 1; c.stroke();
        }
        const hv = this.hover && this.hover.blip;
        for (const b of this.blips) {
            const age = now - b.t;
            if (age > RATE_MS) { continue; }
            const rr = r * (0.92 - 0.6 * age / RATE_MS);
            let d = sweep - b.ang; d = ((d % TAU) + TAU) % TAU;
            const hi = rm ? 0.6 : Math.max(0, 1 - d / 2.5);
            const a = 0.35 + 0.65 * hi;
            b.x = x + Math.cos(b.ang) * rr; b.y = y + Math.sin(b.ang) * rr;
            const d2 = (b === hv ? 2.6 : 1.5) * sc + 1.2 * hi;
            c.fillStyle = dark ? css(mix(P.block, [255, 255, 255], 0.3 * hi), a) : css(P.block, a);
            c.fillRect(Math.round(b.x - d2), Math.round(b.y - d2), Math.round(d2 * 2), Math.round(d2 * 2));
        }
    }

    /* ------------------------------------------------------------------ HUD (fullscreen) */

    // letter-spaced uppercase text
    _spaced(g, text, x, y, sp) {
        let xx = x;
        for (const ch of text) { g.fillText(ch, xx, y); xx += g.measureText(ch).width + sp; }
        return xx - x - sp;
    }

    _spacedWidth(g, text, sp) {
        let w = 0;
        for (const ch of text) { w += g.measureText(ch).width + sp; }
        return w - sp;
    }

    _frame(g, w, h, title) {
        const P = this.P, s = this.s, Z = this.FZ;
        g.fillStyle = P.dark ? css(mix(P.bg, [0, 0, 0], 0.3), 0.82) : 'rgba(255,255,255,0.85)';
        g.fillRect(0, 0, w, h);
        g.strokeStyle = css(P.beam, 0.3); g.lineWidth = 1; g.strokeRect(0.5, 0.5, w - 1, h - 1);
        const B = 10 * s, m = 2.5;
        g.strokeStyle = css(P.beam, 0.95); g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(m, m + B); g.lineTo(m, m); g.lineTo(m + B, m);
        g.moveTo(w - m - B, m); g.lineTo(w - m, m); g.lineTo(w - m, m + B);
        g.moveTo(m, h - m - B); g.lineTo(m, h - m); g.lineTo(m + B, h - m);
        g.moveTo(w - m - B, h - m); g.lineTo(w - m, h - m); g.lineTo(w - m, h - m - B);
        g.stroke();
        const fz = Z.head, y = Math.round(fz * 0.6 + 8);
        g.font = `700 ${fz}px ${this.font}`; g.textBaseline = 'middle'; g.textAlign = 'left';
        g.fillStyle = css(P.beam);
        const tw = this._spaced(g, String(title).toUpperCase(), Z.pad, y, Math.max(1, fz * 0.1));
        g.fillStyle = css(P.beam, 0.35); g.fillRect(Z.pad, y + fz * 0.7, tw, 1);
        g.fillStyle = css(P.beam, 0.5); g.fillRect(Z.pad + tw + 8, y, Math.max(0, w - 2 * Z.pad - tw - 8), 1);
        return Math.round(y + fz * 0.7 + 8);
    }

    // text cut with an ellipsis to fit maxW (current font)
    _fit(g, txt, maxW) {
        txt = String(txt);
        if (g.measureText(txt).width <= maxW) { return txt; }
        while (txt.length > 1 && g.measureText(txt + '…').width > maxW) { txt = txt.slice(0, -1); }
        return txt + '…';
    }

    _spark(g, x, y, w, h, arr, col, max) {
        if (w <= 2 || h <= 1) { return; }
        if (!arr || arr.length < 2) {
            // no history yet: dotted baseline
            g.fillStyle = css(col, 0.35);
            for (let xx = x; xx < x + w; xx += 4) { g.fillRect(Math.round(xx), Math.round(y + h) - 1, 2, 1); }
            return;
        }
        const n = arr.length, m = max > 0 ? max : Math.max(1, ...arr);
        g.beginPath();
        g.moveTo(x, y + h);
        for (let i = 0; i < n; i++) { g.lineTo(x + (i / (n - 1)) * w, y + h - clamp01((arr[i] || 0) / m) * h); }
        g.lineTo(x + w, y + h); g.closePath();
        g.fillStyle = css(col, 0.18); g.fill();
        g.beginPath();
        for (let i = 0; i < n; i++) { const px = x + (i / (n - 1)) * w, py = y + h - clamp01((arr[i] || 0) / m) * h; if (i) { g.lineTo(px, py); } else { g.moveTo(px, py); } }
        g.strokeStyle = css(col, 0.9); g.lineWidth = 1.2; g.stroke();
    }

    // rows that fit in a panel body (never more than `max`; the text keeps its size, the list gets shorter)
    _rows(avail, rh, max) { return Math.max(0, Math.min(max, Math.floor(avail / rh))); }

    _hudFull(c, now, R, T, boot) {
        const P = this.P, t = this.host.translations || {}, L = this.L, s = this.s, w = this.gw, Z = this.FZ, pad = Z.pad;
        const mono = (sz, b) => `${b ? '700 ' : ''}${sz}px ${this.mono}`, sans = (sz, b) => `${b ? '700 ' : ''}${sz}px ${this.font}`;
        // title bar
        this._title(c, now, R, boot);
        const period = 1000;
        // THREAT LEVEL: gauge on the left, counters on the right, 60 s sparkline under them
        const th = L.threat;
        this._cached('threat', th.x, th.y, th.w, th.h, now, period, (g, pw, ph) => {
            const y0 = this._frame(g, pw, ph, t.threat ?? 'Threat level'), lc = this._levelColor(R.lvl);
            const sparkH = Math.max(24, Math.round(ph * 0.2)), axis = Z.small + 6;
            const bodyH = ph - y0 - sparkH - axis - 10;
            const r = Math.max(20, Math.min(pw * 0.24, (bodyH - Z.label - 12) / 2)), gx = pad + r + 6, gy = y0 + r + 6;
            const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, lw = Math.max(5, r * 0.11);
            g.lineCap = 'round';
            g.beginPath(); g.arc(gx, gy, r, a0, a1); g.strokeStyle = css(P.text, 0.15); g.lineWidth = lw; g.stroke();
            if (R.gauge > 0) {
                g.beginPath(); g.arc(gx, gy, r, a0, a0 + (a1 - a0) * R.gauge);
                if (P.dark) { g.strokeStyle = css(lc, 0.25); g.lineWidth = lw * 2; g.stroke(); }
                g.strokeStyle = css(lc, 0.95); g.lineWidth = lw; g.stroke();
            }
            g.lineCap = 'butt';
            g.textAlign = 'center'; g.textBaseline = 'middle';
            g.font = mono(Math.round(r * 0.62), true); g.fillStyle = css(lc); g.fillText(String(R.blk), gx, gy - r * 0.06);
            g.font = sans(Z.small); g.fillStyle = css(P.text, 0.7); g.fillText(String(t.blkmin ?? 'blocked/min').toUpperCase(), gx, gy + r * 0.42);
            g.font = sans(Z.label + 2, true); g.fillStyle = css(lc); g.fillText(this._levelName(R.lvl).toUpperCase(), gx, gy + r + Z.label * 0.4);
            // counters beside the gauge
            g.textAlign = 'left';
            const cx = gx + r + 14, rows = [[R.ev, t.evmin ?? 'events/min', P.text], [R.uniq, t.uniq ?? 'attackers', P.beam], [this.byKey.size, t.portsunit ?? 'ports', P.beam]];
            const step = Math.min(Z.big + Z.label + 10, (bodyH + 4) / 3);
            let yy = y0 + 2;
            for (const [v, lbl, col] of rows) {
                g.font = mono(Z.big, true); g.fillStyle = css(col); g.fillText(String(v), cx, yy + Z.big * 0.55);
                g.font = sans(Z.label); g.fillStyle = css(P.text, 0.72); g.fillText(this._fit(g, String(lbl).toUpperCase(), pw - cx - pad), cx, yy + Z.big + Z.label * 0.55);
                yy += step;
            }
            // 60 s sparkline of blocked connections (2 s bins)
            const bins = new Array(30).fill(0);
            for (const b of this.blocks) { const i = 29 - Math.floor((now - b) / 2000); if (i >= 0 && i < 30) { bins[i]++; } }
            const sx = pad, sy = ph - axis - sparkH - 6, sw = pw - 2 * pad;
            g.fillStyle = css(P.text, 0.06); g.fillRect(sx, sy, sw, sparkH);
            this._spark(g, sx, sy, sw, sparkH, bins, P.block, 0);
            g.font = mono(Z.small); g.fillStyle = css(P.text, 0.6); g.textAlign = 'left';
            g.fillText('-60s', sx, sy + sparkH + axis / 2 + 1); g.textAlign = 'right'; g.fillText(t.now ?? 'now', sx + sw, sy + sparkH + axis / 2 + 1);
        });
        // ATTACKERS
        const at = L.attackers;
        this._cached('attackers', at.x, at.y, at.w, at.h, now, period, (g, pw, ph, e) => {
            const y0 = this._frame(g, pw, ph, t.attackers ?? 'Top attackers');
            const rh = Math.round(Z.row * 1.95), n = this._rows(ph - y0 - 4, rh, this.rowsN);
            const list = [...this.attackers.values()].sort((a, b) => b.n - a.n).slice(0, n), max = list.length ? list[0].n : 1;
            g.textBaseline = 'middle';
            g.font = mono(Z.row);
            const ipx = pad + g.measureText('🇧🇷 WW ').width + 4;
            g.font = mono(Z.row, true);
            const nw = g.measureText(String(max)).width + 6;
            list.forEach((a, i) => {
                const y = y0 + i * rh + rh * 0.42, cc = this._cc(a);
                g.textAlign = 'left'; g.font = mono(Z.row);
                g.fillStyle = css(P.text, 0.9); g.fillText(cc ? `${this._flag(cc)} ${cc}` : '🌐 --', pad, y);
                g.fillText(this._fit(g, a.ip, pw - ipx - pad - nw), ipx, y);
                g.textAlign = 'right'; g.font = mono(Z.row, true); g.fillStyle = css(P.block); g.fillText(String(a.n), pw - pad, y);
                g.fillStyle = css(P.block, 0.6); g.fillRect(ipx, y + Z.row * 0.62, Math.max(3, (pw - ipx - pad - nw) * a.n / max), 2);
                e.rows.push({ y0: y - rh / 2, y1: y + rh / 2, ip: a.ip, cc, n: a.n, port: a.port });
            });
            if (!list.length) { g.textAlign = 'left'; g.font = sans(Z.row); g.fillStyle = css(P.text, 0.5); g.fillText('—', pad, y0 + rh / 2); }
        });
        // SYSTEM (telemetry)
        if (L.system) { this._system(c, now, T); }
        // TARGETED PORTS
        const pt = L.ports;
        this._cached('ports', pt.x, pt.y, pt.w, pt.h, now, period, (g, pw, ph, e) => {
            const y0 = this._frame(g, pw, ph, t.ports ?? 'Targeted ports');
            const rh = Math.round(Z.row * 1.95), n = this._rows(ph - y0 - 4, rh, this.rowsN);
            const list = this.cells.filter((x) => x.key && x.c.block > 0).sort((a, b) => b.c.block - a.c.block).slice(0, n);
            const max = list.length ? list[0].c.block : 1;
            g.textBaseline = 'middle';
            g.font = mono(Z.row, true);
            const sx = pad + g.measureText('00000 ').width + 4, nw = g.measureText(String(max)).width + 8, bw = pw - sx - pad - nw;
            list.forEach((cell, i) => {
                const y = y0 + i * rh + rh * 0.42;
                g.textAlign = 'left'; g.font = mono(Z.row, true); g.fillStyle = css(P.text, 0.95); g.fillText(this._fit(g, cell.key, sx - pad - 4), pad, y);
                g.font = mono(Z.row); g.fillStyle = css(P.text, 0.65); g.fillText(this._fit(g, cell.svc || cell.proto || '', bw), sx, y);
                g.textAlign = 'right'; g.font = mono(Z.row, true); g.fillStyle = css(P.block); g.fillText(String(cell.c.block), pw - pad, y);
                const wb = Math.max(3, bw * cell.c.block / max), wp = Math.max(0, Math.min(bw - wb, bw * (cell.c.pass + cell.c.nat) / max));
                g.fillStyle = css(P.block, 0.6); g.fillRect(sx, y + Z.row * 0.62, wb, 2);
                if (wp > 0) { g.fillStyle = css(P.pass, 0.6); g.fillRect(sx + wb, y + Z.row * 0.62, wp, 2); }
                e.rows.push({ y0: y - rh / 2, y1: y + rh / 2, cell });
            });
            if (!list.length) { g.textAlign = 'left'; g.font = sans(Z.row); g.fillStyle = css(P.text, 0.5); g.fillText('—', pad, y0 + rh / 2); }
        });
        // EXPOSURE (host.exposure)
        if (L.exposure) { this._exposurePanel(now); }
        // BLOCKING RULES
        const ru = L.rules;
        this._cached('rules', ru.x, ru.y, ru.w, ru.h, now, period, (g, pw, ph) => {
            const y0 = this._frame(g, pw, ph, t.rules ?? 'Blocking rules');
            const rh = Math.round(Z.row * 1.95), n = this._rows(ph - y0 - 4, rh, 5);
            const list = [...this.rules.entries()].sort((a, b) => b[1] - a[1]).slice(0, n), max = list.length ? list[0][1] : 1;
            g.textBaseline = 'middle';
            g.font = mono(Z.row, true);
            const nw = g.measureText(String(max)).width + 8;
            list.forEach(([lbl, cnt], i) => {
                const y = y0 + i * rh + rh * 0.42;
                g.textAlign = 'left'; g.font = sans(Z.row); g.fillStyle = css(P.text, 0.92);
                g.fillText(this._fit(g, lbl, pw - 2 * pad - nw), pad, y);
                g.textAlign = 'right'; g.font = mono(Z.row, true); g.fillStyle = css(P.text); g.fillText(String(cnt), pw - pad, y);
                g.fillStyle = css(P.beam, 0.6); g.fillRect(pad, y + Z.row * 0.62, Math.max(3, (pw - 2 * pad - nw) * cnt / max), 2);
            });
        });
        // corner: radar (left) + heat map (right), captions under the heat map
        const co = L.corner, top = this.FZ.head + 22;
        const rr = Math.max(10, Math.min((co.h - top - 10) / 2, co.w * 0.2));
        this._cached('corner', co.x, co.y, co.w, co.h, now, period, (g, pw, ph) => {
            const y0 = this._frame(g, pw, ph, `${t.radar ?? 'Radar'} · ${t.heatmap ?? 'Heat map'}`);
            // 24 x 7: the last 168 hours when there are at least 3 hours of data, else the last 168 minutes
            const hours = this.hhour.size >= 3, src = hours ? this.hhour : this.hmin, unit = hours ? 3600000 : 60000;
            const capH = Z.small * 2 + 14;
            const cur = Math.floor(Date.now() / unit), hx = 2 * rr + pad * 2 + 6, hw = pw - hx - pad, hh = ph - y0 - capH - 6;
            const cs = Math.max(2, Math.floor(Math.min(hw / 24, hh / 7))), gw = cs * 24, gh = cs * 7, ox = pw - pad - gw, oy = y0 + 2;
            let max = 1;
            for (const v of src.values()) { if (v > max) { max = v; } }
            for (let i = 0; i < 168; i++) {
                const v = src.get(cur - (167 - i)) || 0, col = i % 24, row = Math.floor(i / 24), q = Math.min(1, v / max);
                g.fillStyle = v ? css(mix(P.beam, P.block, q), 0.35 + 0.65 * q) : css(P.text, 0.07);
                g.fillRect(ox + col * cs, oy + row * cs, cs - 1, cs - 1);
            }
            g.font = mono(Z.small); g.fillStyle = css(P.text, 0.65); g.textAlign = 'right'; g.textBaseline = 'middle';
            g.fillText(hours ? '7 × 24 h' : '7 × 24 min', ox + gw, oy + gh + Z.small * 0.6 + 4);
            g.fillStyle = css(P.beam, 0.95);
            g.fillText(this._fit(g, `${this.uniq.size} ${t.uniq ?? 'attackers'} / 5 min`, pw - hx), ox + gw, oy + gh + Z.small * 1.8 + 8);
        });
        this._radar(c, now, co.x + pad + rr, co.y + top + rr, rr, Math.max(1, s));
        // AI ANALYST (Policy Analyzer brief), docked at the bottom of the scene
        if (boot >= 1) { this._aiPanel(c, now); }
        // footer: live feed ticker
        c.textBaseline = 'middle';
        this._ticker(c, now, pad, w - pad, (L.foot.y0 + L.foot.y1) / 2, Z.tick, this.feed, true);
    }

    // title bar: "OPNsense MAX CYBER // WAR ROOM", hostname, clocks and uptime (strip cached at 1 Hz, glitch live)
    _title(c, now, R, boot) {
        const P = this.P, t = this.host.translations || {}, L = this.L, s = this.s, w = this.gw, h = L.title.y1, Z = this.FZ;
        const rm = !!this.host.reducedMotion;
        let host = 'FIREWALL';
        try {
            const title = String(this.host.el.ownerDocument.title || '');
            const seg = title.split(' | ').pop().trim();
            if (seg && seg !== title.trim()) { host = seg; } else if (title.trim() && title.indexOf('|') < 0 && title.trim().length < 40) { host = title.trim(); }
        } catch (e) { /* keep the fallback */ }
        const e = this._cached('title', 0, 0, w, h, now, 1000, (g, pw, ph, ent) => {
            const y = ph / 2, gap = Math.round(Z.title * 0.7);
            g.textBaseline = 'middle'; g.textAlign = 'left';
            let x = Z.pad + 6;
            g.font = `${Z.title + 1}px ${this.font}`; g.fillStyle = css(P.text, 0.85);
            g.fillText('OPNsense', x, y); x += g.measureText('OPNsense').width + gap;
            const name = String(t.cyber ?? 'Max Cyber').toUpperCase();
            g.font = `800 ${Z.brand}px ${this.font}`;
            g.shadowColor = css(P.beam, 0.9); g.shadowBlur = Z.brand * 0.6;
            g.fillStyle = css(P.dark ? mix(P.beam, [255, 255, 255], 0.25) : P.beam);
            x += this._spaced(g, name, x, y, Z.brand * 0.1) + gap;
            g.shadowBlur = 0;
            g.font = `${Z.title + 2}px ${this.mono}`; g.fillStyle = css(P.beam, 0.7);
            g.fillText('//', x, y); x += g.measureText('//').width + gap;
            g.font = `600 ${Z.title}px ${this.font}`; g.fillStyle = css(P.text, 0.9);
            x += this._spaced(g, String(t.warroom ?? 'War room').toUpperCase(), x, y, Z.title * 0.35);
            ent.nameEnd = x;
            // right side: hostname, clocks, uptime (the clocks are dropped first when the bar is too narrow)
            const d = new Date();
            const fw = this._fwClock();
            const clocks = [];
            if (fw) {
                // the time zone configured on the firewall (System: Settings: General), from system_time
                clocks.push([`${fw.label} ${hmsUTC(new Date(d.getTime() + fw.offsetMin * 60000))}`, P.text, false]);
                if (fw.offsetMin !== -d.getTimezoneOffset()) {
                    clocks.push([`${String(t.localtime ?? 'Local').toUpperCase()} ${hms(d)}`, P.text, false]);
                }
            } else {
                clocks.push([`${String(t.localtime ?? 'Local').toUpperCase()} ${hms(d)}`, P.text, false]);
            }
            let right = [[host, P.beam, true], ...clocks, [`${String(t.uptime ?? 'Uptime').toUpperCase()} ${dur(now - this.t0)}`, P.text, false]];
            g.font = `${Z.title}px ${this.mono}`;
            const sep = Math.round(Z.title * 1.6), widthOf = (list) => list.reduce((a, r) => a + g.measureText(r[0]).width + sep, 0);
            while (right.length > 2 && widthOf(right) > pw - x - 40) { right.splice(1, 1); }
            let rx = pw - Z.pad - 6;
            g.textAlign = 'right';
            for (let i = right.length - 1; i >= 0; i--) {
                const [txt, col, bold] = right[i];
                g.font = `${bold ? '700 ' : ''}${Z.title}px ${this.mono}`; g.fillStyle = css(col, bold ? 1 : 0.85);
                g.fillText(txt, rx, y); rx -= g.measureText(txt).width + sep;
                if (i) { g.fillStyle = css(P.beam, 0.4); g.fillRect(rx + sep / 2, y - Z.title * 0.5, 1, Z.title); }
            }
            // status light
            const lc = this._levelColor(R.lvl), lr = Math.max(3.5, Z.title * 0.28);
            g.fillStyle = css(lc); g.beginPath(); g.arc(rx + sep / 2 - lr, y, lr, 0, TAU); g.fill();
            g.shadowColor = css(lc); g.shadowBlur = lr * 2.5; g.fill(); g.shadowBlur = 0;
        });
        if (rm) { return; }
        const dpr = window.devicePixelRatio || 1;
        if (boot < 1) {
            // boot: the title types itself in; the rest of the bar fades in
            const vis = Math.round(w * Math.min(1, boot * 1.5));
            c.save(); c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000'; c.fillRect(vis, 0, w - vis, h); c.restore();
            c.fillStyle = css(P.beam, 0.9); c.fillRect(Math.min(vis, (e.nameEnd || 0) + 4), h * 0.25, 3 * Math.max(1, s), h * 0.5);
            if (((now / 60) | 0) % 3 === 0) { c.drawImage(e.cv, 0, 0, Math.round(vis * dpr), e.cv.height, (Math.random() - 0.5) * 6 * s, 0, vis, h); }
            return;
        }
        // light glitch every ~5 s: a shifted additive copy of the strip for ~90 ms
        const ph = now % 5000;
        if (ph < 90) {
            c.save(); c.globalCompositeOperation = P.dark ? 'lighter' : 'multiply'; c.globalAlpha = 0.35;
            c.drawImage(e.cv, 0, 0, e.cv.width, e.cv.height, (ph < 45 ? -3 : 3) * s, (ph < 45 ? 1 : -1), w, h);
            c.restore();
        }
    }

    // firewall services at risk: posture, totals and the worst services with CVE counts by severity
    _exposurePanel(now) {
        const P = this.P, t = this.host.translations || {}, ex = this.L.exposure, E = this._expoData(), Z = this.FZ, pad = Z.pad;
        if (!E) { return; }
        // repainted at ~8 Hz for a moment after an attempt on an exposed service (the row blinks), else at 1 Hz
        const blink = !this.host.reducedMotion && now - this.expoHitAt < 1000;
        this._cached('exposure', ex.x, ex.y, ex.w, ex.h, now, blink ? 120 : 1000, (g, pw, ph, e) => {
            const y0 = this._frame(g, pw, ph, t.exposure ?? 'Exposure'), sm = E.summary || {};
            // cross with the live log: inbound attempts on each service's port (5 min); "exposed and under attack"
            // (reachable + attempts) goes to the top of the list
            const base = this._expoList(E), att = new Map();
            for (const o of base) { att.set(o, this._attempts(o, now)); }
            const hot = (o) => (CyberView._reachable(o) && att.get(o).n > 0 ? 0 : 1);
            const list = base.slice().sort((a, b) => hot(a) - hot(b));
            const nHot = list.filter((o) => hot(o) === 0).length;
            const posture = String(sm.posture || 'hardened');
            const pc = posture === 'critical' ? P.block : posture === 'exposed' ? mix(P.block, P.beam, 0.45) : P.pass;
            const name = posture === 'critical' ? (t.pcritical ?? 'Critical') : posture === 'exposed' ? (t.pexposed ?? 'Exposed') : (t.phardened ?? 'Hardened');
            g.textBaseline = 'middle'; g.textAlign = 'left';
            const bh = Math.round(Z.label * 1.8);
            let y = y0 + bh / 2;
            g.fillStyle = css(pc, 0.18); g.fillRect(pad, y - bh / 2, pw - 2 * pad, bh);
            g.fillStyle = css(pc); g.fillRect(pad, y - bh / 2, 3, bh);
            g.font = `800 ${Z.label}px ${this.font}`;
            const nw = this._spaced(g, String(name).toUpperCase(), pad + 8, y, 1.5);
            g.textAlign = 'right'; g.font = `${Z.label}px ${this.mono}`; g.fillStyle = css(P.text, 0.9);
            const summary = `${(Number(sm.reachable) || 0) + (Number(sm.maybe_reachable) || 0)}/${sm.services ?? E.services.length} ${t.reach ?? 'reachable'} · ${sm.cves_total ?? 0} CVE${sm.kev ? ` · ${sm.kev} KEV` : ''}`;
            if (nHot) {
                const ua = ` · ${nHot} ${t.underattack ?? 'under attack'}`;
                g.font = `700 ${Z.label}px ${this.mono}`; g.fillStyle = css(P.block);
                const uw = Math.min(g.measureText(ua).width, pw - 3 * pad - nw - 8);
                g.fillText(this._fit(g, ua, uw), pw - pad - 4, y);
                g.font = `${Z.label}px ${this.mono}`; g.fillStyle = css(P.text, 0.9);
                g.fillText(this._fit(g, summary, pw - 3 * pad - nw - 8 - uw), pw - pad - 4 - uw, y);
            } else {
                g.fillText(this._fit(g, summary, pw - 3 * pad - nw - 8), pw - pad - 4, y);
            }
            const rh = Math.round(Z.row * 1.75);
            y += bh / 2 + 4;
            const n = this._rows(ph - y - 4, rh, list.length);
            const sevC = [P.block, mix(P.block, P.beam, 0.45), P.beam, mix(P.text, P.bg, 0.4)];
            const sevOf = (o) => (o.sev >= 3 ? sevC[0] : o.sev === 2 ? sevC[1] : o.sev === 1 ? sevC[2] : null);
            g.font = `700 ${Z.label}px ${this.mono}`;
            const chip = Math.max(Z.label * 1.5, g.measureText('00').width + 6);
            for (let i = 0; i < n; i++) {
                const o = list[i], yy = y + i * rh + rh / 2, a = att.get(o), isHot = hot(o) === 0, dim = !CyberView._reachable(o);
                // exposed and under attack: alert background; every new attempt flashes the row for a moment
                const fl = blink && a.last > now - 900 ? 1 - (now - a.last) / 900 : 0;
                if (isHot || fl > 0) {
                    g.fillStyle = css(P.block, Math.min(0.6, (isHot ? 0.22 : 0) + 0.35 * fl));
                    g.fillRect(pad - 4, yy - rh / 2 + 1, pw - 2 * pad + 8, rh - 2);
                    if (isHot) { g.fillStyle = css(P.block); g.fillRect(pad - 4, yy - rh / 2 + 1, 3, rh - 2); }
                }
                const reach = o.reach === 'yes' ? P.block : o.reach === 'maybe' ? P.beam : mix(P.text, P.bg, 0.5);
                g.fillStyle = css(reach); g.beginPath(); g.arc(pad + 3, yy, 3, 0, TAU); g.fill();
                // chips on the right: CVEs by severity when known, else the CVE total (colored by severity) and KEV
                g.font = `700 ${Z.label}px ${this.mono}`; g.textAlign = 'center';
                let rx = pw - pad;
                // not reachable from the internet: the chips are only outlined and grey (low risk)
                const chipAt = (txt, bg, fg, wmin) => {
                    const cw = Math.max(wmin, g.measureText(txt).width + 8);
                    if (dim) {
                        g.strokeStyle = css(P.text, 0.3); g.lineWidth = 1;
                        g.strokeRect(rx - cw + 0.5, yy - Z.label * 0.7 + 0.5, cw - 1, Z.label * 1.4 - 1);
                        g.fillStyle = css(P.text, 0.5);
                    } else {
                        g.fillStyle = bg; g.fillRect(rx - cw, yy - Z.label * 0.7, cw, Z.label * 1.4);
                        g.fillStyle = fg;
                    }
                    g.fillText(txt, rx - cw / 2, yy + 0.5);
                    rx -= cw + 3;
                };
                if (o.sevs) {
                    for (let q = 3; q >= 0; q--) { const v = o.sevs[q]; chipAt(String(v), v ? css(sevC[q], 0.9) : css(P.text, 0.08), v ? '#fff' : css(P.text, 0.4), chip); }
                    if (o.kev) { chipAt('KEV', css(P.block), '#fff', chip); }
                } else {
                    if (o.kev) { chipAt(`KEV ${o.kev}`, css(P.block), '#fff', chip); }
                    const sc = sevOf(o);
                    chipAt(`${o.total} CVE`, o.total ? css(sc || sevC[2], 0.9) : (sc ? css(sc, 0.25) : css(P.text, 0.08)), o.total ? '#fff' : css(P.text, sc ? 0.85 : 0.45), chip);
                }
                // attempts on this port in the last 5 min
                if (a.n) {
                    g.font = `700 ${Z.label}px ${this.mono}`; g.textAlign = 'right';
                    const txt = `⚡ ${a.n}`;
                    g.fillStyle = css(isHot ? (P.dark ? mix(P.block, [255, 255, 255], 0.25) : P.block) : mix(P.block, P.text, 0.35));
                    g.fillText(txt, rx - 2, yy + 0.5);
                    rx -= g.measureText(txt).width + 8;
                    g.textAlign = 'center';
                }
                // name :port, then an ADMIN tag
                g.textAlign = 'left'; g.font = `700 ${Z.small}px ${this.font}`;
                const admW = o.admin ? g.measureText('ADMIN').width + 6 : 0;
                g.font = `${Z.row}px ${this.mono}`; g.fillStyle = css(P.text, 0.95);
                const label = this._fit(g, `${o.name}${o.port ? ' :' + o.port : ''}`, Math.max(20, rx - pad - 12 - admW - 6));
                g.fillText(label, pad + 12, yy);
                if (o.admin) { const lw = g.measureText(label).width; g.font = `700 ${Z.small}px ${this.font}`; g.fillStyle = css(mix(P.block, P.beam, 0.45)); g.fillText('ADMIN', pad + 12 + lw + 5, yy); }
                e.rows.push({ y0: yy - rh / 2, y1: yy + rh / 2, sv: o });
            }
        });
    }

    // compact live hardware block: CPU, memory and WAN throughput (host.telemetry, feature-detected)
    _system(c, now, T) {
        const P = this.P, t = this.host.translations || {}, L = this.L, sy = L.system, Z = this.FZ, pad = Z.pad;
        this._cached('system', sy.x, sy.y, sy.w, sy.h, now, 1000, (g, pw, ph) => {
            const y0 = this._frame(g, pw, ph, t.system ?? 'System');
            g.textBaseline = 'middle';
            const mono = `${Z.sys}px ${this.mono}`, lab = `700 ${Z.sys}px ${this.font}`;
            if (!T || !T.cpu) {
                g.textAlign = 'left'; g.font = mono; g.fillStyle = css(P.text, 0.5); g.fillText('—', pad, y0 + Z.sys);
                return;
            }
            const wansAll = (T.wan || []).slice().sort((a, b) => ((b.in_bps || 0) + (b.out_bps || 0)) - ((a.in_bps || 0) + (a.out_bps || 0)));
            // CPU and MEM take one line each; every WAN needs two lines of numbers
            const avail = ph - y0 - 6, minLine = Math.round(Z.sys * 2.4), minWan = Math.round(Z.sys * 2.7);
            const nW = Math.max(0, Math.min(2, wansAll.length, Math.floor((avail - 2 * minLine) / minWan)));
            // spread the rows over the panel height (up to 1.5x their minimum)
            const k = Math.min(1.5, avail / (2 * minLine + nW * minWan || 1)), line = Math.round(minLine * k), wanLine = Math.round(minWan * k);
            const wans = wansAll.slice(0, nW);
            g.font = lab;
            const lx = pad, labW = Math.max(g.measureText('CPU').width, g.measureText('MEM').width, ...wans.map((wn) => g.measureText(String(wn.name || wn.key || 'WAN').toUpperCase().slice(0, 6)).width)) + 10;
            // CPU: small arc + number + 60 s sparkline
            let y = y0 + line / 2;
            const cpu = T.cpu, pct = clamp01((cpu.total || 0) / 100), r = Math.max(6, Z.sys * 0.62);
            g.textAlign = 'left'; g.fillStyle = css(P.text, 0.75); g.fillText('CPU', lx, y);
            const ax = lx + labW + r;
            g.lineCap = 'round';
            g.beginPath(); g.arc(ax, y, r, Math.PI * 0.75, Math.PI * 2.25); g.strokeStyle = css(P.text, 0.15); g.lineWidth = 3; g.stroke();
            g.beginPath(); g.arc(ax, y, r, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 1.5 * pct); g.strokeStyle = css(pct > 0.85 ? P.block : P.beam, 0.95); g.stroke();
            g.lineCap = 'butt';
            g.font = mono; g.fillStyle = css(P.text, 0.95);
            const pctTxt = `${Math.round(pct * 100)}%`;
            g.fillText(pctTxt, ax + r + 6, y);
            const spx = ax + r + 6 + g.measureText('100%').width + 8;
            this._spark(g, spx, y - line * 0.36, pw - spx - pad, line * 0.72, cpu.hist || [], P.beam, 100);
            // MEM: thin bar (used + ARC as cache) on top, used/total and cache under it
            y = y0 + line * 1.5;
            const mem = T.mem || {}, tot = mem.total_mb || 1, arc = mem.arc_mb || 0, used = Math.max(0, (mem.used_mb || 0) - arc);
            g.font = lab; g.fillStyle = css(P.text, 0.75); g.fillText('MEM', lx, y);
            const bx = lx + labW, bw = pw - bx - pad, by = y - line * 0.3;
            g.fillStyle = css(P.text, 0.12); g.fillRect(bx, by, bw, 4);
            g.fillStyle = css(P.beam, 0.9); g.fillRect(bx, by, bw * clamp01(used / tot), 4);
            g.fillStyle = css(mix(P.beam, [255, 255, 255], 0.5), 0.55); g.fillRect(bx + bw * clamp01(used / tot), by, bw * clamp01(arc / tot), 4);
            g.font = mono; g.fillStyle = css(P.text, 0.95); g.textAlign = 'left';
            const memTxt = `${(used / 1024).toFixed(1)}/${(tot / 1024).toFixed(1)} GB`;
            g.fillText(memTxt, bx, y + line * 0.12);
            if (arc) {
                g.textAlign = 'right'; g.fillStyle = css(P.text, 0.6);
                g.fillText(this._fit(g, `${(arc / 1024).toFixed(1)} GB ${t.cache ?? 'cache'}`, bw - g.measureText(memTxt).width - 10), bx + bw, y + line * 0.12);
            }
            // WAN: name, two sparklines (in / out) and the numbers, one block per WAN (the busiest first)
            g.font = mono;
            const numW = g.measureText('↓000.0 Mb/s').width + 4;
            wans.forEach((wn, i) => {
                const yy = y0 + line * 2 + wanLine * (i + 0.5);
                g.font = lab; g.textAlign = 'left'; g.fillStyle = css(P.text, 0.75);
                g.fillText(String(wn.name || wn.key || 'WAN').toUpperCase().slice(0, 6), lx, yy);
                const sx = lx + labW, sw = Math.max(10, (pw - sx - pad - numW - 6) / 2 - 3), sh = wanLine * 0.62;
                this._spark(g, sx, yy - sh / 2, sw, sh, wn.hist_in || [], P.pass, 0);
                this._spark(g, sx + sw + 6, yy - sh / 2, sw, sh, wn.hist_out || [], P.nat, 0);
                g.font = mono; g.textAlign = 'right';
                g.fillStyle = css(P.pass); g.fillText(`↓${bps(wn.in_bps || 0)}`, pw - pad, yy - Z.sys * 0.6);
                g.fillStyle = css(P.nat); g.fillText(`↑${bps(wn.out_bps || 0)}`, pw - pad, yy + Z.sys * 0.6);
            });
            if (!wans.length) { g.font = lab; g.textAlign = 'left'; g.fillStyle = css(P.text, 0.75); g.fillText('WAN —', lx, y0 + line * 2.5); }
        });
    }

    /* ------------------------------------------------------------------ AI analyst (read only) */

    // The Policy Analyzer plugin (optional) answers /api/policyanalyzer/ai/brief with a short situational brief
    // written by the configured AI from aggregates of the last 15 min (log, exposure, findings). Text only: nothing
    // here or in the backend blocks anything. Without the plugin (404/403) the panel does not exist; with the AI
    // disabled only a small "AI off" mark is drawn. Never simulated.

    _aiUsable() {
        const A = this.ai;
        return this.fs && A.avail === true && !!A.rec && A.rec.status !== 'disabled';
    }

    // the record shown: the focus answer while a focus address is open, else the general brief
    _aiRec() { const A = this.ai; return A.focus ? A.focusRec : A.rec; }

    _aiDirty() { const e = this.caches.get('ai'); if (e) { e.at = -1e9; } }

    static _aiClean(rec) {
        if (!rec || typeof rec !== 'object') { return null; }
        const r = Object.assign({}, rec);
        for (const k of ['text', 'message', 'model', 'focus', 'status']) { r[k] = unesc(r[k]); }
        r._fetched = Date.now();
        return r;
    }

    // age (s) of the stored brief, counted on from the moment it was fetched
    static _aiAge(rec) {
        if (!rec || rec.age_seconds == null) { return null; }
        return Number(rec.age_seconds) + (Date.now() - (rec._fetched || Date.now())) / 1000;
    }

    // Once per fullscreen frame (the host stops the frames in a hidden tab and in edit mode, so nothing is asked
    // then): the stored brief every 60 s (10 s while one is generated); a refresh at most every 10 min and only when
    // the stored one is older than that. A focus ("Ask AI") is asked only after a click on its button.
    _aiTick(now) {
        const A = this.ai;
        if (A.avail === false || A.inflight || document.hidden) { return; }
        if (A.focus && A.askRetry && now >= A.askRetry) {
            // a click on "Ask AI" (or the AI was busy with another brief): ask, and keep asking for 10 min at most
            A.askRetry = 0;
            if (now - A.askAt < AI_ASK_MAX) { this._aiRefresh(A.focus); }
            return;
        }
        const rec = this._aiRec(), running = !!rec && rec.status === 'running';
        if (now - A.lastCached >= (running ? AI_POLL_RUN : AI_POLL)) { this._aiCached(); return; }
        const g = A.rec;
        if (!A.focus && g && g.status !== 'disabled' && g.status !== 'running' && !g.busy && now - A.lastRefresh >= AI_REFRESH) {
            const age = CyberView._aiAge(g);
            if (g.status !== 'ok' || age == null || age >= (Number(g.refresh_interval) || 600)) { this._aiRefresh(null); }
        }
    }

    async _aiCached() {
        const A = this.ai, focus = A.focus;
        A.inflight = true; A.lastCached = performance.now();
        try {
            const r = await fetch(AI_URL + (focus ? '?focus=' + encodeURIComponent(focus) : ''), { credentials: 'same-origin', headers: { Accept: 'application/json' } });
            if (r.status === 404 || r.status === 401 || r.status === 403) { A.avail = false; return; }
            if (!r.ok) { throw new Error('HTTP ' + r.status); }
            if (!(r.headers.get('content-type') || '').includes('json')) { A.avail = false; return; }   // login page etc.
            const rec = CyberView._aiClean(await r.json());
            if (!rec || !rec.status) { throw new Error('unexpected answer'); }
            A.avail = true; A.err = null;
            if (focus) { if (A.focus === focus) { A.focusRec = rec; } } else { A.rec = rec; }
        } catch (e) {
            A.err = String((e && e.message) || e);         // transient: the next poll tries again
        } finally {
            A.inflight = false; this._aiDirty();
        }
    }

    async _aiRefresh(focus) {
        const A = this.ai, h = this.host, body = JSON.stringify(focus ? { mode: 'refresh', focus } : { mode: 'refresh' });
        A.inflight = true;
        if (!focus) { A.lastRefresh = performance.now(); }
        try {
            let d;
            if (typeof h.ajaxCall === 'function') {
                // BaseWidget.ajaxCall (jQuery): the page's ajaxSetup adds the CSRF token a POST needs
                d = await h.ajaxCall(AI_URL, body, 'POST');
            } else {
                const r = await fetch(AI_URL, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body });
                if (!r.ok) { throw new Error('HTTP ' + r.status); }
                d = await r.json();
            }
            const rec = CyberView._aiClean(d);
            if (!rec || !rec.status) { throw new Error('unexpected answer'); }
            A.err = null;
            if (focus) {
                if (A.focus !== focus) { return; }
                A.focusRec = rec;
                A.askRetry = rec.busy && rec.status !== 'running' ? performance.now() + AI_RETRY : 0;
            } else { A.rec = rec; }
            A.lastCached = performance.now();             // this answer is the current state
        } catch (e) {
            const x = e && e.xhr;
            A.err = x ? 'HTTP ' + x.status : String((e && e.message) || e);
            if (focus && A.focus === focus) { A.focusRec = { status: 'error', message: A.err, focus, _fetched: Date.now() }; }
        } finally {
            A.inflight = false; this._aiDirty();
        }
    }

    _aiAsk(ip) {
        const A = this.ai, now = performance.now();
        A.focus = ip; A.focusRec = { status: 'running', focus: ip, _fetched: Date.now() }; A.askAt = now; A.askRetry = now;
    }

    // words wrapped to maxW (font), at most maxLines (the last one gets an ellipsis); cached per text/width/font
    _aiWrap(c, text, maxW, font, maxLines) {
        const A = this.ai, key = `${text}|${Math.round(maxW)}|${font}|${maxLines}`;
        if (A.wrapKey === key) { return A.wrap; }
        c.save(); c.font = font;
        const lines = [];
        let cur = '', cut = false;
        for (const word of String(text).split(/\s+/).filter(Boolean)) {
            const cand = cur ? cur + ' ' + word : word;
            if (!cur || c.measureText(cand).width <= maxW) { cur = cand; continue; }
            lines.push(cur); cur = word;
            if (lines.length >= maxLines) { cut = true; break; }
        }
        if (!cut && cur) { lines.push(cur); }
        if (lines.length > maxLines) { lines.length = maxLines; cut = true; }
        if (cut && lines.length) { lines[lines.length - 1] = this._fit(c, lines[lines.length - 1] + ' …', maxW); }
        for (let i = 0; i < lines.length; i++) { if (c.measureText(lines[i]).width > maxW) { lines[i] = this._fit(c, lines[i], maxW); } }
        c.restore();
        lines.cut = cut;
        A.wrapKey = key; A.wrap = lines;
        return lines;
    }

    _aiAgeText(sec, t) {
        if (sec < 60) { return t.ainow ?? 'just now'; }
        const m = Math.floor(sec / 60);
        return String(t.aiago ?? '%s ago').replace('%s', m < 60 ? `${m} min` : `${Math.floor(m / 60)} h`);
    }

    // AI ANALYST: a slim panel docked at the bottom of the scene (over the near grid, under the core), sized to
    // its text (at most ~30% of the scene height). Meta line (state, model, age), the brief, and when an address
    // was picked (click on a blocked blip, trail or attacker) the buttons Ask AI / Live log / close.
    _aiPanel(c, now) {
        const A = this.ai, P = this.P, t = this.host.translations || {}, Z = this.FZ, pad = Z.pad, sc = this.L.scene, s = this.s;
        if (A.avail !== true || !A.rec) { this.caches.delete('ai'); return; }
        const G = Math.max(4, Math.round(6 * s));
        if (A.rec.status === 'disabled') {
            this.caches.delete('ai');
            c.save(); c.font = `700 ${Z.small}px ${this.font}`; c.textAlign = 'left'; c.textBaseline = 'bottom';
            c.fillStyle = css(P.text, 0.45); this._spaced(c, String(t.aioff ?? 'AI off').toUpperCase(), sc.x0 + G + 4, sc.y1 - G, 1.5);
            c.restore();
            return;
        }
        const r = this._aiRec() || { status: 'running' };
        const w = Math.round(Math.min(sc.x1 - sc.x0 - 2 * G, Math.max(420, 700 * s))), x = Math.round((sc.x0 + sc.x1 - w) / 2);
        const lh = Math.round(Z.row * 1.42), metaH = Math.round(Z.small * 1.8), btnH = Math.round(Z.small * 2.2);
        const head = Math.round(Z.head * 1.3 + 16);          // what _frame takes
        const showBtns = !!(A.sel || A.focus), btnsH = showBtns ? btnH + 10 : 0;
        const maxH = Math.round((sc.y1 - sc.y0) * 0.3), font = `${Z.row}px ${this.font}`;
        const maxLines = Math.max(1, Math.floor((maxH - head - metaH - btnsH - 8) / lh));
        const lines = r.text ? this._aiWrap(c, r.text, w - 2 * pad, font, maxLines) : [];
        const h = head + metaH + Math.max(1, lines.length) * lh + btnsH + 6, y = Math.round(sc.y1 - G - h);
        const running = r.status === 'running' || !!A.askRetry, anim = running && !this.host.reducedMotion;
        this._cached('ai', x, y, w, h, now, anim ? 120 : 1000, (g, pw, ph, e) => {
            const y0 = this._frame(g, pw, ph, `${t.aianalyst ?? 'AI analyst'}${A.focus ? ' · ' + A.focus : ''}`);
            g.textBaseline = 'middle'; g.textAlign = 'left';
            const my = y0 + metaH / 2 - 3;
            let mx = pad;
            if (running) {
                const queued = !!(r.busy || (A.askRetry && A.focusRec && A.focusRec.busy));
                g.font = `700 ${Z.small}px ${this.font}`; g.fillStyle = css(P.beam);
                mx += this._spaced(g, String(queued ? (t.aiqueued ?? 'queued') : (t.aianalyzing ?? 'analyzing')).toUpperCase(), mx, my, 1.5);
                g.fillText(anim ? '.'.repeat(1 + (Math.floor(now / 350) % 3)) : '…', mx + 2, my);
                mx += g.measureText('...').width + 12;
                if (anim) {
                    // a scan bar runs along the title rule while the model works
                    const bw = pw * 0.2, bx = ((now / 1700) % 1) * (pw + bw) - bw, x0 = Math.max(1, bx), x1 = Math.min(pw - 1, bx + bw);
                    if (x1 > x0) { g.fillStyle = css(P.beam, 0.8); g.fillRect(x0, y0 - 9, x1 - x0, 2); }
                }
            } else if (r.status === 'error') {
                g.font = `700 ${Z.small}px ${this.font}`; g.fillStyle = css(P.block);
                mx += this._spaced(g, String(t.aierror ?? 'AI error').toUpperCase(), mx, my, 1.5) + 12;
            }
            const parts = [], age = CyberView._aiAge(r);
            if (r.status === 'error' && r.message) { parts.push(r.message); }
            if (r.model) { parts.push(String(r.model)); }
            if (age != null && r.text) { parts.push(this._aiAgeText(age, t)); }
            if (r.status === 'ok' && r.seconds != null) { parts.push(`${Math.round(Number(r.seconds))} s`); }
            if (A.err && r.status !== 'error') { parts.push(A.err); }
            g.font = `${Z.small}px ${this.mono}`; g.fillStyle = css(r.status === 'error' ? P.block : P.text, r.status === 'error' ? 0.85 : 0.62);
            g.fillText(this._fit(g, parts.join(' · '), Math.max(10, pw - mx - pad)), mx, my);
            // the brief (the previous one, dimmed, while a new one is generated or after an error)
            const ty = y0 + metaH + lh / 2;
            g.font = font;
            if (lines.length) {
                g.fillStyle = css(P.text, running || r.status === 'error' ? 0.55 : 0.93);
                lines.forEach((ln, i) => g.fillText(ln, pad, ty + i * lh));
            } else {
                g.fillStyle = css(P.text, 0.5);
                const msg = running || r.status === 'none' ? (A.focus ? (t.aiwaitfocus ?? 'Looking at this address…') : (t.aiwaiting ?? 'Preparing the first brief…')) : (t.ainone ?? 'No brief yet.');
                g.fillText(this._fit(g, msg, pw - 2 * pad), pad, ty);
            }
            if (!showBtns) { return; }
            // buttons: [◎ ip] ASK AI · LIVE LOG ↗ · × (focus open: LIVE LOG ↗ · ← general brief)
            const by = ph - btnH - 8;
            let bx = pad;
            const ip = A.focus || A.sel;
            g.font = `700 ${Z.row}px ${this.mono}`; g.fillStyle = css(P.block);
            if (!A.focus) { const lbl = `◎ ${ip}`; g.fillText(this._fit(g, lbl, pw * 0.4), bx, by + btnH / 2); bx += Math.min(pw * 0.4, g.measureText(lbl).width) + 12; }
            const btn = (label, id, kind) => {
                g.font = `700 ${Z.small}px ${this.font}`;
                const bw = this._spacedWidth(g, label, 1) + 18;
                if (bx + bw > pw - pad) { return; }
                if (kind === 'main') {
                    g.fillStyle = css(P.beam, 0.92); g.fillRect(bx, by, bw, btnH); g.fillStyle = P.dark ? 'rgba(0,0,0,0.92)' : '#fff';
                } else {
                    const col = kind === 'off' ? P.text : P.beam;
                    g.strokeStyle = css(col, kind === 'off' ? 0.3 : 0.75); g.lineWidth = 1; g.strokeRect(bx + 0.5, by + 0.5, bw - 1, btnH - 1);
                    g.fillStyle = css(col, kind === 'off' ? 0.4 : 0.95);
                }
                this._spaced(g, label, bx + 9, by + btnH / 2 + 0.5, 1);
                if (kind !== 'off') { e.rows.push({ x0: bx, x1: bx + bw, y0: by, y1: by + btnH, btn: id }); }
                bx += bw + 8;
            };
            if (!A.focus) { btn(String(t.aiask ?? 'Ask AI').toUpperCase(), 'ask', 'main'); }
            btn(`${String(t.ailog ?? 'Live log').toUpperCase()} ↗`, 'log', 'plain');
            btn(A.focus ? `← ${String(t.aiback ?? 'General brief').toUpperCase()}` : '×', 'close', 'plain');
        });
    }

    _aiHtml(t) {
        const A = this.ai, r = this._aiRec() || {};
        let html = `<b>${esc(t.aianalyst ?? 'AI analyst')}</b>${A.focus ? ' · <span style="font-family:var(--bs-font-monospace,monospace)">' + esc(A.focus) + '</span>' : ''}<br>`;
        if (r.generated_at) {
            let when = String(r.generated_at);
            try { when = new Date(r.generated_at).toLocaleString(); } catch (e) { /* keep ISO */ }
            html += `${esc(t.aigenerated ?? 'Generated')}: ${esc(when)}${r.seconds != null ? ' · ' + Math.round(Number(r.seconds)) + ' s' : ''}<br>`;
        }
        if (r.model) { html += `${esc(t.aimodel ?? 'Model')}: ${esc(r.model)}<br>`; }
        if (A.wrap && A.wrap.cut && r.text) { html += `<div style="max-width:420px;white-space:normal;margin:4px 0">${esc(r.text)}</div>`; }
        return html + `<span style="opacity:.75">${esc(t.aiscope ?? 'From aggregates of the last 15 min, anonymized. Text only: nothing is blocked or changed.')}</span>`;
    }

    // host hook (Sonar.js _onClick): true when the click was handled here (no Live View tab is opened)
    click(hv) {
        if (!hv || !this.fs) { return false; }
        const A = this.ai;
        if (hv.ai) {
            const ip = A.focus || A.sel;
            if (hv.ai === 'ask' && A.sel) {
                this._aiAsk(A.sel);
            } else if (hv.ai === 'log' && ip) {
                window.open('/ui/diagnostics/firewall/log#' + new URLSearchParams({ field: 'src', operator: '=', value: ip }), '_blank', 'noopener');
            } else if (hv.ai === 'close') {
                if (A.focus) { A.focus = null; A.focusRec = null; A.askRetry = 0; } else { A.sel = null; }
                A.lastCached = -1e9;
            }
            this._aiDirty();
            return true;
        }
        if (hv.aiIp && this._aiUsable()) {
            A.sel = hv.aiIp;
            if (A.focus && A.focus !== hv.aiIp) { A.focus = null; A.focusRec = null; A.askRetry = 0; A.lastCached = -1e9; }
            this._aiDirty();
            return true;
        }
        return false;
    }

    /* ------------------------------------------------------------------ interaction */

    hit(mx, my) {
        if (!this.drawn) { return null; }
        const h = this.host, t = h.translations || {}, k = h.colors || {}, P = this.P;
        const mono = 'font-family:var(--bs-font-monospace,monospace)';
        this.hover = null;
        // AI ANALYST panel (on top of the scene): buttons, else the brief's details
        const aiE = this.fs ? this.caches.get('ai') : null;
        if (aiE && mx >= aiE.x && mx <= aiE.x + aiE.w && my >= aiE.y && my <= aiE.y + aiE.h) {
            const lx = mx - aiE.x, ly = my - aiE.y;
            const b = aiE.rows.find((r) => r.btn && lx >= r.x0 && lx <= r.x1 && ly >= r.y0 && ly <= r.y1);
            if (b) {
                const tips = { ask: t.aiasktip ?? 'Ask the AI about this address (one short answer, nothing is blocked)', log: t.ailogtip ?? 'Open this address in the Live View', close: this.ai.focus ? (t.aiback ?? 'General brief') : (t.aiclose ?? 'Close') };
                return { html: esc(tips[b.btn]), ai: b.btn, cursor: 'pointer' };
            }
            return { html: this._aiHtml(t) };
        }
        // a blocked inbound address can be picked for the AI analyst (click), when the AI answers
        const aiPick = this._aiUsable() ? (t.aiselect ?? 'click: pick for the AI analyst') : null;
        // trails: head within 10 px
        let best = null, dist = 100;
        for (const tr of this.trails) {
            if (!tr.on) { continue; }
            const d = (tr.pts[0] - mx) ** 2 + (tr.pts[1] - my) ** 2;
            if (d < dist) { dist = d; best = tr; }
        }
        if (best) {
            this.hover = { trail: best };
            return { html: this._ipHtml(best.ip, best.inbound, best.act, best.port, best.proto, best.label, this._cc(best), 1, t, k, mono) + (best.iface ? `<span style="opacity:.7">${esc(t.interface ?? 'Interface')}:</span> ${esc(best.iface)}<br>` : ''),
                open: { field: best.inbound ? 'src' : 'dst', value: best.ip }, cursor: 'pointer',
                ...(aiPick && best.inbound && best.act === 'block' && best.ip ? { aiIp: best.ip, hint: aiPick } : {}) };
        }
        // radar blips
        for (let i = this.blips.length - 1; i >= 0; i--) {
            const b = this.blips[i];
            if (b.x === undefined || (b.x - mx) ** 2 + (b.y - my) ** 2 > 36) { continue; }
            this.hover = { blip: b };
            return { html: this._ipHtml(b.ip, true, 'block', b.port, '', '', this._cc(b), 1, t, k, mono), open: { field: 'src', value: b.ip }, cursor: 'pointer',
                ...(aiPick && b.ip ? { aiIp: b.ip, hint: aiPick } : {}) };
        }
        // planets (deep space): nearest centre within the radius (+5 px); one behind the globe only outside its disc
        if (this.scene !== 'grid' && this.planets.length) {
            let bp = null, bd = Infinity;
            for (const p of this.planets) {
                if (p.a < 0.3 || !p.rec) { continue; }
                const d = (p.sx - mx) ** 2 + (p.sy - my) ** 2, lim = (p.sr + 5) ** 2;
                if (d > lim || d / lim >= bd) { continue; }
                if (p.wz > this.zc && (this.cx - mx) ** 2 + (this.cy - my) ** 2 < this.Rpx * this.Rpx) { continue; }
                bd = d / lim; bp = p;
            }
            if (bp) {
                const r = bp.rec;
                this.hover = { planet: bp };
                return { html: this._planetHtml(r, t, k, mono), open: { field: r.inb >= r.out ? 'src' : 'dst', value: r.ip }, cursor: 'pointer',
                    ...(aiPick ? { aiIp: r.ip, hint: aiPick } : {}) };
            }
        }
        // shield cells (front, nearest centre first)
        const C = this.cc, F = this.front, Pp = this.cp;
        let ci = -1; dist = Infinity;
        for (let i = 0; i < NCELLS; i++) {
            if (!F[i] || !this.cells[i].key) { continue; }
            if (!inConvex(Pp, i * 12, 6, mx, my)) { continue; }
            const d = (C[i * 3] - mx) ** 2 + (C[i * 3 + 1] - my) ** 2;
            if (d < dist) { dist = d; ci = i; }
        }
        if (ci < 0) {
            let lim = 100;
            for (let i = 0; i < NCELLS; i++) {
                if (!F[i] || !this.cells[i].key) { continue; }
                const d = (C[i * 3] - mx) ** 2 + (C[i * 3 + 1] - my) ** 2;
                if (d < lim) { lim = d; ci = i; }
            }
        }
        if (ci >= 0) {
            const cell = this.cells[ci];
            this.hover = { cell };
            const cc = cell.last ? this._cc({ ip: cell.last }) : null;
            const html =
                `<span style="opacity:.7">${esc(t.service ?? 'Service')}</span><br><b style="color:${k.beam}">${esc(cell.key)}${cell.svc ? ' ' + esc(cell.svc) : ''}</b><br>` +
                `${esc(t.hits ?? 'Hits')}: <b>${cell.n}</b> · <span style="color:${k.block}">${esc(t.blocked ?? 'blocked')}: ${cell.c.block}</span>` +
                ` · <span style="color:${k.pass}">${esc(t.passed ?? 'passed')}: ${cell.c.pass}</span>` +
                (cell.c.nat ? ` · <span style="color:${k.nat}">${esc(t.nat ?? 'NAT')}: ${cell.c.nat}</span>` : '') +
                (cell.last ? `<br><span style="opacity:.7">${esc(t.lastsources ?? 'Last sources')}:</span> ${cc ? this._flag(cc) + ' ' : ''}<span style="${mono}">${esc(cell.last)}</span>` : '') +
                (this.expo && this.expo.has(cell.key) ? '<br>' + this._svHtml(this.expo.get(cell.key).sv, t, k) : '');
            return { html, open: cell.port ? { field: 'dstport', value: cell.port } : null, cursor: cell.port ? 'pointer' : undefined };
        }
        // fullscreen panel rows (attackers, ports)
        if (this.fs) {
            const inRow = (name) => {
                const e = this.caches.get(name);
                if (!e || mx < e.x || mx > e.x + e.w || my < e.y || my > e.y + e.h) { return null; }
                return e.rows.find((r) => my - e.y >= r.y0 && my - e.y <= r.y1) || null;
            };
            const a = inRow('attackers');
            if (a) {
                return { html: this._ipHtml(a.ip, true, 'block', a.port, '', '', a.cc, a.n, t, k, mono), open: { field: 'src', value: a.ip }, cursor: 'pointer',
                    ...(aiPick && a.ip ? { aiIp: a.ip, hint: aiPick } : {}) };
            }
            const x = inRow('exposure');
            if (x && x.sv) {
                const port = x.sv.port;
                return { html: this._svHtml(x.sv, t, k), open: port ? { field: 'dstport', value: port } : null, cursor: port ? 'pointer' : undefined };
            }
            const p = inRow('ports');
            if (p && p.cell) {
                const cell = p.cell;
                return { html: `<b style="color:${k.beam}">${esc(cell.key)}${cell.svc ? ' ' + esc(cell.svc) : ''}</b><br>${esc(t.hits ?? 'Hits')}: <b>${cell.n}</b> · <span style="color:${k.block}">${esc(t.blocked ?? 'blocked')}: ${cell.c.block}</span>`,
                    open: cell.port ? { field: 'dstport', value: cell.port } : null, cursor: cell.port ? 'pointer' : undefined };
            }
        }
        return null;
    }

    // tooltip of a normalized exposure service (see _norm)
    _svHtml(o, t, k) {
        const r = o.reach;
        const reach = r === 'yes' ? (t.ryes ?? 'reachable from the internet') : r === 'maybe' ? (t.rmaybe ?? 'maybe reachable') : (t.lowrisk ?? 'not reachable from the internet: low risk');
        const a = this._attempts(o, performance.now());
        const attack = a.n ? `<br><b style="color:${k.block}">⚡ ${a.n}</b> ${esc(t.attempts ?? 'inbound attempts (5 min)')}` +
            (r === 'yes' || r === 'maybe' ? ` · <b style="color:${k.block}">${esc(t.exposedattack ?? 'exposed and under attack')}</b>` : '') : '';
        const cves = o.sevs
            ? `CVE: <b style="color:${k.block}">${o.sevs[0]}</b> ${esc(t.crit ?? 'critical')} · <b>${o.sevs[1]}</b> ${esc(t.highs ?? 'high')} · ${o.sevs[2]} ${esc(t.medium ?? 'medium')} · ${o.sevs[3]} ${esc(t.lows ?? 'low')}`
            : `CVE: <b>${o.total}</b>${o.findSev ? ` · <span style="opacity:.75">${esc(t.finding ?? 'worst finding')}:</span> <b style="color:${o.findSev === 'high' ? k.block : k.text}">${esc(o.findSev)}</b>` : ''}`;
        return `<b>${esc(o.name)}</b>${o.port ? ' :' + esc(o.port) : ''}${o.proto ? ' ' + esc(o.proto) : ''}` +
            (o.kev ? ` <b style="color:${k.block}">KEV ${o.kev}</b>` : '') + (o.admin ? ` <b>${esc(t.admin ?? 'admin')}</b>` : '') +
            `<br><span style="opacity:.75">${esc(reach)}${o.scope ? ' · ' + esc(o.scope) : ''}</span><br>` + cves + attack;
    }

    _ipHtml(ip, inbound, act, port, proto, label, cc, n, t, k, mono) {
        const h = this.host;
        let place;
        if (cc) {
            let name = h.worldMap && h.worldMap[cc] && h.worldMap[cc].n;
            if (!name) { try { name = new Intl.DisplayNames(undefined, { type: 'region' }).of(cc); } catch (e) { name = null; } }
            place = `${esc(name || cc)} (${esc(cc)})`;
        } else {
            place = esc(cc === null ? (t.nogeo ?? 'LAN/IPv6') : '…');
        }
        const col = k[act] || k.text, name = t[act] ?? (act === 'other' ? 'Match' : act);
        return `<span style="font-size:16px">${cc ? this._flag(cc) : '🌐'}</span> <b style="${mono}">${esc(ip)}</b><br>` +
            `${place} · ${esc(inbound ? (t.inbound ?? 'Inbound') : (t.outbound ?? 'Outbound'))}<br>` +
            `<b style="color:${col}">${esc(name)}</b>${port ? ` · <span style="${mono}">:${esc(port)}${proto ? ' ' + esc(proto) : ''}</span>` : ''}` +
            (n > 1 ? ` · ${esc(t.hits ?? 'Hits')}: <b>${n}</b>` : '') + '<br>' +
            (label ? `${esc(label)}<br>` : '');
    }
}
