import { MatrixTransform } from "./transformacao.js";
import * as Graficos from "./graficos.js";
import * as Editor from "./editor.js";

const CONFIG = {
    debug: false,

    watchOptions: { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },

    offlineAfterMs: 12000,
    retryDelaysMs: [1000, 2000, 4000, 8000, 15000],

    maxAccuracy: 150,
    minAccuracy: 3,
    maxSpeed: 12,
    gateSigmas: 3.5,
    gateFloor: 8,

    confirmCount: 3,
    confirmMs: 6000,
    candidateWalkSpeed: 3,

    accelSigma: 1.5,

    smoothingTau: 0.35,
    extrapolateMinSpeed: 0.7,
    extrapolateMaxMs: 2500,
    snapDistance: 60,

    requestTimeoutMs: 15000,   // how long the permission prompt / first read may take
    fixWaitMs: 8000,           // after a poor first read, how long to wait for a usable one
    storageKey: "geo-granted"  // hint for browsers without the Permissions API
};

let geographical = [
    [-5.811105868698768, -35.201445594283136],
    [-5.810082771429163, -35.204026579227964],
    [-5.812708592957059, -35.20497480931187],
];
export function mapToGeographical(point) {
    let coordinateTransform = new MatrixTransform(
        [-Graficos.imageSize.width / 2, -Graficos.imageSize.height / 2],
        [-Graficos.imageSize.width / 2, Graficos.imageSize.height / 2],
        [Graficos.imageSize.width / 2, Graficos.imageSize.height / 2],
        geographical[0], geographical[1], geographical[2],
    );

    return coordinateTransform.transform([point.x, point.y]);
}
export function GeographicalToMap(point) {
    let coordinateTransform = new MatrixTransform(
        geographical[0], geographical[1], geographical[2],
        [-Graficos.imageSize.width / 2, -Graficos.imageSize.height / 2],
        [-Graficos.imageSize.width / 2, Graficos.imageSize.height / 2],
        [Graficos.imageSize.width / 2, Graficos.imageSize.height / 2],
    );

    return coordinateTransform.transform([point.x, point.y]);
}

const log = (...args) => { if (CONFIG.debug) console.debug("[geo]", ...args); };

class Axis {
    constructor() { this.reset(0, 100); }

    reset(position, variance, velocityVariance = 25) {
        this.p = position;
        this.v = 0;
        this.p00 = variance;
        this.p01 = 0;
        this.p11 = velocityVariance;
    }

    predict(dt, accelVar) {
        this.p += this.v * dt;
        this.p00 += dt * (2 * this.p01 + dt * this.p11) + accelVar * dt ** 4 / 4;
        this.p01 += dt * this.p11 + accelVar * dt ** 3 / 2;
        this.p11 += accelVar * dt ** 2;
    }

    update(z, r) {
        const s = this.p00 + r;
        const k0 = this.p00 / s;
        const k1 = this.p01 / s;
        const y = z - this.p;
        this.p += k0 * y;
        this.v += k1 * y;
        this.p11 -= k1 * this.p01;
        this.p00 *= (1 - k0);
        this.p01 *= (1 - k0);
    }
}

/* ───────────── state ───────────── */

let latLonToMap = null;

const track = {
    ready: false,
    x: new Axis(),
    y: new Axis(),
    t: 0,
    arrival: 0
};

let origin = null;
let candidates = [];
const display = { x: 0, y: 0 };
let lastDrawn = { x: Infinity, y: Infinity };
let pinShown = false;

let watchId = null;
let watchdogId = null;
let rafId = null;
let lastFrameTime = 0;
let lastUsable = 0;
let online = null;
let retryIndex = 0;
let nextRetryAt = 0;
let started = false;

// "unknown" | "prompt" | "granted" | "denied" | "unsupported"
let permission = "unknown";
let permissionQuery = null;   // promise of the PermissionStatus
let permissionApiOk = false;  // true once the Permissions API answered for geolocation
const permissionListeners = new Set();
const fixWaiters = new Set();
let pendingRequest = null;

/* ───────────── helpers ───────────── */

function ensureTransform() {
    latLonToMap ??= new MatrixTransform(
        geographical[0], geographical[1], geographical[2],
        [-Graficos.imageSize.width / 2, -Graficos.imageSize.height / 2],
        [-Graficos.imageSize.width / 2, Graficos.imageSize.height / 2],
        [Graficos.imageSize.width / 2, Graficos.imageSize.height / 2]
    );
    return latLonToMap;
}

function makeOrigin(lat, lon) {
    return {
        lat, lon,
        mPerDegLat: 111320,
        mPerDegLon: 111320 * Math.cos(lat * Math.PI / 180)
    };
}

const toLocal = (lat, lon) => [
    (lon - origin.lon) * origin.mPerDegLon,
    (lat - origin.lat) * origin.mPerDegLat
];

const toLatLon = (x, y) => [
    origin.lat + y / origin.mPerDegLat,
    origin.lon + x / origin.mPerDegLon
];

function remembered() {
    try { return localStorage.getItem(CONFIG.storageKey) === "1"; } catch { return false; }
}
function remember(value) {
    try {
        if (value) localStorage.setItem(CONFIG.storageKey, "1");
        else localStorage.removeItem(CONFIG.storageKey);
    } catch { /* storage unavailable */ }
}

function setOnline(value) {
    if (online === value) return;
    if (!Editor.Self) return;          // not created yet: the watchdog retries every second
    online = value;
    log(value ? "ONLINE" : "OFFLINE");
    Editor.Self.setOnline(value);
}

function resetTrack() {
    track.ready = false;
    candidates = [];
    origin = null;
    lastDrawn = { x: Infinity, y: Infinity };
}

function draw() {
    const transform = ensureTransform();
    if (!Editor.Self) return;

    lastDrawn = { x: display.x, y: display.y };

    const [lat, lon] = toLatLon(display.x, display.y);
    const point = transform.transform([lat, lon]);
    Editor.Self.setPos(Editor.newCoord(point[0], point[1], "normal"));

    if (!pinShown) {
        Editor.Self.setVisible(true);
        pinShown = true;
    }
}

/* ───────────── permission ───────────── */

function setPermission(next) {
    if (permission === next) return;
    permission = next;
    log("permission:", next);

    if (next === "granted") {
        remember(true);
        lastUsable = performance.now();
        ensureWatch();
    } else {
        remember(false);
        stopWatch();
        resetTrack();
        setOnline(false);          // location not enabled → never online
    }

    for (const cb of permissionListeners) {
        try { cb(next); } catch (error) { console.error(error); }
    }
}

async function refreshPermission() {
    if (!navigator.geolocation) {
        setPermission("unsupported");
        return permission;
    }
    if (!navigator.permissions?.query) return permission;

    permissionQuery ??= navigator.permissions
        .query({ name: "geolocation" })
        .then((status) => {
            status.addEventListener("change", () => setPermission(status.state));
            return status;
        });

    try {
        const status = await permissionQuery;
        permissionApiOk = true;
        setPermission(status.state);
    } catch {
        permissionQuery = null;    // e.g. older Safari: fall back to inference
    }
    return permission;
}

// The browser said "denied" on a read. What does that really mean?
async function classifyDenied() {
    const state = await refreshPermission();
    if (!permissionApiOk) {
        setPermission("denied");
        return "denied";
    }
    if (state === "prompt") return "dismissed";    // prompt closed without choosing
    if (state === "granted") return "unavailable"; // OS-level location services off
    return "denied";
}

/* ───────────── position pipeline ───────────── */

function onPosition(position) {
    const c = position.coords;
    const acc = c.accuracy;

    if (![c.latitude, c.longitude, acc].every(Number.isFinite)) return;

    if (permission !== "granted") setPermission("granted");   // a fix proves it

    if (acc > CONFIG.maxAccuracy) {
        log("discarded, accuracy too poor:", acc);
        return;
    }

    lastUsable = performance.now();
    retryIndex = 0;
    setOnline(true);

    const t = position.timestamp;
    const r = Math.max(acc, CONFIG.minAccuracy) ** 2;

    if (!track.ready) {
        origin = makeOrigin(c.latitude, c.longitude);
        track.x.reset(0, r);
        track.y.reset(0, r);
        display.x = 0;
        display.y = 0;
        track.t = t;
        track.arrival = performance.now();
        track.ready = true;

        draw();                                    // pin is placed before anyone awaits it
        for (const done of [...fixWaiters]) done();
        return;
    }

    if (t <= track.t) return;

    const dt = Math.min(Math.max((t - track.t) / 1000, 0.05), 60);
    const [mx, my] = toLocal(c.latitude, c.longitude);

    const accelVar = CONFIG.accelSigma ** 2;
    track.x.predict(dt, accelVar);
    track.y.predict(dt, accelVar);
    track.t = t;

    const dx = mx - track.x.p;
    const dy = my - track.y.p;
    const dist = Math.hypot(dx, dy);

    const sigma = Math.sqrt(Math.max(track.x.p00, track.y.p00) + r);
    const gate = Math.max(CONFIG.gateSigmas * sigma, CONFIG.gateFloor);
    const impliedSpeed = Math.max(0, dist - acc) / dt;

    const plausible = dist <= gate && impliedSpeed <= CONFIG.maxSpeed;

    if (plausible) {
        candidates = [];
        track.x.update(mx, r);
        track.y.update(my, r);
        track.arrival = performance.now();
    } else {
        log(`outlier: ${dist.toFixed(1)}m off (gate ${gate.toFixed(1)}m, ${impliedSpeed.toFixed(1)} m/s)`);
        handleOutlier(mx, my, acc, t);
    }
}

function handleOutlier(mx, my, acc, t) {
    const last = candidates[candidates.length - 1];

    if (last) {
        const apart = Math.hypot(mx - last.x, my - last.y);
        const gap = (t - last.t) / 1000;
        const tolerance = 2 * Math.max(acc, last.acc, 5) + CONFIG.candidateWalkSpeed * gap;
        if (apart > tolerance) candidates = [];
    }

    candidates.push({ x: mx, y: my, acc, t });

    const spanMs = t - candidates[0].t;
    const confirmed =
        candidates.length >= CONFIG.confirmCount ||
        (candidates.length >= 2 && spanMs >= CONFIG.confirmMs);

    if (confirmed) relocate();
}

function relocate() {
    let wx = 0, wy = 0, wSum = 0, bestAcc = Infinity;
    for (const c of candidates) {
        const w = 1 / Math.max(c.acc, CONFIG.minAccuracy) ** 2;
        wx += c.x * w;
        wy += c.y * w;
        wSum += w;
        bestAcc = Math.min(bestAcc, c.acc);
    }
    const nx = wx / wSum;
    const ny = wy / wSum;
    const r = Math.max(bestAcc, CONFIG.minAccuracy) ** 2;

    log(`relocating by ${Math.hypot(nx - track.x.p, ny - track.y.p).toFixed(1)}m after ${candidates.length} consistent fixes`);

    track.x.reset(nx, r);
    track.y.reset(ny, r);
    track.arrival = performance.now();

    if (Math.hypot(nx - display.x, ny - display.y) > CONFIG.snapDistance) {
        display.x = nx;
        display.y = ny;
    }
    candidates = [];
}

function frame(now) {
    rafId = requestAnimationFrame(frame);
    if (!track.ready) return;

    const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
    lastFrameTime = now;

    const speed = Math.hypot(track.x.v, track.y.v);
    let ahead = 0;
    if (online && speed >= CONFIG.extrapolateMinSpeed) {
        ahead = Math.min(now - track.arrival, CONFIG.extrapolateMaxMs) / 1000;
    }
    const targetX = track.x.p + track.x.v * ahead;
    const targetY = track.y.p + track.y.v * ahead;

    const k = 1 - Math.exp(-dt / CONFIG.smoothingTau);
    display.x += (targetX - display.x) * k;
    display.y += (targetY - display.y) * k;

    if (Math.abs(display.x - lastDrawn.x) < 0.02 && Math.abs(display.y - lastDrawn.y) < 0.02) return;
    draw();
}

/* ───────────── watch / watchdog ───────────── */

function startWatch() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = navigator.geolocation.watchPosition(onPosition, onError, CONFIG.watchOptions);
    log("watch (re)started");
}

function ensureWatch() {
    if (watchId === null) startWatch();
}

function stopWatch() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
}

async function onError(err) {
    console.warn(`ERROR(${err.code}): ${err.message}`);
    if (err.code !== err.PERMISSION_DENIED) return;

    // With the Permissions API still saying "granted" this is OS-level or transient:
    // keep the permission and let the watchdog retry with backoff.
    const state = await refreshPermission();
    if (permissionApiOk && state === "granted") return;
    setPermission("denied");
}

function watchdogTick() {
    if (permission !== "granted") {
        setOnline(false);
        return;
    }

    const now = performance.now();
    const silence = now - lastUsable;

    if (silence > CONFIG.offlineAfterMs) {
        if (online !== false) setOnline(false);

        if (now >= nextRetryAt) {
            const delays = CONFIG.retryDelaysMs;
            nextRetryAt = now + delays[Math.min(retryIndex, delays.length - 1)];
            retryIndex++;
            startWatch();
        }
    }
}

function forceReconnect() {
    if (permission !== "granted") return;
    retryIndex = 0;
    nextRetryAt = 0;
    startWatch();
}

function onVisibilityChange() {
    if (document.visibilityState !== "visible") return;
    lastFrameTime = performance.now();
    refreshPermission().then(forceReconnect);
}

function waitForFix(ms) {
    return new Promise((resolve) => {
        const done = () => {
            clearTimeout(timer);
            fixWaiters.delete(done);
            resolve(track.ready);
        };
        const timer = setTimeout(done, ms);
        fixWaiters.add(done);
    });
}

async function doRequest() {
    if (!navigator.geolocation) return "unsupported";

    UserLocation();                               // idempotent
    const state = await refreshPermission();

    if (state === "denied") return "denied";
    if (state === "granted" && track.ready && online) return "granted";

    return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                setPermission("granted");
                onPosition(position);
                const ok = track.ready || await waitForFix(CONFIG.fixWaitMs);
                resolve(ok ? "granted" : "unavailable");
            },
            async (err) => {
                if (err.code === err.PERMISSION_DENIED) resolve(await classifyDenied());
                else resolve(err.code === err.TIMEOUT ? "timeout" : "unavailable");
            },
            { enableHighAccuracy: true, timeout: CONFIG.requestTimeoutMs, maximumAge: 0 }
        );
    });
}

/* ───────────── public API ───────────── */

/** Starts the engine. Never prompts: it only tracks if permission is already granted. */
export function UserLocation() {
    if (started) return;

    if (!navigator.geolocation) {
        console.error("Geolocalização não é suportada pelo dispositivo.");
        setPermission("unsupported");
        return;
    }
    started = true;

    ensureTransform();
    lastUsable = performance.now();
    lastFrameTime = performance.now();

    watchdogId = setInterval(watchdogTick, 1000);
    rafId = requestAnimationFrame(frame);

    window.addEventListener("online", forceReconnect);
    document.addEventListener("visibilitychange", onVisibilityChange);

    setOnline(false);                              // offline until a usable fix arrives
    refreshPermission().then((state) => {
        // browsers without the Permissions API: trust the last known grant
        if (state === "unknown" && remembered()) setPermission("granted");
    });
}

export function StopUserLocation() {
    if (!started) return;
    started = false;

    stopWatch();
    clearInterval(watchdogId);
    cancelAnimationFrame(rafId);
    watchdogId = rafId = null;

    window.removeEventListener("online", forceReconnect);
    document.removeEventListener("visibilitychange", onVisibilityChange);
}

/**
 * Asks for the location if it isn't granted yet (this is what shows the browser prompt).
 * Resolves with "granted" | "denied" | "dismissed" | "unavailable" | "timeout" | "unsupported".
 * On "granted" the user pin already has a position.
 */
export function requestLocation() {
    pendingRequest ??= doRequest().finally(() => { pendingRequest = null; });
    return pendingRequest;
}

/** Current permission, re-checked: "granted" | "prompt" | "denied" | "unknown" | "unsupported". */
export function getPermission() {
    return refreshPermission();
}

export const isTracking = () => permission === "granted" && online === true;

/** cb(state) on every permission change. Returns an unsubscribe function. */
export function onPermissionChange(cb) {
    permissionListeners.add(cb);
    return () => permissionListeners.delete(cb);
}