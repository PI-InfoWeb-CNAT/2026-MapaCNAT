import * as Graficos from "../graficos.js";
import * as Editor from "../objects.js";
import * as Toasts from '../../toasts.js';
import { Actions, snapCoordinate, AXIS_SNAP_PX, setCursor } from './action.js';

const ZOOM_DURATION = 450;
const FIT = 0.8;
const GRAB_PX = 10;        // vertex grab radius (screen px)
const MID_GRAB_PX = 8;     // edge-midpoint grab radius
const MID_MIN_PX = 200;    // midpoint handles only on edges at least this long on screen
const MIN_AREA = 1;

const WALL_SNAP_PX = 12;   // snap radius to outline edges / other walls
const MIN_WALL_PX = 6;     // shorter than this on screen = just a click

const S = () => Editor.SelectRegion;

/** Pointer.js routes the gesture to SelectRegion in this mode. */
export const isSelectMode = () => active && !!focused && floorMode === FloorModes.SELECT;

export function selectAll() {
    if (!isSelectMode()) return false;
    S().selectAll();
    return true;
}

export function deleteSelectedWalls() {
    const floor = selectedFloor();
    const picked = S().selected.walls;
    if (!floor || !picked.length) return false;

    const list = wallsOf(floor), building = focused;
    const items = list.map((w, i) => ({ w, i })).filter((o) => picked.includes(o.w));
    if (!items.length) return false;

    const before = S().snapshot();
    const remove = () => {
        for (const { w } of items) { const i = list.indexOf(w); if (i >= 0) list.splice(i, 1); }
        reveal(building, floor.id);
    };
    const restore = () => {
        for (const { w, i } of items) if (!list.includes(w)) list.splice(Math.min(i, list.length), 0, w);
        reveal(building, floor.id);
    };
    remove();
    S().refresh();
    Actions.newAction(remove, restore, undefined, undefined, { before, after: S().snapshot() });
    return true;
}

const wallsOf = (floor) => (floor.walls ??= []);

function closestOnSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    return { x: a.x + t * dx, y: a.y + t * dy };
}

function snapToWalls(p, floor, pts, ignore = null) {
    const R = WALL_SNAP_PX / Graficos.zoom;
    const R2 = R * R;

    // 1) endpoints (outline corners, other walls' ends)
    let best = null, bestD = R2;
    const tryPoint = (q) => {
        const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
        if (d <= bestD) { best = { x: q.x, y: q.y }; bestD = d; }
    };
    for (const q of pts) tryPoint(q);
    for (const w of wallsOf(floor)) if (w !== ignore) { tryPoint(w.a); tryPoint(w.b); }
    if (best) return best;

    // 2) anywhere along an edge or wall
    bestD = R2;
    const trySeg = (a, b) => {
        const q = closestOnSegment(p, a, b);
        const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
        if (d <= bestD) { best = q; bestD = d; }
    };
    for (let i = 0; i < pts.length; i++) trySeg(pts[i], pts[(i + 1) % pts.length]);
    for (const w of wallsOf(floor)) if (w !== ignore) trySeg(w.a, w.b);
    return best;
}

const toScreen = (p) => Editor.newCoord(p.x, p.y, "normal").getIn("screen");

function axisLock(anchor, x, y) {
    const a = toScreen(anchor);
    const horizontal = Math.abs(x - a.x) >= Math.abs(y - a.y);
    const sp = horizontal ? { x, y: a.y } : { x: a.x, y };
    const p = Editor.newCoord(sp.x, sp.y, "screen").getIn("normal");
    const q = Editor.newCoord(horizontal ? a.x + 1 : a.x, horizontal ? a.y : a.y + 1, "screen").getIn("normal");
    const len = Math.hypot(q.x - anchor.x, q.y - anchor.y) || 1;
    return { p, dir: { x: (q.x - anchor.x) / len, y: (q.y - anchor.y) / len } };
}

function snapAlongLine(p, anchor, dir, floor, pts, ignore = null) {
    const R = WALL_SNAP_PX / Graficos.zoom;
    let best = null, bestD = R;
    const test = (a, b) => {
        const da = dir.x * (a.y - anchor.y) - dir.y * (a.x - anchor.x);
        const db = dir.x * (b.y - anchor.y) - dir.y * (b.x - anchor.x);
        if (da === db || da * db > 0) return;
        const t = da / (da - db);
        const q = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
        if (Math.hypot(q.x - anchor.x, q.y - anchor.y) * Graficos.zoom < MIN_WALL_PX) return;
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d <= bestD) { best = q; bestD = d; }
    };
    for (let i = 0; i < pts.length; i++) test(pts[i], pts[(i + 1) % pts.length]);
    for (const w of wallsOf(floor)) if (w !== ignore) test(w.a, w.b);
    return best;
}

function nearestWallEnd(floor, x, y) {
    const p = normalAt(x, y);
    const R = GRAB_PX / Graficos.zoom;
    let best = null, bestD = R * R;
    for (const wall of wallsOf(floor)) {
        for (const end of ["a", "b"]) {
            const d = (wall[end].x - p.x) ** 2 + (wall[end].y - p.y) ** 2;
            if (d <= bestD) { best = { wall, end }; bestD = d; }
        }
    }
    return best;
}

function startWall(floor, pts, x, y) {
    const p = normalAt(x, y);
    const s = snapToWalls(p, floor, pts) ?? p;
    dragState = {
        kind: "wall", isNew: true, end: "b", floor, moved: false, snap: null,
        wall: { a: { x: s.x, y: s.y }, b: { x: s.x, y: s.y } },
    };
    hoverIdx = hoverMid = -1;
    renderEdit();
    return true;
}

/** Grab the start or end of an existing wall. The wall is edited in place. */
function startWallEdit(floor, { wall, end }) {
    dragState = {
        kind: "wall", isNew: false, end, floor, wall, moved: false, snap: null,
        before: { a: { ...wall.a }, b: { ...wall.b } },
    };
    hoverIdx = hoverMid = -1;
    renderEdit();
    return true;
}

function dragWall(d, x, y, shift, passedThreshold) {
    if (!d.moved && !passedThreshold) return;       // a small tremor is still a click
    d.moved = true;

    const w = d.wall;
    const anchor = d.end === "a" ? w.b : w.a;
    const pts = pointsOf(focused, d.floor);

    let p = normalAt(x, y);
    let snap = null;
    if (shift) {
        const lock = axisLock(anchor, x, y);
        p = lock.p;
        snap = snapAlongLine(p, anchor, lock.dir, d.floor, pts, w);
    } else {
        snap = snapToWalls(p, d.floor, pts, w);
    }
    if (snap) p = snap;

    w[d.end] = { x: p.x, y: p.y };
    d.snap = snap;
    renderEdit();
}

function releaseWall(d) {
    const w = d.wall;
    const building = focused, floor = d.floor;
    const tooShort = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) * Graficos.zoom < MIN_WALL_PX;

    if (!d.isNew) {                                 // edited an existing wall
        if (!d.moved || tooShort) {
            w.a = { ...d.before.a }; w.b = { ...d.before.b };
            renderEdit();
            return;
        }
        const before = d.before;
        const after = { a: { ...w.a }, b: { ...w.b } };
        const apply = (s) => { w.a = { ...s.a }; w.b = { ...s.b }; reveal(building, floor.id); };
        Actions.newAction(() => apply(after), () => apply(before));
        renderEdit();
        return;
    }

    if (!d.moved || tooShort) { renderEdit(); return; }

    const list = wallsOf(floor);
    const wall = { a: { ...w.a }, b: { ...w.b } };
    list.push(wall);
    Actions.newAction(
        () => { if (!list.includes(wall)) list.push(wall); reveal(building, floor.id); },
        () => { const i = list.indexOf(wall); if (i >= 0) list.splice(i, 1); reveal(building, floor.id); },
    );
    renderEdit();
}

export const FloorModes = Object.freeze({
    SELECT: "SELECT",
    WALLS: "WALLS",
    DOORS: "DOORS",
    ELEVATORS: "ELEVATORS",
    STAIRS: "STAIRS",
    BANNERS: "BANNERS",
});

const MODE_KEYS = {
    v: FloorModes.SELECT,
    w: FloorModes.WALLS,
    d: FloorModes.DOORS,
    l: FloorModes.ELEVATORS,
    s: FloorModes.STAIRS,
    n: FloorModes.BANNERS,
};

const WALL_HIT_PX = 8;
let selWalls = new Set();

const isSelecting = () => active && !!focused && floorMode === FloorModes.SELECT && !!selectedFloor();

function wallAtScreen(floor, x, y) {
    let best = null, bestD = WALL_HIT_PX;
    for (const w of wallsOf(floor)) {
        const a = toScreen(w.a), b = toScreen(w.b);
        const q = closestOnSegment({ x, y }, a, b);
        const d = Math.hypot(q.x - x, q.y - y);
        if (d <= bestD) { best = w; bestD = d; }
    }
    return best;
}

function segHitsRect(a, b, x0, y0, x1, y1) {          // Liang–Barsky
    let t0 = 0, t1 = 1;
    const dx = b.x - a.x, dy = b.y - a.y;
    const clip = (p, q) => {
        if (p === 0) return q >= 0;
        const t = q / p;
        if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
        else       { if (t < t0) return false; if (t < t1) t1 = t; }
        return true;
    };
    return clip(-dx, a.x - x0) && clip(dx, x1 - a.x) && clip(-dy, a.y - y0) && clip(dy, y1 - a.y);
}

function grabSelect(x, y, shift) {
    const floor = selectedFloor();
    const hit = wallAtScreen(floor, x, y);

    if (hit) {
        if (shift) {                                   // toggle, no drag
            selWalls.has(hit) ? selWalls.delete(hit) : selWalls.add(hit);
            renderEdit();
            return true;
        }
        if (!selWalls.has(hit)) selWalls = new Set([hit]);
        const p0 = normalAt(x, y);
        dragState = {
            kind: "selmove", floor, p0, moved: false,
            items: wallsOf(floor).filter((w) => selWalls.has(w))
                .map((w) => ({ wall: w, a: { ...w.a }, b: { ...w.b } })),
        };
        renderEdit();
        return true;
    }

    dragState = {
        kind: "marquee", floor, x0: x, y0: y, x1: x, y1: y, moved: false, additive: shift,
        prev: new Set(selWalls), base: shift ? new Set(selWalls) : new Set(),
    };
    return true;
}

function dragSelect(d, x, y, passedThreshold) {
    if (!d.moved && !passedThreshold) return;
    d.moved = true;

    if (d.kind === "marquee") {
        d.x1 = x; d.y1 = y;
        const r = [Math.min(d.x0, x), Math.min(d.y0, y), Math.max(d.x0, x), Math.max(d.y0, y)];
        const sel = new Set(d.base);
        for (const w of wallsOf(d.floor)) {
            if (segHitsRect(toScreen(w.a), toScreen(w.b), ...r)) sel.add(w);
        }
        selWalls = sel;
    } else {
        const p = normalAt(x, y);
        const dx = p.x - d.p0.x, dy = p.y - d.p0.y;
        for (const it of d.items) {
            it.wall.a = { x: it.a.x + dx, y: it.a.y + dy };
            it.wall.b = { x: it.b.x + dx, y: it.b.y + dy };
        }
    }
    renderEdit();
}

function releaseSelect(d) {
    if (d.kind === "marquee") {
        if (!d.moved && !d.additive) selWalls.clear();   // click on empty space
        renderEdit();
        return;
    }
    if (!d.moved) { renderEdit(); return; }

    const building = focused, floor = d.floor;
    const before = d.items;
    const after = d.items.map((it) => ({ wall: it.wall, a: { ...it.wall.a }, b: { ...it.wall.b } }));
    const apply = (arr) => {
        for (const s of arr) { s.wall.a = { ...s.a }; s.wall.b = { ...s.b }; }
        reveal(building, floor.id);
    };
    Actions.newAction(() => apply(after), () => apply(before));
    renderEdit();
}

function deleteSelected() {
    const floor = selectedFloor();
    if (!floor) return false;
    const list = wallsOf(floor);
    const items = list.map((w, i) => ({ w, i })).filter((o) => selWalls.has(o.w));
    if (!items.length) return false;

    const building = focused;
    const remove = () => {
        for (const { w } of items) { const i = list.indexOf(w); if (i >= 0) list.splice(i, 1); }
        selWalls.clear();
        reveal(building, floor.id);
    };
    const restore = () => {
        for (const { w, i } of items) if (!list.includes(w)) list.splice(Math.min(i, list.length), 0, w);
        reveal(building, floor.id);
    };
    remove();
    Actions.newAction(remove, restore);
    return true;
}

const DEFAULT_MODE = FloorModes.WALLS;
let floorMode = null;

let active = false;
let focused = null;
let prevView = null;
let els = null;
let showTab = null;

let selectedId = null;
let dragState = null;
let hoverIdx = -1;
let hoverMid = -1;

let nextFloorId = 1;

export const isActive = () => active;
export const isFocused = () => focused !== null;
export const getMode = () => floorMode;

function floorsOf(building) {
    return (building.floors ??= [{ id: nextFloorId++, shape: null }]);
}

const floorLabel = (index) => (index === 0 ? "Térreo" : `${index}º andar`);
const clone = (pts) => pts.map((p) => ({ x: p.x, y: p.y }));
const selectedFloor = () => (focused ? floorsOf(focused).find((f) => f.id === selectedId) ?? null : null);

function pointsOf(building, floor) {
    return floor.shape ?? building.vertices.map((v) => ({ x: v.pos.x, y: v.pos.y }));
}

function area(pts) {
    let s = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
    return Math.abs(s) / 2;
}

function syncModeUI() {
    if (!els) return;
    for (const btn of els.tools) {
        const on = btn.dataset.floorMode === floorMode;
        btn.disabled = !focused;
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-pressed", String(on));
    }
    els.hint?.classList.toggle("hidden", !active || !!focused);
    els.view.dataset.floorMode = floorMode ?? "";
}

export function setMode(mode) {
    const next = focused && Object.values(FloorModes).includes(mode) ? mode : null;
    if (next === floorMode) return;
    if (next !== FloorModes.SELECT) S().refresh();
    cancelDrag();
    floorMode = next;
    hoverIdx = hoverMid = -1;
    if (next !== FloorModes.SELECT) selWalls.clear();
    setCursor("");
    syncModeUI();
    renderEdit();
}

export const toggleMode = (mode) => setMode(floorMode === mode ? null : mode);

export function key(e) {
    if (!active || !focused) return false;
    const k = e.key.toLowerCase();
    if (k === "delete" || k === "backspace") return floorMode === FloorModes.SELECT && deleteSelectedWalls();
    const mode = MODE_KEYS[k];
    if (!mode) return false;
    if (!e.repeat) toggleMode(mode);
    return true;
}


export function goBack() {
    if (!active) return false;
    if (selWalls.size) { selWalls.clear(); renderEdit(); return true; }
    return exit();
}

function render() {
    if (!els || !focused) return;
    const floors = floorsOf(focused);

    els.name.textContent = focused.name || "Construção";
    els.count.textContent = `${floors.length} ${floors.length === 1 ? "andar" : "andares"}`;

    els.list.replaceChildren(
        ...floors.map((floor, index) => {
            const li = document.createElement("li");
            li.className = "floor-item";
            li.dataset.id = String(floor.id);
            li.tabIndex = 0;
            li.classList.toggle("is-selected", floor.id === selectedId);
            li.classList.toggle("is-custom", !!floor.shape);
            li.setAttribute("aria-current", floor.id === selectedId ? "true" : "false");

            const label = document.createElement("span");
            label.className = "floor-label";
            label.textContent = floorLabel(index) + (floor.shape ? " · forma própria" : "");

            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "icon-btn floor-remove";
            remove.setAttribute("aria-label", `Remover ${floorLabel(index)}`);
            remove.title = floors.length === 1 ? "A construção precisa de ao menos um andar" : "Remover andar";
            remove.disabled = floors.length === 1;
            remove.innerHTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i>';

            li.append(label, remove);
            return li;
        })
    );

    const sel = els.list.querySelector(".is-selected");
    if (sel) {
        const l = sel.offsetLeft, r = l + sel.offsetWidth, list = els.list;
        if (l < list.scrollLeft) list.scrollLeft = Math.max(l - 8, 0);
        else if (r > list.scrollLeft + list.clientWidth) list.scrollLeft = r - list.clientWidth + 8;
    }
}

function renderEdit() {
    const floor = selectedFloor();
    if (!active || !focused || !floor) {
        Graficos.setFloorEdit(null);
        return;
    }
    const m = dragState?.kind === "marquee" && dragState.moved ? dragState : null;
    const d = dragState?.kind === "wall" ? dragState : null;
    Graficos.setFloorEdit({
        building: focused,
        points: clone(pointsOf(focused, floor)),
        handles: floorMode === FloorModes.WALLS,
        hover: hoverIdx,
        hoverMid,
        walls: wallsOf(floor).map((w) => ({ a: { ...w.a }, b: { ...w.b } })),
        draft: d?.isNew && d.moved ? { a: { ...d.wall.a }, b: { ...d.wall.b } } : null,
        snap: d?.moved ? d.snap : null,
        selected: floorMode === FloorModes.SELECT
            ? wallsOf(floor).filter((w) => selWalls.has(w)).map((w) => ({ a: { ...w.a }, b: { ...w.b } }))
            : [],
        selected: floorMode === FloorModes.SELECT
            ? S().selected.walls.map((w) => ({ a: { ...w.a }, b: { ...w.b } }))
            : [],
    });
}

function refresh(building) {
    if (focused !== building) return;
    render();
    renderEdit();
}

function record(building, floor, before, after) {
    const apply = (shape) => {
        floor.shape = shape ? clone(shape) : null;
        reveal(building, floor.id);
    };
    Actions.newAction(() => apply(after), () => apply(before));
}

function attachFloor(building, floor, index) {
    const list = floorsOf(building);
    if (!list.includes(floor)) list.splice(index, 0, floor);
}

function detachFloor(building, floor) {
    const list = floorsOf(building);
    const i = list.indexOf(floor);
    if (i >= 0) list.splice(i, 1);
    return i;
}

function addFloor() {
    if (!focused) return;
    const b = focused;
    const floor = { id: nextFloorId++, shape: null };
    const index = floorsOf(b).length;

    cancelDrag();
    attachFloor(b, floor, index);
    selectedId = floor.id;
    render();
    renderEdit();

    Actions.newAction(
        () => { attachFloor(b, floor, index); reveal(b, floor.id); },
        () => { detachFloor(b, floor); reveal(b, null, () => fixSelection(b, index)); },
    );

}

function removeFloor(id) {
    if (!focused) return;
    const b = focused;
    const list = floorsOf(b);
    if (list.length <= 1) return;
    const floor = list.find((f) => f.id === id);
    if (!floor) return;

    cancelDrag();

    const index = detachFloor(b, floor);
    fixSelection(b, index);
    render();
    renderEdit();

    Actions.newAction(
        () => { detachFloor(b, floor); reveal(b, null, () => fixSelection(b, index)); },
        () => { attachFloor(b, floor, index); reveal(b, floor.id); },
    );
}

function selectFloor(id) {
    if (!focused || id === selectedId) return;
    if (!floorsOf(focused).some((f) => f.id === id)) return;
    S().refresh();
    cancelDrag();
    selectedId = id;
    hoverIdx = hoverMid = -1;
    selWalls.clear();
    render();
    renderEdit();
}

export const isEditing = () =>
    active && !!focused && floorMode === FloorModes.WALLS && !!selectedFloor();

const normalAt = (x, y) => Editor.newCoord(x, y, "screen").peekNormal();

function nearestVertex(pts, x, y) {
    const p = normalAt(x, y);
    const R = GRAB_PX / Graficos.zoom;
    let best = -1, bestD = R * R;
    for (let i = 0; i < pts.length; i++) {
        const d = (pts[i].x - p.x) ** 2 + (pts[i].y - p.y) ** 2;
        if (d <= bestD) { best = i; bestD = d; }
    }
    return best;
}

function nearestMid(pts, x, y) {
    const p = normalAt(x, y);
    const R = MID_GRAB_PX / Graficos.zoom;
    const minLen = MID_MIN_PX / Graficos.zoom;
    const n = pts.length;
    let best = null, bestD = R * R;
    for (let k = 0; k < n; k++) {
        const a = pts[k], b = pts[(k + 1) % n];
        if (Math.hypot(a.x - b.x, a.y - b.y) < minLen) continue;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const d = (mx - p.x) ** 2 + (my - p.y) ** 2;
        if (d <= bestD) { best = { index: k, x: mx, y: my }; bestD = d; }
    }
    return best;
}

const currentPts = () => pointsOf(focused, selectedFloor());

export function vertexAt(x, y) {
    if (!isEditing()) return -1;
    return nearestVertex(currentPts(), x, y);
}

export function editHover(x, y) {
    if (isSelecting()) return wallAtScreen(selectedFloor(), x, y) ? "move" : "crosshair";
    if (!isEditing()) return null;
    const pts = currentPts();
    const v = nearestVertex(pts, x, y);
    const onEnd = v < 0 && nearestWallEnd(selectedFloor(), x, y);
    const m = v >= 0 || onEnd ? null : nearestMid(pts, x, y);
    const mi = m ? m.index : -1;
    if (v !== hoverIdx || mi !== hoverMid) {
        hoverIdx = v;
        hoverMid = mi;
        renderEdit();
    }
    return v >= 0 || onEnd ? "move" : "crosshair";
}

export function grab(x, y, shift = false) {
    if (isSelecting()) return grabSelect(x, y, shift);
    if (!isEditing()) return false;
    const floor = selectedFloor();
    const pts = pointsOf(focused, floor);
    const before = floor.shape ? clone(floor.shape) : null;

    let index = nearestVertex(pts, x, y);
    let inserted = false;

    if (index >= 0) {
        floor.shape = clone(pts);                  // first edit: the floor stops following the building
    } else {
        const wallEnd = nearestWallEnd(floor, x, y);
        if (wallEnd) return startWallEdit(floor, wallEnd);

        const mid = nearestMid(pts, x, y);
        if (!mid) return startWall(floor, pts, x, y);
        const shape = clone(pts);
        index = mid.index + 1;
        shape.splice(index, 0, { x: mid.x, y: mid.y });
        floor.shape = shape;
        inserted = true;
    }

    dragState = { floor, index, before, inserted, moved: false, mergeIdx: -1 };
    hoverIdx = index;
    hoverMid = -1;
    renderEdit();
    return true;
}

export function dragTo(x, y, shift, passedThreshold) {
    const d = dragState;
    if (!d) return;
    if (d.kind === "marquee" || d.kind === "selmove") return dragSelect(d, x, y, passedThreshold);
    if (d.kind === "wall") return dragWall(d, x, y, shift, passedThreshold);
    if (!d.moved && !passedThreshold) return;      // a small tremor is still a click
    d.moved = true;

    const shape = d.floor.shape;
    let coord = Editor.newCoord(x, y, "screen");
    if (shift) {
        const others = shape.filter((_, k) => k !== d.index).map((p) => ({ pos: p }));
        coord = snapCoordinate(coord, others, { enabled: true, threshold: AXIS_SNAP_PX }).coordinate;
    }
    const n = coord.getIn("normal");

    // near another vertex of the same floor: snap onto it (merged on release). Keep at least 3 points.
    let mergeIdx = -1;
    if (shape.length > 3) {
        const R = Editor.MERGE_RADIUS_PX / Graficos.zoom;
        let bestD = R * R;
        for (let k = 0; k < shape.length; k++) {
            if (k === d.index) continue;
            const dd = (shape[k].x - n.x) ** 2 + (shape[k].y - n.y) ** 2;
            if (dd <= bestD) { mergeIdx = k; bestD = dd; }
        }
    }
    const target = mergeIdx >= 0 ? shape[mergeIdx] : n;
    shape[d.index] = { x: target.x, y: target.y };
    d.mergeIdx = mergeIdx;
    hoverIdx = mergeIdx >= 0 ? mergeIdx : d.index;   // highlights the vertex that receives the merge
    renderEdit();
}

export function release() {
    const d = dragState;
    dragState = null;
    if (!d || !focused) return;
    if (d.kind === "marquee" || d.kind === "selmove") { releaseSelect(d); return; }
    if (d.kind === "wall") { releaseWall(d); return; }

    const floor = d.floor;
    if (!d.moved && !d.inserted) {                 // plain click on a vertex: nothing changed
        floor.shape = d.before;
        renderEdit();
        return;
    }
    if (d.mergeIdx >= 0) {
        if (d.inserted) {                          // a new vertex dropped on another: nothing to record
            floor.shape = d.before;
            hoverIdx = -1;
            renderEdit();
            return;
        }
        floor.shape.splice(d.index, 1);            // the two vertices become one
    }
    hoverIdx = -1;
    if (area(floor.shape) < MIN_AREA) {
        floor.shape = d.before;
        Toasts.toaster.show({ text: "Essa forma não tem área.", category: "warn" });
        renderEdit();
        return;
    }
    record(focused, floor, d.before, clone(floor.shape));
    render();                                       // "forma própria" label
    renderEdit();
}

export function cancelDrag() {
    const d = dragState;
    dragState = null;
    if (!d) return;
    if (d.kind === "wall") {
        if (!d.isNew) { d.wall.a = { ...d.before.a }; d.wall.b = { ...d.before.b }; }
    } else {
        d.floor.shape = d.before;
    }
    renderEdit();
}

export function removeVertex(index) {
    if (!isEditing()) return false;
    const floor = selectedFloor();
    const pts = pointsOf(focused, floor);
    if (!pts[index]) return false;
    if (pts.length <= 3) {
        Toasts.toaster.show({ text: "Um andar precisa de pelo menos 3 pontos.", category: "warn" });
        return false;
    }

    const shape = clone(pts);
    shape.splice(index, 1);
    if (area(shape) < MIN_AREA) {
        Toasts.toaster.show({ text: "Essa forma não tem área.", category: "warn" });
        return false;
    }

    const before = floor.shape ? clone(floor.shape) : null;
    floor.shape = shape;
    hoverIdx = hoverMid = -1;
    record(focused, floor, before, clone(shape));
    render();
    renderEdit();
    return true;
}

/* ------------------------------- Focus / zoom-in ------------------------------- */
function viewCenterWorld() {
    const vp = Graficos.getViewport();
    const o = Graficos.canvasOrigin();
    return Graficos.getNormalizedCoordinates({ x: vp.cx + o.x, y: vp.cy + o.y });
}

export function focus(building) {
    if (!active || focused || !building) return;

    prevView = { zoom: Graficos.zoom, point: viewCenterWorld() };
    focused = building;
    selectedId = floorsOf(building)[0].id;
    S().refresh();
    hoverIdx = hoverMid = -1;
    floorMode = DEFAULT_MODE;

    selWalls.clear();

    Graficos.setFocusedBuilding?.(building);

    // fit the building in the free area. The floors bar is at the bottom and still closed here,
    // so its height is subtracted by hand.
    const b = building.bounds();
    const vp = Graficos.getViewport();
    const availW = Math.max(vp.width, 120);
    const availH = Math.max(vp.height - (els.panel.offsetHeight || 0), 120);
    const radius = Math.hypot(b.maxX - b.minX, b.maxY - b.minY) / 2 || 1;
    const target = (Math.min(availW, availH) / (2 * radius)) * FIT;

    render();
    renderEdit();
    syncModeUI();
    els.view.classList.add("is-focused");
    els.panel.classList.add("is-open");
    els.panel.setAttribute("aria-hidden", "false");

    Graficos.animateTransform({
        point: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 },
        zoom: target,
        duration: ZOOM_DURATION,
    });
}

/** Back to the overview. Returns true if there was something to leave (for Esc). */
export function exit({ instant = false } = {}) {
    if (!focused) return false;

    cancelDrag();
    focused = null;
    S().refresh();
    selectedId = null;
    hoverIdx = hoverMid = -1;
    floorMode = null;
    setCursor("");

    selWalls.clear();
    // focus();
    // selectFloor();

    Graficos.setFocusedBuilding?.(null);
    Graficos.setFloorEdit(null);
    els.view.classList.remove("is-focused");
    els.panel.classList.remove("is-open");
    els.panel.setAttribute("aria-hidden", "true");
    syncModeUI();

    if (prevView && !instant) {
        Graficos.animateTransform({ point: prevView.point, zoom: prevView.zoom, duration: ZOOM_DURATION });
    }
    prevView = null;
    return true;
}

/* ----------------------------------- Input ----------------------------------- */
function buildingAt(clientX, clientY) {
    const coord = Editor.newCoord(clientX, clientY, "screen");
    const b = Editor.Buildings.getOverlappingPins(coord) || Editor.Buildings.getOverlappingBuildings(coord);
    return b && b.closed && b.enabled ? b : null;
}

export function pick(clientX, clientY) {
    if (!active || focused) return false;
    const b = buildingAt(clientX, clientY);
    if (b) focus(b);
    return !!b;
}

export function hover(clientX, clientY) {
    return active && !focused ? buildingAt(clientX, clientY) : null;
}

export function setActive(on) {
    if (active === on) return;
    active = on;
    S().scope = on ? "floor" : "map";       // before exit(): its refresh runs in the right scope
    if (!on) exit({ instant: true });
    S().refresh();
    syncModeUI();
}

async function reveal(building, floorId, adjust) {
    if (!active) {
        await showTab?.("buildings");
        if (!active) return;
    }
    if (focused !== building) {
        if (focused) exit({ instant: true });
        focus(building);
    }
    adjust?.();
    if (floorId != null && floorsOf(building).some((f) => f.id === floorId)) selectedId = floorId;
    render();
    renderEdit();
}

function fixSelection(building, index) {
    if (focused !== building) return;
    const list = floorsOf(building);
    if (!list.some((f) => f.id === selectedId)) {
        selectedId = list[Math.min(index, list.length - 1)].id;
    }
}

export function init({ showTab: show } = {}) {
    showTab = show ?? null;
    S().wallSource = () => { const f = selectedFloor(); return f ? wallsOf(f) : []; };
    S().floorRef = () => {
        const b = focused, f = selectedFloor();
        return b && f ? () => reveal(b, f.id) : null;
    };
    S().onWallsChanged = () => { if (active) renderEdit(); };

    els = {
        view: document.getElementById("view-buildings"),
        panel: document.getElementById("floors"),
        name: document.getElementById("floors-building-name"),
        count: document.getElementById("floors-count"),
        list: document.getElementById("floors-list"),
        add: document.getElementById("floors-add"),
        back: document.getElementById("floors-back"),
        hint: document.getElementById("floors-hint-bar"),
        tools: [...document.querySelectorAll("[data-floor-mode]")],
    };
    if (!els.view || !els.panel) return;

    els.add.addEventListener("click", addFloor);
    els.back.addEventListener("click", () => exit());
    els.list.addEventListener("click", (e) => {
        const remove = e.target.closest(".floor-remove");
        const item = e.target.closest(".floor-item");
        if (!item) return;
        const id = Number(item.dataset.id);
        if (remove) {
            if (!remove.disabled) removeFloor(id);
        } else {
            selectFloor(id);
        }
    });
    els.list.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const item = e.target.closest(".floor-item");
        if (!item || e.target !== item) return;
        e.preventDefault();
        selectFloor(Number(item.dataset.id));
    });

    for (const btn of els.tools) {
        btn.addEventListener("click", () => toggleMode(btn.dataset.floorMode));
    }
    syncModeUI();
}