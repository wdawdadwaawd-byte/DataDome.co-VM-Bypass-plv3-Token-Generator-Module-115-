'use strict';
/**
 * DataDome VM Runner
 * node run_vm.js <userEnv>
 * stdout: JSON { u, i, t }
 */

const fs     = require('fs');
const path   = require('path');
const vmMod  = require('vm');

const userEnv = process.argv[2] || 'yes';

// ── Bytecode ──────────────────────────────────────────────────
const bytecodeB64 = fs.readFileSync(
    path.join(__dirname, 'bytecode.bin'), 'ascii'
).trim();

// ── VM source — sadece vm fonksiyonunu al, son 4 satırı biz yazacağız ───
let rawSrc = fs.readFileSync(
    path.join(__dirname, 'vm_labeled.js'), 'utf8'
);

// '<BYTECODE>' placeholder'ını yerleştir
rawSrc = rawSrc.replace("'<BYTECODE>'", JSON.stringify(bytecodeB64));

// Son 4 satırı (window.ddm, const exports, vm(), console.log) sil
// Bunları sandbox içinde kendimiz kontrol edeceğiz
rawSrc = rawSrc.replace(
    /window\.ddm\s*=\s*\{[^}]*\};\s*const exports\s*=\s*\{\};\s*vm\(null,\s*exports,\s*null\);\s*console\.log\(exports\.exports\(\)\);?\s*$/,
    ''
);

// ── Sandbox ───────────────────────────────────────────────────
const perfStart = Date.now();
let capturedResult = null;

const sandbox = {
    // ─ JS builtins ─
    Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array,
    Float32Array, Float64Array, Uint8ClampedArray,
    ArrayBuffer, DataView,
    Math, Date, JSON, parseInt, parseFloat, isNaN, isFinite,
    Object, Array, String, Number, Boolean, Function, RegExp,
    Map, Set, WeakMap, WeakSet, Promise, Proxy, Reflect, Symbol,
    Error, TypeError, RangeError, SyntaxError, ReferenceError, EvalError,
    decodeURIComponent, encodeURIComponent, decodeURI, encodeURI,
    // ─ Browser API mocks ─
    performance: { now: () => Date.now() - perfStart },
    navigator: {
        userAgent:           'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        platform:            'Win32',
        hardwareConcurrency: 8,
        language:            'en-US',
        languages:           ['en-US', 'en'],
        maxTouchPoints:      0,
        deviceMemory:        8,
        vendor:              'Google Inc.',
        webdriver:           false,
    },
    screen:   { width: 1920, height: 1080, colorDepth: 24, pixelDepth: 24, availWidth: 1920, availHeight: 1040 },
    innerWidth: 1904, innerHeight: 969,
    outerWidth: 1920, outerHeight: 1040,
    devicePixelRatio: 1,
    location: {
        href:     'https://www.etsy.com/',
        hostname: 'www.etsy.com',
        protocol: 'https:',
        pathname: '/',
        search:   '',
        hash:     '',
    },
    document: {
        cookie:         '',
        referrer:       '',
        createElement:  (tag) => ({ style: {}, tagName: tag.toUpperCase() }),
        getElementById: () => null,
        querySelector:  () => null,
    },
    crypto: {
        getRandomValues: (a) => {
            for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 256) | 0;
            return a;
        }
    },
    // atob / btoa — VM bytecode decode için kritik
    atob: (s) => Buffer.from(s.replace(/\s/g, ''), 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    console: {
        log:   (...a) => {},
        warn:  (...a) => {},
        error: (...a) => {},
        debug: (...a) => {},
    },
    setTimeout:   (fn) => { try { fn(); } catch (e) {} return 0; },
    clearTimeout: () => {},
    // DataDome ddm objesi — userEnv buradan okunuyor
    ddm: { userEnv },
};
sandbox.window = sandbox; // window.window === window

// ── vm.Script ile çalıştır ────────────────────────────────────
const ctx = vmMod.createContext(sandbox);

try {
    new vmMod.Script(rawSrc, { filename: 'vm_labeled.js' }).runInContext(ctx, { timeout: 10000 });

    new vmMod.Script('var exports_dd = {};', { filename: 'setup' }).runInContext(ctx);

    new vmMod.Script('vm(null, exports_dd, null);', { filename: 'vmcall' }).runInContext(ctx, { timeout: 10000 });

    const resultScript = new vmMod.Script('exports_dd.exports()', { filename: 'result' });
    capturedResult = resultScript.runInContext(ctx, { timeout: 10000 });

} catch (err) {
    process.stderr.write('VM ERROR: ' + err.message + '\n');
    process.stdout.write(JSON.stringify({ error: err.message }) + '\n');
    process.exit(1);
}

if (!capturedResult) {
    process.stderr.write('no result\n');
    process.stdout.write(JSON.stringify({ error: 'no result' }) + '\n');
    process.exit(1);
}

process.stdout.write(JSON.stringify(capturedResult) + '\n');
process.exit(0);
