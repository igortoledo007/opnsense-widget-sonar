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
 * Sonar "black hole" view (loaded on demand by Sonar.js).
 *
 * The firewall is a black hole in the middle of the canvas (look inspired by Gargantua):
 * accretion disc with rotating dashed rings, lensed halo above and below the shadow,
 * photon ring and a pure black event horizon. Every remote address is a star on an inclined
 * elliptical orbit (Keplerian speed); its size follows the number of events and its color the
 * dominant action. A blocked connection drops a particle from the attacking star that spirals
 * into the hole; when it crosses the horizon the photon ring flashes and the disc heats up
 * (the heat decays in ~8 s). Stars of the same country are joined into faint constellations.
 */

const TAU = Math.PI * 2;
const MAX_STARS = 260;
const MAX_PARTS = 40;
const HEAT_MS = 8000;              // decay time constant of the disc heat
const LIVE_MS = 1500;              // only events newer than this are animated
const FLAT = 0.38;                 // vertical flattening of the orbital plane

// hot palettes of the disc, inner (t = 0) to outer (t = 1)
const PAL_DARK = [[255, 251, 238], [255, 228, 150], [255, 176, 76], [238, 100, 42], [168, 40, 30]];
const PAL_LIGHT = [[255, 196, 84], [255, 158, 40], [240, 108, 30], [204, 58, 24], [136, 28, 20]];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));

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

// angular speed (rad/s) at the normalized orbital radius r: period 6 s at r = 0.5, ~r^1.5
const omega = (r) => TAU / (6 * Math.pow(Math.max(0.02, r) / 0.5, 1.5));

export default class HoleView {
    static SYM = [16, 24, 32];           // pattern repeats around the rings of each band
    static PHASES = 16;                  // cached frames per band over one repeat

    constructor(host) {
        this.host = host;
        this.stars = new Map();          // key: remote ip, in least recently seen order
        this.parts = [];                 // particles falling into the hole
        this.heat = 0;
        this.heatT = performance.now();
        this.flashT = -1e9;              // last horizon crossing
        this.bg = null;                  // cached starfield + vignette
        this.bgKey = '';
        this.sprites = new Map();        // glow sprite per color
        this.groups = [];                // constellations: arrays of stars of the same country
        this.labels = [];                // [cc, strongest star] of the main countries
        this.regroupAt = 0;
        this.hover = null;
        this.drawn = false;
        this.resize();
    }

    /* ------------------------------------------------------------------ geometry */

    resize() {
        const h = this.host;
        const w = Math.max(10, h.w || 10), hh = Math.max(10, h.h || 10);
        this.gw = w; this.gh = hh;
        this.cx = w / 2;
        this.cy = hh / 2;
        // the outermost orbit (r = 0.98, flattening up to 0.42) must fit vertically
        this.R = Math.max(40, Math.min(w * 0.47, (hh / 2 - 14) / (0.98 * 0.42)));
        this.rh = Math.max(7, Math.min(this.R * 0.135, hh * 0.15));
        this.rIn = this.rh * 1.5;
        this.rOut = Math.max(this.rIn + 12, this.R * 0.38);
        this.rH = this.rh / this.R;      // horizon, normalized
        // accretion rings: denser inside, each one with its own dash pattern, grouped in three bands
        // (inner/middle/outer) that turn at their own Keplerian speed. The dash pattern of every ring of
        // band b repeats exactly SYM[b] times around it, so a band looks the same after turning 2*pi/SYM[b]:
        // its frames over that angle are rendered once (already flattened) and each frame is a few plain
        // blits instead of dozens of dashed strokes.
        const rnd = mulberry(0xb1ac4);
        const N = 22, gap = (this.rOut - this.rIn) / N;
        this.rings = [];
        for (let i = 0; i < N; i++) {
            const u = i / (N - 1);
            const r = this.rIn + (this.rOut - this.rIn) * Math.pow(u, 1.25);
            const band = u < 0.3 ? 0 : (u < 0.62 ? 1 : 2), P = TAU * r / HoleView.SYM[band];
            // 2-3 random dash/gap pairs filling one period exactly
            const raw = [];
            for (let j = 0, m = 2 + (rnd() < 0.5 ? 1 : 0); j < m; j++) { raw.push(0.5 + rnd() * 2, 0.08 + rnd() * (0.25 + 0.5 * u)); }
            const sum = raw.reduce((x, y) => x + y, 0);
            this.rings.push({ r, u, band, dash: raw.map((x) => x * P / sum), ph: rnd() * P, wd: gap * (0.7 + rnd() * 0.8) });
        }
        // angular speed of each band (rad/s), slowed down so the dashes read as flowing gas
        this.bandW = [0.15, 0.46, 0.81].map((u) => omega((this.rIn + (this.rOut - this.rIn) * u) / this.R) * 0.32);
        this.bandPh = [rnd() * TAU, rnd() * TAU, rnd() * TAU];
        this.lens = [];
        for (let i = 0; i < 7; i++) {
            // streak pattern repeating exactly 12 times around (cached rotation frames, like the disc bands)
            const r = this.rh * (1.1 + i * 0.11), P = TAU * r / 12, a = 0.3 + rnd() * 0.5;
            this.lens.push({ r, u: i / 6, dash: [a * P, (1 - a) * P], ph: rnd() * P });
        }
        this.layers = null;
        this.layersKey = '';
        this.bgKey = '';
        try { this.font = getComputedStyle(h.el).fontFamily || 'sans-serif'; } catch (e) { this.font = 'sans-serif'; }
    }

    _pal(t) {
        const P = this.host.dark ? PAL_DARK : PAL_LIGHT;
        const x = Math.min(1, Math.max(0, t)) * (P.length - 1), i = Math.min(P.length - 2, Math.floor(x)), f = x - i;
        const a = P[i], b = P[i + 1];
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    }

    _rgba(c, a) { return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a)).toFixed(3)})`; }

    /* ------------------------------------------------------------------ events */

    _heatNow(now) {
        this.heat *= Math.exp(-Math.max(0, now - this.heatT) / HEAT_MS);
        this.heatT = now;
        return this.heat;
    }

    _addHeat(v, at) {
        const now = performance.now();
        this._heatNow(now);
        this.heat = Math.min(1, this.heat + v * Math.exp(-Math.max(0, now - at) / HEAT_MS));
    }

    _resolve(s) {
        if (s.cc !== undefined) { return; }
        const h = this.host;
        let cc = null;
        try { cc = h._country(s.ip); } catch (e) { cc = null; }
        if (cc) { s.cc = cc; } else if (h.geo) { s.cc = null; }   // database loaded: no country (private/IPv6)
    }

    add(ev) {
        if (!ev || !ev.remote) { return; }
        const now = performance.now(), t = ev.now ?? now, ip = String(ev.remote);
        let s = this.stars.get(ip);
        if (s) {
            this.stars.delete(ip);       // re-insert: the Map keeps the least recently seen first
        } else {
            if (this.stars.size >= MAX_STARS) {
                const old = this.stars.keys().next().value;
                if (this.hover && this.hover.ip === old) { this.hover = null; }
                this.stars.delete(old);
            }
            const hs = fnv(ip), r = 0.42 + 0.56 * ((hs & 0xffff) / 0xffff);
            const inc = ((((hs >>> 16) & 0xff) / 255) - 0.5) * 0.22;
            s = { ip, r, w: omega(r), th0: ((hs >>> 24) / 256) * TAU, ci: Math.cos(inc), si: Math.sin(inc),
                fl: FLAT + ((((hs >>> 8) & 0xff) / 255) - 0.5) * 0.08,
                n: 0, ni: 0, c: { pass: 0, block: 0, nat: 0 }, tl: t, fx: -1e9, cc: undefined,
                port: '', proto: '', label: '', x: 0, y: 0, d: 0, sz: 0, hid: true };
        }
        this.stars.set(ip, s);
        const act = ev.action in s.c ? ev.action : 'pass';
        s.n++; s.c[act]++;
        if (ev.inbound) { s.ni++; }
        s.tl = Math.max(s.tl, t);
        s.fx = Math.max(s.fx, t);
        s.port = ev.port ?? ''; s.proto = ev.proto ?? ''; s.label = ev.label ?? '';
        this._resolve(s);
        if (act === 'block') {
            const live = t > now - LIVE_MS;
            if (live && !this.host.reducedMotion && this.parts.length < MAX_PARTS) {
                const th = this._theta(s, now);
                this.parts.push({ r0: s.r, th, ci: s.ci, si: s.si, fl: s.fl, t0: now, dur: 2300 + Math.random() * 1400,
                    last: now, trail: [] });
            } else {
                this._addHeat(0.07, t);
            }
        }
    }

    _theta(s, now) { return s.th0 + (this.host.reducedMotion ? 0 : s.w * now / 1000); }

    _proj(r, th, fl, ci, si) {
        const ex = Math.cos(th) * r * this.R, ey = Math.sin(th) * r * this.R * fl;
        return [this.cx + ex * ci - ey * si, this.cy + ex * si + ey * ci];
    }

    /* ------------------------------------------------------------------ caches */

    // glow sprite rendered at the exact device pixel size it is drawn at (no scaling per frame)
    _sprite(color, d) {
        const dark = !!this.host.dark, S = Math.max(4, Math.round(d * (window.devicePixelRatio || 1) / 2) * 2);
        const key = `${color}|${dark ? 'd' : 'l'}|${S}`;
        let sp = this.sprites.get(key);
        if (sp) { return sp; }
        sp = document.createElement('canvas');
        sp.width = sp.height = S;
        const g = sp.getContext('2d'), wa = (a) => this.host._withAlpha(color, a);
        const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
        if (dark) {
            gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.1, 'rgba(255,255,255,0.95)');
            gr.addColorStop(0.22, wa(0.9)); gr.addColorStop(0.45, wa(0.28)); gr.addColorStop(1, wa(0));
        } else {
            gr.addColorStop(0, wa(1)); gr.addColorStop(0.2, wa(0.95)); gr.addColorStop(0.32, wa(0.5));
            gr.addColorStop(0.6, wa(0.12)); gr.addColorStop(1, wa(0));
        }
        g.fillStyle = gr; g.fillRect(0, 0, S, S);
        if (this.sprites.size > 300) { this.sprites.clear(); }
        this.sprites.set(key, sp);
        return sp;
    }

    // sprite centered on (x, y), snapped to device pixels and drawn 1:1 (no resampling)
    _put(c, sp, x, y) {
        const dpr = window.devicePixelRatio || 1, d = sp.width / dpr;
        c.drawImage(sp, Math.round((x - d / 2) * dpr) / dpr, Math.round((y - d / 2) * dpr) / dpr, d, d);
    }

    _background() {
        const h = this.host, k = h.colors, dpr = window.devicePixelRatio || 1;
        const key = `${this.gw}x${this.gh}@${dpr}|${h.dark}|${k.text}`;
        if (this.bg && this.bgKey === key) { return this.bg; }
        const cv = this.bg || document.createElement('canvas');
        cv.width = Math.round(this.gw * dpr); cv.height = Math.round(this.gh * dpr);
        const g = cv.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, this.gw, this.gh);
        // deep space around the hole
        const vr = h.dark ? Math.max(this.R * 0.85, this.rOut * 1.6) : this.rOut * 2.2;
        const vg = g.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, vr);
        if (h.dark) {
            vg.addColorStop(0, 'rgba(0,0,0,0.55)'); vg.addColorStop(0.45, 'rgba(0,0,0,0.25)'); vg.addColorStop(1, 'rgba(0,0,0,0)');
        } else {
            vg.addColorStop(0, 'rgba(24,16,40,0.16)'); vg.addColorStop(0.45, 'rgba(24,16,40,0.06)'); vg.addColorStop(1, 'rgba(24,16,40,0)');
        }
        g.fillStyle = vg; g.fillRect(0, 0, this.gw, this.gh);
        // fixed starfield (seeded, so it does not jump between frames or sessions)
        const rnd = mulberry(0x5eed), n = Math.min(500, Math.round(this.gw * this.gh / 1700));
        for (let i = 0; i < n; i++) {
            const x = rnd() * this.gw, y = rnd() * this.gh, s = 0.3 + rnd() * rnd() * 1.1, a = 0.06 + rnd() * rnd() * 0.32;
            g.fillStyle = h.dark ? `rgba(215,225,255,${a.toFixed(3)})` : h._withAlpha(k.text, a * 0.55);
            g.beginPath(); g.arc(x, y, s, 0, TAU); g.fill();
        }
        this.bg = cv; this.bgKey = key;
        return cv;
    }

    // lensed halo (static + shimmer streaks) and the per-band frame caches of the disc
    _layers() {
        const h = this.host, dpr = window.devicePixelRatio || 1, dark = !!h.dark;
        const key = `${this.gw}x${this.gh}@${dpr}|${dark}`;
        if (this.layers && this.layersKey === key) { return this.layers; }
        const mk = (hw, hh, ls) => {
            const cv = document.createElement('canvas');
            cv.width = Math.ceil(hw * 2 * ls); cv.height = Math.ceil(hh * 2 * ls);
            const g = cv.getContext('2d');
            g.setTransform(ls, 0, 0, ls, cv.width / 2, cv.height / 2);
            return [cv, g];
        };
        // lensed image of the far disc: wide arc over the shadow, thin one under it
        const lh = this.rh * 2.0, rh = this.rh;
        const [lens, lg] = mk(lh, lh, dpr);
        if (dark) { lg.globalCompositeOperation = 'lighter'; }
        for (const L of this.lens) {
            const col = this._pal(L.u * 0.9), r2 = rh + (L.r - rh) * 0.5;
            // upper arc, fading toward the disc plane so its ends melt into the disc
            const a = dark ? 0.85 - 0.55 * L.u : 1 - 0.55 * L.u, gr = lg.createLinearGradient(0, -L.r, 0, rh * 0.2);
            gr.addColorStop(0, this._rgba(col, a)); gr.addColorStop(0.55, this._rgba(col, a * 0.8)); gr.addColorStop(1, this._rgba(col, a * (dark ? 0.5 : 0.15)));
            lg.beginPath(); lg.ellipse(0, 0, L.r, L.r * 0.97, 0, Math.PI - 0.1, TAU + 0.1);
            lg.strokeStyle = gr;
            lg.lineWidth = rh * 0.13; lg.stroke();
            lg.beginPath(); lg.ellipse(0, 0, r2, r2 * 0.97, 0, -0.1, Math.PI + 0.1);
            lg.strokeStyle = this._rgba(col, 0.5 - 0.4 * L.u);
            lg.lineWidth = rh * 0.06; lg.stroke();
        }
        // disc bands: extent of each one (the outer band also carries the smooth glow)
        const ext = [0, 0, this.rOut * 1.1];
        for (const ring of this.rings) { ext[ring.band] = Math.max(ext[ring.band], ring.r + ring.wd * 1.6 + 2); }
        this.layers = { lens, lh, ext, frames: [[], [], []], streaks: [], ls: Math.min(dpr, 1.5), mk };
        this.layersKey = key;
        return this.layers;
    }

    // frame k of band b: the band turned by k/PHASES of its repeat angle, flattened, rendered on first use
    _frame(b, k) {
        const Ly = this.layers, cached = Ly.frames[b][k];
        if (cached) { return cached; }
        const dark = !!this.host.dark, hw = Ly.ext[b], hh = hw * FLAT + 1;
        const [cv, g] = Ly.mk(hw, hh, Ly.ls);
        g.scale(1, FLAT);
        g.rotate((k / HoleView.PHASES) * TAU / HoleView.SYM[b]);
        if (b === 2) {
            // smooth glow under the rings (rotation invariant)
            const gr = g.createRadialGradient(0, 0, 0, 0, 0, this.rOut * 1.08), f = this.rIn / (this.rOut * 1.08), m = dark ? 0.55 : 0.8;
            gr.addColorStop(0, 'rgba(0,0,0,0)');
            gr.addColorStop(Math.max(0, f - 0.04), this._rgba(this._pal(0), 0));
            gr.addColorStop(f, this._rgba(this._pal(0), 0.85 * m));
            gr.addColorStop(f + (1 - f) * 0.25, this._rgba(this._pal(0.35), 0.5 * m));
            gr.addColorStop(f + (1 - f) * 0.6, this._rgba(this._pal(0.7), 0.2 * m));
            gr.addColorStop(1, this._rgba(this._pal(1), 0));
            g.fillStyle = gr;
            g.beginPath(); g.arc(0, 0, this.rOut * 1.08, 0, TAU); g.arc(0, 0, this.rIn * 0.96, 0, TAU, true); g.fill();
        }
        for (const ring of this.rings) {
            if (ring.band !== b) { continue; }
            g.beginPath(); g.arc(0, 0, ring.r, 0, TAU);
            g.setLineDash(ring.dash); g.lineDashOffset = ring.ph;
            g.strokeStyle = this._rgba(this._pal(ring.u), dark ? 1 - 0.6 * ring.u : 1 - 0.35 * ring.u);
            g.lineWidth = ring.wd * (dark ? 1.1 : 1.4);
            g.stroke();
        }
        const fr = { cv, hw, hh };
        Ly.frames[b][k] = fr;
        return fr;
    }

    // frame k of the thin dashed streaks that flow around the halo (shimmer), upper half only
    _streak(k) {
        const Ly = this.layers, cached = Ly.streaks[k];
        if (cached) { return cached; }
        const dark = !!this.host.dark, [cv, g] = Ly.mk(Ly.lh, Ly.lh, window.devicePixelRatio || 1);
        g.beginPath(); g.rect(-Ly.lh, -Ly.lh, Ly.lh * 2, Ly.lh + this.rh * 0.1); g.clip();
        g.scale(1, 0.97);
        g.rotate(-(k / HoleView.PHASES) * TAU / 12);
        for (const L of this.lens) {
            g.beginPath(); g.arc(0, 0, L.r, 0, TAU);
            g.setLineDash(L.dash); g.lineDashOffset = L.ph;
            g.strokeStyle = this._rgba(this._pal(0), dark ? 0.45 - 0.3 * L.u : 0.7 - 0.4 * L.u);
            g.lineWidth = this.rh * 0.06; g.stroke();
        }
        Ly.streaks[k] = cv;
        return cv;
    }

    // every 500 ms: pending countries, constellations (top 10 stars of each country) and labels
    _regroup() {
        const by = new Map();
        for (const s of this.stars.values()) {
            this._resolve(s);
            if (!s.cc) { continue; }
            let g = by.get(s.cc);
            if (!g) { g = { cc: s.cc, n: 0, list: [] }; by.set(s.cc, g); }
            g.n += s.n; g.list.push(s);
        }
        this.groups = [];
        for (const g of by.values()) {
            g.list.sort((a, b) => b.n - a.n);
            if (g.list.length >= 2) { this.groups.push(g.list.slice(0, 10)); }
        }
        this.labels = [...by.values()].sort((a, b) => b.n - a.n).slice(0, 6).map((g) => [g.cc, g.list[0]]);
    }

    /* ------------------------------------------------------------------ drawing */

    draw(now) {
        const h = this.host, c = h.ctx, k = h.colors;
        if (!c || !k) { return; }
        if (h.w !== this.gw || h.h !== this.gh) { this.resize(); }
        const rm = !!h.reducedMotion;
        const heat = this._heatNow(now);
        c.save();
        c.clearRect(0, 0, this.gw, this.gh);
        c.drawImage(this._background(), 0, 0, this.gw, this.gh);
        if (now >= this.regroupAt) { this._regroup(); this.regroupAt = now + 500; }

        // star positions (depth: sin of the orbital angle, > 0 = in front of the hole)
        for (const s of this.stars.values()) {
            const th = this._theta(s, now), [x, y] = this._proj(s.r, th, s.fl, s.ci, s.si);
            s.x = x; s.y = y; s.d = Math.sin(th);
            s.sz = Math.min(5.5, 1.1 + Math.log2(1 + s.n)) * (0.86 + 0.16 * s.d);
            s.hid = s.d < 0 && (x - this.cx) ** 2 + (y - this.cy) ** 2 < (this.rh * 1.05) ** 2;
        }

        // orbit of the hovered star
        const hv = this.hover && this.stars.get(this.hover.ip) === this.hover ? this.hover : null;
        if (hv) {
            c.beginPath();
            c.ellipse(this.cx, this.cy, hv.r * this.R, hv.r * this.R * hv.fl, Math.atan2(hv.si, hv.ci), 0, TAU);
            c.strokeStyle = h._withAlpha(k.text, 0.22); c.lineWidth = 0.8; c.setLineDash([2, 4]); c.stroke(); c.setLineDash([]);
        }

        this._constellations(c, k, hv);

        // particles: positions advance here (spiral: radius shrinks, angular speed grows)
        const keep = [];
        for (const p of this.parts) {
            const u = (now - p.t0) / p.dur;
            if (u >= 1 || rm) {
                if (!rm) { this.flashT = now; this._addHeat(0.16, now); }
                continue;
            }
            p.r = p.r0 - (p.r0 - this.rH) * u * u;
            p.th += omega(p.r) * 1.15 * (now - p.last) / 1000;
            p.last = now;
            const f = p.r / p.r0;        // the orbit settles on the disc plane while falling
            const [x, y] = this._proj(p.r, p.th, FLAT + (p.fl - FLAT) * f, p.ci * f + (1 - f), p.si * f);
            p.trail.push(x, y);
            if (p.trail.length > 20) { p.trail.splice(0, 2); }
            p.x = x; p.y = y; p.u = u; p.d = Math.sin(p.th);
            keep.push(p);
        }
        this.parts = keep;

        this._stars(c, k, now, -1, hv);
        this._particles(c, k, -1);
        this._disk(c, -1, heat, now, rm);
        this._lensAndHorizon(c, heat, now, rm);
        this._disk(c, 1, heat, now, rm);
        this._stars(c, k, now, 1, hv);
        this._particles(c, k, 1);
        this._labels(c, k);
        c.restore();
        this.drawn = true;
    }

    _constellations(c, k, hv) {
        if (!this.groups.length) { return; }
        const h = this.host;
        let hot = null;
        c.beginPath();
        for (const g of this.groups) {
            if (hv && g.includes(hv)) { hot = g; continue; }
            this._mst(c, g);
        }
        c.strokeStyle = h._withAlpha(k.text, h.dark ? 0.12 : 0.11); c.lineWidth = 0.6; c.stroke();
        if (hot) {
            c.beginPath(); this._mst(c, hot);
            c.strokeStyle = h._withAlpha(k.beam, 0.55); c.lineWidth = 0.9; c.stroke();
        }
    }

    // Prim's minimum spanning tree over the current positions (at most 10 stars)
    _mst(c, g) {
        const n = g.length, used = new Uint8Array(n), best = new Float64Array(n).fill(Infinity), from = new Int8Array(n).fill(-1);
        best[0] = 0;
        for (let it = 0; it < n; it++) {
            let j = -1;
            for (let i = 0; i < n; i++) { if (!used[i] && (j < 0 || best[i] < best[j])) { j = i; } }
            used[j] = 1;
            if (from[j] >= 0) { const a = g[from[j]], b = g[j]; c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); }
            for (let i = 0; i < n; i++) {
                if (used[i]) { continue; }
                const d = (g[i].x - g[j].x) ** 2 + (g[i].y - g[j].y) ** 2;
                if (d < best[i]) { best[i] = d; from[i] = j; }
            }
        }
    }

    _stars(c, k, now, side, hv) {
        const h = this.host;
        for (const s of this.stars.values()) {
            if ((s.d < 0 ? -1 : 1) !== side || s.hid) { continue; }
            const dom = s.c.block >= s.c.pass && s.c.block >= s.c.nat ? 'block' : (s.c.nat > s.c.pass ? 'nat' : 'pass');
            const col = k[dom], age = now - s.tl;
            const fq = s.fx > now - 4000 ? Math.exp(-Math.max(0, now - s.fx) / 650) : 0;
            let a = Math.min(1, 0.5 + 0.12 * Math.log2(1 + s.n)) * Math.max(0.4, Math.exp(-Math.max(0, age) / 180000));
            a *= 0.72 + 0.28 * (s.d + 1) / 2;
            a = Math.min(1, a + fq * 0.6);
            const d = s.sz * (5 + fq * 4);
            c.globalAlpha = a;
            this._put(c, this._sprite(col, d), s.x, s.y);
            if (fq > 0.04) {
                // twinkle: four-point spikes
                const L = s.sz * (1.2 + 3.2 * fq);
                c.globalAlpha = Math.min(1, fq * 0.7);
                c.strokeStyle = h.dark ? '#fff' : col; c.lineWidth = 0.8;
                c.beginPath(); c.moveTo(s.x - L, s.y); c.lineTo(s.x + L, s.y); c.moveTo(s.x, s.y - L); c.lineTo(s.x, s.y + L); c.stroke();
            }
            if (s === hv) {
                c.globalAlpha = 0.9;
                c.beginPath(); c.arc(s.x, s.y, s.sz + 4, 0, TAU);
                c.strokeStyle = h._withAlpha(k.text, 0.8); c.lineWidth = 1; c.stroke();
            }
        }
        c.globalAlpha = 1;
    }

    _particles(c, k, side) {
        if (!this.parts.length) { return; }
        const h = this.host, hot = this._pal(0.15);
        c.lineCap = 'round';
        for (const p of this.parts) {
            if ((p.d < 0 ? -1 : 1) !== side) { continue; }
            const fade = p.u > 0.85 ? (1 - p.u) / 0.15 : 1, tr = p.trail, m = tr.length / 2;
            // trail: one stroke fading toward the tail, from the attacker color to the disc heat
            if (m > 1) {
                const col = p.u > 0.5 ? this._rgba(hot, 1) : k.block;
                const gr = c.createLinearGradient(tr[0], tr[1], tr[tr.length - 2], tr[tr.length - 1]);
                gr.addColorStop(0, h._withAlpha(col, 0)); gr.addColorStop(1, h._withAlpha(col, 0.85 * fade));
                c.beginPath(); c.moveTo(tr[0], tr[1]);
                for (let i = 1; i < m; i++) { c.lineTo(tr[i * 2], tr[i * 2 + 1]); }
                c.strokeStyle = gr; c.lineWidth = 1.6; c.stroke();
            }
            const d = 9 * (1 - 0.4 * p.u);
            c.globalAlpha = fade;
            this._put(c, this._sprite(p.u > 0.5 ? this._rgba(hot, 1) : k.block, d), p.x, p.y);
            c.globalAlpha = 1;
        }
        c.lineCap = 'butt';
    }

    // half of the accretion disc: -1 = far side (upper half, painted before the hole), 1 = near side.
    // The heat redraws the bands on top (additive on dark themes): brighter and whiter.
    _disk(c, side, heat, now, rm) {
        const cx = this.cx, cy = this.cy, dark = this.host.dark, tt = rm ? 0 : now / 1000, K = HoleView.PHASES;
        this._layers();
        const fr = [0, 1, 2].map((b) => {
            const per = TAU / HoleView.SYM[b], a = (this.bandPh[b] + tt * this.bandW[b]) % per;
            return this._frame(b, Math.floor((a / per) * K) % K);
        });
        const bands = (alpha) => {
            c.globalAlpha = Math.min(1, alpha);
            for (let b = 2; b >= 0; b--) {
                const { cv, hw, hh } = fr[b], sh = cv.height / 2;
                if (side < 0) { c.drawImage(cv, 0, 0, cv.width, sh, cx - hw, cy - hh, hw * 2, hh); }
                else { c.drawImage(cv, 0, sh, cv.width, sh, cx - hw, cy, hw * 2, hh); }
            }
        };
        c.save();
        if (dark) { c.globalCompositeOperation = 'lighter'; }
        const m = side < 0 ? 0.85 : 1;
        bands(m * (0.85 + 0.15 * heat));
        if (heat > 0.03) { bands(m * heat * (dark ? 0.8 : 0.6)); }
        if (!dark && side > 0) {
            // light themes: where the near side crosses the shadow, add the light instead of tinting it brown
            c.beginPath(); c.arc(cx, cy, this.rh, 0, TAU); c.clip();
            c.globalCompositeOperation = 'lighter';
            bands(0.9);
        }
        c.restore();
    }

    // lensed image of the far disc (halo over and under the shadow), horizon and photon ring
    _lensAndHorizon(c, heat, now, rm) {
        const cx = this.cx, cy = this.cy, rh = this.rh, tt = rm ? 0 : now / 1000;
        const boost = 0.6 + 0.4 * heat, dark = this.host.dark, Ly = this._layers();
        c.save();
        if (dark) { c.globalCompositeOperation = 'lighter'; }
        c.globalAlpha = boost;
        c.drawImage(Ly.lens, cx - Ly.lh, cy - Ly.lh, Ly.lh * 2, Ly.lh * 2);
        const per = TAU / 12, K = HoleView.PHASES;
        c.globalAlpha = boost * 0.8;
        c.drawImage(this._streak(Math.floor((((tt * 0.9) % per) / per) * K) % K), cx - Ly.lh, cy - Ly.lh, Ly.lh * 2, Ly.lh * 2);
        c.restore();
        // event horizon: pure black in every theme
        c.beginPath(); c.arc(cx, cy, rh, 0, TAU);
        c.fillStyle = '#000'; c.fill();
        // photon ring (+ flash when something crosses the horizon)
        const fq = Math.exp(-Math.max(0, now - this.flashT) / 450);
        const pc = this._pal(0);
        c.beginPath(); c.arc(cx, cy, rh * 1.05, 0, TAU);
        c.strokeStyle = this._rgba(pc, 0.16 + 0.2 * heat + 0.3 * fq); c.lineWidth = rh * 0.2 + 4 * fq; c.stroke();
        c.beginPath(); c.arc(cx, cy, rh * 1.03, 0, TAU);
        c.strokeStyle = this._rgba(this.host.dark ? pc : this._pal(0.25), Math.min(1, 0.75 + 0.25 * heat + fq)); c.lineWidth = Math.max(1, rh * 0.05) + 1.5 * fq; c.stroke();
        if (fq > 0.02) {
            c.beginPath(); c.arc(cx, cy, rh * (1.05 + 0.9 * (1 - fq)), 0, TAU);
            c.strokeStyle = this._rgba(pc, 0.55 * fq); c.lineWidth = 1 + 2 * fq; c.stroke();
        }
    }

    _labels(c, k) {
        if (!this.labels.length) { return; }
        const h = this.host;
        c.font = `10px ${this.font}`;
        c.textAlign = 'left'; c.textBaseline = 'middle';
        const put = [];
        c.fillStyle = h._withAlpha(k.text, 0.8);
        for (const [cc, s] of this.labels) {
            if (!s || s.hid || !this.stars.has(s.ip)) { continue; }
            const x = Math.min(s.x + s.sz + 4, this.gw - 34);
            let y = Math.max(8, s.y - s.sz - 4);
            // nudge down past labels already placed, give up if still crowded
            for (let i = 0; i < 3 && put.some(([px, py]) => Math.abs(px - x) < 34 && Math.abs(py - y) < 12); i++) { y += 12; }
            if (put.some(([px, py]) => Math.abs(px - x) < 34 && Math.abs(py - y) < 12)) { continue; }
            put.push([x, y]);
            c.fillText(`${h._flag(cc)} ${cc}`, x, y);
        }
    }

    /* ------------------------------------------------------------------ interaction */

    hit(mx, my) {
        if (!this.drawn) { return null; }
        let best = null, dist = Infinity;
        for (const s of this.stars.values()) {
            if (s.hid) { continue; }
            const d = (s.x - mx) ** 2 + (s.y - my) ** 2, lim = Math.max(8, s.sz + 4);
            if (d < lim * lim && d < dist) { dist = d; best = s; }
        }
        this.hover = best;
        if (!best) { return null; }
        const h = this.host, t = h.translations || {}, k = h.colors || {};
        const mono = 'font-family:var(--bs-font-monospace,monospace)';
        let place;
        if (best.cc) {
            let name = h.worldMap && h.worldMap[best.cc] && h.worldMap[best.cc].n;
            if (!name) {
                try { name = new Intl.DisplayNames(undefined, { type: 'region' }).of(best.cc); } catch (e) { name = null; }
            }
            place = `${esc(name || best.cc)} (${esc(best.cc)})`;
        } else {
            place = esc(best.cc === null ? (t.nogeo ?? 'LAN/IPv6') : '…');
        }
        const inbound = best.ni * 2 >= best.n;
        const html =
            `<span style="font-size:16px">${best.cc ? h._flag(best.cc) : '🌐'}</span> <b style="${mono}">${esc(best.ip)}</b><br>` +
            `${place} · ${esc(inbound ? (t.inbound ?? 'Inbound') : (t.outbound ?? 'Outbound'))}<br>` +
            `<b>${best.n}</b> ${esc(t.events ?? 'events')} · <b style="color:${k.block}">${best.c.block}</b> ${esc(t.blocked ?? 'blocked')}<br>` +
            `<span style="color:${k.pass}">${esc(t.pass ?? 'Pass')} ${best.c.pass}</span> · ` +
            `<span style="color:${k.block}">${esc(t.block ?? 'Block')} ${best.c.block}</span> · ` +
            `<span style="color:${k.nat}">${esc(t.nat ?? 'NAT')} ${best.c.nat}</span><br>` +
            (best.label ? `<span style="${mono};opacity:.8">${best.port !== '' ? ':' + esc(best.port) + ' ' : ''}${esc(best.proto)}</span> ${esc(best.label)}<br>` : '') +
            `<span style="opacity:.7">${esc(t.click ?? 'click to open in Live View')}</span>`;
        return { html, open: { field: inbound ? 'src' : 'dst', value: best.ip }, cursor: 'pointer' };
    }
}
