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
 * Sonar-sound: optional sonification for the Sonar widget (Nexo project, Igor Toledo).
 *
 * Everything is synthesized live with plain Web Audio (no audio files, no libraries):
 *   pass  = soft sine note; the pitch comes from the port, mapped onto a 3-octave major
 *           pentatonic scale from 220 Hz (same port = same note, so traffic patterns become melodies).
 *   nat   = short triangle click one octave above the port note.
 *   block = low thud (sine glissando 110 -> 38 Hz) plus a short lowpassed noise burst;
 *           inbound blocks are louder than outbound ones.
 * Master chain: voices -> DynamicsCompressor -> master gain (0.5) -> destination, so it never clips.
 * Throttle: at most ~12 sounds per second overall. Under a burst, pending events are merged into the
 * next slot: blocks win and several of them become a single stronger thud.
 * Off by default; the AudioContext is only created inside a user gesture (setEnabled(true)).
 * Silent while the tab is hidden. Without Web Audio every method is a no-op.
 */

const SLOT_MS = 1000 / 12;              // minimum spacing between two sounds
const MASTER_GAIN = 0.5;
const FADE_OUT = 0.12;                  // seconds, fade before suspending
const SCALE = [0, 2, 4, 7, 9];          // major pentatonic, semitones
const BASE_HZ = 220;
const OCTAVES = 3;
const MAX_PASS_QUEUE = 3;               // pass notes kept while waiting for a slot (latest win)
const SILENT = 0.0001;                  // exponential ramps cannot reach 0

export default class SonarSound {
    constructor(host) {
        this.host = host || null;
        const g = typeof globalThis !== 'undefined' ? globalThis : {};
        this.AC = g.AudioContext || g.webkitAudioContext || null;
        this.ctx = null;
        this.master = null;
        this.comp = null;
        this.noise = null;              // single shared white-noise buffer
        this.enabled = false;
        this.lastAt = -Infinity;        // clock (ms) of the last sound played
        this.timer = null;
        this.suspendTimer = null;
        this.voices = new Set();        // live source nodes, stopped on close
        this._resetPending();
    }

    _resetPending() {
        this.pending = { blockIn: 0, blockOut: 0, nat: 0, natPort: '', pass: [] };
    }

    _now() {
        return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    }

    _hidden() {
        return typeof document !== 'undefined' && !!document.hidden;
    }

    _clearTimer() {
        if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    }

    _build() {
        const ctx = new this.AC();
        const comp = ctx.createDynamicsCompressor();
        const set = (p, v) => { if (p) { try { p.setValueAtTime(v, ctx.currentTime); } catch (e) { p.value = v; } } };
        set(comp.threshold, -18);
        set(comp.knee, 12);
        set(comp.ratio, 6);
        set(comp.attack, 0.003);
        set(comp.release, 0.25);
        const master = ctx.createGain();
        master.gain.setValueAtTime(SILENT, ctx.currentTime);
        comp.connect(master);
        master.connect(ctx.destination);
        // 0.5 s of white noise, reused by every thud
        const len = Math.max(1, Math.floor(ctx.sampleRate * 0.5));
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        this.ctx = ctx;
        this.comp = comp;
        this.master = master;
        this.noise = buf;
    }

    setEnabled(on) {
        if (!this.AC) { this.enabled = false; return; }
        try {
            on = !!on;
            this.enabled = on;
            if (this.suspendTimer !== null) { clearTimeout(this.suspendTimer); this.suspendTimer = null; }
            if (on) {
                if (!this.ctx) this._build();
                const ctx = this.ctx;
                if (ctx.state === 'suspended' && ctx.resume) {
                    const p = ctx.resume();
                    if (p && p.catch) p.catch(() => {});
                }
                const g = this.master.gain, t = ctx.currentTime;
                if (g.cancelScheduledValues) g.cancelScheduledValues(t);
                g.setValueAtTime(Math.max(g.value || 0, SILENT), t);
                g.exponentialRampToValueAtTime(MASTER_GAIN, t + 0.05);
            } else {
                this._clearTimer();
                this._resetPending();
                if (!this.ctx) return;
                const ctx = this.ctx, g = this.master.gain, t = ctx.currentTime;
                if (g.cancelScheduledValues) g.cancelScheduledValues(t);
                g.setValueAtTime(Math.max(g.value || 0, SILENT), t);
                g.exponentialRampToValueAtTime(SILENT, t + FADE_OUT);
                this.suspendTimer = setTimeout(() => {
                    this.suspendTimer = null;
                    if (!this.enabled && this.ctx && this.ctx.state === 'running' && this.ctx.suspend) {
                        const p = this.ctx.suspend();
                        if (p && p.catch) p.catch(() => {});
                    }
                }, FADE_OUT * 1000 + 30);
            }
        } catch (e) {
            this.enabled = false;
        }
    }

    play(ev) {
        if (!this.enabled || !this.ctx || !ev || this._hidden()) return;
        const p = this.pending;
        const port = ev.port === undefined || ev.port === null ? '' : String(ev.port);
        if (ev.action === 'block') {
            if (ev.inbound) p.blockIn++; else p.blockOut++;
        } else if (ev.action === 'nat') {
            p.nat++;
            p.natPort = port || String(ev.proto || '');
        } else {
            p.pass.push(port || String(ev.proto || ''));
            if (p.pass.length > MAX_PASS_QUEUE) p.pass.shift();
        }
        const wait = this.lastAt + SLOT_MS - this._now();
        if (wait <= 0) {
            this._clearTimer();
            this._flush();
        } else if (this.timer === null) {
            this.timer = setTimeout(() => { this.timer = null; this._flush(); }, wait);
        }
    }

    // plays one sound for the current slot (blocks first) and reschedules if more is waiting
    _flush() {
        const p = this.pending;
        if (!this.enabled || !this.ctx || this._hidden()) { this._resetPending(); return; }
        if (this.ctx.state !== 'running') { this._resetPending(); return; }
        let played = true;
        try {
            if (p.blockIn || p.blockOut) {
                this._thud(p.blockIn, p.blockOut);
                // pass/nat waiting behind a block burst are stale: drop them, keep the rhythm for blocks
                p.blockIn = 0; p.blockOut = 0; p.pass.length = 0; p.nat = 0;
            } else if (p.pass.length) {
                this._note(p.pass.shift());
                if (p.nat) p.nat = 0;           // merged into the note
            } else if (p.nat) {
                this._click(p.natPort);
                p.nat = 0;
            } else {
                played = false;
            }
        } catch (e) {
            // never let audio break the widget
        }
        if (!played) return;
        this.lastAt = this._now();
        if ((p.blockIn || p.blockOut || p.pass.length || p.nat) && this.timer === null) {
            this.timer = setTimeout(() => { this.timer = null; this._flush(); }, SLOT_MS);
        }
    }

    static hash(s) {
        // FNV-1a, so neighbouring ports land on unrelated notes
        let h = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
        return h >>> 0;
    }

    static freqFor(key) {
        const idx = SonarSound.hash(String(key || '')) % (SCALE.length * OCTAVES);
        const semi = Math.floor(idx / SCALE.length) * 12 + SCALE[idx % SCALE.length];
        return BASE_HZ * Math.pow(2, semi / 12);
    }

    // starts src, wires the cleanup: every node in `nodes` is disconnected when src ends
    _voice(src, nodes, t0, t1) {
        this.voices.add(src);
        src.onended = () => {
            this.voices.delete(src);
            for (const n of nodes) { try { n.disconnect(); } catch (e) { /* already gone */ } }
        };
        src.start(t0);
        src.stop(t1);
    }

    _env(gain, t, peak, attack, decay) {
        gain.setValueAtTime(SILENT, t);
        gain.linearRampToValueAtTime(peak, t + attack);
        gain.exponentialRampToValueAtTime(SILENT, t + attack + decay);
    }

    _note(key) {
        const ctx = this.ctx, t = ctx.currentTime;
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(SonarSound.freqFor(key), t);
        this._env(g.gain, t, 0.05, 0.008, 0.35);
        osc.connect(g); g.connect(this.comp);
        this._voice(osc, [osc, g], t, t + 0.4);
    }

    _click(key) {
        const ctx = this.ctx, t = ctx.currentTime;
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(SonarSound.freqFor(key) * 2, t);
        this._env(g.gain, t, 0.03, 0.004, 0.116);
        osc.connect(g); g.connect(this.comp);
        this._voice(osc, [osc, g], t, t + 0.14);
    }

    _thud(nIn, nOut) {
        const ctx = this.ctx, t = ctx.currentTime;
        // inbound weighs 1, outbound 0.7; several blocks merge into one louder thud (log growth, capped)
        const weight = nIn + nOut * 0.7;
        const base = nIn ? 1 : 0.7;
        const k = Math.min(1.8, base * (1 + 0.3 * Math.log2(Math.max(1, weight))));
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(110, t);
        osc.frequency.exponentialRampToValueAtTime(38, t + 0.25);
        this._env(g.gain, t, 0.16 * k, 0.005, 0.35);
        osc.connect(g); g.connect(this.comp);
        this._voice(osc, [osc, g], t, t + 0.4);
        // noise burst through a lowpass
        const src = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), ng = ctx.createGain();
        src.buffer = this.noise;
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(900, t);
        this._env(ng.gain, t, 0.08 * k, 0.003, 0.077);
        src.connect(lp); lp.connect(ng); ng.connect(this.comp);
        this._voice(src, [src, lp, ng], t, t + 0.09);
    }

    close() {
        this.enabled = false;
        this._clearTimer();
        if (this.suspendTimer !== null) { clearTimeout(this.suspendTimer); this.suspendTimer = null; }
        this._resetPending();
        const ctx = this.ctx;
        if (!ctx) return;
        for (const v of this.voices) { try { v.stop(); } catch (e) { /* not started or ended */ } }
        this.voices.clear();
        try { this.master.disconnect(); this.comp.disconnect(); } catch (e) { /* ignore */ }
        this.ctx = null; this.master = null; this.comp = null; this.noise = null;
        try {
            const p = ctx.close();
            if (p && p.catch) p.catch(() => {});
        } catch (e) { /* ignore */ }
    }
}
