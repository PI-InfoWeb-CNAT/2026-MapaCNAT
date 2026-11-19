import * as Transformacao from "./transformacao.js";
import * as Graficos from "./graficos.js";
import * as Editor from "./editor.js";
import * as Toasts from './toasts.js';
import * as Modals from './modals.js';
import * as Localizacao from './localizacao.js';

let mapObj;
let buildBtn;
let referenceBtn;
let connectionBtn;
let saveBtn;
let bannerBtn;
let pinBtn;
let pinDone = false;
let mapInterface;
let mapContainer;
let hoverMap;
let defaultImageFile;
let pressedType = "none";

let constructionPanel;
let pinTitle;
let pinHint;
let bannerStatus;
let activeTab = "map";

const DOUBLE_CLICK_MS = 350;
const DOUBLE_CLICK_DIST = 24;
const LONG_PRESS_MS = 500;

const ROTATION_SNAP = Math.PI / 8;

let panStarted = false;
let dragStarted = false;

const CLOSE_RADIUS_PX = 14;
const AXIS_SNAP_PX = 10;

const PIN_STATES = {
    idle:    { title: "Nova construção",     hint: "Clique para começar" },
    placing: { title: "Posicione o pin",     hint: "Clique no mapa onde fica a construção" },
    drawing: { title: "Marque os cantos",    hint: "Clique nos cantos da construção (mínimo 3 pontos)" },
    done:    { title: "Concluir construção", hint: "Fecha a forma e conclui (ou aperte Enter)" },
};

let lastTap = null;
let longPressTimer = 0;
let longPressFired = false;

let currentObjectURL = null;

let searchForm;
let searchHeader;
let searchField;
let searchExpansion;
let searchList;

let routeFields;
let routeOrigin;
let routeDestination;

let search;               // { schedule, now, cancel }
let activeInput = null;   // campo de texto em uso no momento
let expanded = false;
let currentResults = [];
let currentQuery = '';
let activeImageUrls = [];
let originPlaceholder = '';

let userTab;
let shareLocation;

let bannerTab;
let imageInput;
let imageWrapper;
let imageLabel;
let bannerTitle;
let bannerDescription;
let bannerAliasInput;
let bannerAliasList;
let bannerAliases = [];
let pinMap;
let constructionMap;
let previousTitle;
let moved;

let selectionBtn;
let deleteBtn;

let page;

let minZoom, maxZoom;
let zoomStep;
let zoom = Graficos.zoom;

let leftClicking = false;
let rightClicking = false;
let touching = false;

let mapStartX, mapStartY, mapStartAngle;
let clickX, clickY;
let touchX, touchY;
let pendingTemporaryPinCoordinate;
let pendingMapTarget;
let startMidX, startMidY;
let startDistance, startAngle;
let startZoom, startRotation;
let startOffsetX, startOffsetY;
let rotateOffsetX = 0, rotateOffsetY = 0;

let pressedTarget = null;
let pinching = false;
let pendingMainMove = null;
let mainMoveRaf = 0;
let cursorState = "";

let hoverSet = new Set();
let hoverTargetSet = new Set();
let hoverLoop;

const EditorModes = Object.freeze({
    FREE: "FREE",
    SELECTION: "SELECTION",
    DELETION: "DELETION",
    CONSTRUCTION: "CONSTRUCTION",
    REFERENCE: "REFERENCE",
    CONNECTION: "CONNECTION",
    BANNER: "BANNER",
});

let editorMode = EditorModes.FREE;

function isMobileDevice() {
  if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
    return navigator.userAgentData.mobile;
  }
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function setContext(context) {
    page = context.page;
    zoom = Graficos.zoom;
    zoomStep = context.scroll_ratio;
}

function nearFirstVertex(building, p) {
    const first = building.vertices[0]?.pos;
    return !!first && Math.hypot(p.x - first.x, p.y - first.y) <= CLOSE_RADIUS_PX / Graficos.zoom;
}

function updatePhantomVertex(coordinate, e) {
    const building =
        Task.task === "build" && Task.taskStep === 1
            ? Task.data["buildObject"]
            : null;

    if (!building || building.closed || !building.vertices.length) {
        if (Holdable.type === "phantomVertex") {
            Holdable.set(false);
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

    if (
        Holdable.type !== "phantomVertex" ||
        Holdable.object !== building
    ) {
        Holdable.set(
            building,
            "phantomVertex",
            false,
            new Editor.PhantomVertex(building, finalCoord)
        );
    } else {
        Holdable.phantomObject.setEndPoint(finalCoord);
    }

    return overClose;
}

function snapCoordinate(coordinate, vertices, {
    enabled = false,
    threshold = AXIS_SNAP_PX,
} = {}) {
    const free = coordinate.getIn("screen");

    const result = {
        coordinate,
        guides: {
            horizontal: null,
            vertical: null,
        },
    };

    if (!enabled || !vertices?.length) {
        return result;
    }

    let bestX = null;
    let bestY = null;

    let distanceX = threshold + 1;
    let distanceY = threshold + 1;

    for (const vertex of vertices) {
        const pos = vertex?.pos;

        if (
            !pos ||
            !Number.isFinite(pos.x) ||
            !Number.isFinite(pos.y)
        ) {
            continue;
        }

        const anchor = Editor
            .newCoord(pos.x, pos.y, "normal")
            .getIn("screen");

        const dx = Math.abs(free.x - anchor.x);
        const dy = Math.abs(free.y - anchor.y);

        if (dx <= threshold && dx < distanceX) {
            bestX = anchor;
            distanceX = dx;
        }

        if (dy <= threshold && dy < distanceY) {
            bestY = anchor;
            distanceY = dy;
        }
    }

    const snapped = Editor.newCoord(
        bestX ? bestX.x : free.x,
        bestY ? bestY.y : free.y,
        "screen"
    );

    const toNormal = (x, y) =>
        Editor.newCoord(x, y, "screen").getIn("normal");

    if (bestX) {
        result.guides.vertical = {
            start: toNormal(bestX.x, bestX.y),
            end: toNormal(bestX.x, free.y),
        };
    }

    if (bestY) {
        result.guides.horizontal = {
            start: toNormal(bestY.x, bestY.y),
            end: toNormal(free.x, bestY.y),
        };
    }

    result.coordinate = snapped;

    return result;
}

function grabBuildingTarget(x, y) {
    Holdable.set(false);
    const coord = Editor.newCoord(x, y, "screen");
    const vtx = Editor.Buildings.getOverlappingVertex(coord);

    if (vtx) {
        const b = vtx.building;
        Holdable.set(b, "buildingVertex", {
            index: vtx.index,
            pos: { ...b.vertices[vtx.index].pos },
            entrances: b.entrances
                .filter(r => r.enabled)
                .map(r => ({ dot: r, pos: { ...r.coordinate.pos } })),
        });
        return;
    }

    const pin = Editor.Buildings.getOverlappingPins(coord);
    if (pin) {
        const n = normalCoordAt(x, y).pos;
        Holdable.set(pin, "buildingPin", {
            pos: { ...pin.coordinate.pos },
            offset: { x: n.x - pin.coordinate.pos.x, y: n.y - pin.coordinate.pos.y },
        });
    }
}

function dragBuildingTarget(e) {
    if (Holdable.type === "buildingVertex") {
        if (!dragStarted && !passedDragThreshold(e)) return true;
        dragStarted = true;

        const b = Holdable.object;
        const i = Holdable.initialPos.index;
        const others = b.vertices.filter((_, k) => k !== i);
        const snap = snapCoordinate(
            Editor.newCoord(e.clientX, e.clientY, "screen"),
            others,
            { enabled: e.shiftKey, threshold: AXIS_SNAP_PX },
        );
        Editor.SnapGuides.update(snap.guides);
        b.moveVertex(i, snap.coordinate);
        Editor.Buildings.reattachEntrances(b);
        return true;
    }

    if (Holdable.type === "buildingPin") {
        if (!dragStarted && !passedDragThreshold(e)) return true;
        dragStarted = true;

        const off = Holdable.initialPos.offset;
        const n = normalCoordAt(e.clientX, e.clientY).pos;
        Holdable.object.move(Editor.newCoord(n.x - off.x, n.y - off.y, "normal"));
        return true;
    }

    return false;
}

function hoverBuildingTarget(e) {
    const coord = Editor.newCoord(e.clientX, e.clientY, "screen");
    const vtx = Editor.Buildings.getOverlappingVertex(coord);
    Editor.Buildings.setHoverVertex(vtx);
    const pin = vtx ? false : Editor.Buildings.getOverlappingPins(coord);
    if (pin) hoverTargetSet.add(pin);
    setCursor(vtx ? "move" : pin ? "pointer" : "");
}

function releaseBuildingTarget() {
    if (Holdable.type === "buildingVertex") {
        if (dragStarted) Actions.moveVertex(Holdable);
        Editor.SnapGuides.clearAll();
        Holdable.set(false);
    } else if (Holdable.type === "buildingPin") {
        const building = Holdable.object;
        if (dragStarted) Actions.moveBuildingPin(Holdable);
        else Actions.openModal("buildRename", { building });   // simple click
        Holdable.set(false);
    }
    dragStarted = false;
}

function isDuplicateVertex(building, coordinate, threshold = 4) {
    const p = coordinate.getIn("screen");

    return building.vertices.some(vertex => {
        if (!vertex?.pos) return false;

        const existing = Editor
            .newCoord(vertex.pos.x, vertex.pos.y, "normal")
            .getIn("screen");

        return Math.hypot(
            p.x - existing.x,
            p.y - existing.y
        ) <= threshold;
    });
}

class Holdable {
    constructor() {
        throw new Error("Classe estática. Não instancie.");
    }
    static object = null;
    static type = "";
    static initialPos = null;
    static phantomObject = null;

    static set(object, type = "", initialPos = false, phantomObject = false) {
        if (this.phantomObject) {
            this.phantomObject.destroy();
        }

        this.object = object;
        this.type = type;
        this.initialPos = initialPos;
        this.phantomObject = phantomObject;
    }
}

class Task {
    constructor() {
        throw new Error("Classe estática. Não instancie.");
    }
    static task = "";
    static taskStep = 0;
    static data = {};

    static snapshot() {
        return {
            task: this.task,
            taskStep: this.taskStep,
            data: { ...this.data },
        };
    }
    static restore(snap) {
        this.task = snap.task;
        this.taskStep = snap.taskStep;
        this.data = { ...snap.data };
        Actions.syncTaskUI();
    }
    static setTask(name, data) {
        this.task = name;
        this.taskStep = 0;
        this.data = data;
        Actions.syncTaskUI();
    }
    static reset() {
        this.task = "";
        this.taskStep = 0;
        this.data = {};
        Actions.syncTaskUI();
    }
    static nextStep() {
        this.taskStep += 1;
        Actions.syncTaskUI();
    }
}

function bannerState() {
    if (page != "editor" || !bannerHeld()) return { state: "empty", missing: [] };

    const filled = {
        "imagem": !!Holdable.initialPos?.img,
        "título": !!bannerTitle.value.trim(),
        "descrição": !!bannerDescription.value.trim(),
    };
    const missing = Object.keys(filled).filter((k) => !filled[k]);
    const state = missing.length === 3 ? "empty" : missing.length === 0 ? "complete" : "partial";
    return { state, missing };
}

function syncDescriptionLabel() {
    const label = bannerTab.querySelector(".banner-section-title");
    if (!label) return;

    const empty = !bannerDescription.value.trim();
    label.textContent = empty ? "Sem descrição" : "Sobre";
    label.closest(".banner-section")?.classList.toggle("is-empty", empty);
}

function syncBannerStatus() {
    if (!bannerStatus) return;
    const { state, missing } = bannerState();
    bannerStatus.dataset.state = state;
    bannerStatus.textContent =
        state === "partial" ? `Falta: ${missing.join(", ")}` :
        state === "complete" ? "Completo" : "Não detalhado";
}


function normalizeBannerAliases(values) {
    const source = Array.isArray(values)
        ? values
        : typeof values === "string"
            ? values.split(/\s+/)
            : [];

    const seen = new Set();

    return source
        .flatMap(value =>
            typeof value === "string" ? value.split(/\s+/) : []
        )
        .map(value => value.trim())
        .filter(value => {
            if (!value) return false;

            const normalized = value.toLocaleLowerCase();

            if (seen.has(normalized)) return false;

            seen.add(normalized);
            return true;
        });
}

function renderBannerAliases() {
    if (!bannerAliasList) return;

    bannerAliasList.replaceChildren();

    bannerAliases.forEach((alias, index) => {
        const chip = document.createElement("span");
        chip.className = "banner-alias-chip";

        const text = document.createElement("span");
        text.className = "banner-alias-text";
        text.textContent = alias;

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "banner-alias-remove";
        remove.textContent = "×";
        remove.setAttribute("aria-label", `Remover ${alias}`);
        remove.title = `Remover "${alias}"`;

        remove.addEventListener("click", () => {
            bannerAliases.splice(index, 1);
            renderBannerAliases();
            bannerAliasInput?.focus();
        });

        chip.append(text, remove);
        bannerAliasList.appendChild(chip);
    });
}

function setBannerAliases(values) {
    bannerAliases = normalizeBannerAliases(values);
    renderBannerAliases();
}

function addBannerAliases(value) {
    const incoming = normalizeBannerAliases(value);

    if (!incoming.length) return;

    const existing = new Set(
        bannerAliases.map(alias => alias.toLocaleLowerCase())
    );

    for (const alias of incoming) {
        const normalized = alias.toLocaleLowerCase();

        if (existing.has(normalized)) continue;

        bannerAliases.push(alias);
        existing.add(normalized);
    }

    renderBannerAliases();
}

function commitBannerAliasInput() {
    if (!bannerAliasInput) return;

    addBannerAliases(bannerAliasInput.value);
    bannerAliasInput.value = "";
}

function clearBannerFields() {
    resetDisplayImage();

    bannerTitle.value = "";
    bannerDescription.value = "";

    setBannerAliases([]);

    if (bannerHeld()) Holdable.initialPos.img = false;

    syncBannerStatus();
}

async function switchTab(name) {
    if (name === activeTab) return;
    if (!(await Actions.ensureBannerValid())) return;

    await Actions.switchMode(EditorModes.FREE);
    if (editorMode !== EditorModes.FREE) return;   // user kept an unfinished construction

    activeTab = name;
    for (const tab of document.querySelectorAll("[data-tab]")) {
        tab.setAttribute("aria-selected", String(tab.dataset.tab === name));
    }
    for (const view of document.querySelectorAll("[data-view]")) {
        view.classList.toggle("hidden", view.dataset.view !== name);
    }
}

function passedDragThreshold(e) {
    const limit = e.pointerType === "touch" ? 10 : 4;
    return Math.hypot(e.clientX - clickX, e.clientY - clickY) >= limit;
}

function setCursor(c) {
    if (c !== cursorState) {
        cursorState = c;
        mapObj.style.cursor = c;
    }
}

function normalCoordAt(x, y) {
    const c = Editor.newCoord(x, y, "screen");
    c.convertTo("normal");
    return c;
}

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
    pendingMainMove = { clientX: e.clientX, clientY: e.clientY };
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
        const delta = (m.clientX - clickX) / 300;
        const o = Graficos.canvasOrigin();
        Graficos.setPosition(clickX - o.x + p.x, clickY - o.y + p.y);
        const p = Transformacao.rotatePoint(rotateOffsetX, rotateOffsetY, delta);
        Graficos.setPosition(clickX + p.x, clickY + p.y);
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

class Touch {
    constructor() {
        throw new Error("Classe estática. Não instancie.");
    }

    static begin(e) {
        if(Graficos.smoothTransform) {
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
            zoom = Graficos.zoom;
            startZoom = zoom;
            startRotation = Graficos.mapContainer.rotation;
            startOffsetX = (Graficos.mapContainer.x - startMidX) / zoom;
            startOffsetY = (Graficos.mapContainer.y - startMidY) / zoom;
        }
    }

    static step(e) {
        if (!touching || e.touches.length != 2) return;

        if(Graficos.smoothTransform) {
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

            zoom = Math.min(Math.max(startZoom * (currentDistance / startDistance), Graficos.minZoom), Graficos.maxZoom);

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

let carrying = null;

function stopCarry() {
    if(carrying) {
        clearInterval(carrying);
    }
}

function startCarry(e) {
    carryView(e);
    carrying = setInterval(() => {
        carryView(e);
        Editor.SelectRegion.move(Editor.newCoord(e.clientX, e.clientY, "screen"), e.shiftKey);
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

class Pointer {
    constructor() {
        throw new Error("Classe estática. Não instancie.");
    }

    static down(e) {
        if (!e.isPrimary || pinching) return;

        if(Graficos.smoothTransform) {
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
        else if (e.button === 2) rightClicking = true;

        if (e.target === mapObj) mapObj.setPointerCapture?.(e.pointerId);

        moved = false;
        dragStarted = false;   // ← add this
        panStarted = false;
        pressedTarget = null;
        pendingTemporaryPinCoordinate = null;
        pendingMapTarget = null;

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
            if (e.button !== 0) return;
            if (Keys.quickPan) { panGesture = true; setCursor("grabbing"); return; }
            if (editorMode == EditorModes.SELECTION) {
                const S = Editor.SelectRegion;
                const here = Editor.newCoord(clickX, clickY, "screen");
                const zone = S.hitZone(clickX, clickY);
                if (zone) S.beginGesture(zone, here);   // borda, interior ou canto: não zera a seleção
                else S.start(here);
            } else if (editorMode == EditorModes.REFERENCE) {
                let coord = Editor.newCoord(clickX, clickY, "screen");
                let overlap = Editor.Referencer.getOverlappingDots(
                    coord,
                    false,
                );
                Holdable.set(false);
                if (overlap) {
                    Holdable.set(overlap, "reference", {
                        ...overlap.coordinate.pos,
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
                let coord = Editor.newCoord(clickX, clickY, "screen");
                let overlap = Editor.Referencer.getOverlappingDots(
                    coord,
                    false,
                );

                if (overlap) {
                    let phantomObject = new Editor.PhantomConnection(overlap);
                    Holdable.set(
                        overlap,
                        "connectionReference",
                        false,
                        (phantomObject = phantomObject),
                    );
                }
            } else if (editorMode == EditorModes.CONSTRUCTION) {
                if (Task.task == "build") {
                    if (Task.taskStep == 0 && isInside(e, mapObj)) {
                        Actions.openModal("buildName");
                    }
                } else {
                    grabBuildingTarget(clickX, clickY);   // no task: editing closed buildings
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
            Pointer.rotateMove(e);
            Editor.SelectRegion.onCameraRotate();
            return;
        }

        if (page == "editor" && (panGesture || Keys.quickPan)) {
            hoverTargetSet = new Set();
            if (panGesture && leftClicking) Pointer.defaultMove(e);
            return;
        }

        hoverTargetSet = new Set();
        
        stopCarry();

        if (page == "editor") {
            if (editorMode == EditorModes.SELECTION) {
                const S = Editor.SelectRegion;
                const here = Editor.newCoord(e.clientX, e.clientY, "screen");
                if (S.resizing) {
                    S.updateResize(here, e.shiftKey);
                    startCarry(e);
                } else if (leftClicking) {
                    S.move(here, e.shiftKey);
                    startCarry(e);
                } else {
                    setCursor(S.cursorForZone(S.hitZone(e.clientX, e.clientY)));
                }
            } else if (editorMode == EditorModes.FREE) {
                if (!leftClicking) return;
                Pointer.defaultMove(e);
            } else if (editorMode == EditorModes.REFERENCE) {
                if (Holdable.object) {
                    const coord = Editor.newCoord(e.clientX, e.clientY, "screen");
                    Holdable.object.move(coord, false, true);
                } else {
                    let coord = Editor.newCoord(e.clientX, e.clientY, "screen");
                    let overlap = Editor.Referencer.getOverlappingDots(coord);
                    if (overlap) {
                        hoverTargetSet.add(overlap);
                    }
                }
            } else if (editorMode == EditorModes.CONNECTION) {
                let coord = Editor.newCoord(e.clientX, e.clientY, "screen");
                if (Holdable.type == "connectionReference") {
                    Holdable.phantomObject.setEndPoint(coord);

                    let overlap = Editor.Referencer.getOverlappingDots(coord);
                    if (overlap) {
                        if (
                            overlap != Holdable.phantomObject.start &&
                            !Editor.Connections.hasPair(
                                overlap,
                                Holdable.phantomObject.start,
                            )
                        ) {
                            Actions.newConnection(
                                Holdable.phantomObject.start,
                                overlap,
                            );

                            let phantomObject = new Editor.PhantomConnection(
                                overlap,
                            );
                            Holdable.set(
                                overlap,
                                "connectionReference",
                                false,
                                (phantomObject = phantomObject),
                            );
                        }
                    }
                } else {
                    let overlap = Editor.Referencer.getOverlappingDots(coord);
                    if (overlap) {
                        hoverTargetSet.add(overlap);
                    } else {
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
                if (!Task.task) {
                    if (dragBuildingTarget(e)) return;
                    if (leftClicking) {
                        Pointer.defaultMove(e);
                        return;
                    }
                    hoverBuildingTarget(e);
                    return;
                }

                const building =
                    Task.task === "build" && Task.taskStep === 1
                        ? Task.data["buildObject"]
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
        const wasRightClicking = rightClicking;
        if (!e.isPrimary) return;
        if (page == "main") flushMainMove();
        
        const wasLeftClicking = leftClicking;
        if (e.button === 0) leftClicking = false;
        else if (e.button === 2) rightClicking = false;
        if (page == "editor" && panGesture && e.button === 0) {
            panGesture = false;
            setCursor(Keys.quickPan ? "grab" : "");
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
            setCursor("");
            return;
        }

        Editor.SelectRegion.release();

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
            if (editorMode == EditorModes.REFERENCE) {
                if (Holdable.object) {
                    Actions.moveReference(Holdable);
                }
                Holdable.set(false);
            } else if (editorMode == EditorModes.CONNECTION) {
                if (Holdable.object && Holdable.type == "connectionReference") {
                    Holdable.phantomObject.destroy();
                    Holdable.set(false);
                }
           } else if (editorMode == EditorModes.CONSTRUCTION) {
                if (!Task.task) {
                    releaseBuildingTarget();
                } else {
                    if (
                        wasLeftClicking &&
                        e.button === 0 &&
                        !panStarted &&
                        Task.task === "build" &&
                        Task.taskStep === 1
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

        leftClicking = false;
        rightClicking = false;
        moved = true;

        pressedTarget = null;

        if (Holdable.type === "buildingVertex" || Holdable.type === "buildingPin") {
            Actions.revertDrag();
        }
        dragStarted = false;

        Editor.SnapGuides.clearAll();
    }

    static wheel(e) {
        e.preventDefault();
        if (Graficos.smoothTransform) return;


        zoom = Graficos.zoom;                       // o resize pode ter reajustado o zoom
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

        zoom = nextZoom;
        Graficos.setZoom(zoom);
        if (Holdable.phantomObject) {
            Holdable.phantomObject.updateGraphics();
        }
        Editor.Route.redraw();
        Editor.SelectRegion.updateBoxGraphics();
        Graficos.updateMap();
    }
}

function activateList(list) {
    for (const tag of list) {
        tag.classList.add("active");
    }
}
function deactivateList(list) {
    for (const tag of list) {
        tag.classList.remove("active");
    }
}

function lightButton(button, mode, buttonMode) {
    button.classList.remove("mode-active");
    if (mode == buttonMode) {
        button.classList.add("mode-active");
    }
}

export function WaitButtonClick(buttonElements) {
    return new Promise((resolve) => {
        const elements = buttonElements.map((el) =>
            typeof el === "string" ? document.querySelector(el) : el,
        );

        if (elements.some((el) => !el)) {
            console.error("One or more button elements were not found!");
            return;
        }

        const cleanup = () => {
            elements.forEach((btn, idx) => {
                btn.removeEventListener("click", handlers[idx]);
            });
        };

        const handlers = elements.map((btn, index) => {
            return (event) => {
                cleanup();
                resolve({
                    index: index,
                    button: btn,
                    event: event,
                    id: btn.id || btn.className || `btn_${index}`,
                });
            };
        });

        elements.forEach((btn, idx) => {
            btn.addEventListener("click", handlers[idx]);
        });
    });
}

async function waitForTransition(element, timeout = 1000) {
    // getAnimations() força o recálculo de estilo, então já enxerga
    // a transição que acabou de ser iniciada pela troca de classe
    const running = element.getAnimations();
    if (running.length === 0) return;

    await Promise.race([
        // allSettled: resolve quando todas terminam, mesmo se alguma for cancelada
        Promise.allSettled(running.map((a) => a.finished)),
        new Promise((resolve) => setTimeout(resolve, timeout)), // rede de segurança
    ]);
}

function syncHandles() {
    Editor.Buildings.setEditing(
        (editorMode === EditorModes.CONSTRUCTION && !Task.task) ||
        (editorMode === EditorModes.SELECTION && Keys.shiftDown)
    );
}

class Actions {
    static actionStack = [];
    static actionStackReferencial = {};
    static actionStackTraversal = 0;
    static actionStackLimit = 64;

    static prune(startIndex, deleteCount = 1, pruneOut = true) {
        const total = this.actionStack.length;
        if (total === 0) return [];

        if (startIndex < 0) {
            startIndex = Math.max(0, total + startIndex);
        }

        startIndex = Math.max(0, Math.min(startIndex, total));
        deleteCount = Math.max(0, Math.min(deleteCount, total - startIndex));

        if (deleteCount === 0) return [];

        const currIndex = total - this.actionStackTraversal;

        const undoneStart = Math.max(startIndex, currIndex);
        const undoneEnd = Math.min(startIndex + deleteCount, total);
        const undoneRemoved = Math.max(0, undoneEnd - undoneStart);

        const prunedActions = this.actionStack.splice(startIndex, deleteCount);

        this.actionStackTraversal -= undoneRemoved;

        if (pruneOut) {
            for (const action of prunedActions) {
                if (action && typeof action.prune === "function") {
                    action.prune();
                }
            }
        }

        return prunedActions;
    }

    static undo() {
        if (this.actionStackTraversal >= this.actionStack.length) {
            return;
        }

        const targetIndex =
            this.actionStack.length - 1 - this.actionStackTraversal;
        const action = this.actionStack[targetIndex];

        if (action && typeof action.backward === "function") {
            action.backward();
        }

        this.actionStackTraversal++;
    }

    static redo() {
        if (this.actionStackTraversal <= 0) {
            return;
        }

        this.actionStackTraversal--;

        const targetIndex =
            this.actionStack.length - 1 - this.actionStackTraversal;
        const action = this.actionStack[targetIndex];

        if (action && typeof action.forward === "function") {
            action.forward();
        }
    }

    static newAction(forward, backward, prune = () => {}, overflow = () => {}) {
        if (this.actionStackTraversal > 0) {
            const prunedActions = this.actionStack.splice(
                this.actionStack.length - this.actionStackTraversal,
            );

            for (const action of prunedActions) {
                if (typeof action.prune === "function") {
                    action.prune();
                }
            }

            this.actionStackTraversal = 0;
        }

        this.actionStack.push({ forward, backward, prune, overflow });

        if (this.actionStack.length > this.actionStackLimit) {
            const droppedAction = this.actionStack.shift();
            if (droppedAction && typeof droppedAction.overflow === "function") {
                droppedAction.overflow();
            }
        }
    }

    static findActionIndex(target, compareBySource = false) {
        if (!Array.isArray(this.actionStack) || target == null) return -1;

        return this.actionStack.findIndex((item) => {
            if (item === target) return true;

            if (Array.isArray(item) && Array.isArray(target)) {
                if (item.length !== target.length) return false;
                return item.every((fn, i) =>
                    this.matchFunctions(fn, target[i], compareBySource),
                );
            }

            if (
                typeof item === "object" &&
                typeof target === "object" &&
                item !== null &&
                target !== null
            ) {
                const targetKeys = Object.keys(target);
                if (targetKeys.length === 0) return false;
                return targetKeys.every((key) =>
                    this.matchFunctions(
                        item[key],
                        target[key],
                        compareBySource,
                    ),
                );
            }

            if (typeof target === "function") {
                const values = Array.isArray(item) ? item : Object.values(item);
                return values.some((fn) =>
                    this.matchFunctions(fn, target, compareBySource),
                );
            }

            return false;
        });
    }

    static matchFunctions(a, b, compareBySource = false) {
        if (a === b) return true;
        if (
            compareBySource &&
            typeof a === "function" &&
            typeof b === "function"
        ) {
            return a.toString() === b.toString();
        }
        return false;
    }

    static newReference(mouseX, mouseY) {
        const coord = Editor.newCoord(mouseX, mouseY, "screen");
        let reference = new Editor.Reference(coord, { snap: true });

        const forward = () => {
            Actions.forceMode(EditorModes.REFERENCE);
            reference.enable();
        };

        const backward = () => {
            Actions.forceMode(EditorModes.REFERENCE);
            reference.disable();
        };

        const prune = () => {
            if (reference) {
                reference.destroy();
                reference = null;
            }
        };

        reference.enable();

        this.newAction(forward, backward, prune);
    }

    static destroyReference(reference) {
        let goneConnections = [...reference.connections].filter(
            (item) => item.enabled,
        );

        const forward = () => {
            Actions.forceMode(EditorModes.DELETION);

            reference.disable();
            for (const connection of goneConnections) {
                connection.disable();
            }
        };

        const backward = () => {
            Actions.forceMode(EditorModes.DELETION);

            reference.enable();
            for (const connection of goneConnections) {
                connection.enable();
            }
        };

        const overflow = () => {
            if (reference) {
                reference.destroy();
                reference = null;
            }
        };

        reference.disable();
        for (const connection of goneConnections) {
            connection.disable();
        }

        this.newAction(forward, backward, undefined, overflow);

        return reference;
    }

    static moveReference(heldObject) {
        let object = heldObject.object;

        let forwardCoord = {
            x: object.coordinate.pos.x,
            y: object.coordinate.pos.y,
        };
        let backwardCoord = {
            x: heldObject.initialPos.x,
            y: heldObject.initialPos.y,
        };

        const forward = () => {
            Actions.forceMode(EditorModes.REFERENCE);

            const coord = Editor.newCoord(
                forwardCoord.x,
                forwardCoord.y,
                "normal",
            );
            object.move(coord);
        };

        const backward = () => {
            Actions.forceMode(EditorModes.REFERENCE);

            const coord = Editor.newCoord(
                backwardCoord.x,
                backwardCoord.y,
                "normal",
            );
            object.move(coord);
        };

        this.newAction(forward, backward);
    }

    static newConnection(start, end) {
        let connection = new Editor.Connection(start, end);

        const forward = () => {
            Actions.forceMode(EditorModes.CONNECTION);
            connection.enable();
        };

        const backward = () => {
            Actions.forceMode(EditorModes.CONNECTION);
            connection.disable();
        };

        const prune = () => {
            if (connection) {
                connection.destroy();
                connection = null;
            }
        };

        connection.enable();

        this.newAction(forward, backward, prune);
    }

    static destroyConnection(connection) {
        const forward = () => {
            Actions.forceMode(EditorModes.DELETION);
            connection.disable();
        };

        const backward = () => {
            Actions.forceMode(EditorModes.DELETION);
            connection.enable();
        };

        const overflow = () => {
            if (connection) {
                connection.destroy();
                connection = null;
            }
        };

        connection.disable();

        this.newAction(forward, backward, undefined, overflow);

        return connection;
    }

    static syncHighlight() {
        if (editorMode == EditorModes.BANNER) {
            Graficos.highlight([Graficos.groups.PINS, Graficos.groups.REFERENCES]);
        } else {
            Graficos.highlight(true);
        }
    }

    static applyMode(mode) {
        Editor.SelectRegion.refresh();
        if (mode !== EditorModes.CONSTRUCTION) {
            Editor.SnapGuides.clearAll();
        }
        editorMode = mode;
        mapObj.dataset.mode = mode;
        setCursor("");
        Graficos.editorFocus(
            [
                EditorModes.DELETION,
                EditorModes.SELECTION,
                EditorModes.CONSTRUCTION,
                EditorModes.REFERENCE,
                EditorModes.CONNECTION,
                EditorModes.BANNER,
            ].includes(mode),
        );

        this.syncHighlight();

        this.closeBanner();

        lightButton(selectionBtn, mode, EditorModes.SELECTION);
        lightButton(deleteBtn, mode, EditorModes.DELETION);
        lightButton(buildBtn, mode, EditorModes.CONSTRUCTION);
        lightButton(referenceBtn, mode, EditorModes.REFERENCE);
        lightButton(connectionBtn, mode, EditorModes.CONNECTION);
        lightButton(bannerBtn, mode, EditorModes.BANNER);
        this.syncTaskUI();
    }

    static forceMode(mode = EditorModes.FREE) {
        if (mode != editorMode) Task.reset();
        this.applyMode(mode);
    }

    static resetTask() {
        Editor.SnapGuides.clearAll();
        if (Holdable.type === "phantomVertex") {
            Holdable.set(false);
        }
        if (Task.task == "build" && Task.taskStep == 1) {
            const building = Task.data["buildObject"];
            if (building && !building.closed) {
                // descarta a criação e todos os pontos já colocados (ficam no topo da pilha)
                const idx = this.findActionIndex(building._helperCreate);
                if (idx >= 0) this.prune(idx, this.actionStack.length - idx);
            }
        }
        Task.reset();
    }

    static async switchMode(mode = EditorModes.FREE) {
        if (this.switching) return;
    
        this.switching = true;
        const bannerOk = await this.ensureBannerValid();
        this.switching = false;
        if (!bannerOk) return;

        if (editorMode == EditorModes.CONSTRUCTION) {
            const building = Task.task == "build" && Task.taskStep == 1 ? Task.data["buildObject"] : null;

            if (building && !building.closed && building.vertices.length > 0) {
                const canClose = building.vertices.length >= 3;

                this.switching = true;
                const ok = await Actions.openModal(canClose ? "buildClose" : "buildConfirm");
                this.switching = false;

                if (!ok) return;
                if (canClose && !this.closePolygon(building)) return;   // forma sem área: continua desenhando
            }
            this.resetTask();
        }
        if (editorMode == mode) mode = EditorModes.FREE;
        this.applyMode(mode);
    }

    static addVertex(building, p) {
        const pos = { x: p.x, y: p.y };
        const snap = Task.snapshot();

        building.addVertex(Editor.newCoord(pos.x, pos.y, "normal"));
        this.syncTaskUI();

        this.newAction(
            () => {
                Actions.forceMode(EditorModes.CONSTRUCTION);
                building.addVertex(Editor.newCoord(pos.x, pos.y, "normal"));
                Task.restore(snap);
                building.updateGraphics();
            },
            () => {
                Actions.forceMode(EditorModes.CONSTRUCTION);
                building.removeLastVertex();
                Task.restore(snap);
                building.updateGraphics();
            },
        );
    }

    
    static placeVertex(x, y, shift = false) {
        const building = Task.data["buildObject"];

        if (!building || building.closed) {
            Editor.SnapGuides.clearAll();
            return;
        }

        const coordinate = Editor.newCoord(x, y, "screen");
        const raw = coordinate.getIn("normal");

        // Fechamento tem prioridade.
        if (
            building.vertices.length >= 3 &&
            nearFirstVertex(building, raw)
        ) {
            Editor.SnapGuides.clearAll();

            if (this.closePolygon(building)) {
                this.finishTask();
            }

            return;
        }

        const snap = snapCoordinate(
            coordinate,
            building.vertices,
            {
                enabled: shift,
                threshold: AXIS_SNAP_PX,
            }
        );

        const snapped = snap.coordinate;

        // Evita duplicação de qualquer vértice existente.
        if (isDuplicateVertex(building, snapped)) {
            Editor.SnapGuides.clearAll();
            return;
        }

        this.addVertex(building, snapped.getIn("normal"));

        // O ponto foi confirmado. Os guias eram apenas auxiliares.
        Editor.SnapGuides.clearAll();
    }


    // junta o último ponto ao primeiro. Devolve false se não deu para fechar.
    static closePolygon(building) {
        if (building.vertices.length < 3) {
            this.warnOpenPolygon(building);
            return false;
        }
        if (building.area() < 1) {
            Toasts.toaster.show({ text: "Essa forma não tem área. Desfaça (Ctrl+Z) e marque os pontos de novo.", category: "warn" });
            return false;
        }

        if (Holdable.type === "phantomVertex") Holdable.set(false);

        const snap = Task.snapshot();
        building.close();
        const snapped = Editor.Buildings.snapReferencesTo(building);   // referências coladas na parede nova
        this.syncTaskUI();

        this.newAction(
            () => {
                Actions.forceMode(EditorModes.CONSTRUCTION);
                building.close();
                for (const { dot, after } of snapped) dot.move(Editor.newCoord(after.x, after.y, "normal"));
                Task.restore(snap);
            },
            () => {
                Actions.forceMode(EditorModes.CONSTRUCTION);
                building.reopen();   // antes de mover: assim as referências deixam de ser entrada
                for (const { dot, before } of snapped) dot.move(Editor.newCoord(before.x, before.y, "normal"));
                Task.restore(snap);
            },
        );
        return true;
    }

    static warnOpenPolygon(building) {
        console.trace();
        const faltam = 3 - (building?.vertices.length ?? 0);
        Toasts.toaster.show({
            text: `Uma construção precisa de pelo menos 3 pontos. Faltam ${faltam}.`,
            category: "warn",
        });
    }

    // botão de tick / Enter: fecha como está (se ainda aberta) e conclui
    static finishTask() {
        const building = Task.data["buildObject"];
        if (!building) return;

        if (!building.closed && !this.closePolygon(building)) return;

        if (Holdable.type === "phantomVertex") Holdable.set(false);
        Task.reset();
    }

    static pinAction() {
        const state = pinBtn.dataset.state;
        if (state === "idle") this.beginTask("build", {});
        else if (state === "drawing") this.warnOpenPolygon(Task.data["buildObject"]);
        else if (state === "done") this.finishTask();
    }

    static finishTask() {
        const building = Task.data["buildObject"];
        if (!building) return;

        this.closePolygon(building);
        
        if (!building.closed) {
            return;
        }

        if (Holdable.type === "phantomVertex") {
            Holdable.set(false);
        }
        Task.reset();
    }

    static destroyBuilding(building) {
        const entrances = [...building.entrances].filter(r => r.enabled);

        const forward = () => {
            Actions.forceMode(EditorModes.DELETION);
            building.disable();
            for (const ref of entrances) ref.validatePos();    // sem parede, deixam de ser entrada
        };
        const backward = () => {
            Actions.forceMode(EditorModes.DELETION);
            building.enable();
            for (const ref of entrances) ref.validatePos();    // já estão na parede: voltam a ser entrada
        };
        const overflow = () => building.destroy();

        building.disable();
        for (const ref of entrances) ref.validatePos();

        this.newAction(forward, backward, undefined, overflow);
    }

    static moveVertex(held) {
        const building = held.object;
        const { index, pos: from, entrances } = held.initialPos;
        const cur = building.vertices[index].pos;
        const to = { x: cur.x, y: cur.y };
        if (to.x === from.x && to.y === from.y) return;

        // entradas que acompanharam a parede + referências que grudaram nela agora
        const changes = new Map();
        for (const { dot, pos } of entrances) {
            const now = dot.coordinate.pos;
            if (now.x !== pos.x || now.y !== pos.y) {
                changes.set(dot, { before: pos, after: { x: now.x, y: now.y } });
            }
        }
        for (const { dot, before, after } of Editor.Buildings.snapReferencesTo(building)) {
            const prev = changes.get(dot);
            changes.set(dot, { before: prev ? prev.before : before, after });
        }
        const moved = [...changes].map(([dot, c]) => ({ dot, ...c }));

        const apply = (pos, key) => {
            Actions.forceMode(EditorModes.SELECTION);
            building.moveVertex(index, Editor.newCoord(pos.x, pos.y, "normal"));   // parede primeiro
            for (const m of moved) m.dot.move(Editor.newCoord(m[key].x, m[key].y, "normal"));
        };

        this.newAction(
            () => apply(to, "after"),
            () => apply(from, "before"),
        );
    }

    static moveBuildingPin(held) {
        const building = held.object;
        const from = held.initialPos.pos;
        const cur = building.coordinate.pos;
        const to = { x: cur.x, y: cur.y };
        if (to.x === from.x && to.y === from.y) return;

        const apply = (pos) => {
            Actions.forceMode(EditorModes.SELECTION);
            building.move(Editor.newCoord(pos.x, pos.y, "normal"));
        };
        this.newAction(() => apply(to), () => apply(from));
    }

    static renameBuilding(building, name) {
        const old = building.name;
        if (name === old) return;

        building.rename(name);

        this.newAction(
            () => { Actions.forceMode(EditorModes.SELECTION); building.rename(name); },
            () => { Actions.forceMode(EditorModes.SELECTION); building.rename(old); },
        );
    }

    // gesto cancelado pelo navegador: volta tudo ao que era antes do arrasto
    static revertDrag() {
        const building = Holdable.object;
        const init = Holdable.initialPos;

        if (Holdable.type === "buildingVertex") {
            building.moveVertex(init.index, Editor.newCoord(init.pos.x, init.pos.y, "normal"));
            for (const { dot, pos } of init.entrances) {
                dot.move(Editor.newCoord(pos.x, pos.y, "normal"));
            }
        } else if (Holdable.type === "buildingPin") {
            building.move(Editor.newCoord(init.pos.x, init.pos.y, "normal"));
        }
        Holdable.set(false);
    }

    static resizeSelection(before, after) {
        const apply = (layout) => {
            Actions.forceMode(EditorModes.SELECTION);
            Editor.SelectRegion.applyLayout(layout);
        };
        this.newAction(() => apply(after), () => apply(before));
    }

    static newBuilding(mouseX, mouseY) {
        const coord = Editor.newCoord(mouseX, mouseY, "screen");
        let building = new Editor.Building(coord, Task.data["name"]);

        const before = Task.snapshot();
        building.enable();
        Task.data["buildObject"] = building;
        Task.nextStep();
        const after = Task.snapshot();

        const forward = () => {
            Actions.forceMode(EditorModes.CONSTRUCTION);
            building.enable();
            Task.restore(after);
        };
        const backward = () => {
            Actions.forceMode(EditorModes.CONSTRUCTION);
            building.disable();
            Task.restore(before);
        };
        const prune = () => {
            if (building) {
                building.destroy();
                building = null;
            }
        };

        this.newAction(forward, backward, prune);
        building._helperCreate = this.actionStack[this.actionStack.length - 1];
        return building;
    }

    static pinMode(bool) {
        mapObj.classList.toggle("custom-cursor", bool);
    }

    static beginTask(name, data) {
        if (name == "build") {
            Task.setTask(name, data);
        }
    }

    static syncTaskUI() {
        syncHandles();
        if (!pinBtn || !constructionPanel) return;
        const inBuild = Task.task === "build";
        const building = inBuild && Task.taskStep === 1 ? Task.data["buildObject"] : null;

        this.pinMode(inBuild && Task.taskStep === 0);

        let state = "idle";
        if (inBuild) {
            if (Task.taskStep === 0) state = "placing";
            else state = building && (building.closed || building.vertices.length >= 3) ? "done" : "drawing";
        }

        pinDone = state === "done";
        pinBtn.dataset.state = state;
        pinBtn.disabled = state === "placing";   

        const label = `${PIN_STATES[state].title}: ${PIN_STATES[state].hint}`;
        pinBtn.title = label;
        pinBtn.setAttribute("aria-label", PIN_STATES[state].title);

        constructionPanel.classList.toggle("open", editorMode === EditorModes.CONSTRUCTION);
        constructionPanel.classList.toggle("busy", state !== "idle");
    }

    static bannerToken = 0;

    static async openBanner(obj) {
        if (Holdable.type === "banner" && Holdable.object === obj &&
            !bannerTab.classList.contains("hidden")) return;

        if (!bannerTab.classList.contains("hidden")) {
            if (!(await this.ensureBannerValid())) return;   // incomplete banner: ask first

            const closing = this.closeBanner();
            const token = this.bannerToken;
            await closing;
            if (token !== this.bannerToken) return;
        }

        this.bannerToken++;

        this.saveBanner();
        resetDisplayImage();
        Holdable.set(obj, "banner", { img: obj.banner.image || false });
        this.restoreBanner(obj);
        syncBannerStatus();
        bannerTab.classList.remove("hidden");
    }

    static async closeBanner() {
        const wasHidden = bannerTab.classList.contains("hidden");
        const token = ++this.bannerToken;

        bannerTab.classList.add("hidden");
        this.saveBanner();
        if (Holdable.type === "banner") Holdable.set(false);

        if (!wasHidden) await waitForTransition(bannerTab); // só espera se havia o que animar
        if (token !== this.bannerToken) return;             // foi reaberto/fechado de novo
        showImage(null);
    }

    static saveBanner() {
        if (page != "editor") return;
        if (!bannerHeld()) return;

        const banner = Holdable.object.banner;
        if (!banner) return;

        const image = Holdable.initialPos?.img || false;
        const title = bannerTitle.value.trim();
        const description = bannerDescription.value.trim();
        const titleAlias = [...bannerAliases];

        banner.detailed = !!(image || title || description);
        banner.image = image;
        banner.title = title;
        banner.description = description;
        banner.titleAlias = titleAlias;
    }

    static restoreBanner(obj) {
        const b = obj.banner;

        if (b.image) {
            setDisplayImage(b.image);
        } else if (page == "main" && defaultImageFile) {
            showImage(defaultImageFile);
        } else if (page == "main") {
            showImage(defaultImage);
        }

        bannerTitle.value = b.title || "";
        if(page == "main" && !bannerTitle.value && obj.name) {
            bannerTitle.value = obj.name;
        }
        bannerDescription.value = b.description || "";

        setBannerAliases(b.titleAlias || []);

        if (page == "main") syncDescriptionLabel();
    }

    static confirmingBanner = false;

    static async ensureBannerValid() {
        const { state, missing } = bannerState();

        if (state !== "partial") return true;
        if (this.confirmingBanner) return false;

        this.confirmingBanner = true;
        const discard = await this.openModal("bannerIncomplete", { missing });
        this.confirmingBanner = false;

        if (!discard) return false;
        clearBannerFields();
        return true;
    }

    static async requestCloseBanner() {
        if (!(await this.ensureBannerValid())) return false;
        await this.closeBanner();
        return true;
    }

    static openUser(user) {
        userTab.classList.remove("collapsed");
        Actions.updateUserTab();
    }
    static closeUser() {
        userTab.classList.add("collapsed");
        Actions.updateUserTab();
    }
    static updateUserTab() {
        const open = !userTab.classList.contains('collapsed');
        mapContainer.style.setProperty(
            '--user-tab-height',
            open ? userTab.offsetHeight + 'px' : '0px'
        );
    }

    static async openModal(name, data) {
        if (name == "share") {
            const shareData = data.shareData;

            Modals.modal.open({
                title: 'Compartilhar página',
                size: 'sm',
                html: `
                <div class="share-social-grid">
                    <button type="button" class="social-btn" data-platform="whatsapp">
                        <img src="https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/whatsapp.svg" width="16" height="16" alt="WhatsApp">
                        WhatsApp
                    </button>

                    <button type="button" class="social-btn" data-platform="instagram">
                        <img src="https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/instagram.svg" width="16" height="16" alt="Instagram">
                        Instagram
                    </button>
                </div>
                <div class="share-link-box">
                    <input type="text" id="share-input" value="${shareData.url.toString()}" readonly />
                    <button type="button" id="btn-copy-share" class="btn-copy">Copiar</button>
                </div>
                `,
                onMount(body) {
                const btnCopy = body.querySelector('#btn-copy-share');
                const input = body.querySelector('#share-input');

                document.querySelectorAll('.social-btn').forEach(button => {
                button.addEventListener('click', async () => {
                    const platform = button.getAttribute('data-platform');

                    if (platform === 'whatsapp') {
                        const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareData.text + ' ' + shareData.url)}`;
                        window.open(whatsappUrl, '_blank');
                        
                        } else if (platform === 'instagram') {
                            try {
                                await navigator.clipboard.writeText(shareData.url);
                                Toasts.toaster.show({text: "Link copiado!", category: "success"});
                                window.open('https://www.instagram.com/', '_blank');
                            } catch (err) {
                                console.error('Failed to copy text: ', err);
                            }
                        }
                    });
                });

                btnCopy.addEventListener('click', async () => {
                    await navigator.clipboard.writeText(input.value);
                    Toasts.toaster.show({ text: 'Link copiado', category: "success"});
                });
                }
            });
        } else if (name == "buildRename") {
            const building = data.building;

            Modals.modal.open({
                title: 'Renomear construção',
                size: 'sm',
                html: `
                    <form class="modal-form" id="renameForm">
                        <div class="form-group">
                            <label for="rename-input">Nome:</label>
                            <input type="text" id="rename-input" autocomplete="off" required>
                        </div>
                        <button type="submit" class="modal-submit-btn">Salvar</button>
                    </form>
                `,
                onMount(body, manager) {
                    const form = body.querySelector('#renameForm');
                    const input = body.querySelector('#rename-input');
                    input.value = building.name;   // por .value: sem problema com aspas no nome
                    input.focus();
                    input.select();

                    form.addEventListener('submit', (e) => {
                        e.preventDefault();
                        const name = input.value.trim();
                        if (!name) return;
                        manager.close();
                        Actions.renameBuilding(building, name);
                    });
                },
            });
        } else if (name == "buildName") {
            let submitted = false;

            Modals.modal.open({
                title: 'Nova Construção',
                size: 'sm',
                html: `
                    <form class="modal-form" id="buildForm">
                        <div class="form-group">
                            <label for="build-name">Nome:</label>
                            <input type="text" id="build-name" placeholder="Use siglas se possível..." autocomplete="off" required>
                        </div>
                        <button type="submit" class="modal-submit-btn">Continuar</button>
                    </form>
                `,
                onMount(body, manager) {
                    const form = body.querySelector('#buildForm');
                    const input = body.querySelector('#build-name');
                    input.focus();

                    form.addEventListener('submit', (e) => {
                        e.preventDefault();
                        const name = input.value.trim();
                        if (!name) return;

                        submitted = true;
                        manager.close();
                        Task.data["name"] = name;
                        Actions.newBuilding(clickX, clickY);
                    });
                },
                onClose() {
                    if (!submitted) Actions.switchMode();
                }
            });
        } else if (name == "buildConfirm") {
            return Modals.modal.confirm({
                title: 'Construção incompleta',
                message: 'A construção tem menos de 3 pontos e não pode ser fechada. Se continuar, ela será descartada.',
                cancelText: 'Voltar',
                confirmText: 'Descartar',
            });
        } else if (name == "buildClose") {
            return Modals.modal.confirm({
                title: 'Fechar a construção?',
                message: 'A construção ainda está aberta. Deseja fechá-la agora? O último ponto será ligado ao primeiro.',
                cancelText: 'Continuar desenhando',
                confirmText: 'Fechar construção',
            });
        } else if (name == "bannerIncomplete") {
            return Modals.modal.confirm({
                title: 'Banner incompleto',
                message: `Um banner precisa ter imagem, título e descrição, ou ficar totalmente vazio. Faltam: ${data.missing.join(", ")}. Se continuar, o que foi preenchido será descartado.`,
                cancelText: 'Continuar editando',
                confirmText: 'Descartar banner',
            });
        }
    }

    static async shareFeature(shareData) {
        if (isMobileDevice() && navigator.share) {
            try {
                await navigator.share(shareData);
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.error('Error sharing:', err);
                }
            }
        } else {
            Actions.openModal("share", {shareData: shareData});
        }
    }

    static deleteSelection() {
        const S = Editor.SelectRegion;
        const vm = S.vertexMode;
        const refs = S.selected.references.filter((r) => r.enabled);
        const builds = vm ? [] : S.selected.build.filter((b) => b.enabled);

        if (vm && S.selected.buildVertices.length && !refs.length) {
            Toasts.toaster.show({ text: "Ainda não é possível apagar vértices soltos.", category: "warn" });
            return true;
        }
        if (!refs.length && !builds.length) return false;

        const gone = new Set(refs);
        const connections = [...new Set(refs.flatMap((r) => r.connections.filter((c) => c.enabled)))];
        // entradas de construções apagadas deixam de ser entrada (as apagadas juntas não precisam)
        const revalidate = [...new Set(
            builds.flatMap((b) => b.entrances.filter((r) => r.enabled && !gone.has(r)))
        )];

        const remove = () => {
            for (const r of refs) r.disable();
            for (const c of connections) c.disable();
            for (const b of builds) b.disable();
            for (const r of revalidate) r.validatePos();
        };
        const restore = () => {
            for (const b of builds) b.enable();
            for (const r of refs) r.enable();            // referências antes das conexões
            for (const c of connections) c.enable();
            for (const r of revalidate) r.validatePos(); // voltam a grudar na parede
        };

        remove();
        this.newAction(
            () => { Actions.forceMode(EditorModes.DELETION); remove(); },
            () => { Actions.forceMode(EditorModes.DELETION); restore(); },
            undefined,
            () => { refs.forEach((r) => r.destroy()); builds.forEach((b) => b.destroy()); },
        );

        S.refresh();
        return true;
    }
}

let panGesture = false;        // pan iniciado com X (o arrasto continua mesmo se soltar o X)

const HOLD_MS = 280;           // segurar mais que isso = modo temporário
const MODE_KEYS = {
    s: EditorModes.SELECTION,
    r: EditorModes.REFERENCE,
    c: EditorModes.CONNECTION,
    b: EditorModes.CONSTRUCTION,
    n: EditorModes.BANNER,
    d: EditorModes.DELETION,
};

const SHORTCUTS = [
    ["S R C B N D", "Seleção, Referência, Conexão, Construção, Banner, Excluir (toque alterna, segurar é temporário)"],
    ["X (segurar)", "Mover o mapa rapidamente"],
    ["Delete / Backspace", "Apaga a seleção ou o que está na mão; sem nada, segurar = modo Excluir"],
    ["Esc", "Cancela o gesto, fecha o banner, sai do modo"],
    ["Enter", "Concluir construção"],
    ["Ctrl+Z / Ctrl+Y", "Desfazer / refazer"],
    ["Ctrl+S", "Salvar"],
    ["Ctrl+A", "Selecionar tudo"],
    ["T", "Seleção: tocar ↔ conter"],
    ["Shift", "Seleção: vértices em vez de construções"],
    ["F", "Enquadrar seleção (ou o mapa todo)"],
    ["Setas", "Mover a câmera (Shift = mais rápido)"],
    ["+ / −", "Zoom"],
    ["Q / E", "Girar a câmera"],
    ["0", "Norte para cima"],
    ["? / H", "Esta ajuda"],
];

function gestureActive() {
    const held = Holdable.object && !["banner", "phantomVertex"].includes(Holdable.type);
    return leftClicking || rightClicking || panGesture || !!held;
}

// troca de modo síncrona só é segura sem tarefa em andamento, sem gesto e sem banner incompleto
function canSwitchSync() {
    return !Task.task && !gestureActive() &&
        !Actions.switching && !Actions.confirmingBanner &&
        bannerState().state !== "partial" &&
        (!Holdable.object || Holdable.type === "banner");
}

function showShortcuts() {
    const rows = SHORTCUTS.map(([k, d]) => `<tr><td><kbd>${k}</kbd></td><td>${d}</td></tr>`).join("");
    Modals.modal.open({
        title: "Atalhos do editor",
        size: "sm",
        html: `<table class="shortcut-table">${rows}</table>`,
    });
}

function addShortcutHints() {
    const hints = [
        [selectionBtn, "S"], [referenceBtn, "R"], [connectionBtn, "C"],
        [buildBtn, "B"], [bannerBtn, "N"], [deleteBtn, "D"], [saveBtn, "Ctrl+S"],
    ];
    for (const [btn, key] of hints) {
        if (!btn) continue;
        const base = btn.title || btn.getAttribute("aria-label") || btn.textContent.trim();
        btn.title = base ? `${base} (${key})` : key;
    }
}

class Keys {
    constructor() {
        throw new Error("Classe estática. Não instancie.");
    }

    static quickPan = false;
    static holds = [];            // pilha de teclas de modo seguradas: { id, mode, prev, t, momentary, same }
    static pendingRestore = null; // modo a restaurar quando o ponteiro for solto

    static shiftDown = false;

    // ---------- entrada ----------

    static onKeyDown(e) {
        if (Modals.modal.dialog.open) return;
        if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;

        const key = e.key.toLowerCase();

        if (e.ctrlKey || e.metaKey) { this.combo(e, key); return; }
        if (e.altKey) return;
        if (key === "shift") { this.onShift(e); return; }

        if (this.single(e, key)) e.preventDefault();
    }

    // keyup sempre processa: nunca deixa um modo temporário preso
    static onKeyUp(e) {
        const key = e.key.toLowerCase();

        if (key === "shift") this.onShift(e);
        else if (key === "x") this.setQuickPan(false);
        else if (key in MODE_KEYS) this.release(key);
        else if (key === "delete" || key === "backspace") this.release("delete");
    }

    // janela perdeu o foco: trata tudo como solto
    static reset() {
        this.shiftDown = false; syncHandles();
        this.setQuickPan(false);
        for (const h of [...this.holds].reverse()) this.release(h.id, true);
    }

    // chamado depois do pointerup: aplica a restauração que estava esperando o gesto acabar
    static flush() {
        if (this.pendingRestore === null || gestureActive()) return;
        const mode = this.pendingRestore;
        this.pendingRestore = null;
        Actions.applyMode(mode);
    }

    static combo(e, key) {
        if (key === "s") {
            e.preventDefault();
            if (!e.repeat && !gestureActive()) save();
            return;
        }
        if (key === "a") {
            e.preventDefault();
            if (!e.repeat) this.selectAll();
            return;
        }
        if (gestureActive()) return;

        if (key === "y" || (e.shiftKey && key === "z")) {
            e.preventDefault();
            Actions.ensureBannerValid().then((ok) => ok && Actions.redo());
        } else if (key === "z") {
            e.preventDefault();
            Actions.ensureBannerValid().then((ok) => ok && Actions.undo());
        }
    }

    // devolve true se a tecla foi tratada (para dar preventDefault)
    static single(e, key) {
        const first = !e.repeat;

        switch (key) {
            case "escape": if (first) this.escape(); return true;
            case "arrowup": case "arrowdown": case "arrowleft": case "arrowright":
                return this.panCamera(e, key);
            case "+": case "=": return this.zoomBy(1.25);
            case "-": return this.zoomBy(1 / 1.25);
            case "x": if (first && !gestureActive()) this.setQuickPan(true); return true;
            case "delete": case "backspace": return this.remove(first);
            case "enter":
                if (first && editorMode === EditorModes.CONSTRUCTION &&
                    Task.task === "build" && Task.taskStep === 1 && !gestureActive()) {
                    Actions.pinAction();
                    return true;
                }
                return false;
            case "f": if (first) this.frame(); return true;
            case "t": if (first) this.toggleTouch(); return true;
            case "q": if (first) this.rotateCamera(-1); return true;
            case "e": if (first) this.rotateCamera(1); return true;
            case "0": if (first) Graficos.smoothRotation(0); return true;
            case "?": case "h": if (first) showShortcuts(); return true;
        }

        if (key in MODE_KEYS) {
            if (first) this.pressMode(key, MODE_KEYS[key]);
            return true;
        }
        return false;
    }

    // ---------- modos (toque alterna, segurar é temporário) ----------

    static pressMode(id, mode, { momentary = false } = {}) {
        if (!canSwitchSync()) {
            // caminho completo (confirmações, construção em andamento...); sem modo temporário
            if (!momentary) Actions.switchMode(mode);
            return;
        }
        const prev = editorMode;
        this.holds.push({ id, mode, prev, t: performance.now(), momentary, same: prev === mode });
        if (prev !== mode) Actions.applyMode(mode);
    }

    static release(id, force = false) {
        const i = this.holds.findIndex((h) => h.id === id);
        if (i < 0) return;
        const [h] = this.holds.splice(i, 1);

        const tap = !h.momentary && !force && performance.now() - h.t < HOLD_MS;

        if (h.same) {                                // já estava nesse modo
            if (tap) Actions.switchMode(h.mode);     // toque: desliga (volta ao livre)
            return;
        }
        if (tap) return;                             // toque: o novo modo fica

        // soltou fora de ordem: o modo atual pertence a quem foi pressionado depois
        const above = this.holds[i];
        if (above) { above.prev = h.prev; return; }

        this.restore(h.prev);
    }

    static restore(prev) {
        if (gestureActive()) { this.pendingRestore = prev; return; }   // espera soltar o mouse
        this.pendingRestore = null;
        Actions.applyMode(prev);
    }

    // ---------- pan rápido ----------

    static setQuickPan(on) {
        if (this.quickPan === on) return;
        this.quickPan = on;
        if (!panGesture) setCursor(on ? "grab" : "");
    }

    // ---------- Delete / Esc ----------

    static remove(first) {
        // desenhando uma construção: volta um ponto (igual ao Ctrl+Z)
        if (Task.task === "build") {
            if (first && Task.taskStep === 1 && !gestureActive()) Actions.undo();
            return true;
        }
        if (!first) return true;

        // segurando algo: apaga o que está na mão (voltando antes à posição original,
        // para o desfazer restaurar no lugar certo)
        const held = Holdable.object;
        if (held && Holdable.type === "reference") {
            const p = Holdable.initialPos;
            held.move(Editor.newCoord(p.x, p.y, "normal"));
            Holdable.set(false);
            Actions.destroyReference(held);
            return true;
        }
        if (held && Holdable.type === "buildingPin") {
            const p = Holdable.initialPos.pos;
            held.move(Editor.newCoord(p.x, p.y, "normal"));
            Holdable.set(false);
            dragStarted = false;
            Actions.destroyBuilding(held);
            return true;
        }

        // há seleção: apaga
        if (!gestureActive() && Actions.deleteSelection()) return true;

        // nada: modo Excluir enquanto a tecla estiver pressionada
        this.pressMode("delete", EditorModes.DELETION, { momentary: true });
        return true;
    }

    static escape() {
        if (this.cancelGesture()) return;
        if (bannerHeld()) { Actions.requestCloseBanner(); return; }
        if (Task.task) { Actions.switchMode(EditorModes.FREE); return; }   // confirma se houver pontos
        if (Editor.SelectRegion.box) { Editor.SelectRegion.refresh(); return; }
        if (editorMode !== EditorModes.FREE) Actions.switchMode(EditorModes.FREE);
    }

    static cancelGesture() {
        if (!gestureActive()) return false;

        if (Holdable.type === "reference" && Holdable.object) {
            const p = Holdable.initialPos;
            Holdable.object.move(Editor.newCoord(p.x, p.y, "normal"));
            Holdable.set(false);
        } else if (Holdable.type === "connectionReference") {
            Holdable.set(false);                         // destrói o fantasma
        }
        panGesture = false;
        Pointer.cancel();   // solta botões, reverte arrasto de construção, limpa seleção e guias
        return true;
    }

    // ---------- seleção ----------

    static onShift(e) {
        this.shiftDown = e.shiftKey;
        syncHandles();

        const S = Editor.SelectRegion;
        if (S.resizing) {
            S.reapplyResize(e.shiftKey);                 // alterna estica ↔ rígido sem mexer o mouse
        } else if (S.startCoord && S.currCoord) {
            S.updateSelection(e.shiftKey);
            S.updateGraphics();
        }
    }

    static toggleTouch() {
        const S = Editor.SelectRegion;
        S.touch = !S.touch;
        Toasts.toaster.show({
            text: S.touch ? "Seleção: basta tocar" : "Seleção: só o que estiver inteiro dentro",
            category: "success",
        });
    }

    static selectAll() {
        if (gestureActive() || Task.task) return;
        if (editorMode !== EditorModes.SELECTION) {
            if (!canSwitchSync()) return;
            Actions.applyMode(EditorModes.SELECTION);
        }
        Editor.SelectRegion.selectAll();
    }

    // ---------- câmera ----------

    static panCamera(e, key) {
        if (gestureActive()) return true;
        const step = e.shiftKey ? 240 : 60;
        const dx = key === "arrowleft" ? step : key === "arrowright" ? -step : 0;
        const dy = key === "arrowup" ? step : key === "arrowdown" ? -step : 0;
        Graficos.setPosition(Graficos.mapContainer.x + dx, Graficos.mapContainer.y + dy);
        return true;
    }

    static zoomBy(factor) {
        if (Graficos.smoothTransform) return true;
        const target = Math.min(Math.max(Graficos.zoom * factor, Graficos.minZoom), Graficos.maxZoom);
        Graficos.animateTransform({ zoom: target, duration: 120 });
        zoom = target;                                   // o espelho local usado pela roda do mouse
        return true;
    }

    static rotateCamera(dir) {
        if (Graficos.smoothTransform) return;
        const r = Graficos.mapContainer.rotation;
        Graficos.animateTransform({
            rotation: (Math.round(r / ROTATION_SNAP) + dir) * ROTATION_SNAP,
            duration: 180,
        });
    }

    // enquadra a caixa da seleção (ou o mapa todo)
    static frame() {
        if (Graficos.smoothTransform) return;

        const S = Editor.SelectRegion;
        const b = S.box;
        let point = { x: 0, y: 0 };
        let target = Graficos.minZoom;

        if (b) {
            // a caixa está no frame da tela: centro volta ao espaço do mapa por R(-rot)
            const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
            const c = Math.cos(S._rot), s = Math.sin(S._rot);
            point = { x: c * cx + s * cy, y: -s * cx + c * cy };

            const vp = Graficos.getViewport();
            const w = Math.max(b.maxX - b.minX, 1), h = Math.max(b.maxY - b.minY, 1);
            target = Math.min(vp.width / w, vp.height / h) * 0.7;   // margem
        }

        target = Math.min(Math.max(target, Graficos.minZoom), Graficos.maxZoom);
        Graficos.animateTransform({ point, zoom: target });
        zoom = target;
    }
}

function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== "") {
        const cookies = document.cookie.split(";");
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === name + "=") {
                cookieValue = decodeURIComponent(
                    cookie.substring(name.length + 1),
                );
                break;
            }
        }
    }
    return cookieValue;
}

async function saveMapState(formData) {
    const url = URLSaveMap;
    const token = sessionStorage.getItem("authToken");

    try {
        const req = {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "X-CSRFToken": getCookie("csrftoken"),
            },
            body: formData,
        };

        const response = await fetch(url, req);

        if (response.status === 401) {
            console.error("Usuário não autorizado.");
            return;
        }

        return response;
    } catch (error) {
        console.error("Erro de rede:", error);
    }
}

let isSaving = false;

function confirmBannerless(bannerless) {
    return new Promise((resolve) => {
        const n = bannerless.length;
        let viewing = false;

        const toast = Toasts.toaster.show({
            category: "warn",
            title: `${n} ${n === 1 ? "construção sem banner" : "construções sem banner"}`,
            text: `${n === 1 ? "Ela aparecerá" : "Elas aparecerão"} no mapa sem título, imagem ou descrição.`,
            duration: 0,
            priority: 5,
            html: `
                <div class="toast-actions">
                    <button type="button" class="modal-button toast-ver" data-action="view">
                        <i class="fa-solid fa-eye"></i> Ver construções
                    </button>
                    <button type="button" class="modal-button" data-action="cancel">Cancelar</button>
                    <button type="button" class="modal-button modal-button-main" data-action="save">Salvar mesmo assim</button>
                </div>
            `,
        });

        const finish = async (result) => {
            toast.removeEventListener("click", onClick);
            if (viewing) Actions.syncHighlight();   // desfaz o destaque
            Toasts.toaster.remove(toast);
            await sleep(200);
            resolve(result);
        };

        const onClick = (e) => {
            const btn = e.target.closest("[data-action]");
            if (!btn) return;
            const action = btn.dataset.action;

            if (action === "view") {
                viewing = !viewing;
                if (viewing) {
                    Graficos.highlightObjects(bannerless.flatMap((b) => [b.graphics, b.polygonGraphics]));
                    btn.innerHTML = '<i class="fa-solid fa-eye-slash"></i> Mostrar tudo';
                } else {
                    Actions.syncHighlight();
                    btn.innerHTML = '<i class="fa-solid fa-eye"></i> Ver construções';
                }
            } else {
                finish(action === "save");
            }
        };

        toast.addEventListener("click", onClick);
    });
}

export async function save() {
    if (isSaving) return;
    isSaving = true;

    try {
        if (!(await Actions.ensureBannerValid())) return;
        const draft = Task.data["buildObject"];
        if (Task.task == "build" && draft && !draft.closed) {
            Toasts.toaster.show({ text: "Feche a forma da construção antes de salvar.", category: "warn" });
            return;
        }
        Actions.saveBanner();

        const bannerless = Editor.Buildings.getBannerless();
        if (bannerless.length > 0 && !(await confirmBannerless(bannerless))) {
            return;
        }

        const progress = Toasts.toaster.showProgress({
            title: "Salvando mapa...",
            tasks: {
                savedBanner: false,
                createdPayload: false,
                preparedFiles: false,
                uploaded: false,
            },
            labels: {
                savedBanner: "Banner salvo...",
                createdPayload: "Dados preparados...",
                preparedFiles: "Arquivos anexados...",
                uploaded: "Sincronizado com o servidor!",
            },
        });

        try {
            progress.completeTask("savedBanner");

            const { payload, files } = Editor.buildPayload();
            progress.completeTask("createdPayload");

            const formData = new FormData();
            formData.append("data", JSON.stringify(payload));

            if (files && typeof files === "object") {
                for (const [bannerId, file] of Object.entries(files)) {
                    if (file instanceof File) {
                        formData.append(`file_${bannerId}`, file, file.name);
                    }
                }
            }
            progress.completeTask("preparedFiles");

            await saveMapState(formData);
            progress.completeTask("uploaded");
        } catch (error) {
            console.error("Erro ao salvar:", error);
            progress.fail("Não foi possível salvar o mapa.");
            throw error;
        }
    } finally {
        isSaving = false;
    }
}

function bannerHeld() {
    return Holdable.type === "banner" && !!Holdable.object;
}

function showImage(src) {
    if (currentObjectURL) {
        URL.revokeObjectURL(currentObjectURL);
        currentObjectURL = null;
    }
    if (!src) {
        imageWrapper.style.backgroundImage = "none";
        return;
    }
    let url = src;
    if (src instanceof Blob) {
        url = currentObjectURL = URL.createObjectURL(src);
    }
    imageWrapper.style.backgroundImage = `url("${url}")`;
}

function setDisplayImage(file) {
    showImage(file);

    if (page == "editor") {
        imageLabel.textContent = "substituir imagem";
    }
    if (bannerHeld()) {
        Holdable.initialPos["img"] = file;
        syncBannerStatus();
    }
}

function resetDisplayImage() {
    imageInput.value = "";
    showImage(null);

    if (page == "editor") {
        imageLabel.textContent = "adicionar imagem +";
    }
}
function updateImageDisplay(e) {
    const file = e.target.files[0];
    if (!file || !bannerHeld()) return;
    setDisplayImage(file);
}

function createSearch(searchFn, onResults, delay = 300) {
    let timer = null;
    let controller = null;
    let requestId = 0;

    const cancel = () => {
        clearTimeout(timer);
        controller?.abort();
        requestId++;
    };

    const execute = async (query) => {
        controller?.abort();
        controller = new AbortController();
        const { signal } = controller;
        const id = ++requestId;

        try {
            const data = await searchFn(query, { signal });
            if (id !== requestId || signal.aborted) return;
            onResults(data || [], query);
        } catch (error) {
            if (error.name !== 'AbortError') console.error('Search error:', error);
        }
    };

    const run = (rawQuery, wait) => {
        const query = rawQuery.trim();
        cancel();
        if (!query) {
            onResults([], '');
            return;
        }
        if (wait) timer = setTimeout(() => execute(query), wait);
        else execute(query);
    };

    return {
        schedule: (query) => run(query, delay), // com debounce (digitando)
        now: (query) => run(query, 0),          // imediata (ao focar/clicar)
        cancel,
    };
}

let locationRequestId = 0;

const RouteUI = {
    async start(place) {
        const title = bannerTitle.value.trim() || 'Destino';
        const wasActive = Editor.Route.active;

        searchHeader.classList.add("hidden");
        routeFields.classList.remove("hidden");
        routeDestination.value = title;
        if (!wasActive) routeOrigin.value = '';

        Editor.Route.start(place, title);
        if (!wasActive) await this.useMyLocation();
    },

    async useMyLocation() {
        const id = ++locationRequestId;
        routeOrigin.placeholder = 'Obtendo sua localização…';

        const status = await Localizacao.requestLocation();
        routeOrigin.placeholder = originPlaceholder;

        // rota fechada, ou o usuário escolheu a partida na mão enquanto esperava
        if (id !== locationRequestId || !Editor.Route.active || Editor.Route.origin) return;

        if (status === 'granted') {
            this.setPoint('origin', selfPoint());
        } else {
            reportLocationFailure(status);
            routeOrigin.focus();
        }
    },

    stop() {
        Editor.Route.stop();
        routeOrigin.value = '';
        routeDestination.value = '';

        routeFields.classList.add("hidden");
        searchHeader.classList.remove("hidden");

        activeInput = null;
        expanded = false;
        search.cancel();
        currentResults = [];
        currentQuery = '';
        renderSearchList();
    },

    setPoint(which, point) {
        Editor.Route.setPoint(which, point);

        const input = which === 'origin' ? routeOrigin : routeDestination;
        const other = which === 'origin' ? routeDestination : routeOrigin;
        const otherPoint = which === 'origin' ? Editor.Route.destination : Editor.Route.origin;

        input.value = point ? point.title : '';
        if (point && !otherPoint) other.focus();
        else input.blur();
    },

    swap() {
        Editor.Route.swap();
        [routeOrigin.value, routeDestination.value] = [routeDestination.value, routeOrigin.value];
    },
};

function selfPoint() {
    return Editor.Self ? { ref: Editor.Self, title: 'Sua localização', self: true } : null;
}

// título do ponto já escolhido naquele campo (para não buscar o que já foi escolhido)
function pointTitle(input) {
    if (input === routeOrigin) return Editor.Route.origin?.title;
    if (input === routeDestination) return Editor.Route.destination?.title;
    return null;
}

// a expansão (HR + lista) só aparece quando há conteúdo
function syncExpansion() {
    const hasContent = searchList.children.length > 0;
    searchExpansion.classList.toggle('hidden', !(expanded && hasContent));
}

function renderSearchList() {
    activeImageUrls.forEach(url => URL.revokeObjectURL(url));
    activeImageUrls = [];

    let html = '';

    // no campo de partida, "Sua localização" é sempre uma opção rápida
    if (Editor.Route.active && activeInput === routeOrigin && Editor.Self && !Editor.Route.origin?.self) {
        html += `
            <li class="search-element" data-self="true">
                <div class="search-element-icon"><i class="fa-solid fa-location-crosshairs"></i></div>
                <aside class="search-element-description">
                    <h3>Sua localização</h3>
                    <p>Usar onde você está agora</p>
                </aside>
            </li>`;
    }

    if (currentQuery) {
        if (currentResults.length === 0) {
            html += '<li class="no-results">Nenhum resultado</li>';
        } else {
            html += currentResults.map((item, index) => {
                let imageSrc = defaultIconImage;

                if (item.image instanceof Blob) {
                    imageSrc = URL.createObjectURL(item.image);
                    activeImageUrls.push(imageSrc);
                } else if (typeof item.image === 'string' && item.image) {
                    imageSrc = item.image;
                }

                return `
                    <li class="search-element" data-index="${index}">
                        <img src="${imageSrc}" alt="${item.title}" onerror="this.onerror=null; this.src='${defaultIconImage}';">
                        <aside class="search-element-description">
                            <h3>${item.title}</h3>
                            <p>${item.description}</p>
                        </aside>
                    </li>`;
            }).join('');
        }
    }

    searchList.innerHTML = html;
    syncExpansion();
}

// chamado ao focar ou clicar em qualquer um dos três campos
function activateInput(input) {
    expanded = true;

    if (activeInput !== input) {
        activeInput = input;
        search.cancel();
        currentResults = [];
        currentQuery = '';

        const text = input.value.trim();
        if (text && text !== pointTitle(input)) search.now(text);
    }

    renderSearchList();
}

function pickResult(item) {
    const target = activeInput;
    activeInput = null;
    expanded = false;
    syncExpansion();

    if (Editor.Route.active) {
        const point = { ref: item.ref, title: item.title };
        RouteUI.setPoint(target === routeOrigin ? 'origin' : 'destination', point);
    } else {
        goToPlace(item.ref, 2);
        Actions.openBanner(item.ref);
        searchField.blur();
    }
}

function reportLocationFailure(status, deniedText = 'Localização desativada: não é possível traçar rota a partir da sua posição.') {
    if (status === 'denied') {
        Toasts.toaster.show({ text: deniedText, category: "error" });
    } else if (status !== 'dismissed') {
        Toasts.toaster.show({ text: 'Não foi possível obter sua localização.', category: "error" });
    }
}

async function pickSelf() {
    activeInput = null;
    expanded = false;
    syncExpansion();

    const status = await Localizacao.requestLocation();
    if (!Editor.Route.active) return;

    if (status === 'granted') RouteUI.setPoint('origin', selfPoint());
    else reportLocationFailure(status);
}

function initSearch() {
    searchForm = document.getElementById("search");
    searchHeader = document.getElementById("search-header");
    searchField = document.getElementById("search-field");
    searchExpansion = document.getElementById("search-expansion");
    searchList = document.getElementById("search-list");

    routeFields = document.getElementById("route-fields");
    routeOrigin = document.getElementById("route-origin");
    originPlaceholder = routeOrigin.placeholder;

    Localizacao.onPermissionChange((state) => {
        if (state === 'granted' || !Editor.Route.active || !Editor.Route.origin?.self) return;
        Editor.Route.clearPoint('origin');
        routeOrigin.value = '';
        reportLocationFailure(state === 'denied' ? 'denied' : 'unavailable');
    });

    routeDestination = document.getElementById("route-destination");

    search = createSearch(Editor.queryBanner, (results, query) => {
        currentResults = results;
        currentQuery = query;
        renderSearchList();
    });

    for (const input of [searchField, routeOrigin, routeDestination]) {
        input.addEventListener('focus', () => activateInput(input));
        input.addEventListener('click', () => activateInput(input));
        input.addEventListener('input', () => {
            activeInput = input;
            expanded = true;
            if (input !== searchField) {
                Editor.Route.clearPoint(input === routeOrigin ? 'origin' : 'destination');
            }
            search.schedule(input.value);
        });
    }

    searchHeader.addEventListener('click', (e) => {
        if (e.target !== searchField) searchField.focus();
    });
    routeFields.addEventListener('click', (e) => {
        const field = e.target.closest('.route-field');
        if (field && e.target.tagName !== 'INPUT') field.querySelector('input').focus();
    });

    document.addEventListener('pointerdown', (e) => {
        if (searchForm.contains(e.target)) return;
        activeInput = null;
        expanded = false;
        syncExpansion();
    });

    searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (currentResults[0]) pickResult(currentResults[0]);
    });

    searchList.addEventListener('click', (event) => {
        const element = event.target.closest('.search-element');
        if (!element) return;

        if (element.dataset.self) {
            pickSelf();
            return;
        }

        const item = currentResults[element.dataset.index];
        if (item?.ref) pickResult(item);
    });

    document.getElementById("route-close").addEventListener('click', () => RouteUI.stop());
    document.getElementById("route-swap").addEventListener('click', () => RouteUI.swap());

    Editor.Route.subscribe((type) => {
        if (type === "nopath") {
            Toasts.toaster.show({ text: 'Nenhum caminho encontrado', category: "error" });
        }
    });
}

function updateUrlParams(paramsObj, specialUrl) {
    let url = specialUrl;
    let winUrl = false;
    if(!specialUrl) {
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

function buildURL(url, param) {
    const newUrl = new URL(url);
    
    updateUrlParams(param, newUrl);

    return newUrl;
}

function goToPlace(place, zoomVal) {
    Graficos.animateTransform({point: place.coordinate.getIn("normal"), zoom: zoomVal});
    zoom = zoomVal;
}

export async function addListeners(map) {
    mapObj = map;
    map.addEventListener("pointerdown", Pointer.down);
    map.addEventListener("pointermove", Pointer.move);
    document.addEventListener("pointerup", Pointer.up);
    map.addEventListener("wheel", Pointer.wheel, { passive: false });
    document.addEventListener("pointercancel", Pointer.cancel);

    map.addEventListener("touchstart", Touch.begin, { passive: false });
    map.addEventListener("touchmove", Touch.step, { passive: false });
    document.addEventListener("touchend", Touch.end);

    mapContainer = document.getElementById("map-container");

    document.addEventListener('contextmenu', function(event) {
        event.preventDefault();
    });

    bannerTab = document.getElementById("banner");

    hoverLoop = () => {
        if (hoverSet.size === 0 && hoverTargetSet.size === 0) return;

        for(const obj of hoverTargetSet) {
            obj.hoverAdd();
            if (!hoverSet.has(obj)) {
                hoverSet.add(obj);
            }
        }
        let remove = [];
        for(const obj of hoverSet) {
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
    setInterval(hoverLoop, 1000 / 30);

    if(sharePlaceLat && sharePlaceLong) {

        let normalPoint = Localizacao.GeographicalToMap({x: sharePlaceLat, y: sharePlaceLong});
        let coord = Editor.newCoord(normalPoint[0], normalPoint[1], "normal");
        if (!(shareRender == "0")) {
            Editor.TouchPin.setPos(coord);
            Editor.TouchPin.setVisible(true);
        }
        goToPlace({coordinate: coord}, 2);
    }

    if (page == "main") {
        const orientationBtn = document.getElementById("orientation");
        const optionsBtn = document.getElementById("options");
        const closeBtn = document.getElementById("close-sidebar");
        const sidebar = document.getElementById("sidebar");
        const backdrop = document.getElementById("sidebar-backdrop");

        bannerTab = document.getElementById("screen-ui");
        imageInput = document.getElementById("banner-image-input");
        imageWrapper = document.getElementById("image-upload-wrapper");
        imageLabel = document.getElementById("image-upload-label");
        bannerTitle = document.getElementById("place-name");
        bannerDescription = document.getElementById("place-description");
        bannerDescription.placeholder = "Sem descrição";

        initSearch();

        const response = await fetch(defaultImage);
        const blob = await response.blob();

        const mimeType = blob.type || "image/png";
        defaultImageFile = new File([blob], "ifrn-logo.png", {
            type: mimeType,
        });

        const closeMenu = () => deactivateList([sidebar, backdrop]);

        orientationBtn.addEventListener('click', () => Graficos.smoothRotation(0));
        optionsBtn.addEventListener('click', () => activateList([sidebar, backdrop]));
        closeBtn.addEventListener('click', closeMenu);
        backdrop.addEventListener('click', closeMenu);

        document.getElementById("banner-route").addEventListener("click", () => {
            if (bannerHeld()) RouteUI.start(Holdable.object);
        });

        document.getElementById("banner-share").addEventListener("click", async () => {
            let coord = Holdable.object.coordinate;
            
            let geocoords = Localizacao.mapToGeographical(coord.getIn("normal"));
            
            if (!Array.isArray(geocoords) || !Number.isFinite(geocoords[0]) || !Number.isFinite(geocoords[1])) {
                Toasts.toaster.show({ text: "Falha ao comparilhar.", category: "error" });
                return;
            }

            let url = buildURL(window.location.origin + window.location.pathname, {showpin: 0, lat: geocoords[0], long: geocoords[1]});
            
            const shareData = {
                title: 'Venha aqui!',
                text: 'Olha só esse lugar!',
                url: url
            };
            Actions.shareFeature(shareData);
        });

        userTab = document.getElementById("user-tab");
        shareLocation = document.getElementById("share-location");
        shareLocation.addEventListener("click", async () => {
            const status = await Localizacao.requestLocation();
            if (status === "granted") {
                let geocoords = Localizacao.mapToGeographical(Editor.Self.coordinate.getIn("normal"));
                
                if (!Array.isArray(geocoords) || !Number.isFinite(geocoords[0]) || !Number.isFinite(geocoords[1])) {
                    Toasts.toaster.show({ text: "Falha ao comparilhar.", category: "error" });
                    return;
                }
                
                let url = buildURL(window.location.origin + window.location.pathname, {showpin: 1, lat: geocoords[0], long: geocoords[1]});
                
                const shareData = {
                    title: 'Venha ver onde eu estou!',
                    text: 'Olha só onde eu estou!',
                    url: url
                };
            
                Actions.shareFeature(shareData);
            }
            else reportLocationFailure(status, 'Localização desativada: não é possível compartilhá-la.');
        });

        Editor.load();
    } else if (page == "editor") {
        buildBtn = document.getElementById("build");
        referenceBtn = document.getElementById("reference");
        connectionBtn = document.getElementById("connection");
        bannerBtn = document.getElementById("banner-btn");
        saveBtn = document.getElementById("save");
        pinBtn = document.getElementById("pin-mode");
        constructionPanel = document.getElementById("construction-group");
        bannerStatus = document.getElementById("banner-status");

        imageInput = document.getElementById("banner-image-input");
        imageWrapper = document.getElementById("image-upload-wrapper");
        imageLabel = document.getElementById("image-upload-label");
        bannerTitle = document.getElementById("place-name");
        bannerDescription = document.getElementById("place-description");
        bannerAliasInput = document.getElementById("banner-alias-input");
        bannerAliasList = document.getElementById("banner-alias-list");

        selectionBtn = document.getElementById("selection");
        deleteBtn = document.getElementById("delete");
        
        let bannerForm = document.getElementById("bannerForm");

        bannerForm.addEventListener("submit", (e) => {
            e.preventDefault();
        });

        document.addEventListener("keydown", (e) => Keys.onKeyDown(e));
        document.addEventListener("keyup", (e) => Keys.onKeyUp(e));
        window.addEventListener("blur", () => Keys.reset());
        document.addEventListener("pointerup", () => Keys.flush());   // depois do Pointer.up

        mapObj.dataset.mode = editorMode;
        addShortcutHints();

        document.getElementById("banner-close").addEventListener("click", () => Actions.requestCloseBanner());
        for (const field of [bannerTitle, bannerDescription]) {
            field.addEventListener("input", syncBannerStatus);
        }
        for (const tab of document.querySelectorAll("[data-tab]")) {
            tab.addEventListener("click", () => switchTab(tab.dataset.tab));
        }

        buildBtn.addEventListener("click", () => Actions.switchMode(EditorModes.CONSTRUCTION));
        referenceBtn.addEventListener("click", () => Actions.switchMode(EditorModes.REFERENCE));
        connectionBtn.addEventListener("click", () => Actions.switchMode(EditorModes.CONNECTION));
        bannerBtn.addEventListener("click", () => Actions.switchMode(EditorModes.BANNER));
        selectionBtn.addEventListener("click", () => Actions.switchMode(EditorModes.SELECTION));
        deleteBtn.addEventListener("click", () => Actions.switchMode(EditorModes.DELETION));
        pinBtn.addEventListener("click", () => Actions.pinAction());

        saveBtn.addEventListener("click", save);

        imageInput.addEventListener("change", (e) => updateImageDisplay(e));

        bannerAliasInput.addEventListener("keydown", (e) => {
            if (
                e.key === " " ||
                e.key === "Enter" ||
                e.key === ","
            ) {
                e.preventDefault();
                commitBannerAliasInput();
                return;
            }

            // Backspace remove a última etiqueta quando o campo está vazio.
            // event.repeat permite remover várias ao manter a tecla pressionada.
            if (
                e.key === "Backspace" &&
                !bannerAliasInput.value &&
                bannerAliases.length > 0
            ) {
                e.preventDefault();

                bannerAliases.pop();
                renderBannerAliases();
            }
        });

        // Colar "biblioteca bloco A entrada" cria quatro etiquetas.
        bannerAliasInput.addEventListener("paste", (e) => {
            e.preventDefault();

            const pasted = e.clipboardData?.getData("text") || "";

            addBannerAliases(pasted);
        });

        // Não deixa conteúdo parcialmente digitado para trás.
        bannerAliasInput.addEventListener("blur", () => {
            commitBannerAliasInput();
        });     

        Editor.load();
    }
}
