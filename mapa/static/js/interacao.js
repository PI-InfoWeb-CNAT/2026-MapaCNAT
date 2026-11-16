import * as Transformacao from "./transformacao.js";
import * as Graficos from "./graficos.js";
import * as Editor from "./editor.js";
import * as Toasts from './toasts.js';
import * as Modals from './modals.js';
import * as Localizacao from './localizacao.js';
import { getShortestPath } from "./rota.js";

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

class Detail {
    constructor() {
        throw new Error("Classe estática. Não instancie.");
    }
    static detail = null;
    static set(detail) {
        detail = detail || null;
        if (detail === this.detail) return;      // nada mudou: não reconstrói polígono
        if (this.detail) {
            this.detail.convertTo("polygon");
        }
        this.detail = detail;
        if (this.detail) {
            this.detail.convertTo("areas");
        }
    }
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

const hasEnabledAreas = (b) => !!b && b.areas.some((a) => a.enabled);

const PIN_STATES = {
    idle:    { title: "Nova construção",     hint: "Clique para começar" },
    placing: { title: "Posicione o pin",     hint: "Clique no mapa onde fica a construção" },
    drawing: { title: "Desenhe a área",      hint: "Arraste no mapa para criar a primeira área" },
    done:    { title: "Concluir construção", hint: "Arraste para somar áreas ou conclua" },
};

// a banner is valid when it has image + title + description, or none of them
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
    if ((ref = Editor.Buildings.getOverlappingAreas(coord)?.building)) return { type: "area", ref };
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
        Graficos.setRotation(mapStartAngle + delta);
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
            moved = true;            // cancels any pending tap
            pressedTarget = null;
        }
        if (e.touches.length == 2) {
            const a = e.touches[0];
            const b = e.touches[1];
            const mid = Transformacao.midpoint(a, b);
            startMidX = mid.x;
            startMidY = mid.y;
            startDistance = Transformacao.distance(a, b);
            startAngle = Transformacao.angle(a, b);
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
            Graficos.setPosition(
                mid.x + rotated.x * zoom,
                mid.y + rotated.y * zoom,
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
        rotateOffsetX = mapStartX - clickX;
        rotateOffsetY = mapStartY - clickY;

        if (e.button === 0) leftClicking = true;
        else if (e.button === 2) rightClicking = true;

        if (e.target === mapObj) mapObj.setPointerCapture?.(e.pointerId);

        moved = false;
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
            if (editorMode == EditorModes.REFERENCE) {
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
                        const area = Editor.Buildings.getOverlappingAreas(coord, false);
                        if (area) Actions.destroyArea(area);
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
                    } else if (Task.taskStep == 1) {
                        let coord = Editor.newCoord(clickX, clickY, "screen");
                        let border =
                            Editor.Buildings.getOverlappingAreaBorders(coord);
                        if (border) {
                            Holdable.set(border, "BuildAreaBorder", {
                                start: border.area.start.getIn("normal"),
                                end: border.area.end.getIn("normal"),
                            });
                            Editor.Referencer.beginReport();
                        } else {
                            let phantomObject = new Editor.PhantomArea(
                                clickX,
                                clickY,
                            );
                            Holdable.set(
                                true,
                                "BuildArea",
                                { x: clickX, y: clickY },
                                (phantomObject = phantomObject),
                            );
                        }
                    }
                } else {
                    let coord = Editor.newCoord(clickX, clickY, "screen");
                    let border =
                        Editor.Buildings.getOverlappingAreaBorders(coord);
                    if (border) {
                        Holdable.set(border, "BuildAreaBorder", {
                            start: border.area.start.getIn("normal"),
                            end: border.area.end.getIn("normal"),
                        });
                        Editor.Referencer.beginReport();
                    }
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

    static move(e) {
        if (!e.isPrimary || pinching) return;
        
        if(Graficos.smoothTransform) {
            return;
        }

        moved = true;
        clearLongPress();

        
        if (page == "main") {
            if (leftClicking || rightClicking) {
                if (!moved) {
                    if (!passedDragThreshold(e)) return;
                    moved = true;
                    hoverTargetSet = new Set();   // un-highlight whatever was hovered
                    setCursor("default");
                }
            }
            scheduleMainMove(e);
            return;
        }

        hoverTargetSet = new Set();
        
        if (page == "editor") {
            if (editorMode == EditorModes.FREE) {
                if (!leftClicking) return;
                Pointer.defaultMove(e);
            } else if (editorMode == EditorModes.REFERENCE) {
                if (Holdable.object) {
                    let coord = Editor.newCoord(e.clientX, e.clientY, "screen");

                    Holdable.object.move(coord);
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
                const area = Editor.Buildings.getOverlappingAreas(coord);

                Detail.set(area ? area.building : false);

                if (dot) {
                    hoverTargetSet.add(dot);
                } else if (line) {
                    hoverTargetSet.add(line);
                } else if (area) {
                    hoverTargetSet.add(area);
                } else {
                    if (!leftClicking) return;
                    Pointer.defaultMove(e);
                }
            } else if (editorMode == EditorModes.CONSTRUCTION) {
                if (Task.task == "build") {
                    if (Holdable.type == "BuildAreaBorder") {
                        let screenStart =
                            Holdable.object.area.start.getIn("screen");
                        let screenEnd =
                            Holdable.object.area.end.getIn("screen");
                        if (Holdable.object.side == "top") {
                            screenStart = {
                                x: screenStart.x,
                                y: Math.min(e.clientY, screenEnd.y - 20),
                            };
                        } else if (Holdable.object.side == "left") {
                            screenStart = {
                                x: Math.min(e.clientX, screenEnd.x - 20),
                                y: screenStart.y,
                            };
                        } else if (Holdable.object.side == "right") {
                            screenEnd = {
                                x: Math.max(e.clientX, screenStart.x + 20),
                                y: screenEnd.y,
                            };
                        } else {
                            screenEnd = {
                                x: screenEnd.x,
                                y: Math.max(e.clientY, screenStart.y + 20),
                            };
                        }
                        screenStart = Editor.newCoord(
                            screenStart.x,
                            screenStart.y,
                            "screen",
                        );
                        screenEnd = Editor.newCoord(
                            screenEnd.x,
                            screenEnd.y,
                            "screen",
                        );
                        screenStart.convertTo("normal");
                        screenEnd.convertTo("normal");
                        Holdable.object.area.move(screenStart, screenEnd);
                    }
                    if (Holdable.type == "BuildArea") {
                        let coord = Editor.newCoord(
                            e.clientX,
                            e.clientY,
                            "screen",
                        );
                        Holdable.phantomObject.setEndPoint(coord);
                    }
                    if (Task.taskStep == 1) {
                        let coord = Editor.newCoord(
                            e.clientX,
                            e.clientY,
                            "screen",
                        );
                        let border =
                            Editor.Buildings.getOverlappingAreaBorders(coord);
                        if (border) {
                            hoverTargetSet.add(border.area.sides[border.side]);
                        }
                    }
                } else {
                    const coord = normalCoordAt(e.clientX, e.clientY);
                    const area = Editor.Buildings.getOverlappingAreas(coord);
                    const border = Editor.Buildings.getOverlappingAreaBorders(coord);
                    Detail.set(area ? area.building : false);
                    if (border) {
                        hoverTargetSet.add(border.area.sides[border.side]);
                    }

                    if (Holdable.type == "BuildAreaBorder") {
                        let area = Holdable.object.area;
                        Detail.set(area.building);
                        let screenStart = area.start.getIn("screen");
                        let screenEnd = area.end.getIn("screen");
                        if (Holdable.object.side == "top") {
                            screenStart = {
                                x: screenStart.x,
                                y: Math.min(e.clientY, screenEnd.y - 20),
                            };
                        } else if (Holdable.object.side == "left") {
                            screenStart = {
                                x: Math.min(e.clientX, screenEnd.x - 20),
                                y: screenStart.y,
                            };
                        } else if (Holdable.object.side == "right") {
                            screenEnd = {
                                x: Math.max(e.clientX, screenStart.x + 20),
                                y: screenEnd.y,
                            };
                        } else {
                            screenEnd = {
                                x: screenEnd.x,
                                y: Math.max(e.clientY, screenStart.y + 20),
                            };
                        }
                        screenStart = Editor.newCoord(
                            screenStart.x,
                            screenStart.y,
                            "screen",
                        );
                        screenEnd = Editor.newCoord(
                            screenEnd.x,
                            screenEnd.y,
                            "screen",
                        );
                        screenStart.convertTo("normal");
                        screenEnd.convertTo("normal");
                        area.move(screenStart, screenEnd);
                    } else {
                        if (!leftClicking) return;
                        Pointer.defaultMove(e);
                    }
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

        if (pinching) {
            clearLongPress();
            pressedTarget = null;
            return;
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

                if (pressed.selfPin) Actions.openUser(pressed);
                else Actions.openBanner(pressed);
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
                if (Task.task == "build") {
                    if (Holdable.object) {
                        if (Holdable.type == "BuildArea") {
                            let phantom = Holdable.phantomObject;
                            if (
                                phantom.end &&
                                Math.abs(
                                    phantom.end.pos.x - phantom.start.pos.x,
                                ) >= 20 &&
                                Math.abs(
                                    phantom.end.pos.y - phantom.start.pos.y,
                                ) >= 20
                            ) {
                                Actions.newArea(phantom.start, phantom.end);
                            }
                            phantom.destroy();
                            Holdable.set(false);
                        } else if (Holdable.type == "BuildAreaBorder") {
                            Actions.moveAreaBorder(Holdable);
                            Holdable.set(false);
                        }
                    }
                } else {
                    if (Holdable.type == "BuildAreaBorder") {
                        Detail.set(false);
                        Actions.moveAreaBorder(Holdable);
                        Holdable.set(false);
                    }
                }
            }
        }
    }
    static cancel() {
        clearLongPress();
        leftClicking = false;
        rightClicking = false;
        moved = true;          // a cancelled gesture must never count as a tap
        pressedTarget = null;
    }

    static wheel(e) {
        e.preventDefault();

        if(Graficos.smoothTransform) {
            return;
        }

        const mX = e.offsetX;
        const mY = e.offsetY;

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
        let reference = new Editor.Reference(coord);

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
        Detail.set();
        editorMode = mode;
        Graficos.editorFocus(
            [
                EditorModes.DELETION,
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
        if (Task.task == "build" && Task.taskStep == 1) {
            const building = Task.data["buildObject"];
            if (building && !hasEnabledAreas(building)) {
                const idx = this.findActionIndex(building._helperCreate);
                if (idx >= 0) this.prune(idx, 1);
            }
        }
        Task.reset();
    }

    static switching = false;

    static async switchMode(mode = EditorModes.FREE) {
        if (this.switching) return;

        this.switching = true;
        const bannerOk = await this.ensureBannerValid();
        this.switching = false;
        if (!bannerOk) return;

        if (editorMode == EditorModes.CONSTRUCTION) {
            const building = Task.data["buildObject"];
            if (
                Task.task == "build" &&
                Task.taskStep == 1 &&
                !hasEnabledAreas(building)
            ) {
                this.switching = true;
                const discard = await Actions.openModal("buildConfirm");
                this.switching = false;
                if (!discard) return;
            }
            this.resetTask();
        }
        if (editorMode == mode) mode = EditorModes.FREE;
        this.applyMode(mode);
    }

    static finishTask() {
        const before = Task.snapshot();

        let building = Task.data["buildObject"];

        building.convertTo("polygon");

        Task.reset();
        const after = Task.snapshot();

        this.newAction(
            () => {
                Actions.forceMode(EditorModes.CONSTRUCTION);

                building.convertTo("polygon");

                Task.restore(after);
            },
            () => {
                Actions.forceMode(EditorModes.CONSTRUCTION);

                Task.restore(before);

                building.convertTo("areas");
            },
        );
    }

    static snapshotMotion() {
        let snapshot = Object.values(Editor.Referencer.motionReport).map(
            ([dot, b]) => ({
                dot,
                before: { x: b.x, y: b.y },
                after: { x: dot.coordinate.pos.x, y: dot.coordinate.pos.y },
            }),
        );
        return snapshot;
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
        building._createBefore = before;
        return building;
    }

    static newArea(start, end) {
        let parent = Task.data["buildObject"];
        const isFirst = !hasEnabledAreas(parent);

        let before = Task.snapshot();
        let parentForwards = () => {},
            parentBackwards = () => {},
            parentPrune = () => {};

        if (isFirst) {
            const idx = this.findActionIndex(parent._helperCreate);
            if (idx >= 0) {
                this.prune(idx, 1, false);
                before = parent._createBefore;
                parentForwards = () => parent.enable();
                parentBackwards = () => parent.disable();
                parentPrune = () => {
                    if (parent) {
                        parent.destroy();
                        parent = null;
                    }
                };
            }
        }

        Editor.Referencer.beginReport();
        let area = new Editor.Area(start, end, parent);

        let motionReport = this.snapshotMotion();
        Editor.Referencer.endReport();
        area.enable();
        this.syncTaskUI();
        const after = Task.snapshot();

        const forward = () => {
            Actions.forceMode(EditorModes.CONSTRUCTION);
            area.enable();
            area.building.buildPolygon();

            for (const { dot, after } of motionReport) {
                dot.move(Editor.newCoord(after.x, after.y, "normal"));
            }

            parentForwards();
            Task.restore(after);
        };
        const backward = () => {
            Actions.forceMode(EditorModes.CONSTRUCTION);
            area.disable();
            area.building.buildPolygon();

            for (const { dot, before } of motionReport) {
                dot.move(Editor.newCoord(before.x, before.y, "normal"));
            }

            parentBackwards();
            Task.restore(before);
        };
        const prune = () => {
            if (area) {
                area.destroy();
                area = null;
            }
            parentPrune();
        };

        this.newAction(forward, backward, prune);
    }
    static moveAreaBorder(heldObject) {
        let object = heldObject.object.area;
        let forwardCoord = {
            start: object.start.getIn("normal"),
            end: object.end.getIn("normal"),
        };
        let backwardCoord = heldObject.initialPos;

        let motionReport = this.snapshotMotion();

        Editor.Referencer.endReport();

        const forward = () => {
            Actions.forceMode(EditorModes.CONSTRUCTION);

            let startCoord = Editor.newCoord(
                forwardCoord.start.x,
                forwardCoord.start.y,
                "normal",
            );
            let endCoord = Editor.newCoord(
                forwardCoord.end.x,
                forwardCoord.end.y,
                "normal",
            );
            object.move(startCoord, endCoord);

            for (const { dot, after } of motionReport) {
                dot.move(Editor.newCoord(after.x, after.y, "normal"));
            }

            object.building.buildPolygon();
        };

        const backward = () => {
            Actions.forceMode(EditorModes.CONSTRUCTION);

            let startCoord = Editor.newCoord(
                backwardCoord.start.x,
                backwardCoord.start.y,
                "normal",
            );
            let endCoord = Editor.newCoord(
                backwardCoord.end.x,
                backwardCoord.end.y,
                "normal",
            );
            object.move(startCoord, endCoord);

            for (const { dot, before } of motionReport) {
                dot.move(Editor.newCoord(before.x, before.y, "normal"));
            }

            object.building.buildPolygon();
        };

        this.newAction(forward, backward);
    }

    static destroyArea(area) {
        const building = area.building;
        const onlyOne =
            [...building.areas].filter((a) => a.enabled).length == 1;

        const parentForwards = onlyOne ? () => building.disable() : () => {};
        const parentBackwards = onlyOne ? () => building.enable() : () => {};
        const parentOverflow = onlyOne ? () => building.destroy() : () => {};

        const entrances = [...building.entrances].filter((a) => a.enabled);

        const forward = () => {
            Actions.forceMode(EditorModes.DELETION);
            area.disable();
            area.building.buildPolygon();

            for (const ref of entrances) {
                ref.validatePos();
            }

            parentForwards();
        };

        const backward = () => {
            Actions.forceMode(EditorModes.DELETION);
            area.enable();
            area.building.buildPolygon();

            for (const ref of entrances) {
                ref.validatePos();
            }

            parentBackwards();
        };

        const overflow = () => {
            if (area) {
                area.destroy();
                area = null;
            }
            parentOverflow();
        };

        area.disable();
        parentForwards();

        for (const ref of entrances) {
            ref.validatePos();
        }

        this.newAction(forward, backward, undefined, overflow);

        return area;
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
        if (!pinBtn || !constructionPanel) return;
        const inBuild = Task.task === "build";
        const hasAreas =
            inBuild &&
            Task.taskStep === 1 &&
            hasEnabledAreas(Task.data["buildObject"]);

        this.pinMode(inBuild && Task.taskStep === 0);

        let state = "idle";
        if (inBuild) state = hasAreas ? "done" : Task.taskStep === 0 ? "placing" : "drawing";

        pinDone = hasAreas;
        pinBtn.dataset.state = state;
        pinBtn.disabled = state === "placing" || state === "drawing";   // was hidden before; same clicks blocked

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
                title: 'Termine de editar a construção',
                message: 'A construção ainda não tem nenhuma área. Se continuar, ela será descartada.',
                cancelText: 'Voltar',
                confirmText: 'Descartar Alterações',
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
            if (bannerHeld()) {
                Actions.openModal("share", {shareData: shareData});
            }
        }
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
                    Graficos.highlightObjects(bannerless.map((b) => b.graphics));
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
        Editor.Route.setPoint(target === routeOrigin ? 'origin' : 'destination', point);
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

    if (status === 'granted') Editor.Route.setPoint('origin', selfPoint());
    else reportLocationFailure(status);
}

function nearestNodeId(coordinate, nodes) {
    const p = coordinate.getIn("normal");
    let best = null;
    let bestDist = Infinity;

    for (const [id, pos] of Object.entries(nodes)) {
        const d = (pos.x - p.x) ** 2 + (pos.y - p.y) ** 2;
        if (d < bestDist) {
            bestDist = d;
            best = id; // Object.entries devolve strings, que é o que o A* espera
        }
    }
    return best;
}

function findRoute(fromPlace, toPlace) {
    const edges = [];
    const nodes = {};

    // só entram referências que têm conexão, então o nó mais próximo nunca é um nó isolado
    for (const conn of Object.values(Editor.Connections.connections)) {
        edges.push([conn.start.id, conn.end.id]);
        nodes[conn.start.id] = conn.start.coordinate.getIn("normal");
        nodes[conn.end.id] = conn.end.coordinate.getIn("normal");
    }

    const startId = nearestNodeId(fromPlace.coordinate, nodes);
    const goalId = nearestNodeId(toPlace.coordinate, nodes);
    if (startId === null || goalId === null) return null;

    const ids = getShortestPath(edges, nodes, startId, goalId);
    return ids ? ids.map(id => Editor.Referencer.references[id]) : null;
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

    document.getElementById("route-close").addEventListener('click', () => Editor.Route.stop());
    document.getElementById("route-swap").addEventListener('click', () => Editor.Route.swap());
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
            if (bannerHeld()) Editor.Route.start(Holdable.object);
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

                let url = buildURL(window.location.origin + window.location.pathname, {showpin: 0, lat: geocoords[0], long: geocoords[1]});

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

        document.addEventListener("keydown", (e) => {
            if (Modals.modal.dialog.open) return;
            if (e.target.closest?.("input, textarea, [contenteditable]")) return;
            if (leftClicking || (Holdable.object && Holdable.type !== "banner")) return;

            const isModifierPressed = e.ctrlKey || e.metaKey;

            if (!isModifierPressed) return;

            const key = e.key.toLowerCase();

            if (key === "y" || (e.shiftKey && key === "z")) {
                e.preventDefault();
                Actions.ensureBannerValid().then((ok) => ok && Actions.redo());
            } else if (key === "z" && !e.shiftKey) {
                e.preventDefault();
                Actions.ensureBannerValid().then((ok) => ok && Actions.undo());
            }
        });

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
        pinBtn.addEventListener("click", () => {
            if (!pinDone) Actions.beginTask("build", {});
            else Actions.finishTask();
        });

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
