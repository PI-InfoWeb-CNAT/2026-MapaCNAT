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
    snapDistance: 60
};

let geographical = [
    [-5.811105868698768, -35.201445594283136],
    [-5.810082771429163, -35.204026579227964],
    [-5.812708592957059, -35.20497480931187],
]
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

let coordinateTransform = null;

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
let permissionDenied = false;
let started = false;

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

function setOnline(value) {
    if (online === value) return;
    online = value;
    log(value ? "ONLINE" : "OFFLINE");
    Editor.Self.setOnline(value);
}

function onPosition(position) {
    const c = position.coords;
    const acc = c.accuracy;

    if (![c.latitude, c.longitude, acc].every(Number.isFinite)) return;
    
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
    lastDrawn = { x: display.x, y: display.y };

    const [lat, lon] = toLatLon(display.x, display.y);
    const point = coordinateTransform.transform([lat, lon]);
    const coord = Editor.newCoord(point[0], point[1], "normal");
    Editor.Self.setPos(coord);
    
    if (!pinShown) {
        Editor.Self.setVisible(true);
        pinShown = true;
    }
}

function startWatch() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = navigator.geolocation.watchPosition(onPosition, onError, CONFIG.watchOptions);
    log("watch (re)started");
}

function onError(err) {
    console.warn(`ERROR(${err.code}): ${err.message}`);

    if (err.code === err.PERMISSION_DENIED) {
        permissionDenied = true;
        setOnline(false);
    }
}

function watchdogTick() {
    if (permissionDenied) return;

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
    if (permissionDenied) return;
    retryIndex = 0;
    nextRetryAt = 0;
    startWatch();
}

function onVisibilityChange() {
    if (document.visibilityState === "visible") {
        lastFrameTime = performance.now();
        forceReconnect();
    }
}

function watchPermission() {
    if (!navigator.permissions?.query) return;
    navigator.permissions.query({ name: "geolocation" }).then((status) => {
        status.onchange = () => {
            if (status.state !== "denied") {
                permissionDenied = false;
                forceReconnect();
            }
        };
    }).catch(() => { /* Permissions API not available for geolocation here: ignore */ });
}

/////////// Public API

export function UserLocation() {
    if (started) return;

    if (!navigator.geolocation) {
        console.error("Geolocalização não é suportada pelo dispositivo.");
        return;
    }
    started = true;

    coordinateTransform = new MatrixTransform(
        [-5.8544767,-35.2695842],
        [-5.8553004,-35.2699835],
        [-5.8556845,-35.268242],
        // [-5.811105868698768, -35.201445594283136],
        // [-5.810082771429163, -35.204026579227964],
        // [-5.812708592957059, -35.20497480931187],

        [-Graficos.imageSize.width / 2, -Graficos.imageSize.height / 2],
        [-Graficos.imageSize.width / 2, Graficos.imageSize.height / 2],
        [Graficos.imageSize.width / 2, Graficos.imageSize.height / 2]
    );

    lastUsable = performance.now();
    lastFrameTime = performance.now();

    watchPermission();
    startWatch();

    watchdogId = setInterval(watchdogTick, 1000);
    rafId = requestAnimationFrame(frame);

    window.addEventListener("online", forceReconnect);
    document.addEventListener("visibilitychange", onVisibilityChange);
}

export function StopUserLocation() {
    if (!started) return;
    started = false;

    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    clearInterval(watchdogId);
    cancelAnimationFrame(rafId);
    watchId = watchdogId = rafId = null;

    window.removeEventListener("online", forceReconnect);
    document.removeEventListener("visibilitychange", onVisibilityChange);
}