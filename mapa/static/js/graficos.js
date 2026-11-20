import * as Transformacao from "./transformacao.js";
import * as Editor from "./editor.js";
import { SvgTileEngine } from "./map-tiling.js";

/* ============================================================================
 *  Tunables
 * ========================================================================== */
const RENDER_ON_DEMAND = true;   // true: só renderiza quando algo mudou (0% CPU parado)
const SETTLE_FRAMES = 20;        // frames extras renderizados depois do último pedido (cobre texturas assíncronas)
const CULLING = true;            // pula objetos fora da tela (setar false se algo "sumir")
const MAX_RESOLUTION = 2;        // limita devicePixelRatio (antialias em 3x/4x é caro)
const ZOOM_TOLERANCE = 0.15;     // polígonos só são re-traçados se o zoom mudou mais que isso...
const ZOOM_SETTLE_MS = 120;      // ...ou quando o zoom parar por este tempo
const DOT_STROKE = 4;            // espessura (px de tela) da borda dos pontos

let tiles;

export let map;
export let mapContainer;
let textContainer;
let referenceContainer;
let connectionContainer;
let areasContainer;
let pinContainer;
export let snapGuideContainer;
let app;
let compassButton;

let avatarSize = 20;

export let tempConnection;
export let tempReference;

let page;

let color;
let textColor;
let mapImagePath;
let pinImagePath;
let userImagePath;
let entranceImagePath;

let entranceTexture;

let temporaryPin;
let pinoSprite;
let userTexture;
let gl;

export let minZoom, maxZoom;
let zoomStep;

export let smoothTransform = false;
let animTask = null;

export let zoom = 1;
export let scaleFactor = 1;

export let imageSize;

export let groups;

const origin = { x: 0, y: 0 };

/** Posição do canvas na janela (para converter clientX/Y <-> coordenadas do canvas). */
export function canvasOrigin() {
    return origin;
}

function syncOrigin() {
    const r = app.canvas.getBoundingClientRect();
    origin.x = r.left;
    origin.y = r.top;
}

/* ============================================================================
 *  Scheduler: tarefas por frame + fila de "sujos" + render sob demanda
 *
 *  - render*()  guarda os dados mais recentes no objeto e o marca como sujo
 *  - no próximo frame: tarefas (animações) -> desenha os sujos (1x cada) -> render
 *  - o loop morre sozinho quando nada mudou (RENDER_ON_DEMAND)
 * ========================================================================== */
const dirty = new Set();          // Graphics com redesenho pendente
const zoomGfx = new Set();        // Graphics cuja geometria depende do zoom (polígonos, rota)
const tasks = new Set();          // fn(now) executadas no início de cada frame
let frameQueued = false;
let framesLeft = 0;
let zoomPass = false;             // true enquanto Zoom() roda
let settleTimer = 0;

function schedule() {
    if (frameQueued) return;
    frameQueued = true;
    requestAnimationFrame(frame);
}

/** Pede um render. Barato de chamar várias vezes por frame. */
export function requestRender() {
    framesLeft = SETTLE_FRAMES;
    schedule();
}

function frame(now) {
    frameQueued = false;
    for (const t of tasks) t(now);
    renderNow();
    if (tasks.size || !RENDER_ON_DEMAND || --framesLeft > 0) schedule();
}

function flushDirty() {
    if (!dirty.size) return;
    for (const g of dirty) {
        if (g.destroyed) continue;
        const fn = g._draw, d = g._data;
        if (fn && d) {
            fn(g, d);
            g._drawZoom = zoom;
        }
    }
    dirty.clear();
}

/** Desenha agora (usado no resize, para não piscar). */
export function renderNow() {
    if (!app?.renderer) return;
    flushDirty();
    if (CULLING && PIXI.Culler?.shared) PIXI.Culler.shared.cull(app.stage, app.screen, false);
    app.render();
}

function defer(g, data, fn, zoomDep = false) {
    g._data = data;
    g._draw = fn;
    if (zoomDep) zoomGfx.add(g);
    dirty.add(g);
    requestRender();
}

function undefer(g) {
    g._data = null;
    dirty.delete(g);
}

function forget(g) {
    dirty.delete(g);
    zoomGfx.delete(g);
}

/** Polígonos: ignora o pedido de redesenho vindo do Zoom() se o zoom quase não mudou. */
function zoomTolerated(g) {
    return zoomPass && g._data && g._drawZoom &&
        Math.abs(zoom / g._drawZoom - 1) < ZOOM_TOLERANCE;
}

function scheduleSettle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
        for (const g of zoomGfx) {
            if (g._data && g._drawZoom !== zoom) dirty.add(g);
        }
        requestRender();
    }, ZOOM_SETTLE_MS);
}

/** Zoom mudou o bastante para algum traço ficar visivelmente errado? */
function refreshZoomGfx() {
    for (const g of zoomGfx) {
        if (g._data && (!g._drawZoom || Math.abs(zoom / g._drawZoom - 1) > ZOOM_TOLERANCE)) {
            dirty.add(g);
        }
    }
}

const posOf = (p) => {
    if (!p) return { x: 0, y: 0 };
    if (typeof p.peekNormal === "function") return p.peekNormal();   // sem alocar quando já é "normal"
    if (typeof p.getIn === "function") return p.getIn("normal");
    if (Array.isArray(p)) return { x: p[0], y: p[1] };
    return p;
};

/* ============================================================================
 *  Viewport (área livre da tela, descontando a UI)
 * ========================================================================== */
const RECENTER_ON_INSET = true;   // true: o conteúdo acompanha o centro da área livre; false: fica parado na tela
const MIN_VISIBLE = 120;          // a área livre nunca fica menor que isso (px)

export const viewport = { x: 0, y: 0, width: 0, height: 0, cx: 0, cy: 0 };
let occluders = [];
let viewportReady = false;
let lastCx = null, lastCy = null;
let viewportLoop = 0;

export function getViewport() {
    return viewport;
}

function buildOccluders() {
    const mobile = () => window.matchMedia("(max-width: 700px)").matches;
    const defs = page === "editor"
        ? [["#editor-topbar", "top"], ["#editor-modes", "left"], ["#banner", "right"]]
        : [["#user-tab", "bottom"], ["#screen-ui", () => (mobile() ? "bottom" : "right")]];

    occluders = defs
        .map(([sel, side]) => ({ el: document.querySelector(sel), side }))
        .filter((o) => o.el);
}

function fitAxis(a, b, total) {
    const room = Math.max(total - MIN_VISIBLE, 0);
    const sum = a + b;
    if (sum <= room) return [a, b];
    const k = sum > 0 ? room / sum : 0;
    return [a * k, b * k];
}

/** Remede a UI. Devolve true se o viewport mudou. */
export function updateViewport() {
    if (!app) return false;
    const W = app.screen.width, H = app.screen.height;
    let l = 0, t = 0, r = 0, b = 0;

    for (const o of occluders) {
        if (!o.el.isConnected) continue;
        const rc = o.el.getBoundingClientRect();           // já inclui transform/margin no meio da animação
        if (rc.width === 0 && rc.height === 0) continue;   // display:none
        const side = typeof o.side === "function" ? o.side() : o.side;
        if (side === "left")   l = Math.max(l, rc.right);
        if (side === "right")  r = Math.max(r, W - rc.left);
        if (side === "top")    t = Math.max(t, rc.bottom);
        if (side === "bottom") b = Math.max(b, H - rc.top);
    }

    const cl = (v, max) => Math.min(Math.max(v, 0), max);
    [l, r] = fitAxis(cl(l, W), cl(r, W), W);
    [t, b] = fitAxis(cl(t, H), cl(b, H), H);

    const width = W - l - r, height = H - t - b;
    const cx = l + width / 2, cy = t + height / 2;

    const v = viewport;
    if (v.x === l && v.y === t && v.width === width && v.height === height) return false;

    const dx = lastCx === null ? 0 : cx - lastCx;
    const dy = lastCy === null ? 0 : cy - lastCy;
    v.x = l; v.y = t; v.width = width; v.height = height; v.cx = cx; v.cy = cy;
    lastCx = cx; lastCy = cy;

    if (!viewportReady) return true;

    applyZoomLimits();
    // durante animateTransform quem manda é a animação (ela relê o centro a cada frame)
    if (RECENTER_ON_INSET && !smoothTransform && (dx || dy)) {
        Position(mapContainer.x + dx, mapContainer.y + dy);
    } else {
        clampPos();
        tilesUpdate();
    }
    return true;
}

/** Enquanto a UI anima, remede a cada frame; fora disso, só quando algo muda. */
function watchViewport() {
    let calm = 0;

    const tick = () => {
        viewportLoop = 0;
        updateViewport();
        const animating = occluders.some((o) =>
            o.el.getAnimations().some((a) => a.playState === "running" || a.playState === "pending"));
        calm = animating ? 0 : calm + 1;
        if (calm < 3) viewportLoop = requestAnimationFrame(tick);
    };
    const kick = () => {
        calm = 0;
        if (!viewportLoop) viewportLoop = requestAnimationFrame(tick);
    };

    window.addEventListener("resize", kick);
    window.visualViewport?.addEventListener("resize", kick);

    const mo = new MutationObserver(kick);   // troca de classe/estilo inicia a transição
    const ro = new ResizeObserver(kick);
    for (const o of occluders) {
        mo.observe(o.el, { attributes: true, attributeFilter: ["class", "style", "hidden"] });
        ro.observe(o.el);
        o.el.addEventListener("transitionrun", kick);
    }
}

const DIM_ALPHA = 0.25;

function asDisplayObjects(item) {
    if (!item) return [];
    if (item instanceof PIXI.Container) return [item];
    if (typeof item === "object") {
        return Object.values(item).filter((v) => v instanceof PIXI.Container);
    }
    return [];
}

export function getNormalizedCoordinates(pos) {
    const localPoint = mapContainer.toLocal({ x: pos.x - origin.x, y: pos.y - origin.y });
    return { x: localPoint.x, y: localPoint.y };
}

export function getScreenCoordinates(pos) {
    const screenPoint = mapContainer.toGlobal(pos);
    return { x: screenPoint.x + origin.x, y: screenPoint.y + origin.y };
}

export function svgToNormalized(p) {
    return {
        x: p.x - imageSize.width / 2,
        y: p.y - imageSize.height / 2,
    };
}

export function normalizedToSvg(p) {
    return {
        x: p.x + imageSize.width / 2,
        y: p.y + imageSize.height / 2,
    };
}

export function getVisibleMapBounds() {
    const { width, height } = app.screen;
    return [
        { x: 0, y: 0 }, { x: width, y: 0 },
        { x: width, y: height }, { x: 0, y: height },
    ].map((p) => mapContainer.toLocal(new PIXI.Point(p.x, p.y)));
}

/* ============================================================================
 *  Reference (ponto)
 *
 *  A geometria NÃO depende mais do zoom: o círculo é desenhado uma vez num
 *  GraphicsContext compartilhado (raio e borda em pixels de tela) e cada ponto
 *  só ganha posição + escala 1/zoom. Zoom e hover viram atribuição de número.
 * ========================================================================== */
const dotContexts = new Map();
const dots = new Set();     // handles ativos (para reescalar no zoom sem passar pelo editor)

function dotContext(r, colorIn, colorOut, alpha) {
    const key = `${r}|${colorIn}|${colorOut}|${alpha}`;
    let ctx = dotContexts.get(key);
    if (!ctx) {
        if (dotContexts.size >= 400) dotContexts.clear();   // cores interpoladas: não deixa crescer sem limite
        ctx = new PIXI.GraphicsContext()
            .circle(0, 0, r)
            .fill({ color: colorIn, alpha })
            .stroke({ width: DOT_STROKE, color: colorOut });
        dotContexts.set(key, ctx);
    }
    return ctx;
}

function applyDot(h) {
    const d = h._d;
    if (!d) return;
    h.point.scale.set(d.size / d.r / zoom);
    if (d.entrance) h.door.scale.set((d.size * 2) / h.initialSize / zoom);
    if (d.hasIcon) h.icon.scale.set((d.size * 2 * 0.85) / ICON_PX / zoom);
}

function rescaleDots() {
    for (const h of dots) {
        if (h.point.visible) applyDot(h);
    }
}

const ICON_PX = 64;
const MAP_PIN_ICON_PX = 14;
const MAP_PIN_BG_RADIUS = 10;
const mapPins = new Set();
const iconTextures = new Map();   // nome -> PIXI.Texture
const iconLoading = new Map();    // nome -> Promise (carregando)
const iconFailed = new Set();     // nomes inválidos: não tenta de novo

let mapPinBgContext = null;       // white circle, shared by every pin (tinted per pin)
function getMapPinBgContext() {
    return (mapPinBgContext ??= new PIXI.GraphicsContext()
        .circle(0, 0, MAP_PIN_BG_RADIUS)
        .fill(0xffffff));
}

function readGlyph(name) {
    const probe = document.createElement("i");
    probe.className = `fa-solid fa-${name}`;
    probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
    document.body.appendChild(probe);

    const cs = getComputedStyle(probe);
    const family = cs.fontFamily;
    const weight = cs.fontWeight;

    const raw = getComputedStyle(probe, "::before").content;
    probe.remove();

    if (!raw || raw === "none" || raw === "normal") return null;

    const m = raw.match(/^(["'])((?:\\.|(?!\1).)*)\1/);
    if (!m) return null;

    const glyph = m[2].replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
    return glyph ? { glyph, family, weight } : null;
}

async function buildIconTexture(name) {
    const g = readGlyph(name);
    if (!g) throw new Error(`Ícone desconhecido: ${name}`);

    await document.fonts.load(`${g.weight} ${ICON_PX}px ${g.family}`, g.glyph);

    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = ICON_PX;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    // mede e ajusta para o glifo preencher a caixa, centralizado
    let px = ICON_PX * 0.8;
    ctx.font = `${g.weight} ${px}px ${g.family}`;
    let m = ctx.measureText(g.glyph);
    let w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    let h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    px *= (ICON_PX * 0.9) / Math.max(w, h, 1);

    ctx.font = `${g.weight} ${px}px ${g.family}`;
    m = ctx.measureText(g.glyph);
    w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    ctx.fillText(
        g.glyph,
        (ICON_PX - w) / 2 + m.actualBoundingBoxLeft,
        (ICON_PX - h) / 2 + m.actualBoundingBoxAscent,
    );

    return PIXI.Texture.from(canvas);
}

function iconTexture(name) {
    const hit = iconTextures.get(name);
    if (hit) return hit;
    if (iconFailed.has(name) || iconLoading.has(name)) return null;

    const job = buildIconTexture(name)
        .then((tex) => {
            iconTextures.set(name, tex);
            for (const h of dots) {
                if (h._d?.iconName === name && h._last) renderReference(h, h._last);
            }
            for (const p of mapPins) {
                if (p._iconName === name && p._last) renderMapPin(p, p._last);
            }
            requestRender();
        })
        .catch((err) => {
            console.warn("Ícone não carregou:", name, err);
            iconFailed.add(name);
        })
        .finally(() => iconLoading.delete(name));

    iconLoading.set(name, job);
    return null;
}

export function preloadIcons(names) {
    return Promise.all(names.map((n) => iconTexture(n) ?? iconLoading.get(n)));
}


export function createReference() {
    const point = new PIXI.Graphics(dotContext(10, 0xffffff, 0x000000, 1));
    point.visible = false;
    point.cullable = CULLING;
    referenceContainer.addChild(point);

    const referenceImg = PIXI.Sprite.from(entranceTexture);
    const initialSize = referenceImg.width;
    const icon = new PIXI.Sprite(PIXI.Texture.EMPTY);
    icon.anchor.set(0.5, 0.5);
    icon.visible = false;
    icon.cullable = CULLING;
    referenceContainer.addChild(icon);

    const handle = { point, door: referenceImg, icon, initialSize, _d: null };
    dots.add(handle);
    return handle;
}

export function renderReference(graphics, data) {
    graphics._last = data;   // lets the icon loader re-render once the texture is ready
    const pos = posOf(data.coordinate);
    const size = data.size;
    const r = Math.max(1, Math.round(size));

    const ctx = dotContext(r, data.colorIn, data.colorOut, data.alpha);
    const p = graphics.point;
    if (p.context !== ctx) p.context = ctx;
    p.visible = true;
    p.position.set(pos.x, pos.y);

    const d = graphics._d ??= { size: 0, r: 10, entrance: false, hasIcon: false, iconName: null };
    d.size = size;
    d.r = r;

    // ícone: muda dinamicamente (nome novo, ou null para remover)
    const iconName = data.bannerMode || null;
    const iconTex = iconName ? iconTexture(iconName) : null;   // null = ainda carregando / inválido
    d.iconName = iconName;
    d.hasIcon = !!iconTex;
    d.entrance = !!data.isEntrance && !d.hasIcon;               // ícone esconde a entrada

    const icon = graphics.icon;
    if (d.hasIcon) {
        if (icon.texture !== iconTex) icon.texture = iconTex;
        icon.visible = true;
        icon.tint = data.colorOut;
        icon.position.set(pos.x, pos.y);
        icon.rotation = -mapContainer.rotation;
    } else {
        icon.visible = false;
    }

    if (d.entrance) {
        const door = graphics.door;
        door.visible = true;
        door.tint = data.colorOut;
        door.position.set(pos.x, pos.y);
        door.rotation = -mapContainer.rotation;
    } else {
        graphics.door.visible = false;
    }

    applyDot(graphics);
    requestRender();
}

export function BringToFrontReference(graphics) {
    if (!graphics || graphics.parent !== referenceContainer) return;
    const ch = referenceContainer.children, n = ch.length;
    if (n >= 3 && ch[n - 3] === graphics.point && ch[n - 2] === graphics.door && ch[n - 1] === graphics.icon) return;
    referenceContainer.addChild(graphics.point);
    referenceContainer.addChild(graphics.door);
    referenceContainer.addChild(graphics.icon);
    requestRender();
}

export function clearReference(graphics) {
    graphics.point.visible = false;
    graphics.door.visible = false;
    graphics.icon.visible = false;
    requestRender();
}

export function destroyReference(graphics) {
    dots.delete(graphics);
    referenceContainer.removeChild(graphics.point);
    referenceContainer.removeChild(graphics.door);
    referenceContainer.removeChild(graphics.icon);

    graphics.point.destroy();
    graphics.door.destroy();
    graphics.icon.destroy();   // a textura é compartilhada: não é destruída junto
    requestRender();
}

/* ============================================================================
 *  Connection
 *
 *  Segmento de 2 pontos = 2 sprites (contorno + miolo): sem tesselação, 1 batch,
 *  zoom só muda a altura. Polilinha (rota calculada) continua sendo Graphics.
 * ========================================================================== */
const conns = new Set();

function layoutConn(c) {
    const s = c._st;
    const dx = s.bx - s.ax, dy = s.by - s.ay;
    const len = Math.hypot(dx, dy), rot = Math.atan2(dy, dx);
    for (const sp of [c._outline, c._inner]) {
        sp.position.set(s.ax, s.ay);
        sp.rotation = rot;
        sp.width = len;
    }
    c._outline.height = (s.size + 6) / zoom;
    c._inner.height = s.size / zoom;
    s.zoom = zoom;
}

function rescaleConns() {
    for (const c of conns) {
        if (c._mode === "seg" && c.visible) {
            c._outline.height = (c._st.size + 6) / zoom;
            c._inner.height = c._st.size / zoom;
            c._st.zoom = zoom;
        }
    }
}

export function createConnection() {
    const c = new PIXI.Container();
    c._isConn = true;
    c._mode = "seg";
    c._st = { ax: NaN, ay: NaN, bx: NaN, by: NaN, size: NaN, alpha: NaN, colorIn: -1, colorOut: -1, zoom: NaN };

    c._outline = new PIXI.Sprite(PIXI.Texture.WHITE);
    c._inner = new PIXI.Sprite(PIXI.Texture.WHITE);
    for (const sp of [c._outline, c._inner]) {
        sp.anchor.set(0, 0.5);
        sp.cullable = CULLING;
        c.addChild(sp);
    }
    c._poly = null;
    c.visible = false;

    connectionContainer.addChild(c);
    conns.add(c);
    return c;
}

function drawPolyline(g, data) {
    const points = data.points;
    const radius = data.radius ? data.radius : 15;
    g.clear();
    if (points.length < 2) return;

    const buildPath = () => {
        const p0 = posOf(points[0]);
        g.moveTo(p0.x, p0.y);

        for (let i = 1; i < points.length - 1; i++) {
            const p1 = posOf(points[i]);
            const p2 = posOf(points[i + 1]);
            g.arcTo(p1.x, p1.y, p2.x, p2.y, radius);
        }

        const last = posOf(points[points.length - 1]);
        g.lineTo(last.x, last.y);
    };

    buildPath();
    g.stroke({
        width: (data.size + 6) / zoom,
        color: data.colorOut,
        alpha: data.alpha,
        cap: "round",
        join: "round",
    });

    buildPath();
    g.stroke({
        width: data.size / zoom,
        color: data.colorIn,
        alpha: data.alpha,
        cap: "round",
        join: "round",
    });
}

export function renderConnection(c, data) {
    const pts = data.points;
    if (!pts || pts.length < 2) return;

    // ---- polilinha (rota): Graphics, desenhado 1x por frame ----
    if (pts.length > 2) {
        c._mode = "poly";
        c._outline.visible = c._inner.visible = false;
        if (!c._poly) {
            c._poly = new PIXI.Graphics();
            c._poly.cullable = CULLING;
            c.addChild(c._poly);
        }
        c._poly.visible = true;
        c.visible = true;
        if (!zoomTolerated(c._poly)) defer(c._poly, data, drawPolyline, true);
        return;
    }

    // ---- segmento: sprites ----
    c._mode = "seg";
    if (c._poly) c._poly.visible = false;

    const a = posOf(pts[0]), b = posOf(pts[1]);
    const s = c._st;

    const geom = s.ax !== a.x || s.ay !== a.y || s.bx !== b.x || s.by !== b.y;
    const look = s.size !== data.size || s.alpha !== data.alpha ||
        s.colorIn !== data.colorIn || s.colorOut !== data.colorOut;

    if (!geom && !look && s.zoom === zoom && c.visible) return;   // chamadas repetidas saem aqui

    if (look) {
        s.size = data.size;
        s.alpha = data.alpha;
        s.colorIn = data.colorIn;
        s.colorOut = data.colorOut;
        c._outline.tint = data.colorOut;
        c._inner.tint = data.colorIn;
        c._outline.alpha = c._inner.alpha = data.alpha;
    }
    if (geom) { s.ax = a.x; s.ay = a.y; s.bx = b.x; s.by = b.y; }

    c._outline.visible = c._inner.visible = true;
    c.visible = true;
    layoutConn(c);
    requestRender();
}

export function clearConnection(c) {
    if (c._isConn) {
        c.visible = false;
        c._st.ax = NaN;                       // força relayout quando voltar
        if (c._poly) {
            undefer(c._poly);
            c._poly.clear();
        }
    } else {
        undefer(c);
        c.clear();                            // chamado com um Graphics qualquer
    }
    requestRender();
}

export function destroyConnection(c) {
    if (!c || c.destroyed) return;
    forget(c);
    if (c._isConn) {
        conns.delete(c);
        if (c._poly) forget(c._poly);
    }
    c.parent?.removeChild(c);
    c.destroy({ children: true });            // não destrói Texture.WHITE
    requestRender();
}

/* ============================================================================
 *  Guide / seleção (Graphics, redesenhados no máx. 1x por frame)
 * ========================================================================== */
export function createGuide() {
    const guide = new PIXI.Graphics();
    guide.position.set(0, 0);
    snapGuideContainer.addChild(guide);
    return guide;
}

function drawSelect(graphics, data) {
    graphics.clear();
    if (!data.points?.length) return;

    const { alpha, colorOut, colorIn, borderSize, radius = 12 } = data;
    const cornerRadius = Math.min(radius, 20);

    for (const [x1, y1, x2, y2] of data.points) {
        graphics.roundRect(
            Math.min(x1, x2),
            Math.min(y1, y2),
            Math.abs(x2 - x1),
            Math.abs(y2 - y1),
            cornerRadius
        );
    }

    graphics
        .fill({ color: colorIn, alpha: alpha[1] * 0.45 })
        .stroke({
            width: borderSize / zoom + 1,
            color: colorOut,
            alpha: alpha[0],
        });

    if (data.handles) {
        const handles = data.points.flatMap(([x1, y1, x2, y2]) => [
            [x1, y1],
            [x2, y2],
        ]);

        handles.forEach(([x, y], i) => {
            const active = i === data.handleActive;

            graphics
                .circle(x, y, (active ? 9 : 6) / zoom)
                .fill({ color: active ? 0xffffff : colorIn })
                .stroke({ width: 3 / zoom, color: colorOut });
        });
    }
}

export function renderSelect(graphics, data) {
    graphics.rotation = -(data.frameRotation ?? 0);   // pontos estão no frame da tela
    if (!data.points?.length) {
        undefer(graphics);
        graphics.clear();
        requestRender();
        return;
    }
    defer(graphics, data, drawSelect);
}

function drawGuide(g, d) {
    g.clear();
    g.moveTo(d.x0, d.y0);
    g.lineTo(d.x1, d.y1);
    g.stroke({ width: d.size / zoom, color: d.colorOut, alpha: d.alpha, cap: "round" });
}

export function renderGuide(graphics, data) {
    const { alpha, colorOut, size, points } = data;
    if (points.length !== 2) return;

    // converte já: os pontos podem estar em "screen" e dependem da câmera deste instante
    const p0 = posOf(points[0]);
    const p1 = posOf(points[1]);
    defer(graphics, { x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y, alpha, colorOut, size }, drawGuide);
}

export function clearGuide(graphics) {
    undefer(graphics);
    graphics.clear();
    requestRender();
}

export function destroyGuide(graphics) {
    if (!graphics) return;
    forget(graphics);
    graphics.parent?.removeChild(graphics);
    graphics.destroy({ children: true, texture: true, textureSource: true });
    requestRender();
}

/* ============================================================================
 *  Pin
 *  (transform imediato: collisionTest lê x/y/escala/rotação logo depois)
 * ========================================================================== */
export function createPin(name) {
    const buildPino = PIXI.Sprite.from(pinImagePath);
    buildPino.anchor.set(0.5, 1);
    buildPino.scale.set(1 / 7.5);
    buildPino.tint = 0x000000;

    const nodeLabel = new PIXI.Text({
        text: name,
        style: {
            fontFamily: "Arial",
            fontSize: 28,
            fill: textColor,
            align: "center",
            stroke: { color: "white", width: 3 },
        },
    });
    nodeLabel.anchor.set(0, 1);
    nodeLabel.scale.set(1 / 2);
    nodeLabel.x = buildPino.width / 2;

    const pinGfx = new PIXI.Container();
    pinGfx._size = 1;

    pinGfx.addChild(nodeLabel);
    pinGfx.addChild(buildPino);

    pinContainer.addChild(pinGfx);

    return pinGfx;
}

export function setPinText(gfx, text) {
    gfx.children[0].text = text;   // children[0] é o label (ver createPin)
    gfx[HIT] = null;
    requestRender();
}

export function renderPin(graphics, data) {
    const pos = posOf(data.coordinate);
    const size = data.size;
    const colorPin = data.colorPin;

    // Mexer no style marca o Text como sujo (re-rasteriza): só quando a cor muda de fato.
    const label = graphics.children[0];
    if (label._fill !== data.color) {
        label.style.fill = data.color;
        label._fill = data.color;
    }

    graphics.visible = true;
    graphics._size = size;
    if (colorPin) {
        graphics.children[1].tint = colorPin;
    }
    graphics.position.set(pos.x, pos.y);
    graphics.scale.set(size / zoom);
    const rot = -mapContainer.rotation;
    if (graphics.rotation !== rot) graphics.rotation = rot;
    requestRender();
}

export function clearPin(graphics) {
    graphics.visible = false;
    requestRender();
}

export function destroyPin(graphics) {
    pinContainer.removeChild(graphics);

    for (const child of graphics.children) {
        child.destroy();
    }

    graphics.destroy({ children: true });
    requestRender();
}

/* ============================================================================
 *  Areas
 * ========================================================================== */
function normalizeBox(x1, y1, x2, y2) {
    return {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
        minX: Math.min(x1, x2),
        maxX: Math.max(x1, x2),
        minY: Math.min(y1, y2),
        maxY: Math.max(y1, y2),
    };
}

export function createArea() {
    const area = new PIXI.Graphics();
    area.position.set(0, 0);
    area.cullable = CULLING;
    areasContainer.addChild(area);
    return area;
}

function drawArea(graphics, data) {
    const alpha = data.alpha;
    const colorOut = data.colorOut;
    const colorIn = data.colorIn;
    const size = data.borderSize / zoom;
    const radius = data.radius !== undefined ? data.radius : 12;

    const start = posOf(data.start);
    const end = posOf(data.end);
    const box = normalizeBox(start.x, start.y, end.x, end.y);

    graphics.clear();

    if (box.width < 2 || box.height < 2) return;

    const { x, y, width: w, height: h } = box;
    const r = Math.min(radius, w / 2, h / 2);

    graphics.roundRect(x, y, w, h, r);
    graphics.fill({ color: colorIn, alpha: alpha * 0.35 });

    const borderColors =
        typeof colorOut === "object" && colorOut !== null
            ? colorOut
            : { top: colorOut, right: colorOut, bottom: colorOut, left: colorOut };

    const getStroke = (c) => ({ width: size, color: c, alpha: alpha, alignment: 0.5 });

    if (r > 0) {
        graphics.beginPath();
        graphics.arc(x + r, y + r, r, Math.PI * 1.25, Math.PI * 1.5);
        graphics.lineTo(x + w - r, y);
        graphics.arc(x + w - r, y + r, r, Math.PI * 1.5, Math.PI * 1.75);
        graphics.stroke(getStroke(borderColors.top));

        graphics.beginPath();
        graphics.arc(x + w - r, y + r, r, Math.PI * 1.75, Math.PI * 2);
        graphics.lineTo(x + w, y + h - r);
        graphics.arc(x + w - r, y + h - r, r, 0, Math.PI * 0.25);
        graphics.stroke(getStroke(borderColors.right));

        graphics.beginPath();
        graphics.arc(x + w - r, y + h - r, r, Math.PI * 0.25, Math.PI * 0.5);
        graphics.lineTo(x + r, y + h);
        graphics.arc(x + r, y + h - r, r, Math.PI * 0.5, Math.PI * 0.75);
        graphics.stroke(getStroke(borderColors.bottom));

        graphics.beginPath();
        graphics.arc(x + r, y + h - r, r, Math.PI * 0.75, Math.PI);
        graphics.lineTo(x, y + r);
        graphics.arc(x + r, y + r, r, Math.PI, Math.PI * 1.25);
        graphics.stroke(getStroke(borderColors.left));
    } else {
        graphics.beginPath().moveTo(x, y).lineTo(x + w, y).stroke(getStroke(borderColors.top));
        graphics.beginPath().moveTo(x + w, y).lineTo(x + w, y + h).stroke(getStroke(borderColors.right));
        graphics.beginPath().moveTo(x + w, y + h).lineTo(x, y + h).stroke(getStroke(borderColors.bottom));
        graphics.beginPath().moveTo(x, y + h).lineTo(x, y).stroke(getStroke(borderColors.left));
    }
}

export function renderArea(graphics, data) {
    defer(graphics, data, drawArea, true);
}

export function clearArea(graphics) {
    undefer(graphics);
    graphics.clear();
    requestRender();
}

export function destroyArea(graphics) {
    if (!graphics) return;
    forget(graphics);
    graphics.parent?.removeChild(graphics);
    graphics.destroy({ children: true, texture: true, baseTexture: true });
    requestRender();
}

/* ============================================================================
 *  Poly (construções) e Draft (rascunho)
 *  Re-traçados só quando os dados mudam, ou o zoom mudou > ZOOM_TOLERANCE,
 *  ou o zoom parou.
 * ========================================================================== */
export function createPoly() {
    const area = new PIXI.Graphics();
    area.position.set(0, 0);
    area.cullable = CULLING;
    areasContainer.addChild(area);
    return area;
}

function drawPoly(graphics, data) {
    graphics.clear();

    const rawPoints = [...data.points, data.points[0]];
    if (rawPoints.length === 0) return;

    const isSinglePolygon =
        rawPoints[0] &&
        (typeof rawPoints[0].getIn === "function" ||
            typeof rawPoints[0].x === "number" ||
            (Array.isArray(rawPoints[0]) && typeof rawPoints[0][0] === "number"));

    const polygons = isSinglePolygon ? [rawPoints] : rawPoints;

    const alpha = data.alpha;
    const colorOut = data.colorOut;
    const colorIn = data.colorIn;
    const size = data.borderSize / zoom;
    const radius = data.radius !== undefined ? data.radius : 12;

    const buildPolygonPath = (g, points) => {
        if (!points || points.length < 3) return;

        const p0 = posOf(points[0]);
        g.moveTo(p0.x, p0.y);

        for (let i = 0; i < points.length; i++) {
            const p1 = posOf(points[i]);
            const p2 = posOf(points[(i + 1) % points.length]);
            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2;
            g.arcTo(p1.x, p1.y, midX, midY, Math.min(radius, 20));
        }
    };

    for (const poly of polygons) buildPolygonPath(graphics, poly);
    graphics.fill({ color: colorIn, alpha: alpha * 0.45 });

    for (const poly of polygons) buildPolygonPath(graphics, poly);
    graphics.stroke({
        width: size + 1,
        color: colorOut,
        alpha: alpha,
        cap: "round",
        join: "round",
    });

    if (data.handles) {
        const pts = data.points.map(posOf);
        pts.forEach((p, i) => {
            const active = i === data.handleActive;
            graphics
                .circle(p.x, p.y, (active ? 9 : 6) / zoom)
                .fill({ color: active ? 0xffffff : colorIn })
                .stroke({ width: 3 / zoom, color: colorOut });
        });
    }
}

export function renderPoly(graphics, data) {
    if (zoomTolerated(graphics)) return;   // só o zoom pediu, e quase não mudou
    defer(graphics, data, drawPoly, true);
}

export function clearPoly(graphics) {
    undefer(graphics);
    graphics.clear();
    requestRender();
}

export function destroyPoly(graphics) {
    if (!graphics) return;
    forget(graphics);
    graphics.parent?.removeChild(graphics);
    graphics.destroy({ children: true, texture: true, baseTexture: true });
    requestRender();
}

function drawDraft(graphics, data) {
    graphics.clear();
    const pts = data.points.map(posOf);
    if (!pts.length) return;

    if (pts.length >= 2) {
        graphics.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) graphics.lineTo(pts[i].x, pts[i].y);
        graphics.stroke({
            width: data.borderSize / zoom,
            color: data.colorOut,
            alpha: data.alpha,
            cap: "round",
            join: "round",
        });
    }

    pts.forEach((p, i) => {
        const first = i === 0;
        graphics
            .circle(p.x, p.y, (first ? 9 : 6) / zoom)
            .fill({ color: first && data.closable ? data.colorOut : data.colorIn })
            .stroke({ width: 3 / zoom, color: data.colorOut });
    });
}

export function renderDraft(graphics, data) {
    if (zoomTolerated(graphics)) return;
    defer(graphics, data, drawDraft, true);
}

/* ============================================================================
 *  User pin
 * ========================================================================== */
export function createSelfPin() {
    const userPin = PIXI.Sprite.from(pinImagePath);
    userPin.anchor.set(0.5, 1);
    userPin.scale.set(1 / 7.5);
    userPin.tint = 0x0033ee;

    const pinGfx = new PIXI.Container();
    pinGfx._size = 1;
    pinGfx.addChild(userPin);

    const userAvatar = PIXI.Sprite.from(userImagePath);
    userAvatar.anchor.set(0.5);

    userAvatar.width = avatarSize;
    userAvatar.height = avatarSize;

    const radius = avatarSize / 2;
    const avatarMask = new PIXI.Graphics().circle(0, 0, radius).fill(0xffffff);

    userAvatar.position.set(0, -23);
    avatarMask.position.set(0, -23);

    userAvatar.mask = avatarMask;
    pinGfx.addChild(userAvatar);
    pinGfx.addChild(avatarMask);

    pinContainer.addChild(pinGfx);

    return pinGfx;
}

export function renderSelfPin(graphics, data) {
    const pos = posOf(data.coordinate);
    const size = data.size;

    graphics.visible = data.visible;
    graphics._size = size;
    graphics.children[0].tint = data.online ? 0x0033ee : 0x454545;

    graphics.position.set(pos.x, pos.y);
    graphics.scale.set(size / zoom);
    requestRender();
}

export function destroySelfPin(graphics) {
    pinContainer.removeChild(graphics);

    for (const child of graphics.children) {
        child.destroy();
    }

    graphics.destroy({ children: true });
    requestRender();
}

/////////////// mappin

const MAP_PIN_TEXT_ONLY_BOOST = 1.25;

export function createMapPin(text = "") {
    const label = new PIXI.Text({
        text,
        style: {
            fontFamily: "Arial",
            fontSize: 28,
            fill: textColor,
            align: "center",
            stroke: { color: "white", width: 3 },
        },
    });
    label.anchor.set(0, 1);
    label.scale.set(1 / 2);
    label.visible = !!text;

    const pin = PIXI.Sprite.from(pinImagePath);
    pin.anchor.set(0.5, 1);
    pin.scale.set(1 / 7.5);
    pin.tint = 0xff0000;

    const icon = new PIXI.Sprite(PIXI.Texture.EMPTY);
    icon.anchor.set(0.5);
    icon.position.set(0, -23);    // same spot the avatar had
    icon.visible = false;

    const pinGfx = new PIXI.Container();
    pinGfx._size = 1;
    pinGfx._iconName = null;
    pinGfx._textOnly = false;
    pinGfx._last = null;

    const bg = new PIXI.Graphics(getMapPinBgContext());
    bg.position.set(0, -23);      // same center as the icon
    bg.visible = false;

    pinGfx.addChild(label);       // children[0]
    pinGfx.addChild(pin);         // children[1]
    pinGfx.addChild(bg);          // children[2]
    pinGfx.addChild(icon);      // children[2]

    pinContainer.addChild(pinGfx);
    mapPins.add(pinGfx);
    return pinGfx;
}

export function renderMapPin(graphics, data) {
    graphics._last = data;   // lets the icon loader re-render once the texture is ready

    const pos = posOf(data.coordinate);
    const size = data.size ?? 1;
    const [label, pin, bg, icon] = graphics.children;
    const textOnly = !!data.textOnly;
    const text = data.text ?? "";

    graphics.visible = data.visible ?? true;
    graphics._size = size;

    // ---- text ----
    if (label.text !== text) {
        label.text = text;
        graphics[HIT] = null;
    }
    // changing the style re-rasterizes the Text: only when the color really changes
    const textFill = data.color ?? textColor;
    if (label._fill !== textFill) {
        label.style.fill = textFill;
        label._fill = textFill;
    }
    label.visible = !!text;

    // ---- layout: pin mode vs text-only mode ----
    if (graphics._textOnly !== textOnly) {
        graphics._textOnly = textOnly;
        graphics[HIT] = null;
    }

    if (textOnly) {
        label.anchor.set(0.5, 0.5);
        label.position.set(0, 0);
        label.scale.set(MAP_PIN_TEXT_ONLY_BOOST / 2);
        pin.visible = false;
        bg.visible = false;
        icon.visible = false;
        graphics._iconName = null;
    } else {
        label.anchor.set(0, 1);
        label.position.set(pin.width / 2, 0);
        label.scale.set(1 / 2);
        pin.visible = true;
        if (data.colorPin) pin.tint = data.colorPin;

        // icon: changes dynamically (new name, or null to remove)
        const name = data.bannerMode || null;
        const tex = name ? iconTexture(name) : null;   // null = still loading / invalid
        graphics._iconName = name;

        if (tex) {
            if (icon.texture !== tex) icon.texture = tex;
            icon.scale.set(MAP_PIN_ICON_PX / ICON_PX);

            // circle: white by default; icon takes the pin color so it stays readable
            bg.tint = data.iconBgColor ?? 0xffffff;
            bg.visible = true;

            icon.tint = data.iconColor ?? pin.tint;
            icon.visible = true;
        } else {
            bg.visible = false;
            icon.visible = false;
        }
    }

    graphics.position.set(pos.x, pos.y);
    graphics.scale.set(size / zoom);
    const rot = -mapContainer.rotation;
    if (graphics.rotation !== rot) graphics.rotation = rot;
    requestRender();
}

export function destroyMapPin(graphics) {
    mapPins.delete(graphics);
    pinContainer.removeChild(graphics);

    for (const child of graphics.children) {
        child.destroy();   // the icon texture is shared: not destroyed with the sprite
    }

    graphics.destroy({ children: true });
    requestRender();
}

/* ============================================================================
 *  Touch pin
 * ========================================================================== */
export function createTouchPin() {
    const buildPino = PIXI.Sprite.from(pinImagePath);
    buildPino.anchor.set(0.5, 1);
    buildPino.scale.set(1 / 7.5);
    buildPino.tint = 0xff0000;

    const pinGfx = new PIXI.Container();
    pinGfx._size = 1;

    pinGfx.addChild(buildPino);

    pinContainer.addChild(pinGfx);

    return pinGfx;
}

export function renderTouchPin(graphics, data) {
    const pos = posOf(data.coordinate);
    const size = data.size;
    graphics.children[0].tint = data.color;
    graphics.visible = true;
    graphics._size = size;
    graphics.position.set(pos.x, pos.y);
    graphics.scale.set(size / zoom);
    requestRender();
}

export function destroyTouchPin(graphics) {
    pinContainer.removeChild(graphics);

    for (const child of graphics.children) {
        child.destroy();
    }

    graphics.destroy({ children: true });
    requestRender();
}

/* ============================================================================
 *  Context / init
 * ========================================================================== */
export function setContext(context) {
    page = context.page;
    if (page == "main") {
        compassButton = document.getElementById("orientation");
    }
    color = context.blank_color;
    textColor = context.text_color;

    zoomStep = context.scroll_ratio;

    const separator = mapImage.includes("?") ? "&" : "?";
    mapImagePath = `${mapImage}${separator}v=${Date.now()}`;

    pinImagePath = pinImage;
    userImagePath = defaultUserImage;
    entranceImagePath = entranceImage;
}

const MAX_ZOOM_METERS = 20;   // largura geográfica visível no zoom máximo
const FALLBACK_MAX_ZOOM = 3;  // se `metrics` não estiver disponível

function computeZoomLimits() {
    const sw = viewport.width || app.screen.width;
    const sh = viewport.height || app.screen.height;

    // mapa inteiro cabe na área livre (rotação 0)
    minZoom = Math.min(sw / imageSize.width, sh / imageSize.height);

    const upm = typeof metrics !== "undefined" ? metrics?.unitsPerMeter : NaN;
    maxZoom = Number.isFinite(upm) && upm > 0
        ? Math.min(sw, sh) / (MAX_ZOOM_METERS * upm)
        : FALLBACK_MAX_ZOOM;

    maxZoom = Math.max(maxZoom, minZoom);
}

function applyZoomLimits() {
    computeZoomLimits();
    if (!pinContainer) return;   // containers ainda não existem (resize durante a inicialização)
    const clamped = Math.min(Math.max(zoom, minZoom), maxZoom);
    if (clamped !== zoom) Zoom(clamped);
}

/** Atualiza o mapa base e garante um render. */
function tilesUpdate() {
    tiles?.requestUpdate();
    requestRender();
}

export async function main() {
    app = new PIXI.Application();
    const mapEl = document.getElementById("map");
    await app.init({
        resizeTo: mapEl,
        antialias: true,
        backgroundColor: color,
        resolution: Math.min(window.devicePixelRatio || 1, MAX_RESOLUTION),
        autoDensity: true,
        autoStart: false,            // o render é nosso (scheduler acima)
    });
    app.ticker.stop();

    gl = app.renderer.gl;
    map = document.getElementById("map");
    map.appendChild(app.canvas);
    buildOccluders();
    updateViewport();
    syncOrigin();
    window.addEventListener("resize", syncOrigin);

    mapContainer = new PIXI.Container();
    app.stage.addChild(mapContainer);

    tiles = new SvgTileEngine({
        container: mapContainer,
        svgUrl: mapImagePath,
        background: color,
        getScreenSize: () => ({ width: app.screen.width, height: app.screen.height }),
        getZoomRange: () => ({ min: minZoom, max: maxZoom }),
        maxTextureSize: gl?.getParameter(gl.MAX_TEXTURE_SIZE) ?? 4096,
        onUpdate: requestRender,     // o engine deve chamar isto quando uma tile/textura ficar pronta
    });

    imageSize = await tiles.load(); // { width, height } vindos do SVG

    computeZoomLimits();            // antes de start(): a camada base usa o minZoom

    await tiles.start();

    mapContainer.x = viewport.cx;
    mapContainer.y = viewport.cy;

    new ResizeObserver(() => {
        const { width, height } = mapEl.getBoundingClientRect();
        if (width && height &&
            (Math.abs(width - app.screen.width) >= 1 || Math.abs(height - app.screen.height) >= 1)) {
            app.renderer.resize(width, height);
            renderNow();           // pinta no mesmo frame: sem tela preta
        }
        updateViewport();          // sempre: o Pixi (resizeTo) pode ter redimensionado antes
        tilesUpdate();
    }).observe(mapEl);

    const pinoTexture = await PIXI.Assets.load(pinImagePath);
    pinoSprite = PIXI.Sprite.from(pinoTexture);
    pinoSprite.anchor.set(0.5, 1);
    pinoSprite.visible = false;
    pinoSprite.x = 0;
    pinoSprite.y = 0;
    pinoSprite.scale.set(1 / zoom / 7.5);
    mapContainer.addChild(pinoSprite);

    entranceTexture = await PIXI.Assets.load(entranceImagePath);
    userTexture = await PIXI.Assets.load(userImagePath);

    textContainer = new PIXI.Container();
    mapContainer.addChild(textContainer);

    areasContainer = new PIXI.Container();
    mapContainer.addChild(areasContainer);

    connectionContainer = new PIXI.Container();
    mapContainer.addChild(connectionContainer);

    referenceContainer = new PIXI.Container();
    mapContainer.addChild(referenceContainer);

    pinContainer = new PIXI.Container();
    mapContainer.addChild(pinContainer);

    snapGuideContainer = new PIXI.Container();
    mapContainer.addChild(snapGuideContainer);

    temporaryPin = createPin("");
    clearPin(temporaryPin);

    groups = {
        AREAS: areasContainer,
        CONNECTIONS: connectionContainer,
        REFERENCES: referenceContainer,
        PINS: pinContainer,
    };

    Zoom(minZoom);
    viewportReady = true;
    watchViewport();
    requestRender();
}

/* ============================================================================
 *  Collision (pins)
 * ========================================================================== */

// O pin é um container com position, rotation e escala uniforme; os filhos (sprite/texto)
// são estáticos. Então os retângulos deles são calculados uma vez, em espaço local do pin,
// e o ponto de consulta é levado para esse espaço com seno/cosseno. Sem toLocal, sem alocação.
const HIT = Symbol("pinHit");
let _lastRot = 0, _cos = 1, _sin = 0;

function getHit(gfx) {
    let hit = gfx[HIT];
    if (hit) return hit;

    const rects = [];
    let reach = 0;
    let ready = true;

    for (const c of gfx.children) {
        if (!c.anchor || !c.visible) continue;
        const w = c.width, h = c.height;
        if (!(w > 0 && h > 0)) { ready = false; continue; }   // textura ainda não carregou
        const x0 = c.x - c.anchor.x * w;
        const y0 = c.y - c.anchor.y * h;
        rects.push(x0, y0, x0 + w, y0 + h);
        reach = Math.max(
            reach,
            Math.hypot(
                Math.max(Math.abs(x0), Math.abs(x0 + w)),
                Math.max(Math.abs(y0), Math.abs(y0 + h)),
            ),
        );
    }

    hit = { rects, reach };
    if (ready) gfx[HIT] = hit;                                // só guarda em cache se estiver completo
    return hit;
}

/** Alcance do pin (unidades locais, escala 1) a partir da âncora. */
export function pinReach(gfx) {
    return gfx ? getHit(gfx).reach : 0;
}

/** `p` está no espaço do mapContainer (o mesmo de getNormalizedCoordinates). */
export function collisionTest(gfx, p) {
    if (!gfx || gfx.destroyed || !gfx.visible) return false;

    const s = gfx.scale.x;
    if (!(s > 0)) return false;

    const { rects } = getHit(gfx);
    if (rects.length === 0) return false;

    const r = gfx.rotation;
    if (r !== _lastRot) {                                     // todos os pins giram igual: cos/sin em cache
        _lastRot = r;
        _cos = Math.cos(r);
        _sin = Math.sin(r);
    }

    // inverso de: mundo = pos + R(r) · (s · local)
    const dx = p.x - gfx.x, dy = p.y - gfx.y;
    const lx = (_cos * dx + _sin * dy) / s;
    const ly = (-_sin * dx + _cos * dy) / s;

    for (let i = 0; i < rects.length; i += 4) {
        if (lx >= rects[i] && lx <= rects[i + 2] && ly >= rects[i + 1] && ly <= rects[i + 3]) return true;
    }
    return false;
}

export function nodeText(text, configuration) {
    const nodeLabel = new PIXI.Text({
        text: text,
        style: {
            fontFamily: "Arial",
            fontSize: 28,
            fill: textColor,
            align: "center",
            dropShadow: true,
            dropShadowColor: "#fff",
            dropShadowAngle: Math.PI / 4,
            dropShadowDistance: 2,
            dropShadowBlur: 2,
        },
    });
    nodeLabel.anchor.set(0.5, 1);
    nodeLabel.x = configuration.x;
    nodeLabel.y = configuration.y;
    nodeLabel.scale.set(1 / zoom / 2);
    textContainer.addChild(nodeLabel);
    requestRender();
}

export async function loadMapScales() {}

export function updateMap() {
    tilesUpdate();
}

/* ============================================================================
 *  Câmera: posição / zoom / rotação
 * ========================================================================== */
const PAN_SLACK = 0.25;      // fração do viewport que deve continuar coberta ao arrastar
const SLACK_RAMP = 0.5;      // a folga volta por completo em minZoom * (1 + SLACK_RAMP)

function clampAxis(value, center, mapSize, viewSize, slack) {
    // mapa inteiro cabe nesse eixo → sem folga, só centraliza
    const overflow = (mapSize - viewSize) / 2;
    const allowed = Math.max(0, overflow + viewSize * PAN_SLACK * slack);
    return Math.min(center + allowed, Math.max(center - allowed, value));
}

function clampPos() {
    const v = viewport;

    // 0 em minZoom (sempre centralizado) → 1 um pouco acima dele (folga original)
    const t = minZoom > 0 ? (zoom / minZoom - 1) / SLACK_RAMP : 1;
    const slack = Math.min(Math.max(t, 0), 1);

    mapContainer.x = clampAxis(mapContainer.x, v.cx, imageSize.width * zoom, v.width, slack);
    mapContainer.y = clampAxis(mapContainer.y, v.cy, imageSize.height * zoom, v.height, slack);
}

function Position(x, y) {
    mapContainer.x = x;
    mapContainer.y = y;
    clampPos();
    tilesUpdate();
}

export function setPosition(x, y) {
    if (!smoothTransform) {
        Position(x, y);
    }
}

function Zoom(z) {
    zoom = z;
    mapContainer.scale.set(zoom);

    // tudo abaixo é só atribuição de número: nada de tesselação
    for (const child of pinContainer.children) {
        child.scale.set((child._size ?? 1) / zoom);
    }
    for (const child of textContainer.children) {
        child.scale.set(1 / zoom / 2);
    }
    rescaleDots();
    rescaleConns();
    refreshZoomGfx();       // polígonos/rota: só os que ficaram visivelmente errados
    scheduleSettle();       // e todos, quando o zoom parar

    zoomPass = true;
    // alças do meio das arestas dependem do zoom (somem em arestas curtas)
    if (Editor.Buildings.midHandles) {
        const buildings = Editor.Buildings.buildings;
        for (const id in buildings) buildings[id].updateGraphics();
    }
    Editor.SnapGuides.render();
    Editor.SelectRegion.updateBoxGraphics();
    zoomPass = false;

    clampPos();
    tilesUpdate();
}

export function setZoom(z) {
    if (!smoothTransform) {
        Zoom(z);
    }
}

function Rotation(r) {
    mapContainer.rotation = r;
    for (const child of pinContainer.children) {
        child.rotation = -r;
    }
    for (const h of dots) {
        if (h._d?.entrance) h.door.rotation = -r;
        if (h._d?.hasIcon) h.icon.rotation = -r;
    }
    if (compassButton) {
        compassButton.children[0].style.transform = `rotate(${r}rad)`;
    }
    Editor.SelectRegion.onCameraRotate();
    requestRender();
}

export function setRotation(r) {
    if (!smoothTransform) {
        Rotation(r);
    }
}

export function editorFocus(value) {
    tiles?.setDimmed(value); // antes: mapSprite.alpha = value ? 0.5 : 1
    requestRender();
}

export function highlightObjects(objects, dimAlpha = DIM_ALPHA) {
    const containers = Object.values(groups);

    if (objects === true) {
        for (const c of containers) {
            c.alpha = 1;
            for (const child of c.children) child.alpha = 1;
        }
        requestRender();
        return;
    }

    const containerSet = new Set(containers);
    const keep = new Set();

    for (const item of objects) {
        for (const obj of asDisplayObjects(item)) {
            // sobe até o filho direto de algum grupo
            let node = obj;
            while (node.parent && !containerSet.has(node.parent)) node = node.parent;
            if (node.parent) keep.add(node);
        }
    }

    for (const c of containers) {
        c.alpha = 1; // quem controla o alpha agora são os filhos
        for (const child of c.children) {
            child.alpha = keep.has(child) ? 1 : dimAlpha;
        }
    }
    requestRender();
}

export function highlight(activeGroups) {
    if (activeGroups === true) return highlightObjects(true);
    highlightObjects(activeGroups.flatMap((g) => g.children));
}

const TAU = Math.PI * 2;
const normalizeAngle = (a) => a - TAU * Math.round(a / TAU);   // → [-π, π]

const screenCenter = () => ({ x: viewport.cx, y: viewport.cy });

// screen = pos + R(rot) · (scale · point)
function worldToScreen(p, pos, scale, rot) {
    const r = Transformacao.rotatePoint(p.x * scale, p.y * scale, rot);
    return { x: pos.x + r.x, y: pos.y + r.y };
}

function screenToWorld(s, pos, scale, rot) {
    const r = Transformacao.rotatePoint(s.x - pos.x, s.y - pos.y, -rot);
    return { x: r.x / scale, y: r.y / scale };
}

/** Container position that puts `worldPos` at `screenTarget` for a given scale and rotation. */
export function getContainerPosForPoint(
    worldPos,
    screenTarget,
    scale = zoom,
    rotation = mapContainer.rotation,
) {
    const target = screenTarget ?? screenCenter();
    const r = Transformacao.rotatePoint(worldPos.x * scale, worldPos.y * scale, rotation);
    return { x: target.x - r.x, y: target.y - r.y };
}

/** Stops a running animation, leaving the map where it is. Call it when the user takes over. */
export function cancelTransform() {
    if (animTask) tasks.delete(animTask);
    animTask = null;
    smoothTransform = false;
}

export function animateTransform({ point, screen, zoom: targetZoom, rotation: targetRotation, duration = 500 } = {}) {
    if (!mapContainer) return;
    cancelTransform();                      // a new request retargets from where the map is now
    smoothTransform = true;

    const startZoom = zoom;
    const startRotation = mapContainer.rotation;
    const startPos = { x: mapContainer.x, y: mapContainer.y };

    const endZoom = Math.min(Math.max(targetZoom ?? startZoom, minZoom), maxZoom);
    const endRotation = startRotation + normalizeAngle((targetRotation ?? startRotation) - startRotation);

    const anchor = point ?? screenToWorld(screen ?? screenCenter(), startPos, startZoom, startRotation);
    const startScreen = worldToScreen(anchor, startPos, startZoom, startRotation);

    const startTime = performance.now();

    // roda como tarefa do scheduler: anima e renderiza no MESMO frame (sem 1 frame de atraso)
    const step = (now) => {
        const raw = duration <= 0 ? 1 : (now - startTime) / duration;
        const t = Math.min(Math.max(raw, 0), 1);
        const e = t * t * (3 - 2 * t);

        const target = screen ?? screenCenter();

        const z = startZoom + (endZoom - startZoom) * e;
        const rot = startRotation + (endRotation - startRotation) * e;
        const at = {
            x: startScreen.x + (target.x - startScreen.x) * e,
            y: startScreen.y + (target.y - startScreen.y) * e,
        };

        if (z !== zoom) Zoom(z);            // real Zoom(): keeps `zoom`, pins, labels, references in sync
        Rotation(rot);
        const pos = getContainerPosForPoint(anchor, at, z, rot);
        Position(pos.x, pos.y);             // clamped to the map bounds

        if (t < 1) return;

        tasks.delete(step);
        animTask = null;
        smoothTransform = false;
        Rotation(normalizeAngle(mapContainer.rotation));
        if (endZoom !== startZoom) updateMap();
    };

    animTask = step;
    tasks.add(step);
    requestRender();
}

export function smoothRotation(r) {
    animateTransform({ rotation: r });
}