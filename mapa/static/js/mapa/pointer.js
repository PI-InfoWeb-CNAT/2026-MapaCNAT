import * as Floors from './editor/floors.js';
import * as Transformacao from "./transformacao.js";
import * as Graficos from "./graficos.js";
import * as Editor from "./objects.js";
import * as Localizacao from './localizacao.js';
import * as Versions from './editor/versions.js';
import * as Tools from './editor/tools.js';
import {
    EditorModes, editorMode, Actions,
    clearAllSplitPreviews, clearSplitPreview, showStartPreview, showSplitPreview,
    setCursor, splitHit, selectionState,
    AXIS_SNAP_PX, nearFirstVertex, snapCoordinate,
} from './editor/action.js';

let page;
let mapObj;
let zoomStep;

let floorGrab = false;   // dragging a floor vertex
let rightFloor = -1;

const DOUBLE_CLICK_MS = 350;
const DOUBLE_CLICK_DIST = 24;
const LONG_PRESS_MS = 500;
const ROTATION_SNAP = Math.PI / 8;

let pressedType = "none";
let panStarted = false;
let dragStarted = false;
let rightVertex = null;
let moved;

let lastTap = null;
let longPressTimer = 0;
let longPressFired = false;

let leftClicking = false;
let rightClicking = false;
let touching = false;
let pinching = false;

let mapStartX, mapStartY, mapStartAngle;
let clickX, clickY;
let touchX, touchY;
let startMidX, startMidY;
let startDistance, startAngle;
let startZoom, startRotation;
let startOffsetX, startOffsetY;
let rotateOffsetX = 0, rotateOffsetY = 0;

let pressedTarget = null;
let pendingMainMove = null;
let mainMoveRaf = 0;

let hoverSet = new Set();
let hoverTargetSet = new Set();

let panGesture = false;     // pan iniciado com X (o arrasto continua mesmo se soltar o X)
let quickPan = false;       // X está pressionado
let selClick = null;        // { pick, additive } do pointerdown atual no modo Seleção
let selDragging = false;    // passou do limiar: é arrasto, não clique
let selBefore = null;       // seleção antes do gesto atual (para virar ação)

let carrying = null;

const selectMode = () => editorMode === EditorModes.SELECTION || Floors.isSelectMode();

export function setContext(context) {
    page = context.page;
    zoomStep = context.scroll_ratio;
}

/** Small window into the private gesture state, for Keys (interacao.js). */
export const gesture = {
    get pan() { return panGesture; },
    set pan(v) { panGesture = v; },
    get quickPan() { return quickPan; },
    set quickPan(v) { quickPan = v; },
    clearDrag() { dragStarted = false; },
};

export function gestureActive() {
    const held = Tools.Holdable.object && !["banner", "phantomVertex"].includes(Tools.Holdable.type);
    return leftClicking || rightClicking || panGesture || !!held;
}

export function cancelPointer() {
    Pointer.cancel();
}

// =====================================================================
// URL / camera helpers
// =====================================================================

export function updateUrlParams(paramsObj, specialUrl) {
    let url = specialUrl;
    let winUrl = false;
    if (!specialUrl) {
        winUrl = true;
        url = new URL(window.location.href);
    }

    for (const [key, value] of Object.entries(paramsObj)) {
        if (value === null || value === undefined) {
            url.searchParams.delete(key);
        } else {
            url.searchParams.set(key, value);
        }
    }
    if (winUrl) {
        window.history.replaceState({}, '', url);
    }
}

export function buildURL(url, param) {
    const newUrl = new URL(url);
    updateUrlParams(param, newUrl);
    return newUrl;
}

export function goToPlace(place, zoomVal) {
    Graficos.animateTransform({ point: place.coordinate.getIn("normal"), zoom: zoomVal });
}

// =====================================================================
// helpers
// =====================================================================

const entranceSnapshot = (b) =>
    b.entrances.filter(r => r.enabled).map(r => ({ dot: r, pos: { ...r.coordinate.pos } }));

function passedDragThreshold(e) {
    const limit = e.pointerType === "touch" ? 10 : 4;
    return Math.hypot(e.clientX - clickX, e.clientY - clickY) >= limit;
}

function normalCoordAt(x, y) {
    const c = Editor.newCoord(x, y, "screen");
    c.convertTo("normal");
    return c;
}

function isInside(event, target) {
    const element =
        typeof target === "string" ? document.querySelector(target) : target;

    if (!element) return false;

    const rect = element.getBoundingClientRect();

    return (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
    );
}

// ---------- construction ----------

function updatePhantomVertex(coordinate, e) {
    const building =
        Tools.Task.task === "build" && Tools.Task.taskStep === 1
            ? Tools.Task.data["buildObject"]
            : null;

    if (!building || building.closed || !building.vertices.length) {
        if (Tools.Holdable.type === "phantomVertex") {
            Tools.Holdable.set(false);
        }

        Editor.SnapGuides.clearAll();
        return false;
    }

    const raw = coordinate.getIn("normal");

    const overClose =
        building.vertices.length >= 3 &&
        nearFirstVertex(building, raw);

    let finalCoord;

    if (overClose) {
        finalCoord = Editor.newCoord(
            building.vertices[0].pos.x,
            building.vertices[0].pos.y,
            "normal"
        );

        Editor.SnapGuides.clearAll();
    } else {
        const snap = snapCoordinate(
            coordinate,
            building.vertices,
            {
                enabled: e.shiftKey,
                threshold: AXIS_SNAP_PX,
            }
        );

        finalCoord = snap.coordinate;

        Editor.SnapGuides.update(snap.guides);
    }

    if (Tools.Holdable.type !== "phantomVertex" || Tools.Holdable.object !== building) {
        Tools.Holdable.set(building, "phantomVertex", false, new Editor.PhantomVertex(building, finalCoord));
    } else {
        Tools.Holdable.phantomObject.setEndPoint(finalCoord);
    }

    return overClose;
}

function grabBuildingTarget(x, y) {
    Tools.Holdable.set(false);
    const coord = Editor.newCoord(x, y, "screen");

    const vtx = Editor.Buildings.getOverlappingVertex(coord);
    if (vtx) {
        const b = vtx.building;
        Tools.Holdable.set(b, "buildingVertex", {
            index: vtx.index,
            pos: { ...b.vertices[vtx.index].pos },
            entrances: entranceSnapshot(b),
        });
        return;
    }

    const mid = Editor.Buildings.getOverlappingMid(coord);
    if (mid) {
        const b = mid.building;
        const entrances = entranceSnapshot(b);
        const index = mid.index + 1;
        Editor.Buildings.setHoverMid(null);
        b.insertVertex(index, Editor.newCoord(mid.pos.x, mid.pos.y, "normal"));
        Tools.Holdable.set(b, "buildingVertex", { index, pos: { ...mid.pos }, entrances, inserted: true });
        return;
    }

    const pin = Editor.Buildings.getOverlappingPins(coord);
    if (pin) {
        const n = normalCoordAt(x, y).pos;
        Tools.Holdable.set(pin, "buildingPin", {
            pos: { ...pin.coordinate.pos },
            offset: { x: n.x - pin.coordinate.pos.x, y: n.y - pin.coordinate.pos.y },
        });
    }
}

function dragBuildingTarget(e) {
    if (Tools.Holdable.type === "buildingVertex") {
        if (!dragStarted && !passedDragThreshold(e)) return true;
        dragStarted = true;

        const b = Tools.Holdable.object;
        const i = Tools.Holdable.initialPos.index;
        const others = b.vertices.filter((_, k) => k !== i);
        const snap = snapCoordinate(
            Editor.newCoord(e.clientX, e.clientY, "screen"),
            others,
            { enabled: e.shiftKey, threshold: AXIS_SNAP_PX },
        );

        let hit = Editor.Buildings.nearestVertex(
            snap.coordinate.peekNormal(),
            Editor.MERGE_RADIUS_PX / Graficos.zoom,
            b, i,
        );
        // com 3 vértices, fundir dois da mesma construção a degeneraria
        if (hit && hit.building === b && b.vertices.length <= 3) hit = null;

        // destaca o vértice que vai receber o merge
        Editor.Buildings.setHoverVertex(hit ? { building: hit.building, index: hit.index } : null);

        const target = hit ? Editor.newCoord(hit.pos.x, hit.pos.y, "normal") : snap.coordinate;
        Editor.SnapGuides.update(hit ? {} : snap.guides);
        b.moveVertex(i, target);
        Editor.Buildings.reattachEntrances(b);
        return true;
    }

    if (Tools.Holdable.type === "buildingPin") {
        if (!dragStarted && !passedDragThreshold(e)) return true;
        dragStarted = true;

        const off = Tools.Holdable.initialPos.offset;
        const n = normalCoordAt(e.clientX, e.clientY).pos;
        Tools.Holdable.object.move(Editor.newCoord(n.x - off.x, n.y - off.y, "normal"));
        return true;
    }

    return false;
}

function hoverBuildingTarget(e) {
    const coord = Editor.newCoord(e.clientX, e.clientY, "screen");
    const vtx = Editor.Buildings.getOverlappingVertex(coord);
    Editor.Buildings.setHoverVertex(vtx);
    const mid = vtx ? null : Editor.Buildings.getOverlappingMid(coord);
    Editor.Buildings.setHoverMid(mid);
    const pin = (vtx || mid) ? false : Editor.Buildings.getOverlappingPins(coord);
    if (pin) hoverTargetSet.add(pin);
    setCursor(vtx ? "move" : mid ? "crosshair" : pin ? "pointer" : "");
}

function releaseBuildingTarget() {
    if (Tools.Holdable.type === "buildingVertex") {
        if (dragStarted || Tools.Holdable.initialPos.inserted) Actions.moveVertex(Tools.Holdable);
        Editor.Buildings.setHoverVertex(null);
        Editor.SnapGuides.clearAll();
        Tools.Holdable.set(false);
    } else if (Tools.Holdable.type === "buildingPin") {
        const building = Tools.Holdable.object;
        if (dragStarted) Actions.moveBuildingPin(Tools.Holdable);
        else Actions.openModal("buildRename", { building });   // simple click
        Tools.Holdable.set(false);
    }
    dragStarted = false;
}

// ---------- main page ----------

function pickMainTarget(coord) {
    coord.convertTo("normal"); // uma conversão só, em vez de uma por consulta

    let ref;
    if ((ref = Editor.Self.getOverlappingPin(coord))) return { type: "selfPin", ref };
    if ((ref = Editor.Referencer.getOverlappingDotPins(coord))) return { type: "refPin", ref };
    if ((ref = Editor.Buildings.getOverlappingBuildings(coord))) return { type: "area", ref };
    if ((ref = Editor.Buildings.getOverlappingPins(coord))) return { type: "buildPin", ref };

    return { type: "none", ref: null };
}

// At most one map update per frame, no matter how often pointermove fires
function scheduleMainMove(e) {
    pendingMainMove = { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey };
    if (mainMoveRaf) return;
    mainMoveRaf = requestAnimationFrame(() => {
        mainMoveRaf = 0;
        const m = pendingMainMove;
        pendingMainMove = null;
        if (m) applyMainMove(m);
    });
}

function flushMainMove() {
    if (mainMoveRaf) {
        cancelAnimationFrame(mainMoveRaf);
        mainMoveRaf = 0;
    }
    if (pendingMainMove) {
        const m = pendingMainMove;
        pendingMainMove = null;
        applyMainMove(m);
    }
}

function applyMainMove(m) {
    if (rightClicking) {
        Pointer.rotateMove(m);
    } else if (leftClicking) {
        Pointer.defaultMove(m);
    } else {
        const pin = pickMainTarget(Editor.newCoord(m.clientX, m.clientY, "screen")).ref;
        hoverTargetSet = new Set();
        if (pin) hoverTargetSet.add(pin);
        setCursor(pin ? "pointer" : "default");
    }
}

function placeMarker(coord) {
    coord.convertTo("normal");
    coord = Editor.Connections.snap(coord);   // autosnap em até 10px de uma conexão
    Editor.TouchPin.setPos(coord);
    Editor.TouchPin.setVisible(true);
    const g = Localizacao.mapToGeographical(coord.pos);
    if (!Array.isArray(g) || !Number.isFinite(g[0]) || !Number.isFinite(g[1])) return;
    updateUrlParams({ showpin: undefined, lat: g[0], long: g[1] });
}

function startLongPress(x, y) {
    clearLongPress();
    longPressTimer = setTimeout(() => {
        longPressTimer = 0;
        if (moved || pinching || !leftClicking) return;
        longPressFired = true;
        navigator.vibrate?.(20);
        placeMarker(Editor.newCoord(x, y, "screen"));
    }, LONG_PRESS_MS);
}

function clearLongPress() {
    clearTimeout(longPressTimer);
    longPressTimer = 0;
}

// ---------- selection gesture ----------

function endSelectionGesture() {
    finishSelectionClick();
    Actions.recordSelection(selBefore);
    selBefore = null;
}

function finishSelectionClick() {
    const c = selClick;
    selClick = null;
    if (!c || selDragging || !c.pick) return;
    Editor.SelectRegion.pick(c.pick, c.additive);
    setCursor("");
}

// ---------- edge-carry while dragging a selection ----------

function stopCarry() {
    if (carrying) {
        clearInterval(carrying);
    }
}

function startCarry(e) {
    carryView(e);
    carrying = setInterval(() => {
        carryView(e);
        let here = Editor.newCoord(e.clientX, e.clientY, "screen");
        Editor.SelectRegion.updateResize(here, e.shiftKey);
        Editor.SelectRegion.move(here, selectionState.vertexSelect);
    }, 1000 / 60);
}

function carryView(e) {
    const rect = mapObj.getBoundingClientRect();
    const vp = Graficos.getViewport();
    const pad = 100, spd = 5;

    const inX = e.clientX > rect.left && e.clientX < rect.right;
    const inY = e.clientY > rect.top && e.clientY < rect.bottom;

    const left   = inX && e.clientX < vp.x + pad;
    const right  = inX && e.clientX > vp.x + vp.width - pad;
    const top    = inY && e.clientY < vp.y + pad;
    const bottom = inY && e.clientY > vp.y + vp.height - pad;

    Graficos.setPosition(
        Graficos.mapContainer.x + (left ? spd : right ? -spd : 0),
        Graficos.mapContainer.y + (top ? spd : bottom ? -spd : 0),
    );
}

// =====================================================================
// Touch
// =====================================================================

class Touch {
    constructor() {
        throw new Error("Classe estática. Não instancie.");
    }

    static begin(e) {
        if (Graficos.smoothTransform) {
            return;
        }
        touching = true;
        if (e.touches.length >= 2) {
            clearLongPress();
            pinching = true;
            moved = true;
            pressedTarget = null;
        }
        if (e.touches.length == 2) {
            const a = e.touches[0];
            const b = e.touches[1];
            const o = Graficos.canvasOrigin();
            const mid = Transformacao.midpoint(a, b);
            startMidX = mid.x - o.x;
            startMidY = mid.y - o.y;
            startDistance = Transformacao.distance(a, b);
            startAngle = Transformacao.angle(a, b);
            startZoom = Graficos.zoom;
            startRotation = Graficos.mapContainer.rotation;
            startOffsetX = (Graficos.mapContainer.x - startMidX) / startZoom;
            startOffsetY = (Graficos.mapContainer.y - startMidY) / startZoom;
        }
    }

    static step(e) {
        if (Graficos.smoothTransform) {
            return;
        }

        if (!touching) return;
        if (e.touches.length == 1) {
            let touch = e.touches[0];
            Graficos.setPosition(
                mapStartX + (touch.clientX - touchX),
                mapStartY + (touch.clientY - touchY),
            );
        }
        if (e.touches.length == 2) {
            const a = e.touches[0];
            const b = e.touches[1];
            const mid = Transformacao.midpoint(a, b);
            const currentDistance = Transformacao.distance(a, b);
            const currentAngle = Transformacao.angle(a, b);

            const zoom = Math.min(Math.max(startZoom * (currentDistance / startDistance), Graficos.minZoom), Graficos.maxZoom);

            Graficos.setZoom(zoom);
            Graficos.updateMap();

            const deltaAngle = currentAngle - startAngle;
            Graficos.setRotation((startRotation + deltaAngle) % (2 * Math.PI));

            const rotated = Transformacao.rotatePoint(
                startOffsetX,
                startOffsetY,
                deltaAngle,
            );
            const o = Graficos.canvasOrigin();
            Graficos.setPosition(
                mid.x - o.x + rotated.x * zoom,
                mid.y - o.y + rotated.y * zoom,
            );
        }
    }

    static end(e) {
        if (e.touches.length === 0) {
            touching = false;
            pinching = false;
        }
    }
}

// =====================================================================
// Pointer
// =====================================================================

class Pointer {
    constructor() {
        throw new Error("Classe estática. Não instancie.");
    }

    static down(e) {
        if (!e.isPrimary || pinching) return;

        if (Graficos.smoothTransform) {
            return;
        }

        clickX = e.clientX;
        clickY = e.clientY;
        mapStartX = Graficos.mapContainer.x;
        mapStartY = Graficos.mapContainer.y;
        mapStartAngle = Graficos.mapContainer.rotation;
        const o = Graficos.canvasOrigin();
        rotateOffsetX = mapStartX - (clickX - o.x);
        rotateOffsetY = mapStartY - (clickY - o.y);

        if (e.button === 0) leftClicking = true;
        else if (e.button === 2) {
            rightClicking = true;
        }

        if (e.target === mapObj) mapObj.setPointerCapture?.(e.pointerId);

        moved = false;
        dragStarted = false;
        panStarted = false;
        pressedTarget = null;
        rightVertex = null;
        floorGrab = false;
        rightFloor = -1;

        if (page == "main") {
            if (e.button === 0) {
                let target = pickMainTarget(Editor.newCoord(clickX, clickY, "screen"));
                pressedTarget = target.ref;
                pressedType = target.type;
                if ((!target.ref || target.type === "area") && e.pointerType !== "mouse") {
                    startLongPress(clickX, clickY);
                }
            }
            return;
        } else if (page == "editor") {
            Versions.close();
            if (e.button === 2 && editorMode == EditorModes.CONSTRUCTION && !Tools.Task.task) {
                rightVertex = Editor.Buildings.getOverlappingVertex(Editor.newCoord(clickX, clickY, "screen"));
            }
            if (Floors.isActive()) {
                if (e.button === 2) rightFloor = Floors.vertexAt(clickX, clickY);
                else if (e.button === 0 && !quickPan) floorGrab = Floors.grab(clickX, clickY, e.shiftKey);
            }
            if (e.button !== 0) return;
           
            if (quickPan) { panGesture = true; setCursor("grabbing"); return; }
            if (selectMode()) {
                const S = Editor.SelectRegion;
                const here = Editor.newCoord(clickX, clickY, "screen");
                const zone = S.hitZone(clickX, clickY);
                const additive = e.shiftKey;
                const pick = S.pickAt(here, selectionState.vertexSelect);   // antes do start(): ele converte `here`

                selBefore = S.snapshot();
                selDragging = false;
                selClick = { pick, additive };

                const takeover = zone?.kind === "move" && additive && pick && !S.isSelected(pick);

                if (zone && !takeover) S.beginGesture(zone, here);
                else S.start(here, { keep: additive });
            } else if (editorMode == EditorModes.REFERENCE) {
                let coord = Editor.newCoord(clickX, clickY, "screen");
                let overlap = Editor.Referencer.getOverlappingDots(coord, false);
                Tools.Holdable.set(false);
                if (overlap) {
                    const n = normalCoordAt(clickX, clickY).pos;
                    const p = overlap.coordinate.pos;
                    Tools.Holdable.set(overlap, "reference", {
                        ...p,
                        off: { x: n.x - p.x, y: n.y - p.y },
                    });
                } else {
                    Actions.newReference(clickX, clickY);
                }
            } else if (editorMode == EditorModes.DELETION) {
                const coord = normalCoordAt(clickX, clickY);
                const dot = Editor.Referencer.getOverlappingDots(coord, false);
                if (dot) {
                    Actions.destroyReference(dot);
                } else {
                    const line = Editor.Connections.getOverlappingLines(coord, false);
                    if (line) {
                        Actions.destroyConnection(line);
                    } else {
                        const building =
                            Editor.Buildings.getOverlappingPins(coord) ||
                            Editor.Buildings.getOverlappingBuildings(coord, false);
                        if (building) Actions.destroyBuilding(building);
                    }
                }
            } else if (editorMode == EditorModes.CONNECTION) {
                const coord = Editor.newCoord(clickX, clickY, "screen");
                const overlap = Editor.Referencer.getOverlappingDots(coord, false);

                Tools.Holdable.set(false);
                clearAllSplitPreviews();

                if (overlap) {
                    Tools.Holdable.set(overlap, "connectionReference", false, new Editor.PhantomConnection(overlap));
                } else {
                    const hit = Editor.Connections.findSplitAt(coord.peekNormal(), { avoidWalls: true });
                    if (hit) {
                        const phantom = new Editor.PhantomConnection(Editor.newCoord(hit.x, hit.y, "normal"));
                        phantom.startSplitHit = hit;
                        Tools.Holdable.set(hit.connection, "connectionSplitReference", false, phantom);
                        showStartPreview(hit);
                    }
                }
            } else if (editorMode == EditorModes.CONSTRUCTION) {
                if (Tools.Task.task == "build") {
                    if (Tools.Task.taskStep == 0 && isInside(e, mapObj)) {
                        Actions.openModal("buildName", { x: clickX, y: clickY });
                    }
                } else {
                    grabBuildingTarget(clickX, clickY);
                }
            } else if (editorMode == EditorModes.BANNER) {
                let coord = Editor.newCoord(e.clientX, e.clientY, "screen");
                let overlapDots = Editor.Referencer.getOverlappingDots(coord);
                let overlapPins = Editor.Buildings.getOverlappingPins(coord);
                if (overlapDots) {
                    Actions.openBanner(overlapDots);
                } else if (overlapPins) {
                    Actions.openBanner(overlapPins);
                } else {
                    Actions.requestCloseBanner();
                }
            }
        }
    }

    static defaultMove(e) {
        Graficos.setPosition(
            mapStartX + (e.clientX - clickX),
            mapStartY + (e.clientY - clickY),
        );
    }

    static rotateMove(e) {
        const rawRotation = mapStartAngle + (e.clientX - clickX) / 300;
        const nearestSnap = Math.round(rawRotation / ROTATION_SNAP) * ROTATION_SNAP;
        const snapThreshold = ROTATION_SNAP * 0.2;

        const rotation = (e.shiftKey && Math.abs(rawRotation - nearestSnap) <= snapThreshold)
            ? nearestSnap
            : rawRotation;

        const delta = rotation - mapStartAngle;

        Graficos.setRotation(rotation);

        const p = Transformacao.rotatePoint(
            rotateOffsetX,
            rotateOffsetY,
            delta
        );

        const o = Graficos.canvasOrigin();
        Graficos.setPosition(
            clickX - o.x + p.x,
            clickY - o.y + p.y
        );
    }

    static move(e) {
        if (!e.isPrimary || pinching) return;

        if (Graficos.smoothTransform) {
            return;
        }

        if (page == "main") {
            if ((leftClicking || rightClicking) && !moved) {
                if (!passedDragThreshold(e)) return;   // tremida não cancela o toque nem o long-press
                moved = true;
                clearLongPress();
                hoverTargetSet = new Set();
                setCursor("default");
            }
            scheduleMainMove(e);
            return;
        }

        moved = true;
        clearLongPress();

        if (page == "editor" && rightClicking) {
            if (rightVertex || rightFloor >= 0) {
                if (!passedDragThreshold(e)) return;   // tremida ainda é clique
                rightVertex = null;
                rightFloor = -1;                       // virou rotação: não apaga
            }
            Pointer.rotateMove(e);
            Editor.SelectRegion.onCameraRotate();
            return;
        }

        if (page == "editor" && (panGesture || quickPan)) {
            hoverTargetSet = new Set();
            if (panGesture && leftClicking) Pointer.defaultMove(e);
            return;
        }

        hoverTargetSet = new Set();

        stopCarry();

        if (page == "editor") {
            if (selectMode()) {
                const S = Editor.SelectRegion;
                const here = Editor.newCoord(e.clientX, e.clientY, "screen");

                if (leftClicking && (S.resizing || S.startCoord)) {
                    if (!selDragging && !passedDragThreshold(e)) return;   // tremida ainda é clique
                    selDragging = true;
                }

                if (S.resizing) {
                    S.updateResize(here, e.shiftKey);   // Shift continua = redimensionar rígido / girar em 15°
                    startCarry(e);
                } else if (leftClicking) {
                    S.move(here, selectionState.vertexSelect);
                    startCarry(e);
                } else {
                    setCursor(S.cursorForZone(S.hitZone(e.clientX, e.clientY)));
                }
            } else if (editorMode == EditorModes.FREE) {
                if (Floors.isActive()) {
                    if (floorGrab) {
                        Floors.dragTo(e.clientX, e.clientY, e.shiftKey, passedDragThreshold(e));
                        return;
                    }
                    const b = Floors.hover(e.clientX, e.clientY);
                    if (b) hoverTargetSet.add(b);
                    const editCursor = Floors.editHover(e.clientX, e.clientY);
                    setCursor(b ? "pointer" : (editCursor ?? ""));
                }
                if (!leftClicking) return;
                Pointer.defaultMove(e);
            } else if (editorMode == EditorModes.REFERENCE) {
                const coord = Editor.newCoord(e.clientX, e.clientY, "screen");
                if (Tools.Holdable.object) {
                    const obj = Tools.Holdable.object;
                    obj.move(coord, false, true);

                    const target = Editor.Referencer.findMergeTarget(obj);
                    if (target) {
                        const off = Tools.Holdable.initialPos.off ?? { x: 0, y: 0 };
                        const n = normalCoordAt(e.clientX, e.clientY).pos;
                        obj.move(Editor.newCoord(n.x - off.x, n.y - off.y, "normal"), false, true);
                        hoverTargetSet.add(target);
                        clearSplitPreview();
                    } else {
                        showSplitPreview(Editor.Connections.findSplitTarget(obj));
                    }
                } else {
                    const overlap = Editor.Referencer.getOverlappingDots(coord);
                    if (overlap) {
                        hoverTargetSet.add(overlap);
                        clearSplitPreview();
                    } else {
                        showSplitPreview(Editor.Connections.findSplitAt(coord.peekNormal(), { avoidWalls: true }));
                    }
                }
            } else if (editorMode == EditorModes.CONNECTION) {
                const coord = Editor.newCoord(e.clientX, e.clientY, "screen");
                const holding =
                    Tools.Holdable.type === "connectionReference" ||
                    Tools.Holdable.type === "connectionSplitReference";

                if (holding) {
                    const phantom = Tools.Holdable.phantomObject;
                    const splitStart = Tools.Holdable.type === "connectionSplitReference";
                    const startConn = splitStart ? phantom.startSplitHit.connection : null;
                    const overlap = Editor.Referencer.getOverlappingDots(coord);

                    if (overlap) {
                        clearSplitPreview();
                        phantom.setEndPoint(coord);

                        const blocked = splitStart
                            ? (overlap === startConn.start || overlap === startConn.end)
                            : (overlap === phantom.start || Editor.Connections.hasPair(overlap, phantom.start));

                        if (!blocked) {
                            if (splitStart) Actions.newConnectionFromSplit(phantom.startSplitHit, overlap);
                            else Actions.newConnection(phantom.start, overlap);

                            showStartPreview(null);
                            Tools.Holdable.set(overlap, "connectionReference", false, new Editor.PhantomConnection(overlap));
                        }
                    } else {
                        const hit = Editor.Connections.findSplitAt(
                            coord.peekNormal(),
                            splitStart ? { excludeConnection: startConn } : { exclude: phantom.start },
                        );
                        showSplitPreview(hit);
                        phantom.setEndPoint(hit ? Editor.newCoord(hit.x, hit.y, "normal") : coord);
                    }
                } else {
                    const overlap = Editor.Referencer.getOverlappingDots(coord);
                    const hit = overlap ? null : Editor.Connections.findSplitAt(coord.peekNormal(), { avoidWalls: true });
                    showStartPreview(hit);

                    if (overlap) hoverTargetSet.add(overlap);
                    else if (!hit) {
                        if (!leftClicking) return;
                        Pointer.defaultMove(e);
                    }
                }
            } else if (editorMode == EditorModes.DELETION) {
                const coord = normalCoordAt(e.clientX, e.clientY);
                const dot = Editor.Referencer.getOverlappingDots(coord);
                const line = dot ? false : Editor.Connections.getOverlappingLines(coord);
                const building = (dot || line)
                    ? false
                    : (Editor.Buildings.getOverlappingPins(coord) ||
                    Editor.Buildings.getOverlappingBuildings(coord));

                if (dot) hoverTargetSet.add(dot);
                else if (line) hoverTargetSet.add(line);
                else if (building) hoverTargetSet.add(building);
                else {
                    if (!leftClicking) return;
                    Pointer.defaultMove(e);
                }
            } else if (editorMode == EditorModes.CONSTRUCTION) {
                if (!Tools.Task.task) {
                    if (dragBuildingTarget(e)) return;
                    if (leftClicking) {
                        Pointer.defaultMove(e);
                        return;
                    }
                    hoverBuildingTarget(e);
                    return;
                }

                const building =
                    Tools.Task.task === "build" && Tools.Task.taskStep === 1
                        ? Tools.Task.data["buildObject"]
                        : null;

                const here = () =>
                    Editor.newCoord(e.clientX, e.clientY, "screen");

                const overClose = building
                    ? updatePhantomVertex(here(), e)
                    : false;

                if (overClose) {
                    hoverTargetSet.add(building.closeHandle);
                }

                setCursor(overClose ? "pointer" : "");

                if (!leftClicking) return;

                if (building && !panStarted && !passedDragThreshold(e)) {
                    return;
                }

                panStarted = true;
                Pointer.defaultMove(e);

                if (building) {
                    updatePhantomVertex(here(), e);
                }
            } else if (editorMode == EditorModes.BANNER) {
                let coord = Editor.newCoord(e.clientX, e.clientY, "screen");
                let overlapDots = Editor.Referencer.getOverlappingDots(coord);
                let overlapPins = Editor.Buildings.getOverlappingPins(coord);
                if (overlapDots) {
                    hoverTargetSet.add(overlapDots);
                } else if (overlapPins) {
                    hoverTargetSet.add(overlapPins);
                } else {
                    if (!leftClicking) return;
                    Pointer.defaultMove(e);
                }
            } else {
                if (!leftClicking) return;
                Pointer.defaultMove(e);
            }
        }
    }

    static up(e) {
        stopCarry();
        if (!e.isPrimary) return;
        if (page == "main") flushMainMove();

        const wasLeftClicking = leftClicking;
        if (e.button === 0) leftClicking = false;
        else if (e.button === 2) rightClicking = false;
        if (page == "editor" && panGesture && e.button === 0) {
            panGesture = false;
            setCursor(quickPan ? "grab" : "");
            return;
        }

        if (pinching) {
            clearLongPress();
            pressedTarget = null;
            return;
        }
        if (page == "editor" && Editor.SelectRegion.resizing) {
            const change = Editor.SelectRegion.endResize();
            if (change) Actions.resizeSelection(change.before, change.after);
            else if (wasLeftClicking && e.button === 0) endSelectionGesture();   // clique, não arrasto
            selBefore = null;
            setCursor("");
            return;
        }

        Editor.SelectRegion.release();
        if (page == "editor" && selectMode() && wasLeftClicking && e.button === 0) {
            endSelectionGesture();
        }

        if (page == "main") {
            clearLongPress();
            const pressed = pressedTarget;
            const pressedKind = pressedType;
            pressedTarget = null;
            pressedType = "none";

            if (longPressFired) { longPressFired = false; return; }
            if (moved || !wasLeftClicking) return;

            const isDoubleTap = () => {
                const now = performance.now();
                return lastTap &&
                    now - lastTap.t <= DOUBLE_CLICK_MS &&
                    Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) <= DOUBLE_CLICK_DIST;
            };

            if (pressed) {
                // clique duplo (mouse) em cima de uma área: coloca o marcador em vez de reabrir o banner
                if (pressedKind === "area" && e.pointerType === "mouse") {
                    if (isDoubleTap()) {
                        lastTap = null;
                        placeMarker(Editor.newCoord(e.clientX, e.clientY, "screen"));
                        return;
                    }
                    lastTap = { t: performance.now(), x: e.clientX, y: e.clientY };
                } else {
                    lastTap = null;
                }

                if (pressed.selfPin) {
                    Actions.openUser(pressed);
                } else {
                    Actions.openBanner(pressed);
                    goToPlace(pressed);
                }
                return;
            }

            Actions.closeBanner();
            Actions.closeUser();

            if (e.pointerType !== "mouse") return;

            if (isDoubleTap()) {
                lastTap = null;
                placeMarker(Editor.newCoord(e.clientX, e.clientY, "screen"));
            } else {
                lastTap = { t: performance.now(), x: e.clientX, y: e.clientY };
            }
            return;
        } else if (page == "editor") {
            if (Floors.isActive()) {
                if (e.button === 2 && rightFloor >= 0) {
                    const i = rightFloor;
                    rightFloor = -1;
                    Floors.removeVertex(i);
                    return;
                }
                if (e.button === 0 && floorGrab) {
                    floorGrab = false;
                    Floors.release();
                    return;
                }
                if (e.button === 0 && wasLeftClicking && !passedDragThreshold(e)) Floors.pick(e.clientX, e.clientY);
                return;
            }

            if (e.button === 2 && rightVertex) {
                const target = rightVertex;
                rightVertex = null;
                if (editorMode === EditorModes.CONSTRUCTION && !Tools.Task.task) {
                    Actions.removeVertex(target.building, target.index);
                }
                return;
            }
            if (editorMode == EditorModes.REFERENCE) {
                clearSplitPreview();
                if (Tools.Holdable.object) Actions.moveReference(Tools.Holdable);
                Tools.Holdable.set(false);
            } else if (editorMode == EditorModes.CONNECTION) {
                const type = Tools.Holdable.type;
                if (Tools.Holdable.object && (type === "connectionReference" || type === "connectionSplitReference")) {
                    const from = Tools.Holdable.object;
                    const startHit = Tools.Holdable.phantomObject?.startSplitHit;   // lives on the phantom
                    const hit = splitHit;

                    clearAllSplitPreviews();
                    Tools.Holdable.set(false);

                    if (hit && hit.connection.enabled) {
                        if (type === "connectionSplitReference") {
                            if (startHit && startHit.connection.enabled) Actions.newConnectionFromSplit(startHit, hit);
                        } else if (from.enabled !== false) {
                            Actions.newConnectionSplit(from, hit);
                        }
                    }
                }
            } else if (editorMode == EditorModes.CONSTRUCTION) {
                if (!Tools.Task.task) {
                    releaseBuildingTarget();
                } else {
                    if (
                        wasLeftClicking &&
                        e.button === 0 &&
                        !panStarted &&
                        Tools.Task.task === "build" &&
                        Tools.Task.taskStep === 1
                    ) {
                        Actions.placeVertex(e.clientX, e.clientY, e.shiftKey);
                    }
                    Editor.SnapGuides.clearAll();
                }
            }
        }
    }

    static cancel() {
        clearLongPress();

        Editor.SelectRegion.release();

        panGesture = false;

        if (selBefore) {
            Editor.SelectRegion.restoreSelection(selBefore);
            selBefore = null;
        }
        selClick = null;
        selDragging = false;

        leftClicking = false;
        rightClicking = false;
        moved = true;

        rightVertex = null;
        rightFloor = -1;
        floorGrab = false;
        Floors.cancelDrag();
        pressedTarget = null;

        if (Tools.Holdable.type === "connectionReference" || Tools.Holdable.type === "connectionSplitReference") {
            Tools.Holdable.set(false);
        }
        clearAllSplitPreviews();

        if (Tools.Holdable.type === "buildingVertex" || Tools.Holdable.type === "buildingPin") {
            Actions.revertDrag();
        }
        dragStarted = false;

        Editor.SnapGuides.clearAll();
    }

    static wheel(e) {
        e.preventDefault();
        if (Graficos.smoothTransform) return;

        const zoom = Graficos.zoom;
        const o = Graficos.canvasOrigin();
        const mX = e.clientX - o.x;
        const mY = e.clientY - o.y;

        let zoomFactor = e.deltaY < 0 ? zoomStep : 1 / zoomStep;
        const nextZoom = Math.min(Math.max(zoom * zoomFactor, Graficos.minZoom), Graficos.maxZoom);
        zoomFactor = nextZoom / zoom;

        Graficos.setPosition(
            mX - (mX - Graficos.mapContainer.x) * zoomFactor,
            mY - (mY - Graficos.mapContainer.y) * zoomFactor,
        );

        Graficos.setZoom(nextZoom);
        Graficos.updateMap();
    }
}

// =====================================================================
// wiring
// =====================================================================

function hoverLoop() {
    if (hoverSet.size === 0 && hoverTargetSet.size === 0) return;

    for (const obj of hoverTargetSet) {
        obj.hoverAdd();
        if (!hoverSet.has(obj)) {
            hoverSet.add(obj);
        }
    }
    const remove = [];
    for (const obj of hoverSet) {
        if (!hoverTargetSet.has(obj)) {
            obj.hoverDec();
            if (obj.hover <= 0) {
                remove.push(obj);
            }
        }
    }
    for (const obj of remove) {
        hoverSet.delete(obj);
    }
}

export function attach(map) {
    mapObj = map;

    map.addEventListener("pointerdown", Pointer.down);
    map.addEventListener("pointermove", Pointer.move);
    document.addEventListener("pointerup", Pointer.up);
    map.addEventListener("wheel", Pointer.wheel, { passive: false });
    document.addEventListener("pointercancel", Pointer.cancel);

    map.addEventListener("touchstart", Touch.begin, { passive: false });
    map.addEventListener("touchmove", Touch.step, { passive: false });
    document.addEventListener("touchend", Touch.end);

    document.addEventListener('contextmenu', (event) => event.preventDefault());

    setInterval(hoverLoop, 1000 / 30);
}