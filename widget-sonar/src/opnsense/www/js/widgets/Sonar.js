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
 * Sonar: OPNsense dashboard widget (Nexo project, Igor Toledo).
 *
 * 3D-perspective radar showing firewall log connections in real time:
 * passed (pass), blocked (block) and NAT/redirect (nat/rdr/binat).
 *
 * Source: the same stream as the Firewall widget (/api/diagnostics/firewall/stream_log), no new API.
 * Angle      = hash of the remote IP (the same IP always lands in the same sector; it is not geography).
 * Radius     = inbound (in) in the outer band, outbound (out) in the inner one; the port spreads it within the band.
 * Height     = how many times that remote IP was seen (taller column = more persistent).
 * Brightness = lights up when the beam passes and fades with age (up to 2 min).
 * Colors     = read from the active theme (text-success/danger/info classes), so they follow light/dark.
 * Plain 2D canvas, no libraries; pauses while the tab is in the background; at most 300 points.
 *
 * MAP mode (Sonar | Map button, remembered by the browser): world map with animated arc arrows;
 * blocked inbound connections fly as missiles that explode on the firewall's shield (off with reduced motion)
 * from the source country to the destination (green = passed, red = blocked, blue = NAT) and the flag
 * of the remote country. IP country: Sonar-geo.bin (generated from the firewall's own GeoIP lists, IPv4);
 * outlines: Sonar-map.json (Natural Earth 1:110m, public domain). Both are served by the firewall and
 * only loaded when map mode is opened. IPv6 and private IPs are not drawn on the map (counted separately).
 * FLOW mode: live Sankey of the same stream, Origin (country / local hosts) -> Interface -> Service (port)
 * -> Decision (blocking rule, Pass, NAT). Band widths decay with time (about the last minute); every event
 * runs through the bands as a particle and blocked ones burst on their rule. Particles are off with reduced motion.
 * The Sonar | Map | Flow selector is a sliding switch remembered by the browser.
 *
 * Actions: pass, block, nat (nat/rdr/binat) and, since OPNsense 27.1, match (normalization rules): a fourth
 * category in the theme's warning colour (text-warning), as in the core Firewall widget. The internal views
 * (Sonar, Map, Flow) treat it as its own action; the module views receive ev.action = 'match' as is.
 *
 * Dashboard API (26.7 and 27.1): only BaseWidget (setId, translations, getMarkup, onMarkupRendered,
 * openEventSource, onWidgetResize, onWidgetTick, onWidgetClose). The widget root is found by
 * [data-widget-instance-id] (27.1, every instance of a <multiple/> widget) or [gs-id] / .widget-<id> (26.7);
 * there is no page-wide fallback, so two instances never share a canvas. 27.1 extras are feature-detected:
 * config.callbacks.updateTitle() shows the active view in the title ("Sonar · Map") and onEditModeChanged()
 * pauses the animation, the tooltip and the click-through to the Live View while the dashboard is edited.
 * The view and the sound switch are remembered in localStorage (nexo.sonar.mode / nexo.sonar.sound).
 *
 * FULLSCREEN: the .sonar-fs button (next to the sound switch) puts the .sonar-widget root in fullscreen with
 * the Fullscreen API (this.el.requestFullscreen) or, without it, as a fixed overlay (.sonar-overlay,
 * z-index 10000). Esc or the button leave. 'fullscreenchange' keeps this.fullscreen, the .sonar-fullscreen
 * class, _resize() and every module's resize() in sync; the modules read host.fullscreen and host.fsDark.
 * Fullscreen is always dark (background --sonar-fs-bg, light text; pass/block/nat/match/beam stay the theme's),
 * the control bar (legend, selector, sound, fullscreen) hides 3 s after the last pointer move
 * (.sonar-controls-hidden) and the side panel grows to 300px / 13px. The dashboard is not touched: the
 * widget container keeps its height while the root is out of flow, so gridstack sees no change.
 *
 * TELEMETRY (host.telemetry, for the module views, on demand): start()/stop() keep a usage counter; while
 * active the service streams the CPU (/api/diagnostics/cpu_usage/stream: total/user/sys/intr 0-100, hist of
 * the last 60 totals), polls the memory every 5 s (/api/diagnostics/system/system_resources: total_mb,
 * used_mb, arc_mb, pct, hist 60) and streams the traffic (/api/diagnostics/traffic/stream/1, per-interval
 * bytes -> bps as in the core Traffic widget) of the WAN interfaces (/api/diagnostics/traffic/interface for
 * the names, /api/interfaces/overview/interfaces_info: interfaces with gateways; fallback: description or key
 * containing "wan"): wan = [{key, name, in_bps, out_bps, hist_in[60], hist_out[60]}], updated = ms. The
 * streams are the service's own EventSources (BaseWidget keeps only one), reconnect a few times and close on
 * stop(); the host also calls reset() when the widget closes or the view changes. Where the endpoints are
 * unreachable (preview) the service falls back to simulated values (telemetry.simulated).
 * EXPOSURE (host.exposure, same as telemetry.exposure): started and stopped with the telemetry; if the Policy
 * Analyzer plugin answers /api/policyanalyzer/exposure/report, its JSON is exposed as is in exposure.data
 * (refreshed every 5 min, exposure.updated = ms, exposure.available = true). A 404/401/403 or a non-JSON answer
 * sets available = false and the endpoint is not asked again; without the plugin nothing else changes.
 * MODULE CLICKS: hit(mx, my) may return `hint` (text shown instead of "click to open in Live View") and a module
 * may define click(hover): when it returns true the click was handled by the view and no Live View tab opens
 * (Max Cyber uses it for the AI analyst panel).
 */
/*
 * Shared EventSource for the firewall streams (installed once per page when the Sonar module loads).
 * Each EventSource on these endpoints is a long-running process on the firewall (read_log.py + tail,
 * traffic_stats.php, cpu.py). Widgets that ask for the SAME url on the same page (Sonar, its clones, and the
 * core Firewall / Traffic / CPU widgets) get a facade attached to ONE real connection; it is closed when the
 * last facade closes. Only the urls below are shared; every other EventSource is untouched. Facades behave
 * like EventSource (onmessage/onerror/onopen, addEventListener, readyState, close, url).
 */
(function installSharedEventSource() {
    const Native = window.EventSource;
    if (!Native || Native.__sonarShared) { return; }
    const SHARED = [/\/api\/diagnostics\/firewall\/stream_log(\?|$)/, /\/api\/diagnostics\/cpu_usage\/stream(\?|$)/,
        /\/api\/diagnostics\/traffic\/stream\/\d+(\?|$)/];
    const pool = new Map();   // absolute url -> {es, facades:Set}

    class SharedEventSource extends EventTarget {
        constructor(url, init) {
            super();
            const abs = new URL(url, location.href).href;
            this.url = abs; this.withCredentials = !!(init && init.withCredentials);
            this.onmessage = null; this.onerror = null; this.onopen = null;
            let entry = pool.get(abs);
            if (!entry || entry.es.readyState === Native.CLOSED) {
                const es = new Native(url, init);
                entry = { es, facades: new Set() };
                pool.set(abs, entry);
                const fan = (type) => (ev) => {
                    for (const f of [...entry.facades]) { f._emit(type, ev); }
                    if (type === 'error' && es.readyState === Native.CLOSED && pool.get(abs) === entry) { pool.delete(abs); }
                };
                es.onmessage = fan('message'); es.onerror = fan('error'); es.onopen = fan('open');
            }
            this._entry = entry; entry.facades.add(this);
            if (entry.es.readyState === Native.OPEN) { setTimeout(() => this._emit('open', new Event('open')), 0); }
        }
        get readyState() { return this._entry ? this._entry.es.readyState : Native.CLOSED; }
        _emit(type, ev) {
            const copy = type === 'message' ? new MessageEvent('message', { data: ev.data, lastEventId: ev.lastEventId, origin: ev.origin }) : new Event(type);
            const h = this['on' + type];
            if (typeof h === 'function') { try { h.call(this, copy); } catch (e) { console.error(e); } }
            this.dispatchEvent(type === 'message' ? new MessageEvent('message', { data: ev.data, lastEventId: ev.lastEventId, origin: ev.origin }) : new Event(type));
        }
        close() {
            const entry = this._entry; if (!entry) { return; }
            this._entry = null; entry.facades.delete(this);
            if (!entry.facades.size) { try { entry.es.close(); } catch (e) { /* ignore */ } if (pool.get(this.url) === entry) { pool.delete(this.url); } }
        }
    }
    SharedEventSource.CONNECTING = 0; SharedEventSource.OPEN = 1; SharedEventSource.CLOSED = 2;

    function EventSourceProxy(url, init) {
        const abs = new URL(url, location.href).href;
        return SHARED.some((re) => re.test(abs)) ? new SharedEventSource(url, init) : new Native(url, init);
    }
    EventSourceProxy.prototype = Native.prototype;
    EventSourceProxy.CONNECTING = 0; EventSourceProxy.OPEN = 1; EventSourceProxy.CLOSED = 2;
    EventSourceProxy.__sonarShared = true;
    window.EventSource = EventSourceProxy;
})();

export default class Sonar extends BaseWidget {
    // views, in selector order; the last three live in their own modules, imported on first use
    static MODES = ['sonar', 'map', 'flow', 'citadel', 'hole', 'rain', 'cyber'];
    static MODULES = { citadel: './Sonar-citadel.js', hole: './Sonar-hole.js', rain: './Sonar-rain.js', cyber: './Sonar-cyber.js' };
    // how a module ('./Sonar-x.js') is loaded: import() next to this file; a bundle (the TV legacy build) replaces it
    static MODULE_LOADER = (path) => import(Sonar._moduleUrl(path));
    static NAMES = { sonar: 'Sonar', map: 'Map', flow: 'Flow', citadel: 'Citadel', hole: 'Black hole', rain: 'Digital rain', cyber: 'Max Cyber' };
    // 16x16 line icons for the selector (stroke = currentColor)
    static ICONS = {
        sonar: '<circle cx="8" cy="8" r="6.3"/><circle cx="8" cy="8" r="3"/><path d="M8 8l5.2-3.4"/>',
        map: '<circle cx="8" cy="8" r="6.3"/><ellipse cx="8" cy="8" rx="2.7" ry="6.3"/><path d="M1.7 8h12.6"/>',
        flow: '<path d="M1.5 3.5c6 0 7 9 13 9M1.5 8h13M1.5 12.5c6 0 7-9 13-9"/>',
        citadel: '<path d="M1.5 14.5h13M3.5 14.5v-4h2.5v4M7 14.5V8h2.5v6.5M10.5 14.5v-3H13v3"/><path d="M1.8 12.5A6.4 7 0 0 1 14.2 12.5" stroke-dasharray="1.5 1.3"/>',
        hole: '<ellipse cx="8" cy="8" rx="7" ry="2.6" transform="rotate(-18 8 8)"/><circle cx="8" cy="8" r="2.6" fill="currentColor"/>',
        rain: '<path d="M3 1.5v4.5M3 8.5v2M8 2.5v7.5M8 12.5v2M13 1.5v3M13 7v6"/>',
        cyber: '<path d="M8 1.5l5.6 3.25v6.5L8 14.5l-5.6-3.25v-6.5z"/><path d="M8 5l2.6 1.5v3L8 11l-2.6-1.5v-3z"/><path d="M8 1.5V5M13.6 4.75l-3 1.75M2.4 4.75l3 1.75M8 11v3.5M13.6 11.25l-3-1.75M2.4 11.25l3-1.75"/>'
    };

    static SVC = { 21: 'ftp', 22: 'ssh', 23: 'telnet', 25: 'smtp', 53: 'dns', 80: 'http', 110: 'pop3', 123: 'ntp',
            135: 'msrpc', 139: 'netbios', 143: 'imap', 161: 'snmp', 443: 'https', 445: 'smb', 1433: 'mssql',
            1723: 'pptp', 3306: 'mysql', 3389: 'rdp', 5060: 'sip', 5432: 'postgres', 5900: 'vnc', 6379: 'redis',
            8080: 'http-alt', 8443: 'https-alt', 9200: 'elastic', 27017: 'mongodb' };

    // Shared firewall log stream: the first Sonar instance opens it, the last one closes it. A refused/closed
    // stream is reopened with a growing delay (5 s → 60 s); the browser's own retry covers short drops.
    static _logHub = {
        url: '/api/diagnostics/firewall/stream_log',
        es: null, subs: new Set(), retries: 0, timer: null,
        subscribe(fn) {
            this.subs.add(fn);
            if (!this.es && !this.timer) { this._open(); }
            return fn;
        },
        unsubscribe(fn) {
            this.subs.delete(fn);
            if (!this.subs.size) {
                clearTimeout(this.timer); this.timer = null;
                if (this.es) { try { this.es.close(); } catch (e) { /* ignore */ } this.es = null; }
                this.retries = 0;
            }
        },
        _open() {
            this.timer = null;
            if (!this.subs.size) { return; }
            let es;
            try { es = new EventSource(this.url); } catch (e) { this._retry(); return; }
            es.onmessage = (ev) => {
                this.retries = 0;
                for (const fn of this.subs) { try { fn(ev); } catch (e) { console.error('Sonar', e); } }
            };
            es.onerror = () => {
                if (es.readyState === EventSource.CLOSED) {
                    if (this.es === es) { this.es = null; }
                    this._retry();
                }
            };
            this.es = es;
        },
        _retry() {
            if (!this.subs.size || this.timer) { return; }
            const n = this.retries++;
            this.timer = setTimeout(() => this._open(), Math.min(60000, 5000 * Math.pow(2, Math.min(n, 4))));
        }
    };

    constructor(config) {
        super(config);
        this.tickTimeout = 30;
        this.blips = new Map();          // key: action|remoteIp
        this.maxBlips = 300;
        this.lifeMs = 120000;            // 2 min
        this.periodMs = 4000;            // one full beam sweep
        this.startTime = performance.now();
        this.raf = null;
        this.hover = null;
        this.counts = { pass: 0, block: 0, nat: 0, match: 0 };
        this.ifMap = {};
        this.colors = null;
        this._onVisibility = this._onVisibility.bind(this);
        // 27.1 edit mode (feature-detected): animation and clicks paused
        this.editing = false;
        // fullscreen (Fullscreen API or fixed overlay); the module views read fullscreen/fsDark
        this.fullscreen = false;
        this.fsDark = false;
        this.overlay = false;
        this._fsTimer = null;
        this._onFsChange = this._onFsChange.bind(this);
        this._onFsKey = this._onFsKey.bind(this);
        this._onFsMove = this._onFsMove.bind(this);
        // host telemetry (CPU, memory, WAN traffic) for the module views, streamed only while someone uses it
        this.telemetry = new SonarTelemetry(this);
        // Policy Analyzer exposure report (optional plugin), loaded together with the telemetry
        this.exposure = this.telemetry.exposure;
        // map mode
        try { this.mode = localStorage.getItem('nexo.sonar.mode') || 'sonar'; } catch (e) { this.mode = 'sonar'; }
        this.geo = null;                 // { starts: Uint32Array, idx: Uint8Array, countries: [] }
        this.worldMap = null;            // { CC: {n, c:[lon,lat], p:[[[lon,lat]...]]} }
        this.routes = new Map();         // key: action|CC|direction
        this.pending = [];               // events that arrived before the GeoIP database
        this.noGeo = 0;                  // IPv6 / private / no country
        this.home = null;                // [lon, lat] of the firewall
        this.homeCC = null;
        // map: blocked inbound connections are drawn as missiles that blow up on the firewall's shield
        // side panel (wide widget only): rolling summary of the stream
        this.stats = { times: [], blocks: [], attackers: new Map(), ports: new Map(), rules: new Map(), recent: [], inN: 0, outN: 0 };
        this.sideAt = 0;
        this.blasts = [];                // active explosions { x, y, t0, sparks: [[angle, speed]] }
        this.maxStrikes = 12;            // missiles in flight at the same time
        // flow mode: 4 columns of nodes, 3 sets of links between them, particles and bursts
        this.flow = { cols: [new Map(), new Map(), new Map(), new Map()], links: [new Map(), new Map(), new Map()],
            other: [0, 1, 2, 3].map((i) => ({ key: '__o', col: i, label: '', n: 0, w: 0, y: 0, h: 0, init: false })),
            parts: [], pops: [], last: performance.now(), maxParts: 220 };
        // other views (modules) and sound: created on first use; the last events are replayed into a new view
        this.views = {};
        this.history = [];               // last 400 events, for replay
        this.soundOn = false;
        try { this.soundOn = localStorage.getItem('nexo.sonar.sound') === '1'; } catch (e) { /* no storage */ }
        this.sound = null;
        this.reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    getGridOptions() {
        // initial size when added (the grid has 12 columns and height in px); the user can resize it afterwards
        return { w: 6, h: 440, minW: 3, minH: 280, sizeToContent: false };
    }

    getMarkup() {
        const t = this.translations;
        return $(`
            <div class="sonar-widget" style="position:relative;width:100%;height:100%;min-height:340px;display:flex;flex-direction:column;padding:0 10px 8px;box-sizing:border-box;">
                <div class="sonar-legend" style="display:flex;align-items:center;gap:4px 12px;font-size:12px;padding:2px 0 4px;white-space:nowrap;">
                    <span><i class="fa fa-circle text-success"></i> ${t.pass} <b class="sonar-n-pass">0</b></span>
                    <span><i class="fa fa-circle text-danger"></i> ${t.block} <b class="sonar-n-block">0</b></span>
                    <span><i class="fa fa-circle text-info"></i> ${t.nat} <b class="sonar-n-nat">0</b></span>
                    <span><i class="fa fa-circle text-warning"></i> ${t.match ?? 'Match'} <b class="sonar-n-match">0</b></span>
                    <span class="sonar-controls">
                    <span class="sonar-mode-name" aria-hidden="true"></span>
                    <span class="sonar-modes" role="radiogroup" aria-label="${t.view ?? 'View'}">
                        <span class="sonar-knob" aria-hidden="true"></span>
                        ${Sonar.MODES.map((m) => {
                            const name = t[m] ?? Sonar.NAMES[m];
                            return `<button type="button" role="radio" class="sonar-sw-label" data-mode="${m}" title="${name}" aria-label="${name}">` +
                                `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${Sonar.ICONS[m]}</svg></button>`;
                        }).join('')}
                    </span>
                    <button type="button" class="sonar-sound" role="switch" aria-checked="false" title="${t.sound ?? 'Sound'}" aria-label="${t.sound ?? 'Sound'}">
                        <span class="sonar-sound-knob"><svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
                            <path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="currentColor" stroke="none"/>
                            <path class="sonar-waves" d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.6 3.6a6.2 6.2 0 0 1 0 8.8"/>
                            <path class="sonar-mute" d="M10.6 5.6l4 4.8M14.6 5.6l-4 4.8"/></svg></span>
                    </button>
                    <button type="button" class="sonar-fs" title="${t.fullscreen ?? 'Fullscreen'}" aria-label="${t.fullscreen ?? 'Fullscreen'}" aria-pressed="false">
                        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path class="sonar-fs-open" d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/>
                            <path class="sonar-fs-close" d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4"/></svg>
                    </button>
                    </span>
                </div>
                <div class="sonar-body" style="display:flex;flex:1 1 auto;gap:10px;min-height:300px;">
                <div class="sonar-area" style="position:relative;flex:1 1 auto;min-height:300px;min-width:0;">
                    <canvas class="sonar-canvas" style="position:absolute;inset:0;width:100%;height:100%;cursor:crosshair;"></canvas>
                    <div class="sonar-tooltip" style="position:absolute;display:none;pointer-events:none;z-index:5;padding:6px 8px;border-radius:6px;font-size:12px;line-height:1.4;white-space:nowrap;"></div>
                    <div class="sonar-empty" style="position:absolute;left:0;right:0;bottom:6px;text-align:center;font-size:12px;opacity:.7;">${t.waiting}</div>
                </div>
                <aside class="sonar-side" style="display:none;flex:0 0 230px;overflow:hidden;font-size:11.5px;line-height:1.35;text-align:left;padding-left:10px;"></aside>
                </div>
            </div>
        `);
    }

    async onMarkupRendered() {
        // own root only: 27.1 marks the panel with data-widget-instance-id (unique per instance, duplicates
        // included); 26.7 has the grid item's gs-id and the panel's .widget-<id>. No page-wide fallback.
        const id = Sonar._cssEscape(this.id);
        const el = document.querySelector(`[data-widget-instance-id="${id}"] .sonar-widget`) ||
            document.querySelector(`[gs-id="${id}"] .sonar-widget`) ||
            document.querySelector(`.widget-${id} .sonar-widget`);
        if (!el) { throw new Error(`Sonar: widget root not found for "${this.id}"`); }
        this.el = el;
        this.canvas = el.querySelector('.sonar-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.tooltip = el.querySelector('.sonar-tooltip');
        this.emptyMsg = el.querySelector('.sonar-empty');
        this.side = el.querySelector('.sonar-side');
        this._readColors();
        this._resize();

        if (typeof ResizeObserver === 'function') {
            this._ro = new ResizeObserver(() => {
                const r = this.canvas.getBoundingClientRect();
                if (Math.abs(r.width - this.w) > 1 || Math.abs(r.height - this.h) > 1) { this._resize(); }
            });
            this._ro.observe(this.canvas);
        }
        this.canvas.addEventListener('mousemove', (e) => this._onMouse(e));
        this.canvas.addEventListener('mouseleave', () => { this.hover = null; this.tooltip.style.display = 'none'; });
        this.canvas.addEventListener('click', () => this._onClick());
        document.addEventListener('visibilitychange', this._onVisibility);
        Sonar._switchCss();
        el.querySelectorAll('.sonar-modes [data-mode]').forEach((b) => {
            b.addEventListener('click', () => this._setMode(b.dataset.mode));
        });
        // the sound module is small: fetch it now so a click can start audio synchronously (gesture rules)
        Sonar.MODULE_LOADER('./Sonar-sound.js').then((m) => { this._SoundClass = m.default; }).catch(() => { /* no sound */ });
        const snd = el.querySelector('.sonar-sound');
        snd.setAttribute('aria-checked', 'false');
        snd.addEventListener('click', () => this._setSound(!this.soundOn, true));
        const fs = el.querySelector('.sonar-fs');
        if (fs) { fs.addEventListener('click', () => this._toggleFullscreen()); }
        document.addEventListener('fullscreenchange', this._onFsChange);
        // a stored "on" cannot start audio without a gesture: arm it on the first click anywhere in the widget
        if (this.soundOn) {
            this.soundOn = false;
            el.addEventListener('pointerdown', () => { if (!this.soundOn) { this._setSound(true, false); } }, { once: true });
        }
        this._setMode(this.mode);

        try {
            this.ifMap = await this.ajaxCall('/api/diagnostics/interface/get_interface_names');
        } catch (e) { this.ifMap = {}; }

        // one log stream per page, shared by every Sonar instance (each stream is a read_log.py + tail on the firewall)
        this._logSub = Sonar._logHub.subscribe(this._onMessage.bind(this));
        this._loop();
    }

    onWidgetResize(elem, width, height) {
        this._resize();
        return true;
    }

    onWidgetClose() {
        super.onWidgetClose();
        if (this._logSub) { Sonar._logHub.unsubscribe(this._logSub); this._logSub = null; }
        if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
        document.removeEventListener('visibilitychange', this._onVisibility);
        document.removeEventListener('fullscreenchange', this._onFsChange);
        if (this.fullscreen) { this._exitFullscreen(); this._applyFullscreen(false); }
        this.telemetry.reset();
        if (this.sound) { try { this.sound.close(); } catch (e) { /* ignore */ } }
    }

    async onWidgetTick() {
        // the theme may have changed (auto light/dark): read the colors again
        this._readColors();
    }

    // 27.1: called by the widget manager when the dashboard enters/leaves edit mode (also once on mount,
    // before onMarkupRendered). Dragging and resizing must not open the Live View or draw for nothing.
    onEditModeChanged(enabled) {
        this.editing = !!enabled;
        if (this.editing) {
            if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
            this.hover = null;
            if (this.tooltip) { this.tooltip.style.display = 'none'; }
            if (this.canvas) { this.canvas.style.pointerEvents = 'none'; }
        } else {
            if (this.canvas) { this.canvas.style.pointerEvents = ''; }
            if (!this.raf && this.ctx && !document.hidden) { this._loop(); }
        }
    }

    /* ------------------------------------------------------------------ fullscreen */

    _toggleFullscreen() {
        if (this.fullscreen) { this._exitFullscreen(); return; }
        // the container keeps the widget's height while the root is out of flow: gridstack sees no change
        this._holdContainer(true);
        const can = typeof this.el.requestFullscreen === 'function' && document.fullscreenEnabled !== false;
        if (can) {
            try {
                const p = this.el.requestFullscreen();
                if (p && p.catch) { p.catch(() => this._setOverlay(true)); }
                return;
            } catch (e) { /* fall through to the overlay */ }
        }
        this._setOverlay(true);
    }

    _exitFullscreen() {
        if (document.fullscreenElement === this.el && document.exitFullscreen) {
            const p = document.exitFullscreen();
            if (p && p.catch) { p.catch(() => { /* ignore */ }); }
        } else if (this.overlay) {
            this._setOverlay(false);
        }
    }

    // fixed overlay: used when the Fullscreen API is unavailable or refused (and by the preview, ?fs=1)
    _setOverlay(on) {
        on = !!on;
        // a position:fixed element stays inside the stacking context of the dashboard grid item (under the header,
        // the menu and the next widgets): move the widget to <body> while overlaid and put it back afterwards
        if (on && !this._overlayMark && this.el.parentNode && this.el.parentNode !== document.body) {
            this._overlayMark = document.createComment('sonar-overlay');
            this.el.parentNode.insertBefore(this._overlayMark, this.el);
            document.body.appendChild(this.el);
        } else if (!on && this._overlayMark) {
            if (this._overlayMark.parentNode) { this._overlayMark.parentNode.replaceChild(this.el, this._overlayMark); }
            this._overlayMark = null;
        }
        this.overlay = on;
        this.el.classList.toggle('sonar-overlay', this.overlay);
        this._applyFullscreen(this.overlay);
    }

    _onFsChange() {
        const on = document.fullscreenElement === this.el;
        if (on !== this.fullscreen && !this.overlay) { this._applyFullscreen(on); }
    }

    _onFsKey(e) {
        if (e.key === 'Escape' && this.overlay) { this._setOverlay(false); }
    }

    _holdContainer(on) {
        const p = this.el && this.el.parentElement;
        if (!p) { return; }
        p.style.minHeight = on ? this.el.offsetHeight + 'px' : '';
    }

    _applyFullscreen(on) {
        this.fullscreen = !!on;
        this.fsDark = this.fullscreen;      // fullscreen is always dark, whatever the theme
        this.el.classList.toggle('sonar-fullscreen', this.fullscreen);
        const b = this.el.querySelector('.sonar-fs');
        if (b) {
            const t = this.translations;
            const label = this.fullscreen ? (t.exitfullscreen ?? 'Exit fullscreen') : (t.fullscreen ?? 'Fullscreen');
            b.setAttribute('aria-pressed', this.fullscreen ? 'true' : 'false');
            b.title = label; b.setAttribute('aria-label', label);
        }
        if (this.fullscreen) {
            document.addEventListener('keydown', this._onFsKey);
            this.el.addEventListener('pointermove', this._onFsMove);
            this._onFsMove();
        } else {
            document.removeEventListener('keydown', this._onFsKey);
            this.el.removeEventListener('pointermove', this._onFsMove);
            clearTimeout(this._fsTimer); this._fsTimer = null;
            this.el.classList.remove('sonar-controls-hidden');
            this._holdContainer(false);
        }
        this.hover = null;
        if (this.tooltip) { this.tooltip.style.display = 'none'; }
        this._readColors();
        this._resize();      // also calls resize() on every module view
        this.mapBase = null;
        // the final size (fullscreen/overlay, side panel, legend) settles after this frame: measure again
        clearTimeout(this._fsResizeT);
        this._fsResizeT = setTimeout(() => { if (this.canvas && Math.abs(this.canvas.clientWidth - this.w) > 1) { this._resize(); } }, 350);
    }

    // control bar: visible on pointer movement, hidden 3 s later
    _onFsMove() {
        this.el.classList.remove('sonar-controls-hidden');
        clearTimeout(this._fsTimer);
        this._fsTimer = setTimeout(() => { if (this.fullscreen) { this.el.classList.add('sonar-controls-hidden'); } }, 3000);
    }

    /* ------------------------------------------------------------------ side panel */

    _collect(action, inbound, remote, port, proto, label) {
        const st = this.stats, now = Date.now();
        st.times.push(now);
        if (action === 'block') { st.blocks.push(now); }
        if (inbound) { st.inN++; } else { st.outN++; }
        if (action === 'block') {
            const bump = (m, k) => { if (k !== '' && k != null) { m.set(k, (m.get(k) || 0) + 1); } };
            if (label) { bump(st.rules, label); }
            if (inbound) {
                bump(st.attackers, (this.geo && this._country(remote)) || '??');
                if (port) { bump(st.ports, String(port)); }
                st.recent.unshift({ t: new Date(), ip: remote, port, proto });
                if (st.recent.length > 5) { st.recent.length = 5; }
            }
        }
        // bounded memory
        for (const m of [st.attackers, st.ports, st.rules]) {
            if (m.size > 300) { m.delete(m.keys().next().value); }
        }
    }

    _renderSide(force = false) {
        if (!this.side || this.side.style.display === 'none') { return; }
        const now = Date.now();
        if (!force && now - this.sideAt < 1000) { return; }
        this.sideAt = now;
        const st = this.stats, t = this.translations, k = this.colors || {};
        const cut = now - 60000;
        while (st.times.length && st.times[0] < cut) { st.times.shift(); }
        while (st.blocks.length && st.blocks[0] < cut) { st.blocks.shift(); }
        const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
        const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
        const svc = Sonar.SVC;
        const muted = 'opacity:.65;';
        const head = (txt) => `<div style="${muted}text-transform:uppercase;letter-spacing:.08em;font-size:10px;font-weight:700;margin:8px 0 3px;">${esc(txt)}</div>`;
        const bar = (n, max, color) => `<span style="display:block;height:3px;border-radius:2px;margin-top:1px;background:${color};opacity:.75;width:${Math.max(4, Math.round(100 * n / max))}%"></span>`;
        if (!this.monoFont) {
            // monospace font of the active theme (same as <code>)
            const cd = document.createElement('code'); cd.style.display = 'none'; this.el.appendChild(cd);
            this.monoFont = getComputedStyle(cd).fontFamily.replace(/"/g, "'"); cd.remove();
        }
        const mono = `font-family:${this.monoFont};font-variant-numeric:tabular-nums;`;
        const blockC = k.block || 'currentColor';

        let html = '';
        html += head(t.summary ?? 'Last 60 s');
        html += `<div style="display:flex;gap:12px;flex-wrap:wrap;">
            <span><b style="${mono}font-size:15px;">${st.times.length}</b> <span style="${muted}">${esc(t.events ?? 'events')}</span></span>
            <span><b style="${mono}font-size:15px;color:${blockC}">${st.blocks.length}</b> <span style="${muted}">${esc(t.blocked ?? 'blocked')}</span></span>
        </div>
        <div style="${muted}">${esc(t.inbound ?? 'Inbound')} ${st.inN} · ${esc(t.outbound ?? 'Outbound')} ${st.outN}</div>`;

        const att = top(st.attackers, 5);
        if (att.length) {
            html += head(t.attackers ?? 'Top attackers');
            const max = att[0][1];
            for (const [cc, n] of att) {
                html += `<div style="display:flex;justify-content:space-between;gap:6px;"><span>${cc === '??' ? '🌐' : this._flag(cc)} ${esc(cc)}</span><b style="${mono}color:${blockC}">${n}</b></div>${bar(n, max, blockC)}`;
            }
        }
        const ports = top(st.ports, 5);
        if (ports.length) {
            html += head(t.ports ?? 'Targeted ports');
            for (const [p, n] of ports) {
                html += `<div style="display:flex;justify-content:space-between;gap:6px;"><span style="${mono}">${esc(p)} <span style="${muted}">${esc(svc[p] ?? '')}</span></span><b style="${mono}">${n}</b></div>`;
            }
        }
        const rules = top(st.rules, 3);
        if (rules.length) {
            html += head(t.rules ?? 'Blocking rules');
            for (const [lbl, n] of rules) {
                html += `<div style="display:flex;justify-content:space-between;gap:6px;"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(lbl)}">${esc(lbl)}</span><b style="${mono}">${n}</b></div>`;
            }
        }
        if (st.recent.length) {
            html += head(t.recent ?? 'Last attacks');
            for (const r of st.recent) {
                const cc = this.geo ? this._country(r.ip) : null;
                const hh = r.t.toTimeString().slice(0, 8);
                html += `<div style="${mono}font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"><span style="${muted}">${hh}</span> ${cc ? this._flag(cc) : '🌐'} ${esc(r.ip)}${r.port ? `<span style="${muted}">:${esc(r.port)}</span>` : ''}</div>`;
            }
        }
        if (!st.times.length && !st.recent.length) {
            html += `<div style="${muted}margin-top:6px;">${esc(t.waiting ?? '')}</div>`;
        }
        this.side.innerHTML = html;
    }

    /* ------------------------------------------------------------------ data */

    _onMessage(event) {
        if (!event || !event.data) { return; }
        let d;
        try { d = JSON.parse(event.data); } catch (e) { return; }
        // pass | block | match (27.1 normalization rules) | everything else is NAT (nat/rdr/binat)
        const action = d.action === 'pass' ? 'pass' : (d.action === 'block' ? 'block' : (d.action === 'match' ? 'match' : 'nat'));
        const inbound = (d.dir || '').toLowerCase() === 'in';
        const remote = inbound ? d.src : d.dst;
        if (!remote) { return; }
        const key = action + '|' + remote;
        const now = performance.now();
        let b = this.blips.get(key);
        if (!b) {
            const h = this._hash(remote);
            const p = this._hash(String(d.dstport ?? d.srcport ?? '')) / 4294967296;
            b = {
                action, remote, inbound,
                ang: (h / 4294967296) * Math.PI * 2,
                r: inbound ? 0.62 + p * 0.33 : 0.18 + p * 0.38,
                n: 0
            };
            this.blips.set(key, b);
            if (this.blips.size > this.maxBlips) {
                // drop the oldest one
                let oldest = null;
                for (const [k, v] of this.blips) { if (!oldest || v.t < oldest[1].t) { oldest = [k, v]; } }
                if (oldest) { this.blips.delete(oldest[0]); }
            }
        }
        b.n++;
        b.t = now;
        b.port = d.dstport ?? '';
        b.proto = d.protoname ?? '';
        b.iface = this.ifMap[d.interface] ?? d.interface ?? '';
        b.label = d.label ?? '';
        b.rid = d.rid;
        b.local = inbound ? d.dst : d.src;
        this.counts[action]++;
        this._collect(action, inbound, remote, b.port, b.proto, b.label);
        this._addRoute({ action, inbound, remote, local: b.local, port: b.port, label: b.label });
        this._flowAdd(action, inbound, remote, b);
        const ev = { action, inbound, remote, local: b.local, iface: b.iface, port: b.port === '' || b.port == null ? '' : String(b.port),
            proto: b.proto, label: b.label, now: performance.now() };
        this.history.push(ev);
        if (this.history.length > 400) { this.history.shift(); }
        for (const v of Object.values(this.views)) { try { v.add(ev); } catch (e) { console.error('Sonar view', e); } }
        if (this.soundOn && this.sound) { try { this.sound.play(ev); } catch (e) { /* audio is best effort */ } }
        if (this.emptyMsg) { this.emptyMsg.style.display = 'none'; }
        const n = this.el && this.el.querySelector('.sonar-n-' + action);
        if (n) { n.textContent = this.counts[action]; }
    }

    _hash(s) {
        // 32-bit FNV-1a
        let h = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
        return h >>> 0;
    }

    /* ------------------------------------------------------------------ drawing */

    _readColors() {
        if (!this.el) { return; }
        const sample = (cls) => {
            const i = document.createElement('i');
            i.className = cls; i.style.display = 'none';
            this.el.appendChild(i);
            const c = getComputedStyle(i).color;
            i.remove();
            return c;
        };
        const cs = getComputedStyle(this.el);
        // fullscreen: the root's own (dark) background and light text, from the injected CSS
        const bg = this.fullscreen ? cs.backgroundColor
            : getComputedStyle(document.querySelector('.grid-stack-item-content') || document.body).backgroundColor;
        this.colors = {
            pass: sample('text-success'),
            block: sample('text-danger'),
            nat: sample('text-info'),
            match: sample('text-warning'),
            beam: sample('text-primary'),
            text: cs.color,
            grid: this._withAlpha(cs.color, 0.18),
            gridStrong: this._withAlpha(cs.color, 0.32),
            bg
        };
        // dark theme = light text
        const rgb = (cs.color.match(/\d+(\.\d+)?/g) || [0, 0, 0]).map(Number);
        this.dark = this.fullscreen || (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) > 128;
        if (this.tooltip) {
            this.tooltip.style.background = bg;
            this.tooltip.style.color = cs.color;
            this.tooltip.style.border = '1px solid ' + this.colors.gridStrong;
            this.tooltip.style.boxShadow = '0 6px 18px rgba(0,0,0,.35)';
        }
    }

    _withAlpha(color, a) {
        const m = color.match(/\d+(\.\d+)?/g);
        if (!m) { return color; }
        return `rgba(${m[0]},${m[1]},${m[2]},${a})`;
    }

    _resize() {
        if (!this.canvas) { return; }
        if (this.side) {
            // Max Cyber draws its own HUD panels over the whole canvas: no side list (it only took 300 px of layout)
            const wide = this.el.clientWidth >= 700 && this.mode !== 'cyber';
            this.side.style.display = wide ? 'block' : 'none';
            if (wide) { this._renderSide(true); }
        }
        // narrow widget (phones, small columns): legend and controls on two lines
        this.el.classList.toggle('sonar-narrow', this.el.clientWidth < 540);
        const r = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.w = Math.max(10, r.width);
        this.h = Math.max(10, r.height);
        this.canvas.width = Math.round(this.w * dpr);
        this.canvas.height = Math.round(this.h * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        // geometry of the disc in perspective
        this.tilt = 0.42;                                     // vertical flattening (3D)
        this.R = Math.min(this.w * 0.46, (this.h * 0.80) / (2 * this.tilt));
        this.cx = this.w / 2;
        this.cy = this.h * 0.56;
        this.maxHeight = Math.min(60, this.h * 0.32);
        this.mapBase = null;             // redraw the countries on the next frame
        for (const v of Object.values(this.views)) { if (v.resize) { try { v.resize(); } catch (e) { /* ignore */ } } }
        // edit mode (27.1): the loop is paused and the resize cleared the canvas: draw one still frame
        if (this.editing && this.colors) { this._draw(); }
    }

    _project(r, ang, z = 0) {
        return [this.cx + Math.cos(ang) * r * this.R, this.cy + Math.sin(ang) * r * this.R * this.tilt - z];
    }

    _onVisibility() {
        const tel = this.telemetry;
        if (document.hidden) {
            if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
            // background tab: close the telemetry streams too (no work on the firewall for a page nobody sees)
            if (tel && tel.active) { tel._close(); tel._paused = true; }
        } else {
            if (tel && tel._paused) { tel._paused = false; if (tel.users > 0) { tel._open(); } }
            if (!this.raf) { this._loop(); }
        }
    }

    _loop() {
        if (this.editing) { this.raf = null; return; }     // 27.1 edit mode: nothing moves
        this.raf = requestAnimationFrame(() => { this._draw(); this._renderSide(); this._loop(); });
    }

    _draw() {
        const c = this.ctx, k = this.colors;
        if (!c || !k) { return; }
        if (this.mode === 'map') { this._drawMap(); return; }
        if (this.mode === 'flow') { this._drawFlow(); return; }
        if (Sonar.MODULES[this.mode]) {
            const v = this.views[this.mode];
            if (v) { try { v.draw(performance.now()); } catch (e) { console.error('Sonar view', e); } } else { c.clearRect(0, 0, this.w, this.h); }
            return;
        }
        const now = performance.now();
        const sweep = (((now - this.startTime) % this.periodMs) / this.periodMs) * Math.PI * 2;
        c.clearRect(0, 0, this.w, this.h);

        // rings and spokes
        c.lineWidth = 1;
        for (let i = 1; i <= 4; i++) {
            c.beginPath();
            c.ellipse(this.cx, this.cy, this.R * i / 4, this.R * this.tilt * i / 4, 0, 0, Math.PI * 2);
            c.strokeStyle = i === 4 ? k.gridStrong : k.grid;
            c.stroke();
        }
        for (let i = 0; i < 12; i++) {
            const a = i * Math.PI / 6;
            const [x, y] = this._project(1, a);
            c.beginPath(); c.moveTo(this.cx, this.cy); c.lineTo(x, y);
            c.strokeStyle = k.grid; c.stroke();
        }
        // inbound/outbound divider
        c.setLineDash([3, 4]);
        c.beginPath();
        c.ellipse(this.cx, this.cy, this.R * 0.6, this.R * this.tilt * 0.6, 0, 0, Math.PI * 2);
        c.strokeStyle = k.gridStrong; c.stroke();
        c.setLineDash([]);

        // beam: sector with a trail
        const trail = Math.PI / 2.2;
        for (let i = 0; i < 24; i++) {
            const a0 = sweep - trail * (i + 1) / 24, a1 = sweep - trail * i / 24;
            c.beginPath(); c.moveTo(this.cx, this.cy);
            for (let a = a0; a <= a1 + 1e-6; a += (a1 - a0) / 4) { const [x, y] = this._project(1, a); c.lineTo(x, y); }
            c.closePath();
            c.fillStyle = this._withAlpha(k.beam, 0.20 * (1 - i / 24));
            c.fill();
        }
        const [fx, fy] = this._project(1, sweep);
        c.beginPath(); c.moveTo(this.cx, this.cy); c.lineTo(fx, fy);
        c.strokeStyle = this._withAlpha(k.beam, 0.9); c.lineWidth = 1.5; c.stroke(); c.lineWidth = 1;

        // points: back to front (smaller y first) so the perspective is right
        const list = [];
        for (const [key, b] of this.blips) {
            const age = now - b.t;
            if (age > this.lifeMs) { this.blips.delete(key); continue; }
            list.push(b);
        }
        list.sort((a, b) => Math.sin(a.ang) * a.r - Math.sin(b.ang) * b.r);
        this.visible = [];
        for (const b of list) {
            const age = now - b.t;
            // how long since the beam passed this angle
            let delta = sweep - b.ang; delta = ((delta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
            const highlight = Math.max(0, 1 - delta / (Math.PI * 1.2));
            const life = 1 - age / this.lifeMs;
            const alpha = Math.max(0.12, Math.min(1, (0.35 + 0.65 * highlight) * life + (age < 1500 ? 0.4 : 0)));
            const color = k[b.action];
            const z = Math.min(this.maxHeight, 4 + Math.log2(1 + b.n) * 9);
            const [x0, y0] = this._project(b.r, b.ang, 0);
            const [x1, y1] = this._project(b.r, b.ang, z);
            // shadow at the base + column (height = persistence)
            c.beginPath(); c.ellipse(x0, y0, 3.5, 1.6, 0, 0, Math.PI * 2);
            c.fillStyle = this._withAlpha(color, alpha * 0.35); c.fill();
            c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1);
            c.strokeStyle = this._withAlpha(color, alpha * 0.7); c.lineWidth = 1.5; c.stroke(); c.lineWidth = 1;
            // glowing head
            const radius = b.action === 'block' ? 3.6 : 3;
            c.save();
            c.shadowColor = this._withAlpha(color, alpha);
            c.shadowBlur = 10 * highlight + (age < 1500 ? 8 : 0);
            c.beginPath(); c.arc(x1, y1, radius + (age < 600 ? 2 : 0), 0, Math.PI * 2);
            c.fillStyle = this._withAlpha(color, alpha); c.fill();
            c.restore();
            if (this.hover === b) {
                c.beginPath(); c.arc(x1, y1, radius + 5, 0, Math.PI * 2);
                c.strokeStyle = this._withAlpha(k.text, 0.8); c.stroke();
            }
            this.visible.push([b, x1, y1]);
        }

        // subtle band labels
        c.fillStyle = this._withAlpha(k.text, 0.55);
        c.font = '10px ' + getComputedStyle(this.el).fontFamily;
        c.textAlign = 'center';
        c.fillText(this.translations.inbound, this.cx, this.cy + this.R * this.tilt + 12);
        c.fillText(this.translations.outbound, this.cx, this.cy + this.R * this.tilt * 0.6 - 4);
    }

    /* ------------------------------------------------------------------ interaction */

    _onMouse(e) {
        if (this.mode === 'map') { this._onMouseMap(e); return; }
        if (this.mode === 'flow') { this._onMouseFlow(e); return; }
        if (Sonar.MODULES[this.mode]) { this._onMouseView(e); return; }
        if (!this.visible) { return; }
        const r = this.canvas.getBoundingClientRect();
        const sx = r.width ? this.w / r.width : 1, sy = r.height ? this.h / r.height : 1;   // canvas drawn stretched until the next resize
        const mx = (e.clientX - r.left) * sx, my = (e.clientY - r.top) * sy;
        let best = null, dist = 12 * 12;
        for (const [b, x, y] of this.visible) {
            const d = (x - mx) ** 2 + (y - my) ** 2;
            if (d < dist) { dist = d; best = b; }
        }
        this.hover = best;
        if (!best) { this.tooltip.style.display = 'none'; return; }
        const t = this.translations, esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[ch]));
        this.tooltip.innerHTML =
            `<b style="color:${this.colors[best.action]}">${esc(t[best.action])}</b> · ${esc(best.iface)} · ${esc(best.inbound ? t.inbound : t.outbound)}<br>` +
            `<span style="font-family:var(--bs-font-monospace,monospace)">${esc(best.remote)}${best.port !== '' ? ' → :' + esc(best.port) : ''} ${esc(best.proto)}</span><br>` +
            `${esc(best.label)}<br><span style="opacity:.7">${esc(t.hits)}: ${best.n} · ${esc(t.click)}</span>`;
        this.tooltip.style.display = 'block';
        const dw = this.tooltip.offsetWidth, dh = this.tooltip.offsetHeight;
        this.tooltip.style.left = Math.min(Math.max(4, mx + 12), r.width - dw - 4) + 'px';
        this.tooltip.style.top = Math.min(Math.max(4, my - dh - 10), r.height - dh - 4) + 'px';
    }

    _onClick() {
        if (!this.hover) { return; }
        if (Sonar.MODULES[this.mode]) {
            // a module view may handle the click itself (Max Cyber: AI analyst buttons, picking an address)
            const v = this.views[this.mode];
            try { if (v && v.click && v.click(this.hover)) { return; } } catch (e) { /* fall back to the Live View */ }
            const o = this.hover.open;
            if (o && o.field && o.value !== undefined && o.value !== '') {
                const hash = new URLSearchParams({field: o.field, operator: '=', value: o.value});
                window.open('/ui/diagnostics/firewall/log#' + hash, '_blank', 'noopener');
            }
            return;
        }
        if (this.mode === 'flow') {
            // only service nodes map to a Live View filter (destination port)
            if (this.hover.col === 2 && this.hover.port) {
                const hash = new URLSearchParams({field: 'dstport', operator: '=', value: this.hover.port});
                window.open('/ui/diagnostics/firewall/log#' + hash, '_blank', 'noopener');
            }
            return;
        }
        const field = this.hover.inbound ? 'src' : 'dst';
        const value = this.hover.lastIp ?? this.hover.remote;
        const hash = new URLSearchParams({field: field, operator: '=', value: value});
        window.open('/ui/diagnostics/firewall/log#' + hash, '_blank', 'noopener');
    }

    /* ------------------------------------------------------------------ map mode */

    // Sonar | Map | Flow selector: a sliding switch. Styled once per page with theme-neutral rules: the
    // accent comes from the theme's .text-primary and the track from the current text color, so any theme
    // works; a theme can still restyle .sonar-modes / .sonar-knob / .sonar-sw-label.
    static _switchCss() {
        if (document.getElementById('sonar-switch-css')) { return; }
        const probe = document.createElement('span');
        probe.className = 'text-primary';
        probe.style.display = 'none';
        document.body.appendChild(probe);
        const accent = getComputedStyle(probe).color || '#d94f00';
        probe.remove();
        const css = document.createElement('style');
        css.id = 'sonar-switch-css';
        css.textContent = `
.sonar-widget{--sonar-accent:${accent};}
.sonar-legend{flex-wrap:nowrap;}
.sonar-narrow .sonar-legend{flex-wrap:wrap;row-gap:6px;}
.sonar-narrow .sonar-controls{margin-left:0;flex:1 1 100%;justify-content:space-between;}
.sonar-legend>span:not(.sonar-controls){flex:0 0 auto;}
.sonar-controls{margin-left:auto;display:flex;align-items:center;gap:8px;min-width:0;flex:0 1 auto;}
.sonar-controls>.sonar-modes{flex:0 0 auto;}
.sonar-mode-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--sonar-accent);}
.sonar-mode-name.swap{animation:sonar-name .35s ease-out;}
@keyframes sonar-name{from{opacity:0;transform:translateY(-5px);filter:blur(2px);}to{opacity:1;transform:none;filter:none;}}
.sonar-modes{position:relative;display:inline-grid;grid-template-columns:repeat(7,26px);align-items:stretch;padding:2px;border-radius:11px;
  border:1px solid rgba(127,127,127,.4);background-color:rgba(127,127,127,.12);box-shadow:inset 0 1px 2px rgba(0,0,0,.25);flex:0 0 auto;}
.sonar-sw-label{position:relative;z-index:1;display:flex;align-items:center;justify-content:center;height:20px;margin:0;padding:0;border:0;
  border-radius:9px;background:none;color:inherit;opacity:.55;cursor:pointer;transition:opacity .2s,color .2s,transform .2s;}
.sonar-sw-label:hover{opacity:.95;transform:scale(1.12);}
.sonar-sw-label.active{opacity:1;color:#fff;}
.sonar-sw-label:focus-visible{outline:2px solid var(--sonar-accent);outline-offset:-2px;}
.sonar-knob{position:absolute;top:2px;bottom:2px;left:2px;width:26px;border-radius:9px;background-color:var(--sonar-accent);
  box-shadow:0 1px 3px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.25),0 0 10px -2px var(--sonar-accent);
  transition:transform .32s cubic-bezier(.5,.1,.2,1.25);}
.sonar-modes[data-mode="map"] .sonar-knob{transform:translateX(100%);}
.sonar-modes[data-mode="flow"] .sonar-knob{transform:translateX(200%);}
.sonar-modes[data-mode="citadel"] .sonar-knob{transform:translateX(300%);}
.sonar-modes[data-mode="hole"] .sonar-knob{transform:translateX(400%);}
.sonar-modes[data-mode="rain"] .sonar-knob{transform:translateX(500%);}
.sonar-modes[data-mode="cyber"] .sonar-knob{transform:translateX(600%);}
.sonar-still .sonar-knob{transition:none;}
.sonar-sound{position:relative;flex:0 0 38px;width:38px;height:24px;margin:0;padding:0;border-radius:12px;border:1px solid rgba(127,127,127,.4);
  background-color:rgba(127,127,127,.12);box-shadow:inset 0 1px 2px rgba(0,0,0,.25);color:inherit;cursor:pointer;transition:background-color .25s;}
.sonar-sound-knob{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  background:#fff;color:#555;box-shadow:0 1px 2px rgba(0,0,0,.4);transition:transform .25s cubic-bezier(.5,.1,.2,1.25),color .25s;}
.sonar-sound[aria-checked="true"]{background-color:var(--sonar-accent);}
.sonar-sound[aria-checked="true"] .sonar-sound-knob{transform:translateX(14px);color:var(--sonar-accent);}
.sonar-sound .sonar-waves{display:none;}
.sonar-sound[aria-checked="true"] .sonar-waves{display:inline;}
.sonar-sound[aria-checked="true"] .sonar-mute{display:none;}
.sonar-sound:focus-visible{outline:2px solid var(--sonar-accent);outline-offset:2px;}
.sonar-fs{flex:0 0 24px;width:24px;height:24px;margin:0;padding:0;display:flex;align-items:center;justify-content:center;border-radius:7px;
  border:1px solid rgba(127,127,127,.4);background-color:rgba(127,127,127,.12);box-shadow:inset 0 1px 2px rgba(0,0,0,.25);color:inherit;opacity:.8;cursor:pointer;transition:opacity .2s,color .2s;}
.sonar-fs:hover{opacity:1;color:var(--sonar-accent);}
.sonar-fs:focus-visible{outline:2px solid var(--sonar-accent);outline-offset:2px;}
.sonar-fs .sonar-fs-close{display:none;}
.sonar-fs[aria-pressed="true"] .sonar-fs-open{display:none;}
.sonar-fs[aria-pressed="true"] .sonar-fs-close{display:inline;}
.sonar-widget:fullscreen,.sonar-widget.sonar-fullscreen{width:100vw!important;height:100vh!important;min-height:0!important;box-sizing:border-box;
  padding:1px!important;background:var(--sonar-fs-bg,#06080c)!important;color:#e5e7eb;}
.sonar-widget.sonar-overlay{position:fixed!important;inset:0!important;z-index:10000!important;}
.sonar-widget.sonar-fullscreen .sonar-legend{position:absolute;top:1px;left:1px;right:1px;z-index:6;padding:6px 12px!important;background:linear-gradient(180deg,rgba(6,8,12,.92),rgba(6,8,12,.55) 70%,rgba(6,8,12,0));transition:opacity .4s ease;}
.sonar-widget.sonar-fullscreen .sonar-body{height:100%;}
.sonar-widget.sonar-fullscreen.sonar-controls-hidden .sonar-legend{opacity:0;pointer-events:none;}
.sonar-widget.sonar-fullscreen .sonar-body,.sonar-widget.sonar-fullscreen .sonar-area{min-height:0!important;}
.sonar-widget.sonar-fullscreen .sonar-side{flex-basis:300px!important;font-size:13px!important;}
@media (prefers-reduced-motion:reduce){.sonar-knob,.sonar-sw-label,.sonar-sound-knob{transition:none;}.sonar-mode-name.swap{animation:none;}}
`;
        document.head.appendChild(css);
    }

    // CSS.escape where available (every browser the dashboard supports); a minimal escape otherwise
    static _cssEscape(s) {
        if (window.CSS && typeof CSS.escape === 'function') { return CSS.escape(String(s)); }
        return String(s).replace(/[^a-zA-Z0-9_-]/g, (ch) => '\\' + ch);
    }

    // 27.1: config.callbacks.updateTitle (feature-detected) shows the active view in the card title
    _updateTitle() {
        const cb = this.config && this.config.callbacks && this.config.callbacks.updateTitle;
        if (typeof cb !== 'function') { return; }
        const t = this.translations;
        try { cb(`${t.title ?? 'Sonar'} · ${t[this.mode] ?? Sonar.NAMES[this.mode]}`); } catch (e) { /* ignore */ }
    }

    _setMode(mode) {
        const prev = this.mode;
        this.mode = Sonar.MODES.includes(mode) ? mode : 'sonar';
        try { localStorage.setItem('nexo.sonar.mode', this.mode); } catch (e) { /* no storage */ }
        // telemetry belongs to the view that asked for it: a change of view closes it (the new view asks again)
        if (this._modeShown && prev !== this.mode) { this.telemetry.reset(); }
        this._updateTitle();
        this.el.querySelectorAll('.sonar-modes [data-mode]').forEach((b) => {
            const on = b.dataset.mode === this.mode;
            b.classList.toggle('active', on);
            b.setAttribute('aria-checked', on ? 'true' : 'false');
        });
        const sw = this.el.querySelector('.sonar-modes');
        if (sw) { sw.dataset.mode = this.mode; }   // the knob slides by CSS (equal slots)
        const name = this.el.querySelector('.sonar-mode-name');
        if (name) {
            name.textContent = this.translations[this.mode] ?? Sonar.NAMES[this.mode];
            name.classList.remove('swap');
            if (this._modeShown) { void name.offsetWidth; name.classList.add('swap'); }
        }
        // the first placement (page load) does not animate; later changes slide
        if (sw && !this._modeShown) {
            sw.classList.add('sonar-still');
            requestAnimationFrame(() => requestAnimationFrame(() => sw.classList.remove('sonar-still')));
        }
        this._modeShown = true;
        this.hover = null;
        if (this.tooltip) { this.tooltip.style.display = 'none'; }
        if (this.canvas) { this.canvas.style.cursor = 'crosshair'; }
        // the GeoIP database gives countries to map, flow and the module views
        if (this.mode !== 'sonar') { this._loadGeo(); }
        // the side list exists for every view but Max Cyber: entering or leaving it changes the canvas width
        if (prev !== this.mode && (prev === 'cyber' || this.mode === 'cyber') && this.canvas) { this._resize(); }
        if (Sonar.MODULES[this.mode]) { this._view(this.mode); }
    }

    // module path relative to this file, carrying the same cache-busting query the dashboard used for it
    static _moduleUrl(path) {
        const self = new URL(import.meta.url);
        return new URL(path, self).href + self.search;
    }

    async _view(mode) {
        if (this.views[mode] || this._viewLoading?.[mode]) { return this.views[mode]; }
        (this._viewLoading ??= {})[mode] = true;
        try {
            const mod = await Sonar.MODULE_LOADER(Sonar.MODULES[mode]);
            const v = new mod.default(this);
            for (const ev of this.history) { v.add(ev); }
            this.views[mode] = v;
        } catch (e) {
            console.error('Sonar: failed to load the ' + mode + ' view', e);
        }
        this._viewLoading[mode] = false;
        return this.views[mode];
    }

    async _setSound(on, fromSwitch) {
        this.soundOn = on;
        if (fromSwitch) { try { localStorage.setItem('nexo.sonar.sound', on ? '1' : '0'); } catch (e) { /* no storage */ } }
        const sw = this.el.querySelector('.sonar-sound');
        if (sw) { sw.setAttribute('aria-checked', on ? 'true' : 'false'); }
        try {
            if (on && !this.sound) {
                if (!this._SoundClass) { this._SoundClass = (await Sonar.MODULE_LOADER('./Sonar-sound.js')).default; }
                this.sound = new this._SoundClass(this);
            }
            if (this.sound) { this.sound.setEnabled(on); }
        } catch (e) {
            console.error('Sonar: sound unavailable', e);
        }
    }

    _onMouseView(e) {
        const v = this.views[this.mode];
        if (!v || !v.hit) { return; }
        const r = this.canvas.getBoundingClientRect();
        const sx = r.width ? this.w / r.width : 1, sy = r.height ? this.h / r.height : 1;   // canvas drawn stretched until the next resize
        const mx = (e.clientX - r.left) * sx, my = (e.clientY - r.top) * sy;
        const h = v.hit(mx, my);
        this.hover = h || null;
        this.canvas.style.cursor = h && (h.cursor || h.open) ? 'pointer' : 'crosshair';
        if (!h) { this.tooltip.style.display = 'none'; return; }
        this.tooltip.innerHTML = h.html + (h.open || h.hint ? `<br><span style="opacity:.7">${String(h.hint ?? this.translations.click ?? '').replace(/[&<>"]/g, (ch) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[ch]))}</span>` : '');
        this.tooltip.style.display = 'block';
        const dw = this.tooltip.offsetWidth, dh = this.tooltip.offsetHeight;
        this.tooltip.style.left = Math.min(Math.max(4, mx + 12), r.width - dw - 4) + 'px';
        this.tooltip.style.top = Math.min(Math.max(4, my - dh - 10), r.height - dh - 4) + 'px';
    }

    async _loadGeo() {
        if (this.geo || this._loading) { return; }
        this._loading = true;
        try {
            const [bin, mapData] = await Promise.all([
                // Sonar-geo.bin is built on the firewall from its own GeoIP lists (scripts/sonar/build-geo.py);
                // without it the map still draws, routes just have no country
                fetch('/ui/js/widgets/Sonar-geo.bin').then((r) => (r.ok ? r.arrayBuffer() : null)),
                fetch('/ui/js/widgets/Sonar-map.json').then((r) => r.json())
            ]);
            if (!bin || bin.byteLength < 10) {
                console.warn('Sonar: Sonar-geo.bin not found, countries are unknown until it is built');
                this.geo = { starts: new Uint32Array(0), idx: new Uint8Array(0), countries: ['--'] };
                this.worldMap = mapData;
                this._setHome();
                this.pending.splice(0).forEach((ev) => this._addRoute(ev));
                this.mapBase = null;
                this._loading = false;
                return;
            }
            const dv = new DataView(bin);
            const n = dv.getUint32(4, true), ncc = dv.getUint16(8, true);
            const countries = [];
            for (let i = 0; i < ncc; i++) {
                countries.push(String.fromCharCode(dv.getUint8(10 + i * 2), dv.getUint8(11 + i * 2)));
            }
            const off = 10 + ncc * 2;
            // Uint32Array requires 4-byte alignment: copy if needed
            const starts = (off % 4 === 0) ? new Uint32Array(bin, off, n) : new Uint32Array(bin.slice(off, off + n * 4));
            this.geo = { starts: starts, idx: new Uint8Array(bin, off + n * 4, n), countries };
            this.worldMap = mapData;
            this._setHome();
            this.pending.splice(0).forEach((ev) => this._addRoute(ev));
            this.mapBase = null;
        } catch (e) {
            console.error('Sonar: failed to load the GeoIP database/map', e);
        }
        this._loading = false;
    }

    _ip4(ip) {
        const p = String(ip).split('.');
        if (p.length !== 4) { return null; }
        let v = 0;
        for (const x of p) { const n = Number(x); if (!(n >= 0 && n <= 255)) { return null; } v = v * 256 + n; }
        return v;
    }

    _isPrivate(v) {
        return (v >= 0x0A000000 && v <= 0x0AFFFFFF) || (v >= 0xAC100000 && v <= 0xAC1FFFFF) ||
               (v >= 0xC0A80000 && v <= 0xC0A8FFFF) || (v >= 0x64400000 && v <= 0x647FFFFF) ||
               (v >= 0x7F000000 && v <= 0x7FFFFFFF) || (v >= 0xA9FE0000 && v <= 0xA9FEFFFF) ||
               v >= 0xE0000000 || v === 0;
    }

    _country(ip) {
        const v = this._ip4(ip);
        if (v === null || this._isPrivate(v) || !this.geo) { return null; }
        const a = this.geo.starts;
        let lo = 0, hi = a.length - 1;
        while (lo < hi) { const m = (lo + hi + 1) >> 1; if (a[m] <= v) { lo = m; } else { hi = m - 1; } }
        const cc = this.geo.countries[this.geo.idx[lo]];
        return cc && cc !== '--' ? cc : null;
    }

    _coord(cc) {
        const m = this.worldMap && this.worldMap[cc];
        if (m) { return m.c; }
        // countries too small for the 1:110m scale
        const extra = { SG: [103.8, 1.35], HK: [114.2, 22.3], MO: [113.5, 22.2], MT: [14.4, 35.9], BH: [50.55, 26.07],
            MU: [57.55, -20.3], MV: [73.5, 4.2], SC: [55.45, -4.6], BB: [-59.55, 13.15], LI: [9.55, 47.15],
            MC: [7.42, 43.74], AD: [1.52, 42.55], SM: [12.45, 43.94], VA: [12.45, 41.9], GI: [-5.35, 36.14],
            IM: [-4.55, 54.23], JE: [-2.13, 49.21], GG: [-2.58, 49.45], BM: [-64.75, 32.3], KY: [-81.25, 19.3],
            AW: [-69.97, 12.52], CW: [-68.95, 12.17], GU: [144.79, 13.44], RE: [55.53, -21.12], LU: [6.13, 49.81],
            SX: [-63.05, 18.04], AG: [-61.8, 17.07], LC: [-60.98, 13.9], GD: [-61.68, 12.12], DM: [-61.37, 15.42],
            KN: [-62.75, 17.33], VC: [-61.2, 13.25], TO: [-175.2, -21.17], WS: [-172.1, -13.76], FO: [-6.9, 62.0] };
        return extra[cc] || null;
    }

    // The firewall's own location on the map. Learned from the log: the country of the local
    // *public* addresses (e.g. the WAN address of inbound traffic) that appears most often.
    // Until then (or if all local addresses are private), fall back to the browser time zone
    // region; a few large time zones get their city instead of the country center.
    _setHome() {
        const tzCities = {
            'America/Sao_Paulo': ['BR', [-46.63, -23.55]], 'America/New_York': ['US', [-74.0, 40.7]],
            'America/Chicago': ['US', [-87.6, 41.9]], 'America/Denver': ['US', [-105.0, 39.7]],
            'America/Los_Angeles': ['US', [-118.2, 34.05]], 'Europe/Amsterdam': ['NL', [4.9, 52.37]],
            'Europe/Berlin': ['DE', [13.4, 52.52]], 'Europe/London': ['GB', [-0.13, 51.5]],
            'Europe/Paris': ['FR', [2.35, 48.86]], 'Asia/Tokyo': ['JP', [139.7, 35.7]]
        };
        let tz = '';
        try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* ignore */ }
        this.tzHome = tzCities[tz] || null;
        this.homeVotes = new Map();
        if (this.tzHome) {
            this.homeCC = this.tzHome[0];
            this.home = this.tzHome[1];
        } else {
            this.homeCC = null;
            this.home = [0, 20];      // neutral point until the log tells where the firewall is
        }
    }

    _learnHome(localIp) {
        const cc = this._country(localIp);
        if (!cc || !this._coord(cc)) { return; }
        this.homeVotes.set(cc, (this.homeVotes.get(cc) || 0) + 1);
        let best = null, n = 0;
        for (const [k, v] of this.homeVotes) { if (v > n) { n = v; best = k; } }
        if (best && best !== this.homeCC) {
            this.homeCC = best;
            // keep the time zone city when it is in the learned country, else use the country center
            this.home = (this.tzHome && this.tzHome[0] === best) ? this.tzHome[1] : this._coord(best);
        }
    }

    _flag(cc) {
        if (!cc || cc.length !== 2) { return ''; }
        return String.fromCodePoint(...[...cc.toUpperCase()].map((ch) => 0x1F1E6 + ch.charCodeAt(0) - 65));
    }

    _addRoute(ev) {
        if (!this.geo) {
            if (this.pending.length < 300) { this.pending.push(ev); }
            return;
        }
        if (ev.local) { this._learnHome(ev.local); }
        const cc = this._country(ev.remote);
        if (!cc || !this._coord(cc)) { this.noGeo++; return; }
        const key = ev.action + '|' + cc + '|' + (ev.inbound ? 'in' : 'out');
        let r = this.routes.get(key);
        if (!r) {
            r = { action: ev.action, cc, inbound: ev.inbound, n: 0, ips: new Set(), phase: Math.random() };
            this.routes.set(key, r);
        }
        r.n++;
        r.t = performance.now();
        r.lastIp = ev.remote;
        r.remote = ev.remote;
        r.port = ev.port;
        r.label = ev.label;
        if (r.ips.size < 50) { r.ips.add(ev.remote); }
        if (r.action === 'block' && r.inbound && !r.strike && !this.reducedMotion &&
            [...this.routes.values()].filter((x) => x.strike).length < this.maxStrikes) {
            r.strike = { t0: performance.now(), dur: 1400 + Math.random() * 500 };
        }
    }

    _mapLayout() {
        // cropped equirectangular projection (lat -58..84), keeping the aspect ratio
        const lonMin = -170, lonMax = 190, latMin = -58, latMax = 84;
        const w = this.w, h = this.h;
        const scale = Math.min(w / (lonMax - lonMin), h / (latMax - latMin));
        this.mp = {
            scale, lonMin, latMax,
            ox: (w - (lonMax - lonMin) * scale) / 2,
            oy: (h - (latMax - latMin) * scale) / 2
        };
    }

    _xy(lon, lat) {
        const m = this.mp;
        if (lon < m.lonMin) { lon += 360; }
        return [m.ox + (lon - m.lonMin) * m.scale, m.oy + (m.latMax - lat) * m.scale];
    }

    _drawMapBase() {
        this._mapLayout();
        const dpr = window.devicePixelRatio || 1;
        const cv = document.createElement('canvas');
        cv.width = Math.round(this.w * dpr); cv.height = Math.round(this.h * dpr);
        const c = cv.getContext('2d');
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        const k = this.colors;
        // meridian/parallel grid
        c.strokeStyle = this._withAlpha(k.text, 0.06); c.lineWidth = 1;
        for (let lon = -150; lon <= 180; lon += 30) {
            const [x0, y0] = this._xy(lon, 84), [x1, y1] = this._xy(lon, -58);
            c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
        }
        for (let lat = -30; lat <= 60; lat += 30) {
            const [x0, y0] = this._xy(-170, lat), [x1, y1] = this._xy(189.9, lat);
            c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
        }
        // countries
        c.fillStyle = this._withAlpha(k.text, 0.10);
        c.strokeStyle = this._withAlpha(k.text, 0.22);
        c.lineWidth = 0.6;
        for (const cc in this.worldMap) {
            for (const ring of this.worldMap[cc].p) {
                c.beginPath();
                let prevX = null;
                ring.forEach(([lon, lat], i) => {
                    const [x, y] = this._xy(lon, lat);
                    // avoid a stroke crossing the whole map at the antimeridian
                    if (i === 0 || (prevX !== null && Math.abs(x - prevX) > this.w / 2)) { c.moveTo(x, y); } else { c.lineTo(x, y); }
                    prevX = x;
                });
                c.closePath(); c.fill(); c.stroke();
            }
        }
        this.mapBase = cv;
    }

    _drawMap() {
        const c = this.ctx, k = this.colors;
        c.clearRect(0, 0, this.w, this.h);
        if (!this.geo || !this.worldMap) {
            c.fillStyle = this._withAlpha(k.text, 0.6);
            c.font = '12px ' + getComputedStyle(this.el).fontFamily;
            c.textAlign = 'center';
            c.fillText(this.translations.loadingmap ?? 'Loading map…', this.w / 2, this.h / 2);
            return;
        }
        if (!this.mapBase) { this._drawMapBase(); }
        c.drawImage(this.mapBase, 0, 0, this.w, this.h);

        const now = performance.now();
        const home = this._xy(this.home[0], this.home[1]);
        // firewall highlight: pulsing ring
        const pulse = (now % 2000) / 2000;
        c.beginPath(); c.arc(home[0], home[1], 3 + pulse * 10, 0, Math.PI * 2);
        c.strokeStyle = this._withAlpha(k.beam, 0.8 * (1 - pulse)); c.lineWidth = 1.5; c.stroke();
        c.beginPath(); c.arc(home[0], home[1], 3, 0, Math.PI * 2);
        c.fillStyle = k.beam; c.fill();

        const list = [];
        for (const [key, r] of this.routes) {
            if (now - r.t > this.lifeMs) { this.routes.delete(key); continue; }
            list.push(r);
        }
        list.sort((a, b) => a.t - b.t);
        this.targets = [];
        const emojiFont = '"Noto Color Emoji","Apple Color Emoji","Segoe UI Emoji",sans-serif';
        for (const r of list) {
            const [lon, lat] = this._coord(r.cc);
            const remote = this._xy(lon, lat);
            const [p0, p1] = r.inbound ? [remote, home] : [home, remote];
            const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
            const dist = Math.hypot(dx, dy) || 1;
            // control point: middle of the line, raised (arc "over the top")
            const cx = (p0[0] + p1[0]) / 2 - dy * 0.25, cy = (p0[1] + p1[1]) / 2 - Math.abs(dx) * 0.25 - dist * 0.12;
            const age = now - r.t;
            const life = Math.max(0, 1 - age / this.lifeMs);
            const alpha = Math.max(0.15, life) * (age < 1500 ? 1 : 0.85);
            const color = k[r.action];
            const lineW = 1 + Math.min(3, Math.log2(1 + r.n) * 0.6);
            // base arc
            c.beginPath(); c.moveTo(p0[0], p0[1]); c.quadraticCurveTo(cx, cy, p1[0], p1[1]);
            c.strokeStyle = this._withAlpha(color, alpha * 0.45); c.lineWidth = lineW; c.stroke();
            const bez = (t) => [(1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * cx + t * t * p1[0],
                                (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * cy + t * t * p1[1]];
            if (r.action === 'block' && r.inbound && !this.reducedMotion) {
                // attack: missile along the arc, intercepted on the firewall's shield
                if (r.strike) { this._drawStrike(r, bez, dist, now); }
            } else {
                // particle travelling from source to destination (constant speed in px)
                const cycle = Math.max(900, dist * 6);
                const tt = ((now / cycle) + r.phase) % 1;
                const [px, py] = bez(tt);
                c.save();
                c.shadowColor = this._withAlpha(color, alpha); c.shadowBlur = 8;
                c.beginPath(); c.arc(px, py, lineW + 1, 0, Math.PI * 2);
                c.fillStyle = this._withAlpha(color, alpha); c.fill();
                c.restore();
                // arrowhead at the destination, along the final tangent
                const ang = Math.atan2(p1[1] - cy, p1[0] - cx), size = 6 + lineW * 1.5;
                c.beginPath();
                c.moveTo(p1[0], p1[1]);
                c.lineTo(p1[0] - size * Math.cos(ang - 0.45), p1[1] - size * Math.sin(ang - 0.45));
                c.lineTo(p1[0] - size * Math.cos(ang + 0.45), p1[1] - size * Math.sin(ang + 0.45));
                c.closePath(); c.fillStyle = this._withAlpha(color, Math.min(1, alpha + 0.1)); c.fill();
            }
            // dot and flag of the remote country
            c.beginPath(); c.arc(remote[0], remote[1], 2.5, 0, Math.PI * 2);
            c.fillStyle = this._withAlpha(color, alpha); c.fill();
            c.font = '14px ' + emojiFont; c.textAlign = 'center'; c.textBaseline = 'bottom';
            c.globalAlpha = Math.max(0.35, alpha);
            c.fillText(this._flag(r.cc), remote[0], remote[1] - 4);
            c.globalAlpha = 1;
            this.targets.push([r, remote[0], remote[1]]);
        }
        c.textBaseline = 'alphabetic';
        this._drawBlasts(home, now);

        // country ranking
        const byCountry = new Map();
        for (const r of list) {
            const p = byCountry.get(r.cc) || { cc: r.cc, pass: 0, block: 0, nat: 0, match: 0, n: 0 };
            p[r.action] += r.n; p.n += r.n; byCountry.set(r.cc, p);
        }
        const top = [...byCountry.values()].sort((a, b) => b.n - a.n).slice(0, Math.max(3, Math.min(6, Math.floor(this.h / 40))));
        let y = 18;   // top-left corner (over the Pacific): the card footer may cover the bottom of the canvas
        c.textAlign = 'left';
        for (const p of top) {
            c.font = '13px ' + emojiFont;
            c.fillStyle = k.text;
            c.fillText(this._flag(p.cc), 8, y);
            c.font = '11px ' + getComputedStyle(this.el).fontFamily;
            c.fillStyle = this._withAlpha(k.text, 0.85);
            c.fillText(p.cc, 28, y);
            let x = 50;
            for (const a of ['pass', 'block', 'nat', 'match']) {
                if (!p[a]) { continue; }
                c.fillStyle = k[a]; c.fillText(String(p[a]), x, y); x += c.measureText(String(p[a])).width + 8;
            }
            y += 16;
        }
        if (this.noGeo) {
            c.textAlign = 'right'; c.fillStyle = this._withAlpha(k.text, 0.5);
            c.font = '10px ' + getComputedStyle(this.el).fontFamily;
            c.fillText(`${this.translations.nogeo ?? 'LAN/IPv6'}: ${this.noGeo}`, this.w - 6, 14);
        }
    }

    // missile in flight: accelerating head with a flame, smoke trail, stops at the shield (14px from the firewall)
    _drawStrike(r, bez, dist, now) {
        const c = this.ctx, k = this.colors;
        const p = Math.min(1, (now - r.strike.t0) / r.strike.dur);
        const tStop = Math.max(0.5, 1 - 14 / dist);
        const tt = Math.pow(p, 1.6) * tStop;           // accelerates towards the target
        if (p >= 1) {
            const [bx, by] = bez(tStop);
            this.blasts.push({
                x: bx, y: by, t0: now,
                sparks: Array.from({ length: 12 }, () => [Math.random() * Math.PI * 2, 25 + Math.random() * 45])
            });
            if (this.blasts.length > 24) { this.blasts.shift(); }
            r.strike = null;
            return;
        }
        // smoke trail: grey puffs getting thinner and more transparent away from the head
        for (let i = 14; i >= 1; i--) {
            const t = tt - i * 0.012;
            if (t <= 0) { continue; }
            const [sx, sy] = bez(t);
            const f = 1 - i / 15;
            c.beginPath(); c.arc(sx, sy, 1.4 + (1 - f) * 3, 0, Math.PI * 2);
            c.fillStyle = this._withAlpha(k.text, 0.06 + f * 0.22); c.fill();
        }
        const [hx, hy] = bez(tt);
        const [ax, ay] = bez(Math.max(0, tt - 0.01));
        const ang = Math.atan2(hy - ay, hx - ax);
        c.save();
        c.translate(hx, hy); c.rotate(ang);
        // flame behind the head
        const fl = 10 + Math.random() * 6;
        const g = c.createLinearGradient(-fl, 0, 0, 0);
        g.addColorStop(0, 'rgba(255,120,20,0)'); g.addColorStop(1, 'rgba(255,200,60,0.95)');
        c.beginPath(); c.moveTo(-fl, 0); c.lineTo(-2, -2.8); c.lineTo(-2, 2.8); c.closePath();
        c.fillStyle = g; c.fill();
        // body
        c.shadowColor = this._withAlpha(k.block, 0.9); c.shadowBlur = 10;
        c.beginPath(); c.moveTo(7, 0); c.lineTo(-2.5, -3.2); c.lineTo(-2.5, 3.2); c.closePath();
        c.fillStyle = '#fff4e0'; c.fill();
        c.restore();
    }

    // explosions: flash, fireball, shockwave, sparks with gravity and the firewall's shield lighting up
    _drawBlasts(home, now) {
        if (!this.blasts.length) { return; }
        const c = this.ctx, k = this.colors, D = 950;
        this.blasts = this.blasts.filter((b) => now - b.t0 < D);
        for (const b of this.blasts) {
            const a = now - b.t0, p = a / D, q = 1 - p;
            c.save();
            // shield arc around the firewall
            c.beginPath(); c.arc(home[0], home[1], 14, 0, Math.PI * 2);
            c.strokeStyle = this._withAlpha(k.beam, 0.7 * q); c.lineWidth = 1 + 2 * q; c.stroke();
            // flash
            const fr = 4 + 26 * Math.min(1, p * 3);
            let g = c.createRadialGradient(b.x, b.y, 0, b.x, b.y, fr);
            g.addColorStop(0, `rgba(255,255,255,${0.9 * q * q})`);
            g.addColorStop(0.4, `rgba(255,220,120,${0.6 * q * q})`);
            g.addColorStop(1, 'rgba(255,160,40,0)');
            c.fillStyle = g; c.beginPath(); c.arc(b.x, b.y, fr, 0, Math.PI * 2); c.fill();
            // fireball
            const br = 3 + 13 * Math.sqrt(p);
            g = c.createRadialGradient(b.x, b.y, 0, b.x, b.y, br);
            g.addColorStop(0, `rgba(255,236,170,${q})`);
            g.addColorStop(0.5, `rgba(255,128,32,${0.85 * q})`);
            g.addColorStop(1, this._withAlpha(k.block, 0));
            c.fillStyle = g; c.beginPath(); c.arc(b.x, b.y, br, 0, Math.PI * 2); c.fill();
            // shockwave
            c.beginPath(); c.arc(b.x, b.y, 6 + 42 * p, 0, Math.PI * 2);
            c.strokeStyle = this._withAlpha(k.text, 0.55 * q); c.lineWidth = 0.6 + 2 * q; c.stroke();
            // sparks
            const s = a / 1000;
            c.lineWidth = 1.2;
            for (const [ang, v] of b.sparks) {
                const x = b.x + Math.cos(ang) * v * s, y = b.y + Math.sin(ang) * v * s + 40 * s * s;
                const x0 = b.x + Math.cos(ang) * v * s * 0.8, y0 = b.y + Math.sin(ang) * v * s * 0.8 + 32 * s * s;
                c.beginPath(); c.moveTo(x0, y0); c.lineTo(x, y);
                c.strokeStyle = `rgba(255,${150 + Math.round(90 * q)},60,${q})`; c.stroke();
            }
            c.restore();
        }
    }

    _onMouseMap(e) {
        if (!this.targets) { return; }
        const r = this.canvas.getBoundingClientRect();
        const sx = r.width ? this.w / r.width : 1, sy = r.height ? this.h / r.height : 1;   // canvas drawn stretched until the next resize
        const mx = (e.clientX - r.left) * sx, my = (e.clientY - r.top) * sy;
        let best = null, dist = 14 * 14;
        for (const [route, x, y] of this.targets) {
            const d = (x - mx) ** 2 + (y - my) ** 2;
            if (d < dist) { dist = d; best = route; }
        }
        this.hover = best;
        if (!best) { this.tooltip.style.display = 'none'; return; }
        const t = this.translations, esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[ch]));
        // add up the routes of the same country
        const sameCountry = [...this.routes.values()].filter((x) => x.cc === best.cc);
        const sum = (a) => sameCountry.filter((x) => x.action === a).reduce((s, x) => s + x.n, 0);
        const name = (this.worldMap[best.cc] && this.worldMap[best.cc].n) || best.cc;
        this.tooltip.innerHTML =
            `<span style="font-size:16px">${this._flag(best.cc)}</span> <b>${esc(name)}</b> (${esc(best.cc)})<br>` +
            `<span style="color:${this.colors.pass}">${esc(t.pass)} ${sum('pass')}</span> · ` +
            `<span style="color:${this.colors.block}">${esc(t.block)} ${sum('block')}</span> · ` +
            `<span style="color:${this.colors.nat}">${esc(t.nat)} ${sum('nat')}</span>` +
            (sum('match') ? ` · <span style="color:${this.colors.match}">${esc(t.match ?? 'Match')} ${sum('match')}</span>` : '') + `<br>` +
            `<span style="font-family:var(--bs-font-monospace,monospace)">${esc(best.lastIp)}${best.port !== '' && best.port !== undefined ? ' → :' + esc(best.port) : ''}</span> ` +
            `(${esc(best.inbound ? t.inbound : t.outbound)})<br>${esc(best.label)}<br>` +
            `<span style="opacity:.7">${esc(t.click)}</span>`;
        this.tooltip.style.display = 'block';
        const dw = this.tooltip.offsetWidth, dh = this.tooltip.offsetHeight;
        this.tooltip.style.left = Math.min(Math.max(4, mx + 12), r.width - dw - 4) + 'px';
        this.tooltip.style.top = Math.min(Math.max(4, my - dh - 10), r.height - dh - 4) + 'px';
    }

    /* ------------------------------------------------------------------ flow mode */

    _flowAdd(action, inbound, remote, b) {
        const F = this.flow, t = this.translations, now = performance.now();
        let k0, l0;
        if (inbound) {
            const cc = this.geo && this._country(remote);
            if (cc) { k0 = 'cc:' + cc; l0 = this._flag(cc) + ' ' + cc; }
            else if (String(remote).includes(':')) { k0 = 'v6'; l0 = 'IPv6'; }
            else { k0 = 'inet'; l0 = 'Internet'; }
        } else {
            k0 = 'local'; l0 = t.local ?? 'Local hosts';
        }
        const k1 = 'if:' + (b.iface || '?'), l1 = b.iface || '?';
        const port = b.port !== '' && b.port != null ? String(b.port) : '';
        const proto = String(b.proto || '').toLowerCase();
        const k2 = port ? 'p:' + port : 'x:' + proto;
        const l2 = port ? `${port} ${Sonar.SVC[port] ?? proto}` : (proto || '?');
        let k3, l3;
        if (action === 'block') { k3 = 'r:' + (b.label || ''); l3 = b.label || (t.block ?? 'Block'); }
        else { k3 = action; l3 = t[action] ?? action; }
        const keys = [k0, k1, k2, k3], labels = [l0, l1, l2, l3];
        keys.forEach((k, i) => {
            const m = F.cols[i];
            let nd = m.get(k);
            if (!nd) {
                nd = { key: k, col: i, label: labels[i], n: 0, w: 0, y: 0, h: 0, init: false };
                if (i === 2 && port) { nd.port = port; }
                if (i === 3) { nd.action = action; }
                m.set(k, nd);
                if (m.size > 200) {
                    let low = null;
                    for (const v of m.values()) { if (v !== nd && (!low || v.w < low.w)) { low = v; } }
                    if (low) { m.delete(low.key); }
                }
            }
            nd.n++; nd.w += 1; nd.flash = now;
            if (i < 3) {
                const lk = k + '\u0001' + keys[i + 1];
                F.links[i].set(lk, (F.links[i].get(lk) || 0) + 1);
            }
        });
        if (!this.reducedMotion && F.parts.length < F.maxParts) {
            // bursts (e.g. the history replayed on load) leave one after another instead of as a clump
            F.nextT0 = Math.max(now, (F.nextT0 || 0) + 60);
            if (F.nextT0 - now > 4000) { return; }
            F.parts.push({ keys, action, t0: F.nextT0, dur: 2100 + Math.random() * 700,
                j: [0, 1, 2, 3].map(() => 0.15 + Math.random() * 0.7) });
        }
    }

    _flowNode(i, key) {
        const nd = this.flow.cols[i].get(key);
        if (nd && nd.vis) { return nd; }
        const o = this.flow.other[i];
        return o.vis ? o : null;
    }

    _flowLayout(now) {
        const F = this.flow, t = this.translations;
        const dt = Math.min(1000, now - F.last); F.last = now;
        const decay = Math.exp(-dt / 45000);
        for (const m of F.cols) {
            for (const [k, v] of m) { v.w *= decay; if (v.w < 0.02 && now - (v.flash || 0) > 5000) { m.delete(k); } }
        }
        for (const m of F.links) {
            for (const [k, v] of m) { const w = v * decay; if (w < 0.02) { m.delete(k); } else { m.set(k, w); } }
        }
        const top = 26, bottom = 8, gap = 5, bw = 10;
        const w = this.w, h = this.h;
        const x0 = Math.max(92, Math.min(130, w * 0.2)), x3 = w - Math.max(118, Math.min(170, w * 0.27)) - bw;
        F.bw = bw; F.top = top;
        F.xs = [x0, x0 + (x3 - x0) / 3, x0 + 2 * (x3 - x0) / 3, x3];
        const maxNodes = Math.max(3, Math.min(7, Math.floor((h - top - bottom) / 26)));
        let total = 0;
        F.cols.forEach((m) => { let s = 0; for (const v of m.values()) { s += v.w; } total = Math.max(total, s); });
        F.total = total;
        F.cols.forEach((m, i) => {
            const all = [...m.values()].sort((a, b) => b.w - a.w);
            all.forEach((v) => { v.vis = false; });
            const shown = all.slice(0, maxNodes).filter((v) => v.w > 0.01);
            shown.forEach((v) => { v.vis = true; });
            const o = F.other[i];
            o.w = all.slice(maxNodes).reduce((s, v) => s + v.w, 0);
            o.n = all.slice(maxNodes).reduce((s, v) => s + v.n, 0);
            o.vis = o.w > 0.05;
            o.label = `${t.others ?? 'others'} (${all.length - maxNodes})`;
            const list = o.vis ? [...shown, o] : shown;
            // order: by weight, "others" at the bottom; keep a stable vertical order for readability
            const avail = h - top - bottom - gap * Math.max(0, list.length - 1);
            const scale = total > 0 ? avail / total : 0;
            let y = top;
            for (const v of list) {
                const th = Math.max(3, v.w * scale);
                if (!v.init) { v.y = y; v.h = th; v.init = true; }
                v.y += (y - v.y) * 0.12; v.h += (th - v.h) * 0.12;
                y += th + gap;
            }
            F.cols[i].list = list;
        });
    }

    _drawFlow() {
        const c = this.ctx, k = this.colors, F = this.flow, t = this.translations;
        const now = performance.now();
        c.clearRect(0, 0, this.w, this.h);
        this._flowLayout(now);
        const bw = F.bw, xs = F.xs;
        this.flowTargets = [];

        // column headers
        c.font = '600 10px ' + getComputedStyle(this.el).fontFamily;
        c.textBaseline = 'middle';
        c.fillStyle = this._withAlpha(k.text, 0.55);
        const heads = [t.origin ?? 'Origin', t.interface ?? 'Interface', t.service ?? 'Service', t.decision ?? 'Decision'];
        heads.forEach((txt, i) => {
            c.textAlign = i === 0 ? 'right' : 'left';
            c.fillText(String(txt).toUpperCase(), i === 0 ? xs[0] + bw : xs[i], 11);
        });

        // ribbons: aggregate the links onto the visible nodes, then stack them inside each node
        for (let i = 0; i < 3; i++) {
            const agg = new Map();
            for (const [lk, w] of F.links[i]) {
                const [ka, kb] = lk.split('\u0001');
                const a = this._flowNode(i, ka), b = this._flowNode(i + 1, kb);
                if (!a || !b) { continue; }
                const id = a.key + '\u0001' + b.key;
                const e = agg.get(id) || { a, b, w: 0 };
                e.w += w; agg.set(id, e);
            }
            const links = [...agg.values()];
            const outOff = new Map(), inOff = new Map();
            const sumOut = new Map(), sumIn = new Map();
            links.forEach((l) => { sumOut.set(l.a, (sumOut.get(l.a) || 0) + l.w); sumIn.set(l.b, (sumIn.get(l.b) || 0) + l.w); });
            links.sort((p, q) => (p.b.y - q.b.y) || (p.a.y - q.a.y));
            for (const l of links) {
                const ha = l.a.h * l.w / (sumOut.get(l.a) || 1), hb = l.b.h * l.w / (sumIn.get(l.b) || 1);
                const ya = l.a.y + (outOff.get(l.a) || 0); outOff.set(l.a, (outOff.get(l.a) || 0) + ha);
                l.ya = ya; l.ha = ha; l.hb = hb;
            }
            links.sort((p, q) => (p.a.y - q.a.y) || (p.b.y - q.b.y));
            for (const l of links) {
                const yb = l.b.y + (inOff.get(l.b) || 0); inOff.set(l.b, (inOff.get(l.b) || 0) + l.hb);
                const xa = xs[i] + bw, xb = xs[i + 1], mx = (xa + xb) / 2;
                c.beginPath();
                c.moveTo(xa, l.ya);
                c.bezierCurveTo(mx, l.ya, mx, yb, xb, yb);
                c.lineTo(xb, yb + l.hb);
                c.bezierCurveTo(mx, yb + l.hb, mx, l.ya + l.ha, xa, l.ya + l.ha);
                c.closePath();
                const col = i === 2 && l.b.action ? k[l.b.action] : k.beam;
                const hot = this.hover && (this.hover === l.a || this.hover === l.b);
                c.fillStyle = this._withAlpha(col, hot ? 0.34 : (i === 2 ? 0.2 : 0.13));
                c.fill();
            }
        }

        // nodes
        F.cols.forEach((m, i) => {
            for (const v of m.list) {
                const col = i === 3 && v.action ? k[v.action] : (v.key === '__o' ? k.gridStrong : k.beam);
                const fl = Math.max(0, 1 - (now - (v.flash || 0)) / 500);
                c.save();
                if (fl > 0 && !this.reducedMotion) { c.shadowColor = col; c.shadowBlur = 12 * fl; }
                c.fillStyle = this._withAlpha(col, 0.75 + 0.25 * fl);
                c.beginPath();
                if (c.roundRect) { c.roundRect(xs[i], v.y, bw, Math.max(2, v.h), 2); } else { c.rect(xs[i], v.y, bw, Math.max(2, v.h)); }
                c.fill();
                c.restore();
                this.flowTargets.push([v, xs[i] - 4, v.y - 2, bw + 8, v.h + 4]);
            }
        });

        // particles
        const pos = (p, seg, u) => {
            const a = this._flowNode(seg, p.keys[seg]), b = this._flowNode(seg + 1, p.keys[seg + 1]);
            if (!a || !b) { return null; }
            const xa = xs[seg] + bw, xb = xs[seg + 1];
            const ya = a.y + a.h * p.j[seg], yb = b.y + b.h * p.j[seg + 1];
            const mx = (xa + xb) / 2, v = 1 - u;
            return [v * v * v * xa + 3 * v * v * u * mx + 3 * v * u * u * mx + u * u * u * xb,
                    v * v * v * ya + 3 * v * v * u * ya + 3 * v * u * u * yb + u * u * u * yb];
        };
        const keep = [];
        for (const p of F.parts) {
            const q = (now - p.t0) / p.dur;
            if (q < 0) { keep.push(p); continue; }
            if (q >= 1) {
                const nd = this._flowNode(3, p.keys[3]);
                if (nd) {
                    F.pops.push({ x: xs[3] + bw / 2, y: nd.y + nd.h * p.j[3], t0: now, action: p.action,
                        sparks: p.action === 'block' ? Array.from({ length: 7 }, () => [Math.random() * Math.PI * 2, 30 + Math.random() * 50]) : null });
                }
                continue;
            }
            keep.push(p);
            const g = q * 3, seg = Math.min(2, Math.floor(g)), u = g - seg;
            const head = pos(p, seg, u), tail = pos(p, seg, Math.max(0, u - 0.09));
            if (!head) { continue; }
            const col = k[p.action];
            if (tail) {
                const gr = c.createLinearGradient(tail[0], tail[1], head[0], head[1]);
                gr.addColorStop(0, this._withAlpha(col, 0)); gr.addColorStop(1, this._withAlpha(col, 0.8));
                c.strokeStyle = gr; c.lineWidth = 2; c.lineCap = 'round';
                c.beginPath(); c.moveTo(tail[0], tail[1]); c.lineTo(head[0], head[1]); c.stroke();
            }
            c.fillStyle = col;
            c.beginPath(); c.arc(head[0], head[1], p.action === 'block' ? 2.6 : 2.1, 0, Math.PI * 2); c.fill();
        }
        F.parts = keep;

        // bursts on the decision column: blocked ones explode, passed/NAT ones just ripple
        F.pops = F.pops.filter((b) => now - b.t0 < 700);
        for (const b of F.pops) {
            const a = now - b.t0, pr = a / 700, q = 1 - pr, col = k[b.action];
            c.beginPath(); c.arc(b.x, b.y, 3 + (b.sparks ? 16 : 9) * pr, 0, Math.PI * 2);
            c.strokeStyle = this._withAlpha(col, 0.8 * q); c.lineWidth = 0.6 + 1.6 * q; c.stroke();
            if (b.sparks) {
                const g = c.createRadialGradient(b.x, b.y, 0, b.x, b.y, 9);
                g.addColorStop(0, `rgba(255,236,170,${0.9 * q})`); g.addColorStop(1, this._withAlpha(col, 0));
                c.fillStyle = g; c.beginPath(); c.arc(b.x, b.y, 9, 0, Math.PI * 2); c.fill();
                const s = a / 1000;
                c.lineWidth = 1.1;
                for (const [ang, v] of b.sparks) {
                    const x = b.x + Math.cos(ang) * v * s, y = b.y + Math.sin(ang) * v * s + 30 * s * s;
                    c.beginPath(); c.moveTo(b.x + Math.cos(ang) * v * s * 0.7, b.y + Math.sin(ang) * v * s * 0.7 + 21 * s * s); c.lineTo(x, y);
                    c.strokeStyle = `rgba(255,${150 + Math.round(90 * q)},60,${q})`; c.stroke();
                }
            }
        }

        // labels (with a halo in the widget background so they stay readable over the bands)
        c.font = '11px ' + getComputedStyle(this.el).fontFamily;
        c.lineJoin = 'round';
        const fit = (txt, max) => {
            txt = String(txt);
            if (c.measureText(txt).width <= max) { return txt; }
            while (txt.length > 1 && c.measureText(txt + '…').width > max) { txt = txt.slice(0, -1); }
            return txt + '…';
        };
        F.cols.forEach((m, i) => {
            for (const v of m.list) {
                if (v.h < 8 && m.list.length > 4) { continue; }
                const y = v.y + v.h / 2;
                let x, max;
                if (i === 0) { c.textAlign = 'right'; x = xs[0] - 6; max = xs[0] - 10; }
                else { c.textAlign = 'left'; x = xs[i] + bw + 5; max = i === 3 ? this.w - x - 4 : (xs[i + 1] - x) * 0.95; }
                const num = ' ' + v.n;
                const txt = fit(v.label, Math.max(20, max - c.measureText(num).width));
                c.strokeStyle = k.bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(k.bg) ? k.bg : 'rgba(0,0,0,0)';
                c.lineWidth = 3;
                const full = txt + num;
                c.strokeText(full, x, y);
                c.fillStyle = k.text;
                if (i === 0) {
                    c.fillStyle = this._withAlpha(k.text, 0.55); c.fillText(num, x, y);
                    c.fillStyle = k.text; c.fillText(txt, x - c.measureText(num).width, y);
                } else {
                    c.fillText(txt, x, y);
                    c.fillStyle = this._withAlpha(k.text, 0.55); c.fillText(num, x + c.measureText(txt).width, y);
                }
            }
        });
    }

    _onMouseFlow(e) {
        if (!this.flowTargets) { return; }
        const r = this.canvas.getBoundingClientRect();
        const sx = r.width ? this.w / r.width : 1, sy = r.height ? this.h / r.height : 1;   // canvas drawn stretched until the next resize
        const mx = (e.clientX - r.left) * sx, my = (e.clientY - r.top) * sy;
        let best = null;
        for (const [v, x, y, w, h] of this.flowTargets) {
            if (mx >= x && mx <= x + w && my >= y && my <= y + h) { best = v; break; }
        }
        this.hover = best;
        this.canvas.style.cursor = best && best.col === 2 && best.port ? 'pointer' : 'crosshair';
        if (!best) { this.tooltip.style.display = 'none'; return; }
        const t = this.translations, esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[ch]));
        const heads = [t.origin ?? 'Origin', t.interface ?? 'Interface', t.service ?? 'Service', t.decision ?? 'Decision'];
        const share = this.flow.total > 0 ? Math.round(100 * best.w / this.flow.total) : 0;
        const color = best.col === 3 && best.action ? this.colors[best.action] : this.colors.beam;
        this.tooltip.innerHTML =
            `<span style="opacity:.7">${esc(heads[best.col])}</span><br><b style="color:${color}">${esc(best.label)}</b><br>` +
            `${esc(t.hits)}: ${best.n} · ${share}% ${esc(t.recentshare ?? 'of recent traffic')}` +
            (best.col === 2 && best.port ? `<br><span style="opacity:.7">${esc(t.click)}</span>` : '');
        this.tooltip.style.display = 'block';
        const dw = this.tooltip.offsetWidth, dh = this.tooltip.offsetHeight;
        this.tooltip.style.left = Math.min(Math.max(4, mx + 12), r.width - dw - 4) + 'px';
        this.tooltip.style.top = Math.min(Math.max(4, my - dh - 10), r.height - dh - 4) + 'px';
    }
}

/*
 * Host telemetry for the module views (host.telemetry): CPU, memory and WAN traffic of the firewall, from the
 * same endpoints as the core Cpu, Memory and Traffic widgets. Streams only while a view holds it
 * (start()/stop() usage counter; reset() closes everything). Own EventSources, a few reconnections, and
 * simulated values when the endpoints cannot be reached (preview without the API) or when `simulated` is set.
 */
class SonarTelemetry {
    static HIST = 60;

    constructor(host) {
        this.host = host;
        this.users = 0;
        this.active = false;
        this.simulated = false;          // set by the preview only (never as a fallback on a firewall)
        this.offline = { cpu: false, mem: false, wan: false };   // source currently unreachable (reconnecting)
        this.cpu = { total: 0, user: 0, sys: 0, intr: 0, hist: [] };
        this.mem = { total_mb: 0, used_mb: 0, arc_mb: 0, pct: 0, hist: [] };
        this.wan = [];                   // [{key, name, in_bps, out_bps, hist_in, hist_out}]
        this.updated = 0;
        this._es = {};                   // cpu, traffic
        this._retries = { cpu: 0, traffic: 0 };
        this._sim = { cpu: false, mem: false, wan: false };
        this._timer = null;
        this._memTimer = null;
        this._reopen = {};
        this._lastTraffic = null;
        this._seq = 0;
        // exposure report of the Policy Analyzer plugin, as returned by the API (data), every 5 min while active;
        // available = false after a 404/403 (plugin not installed or no privilege): not asked again
        this.exposure = { available: null, data: null, updated: 0, error: null };
        this._expTimer = null;
    }

    start() {
        this.users++;
        if (!this.active) { this._open(); }
        return this;
    }

    stop() {
        this.users = Math.max(0, this.users - 1);
        if (this.users === 0) { this._close(); }
    }

    reset() {
        this.users = 0;
        this._close();
    }

    _open() {
        this.active = true;
        if (this.simulated) { this._sim = { cpu: true, mem: true, wan: true }; }
        if (!this._sim.cpu) { this._openCpu(); }
        if (!this._sim.wan) { this._openTraffic(); }
        this._pollMem();
        this._pollExposure();
        this._timer = setInterval(() => this._tick(), 1000);
        this._tick();
    }

    _close() {
        this.active = false;
        for (const k of Object.keys(this._es)) { try { this._es[k].close(); } catch (e) { /* ignore */ } }
        this._es = {};
        for (const k of Object.keys(this._reopen)) { clearTimeout(this._reopen[k]); }
        this._reopen = {};
        clearInterval(this._timer); this._timer = null;
        clearTimeout(this._memTimer); this._memTimer = null;
        clearTimeout(this._expTimer); this._expTimer = null;
        this._lastTraffic = null;
    }

    // a closed stream (server error, endpoint missing, firewall restarting) is reopened with a growing delay
    // (5 s → 60 s), never more than one connection per source. Real data is never replaced by simulated values:
    // only the preview (this.simulated set before start) simulates; on a firewall a dead source shows 'offline'.
    _failed(name, reopen) {
        if (!this.active) { return; }
        const key = name === 'traffic' ? 'wan' : name;
        this.offline[key] = true;
        const n = this._retries[name]++;
        clearTimeout(this._reopen[name]);
        this._reopen[name] = setTimeout(() => { if (this.active) { reopen(); } }, Math.min(60000, 5000 * Math.pow(2, Math.min(n, 4))));
    }

    _stream(name, url, onData, reopen) {
        try { this._es[name].close(); } catch (e) { /* none */ }
        let es;
        try { es = new EventSource(url); } catch (e) { this._failed(name, reopen); return; }
        es.onmessage = (ev) => {
            if (!ev || !ev.data) { return; }
            let d; try { d = JSON.parse(ev.data); } catch (e) { return; }
            this._retries[name] = 0;
            this.offline[name === 'traffic' ? 'wan' : name] = false;
            onData(d);
        };
        es.onerror = () => {
            // CONNECTING: the browser retries by itself; CLOSED: the server refused (404, no stream)
            if (es.readyState === EventSource.CLOSED) { this._failed(name, reopen); }
        };
        this._es[name] = es;
    }

    _openCpu() {
        this._stream('cpu', '/api/diagnostics/cpu_usage/stream', (d) => {
            const n = (v) => Math.max(0, Math.min(100, Number(v) || 0));
            this.cpu.total = n(d.total); this.cpu.user = n(d.user); this.cpu.sys = n(d.sys); this.cpu.intr = n(d.intr);
            this.updated = Date.now();
        }, () => this._openCpu());
    }

    async _openTraffic() {
        let names = null, info = null;
        try {
            [names, info] = await Promise.all([
                this.host.ajaxCall('/api/diagnostics/traffic/interface'),
                this.host.ajaxCall('/api/interfaces/overview/interfaces_info').catch(() => null)
            ]);
        } catch (e) { names = null; }
        if (!this.active) { return; }
        const all = names && names.interfaces && typeof names.interfaces === 'object' ? names.interfaces : null;
        if (!all || !Object.keys(all).length) { this._failed('traffic', () => this._openTraffic()); return; }
        // WAN = interfaces with a gateway (overview); fallback: description or key containing "wan"; else the first
        const withGw = new Set();
        const rows = info && Array.isArray(info.rows) ? info.rows : [];
        for (const r of rows) {
            if (r && r.identifier && Array.isArray(r.gateways) && r.gateways.length) { withGw.add(String(r.identifier)); }
        }
        let keys = Object.keys(all).filter((k) => withGw.has(k));
        if (!keys.length) { keys = Object.keys(all).filter((k) => /wan/i.test(k) || /wan/i.test(String(all[k].name ?? ''))); }
        if (!keys.length) { keys = Object.keys(all).slice(0, 1); }
        this.wan = keys.map((k) => ({ key: k, name: String(all[k].name ?? k), in_bps: 0, out_bps: 0, hist_in: [], hist_out: [] }));
        this._lastTraffic = null;
        this._stream('traffic', '/api/diagnostics/traffic/stream/1', (d) => {
            if (!d || !d.interfaces) { return; }
            const t = Number(d.time) || 0;
            const elapsed = this._lastTraffic ? t - this._lastTraffic : 0;
            this._lastTraffic = t;
            if (elapsed <= 0) { return; }
            for (const w of this.wan) {
                const i = d.interfaces[w.key];
                if (!i) { continue; }
                // per-interval byte counts (traffic_stats.php) -> bits per second, as the core Traffic widget
                w.in_bps = Math.max(0, Math.round((Number(i.inbytes) || 0) / elapsed * 8));
                w.out_bps = Math.max(0, Math.round((Number(i.outbytes) || 0) / elapsed * 8));
            }
            this.updated = Date.now();
        }, () => this._openTraffic());
    }

    async _pollMem() {
        if (!this.active) { return; }
        if (!this._sim.mem) {
            try {
                const d = await this.host.ajaxCall('/api/diagnostics/system/system_resources');
                const m = d && d.memory;
                if (m && m.total_frmt !== undefined) {
                    const used = parseInt(m.used_frmt, 10) || 0, total = parseInt(m.total_frmt, 10) || 0;
                    this.mem.total_mb = total; this.mem.used_mb = used;
                    this.mem.arc_mb = m.arc_frmt !== undefined ? (parseInt(m.arc_frmt, 10) || 0) : 0;
                    this.mem.pct = total > 0 ? Math.round(used / total * 100) : 0;
                    this.updated = Date.now();
                    this._memFails = 0;
                } else { throw new Error('no memory data'); }
            } catch (e) {
                this._memFails = (this._memFails || 0) + 1; this.offline.mem = true;
            }
        }
        if (this.active) { this._memTimer = setTimeout(() => this._pollMem(), 5000); }
    }

    // Policy Analyzer (os-policyanalyzer, optional): feature-detected; a missing endpoint is silent
    async _pollExposure() {
        const e = this.exposure;
        if (!this.active || e.available === false) { return; }
        try {
            const r = await fetch('/api/policyanalyzer/exposure/report', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
            if (r.status === 404 || r.status === 403 || r.status === 401) { e.available = false; return; }
            if (!r.ok) { throw new Error('HTTP ' + r.status); }
            const ct = r.headers.get('content-type') || '';
            if (!ct.includes('json')) { e.available = false; return; }     // e.g. an HTML error/login page
            e.data = await r.json();
            e.available = true; e.updated = Date.now(); e.error = null;
        } catch (err) {
            e.error = String(err && err.message || err);                   // transient: try again later
        }
        if (this.active && e.available !== false) { this._expTimer = setTimeout(() => this._pollExposure(), 300000); }
    }

    // once a second: simulated sources move, histories grow (last 60 values)
    _tick() {
        this._seq++;
        const H = SonarTelemetry.HIST;
        const push = (a, v) => { a.push(v); if (a.length > H) { a.splice(0, a.length - H); } };
        const walk = (v, lo, hi, step) => Math.max(lo, Math.min(hi, v + (Math.random() - 0.5) * step));
        if (this._sim.cpu) {
            const c = this.cpu;
            c.user = walk(c.user || 18, 2, 70, 12); c.sys = walk(c.sys || 6, 1, 25, 5); c.intr = walk(c.intr || 2, 0, 10, 2);
            c.total = Math.min(100, c.user + c.sys + c.intr);
            this.updated = Date.now();
        }
        if (this._sim.mem) {
            const m = this.mem;
            m.total_mb = m.total_mb || 8192; m.arc_mb = m.arc_mb || 1536;
            m.used_mb = Math.round(walk(m.used_mb || 3400, 2048, 7000, 80));
            m.pct = Math.round(m.used_mb / m.total_mb * 100);
            this.updated = Date.now();
        }
        if (this._sim.wan) {
            if (!this.wan.length) { this.wan = [{ key: 'wan', name: 'WAN', in_bps: 42e6, out_bps: 9e6, hist_in: [], hist_out: [] }]; }
            for (const w of this.wan) {
                w.in_bps = Math.round(walk(w.in_bps, 2e6, 180e6, 30e6));
                w.out_bps = Math.round(walk(w.out_bps, 5e5, 60e6, 9e6));
            }
            this.updated = Date.now();
        }
        push(this.cpu.hist, this.cpu.total);
        push(this.mem.hist, this.mem.pct);
        for (const w of this.wan) { push(w.hist_in, w.in_bps); push(w.hist_out, w.out_bps); }
    }
}
