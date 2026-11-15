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
 * Sonar: DIGITAL RAIN mode (loaded on demand by Sonar.js).
 *
 * "Falling code" lettering made of real data: one column per destination port (or protocol when the
 * event has no port). Every log event becomes a drop: the remote IP written vertically, bright head and
 * fading trail, coloured by the action. The firewall is the floor near the bottom: blocked drops shatter
 * on it (the characters fly off as fragments and the floor glows red in that column), passed / NAT drops
 * go through it and fade just below. A faint ambient rain of 0/1/hex glyphs runs behind. A port scan
 * shows up as a storm sweeping across the columns.
 *
 * Cost: the trail of each drop is pre-rendered once into a small sprite (cached by text and action), so a
 * drop is one or two drawImage calls per frame; fillText is only used for the ambient glyphs, the labels
 * and the fragments.
 */

const LH = 13;          // vertical step between the characters of a drop (px)
const PAD = 8;          // sprite padding, room for the head glow
const SW = 24;          // sprite width (px)
const BELOW = 34;       // room under the floor for the column labels
const MAX_DROPS = 160;
const MAX_FRAGS = 300;
const FRAG_LIFE = 900;
const DECAY = 60000;    // column weight time constant (ms)
const RECENT = 6;       // remote IPs remembered per column
const AMBIENT = 3;      // ambient glyphs per column
const GLYPHS = '0101010123456789abcdef';

// small deterministic hash -> [0, 1)
const rnd = (a, b) => {
    const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return s - Math.floor(s);
};

export default class RainView {
    constructor(host) {
        this.host = host;
        this.cols = [];             // slot per column: null or { key, port, label, svc, w, wt, n, blk, pas, nat, recent[] }
        this.byKey = new Map();     // key -> column index
        this.drops = [];
        this.frags = [];
        this.sprites = new Map();   // LRU of pre-rendered trails
        this.spriteSig = '';
        this.nextT0 = 0;
        this.total = 0;
        this.mono = host.monoFont || '';
        if (!this.mono && host.el) {
            // monospace font of the active theme (same as <code>)
            const cd = document.createElement('code'); cd.style.display = 'none'; host.el.appendChild(cd);
            this.mono = getComputedStyle(cd).fontFamily.replace(/"/g, "'"); cd.remove();
        }
        if (!this.mono) { this.mono = 'monospace'; }
        this.resize();
    }

    /* ------------------------------------------------------------------ data */

    resize() {
        const n = Math.max(6, Math.min(28, Math.floor((this.host.w || 0) / 30)));
        if (n === this.cols.length) { return; }
        if (n < this.cols.length) {
            // keep the heaviest columns, in their current left-to-right order
            const now = performance.now();
            const live = this.cols.map((s, i) => [s, i]).filter(([s]) => s);
            const keep = new Set(live.sort((a, b) => this._weight(b[0], now) - this._weight(a[0], now)).slice(0, n).map(([s]) => s));
            const order = this.cols.filter((s) => s && keep.has(s));
            this.cols = order.concat(new Array(n - order.length).fill(null));
            this.drops = this.drops.filter((d) => d.i < n);
        } else {
            this.cols = this.cols.concat(new Array(n - this.cols.length).fill(null));
        }
        this.byKey.clear();
        this.cols.forEach((s, i) => { if (s) { this.byKey.set(s.key, i); s.fitW = 0; } });
    }

    _weight(s, now) {
        return s.w * Math.exp(-Math.max(0, now - s.wt) / DECAY);
    }

    add(ev) {
        const port = ev.port !== '' && ev.port != null ? String(ev.port) : '';
        const proto = String(ev.proto || '').toLowerCase();
        const key = port ? 'p:' + port : 'x:' + (proto || '?');
        const real = performance.now();
        let i = this.byKey.get(key);
        if (i === undefined) {
            i = this.cols.indexOf(null);
            if (i < 0) {
                // no free column: the one with the lowest recent weight gives its place
                let low = Infinity;
                this.cols.forEach((s, j) => { const w = this._weight(s, real); if (w < low) { low = w; i = j; } });
                this.byKey.delete(this.cols[i].key);
            }
            const svc = port ? (this.host.constructor.SVC || {})[port] : '';
            this.cols[i] = { key, port, label: port || (proto || '?').toUpperCase(), svc: svc || (port ? proto : ''),
                w: 0, wt: ev.now, n: 0, blk: 0, pas: 0, nat: 0, recent: [], fitW: 0, hit: 0, pass: 0 };
            this.byKey.set(key, i);
        }
        const s = this.cols[i];
        s.w = this._weight(s, ev.now) + 1; s.wt = Math.max(s.wt, ev.now);
        s.n++; this.total++;
        if (ev.action === 'block') { s.blk++; } else if (ev.action === 'nat') { s.nat++; } else { s.pas++; }
        let ip = String(ev.remote ?? '');
        if (ip.length > 16) { ip = '…' + ip.slice(-15); }
        s.recent.push({ ip, action: ev.action });
        if (s.recent.length > RECENT) { s.recent.shift(); }

        // only fresh events fall (the history replayed on creation just fills the columns)
        if (this.host.reducedMotion || !(ev.now > real - 1500) || !ip) { return; }
        // events that arrive together leave one after another: a scan sweeps across the columns
        let t0 = Math.max(real, this.nextT0 + 28);
        t0 = Math.max(t0, (s.nextT0 || 0) + 170);
        if (t0 - real > 2500) { return; }
        this.nextT0 = Math.max(this.nextT0, Math.min(t0, real + 600));
        s.nextT0 = t0;
        if (this.drops.length >= MAX_DROPS) { this.drops.shift(); }
        const floor = this._floor();
        this.drops.push({ i, ip, action: ev.action === 'block' || ev.action === 'nat' ? ev.action : 'pass',
            t0: t0 - Math.max(0, real - ev.now),     // a replayed fresh event is already on its way down
            v: (floor + 60) / 2700 * (0.8 + Math.random() * 0.45), broken: 0 });
    }

    _floor() {
        return Math.max(40, (this.host.h || 0) - BELOW);
    }

    /* ------------------------------------------------------------------ sprites */

    _tint(color, f) {
        const m = String(color).match(/\d+(\.\d+)?/g);
        if (!m) { return color; }
        const mix = (v) => Math.round(+v + (255 - v) * f);
        return `rgb(${mix(m[0])},${mix(m[1])},${mix(m[2])})`;
    }

    _sprite(text, action, dpr) {
        const id = action + '|' + text;
        let sp = this.sprites.get(id);
        if (sp) { this.sprites.delete(id); this.sprites.set(id, sp); return sp; }
        const host = this.host, k = host.colors, col = k[action] || k.pass, n = text.length;
        const hgt = n * LH + PAD * 2;
        const cv = document.createElement('canvas');
        cv.width = Math.ceil(SW * dpr); cv.height = Math.ceil(hgt * dpr);
        const g = cv.getContext('2d');
        g.scale(dpr, dpr);
        g.font = `12px ${this.mono}`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        for (let j = 0; j < n - 1; j++) {
            const f = (j + 1) / n;
            g.fillStyle = host._withAlpha(col, (host.dark ? 0.10 : 0.16) + (host.dark ? 0.70 : 0.72) * f * f);
            g.fillText(text[j], SW / 2, PAD + (j + 0.5) * LH);
        }
        // head: brighter, bold and glowing
        g.font = `700 12px ${this.mono}`;
        g.shadowColor = host._withAlpha(col, host.dark ? 0.95 : 0.6);
        g.shadowBlur = host.dark ? 9 : 5;
        g.fillStyle = host.dark ? this._tint(col, 0.72) : col;
        g.fillText(text[n - 1], SW / 2, PAD + (n - 0.5) * LH);
        if (host.dark) { g.shadowBlur = 3; g.fillText(text[n - 1], SW / 2, PAD + (n - 0.5) * LH); }
        sp = { cv, n, hgt };
        this.sprites.set(id, sp);
        if (this.sprites.size > 120) { this.sprites.delete(this.sprites.keys().next().value); }
        return sp;
    }

    // copy rows y0..y1 (CSS px) of a sprite whose top-left goes at (dx, dy), snapped to device pixels:
    // a 1:1 copy is cheap, a fractional position makes the browser resample (several times slower)
    _blit(c, sp, y0, y1, dx, dy, dpr) {
        const sy = Math.max(0, Math.round(y0 * dpr)), ey = Math.min(sp.cv.height, Math.round(y1 * dpr));
        if (ey <= sy) { return; }
        c.drawImage(sp.cv, 0, sy, sp.cv.width, ey - sy,
            Math.round(dx * dpr) / dpr, (Math.round(dy * dpr) + sy) / dpr, sp.cv.width / dpr, (ey - sy) / dpr);
    }

    /* ------------------------------------------------------------------ drawing */

    draw(now) {
        const host = this.host, c = host.ctx, k = host.colors;
        const w = host.w, h = host.h, t = host.translations || {};
        if (!c || !k) { return; }
        c.clearRect(0, 0, w, h);
        const base = c.getTransform();
        const dpr = base.a || 1;
        const sig = [k.pass, k.block, k.nat, host.dark, dpr, this.mono].join('|');
        if (sig !== this.spriteSig) { this.sprites.clear(); this.spriteSig = sig; }
        const n = this.cols.length, cw = w / n, floor = this._floor();
        const motion = !host.reducedMotion;
        const hov = host.hover && host.hover.rain ? host.hover.col : -1;

        // hovered column band
        if (hov >= 0 && hov < n) {
            const g = c.createLinearGradient(0, 0, 0, floor);
            g.addColorStop(0, host._withAlpha(k.beam, 0));
            g.addColorStop(1, host._withAlpha(k.beam, host.dark ? 0.13 : 0.09));
            c.fillStyle = g; c.fillRect(hov * cw, 0, cw, floor);
        }

        // ambient rain: a few faint glyphs per column
        c.font = `12px ${this.mono}`;
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillStyle = host._withAlpha(host.dark ? k.beam : k.text, host.dark ? 0.11 : 0.075);
        const span = floor + 40;
        for (let i = 0; i < n; i++) {
            const x = (i + 0.5) * cw;
            for (let j = 0; j < AMBIENT; j++) {
                const sp = 0.018 + rnd(i, j) * 0.03;
                const p = (motion ? now : 0) * sp + rnd(j, i) * span;
                const cyc = Math.floor(p / span), y = p - cyc * span - 20;
                if (y > floor - 6) { continue; }
                const gi = Math.floor(rnd(i * 7 + cyc, j * 3 + Math.floor(y / 52)) * GLYPHS.length);
                c.fillText(GLYPHS[gi], x, y);
            }
        }

        if (motion) { this._drawDrops(c, now, cw, floor, dpr); } else { this._drawStatic(c, cw, floor, dpr); }

        // the floor (the firewall): gradient line in the accent colour
        let g = c.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0, host._withAlpha(k.beam, 0.05));
        g.addColorStop(0.5, host._withAlpha(k.beam, 0.9));
        g.addColorStop(1, host._withAlpha(k.beam, 0.05));
        c.fillStyle = g; c.fillRect(0, floor - 1, w, 2);
        g = c.createLinearGradient(0, floor - 10, 0, floor);
        g.addColorStop(0, host._withAlpha(k.beam, 0));
        g.addColorStop(1, host._withAlpha(k.beam, host.dark ? 0.16 : 0.10));
        c.fillStyle = g; c.fillRect(0, floor - 10, w, 10);

        // per-column floor glow: red when something shattered, faint accent when something went through
        for (let i = 0; i < n; i++) {
            const s = this.cols[i];
            if (!s || !motion) { continue; }
            const qb = Math.max(0, 1 - (now - s.hit) / 700), qp = Math.max(0, 1 - (now - s.pass) / 450);
            if (qb <= 0 && qp <= 0) { continue; }
            const col = qb > 0 ? k.block : k.beam, q = Math.max(qb, qp * 0.6);
            g = c.createLinearGradient(0, floor - 16, 0, floor + 6);
            g.addColorStop(0, host._withAlpha(col, 0));
            g.addColorStop(0.75, host._withAlpha(col, 0.55 * q));
            g.addColorStop(1, host._withAlpha(col, 0));
            c.fillStyle = g; c.fillRect(i * cw + 1, floor - 16, cw - 2, 22);
            c.fillStyle = host._withAlpha(col, 0.95 * q);
            c.fillRect(i * cw + 2, floor - 1, cw - 4, 2);
        }

        if (motion) { this._drawFrags(c, now, base); }
        this._drawLabels(c, now, cw, floor);

        if (!this.total) {
            c.font = '12px ' + getComputedStyle(host.el).fontFamily;
            c.textAlign = 'center'; c.textBaseline = 'middle';
            c.fillStyle = host._withAlpha(k.text, 0.55);
            c.fillText(t.waiting ?? 'Waiting for firewall log events…', w / 2, floor / 2);
        }
    }

    _drawDrops(c, now, cw, floor, dpr) {
        const host = this.host, keep = [];
        for (const d of this.drops) {
            const age = now - d.t0;
            if (age < 0) { keep.push(d); continue; }
            const sp = this._sprite(d.ip, d.action, dpr);
            const hy = -4 + d.v * age;                          // centre of the head character
            const top = hy - PAD - (sp.n - 0.5) * LH;           // sprite top
            const x = (d.i + 0.5) * cw - SW / 2;
            const s = this.cols[d.i];
            if (d.action === 'block') {
                // every character that reaches the floor breaks into a fragment
                while (d.broken < sp.n && hy - d.broken * LH >= floor) {
                    const late = (hy - d.broken * LH - floor) / d.v;   // ms since that character touched
                    if (late < 250 && this.frags.length < MAX_FRAGS) {
                        const j = sp.n - 1 - d.broken;
                        this.frags.push({ ch: d.ip[j], head: d.broken === 0, x: x + SW / 2, y: floor - 3,
                            vx: (Math.random() - 0.5) * 0.24, vy: -(0.08 + Math.random() * 0.2),
                            r: 0, vr: (Math.random() - 0.5) * 0.02, t0: now - late });
                    }
                    if (d.broken === 0 && s && late < 250) { s.hit = now; }
                    d.broken++;
                }
                if (d.broken >= sp.n) { continue; }
                const hcut = Math.min(sp.hgt, floor - top);    // only what is still above the floor
                if (hcut > 0) { this._blit(c, sp, 0, hcut, x, top, dpr); }
                keep.push(d);
                continue;
            }
            // pass / NAT: through the floor, fading just below it
            if (top > floor + 28) { continue; }
            if (!d.crossed && hy >= floor) { d.crossed = true; if (s && hy - floor < 40) { s.pass = now; } }
            const hcut = Math.min(sp.hgt, floor - top);
            if (hcut >= sp.hgt) {
                this._blit(c, sp, 0, sp.hgt, x, top, dpr);
            } else {
                if (hcut > 0) { this._blit(c, sp, 0, hcut, x, top, dpr); }
                // below the floor: 3 bands of decreasing opacity
                const a0 = c.globalAlpha;
                for (let b = 0; b < 3; b++) {
                    const y0 = Math.max(top, floor + b * 9), y1 = Math.min(top + sp.hgt, floor + (b + 1) * 9);
                    if (y1 <= y0) { continue; }
                    c.globalAlpha = a0 * [0.45, 0.22, 0.08][b];
                    this._blit(c, sp, y0 - top, y1 - top, x, top, dpr);
                }
                c.globalAlpha = a0;
            }
            keep.push(d);
        }
        this.drops = keep;
    }

    _drawFrags(c, now, base) {
        if (!this.frags.length) { return; }
        const host = this.host, k = host.colors, d = base.a || 1;
        const head = host.dark ? this._tint(k.block, 0.6) : k.block;
        this.frags = this.frags.filter((f) => now - f.t0 < FRAG_LIFE);
        c.font = `700 12px ${this.mono}`;
        c.textAlign = 'center'; c.textBaseline = 'middle';
        const a0 = c.globalAlpha;
        for (const f of this.frags) {
            const a = now - f.t0, q = 1 - a / FRAG_LIFE;
            const x = f.x + f.vx * a, y = f.y + f.vy * a + 0.00045 * a * a;
            const r = f.r + f.vr * a, cs = Math.cos(r), sn = Math.sin(r);
            c.setTransform(d * cs, d * sn, -d * sn, d * cs, base.e + d * x, base.f + d * y);
            c.globalAlpha = a0 * q * q;
            c.fillStyle = f.head ? head : k.block;
            c.fillText(f.ch, 0, 0);
        }
        c.setTransform(base);
        c.globalAlpha = a0;
    }

    _drawStatic(c, cw, floor, dpr) {
        // reduced motion: the last IPs of each column stacked on the floor, newest at the bottom
        const a0 = c.globalAlpha;
        this.cols.forEach((s, i) => {
            if (!s) { return; }
            const x = (i + 0.5) * cw - SW / 2;
            let bottom = floor - 4;
            for (let j = s.recent.length - 1, age = 0; j >= 0; j--, age++) {
                const r = s.recent[j], sp = this._sprite(r.ip, r.action === 'block' || r.action === 'nat' ? r.action : 'pass', dpr);
                const top = bottom - sp.hgt + PAD;
                if (top < -PAD) { break; }
                c.globalAlpha = a0 * Math.max(0.3, 1 - age * 0.25);
                this._blit(c, sp, 0, sp.hgt, x, top, dpr);
                bottom = top + PAD - 10;          // a gap between two addresses
            }
        });
        c.globalAlpha = a0;
    }

    _drawLabels(c, now, cw, floor) {
        const host = this.host, k = host.colors;
        let max = 0;
        const ws = this.cols.map((s) => { const v = s ? this._weight(s, now) : 0; max = Math.max(max, v); return v; });
        c.textAlign = 'center'; c.textBaseline = 'middle';
        const fit = (txt, wmax) => {
            if (c.measureText(txt).width <= wmax) { return txt; }
            while (txt.length > 1 && c.measureText(txt + '…').width > wmax) { txt = txt.slice(0, -1); }
            return txt + '…';
        };
        this.cols.forEach((s, i) => {
            if (!s) { return; }
            const x = (i + 0.5) * cw, op = 0.3 + 0.7 * Math.sqrt(max > 0 ? ws[i] / max : 0);
            // block / pass share bar right under the floor
            const bw = cw - 8, bb = s.n ? bw * s.blk / s.n : 0;
            c.fillStyle = host._withAlpha(k.block, 0.7 * op); c.fillRect(i * cw + 4, floor + 4, bb, 2);
            c.fillStyle = host._withAlpha(k.pass, 0.7 * op); c.fillRect(i * cw + 4 + bb, floor + 4, bw - bb, 2);
            if (s.fitW !== cw) {
                c.font = `600 11px ${this.mono}`; s.fitL = fit(s.label, cw - 3);
                c.font = `9px ${this.mono}`; s.fitS = s.svc && cw >= 26 ? fit(s.svc, cw - 3) : '';
                s.fitW = cw;
            }
            const hot = now - s.hit < 1200;
            c.font = `600 11px ${this.mono}`;
            c.fillStyle = host._withAlpha(hot ? k.block : k.text, op);
            c.fillText(s.fitL, x, floor + 15);
            if (s.fitS) {
                c.font = `9px ${this.mono}`;
                c.fillStyle = host._withAlpha(k.text, op * 0.6);
                c.fillText(s.fitS, x, floor + 27);
            }
        });
    }

    /* ------------------------------------------------------------------ hover */

    hit(mx, my) {
        const host = this.host, n = this.cols.length;
        if (!n || mx < 0 || mx >= host.w || my < 0 || my >= host.h) { return null; }
        const i = Math.floor(mx / (host.w / n)), s = this.cols[i];
        if (!s) { return null; }
        const t = host.translations || {}, k = host.colors || {};
        const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
        const name = s.port ? `${s.port}${s.svc ? ' ' + s.svc : ''}` : s.label;
        const last = s.recent.slice(-3).reverse()
            .map((r) => `<span style="color:${k[r.action] || k.pass}">${esc(r.ip)}</span>`).join(' · ');
        const html =
            `<span style="opacity:.7">${esc(t.service ?? 'Service')}</span><br><b style="color:${k.beam}">${esc(name)}</b><br>` +
            `${esc(t.hits ?? 'Hits')}: ${s.n} · <span style="color:${k.block}">${esc(t.blocked ?? 'blocked')}: ${s.blk}</span>` +
            ` · <span style="color:${k.pass}">${esc(t.passed ?? 'passed')}: ${s.pas}</span>` +
            (s.nat ? ` · <span style="color:${k.nat}">${esc(t.nat ?? 'NAT')}: ${s.nat}</span>` : '') +
            (last ? `<br><span style="opacity:.7">${esc(t.lastsources ?? 'Last sources')}:</span> ${last}` : '');
        return { html, open: s.port ? { field: 'dstport', value: s.port } : null, cursor: s.port ? 'pointer' : undefined,
            rain: true, col: i };
    }
}
