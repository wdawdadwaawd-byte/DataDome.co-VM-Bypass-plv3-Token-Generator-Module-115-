'use strict';
/**
 * DataDome Interstitial Runner
 * node run_interstitial.js '<ddm_json>' '<interstitial_url>' '<js_url>' '<plv3_override>'
 * stdout: JSON { body, url }
 */

const https   = require('https');
const http    = require('http');
const fs      = require('fs');
const vm      = require('vm');
const path    = require('path');
const { URL } = require('url');

const ddmJson  = process.argv[2] || '{}';
const iUrl     = process.argv[3] || '';
const jsUrl    = process.argv[4] || '';

let ddm;
try { ddm = JSON.parse(ddmJson); } catch(e) { ddm = {}; }

// ── Defaults ─────────────────────────────────────────────────
ddm.referer      = ddm.referer      || 'https://www.etsy.com/?utm_source=chatgpt.com';
ddm.url          = ddm.url          || 'https://www.etsy.com/?utm_source=chatgpt.com';
ddm.captchaUrl   = ddm.captchaUrl   || '';
ddm.sdkMsgFormat = ddm.sdkMsgFormat || '';
ddm.xddb         = ddm.xddb         || '1';
ddm.displayEnabled = false;
ddm.durationMs   = typeof ddm.durationMs === 'number' ? ddm.durationMs : 1500;
ddm.dm           = ddm.dm           || 'cd';
ddm.b            = ddm.b            || 2096871;
ddm.s            = ddm.s            || 45225;
ddm.ps           = ddm.ps           || '10504';
ddm.i18n         = { l_device_check_restart_verification_hidden: 'Restart verification of your device' };

// ── JS Download / Cache ───────────────────────────────────────
const JS_CACHE = path.join(__dirname, '_interstitial_cache.js');

function downloadJs(url) {
    return new Promise((resolve, reject) => {
        const u   = new URL(url);
        const mod = url.startsWith('https') ? https : http;
        let data  = '';
        mod.get({
            hostname: u.hostname,
            path: u.pathname + u.search,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
                'Accept-Encoding': 'identity',
            }
        }, res => {
            res.on('data', c => data += c);
            res.on('end', () => { fs.writeFileSync(JS_CACHE, data); resolve(data); });
        }).on('error', reject);
    });
}

(async () => {
    // ── Load JS ───────────────────────────────────────────────
    let js;
    if (jsUrl) {
        try { js = await downloadJs(jsUrl); }
        catch(e) {
            if (fs.existsSync(JS_CACHE)) { js = fs.readFileSync(JS_CACHE, 'utf8'); }
            else { process.stdout.write(JSON.stringify({ error: 'download: ' + e.message }) + '\n'); process.exit(1); }
        }
    } else if (fs.existsSync(JS_CACHE)) {
        js = fs.readFileSync(JS_CACHE, 'utf8');
    } else {
        process.stdout.write(JSON.stringify({ error: 'no JS' }) + '\n'); process.exit(1);
    }

    // ── Node.js Compat Patches ────────────────────────────────
    // 1. Y[-1] → Y[Y.length-1]  (VM result field, negative index = undefined in Node)
    js = js.replace(/W\.u\s*=\s*Y\[-1\]/g, 'W.u = Y[Y.length - 1]');

    // 2. new Function() calls inside VM bytecode need window/document on global scope
    //    We will set them on `global` after sandbox is created.

    // ── Captured POST body ────────────────────────────────────
    let captured = null;
    function tryCapture(url, body) {
        if (!captured) captured = { url, body };
    }

    // ── Mock XHR ──────────────────────────────────────────────
    function MockXHR() {
        this._method = ''; this._url = ''; this._headers = {};
        this.readyState = 0; this.status = 0; this.responseText = '';
        this.onreadystatechange = null; this.onload = null; this.onerror = null;
    }
    MockXHR.prototype.open = function(m, u) { this._method = m; this._url = u; };
    MockXHR.prototype.setRequestHeader = function(k, v) { this._headers[k] = v; };
    MockXHR.prototype.send = function(body) {
        const self = this;
        if (this._method === 'POST') tryCapture(this._url, body);
        setTimeout(() => {
            self.readyState = 4; self.status = 200;
            self.responseText = JSON.stringify({ view: 'captured' });
            if (self.onload)             try { self.onload.call(self); }             catch(e) {}
            if (self.onreadystatechange) try { self.onreadystatechange.call(self); } catch(e) {}
        }, 50);
    };
    MockXHR.prototype.abort = function() {};
    MockXHR.prototype.addEventListener = function(ev, fn) {
        if (ev === 'load')  this.onload  = fn;
        if (ev === 'error') this.onerror = fn;
    };
    MockXHR.prototype.removeEventListener = function() {};

    // ── DOM Element Factory ───────────────────────────────────
    const perfStart = Date.now();
    let domListeners = [];

    function mkEl(tag) {
        tag = (tag || 'div').toString().toLowerCase();
        const el = {
            tagName:       tag.toUpperCase(),
            id:            '',
            className:     '',
            innerHTML:     '',
            innerText:     '',
            textContent:   '',
            value:         '',
            type:          'text',
            offsetWidth:   tag === 'canvas' ? 300 : 120,
            offsetHeight:  tag === 'canvas' ? 150 : 24,
            clientWidth:   tag === 'canvas' ? 300 : 120,
            clientHeight:  tag === 'canvas' ? 150 : 24,
            scrollWidth:   120,
            scrollHeight:  24,
            naturalWidth:  0,
            naturalHeight: 0,
            childNodes:    [],
            children:      [],
            parentNode:    null,
            parentElement: null,
            style: new Proxy({}, {
                get: (t, k) => {
                    if (k === 'cssText') return '';
                    if (k === 'setProperty' || k === 'removeProperty' || k === 'getPropertyValue')
                        return () => '';
                    return t[k] !== undefined ? t[k] : '';
                },
                set: (t, k, v) => { t[k] = v; return true; },
            }),
            dataset:   new Proxy({}, { get: () => '', set: (t,k,v) => { t[k]=v; return true; } }),
            classList: {
                _c: new Set(),
                add:     function(...a) { a.forEach(x => this._c.add(x)); },
                remove:  function(...a) { a.forEach(x => this._c.delete(x)); },
                contains:function(x)   { return this._c.has(x); },
                toggle:  function(x)   { this._c.has(x) ? this._c.delete(x) : this._c.add(x); },
            },
            appendChild:              (c) => c,
            removeChild:              (c) => c,
            insertBefore:             (c) => c,
            replaceChild:             (n) => n,
            cloneNode:                ()  => mkEl(tag),
            getAttribute:             ()  => null,
            setAttribute:             ()  => {},
            removeAttribute:          ()  => {},
            hasAttribute:             ()  => false,
            getBoundingClientRect:    ()  => ({ top:0, left:0, right:120, bottom:24, width:120, height:24, x:0, y:0 }),
            getClientRects:           ()  => [],
            getElementsByTagName:     ()  => [],
            getElementsByClassName:   ()  => [],
            querySelector:            ()  => null,
            querySelectorAll:         ()  => [],
            addEventListener:         ()  => {},
            removeEventListener:      ()  => {},
            dispatchEvent:            ()  => true,
            focus:                    ()  => {},
            blur:                     ()  => {},
            click:                    ()  => {},
            getContext: (ctxType) => {
                if (ctxType === '2d') {
                    const ctx2d = {
                        canvas:          el,
                        font:            '10px sans-serif',
                        fillStyle:       '#000',
                        strokeStyle:     '#000',
                        globalAlpha:     1,
                        lineWidth:       1,
                        shadowBlur:      0,
                        shadowColor:     '',
                        shadowOffsetX:   0,
                        shadowOffsetY:   0,
                        textBaseline:    'alphabetic',
                        textAlign:       'start',
                        save:            () => {},
                        restore:         () => {},
                        scale:           () => {},
                        rotate:          () => {},
                        translate:       () => {},
                        transform:       () => {},
                        setTransform:    () => {},
                        clearRect:       () => {},
                        fillRect:        () => {},
                        strokeRect:      () => {},
                        beginPath:       () => {},
                        closePath:       () => {},
                        moveTo:          () => {},
                        lineTo:          () => {},
                        arc:             () => {},
                        arcTo:           () => {},
                        quadraticCurveTo:() => {},
                        bezierCurveTo:   () => {},
                        stroke:          () => {},
                        fill:            () => {},
                        clip:            () => {},
                        isPointInPath:   () => false,
                        drawImage:       () => {},
                        createLinearGradient: () => ({ addColorStop: () => {} }),
                        createRadialGradient: () => ({ addColorStop: () => {} }),
                        createPattern:        () => ({}),
                        getImageData: (x, y, w, h) => ({
                            data:   new Uint8ClampedArray((w || 1) * (h || 1) * 4),
                            width:  w || 1,
                            height: h || 1,
                        }),
                        putImageData:    () => {},
                        measureText:     (t) => ({
                            width: (t ? t.length : 0) * 7,
                            actualBoundingBoxAscent: 10,
                            actualBoundingBoxDescent: 2,
                        }),
                        fillText:        () => {},
                        strokeText:      () => {},
                        setLineDash:     () => {},
                        getLineDash:     () => [],
                    };
                    return ctx2d;
                }
                // WebGL
                return {
                    getParameter:          (p) => {
                        if (p === 7936) return 'Google Inc. (NVIDIA)';
                        if (p === 7937) return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)';
                        if (p === 3379) return 16384;
                        if (p === 34076) return 16384;
                        return '';
                    },
                    getExtension:          () => null,
                    getSupportedExtensions:() => [],
                    createBuffer:          () => ({}),
                    createShader:          () => ({}),
                    createProgram:         () => ({}),
                    bindBuffer:            () => {},
                    bufferData:            () => {},
                    viewport:              () => {},
                    enable:                () => {},
                    disable:               () => {},
                    depthFunc:             () => {},
                    blendFunc:             () => {},
                    shaderSource:          () => {},
                    compileShader:         () => {},
                    attachShader:          () => {},
                    linkProgram:           () => {},
                    useProgram:            () => {},
                    getAttribLocation:     () => 0,
                    getUniformLocation:    () => ({}),
                    uniform1i:             () => {},
                    uniformMatrix4fv:      () => {},
                    drawArrays:            () => {},
                    clear:                 () => {},
                    clearColor:            () => {},
                    canvas:                el,
                };
            },
            toDataURL: () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            toBlob:    (cb) => cb && cb(null),
        };
        return el;
    }

    // ── Sandbox Object ────────────────────────────────────────
    const mockNav = {
        userAgent:           'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        appVersion:          '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        platform:            'Win32',
        vendor:              'Google Inc.',
        language:            'tr-TR',
        languages:           ['tr-TR','tr','en-US','en'],
        hardwareConcurrency: 8,
        maxTouchPoints:      0,
        deviceMemory:        8,
        cookieEnabled:       true,
        doNotTrack:          null,
        webdriver:           false,
        pdfViewerEnabled:    true,
        onLine:              true,
        javaEnabled:         () => false,
        getGamepads:         () => [],
        plugins:             { length: 3, item: () => null, namedItem: () => null },
        mimeTypes:           { length: 2 },
        mediaCapabilities:   { decodingInfo: () => Promise.resolve({ supported: true, smooth: true, powerEfficient: true }) },
        permissions:         { query: () => Promise.resolve({ state: 'granted' }) },
        connection:          { downlink: 10, rtt: 100, effectiveType: '4g', saveData: false, addEventListener: () => {} },
    };

    const mockDoc = {
        cookie:            '',
        referrer:          '',
        readyState:        'complete',
        visibilityState:   'visible',
        hidden:            false,
        title:             'Device check',
        URL:               iUrl || 'https://geo.captcha-delivery.com/interstitial/',
        documentElement:   mkEl('html'),
        head:              mkEl('head'),
        body:              mkEl('body'),
        createElement:     (t) => mkEl(t),
        createElementNS:   (_ns, t) => mkEl(t),
        createTextNode:    (t) => ({ textContent: t, nodeType: 3 }),
        createDocumentFragment: () => mkEl('div'),
        getElementById:    (id) => {
            if (id === 'device-check__ok')      return mkEl('div');
            if (id === 'device-check__ko')      return mkEl('div');
            if (id === 'device-check__loading') return mkEl('div');
            return mkEl('div');
        },
        querySelector:     (sel) => {
            if (sel && sel.includes('dd-page-size'))
                return { getAttribute: (a) => a === 'content' ? (ddm.ps || '10504') : null };
            if (sel && (sel.includes('dd-response-page') || sel.includes('device-check')))
                return mkEl('div');
            return mkEl('div');
        },
        querySelectorAll:  () => [],
        getElementsByTagName:   () => [],
        getElementsByClassName: () => [],
        addEventListener:  (ev, fn, _cap) => {
            if (ev === 'DOMContentLoaded') domListeners.push(fn);
        },
        removeEventListener: () => {},
        dispatchEvent:     () => true,
        hasFocus:          () => true,
        getSelection:      () => null,
        execCommand:       () => false,
    };

    const sandbox = {
        // JS builtins
        Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array,
        Float32Array, Float64Array, Uint8ClampedArray,
        ArrayBuffer, DataView,
        Math, Date, JSON, parseInt, parseFloat, isNaN, isFinite,
        Object, Array, String, Number, Boolean, Function, RegExp,
        Map, Set, WeakMap, WeakSet, Promise, Proxy, Reflect, Symbol,
        Error, TypeError, RangeError, SyntaxError, ReferenceError, EvalError, URIError,
        encodeURIComponent, decodeURIComponent, encodeURI, decodeURI,
        BigInt: typeof BigInt !== 'undefined' ? BigInt : undefined,
        WebAssembly: typeof WebAssembly !== 'undefined' ? WebAssembly : undefined,
        // atob/btoa
        atob: (s) => Buffer.from(s.replace(/\s/g, ''), 'base64').toString('binary'),
        btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
        // Timers
        setTimeout, clearTimeout, setInterval, clearInterval,
        // Browser-specific
        performance: { now: () => Date.now() - perfStart, timeOrigin: perfStart },
        navigator:   mockNav,
        screen:      { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, colorDepth: 24, pixelDepth: 24, orientation: { type: 'landscape-primary', angle: 0 } },
        location:    { href: iUrl || 'https://geo.captcha-delivery.com/interstitial/', hostname: 'geo.captcha-delivery.com', origin: 'https://geo.captcha-delivery.com', protocol: 'https:', pathname: '/interstitial/', search: '', hash: '' },
        history:     { length: 1, back: () => {}, forward: () => {}, go: () => {}, pushState: () => {}, replaceState: () => {} },
        document:    mockDoc,
        // Dimensions
        innerWidth: 1920, innerHeight: 1080, outerWidth: 1920, outerHeight: 1040,
        screenX: 0, screenY: 0, screenLeft: 0, screenTop: 0, devicePixelRatio: 1,
        pageXOffset: 0, pageYOffset: 0,
        scrollX: 0, scrollY: 0,
        // Events
        addEventListener:    () => {},
        removeEventListener: () => {},
        dispatchEvent:       () => true,
        // DataDome
        ddm: ddm,
        // XHR
        XMLHttpRequest: MockXHR,
        // Crypto
        crypto: {
            getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 256) | 0; return a; },
            subtle: {
                digest: async (alg, data) => {
                    const crypto = require('crypto');
                    const name = (typeof alg === 'string' ? alg : alg.name || 'SHA-256').replace('-', '').toLowerCase();
                    const map = { sha256: 'sha256', sha1: 'sha1', sha512: 'sha512' };
                    const h = crypto.createHash(map[name] || 'sha256');
                    h.update(data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(data.buffer || data));
                    const digest = h.digest();
                    return digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength);
                },
            },
        },
        // Misc
        console:          { log:()=>{}, warn:()=>{}, error:console.error.bind(console), debug:()=>{}, info:()=>{}, group:()=>{}, groupEnd:()=>{}, time:()=>{}, timeEnd:()=>{} },
        getComputedStyle: (el) => ({
            getPropertyValue: () => '',
            setProperty:      () => {},
            cssText:          '',
            font:             '14px serif',
            fontSize:         '14px',
        }),
        requestAnimationFrame:  (fn) => { setTimeout(() => fn(Date.now() - perfStart), 16); return 1; },
        cancelAnimationFrame:   () => {},
        queueMicrotask:         (fn) => Promise.resolve().then(() => { try { fn(); } catch(e) {} }),
        URL:                    URL,
        URLSearchParams:        URLSearchParams,
        TextEncoder:            TextEncoder,
        TextDecoder:            TextDecoder,
        // DataDome interstitial
        interstitialCallback:   null,
        interstitialChallenge:  null,
        parent:                 { postMessage: () => {} },
        top:                    null,
        // Not present in iframe
        android:                undefined,
        webkit:                 undefined,
        // Tracking
        _ddst:  undefined,
        _ddem:  undefined,
    };
    sandbox.window     = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.self       = sandbox;
    sandbox.top        = sandbox;
    sandbox.parent     = sandbox;

    // ── Expose on Node global (for new Function() inside VM bytecode) ────────
    // DataDome's VM bytecode calls `new Function('...')` which runs in Node global scope,
    // not in vm.createContext. Those functions need window/document/ddm available.
    const nodePatch = { window: sandbox, document: mockDoc, navigator: mockNav, ddm, location: sandbox.location, screen: sandbox.screen, performance: sandbox.performance, getComputedStyle: sandbox.getComputedStyle };
    for (const [k, v] of Object.entries(nodePatch)) {
        try { Object.defineProperty(global, k, { value: v, configurable: true, writable: true }); } catch(e) {}
    }

    // ── interstitialCallback (matches HTML page implementation) ─────────────
    sandbox.interstitialCallback = function(payload, cb) {
        let body = 'cid='     + encodeURIComponent(ddm.cid  || '')
            + '&hash='        + encodeURIComponent(ddm.hash || ddm.hsh || '')
            + '&referer='     + encodeURIComponent(ddm.referer)
            + '&url='         + encodeURIComponent(ddm.url)
            + '&s='           + (ddm.s || '')
            + '&e='           + encodeURIComponent(ddm.e    || '')
            + '&env='         + encodeURIComponent(ddm.env  || '')
            + '&userEnv='     + encodeURIComponent(ddm.userEnv || '')
            + '&seed='        + encodeURIComponent(ddm.seed || '')
            + '&b='           + (ddm.b || '')
            + '&dm='          + encodeURIComponent(ddm.dm   || 'cd')
            + '&ddMessageFormat=' + encodeURIComponent(ddm.sdkMsgFormat || '');

        if (typeof payload === 'string') {
            body += '&payload=' + encodeURIComponent(payload);
        } else if (payload && typeof payload === 'object') {
            if (payload.plv2 !== undefined) body += '&payload=' + encodeURIComponent(payload.plv2);
            if (payload.plv3 !== undefined) body += '&plv3='    + encodeURIComponent(payload.plv3);
        }
        body += '&ps=' + encodeURIComponent(ddm.ps || '10504');

        if (cb) {
            const xhr = new MockXHR();
            xhr.open('POST', '/interstitial/');
            cb(xhr, body, function() {});
        } else {
            tryCapture('/interstitial/', body);
        }
    };

    // ── Run interstitial.js in vm.Script context ─────────────────────────────
    const ctx = vm.createContext(sandbox);
    try {
        new vm.Script(js, { filename: 'interstitial.js' }).runInContext(ctx, { timeout: 15000 });
    } catch(e) {
        process.stderr.write('exec err: ' + e.message + '\n');
        process.stdout.write(JSON.stringify({ error: 'exec: ' + e.message }) + '\n');
        process.exit(1);
    }

    // ── Trigger DOMContentLoaded then sendPayload ─────────────────────────────
    setTimeout(() => { domListeners.forEach(fn => { try { fn(); } catch(e) {} }); }, 100);

    setTimeout(() => {
        try {
            if (sandbox.interstitialChallenge) {
                const ch = sandbox.interstitialChallenge();
                if (ch && typeof ch.sendPayload === 'function') {
                    process.stderr.write('sendPayload() called\n');
                    ch.sendPayload();
                }
            }
        } catch(e) {
            process.stderr.write('challenge err: ' + e.message + '\n');
        }
    }, 300);

    // ── Wait for POST capture ─────────────────────────────────────────────────
    const deadline = Date.now() + 15000;
    await new Promise(resolve => {
        const t = setInterval(() => {
            if (captured || Date.now() > deadline) { clearInterval(t); resolve(); }
        }, 200);
    });

    if (!captured) {
        process.stdout.write(JSON.stringify({ error: 'no POST captured' }) + '\n');
        process.exit(1);
    }

    process.stdout.write(JSON.stringify(captured) + '\n');
    process.exit(0);
})();
