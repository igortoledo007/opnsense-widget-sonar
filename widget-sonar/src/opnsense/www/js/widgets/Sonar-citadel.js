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
 * Sonar CITADEL view (Nexo project, Igor Toledo), loaded on demand by Sonar.js.
 *
 * The network as an isometric city under an energy dome:
 * District = interface (at most 4 shown: the busiest ones, ordered by name).
 * Building = local host (at most 9 per district, 3x3 grid); height = sqrt of its recent weight (decays ~60 s).
 * Windows  = light up in the theme accent with the host's activity and all blink on every event.
 * Events   = inbound blocked: meteor hitting the dome above the district (ripple, cracks, sparks);
 *            outbound passed/NAT: beam rising from the roof through the dome;
 *            outbound blocked: beam stopped under the dome with a red spark;
 *            inbound passed/NAT: beam coming down from the sky to the roof.
 * Meteors and beams are off with reduced motion. Plain 2D canvas, bounded arrays, no libraries.
 */

const TAU = 60000;                       // weight decay constant (ms)
const MAX_DISTRICTS = 12, MAX_HOSTS = 40, SHOW_DISTRICTS = 4, SLOTS = 9;
const MAX_METEORS = 24, MAX_BEAMS = 60, MAX_IMPACTS = 24;
const LIVE_MS = 1500;                    // only events newer than this are animated
const SLOT_ORDER = [4, 1, 3, 5, 7, 0, 2, 6, 8];   // fill the middle of the district first
const LOT = 9, CELL = 3, FOOT = 1.9, INSET = (CELL - FOOT) / 2, GAP = 1.4, FLOOR = 0.55;
// district positions in a 2x2 lot grid (x, y), by number of districts shown
const LOTPOS = [[[0, 0]], [[0, 0]], [[1, 0], [0, 1]], [[1, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [0, 1], [1, 1]]];
// geodesic frame of the dome
const GEO_N = 16, GEO_ROWS = 5;
// facade textures: activity levels x variants, covering MAX_FLOORS floors
const MAX_FLOORS = 12, LEVELS = 6, VARIANTS = 4, TEX_Z = 0.3 + MAX_FLOORS * FLOOR;
const SPRITE_PAD = 2;                    // px around a building sprite (edge strokes)

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function parseRgb(s) {
    const m = String(s || '').match(/[\d.]+/g);
    if (!m || m.length < 3) { return null; }
    return [+m[0], +m[1], +m[2], m.length > 3 ? +m[3] : 1];
}

function mixRgb(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function css(c, a = 1) {
    return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
}

function hash32(x) {
    x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
    x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
    return (x ^ (x >>> 16)) >>> 0;
}

function hashStr(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
}

// exponentially decayed weight of a {w, t} record at time `now`
const decayed = (o, now) => o.w * Math.exp(-(now - o.t) / TAU);

// add one unit of weight at time t (events can arrive out of order when the history is replayed)
function bump(o, t) {
    if (t >= o.t) { o.w = o.w * Math.exp(-(t - o.t) / TAU) + 1; o.t = t; }
    else { o.w += Math.exp(-(o.t - t) / TAU); }
}

export default class CitadelView {
    constructor(host) {
        this.host = host;
        this.districts = new Map();      // iface -> district
        this.shown = [];                 // visible districts, by name
        this.order = [];                 // visible buildings, back to front
        this.meteors = [];
        this.beams = [];
        this.impacts = [];
        this.nextMeteor = 0;
        this.lastLayout = -1e9;
        this.lastFrame = 0;
        this.dirty = true;
        this.geoN = -1;                  // number of districts the geometry was built for
        this.kRef = null;
        this.domeHit = -1e9;
        this.font = null;
    }

    /* ------------------------------------------------------------------ data */

    add(ev) {
        const now = performance.now();
        const t = typeof ev.now === 'number' ? Math.min(ev.now, now) : now;
        const name = String(ev.iface || '?');
        let d = this.districts.get(name);
        if (!d) {
            d = { name, w: 0, t, n: 0, block: 0, hit: -1e9, hosts: new Map(), slots: new Array(SLOTS).fill(null),
                  vis: false, idx: -1, aw: 0 };
            this.districts.set(name, d);
            if (this.districts.size > MAX_DISTRICTS) { this._evictDistrict(d, now); }
            this.dirty = true;
        }
        bump(d, t);
        d.n++;
        if (ev.action === 'block') { d.block++; }

        const ip = String(ev.local || '?');
        let b = d.hosts.get(ip);
        if (!b) {
            b = { ip, d, w: 0, t, n: 0, pass: 0, block: 0, nat: 0, flash: -1e9, nextBeam: 0, seed: hashStr(ip),
                  slot: -1, h: 0, target: 0, act: 0, x0: 0, y0: 0, cap: 0, cx: 0, cyC: 0, hex: new Float32Array(12), drawn: false,
                  lastIn: false, lastRemote: '', lastPort: '', lastProto: '' };
            d.hosts.set(ip, b);
            if (d.hosts.size > MAX_HOSTS) { this._evictHost(d, b, now); }
            this.dirty = true;
        }
        bump(b, t);
        b.n++;
        if (ev.action === 'pass' || ev.action === 'block' || ev.action === 'nat') { b[ev.action]++; }
        b.lastIn = !!ev.inbound;
        b.lastRemote = String(ev.remote ?? '');
        b.lastPort = ev.port !== '' && ev.port != null ? String(ev.port) : '';
        b.lastProto = String(ev.proto || '');
        if (b.slot < 0) { this.dirty = true; }

        const recent = t > now - LIVE_MS;
        if (!recent) { return; }
        b.flash = now;
        if (this.host.reducedMotion) { return; }
        if (ev.inbound && ev.action === 'block') {
            if (this.meteors.length >= MAX_METEORS) { return; }
            // bursts arrive one after another instead of as a clump
            const t0 = Math.max(now, this.nextMeteor);
            if (t0 - now > LIVE_MS) { return; }
            this.nextMeteor = t0 + 90;
            const ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
            this.meteors.push({ d, t0, dur: 650 + Math.random() * 350, ang, dist: 0.55 + Math.random() * 0.35 });
        } else {
            if (this.beams.length >= MAX_BEAMS) { return; }
            const t0 = Math.max(now, b.nextBeam);
            if (t0 - now > LIVE_MS) { return; }
            b.nextBeam = t0 + 140;
            const kind = ev.inbound ? 'down' : (ev.action === 'block' ? 'stop' : 'up');
            const action = ev.action === 'nat' ? 'nat' : (ev.action === 'block' ? 'block' : 'pass');
            this.beams.push({ b, t0, kind, action, dur: kind === 'stop' ? 1000 : 1100,
                              sparks: kind === 'stop' ? this._sparks(7, 20, 40) : null });
        }
    }

    _sparks(n, v0, dv) {
        const s = new Float32Array(n * 2);
        for (let i = 0; i < n; i++) { s[i * 2] = Math.random() * Math.PI * 2; s[i * 2 + 1] = v0 + Math.random() * dv; }
        return s;
    }

    _evictDistrict(keep, now) {
        let low = null, lw = Infinity;
        for (const d of this.districts.values()) {
            if (d === keep) { continue; }
            const w = decayed(d, now);
            if (w < lw) { lw = w; low = d; }
        }
        if (!low) { return; }
        this.districts.delete(low.name);
        this.meteors = this.meteors.filter((m) => m.d !== low);
        this.beams = this.beams.filter((bm) => bm.b.d !== low);
    }

    _evictHost(d, keep, now) {
        let low = null, lw = Infinity;
        for (const b of d.hosts.values()) {
            if (b === keep) { continue; }
            const w = decayed(b, now);
            if (w < lw) { lw = w; low = b; }
        }
        if (!low) { return; }
        if (low.slot >= 0) { d.slots[low.slot] = null; low.slot = -1; this.dirty = true; }
        d.hosts.delete(low.ip);
        this.beams = this.beams.filter((bm) => bm.b !== low);
    }

    /* ------------------------------------------------------------------ geometry */

    resize() {
        this.geoN = -1;
        this.font = null;
        this.dirty = true;
    }

    // world (x, y on the ground, z up) -> screen, 2:1 isometric
    _sx(x, y) { return this.cx + (x - y) * this.u; }
    _sy(x, y, z) { return this.cy + (x + y - this.S) * this.u * 0.5 - z * this.u; }

    // height of the dome surface above a ground point
    _domeZ(x, y) {
        const dx = x - this.S / 2, dy = y - this.S / 2;
        const q = 1 - (dx * dx + dy * dy) / (this.rW * this.rW);
        return q > 0 ? this.HW * Math.sqrt(q) : 0;
    }

    _geom(n) {
        const host = this.host, w = host.w, h = host.h;
        this.geoN = n;
        this.S = n >= 2 ? 2 * LOT + GAP : LOT;
        const S = this.S;
        this.rW = 1.28 * S / Math.SQRT2;
        this.HW = 0.66 * this.rW;
        // fit: width 2*rx = 2*sqrt2*u*rW; height ry + Rv = u*(rW/sqrt2 + sqrt(rW^2/2 + HW^2))
        const fw = 2 * Math.SQRT2 * this.rW, fh = this.rW / Math.SQRT2 + Math.sqrt(this.rW * this.rW / 2 + this.HW * this.HW);
        this.u = Math.max(0.5, Math.min((w * 0.94) / fw, (h * 0.9) / fh));
        const u = this.u;
        this.rx = Math.SQRT2 * u * this.rW;
        this.ry = this.rx / 2;
        this.Hs = u * this.HW;
        this.Rv = Math.sqrt(this.ry * this.ry + this.Hs * this.Hs);
        this.cx = w / 2;
        this.cy = Math.min(h - this.ry - 4, (h + this.Rv - this.ry) / 2 + h * 0.02);
        const cx = this.cx, cy = this.cy, rx = this.rx, ry = this.ry, Hs = this.Hs;

        // dome outline: upper half of the silhouette ellipse + front half of the base
        const sil = new Path2D();
        sil.ellipse(cx, cy, rx, this.Rv, 0, Math.PI, Math.PI * 2);
        sil.ellipse(cx, cy, rx, ry, 0, 0, Math.PI);
        sil.closePath();
        this.silhouette = sil;

        // geodesic frame: rows of points with a half step offset, joined into triangles, split front/back
        const pt = (row, i) => {
            const phi = row >= GEO_ROWS ? Math.PI / 2 : (row / GEO_ROWS) * (Math.PI / 2);
            const th = ((i + row * 0.5) / GEO_N) * Math.PI * 2;
            return [cx + rx * Math.cos(phi) * Math.cos(th), cy + ry * Math.cos(phi) * Math.sin(th) - Hs * Math.sin(phi), th];
        };
        const front = new Path2D(), back = new Path2D();
        const seg = (a, b, thMid) => {
            const p = Math.sin(thMid) > 0 ? front : back;
            p.moveTo(a[0], a[1]); p.lineTo(b[0], b[1]);
        };
        for (let r = 1; r < GEO_ROWS; r++) {
            for (let i = 0; i < GEO_N; i++) {
                const a = pt(r, i), b = pt(r, i + 1);
                seg(a, b, (a[2] + b[2]) / 2);
            }
        }
        for (let r = 0; r < GEO_ROWS - 1; r++) {
            for (let i = 0; i < GEO_N; i++) {
                const a = pt(r, i), b = pt(r + 1, i), c = pt(r + 1, i - 1);
                seg(a, b, (a[2] + b[2]) / 2);
                seg(a, c, (a[2] + c[2]) / 2);
            }
        }
        const top = pt(GEO_ROWS, 0);
        for (let i = 0; i < GEO_N; i += 2) {
            const a = pt(GEO_ROWS - 1, i);
            seg(a, top, a[2]);
        }
        this.frameFront = front; this.frameBack = back;
        const baseBack = new Path2D(); baseBack.ellipse(cx, cy, rx, ry, 0, Math.PI, Math.PI * 2);
        const baseFront = new Path2D(); baseFront.ellipse(cx, cy, rx, ry, 0, 0, Math.PI);
        this.baseBack = baseBack; this.baseFront = baseFront;

        // tallest building that fits under the dome in every slot (uniform scale across the city)
        let hmax = 3.4 * FOOT;
        const lots = LOTPOS[Math.max(1, n)];
        for (const [gx, gy] of lots) {
            for (let s = 0; s < SLOTS; s++) {
                const [x0, y0] = this._slotXY(gx, gy, s);
                hmax = Math.min(hmax, this._slotCap(x0, y0));
            }
        }
        this.hmax = hmax;
        this.geoVer = (this.geoVer || 0) + 1;
    }

    _slotXY(gx, gy, s) {
        const ox = gx * (LOT + GAP), oy = gy * (LOT + GAP);
        return [ox + (s % 3) * CELL + INSET, oy + Math.floor(s / 3) * CELL + INSET];
    }

    _slotCap(x0, y0) {
        // lowest dome point over the footprint corners, with some clearance
        const z = Math.min(this._domeZ(x0, y0), this._domeZ(x0 + FOOT, y0), this._domeZ(x0, y0 + FOOT), this._domeZ(x0 + FOOT, y0 + FOOT));
        return z * 0.82;
    }

    // facade textures for the current palette (one per activity level and variant, plus the all-lit blink)
    _textures() {
        const dpr = window.devicePixelRatio || 1;
        if (this.tex && this.tex.pal === this.palVer && this.tex.dpr === dpr) { return this.tex; }
        const P = this.P, R = Math.round(24 * dpr), W = Math.ceil(FOOT * R), H = Math.ceil(TEX_Z * R);
        const make = (lit) => {
            const cv = document.createElement('canvas');
            cv.width = W; cv.height = H;
            const c = cv.getContext('2d');
            for (let f = 0; f < MAX_FLOORS; f++) {
                const zb = 0.3 + f * FLOOR, zt = zb + 0.3;
                for (let col = 0; col < 3; col++) {
                    c.fillStyle = lit(f, col);
                    c.fillRect((0.18 + col * 0.56) * R, (TEX_Z - zt) * R, 0.34 * R, 0.3 * R);
                }
            }
            return cv;
        };
        const lv = [];
        for (let l = 0; l < LEVELS; l++) {
            const density = 0.1 + 0.72 * (l / (LEVELS - 1)), row = [];
            for (let v = 0; v < VARIANTS; v++) {
                row.push(make((f, col) => (hash32(Math.imul(v + 1, 0x9e3779b1) ^ (f * 4 + col + 1) * 0x85ebca6b) / 4294967296 < density ? P.winLit : P.winDark)));
            }
            lv.push(row);
        }
        this.tex = { pal: this.palVer, dpr, R, W, lv, flash: make(() => P.winFlash) };
        return this.tex;
    }

    _palette() {
        const host = this.host, k = host.colors;
        if (k === this.kRef && host.dark === this.darkRef) { return; }
        this.kRef = k; this.darkRef = host.dark;
        const dark = !!host.dark;
        let bg = parseRgb(k.bg);
        if (!bg || bg[3] < 0.5) { bg = dark ? [24, 28, 35, 1] : [246, 247, 249, 1]; }
        const text = parseRgb(k.text) || (dark ? [225, 228, 232] : [33, 37, 41]);
        const beam = parseRgb(k.beam) || [80, 140, 255];
        const m = (t) => mixRgb(mixRgb(bg, text, t), beam, 0.06);
        const P = {
            dark, bg: css(bg),
            top: css(m(dark ? 0.36 : 0.16)),
            left: css(m(dark ? 0.23 : 0.30)),
            right: css(m(dark ? 0.14 : 0.44)),
            edge: css(mixRgb(bg, text, dark ? 0.55 : 0.08), dark ? 0.35 : 0.7),
            winDark: css(mixRgb(bg, text, dark ? 0.04 : 0.62), dark ? 0.55 : 0.35),
            winLit: css(beam, 0.92),
            winFlash: css(mixRgb(beam, [255, 255, 255], 0.55), 1),
            lot: css(text, dark ? 0.07 : 0.06),
            lotLine: css(text, dark ? 0.10 : 0.12),
            lotEdge: css(beam, dark ? 0.30 : 0.38),
            halo: dark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.8)',
            label: css(text, 0.8),
            muted: css(text, 0.5)
        };
        this.P = P;
        this.palVer = (this.palVer || 0) + 1;
    }

    // the static parts (ground, lots, both halves of the dome) are drawn once into two offscreen layers
    _layers() {
        const host = this.host;
        const key = `${this.geoVer}|${this.palVer}|${this.lotKey}|${host.w}x${host.h}`;
        if (key === this.layerKey) { return; }
        this.layerKey = key;
        const dpr = window.devicePixelRatio || 1;
        const W = Math.max(1, Math.round(host.w * dpr)), H = Math.max(1, Math.round(host.h * dpr));
        const prep = (cv) => {
            cv = cv || document.createElement('canvas');
            cv.width = W; cv.height = H;
            const x = cv.getContext('2d');
            x.setTransform(dpr, 0, 0, dpr, 0, 0);
            x.lineCap = 'round'; x.lineJoin = 'round';
            return cv;
        };
        this.backLayer = prep(this.backLayer);
        this.frontLayer = prep(this.frontLayer);
        const k = host.colors, P = this.P, dark = P.dark, wa = (col, a) => host._withAlpha(col, a);

        // back: ground, inner glow (stronger near the rim), back of the frame and of the base, lots
        let c = this.backLayer.getContext('2d');
        let g = c.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, this.rx);
        g.addColorStop(0, wa(k.beam, dark ? 0.10 : 0.07));
        g.addColorStop(1, wa(k.text, dark ? 0.03 : 0.025));
        c.fillStyle = g;
        c.beginPath(); c.ellipse(this.cx, this.cy, this.rx, this.ry, 0, 0, Math.PI * 2); c.fill();
        g = c.createRadialGradient(this.cx, this.cy - this.Hs * 0.35, this.rx * 0.15, this.cx, this.cy - this.Hs * 0.2, this.rx * 1.05);
        g.addColorStop(0, wa(k.beam, 0));
        g.addColorStop(0.7, wa(k.beam, dark ? 0.035 : 0.03));
        g.addColorStop(1, wa(k.beam, dark ? 0.16 : 0.12));
        c.fillStyle = g; c.fill(this.silhouette);
        c.lineWidth = 0.8;
        c.strokeStyle = wa(k.beam, dark ? 0.10 : 0.13); c.stroke(this.frameBack);
        c.lineWidth = 1.2;
        c.strokeStyle = wa(k.beam, 0.25); c.stroke(this.baseBack);
        for (const d of this.shown) { this._drawLot(c, d); }

        // front: specular highlight (top left), front of the frame, rim and front of the base
        c = this.frontLayer.getContext('2d');
        g = c.createRadialGradient(this.cx - this.rx * 0.38, this.cy - this.Hs * 0.72, 0, this.cx - this.rx * 0.38, this.cy - this.Hs * 0.72, this.rx * 0.55);
        g.addColorStop(0, `rgba(255,255,255,${dark ? 0.07 : 0.22})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.fill(this.silhouette);
        c.lineWidth = 0.9;
        c.strokeStyle = wa(k.beam, dark ? 0.16 : 0.2); c.stroke(this.frameFront);
        c.lineWidth = 1.4;
        c.strokeStyle = wa(k.beam, dark ? 0.45 : 0.55); c.stroke(this.silhouette);
        c.strokeStyle = wa(k.beam, 0.5); c.stroke(this.baseFront);
    }

    /* ------------------------------------------------------------------ layout */

    _layout(now) {
        this.lastLayout = now;
        this.dirty = false;
        const all = [...this.districts.values()];
        for (const d of all) { d.aw = decayed(d, now); d.vis = false; d.idx = -1; }
        all.sort((a, b) => b.aw - a.aw);
        const shown = all.slice(0, SHOW_DISTRICTS).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        shown.forEach((d, i) => { d.vis = true; d.idx = i; });
        // hidden districts free their buildings
        for (const d of all) {
            if (d.vis) { continue; }
            for (let s = 0; s < SLOTS; s++) { if (d.slots[s]) { d.slots[s].slot = -1; d.slots[s] = null; } }
        }
        if (shown.length !== this.geoN && !(shown.length <= 1 && this.geoN === 1)) { this._geom(Math.max(1, shown.length)); }
        else if (this.geoN < 0) { this._geom(1); }
        this.shown = shown;
        this.lotKey = shown.map((d) => d.name).join('\u0001');
        const lots = LOTPOS[Math.max(1, this.geoN)];
        const order = [];
        let wmax = 0;
        const stamp = now;
        for (const d of shown) {
            const hosts = [...d.hosts.values()];
            for (const b of hosts) { b.aw = decayed(b, now); }
            hosts.sort((a, b) => b.aw - a.aw);
            const top = hosts.slice(0, SLOTS);
            for (const b of top) { b.top = stamp; }
            for (let s = 0; s < SLOTS; s++) {
                const o = d.slots[s];
                if (o && o.top !== stamp) { o.slot = -1; d.slots[s] = null; }
            }
            for (const b of top) {
                if (b.slot >= 0) { continue; }
                for (const s of SLOT_ORDER) {
                    if (!d.slots[s]) { d.slots[s] = b; b.slot = s; b.h = -1; break; }
                }
            }
            const [gx, gy] = lots[d.idx] || lots[0];
            d.ox = gx * (LOT + GAP); d.oy = gy * (LOT + GAP); d.gx = gx; d.gy = gy;
            for (const b of top) {
                const [x0, y0] = this._slotXY(gx, gy, b.slot);
                b.x0 = x0; b.y0 = y0;
                b.cap = this._slotCap(x0, y0);
                const mx = x0 + FOOT / 2, my = y0 + FOOT / 2;
                b.cx = this._sx(mx, my);
                b.cyC = this._sy(mx, my, this._domeZ(mx, my));
                wmax = Math.max(wmax, b.aw);
                order.push(b);
            }
        }
        for (const b of order) {
            const f = wmax > 0 ? Math.sqrt(b.aw / wmax) : 0;
            b.act = wmax > 0 ? b.aw / wmax : 0;
            b.target = Math.min(b.cap, 0.7 + (this.hmax - 0.7) * f);
            // the first city appears built; later newcomers rise from the ground
            if (this.host.reducedMotion || (b.h < 0 && this.built !== true)) { b.h = b.target; }
            else if (b.h < 0) { b.h = 0; }
        }
        order.sort((a, b) => (a.x0 + a.y0) - (b.x0 + b.y0));
        this.order = order;
        if (order.length) { this.built = true; }
    }

    /* ------------------------------------------------------------------ drawing */

    draw(now) {
        const host = this.host, c = host.ctx;
        if (!c || !host.colors || !(host.w > 0) || !(host.h > 0)) { return; }
        this._palette();
        if (this.geoN < 0 || this.dirty || now - this.lastLayout > 250) { this._layout(now); }
        this._layers();
        if (!this.font) { this.font = getComputedStyle(host.el).fontFamily || 'sans-serif'; }
        const dt = Math.min(200, Math.max(0, now - (this.lastFrame || now)));
        this.lastFrame = now;
        const P = this.P, k = host.colors, motion = !host.reducedMotion;
        if (!motion && (this.meteors.length || this.beams.length || this.impacts.length)) {
            this.meteors.length = 0; this.beams.length = 0; this.impacts.length = 0;
        }

        c.clearRect(0, 0, host.w, host.h);
        c.save();
        c.lineCap = 'round'; c.lineJoin = 'round';

        // ground, lots and the back of the dome; lots that were just hit glow red
        c.drawImage(this.backLayer, 0, 0, host.w, host.h);
        for (const d of this.shown) {
            const hf = Math.max(0, 1 - (now - d.hit) / 800);
            if (hf > 0 && d.dia) {
                const q = d.dia;
                c.beginPath(); c.moveTo(q[0], q[1]); c.lineTo(q[2], q[3]); c.lineTo(q[4], q[5]); c.lineTo(q[6], q[7]); c.closePath();
                c.fillStyle = host._withAlpha(k.block, 0.22 * hf); c.fill();
            }
        }

        // buildings back to front, each followed by its beams so nearer buildings hide them correctly
        const ease = Math.min(1, dt / 260);
        for (const b of this.order) {
            if (motion) { b.h += (b.target - b.h) * ease; } else { b.h = b.target; }
            this._drawBuilding(b, now, motion);
            if (motion && this.beams.length) { this._drawBeams(b, now); }
        }
        for (const d of this.districts.values()) {
            for (const b of d.hosts.values()) { if (b.slot < 0) { b.drawn = false; } }
        }
        if (this.beams.length) { this.beams = this.beams.filter((bm) => now - bm.t0 < bm.dur && (bm.b.slot >= 0 || now < bm.t0 + 400)); }

        // front of the dome
        c.drawImage(this.frontLayer, 0, 0, host.w, host.h);
        const hitF = motion ? Math.max(0, 1 - (now - this.domeHit) / 500) : 0;
        if (hitF > 0) {
            // the whole shield flares for a moment after a meteor strike
            c.lineWidth = 0.9; c.strokeStyle = host._withAlpha(k.beam, 0.25 * hitF); c.stroke(this.frameFront);
            c.lineWidth = 1.4; c.strokeStyle = host._withAlpha(k.beam, 0.4 * hitF); c.stroke(this.silhouette);
        }

        this._drawLabels();
        if (motion) {
            if (this.meteors.length) { this._drawMeteors(now); }
            if (this.impacts.length) { this._drawImpacts(now); }
        }
        c.restore();
    }

    _drawLot(c, d) {
        const P = this.P, ox = d.ox, oy = d.oy, L = LOT;
        const x = (a, b) => this._sx(a, b), y = (a, b) => this._sy(a, b, 0);
        c.beginPath();
        c.moveTo(x(ox, oy), y(ox, oy)); c.lineTo(x(ox + L, oy), y(ox + L, oy));
        c.lineTo(x(ox + L, oy + L), y(ox + L, oy + L)); c.lineTo(x(ox, oy + L), y(ox, oy + L)); c.closePath();
        c.fillStyle = P.lot; c.fill();
        c.lineWidth = 1; c.strokeStyle = P.lotEdge; c.stroke();
        // streets between the cells
        c.beginPath();
        for (let i = 1; i < 3; i++) {
            const s = i * CELL;
            c.moveTo(x(ox + s, oy), y(ox + s, oy)); c.lineTo(x(ox + s, oy + L), y(ox + s, oy + L));
            c.moveTo(x(ox, oy + s), y(ox, oy + s)); c.lineTo(x(ox + L, oy + s), y(ox + L, oy + s));
        }
        c.strokeStyle = P.lotLine; c.stroke();
        // remember the diamond for hover
        d.dia = [x(ox, oy), y(ox, oy), x(ox + L, oy), y(ox + L, oy), x(ox + L, oy + L), y(ox + L, oy + L), x(ox, oy + L), y(ox, oy + L)];
    }

    // a building is painted into its own sprite, repainted only when its look changes (height in whole
    // pixels, activity level, twinkle step, blink); every frame just copies the sprites back to front
    _drawBuilding(b, now, motion) {
        const c = this.host.ctx, u = this.u;
        const hp = Math.max(1, Math.round(Math.max(0.05, b.h) * u)), h = hp / u;
        const fa = now - b.flash;
        const blink = motion && fa < 360 && (fa < 130 || fa > 220);
        const lvl = Math.min(LEVELS - 1, Math.round(b.act * (LEVELS - 1)));
        const bucket = motion ? Math.floor((now + (b.seed % 4500)) / 4500) : 0;
        const dpr = window.devicePixelRatio || 1;
        const x0 = b.x0, y0 = b.y0, x1 = x0 + FOOT, y1 = y0 + FOOT;
        const left = this._sx(x0, y1), top = this._sy(x0, y0, h);
        // whole-pixel placement keeps the per-frame copy a plain 1:1 blit
        const ox = Math.floor(left) - SPRITE_PAD, oy = Math.floor(top) - SPRITE_PAD;
        const sp = b.sprite || (b.sprite = { cv: null, hp: -1 });
        if (sp.hp !== hp || sp.lvl !== lvl || sp.bucket !== bucket || sp.blink !== blink || sp.geo !== this.geoVer ||
            sp.pal !== this.palVer || sp.dpr !== dpr || sp.left !== left) {
            const W = left - ox + 2 * FOOT * u + SPRITE_PAD + 1, H = top - oy + FOOT * u + hp + SPRITE_PAD + 1;
            const cv = sp.cv || (sp.cv = document.createElement('canvas'));
            const pw = Math.ceil(W * dpr), ph = Math.ceil(H * dpr);
            if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; } else { cv.getContext('2d').clearRect(0, 0, pw, ph); }
            const sc = cv.getContext('2d');
            sc.setTransform(dpr, 0, 0, dpr, -dpr * ox, -dpr * oy);
            this._paintBuilding(sc, b, h, blink, lvl, bucket);
            Object.assign(sp, { hp, lvl, bucket, blink, geo: this.geoVer, pal: this.palVer, dpr, left, ox, oy, W: pw / dpr, H: ph / dpr });
        }
        c.drawImage(sp.cv, sp.ox, sp.oy, sp.W, sp.H);

        const X = (a, bb) => this._sx(a, bb);
        const mx = x0 + FOOT / 2, my = y0 + FOOT / 2;
        b.roofX = X(mx, my); b.roofY = this._sy(mx, my, h);
        // beacon on the roof right after an event
        const fl = motion ? Math.max(0, 1 - fa / 600) : 0;
        if (fl > 0) {
            const r = 2 + 6 * fl;
            const g = c.createRadialGradient(b.roofX, b.roofY, 0, b.roofX, b.roofY, r);
            g.addColorStop(0, this.host._withAlpha(this.host.colors.beam, 0.75 * fl));
            g.addColorStop(1, this.host._withAlpha(this.host.colors.beam, 0));
            c.fillStyle = g; c.beginPath(); c.arc(b.roofX, b.roofY, r, 0, Math.PI * 2); c.fill();
        }
        // silhouette hexagon for hover
        const hx = b.hex;
        hx[0] = left; hx[1] = this._sy(x0, y1, 0); hx[2] = X(x1, y1); hx[3] = this._sy(x1, y1, 0);
        hx[4] = X(x1, y0); hx[5] = this._sy(x1, y0, 0); hx[6] = hx[4]; hx[7] = this._sy(x1, y0, h);
        hx[8] = X(x0, y0); hx[9] = top; hx[10] = left; hx[11] = this._sy(x0, y1, h);
        b.drawn = true;
    }

    // the box itself, in screen coordinates: three shaded faces, facade windows and crisp edges
    _paintBuilding(c, b, h, blink, lvl, bucket) {
        const P = this.P, u = this.u;
        const x0 = b.x0, y0 = b.y0, x1 = x0 + FOOT, y1 = y0 + FOOT;
        const X = (a, bb) => this._sx(a, bb);
        const ax = X(x0, y1), ay0 = this._sy(x0, y1, 0), ayh = this._sy(x0, y1, h);   // left
        const fx = X(x1, y1), fy0 = this._sy(x1, y1, 0), fyh = this._sy(x1, y1, h);   // front
        const rx = X(x1, y0), ry0 = this._sy(x1, y0, 0), ryh = this._sy(x1, y0, h);   // right
        const bx = X(x0, y0), byh = this._sy(x0, y0, h);                                // back (roof only)
        // left face (+y)
        c.beginPath(); c.moveTo(ax, ay0); c.lineTo(fx, fy0); c.lineTo(fx, fyh); c.lineTo(ax, ayh); c.closePath();
        c.fillStyle = P.left; c.fill();
        // right face (+x)
        c.beginPath(); c.moveTo(fx, fy0); c.lineTo(rx, ry0); c.lineTo(rx, ryh); c.lineTo(fx, fyh); c.closePath();
        c.fillStyle = P.right; c.fill();
        // roof
        c.beginPath(); c.moveTo(ax, ayh); c.lineTo(fx, fyh); c.lineTo(rx, ryh); c.lineTo(bx, byh); c.closePath();
        c.fillStyle = P.top; c.fill();

        // windows: pre-rendered facade textures (3 columns, one row per floor) mapped with the face's affine
        // transform; density follows the activity, the pattern changes now and then (twinkle) and turns fully
        // lit for a blink on a fresh event
        const floors = Math.min(MAX_FLOORS, Math.floor((h - 0.25) / FLOOR));
        if (floors > 0 && u * 0.3 >= 1.5) {
            const tx = this._textures();
            const zc = 0.3 + (floors - 1) * FLOOR + 0.34, R = tx.R;
            const sy = (TEX_Z - zc) * R, sh = zc * R;
            for (let face = 0; face < 2; face++) {
                const img = blink ? tx.flash : tx.lv[lvl][(b.seed + bucket + face * 3) % VARIANTS];
                const ex = face === 0 ? ax : fx, ey = face === 0 ? ay0 : fy0;
                c.save();
                c.transform(u / R, (face === 0 ? 0.5 : -0.5) * u / R, 0, u / R, ex, ey - u * TEX_Z);
                c.drawImage(img, 0, sy, tx.W, sh, 0, sy, tx.W, sh);
                c.restore();
            }
        }
        // crisp edges: roof rim and the front vertical edge
        c.beginPath(); c.moveTo(ax, ayh); c.lineTo(fx, fyh); c.lineTo(rx, ryh); c.lineTo(bx, byh); c.closePath();
        c.moveTo(fx, fyh); c.lineTo(fx, fy0);
        c.lineWidth = 0.8; c.lineJoin = 'round'; c.strokeStyle = P.edge; c.stroke();
    }

    _drawBeams(b, now) {
        const c = this.host.ctx, host = this.host, k = host.colors;
        const yTop = -30;
        for (const bm of this.beams) {
            if (bm.b !== b) { continue; }
            const p = (now - bm.t0) / bm.dur;
            if (p < 0 || p >= 1) { continue; }
            const x = b.roofX, yR = b.roofY, yC = Math.min(b.cyC, yR - 2);
            const col = k[bm.action];
            let head, tail, fade = 1;
            if (bm.kind === 'up') {
                const e = (q) => q * q;
                head = yR + (yTop - yR) * e(Math.min(1, p * 1.25));
                tail = yR + (yTop - yR) * e(Math.max(0, p * 1.25 - 0.35));
                fade = p > 0.8 ? (1 - p) / 0.2 : 1;
            } else if (bm.kind === 'down') {
                const e = (q) => 1 - (1 - q) * (1 - q);
                head = yTop + (yR - yTop) * e(Math.min(1, p * 1.4));
                tail = yTop + (yR - yTop) * e(Math.max(0, p * 1.4 - 0.45));
                fade = p > 0.75 ? (1 - p) / 0.25 : 1;
            } else {
                // rises, hits the inside of the dome and retracts
                const e = (q) => 1 - (1 - q) * (1 - q);
                head = yR + (yC - yR) * e(Math.min(1, p / 0.4));
                tail = yR + (yC - yR) * e(Math.min(1, Math.max(0, (p - 0.15) / 0.55)));
                fade = p > 0.7 ? (1 - p) / 0.3 : 1;
            }
            if (Math.abs(head - tail) > 1) {
                const g = c.createLinearGradient(x, tail, x, head);
                g.addColorStop(0, host._withAlpha(col, 0));
                g.addColorStop(1, host._withAlpha(col, 0.95 * fade));
                c.strokeStyle = g;
                c.globalAlpha = 0.28; c.lineWidth = 5; c.beginPath(); c.moveTo(x, tail); c.lineTo(x, head); c.stroke();
                c.globalAlpha = 1; c.lineWidth = 1.8; c.stroke();
                c.fillStyle = `rgba(255,255,255,${0.85 * fade})`;
                c.beginPath(); c.arc(x, head, 1.6, 0, Math.PI * 2); c.fill();
            }
            if (bm.kind !== 'stop') {
                // the dome ripples where the beam goes through it
                const f = Math.max(0, 1 - Math.abs(head - yC) / 28) * fade;
                if (f > 0) {
                    c.beginPath(); c.ellipse(x, yC, 4 + 7 * (1 - f), 2 + 3.5 * (1 - f), 0, 0, Math.PI * 2);
                    c.strokeStyle = host._withAlpha(col, 0.8 * f); c.lineWidth = 1.2; c.stroke();
                }
            } else if (p > 0.38) {
                // blocked: red spark under the dome
                const a = (now - bm.t0 - 0.38 * bm.dur), q = Math.max(0, 1 - a / (0.62 * bm.dur));
                const r = 3 + 8 * (1 - q);
                const g = c.createRadialGradient(x, yC, 0, x, yC, r + 4);
                g.addColorStop(0, `rgba(255,236,170,${0.9 * q})`);
                g.addColorStop(0.45, host._withAlpha(k.block, 0.8 * q));
                g.addColorStop(1, host._withAlpha(k.block, 0));
                c.fillStyle = g; c.beginPath(); c.arc(x, yC, r + 4, 0, Math.PI * 2); c.fill();
                c.beginPath(); c.ellipse(x, yC, r * 1.4, r * 0.6, 0, 0, Math.PI * 2);
                c.strokeStyle = host._withAlpha(k.block, 0.7 * q); c.lineWidth = 1; c.stroke();
                const s = a / 1000, sp = bm.sparks;
                c.lineWidth = 1;
                c.strokeStyle = `rgba(255,${150 + Math.round(90 * q)},60,${q})`;
                c.beginPath();
                for (let i = 0; i < sp.length; i += 2) {
                    const ang = sp[i], v = sp[i + 1];
                    const ex = x + Math.cos(ang) * v * s, ey = yC + Math.abs(Math.sin(ang)) * v * s + 50 * s * s;
                    c.moveTo(x + Math.cos(ang) * v * s * 0.6, yC + Math.abs(Math.sin(ang)) * v * s * 0.6 + 30 * s * s); c.lineTo(ex, ey);
                }
                c.stroke();
            }
        }
        c.globalAlpha = 1;
    }

    _impactPoint(d) {
        if (!d.vis) { return [this.cx, this.cy - this.Hs]; }
        const mx = d.ox + LOT / 2, my = d.oy + LOT / 2;
        return [this._sx(mx, my), this._sy(mx, my, this._domeZ(mx, my))];
    }

    _drawMeteors(now) {
        const c = this.host.ctx, host = this.host;
        const span = Math.max(host.w, host.h);
        const keep = [];
        for (const m of this.meteors) {
            const p = (now - m.t0) / m.dur;
            if (p < 0) { keep.push(m); continue; }
            const [tx, ty] = this._impactPoint(m.d);
            const sx = tx + Math.cos(m.ang) * span * m.dist, sy = ty + Math.sin(m.ang) * span * m.dist;
            if (p >= 1) {
                this._impact(m.d, tx, ty, now);
                continue;
            }
            keep.push(m);
            const e = Math.pow(p, 1.5), et = Math.pow(Math.max(0, p - 0.22), 1.5);
            const hx = sx + (tx - sx) * e, hy = sy + (ty - sy) * e;
            const qx = sx + (tx - sx) * et, qy = sy + (ty - sy) * et;
            // fiery trail
            const g = c.createLinearGradient(qx, qy, hx, hy);
            g.addColorStop(0, 'rgba(255,90,20,0)');
            g.addColorStop(0.6, 'rgba(255,140,40,0.55)');
            g.addColorStop(1, 'rgba(255,230,150,0.95)');
            c.strokeStyle = g;
            c.globalAlpha = 0.35; c.lineWidth = 7; c.beginPath(); c.moveTo(qx, qy); c.lineTo(hx, hy); c.stroke();
            c.globalAlpha = 1; c.lineWidth = 2.4; c.stroke();
            // glowing head
            const hg = c.createRadialGradient(hx, hy, 0, hx, hy, 7);
            hg.addColorStop(0, 'rgba(255,255,240,1)');
            hg.addColorStop(0.35, 'rgba(255,200,90,0.9)');
            hg.addColorStop(1, host._withAlpha(host.colors.block, 0));
            c.fillStyle = hg; c.beginPath(); c.arc(hx, hy, 7, 0, Math.PI * 2); c.fill();
        }
        this.meteors = keep;
    }

    _impact(d, x, y, now) {
        d.hit = now;
        this.domeHit = now;
        // cracks: a few jagged arms from the impact point
        const arms = 5 + Math.floor(Math.random() * 3), cr = [];
        for (let i = 0; i < arms; i++) {
            let a = (i / arms) * Math.PI * 2 + Math.random() * 0.6, px = 0, py = 0;
            const pts = new Float32Array(8);
            for (let j = 0; j < 4; j++) {
                a += (Math.random() - 0.5) * 0.9;
                const len = 5 + Math.random() * 7;
                px += Math.cos(a) * len; py += Math.sin(a) * len * 0.6;
                pts[j * 2] = px; pts[j * 2 + 1] = py;
            }
            cr.push(pts);
        }
        this.impacts.push({ x, y, t0: now, cracks: cr, sparks: this._sparks(10, 25, 45) });
        if (this.impacts.length > MAX_IMPACTS) { this.impacts.shift(); }
    }

    _drawImpacts(now) {
        const c = this.host.ctx, host = this.host, k = host.colors, D = 800;
        this.impacts = this.impacts.filter((im) => now - im.t0 < D);
        if (!this.impacts.length) { return; }
        // ripple and cracks stay on the dome surface
        c.save();
        c.clip(this.silhouette);
        for (const im of this.impacts) {
            const a = now - im.t0, p = a / D, q = 1 - p;
            for (let i = 0; i < 3; i++) {
                const pr = p - i * 0.12;
                if (pr <= 0) { continue; }
                const r = 6 + 70 * pr;
                c.beginPath(); c.ellipse(im.x, im.y, r, r * 0.55, 0, 0, Math.PI * 2);
                c.strokeStyle = host._withAlpha(k.beam, 0.7 * q * (1 - i * 0.25)); c.lineWidth = 0.6 + 2 * q; c.stroke();
            }
            const grow = Math.min(1, p * 4);
            c.beginPath();
            for (const pts of im.cracks) {
                c.moveTo(im.x, im.y);
                for (let j = 0; j < 4; j++) { c.lineTo(im.x + pts[j * 2] * grow, im.y + pts[j * 2 + 1] * grow); }
            }
            c.strokeStyle = `rgba(255,248,230,${0.85 * q})`; c.lineWidth = 1.1; c.stroke();
            c.strokeStyle = host._withAlpha(k.beam, 0.5 * q); c.lineWidth = 3; c.globalAlpha = 0.6; c.stroke();
            c.globalAlpha = 1;
        }
        c.restore();
        // flash and sparks
        for (const im of this.impacts) {
            const a = now - im.t0, p = a / D, q = 1 - p;
            const fr = 4 + 20 * Math.min(1, p * 3);
            const g = c.createRadialGradient(im.x, im.y, 0, im.x, im.y, fr);
            g.addColorStop(0, `rgba(255,255,255,${0.9 * q * q})`);
            g.addColorStop(0.4, `rgba(255,210,110,${0.65 * q * q})`);
            g.addColorStop(1, host._withAlpha(k.block, 0));
            c.fillStyle = g; c.beginPath(); c.arc(im.x, im.y, fr, 0, Math.PI * 2); c.fill();
            const s = a / 1000, sp = im.sparks;
            c.lineWidth = 1.2;
            c.strokeStyle = `rgba(255,${150 + Math.round(90 * q)},60,${q})`;
            c.beginPath();
            for (let i = 0; i < sp.length; i += 2) {
                const ang = sp[i], v = sp[i + 1];
                c.moveTo(im.x + Math.cos(ang) * v * s * 0.75, im.y + Math.sin(ang) * v * s * 0.75 + 30 * s * s);
                c.lineTo(im.x + Math.cos(ang) * v * s, im.y + Math.sin(ang) * v * s + 40 * s * s);
            }
            c.stroke();
        }
    }

    // district names with their event count, on the lot corner that faces outwards; each label is
    // rendered into a small sprite that is only redrawn when its text changes
    _drawLabels() {
        if (!this.shown.length) { return; }
        const c = this.host.ctx, P = this.P, dpr = window.devicePixelRatio || 1;
        for (const d of this.shown) {
            const out = this.geoN <= 1 ? 'front' : (d.gx === 0 && d.gy === 0 ? 'back' : d.gx === 1 && d.gy === 1 ? 'front' : d.gx === 1 ? 'right' : 'left');
            let x, y, align;
            const L = LOT, ox = d.ox, oy = d.oy;
            if (out === 'front') { x = this._sx(ox + L, oy + L); y = this._sy(ox + L, oy + L, 0) + 11; align = 'center'; }
            else if (out === 'back') { x = this._sx(ox, oy); y = this._sy(ox, oy, 0) - 9; align = 'center'; }
            else if (out === 'right') { x = this._sx(ox + L, oy) + 6; y = this._sy(ox + L, oy, 0); align = 'left'; }
            else { x = this._sx(ox, oy + L) - 6; y = this._sy(ox, oy + L, 0); align = 'right'; }
            const lb = d.label || (d.label = { cv: document.createElement('canvas'), key: '' });
            const key = `${d.n}|${this.palVer}|${dpr}|${this.font}`;
            if (lb.key !== key) {
                lb.key = key;
                const font = '600 10px ' + this.font, name = d.name.toUpperCase(), num = ' ' + d.n;
                let x2 = lb.cv.getContext('2d');
                x2.font = font;
                const wn = x2.measureText(name).width, wu = x2.measureText(num).width;
                lb.w = Math.ceil(wn + wu + 6); lb.h = 16;
                lb.cv.width = Math.ceil(lb.w * dpr); lb.cv.height = Math.ceil(lb.h * dpr);
                x2 = lb.cv.getContext('2d');
                x2.setTransform(dpr, 0, 0, dpr, 0, 0);
                x2.font = font; x2.textBaseline = 'middle'; x2.textAlign = 'left';
                x2.lineWidth = 3; x2.lineJoin = 'round'; x2.strokeStyle = P.halo;
                x2.strokeText(name + num, 3, 8);
                x2.fillStyle = P.label; x2.fillText(name, 3, 8);
                x2.fillStyle = P.muted; x2.fillText(num, 3 + wn, 8);
            }
            const x0 = align === 'center' ? x - lb.w / 2 : align === 'right' ? x - lb.w + 3 : x - 3;
            c.drawImage(lb.cv, Math.round(x0), Math.round(y - 8), lb.cv.width / dpr, lb.cv.height / dpr);
        }
    }

    /* ------------------------------------------------------------------ hover */

    hit(mx, my) {
        const t = this.host.translations || {}, k = this.host.colors || {};
        for (let i = this.order.length - 1; i >= 0; i--) {
            const b = this.order[i];
            if (!b.drawn || b.slot < 0 || !inConvex(b.hex, 6, mx, my)) { continue; }
            let cc = null;
            try { cc = this.host.geo ? this.host._country(b.ip) : null; } catch (e) { cc = null; }
            const mono = 'font-family:var(--bs-font-monospace,monospace);';
            const dir = b.lastIn ? (t.inbound ?? 'Inbound') : (t.outbound ?? 'Outbound');
            const last = b.lastRemote ? `${esc(b.lastRemote)}${b.lastPort ? ':' + esc(b.lastPort) : ''}` : '';
            const html =
                `<b style="${mono}">${cc ? this.host._flag(cc) + ' ' : ''}${esc(b.ip)}</b><br>` +
                `<span style="opacity:.7">${esc(t.interface ?? 'Interface')}:</span> ${esc(b.d.name)}<br>` +
                `${esc(t.hits ?? 'Hits')}: <b>${b.n}</b> · ` +
                `<span style="color:${k.pass}">${esc(t.pass ?? 'Pass')} ${b.pass}</span> · ` +
                `<span style="color:${k.block}">${esc(t.block ?? 'Block')} ${b.block}</span> · ` +
                `<span style="color:${k.nat}">${esc(t.nat ?? 'NAT')} ${b.nat}</span>` +
                (last ? `<br><span style="opacity:.7">${esc(dir)}:</span> <span style="${mono}">${last}</span>` : '');
            return { html, open: { field: b.lastIn ? 'dst' : 'src', value: b.ip }, cursor: 'pointer' };
        }
        for (const d of this.shown) {
            if (!d.dia || !inConvex(d.dia, 4, mx, my)) { continue; }
            const html =
                `<span style="opacity:.7">${esc(t.interface ?? 'Interface')}</span><br><b>${esc(d.name)}</b><br>` +
                `${esc(t.hits ?? 'Hits')}: <b>${d.n}</b> · <span style="color:${k.block}">${esc(t.block ?? 'Block')} ${d.block}</span><br>` +
                `${esc(t.hosts ?? 'Hosts')}: ${d.hosts.size}`;
            return { html, open: null };
        }
        return null;
    }
}

// point inside a convex polygon given as a flat [x0, y0, x1, y1, ...] list (either winding)
function inConvex(p, n, x, y) {
    let sign = 0;
    for (let i = 0; i < n; i++) {
        const ax = p[i * 2], ay = p[i * 2 + 1], bx = p[((i + 1) % n) * 2], by = p[((i + 1) % n) * 2 + 1];
        const cr = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
        if (cr !== 0) {
            const s = cr > 0 ? 1 : -1;
            if (sign === 0) { sign = s; } else if (s !== sign) { return false; }
        }
    }
    return true;
}
