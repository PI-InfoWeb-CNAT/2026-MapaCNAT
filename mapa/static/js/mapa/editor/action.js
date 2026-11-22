import * as Graficos from '../graficos.js';
import * as Editor from '../objects.js';
import * as Tools from './tools.js';
import * as Toasts from '../../toasts.js';   // one level deeper than interacao.js
import * as Modals from '../../modals.js';

let page;
let mapObj;

// ---------- constants moved from interacao.js ----------
export const AXIS_SNAP_PX = 10;
const CLOSE_RADIUS_PX = 14;

const PIN_STATES = {
    idle:    { title: "Nova construção",     hint: "Clique para começar" },
    placing: { title: "Posicione o pin",     hint: "Clique no mapa onde fica a construção" },
    drawing: { title: "Marque os cantos",    hint: "Clique nos cantos da construção (mínimo 3 pontos)" },
    done:    { title: "Concluir construção", hint: "Fecha a forma e conclui (ou aperte Enter)" },
};

// ---------- shared state ----------
export const selectionState = { vertexSelect: false };   // replaces Keys.vertexSelect

let bannerTabId = Editor.BANNER_TABS[0].id;
export const getBannerTabId = () => bannerTabId;
export const setBannerTabId = (id) => { bannerTabId = id; };

// ---------- DOM elements, registered by interacao.js ----------
let selectionBtn, deleteBtn, buildBtn, referenceBtn, connectionBtn, bannerBtn, pinBtn;
let constructionPanel, bannerTab, userTab, mapContainer;
let imageWrapper, bannerTitle, bannerDescription, bannerPriority;
let defaultImageFile;

export function registerUI(refs) {
    ({
        selectionBtn = selectionBtn, deleteBtn = deleteBtn, buildBtn = buildBtn,
        referenceBtn = referenceBtn, connectionBtn = connectionBtn, bannerBtn = bannerBtn,
        pinBtn = pinBtn, constructionPanel = constructionPanel, bannerTab = bannerTab,
        userTab = userTab, mapContainer = mapContainer, imageWrapper = imageWrapper,
        bannerTitle = bannerTitle, bannerDescription = bannerDescription,
        bannerPriority = bannerPriority, defaultImageFile = defaultImageFile,
    } = refs);
}

// ---------- callbacks, registered by interacao.js ----------
export const hooks = {
    markDirty() {},
    syncBannerStatus() {},
    syncDescriptionLabel() {},
    resetDisplayImage() {},
    setDisplayImage() {},
    showImage() {},
    clearBannerFields() {},
    setBannerAliases() {},
    getBannerAliases: () => [],
    getTab: () => "map",     // returns "map" | "buildings"
    showTab() {},       
};

// ---------- helpers moved from interacao.js ----------
export function isMobileDevice() {
    if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
        return navigator.userAgentData.mobile;
    }
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function lightButton(button, mode, buttonMode) {
    button.classList.remove("mode-active");
    if (mode == buttonMode) button.classList.add("mode-active");
}

async function waitForTransition(element, timeout = 1000) {
    const running = element.getAnimations();
    if (running.length === 0) return;
    await Promise.race([
        Promise.allSettled(running.map((a) => a.finished)),
        new Promise((resolve) => setTimeout(resolve, timeout)),
    ]);
}

export function nearFirstVertex(building, p) {
    const first = building.vertices[0]?.pos;
    return !!first && Math.hypot(p.x - first.x, p.y - first.y) <= CLOSE_RADIUS_PX / Graficos.zoom;
}

export function isDuplicateVertex(building, coordinate, threshold = 4) {
    const p = coordinate.getIn("screen");
    return building.vertices.some(vertex => {
        if (!vertex?.pos) return false;
        const existing = Editor.newCoord(vertex.pos.x, vertex.pos.y, "normal").getIn("screen");
        return Math.hypot(p.x - existing.x, p.y - existing.y) <= threshold;
    });
}

export function snapCoordinate(coordinate, vertices, {
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

export const EditorModes = Object.freeze({
    FREE: "FREE",
    SELECTION: "SELECTION",
    DELETION: "DELETION",
    CONSTRUCTION: "CONSTRUCTION",
    REFERENCE: "REFERENCE",
    CONNECTION: "CONNECTION",
    BANNER: "BANNER",
});

export let editorMode = EditorModes.FREE;

let cursorState = "";

export function setCursor(c) {
    if (c !== cursorState) {
        cursorState = c;
        mapObj.style.cursor = c;
    }
}

const splitPreview = new Editor.PhantomSplit();   // END of the connection
const startPreview = new Editor.PhantomSplit();   // START of the connection

export function showSplitPreview(hit) {
    splitHit = hit;
    if (hit) splitPreview.show(hit.connection, hit.x, hit.y);
    else splitPreview.hide();
}
export function clearSplitPreview() { showSplitPreview(null); }

export function showStartPreview(hit) {
    if (hit) startPreview.show(hit.connection, hit.x, hit.y);
    else startPreview.hide();
}
export function clearAllSplitPreviews() { showSplitPreview(null); showStartPreview(null); }

export function setContext(data) {
    page = data.page;
    mapObj = data.mapObj;
}

export let splitHit = null;      // was: let splitHit = null;   (interacao reads it in Pointer.up)
export function syncHandles() {  // was: function syncHandles() {
    const construct = editorMode === EditorModes.CONSTRUCTION && !Tools.Task.task;
    const select = editorMode === EditorModes.SELECTION && selectionState.vertexSelect;   // was Keys.vertexSelect
    Editor.Buildings.setEditing(construct || select, construct);
}

export function bannerHeld() {
    return Tools.Holdable.type === "banner" && !!Tools.Holdable.object;
}

export function bannerState() {
    if (page !== "editor" || !bannerHeld()) return { state: "empty", missing: [] };

    const currentTab = Editor.BANNER_TABS.find((element) => element.id === bannerTabId);
    if (!currentTab) return { state: "empty", missing: [] };

    const filled = {
        "imagem": !!Tools.Holdable.initialPos?.img,
        "título": !!bannerTitle.value.trim(),
        "descrição": !!bannerDescription.value.trim(),
    };

    const required = currentTab.requires || [];
    const missing = required.filter((field) => !filled[field]);

    let state = "partial";
    if (missing.length === 0) {
        state = "complete";
    } else if (missing.length === required.length) {
        state = "empty";
    }

    return { state, missing };
}

export class Actions {
    static actionStack = [];
    static actionStackReferencial = {};
    static actionStackTraversal = 0;
    static actionStackLimit = 128;

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

        const targetIndex = this.actionStack.length - 1 - this.actionStackTraversal;
        const action = this.actionStack[targetIndex];

        if (action?.tab) hooks.showTab(action.tab);

        if (action && typeof action.backward === "function") {
            action.backward();
        }

        if(Tools.Holdable.phantomObject && Tools.Holdable.type == "phantomVertex" && Tools.Holdable.phantomObject.reference?.coordinate) {
            Tools.Holdable.phantomObject.setEndPoint(Tools.Holdable.phantomObject.reference.coordinate);
        }
        clearAllSplitPreviews();

        this.actionStackTraversal++;
        hooks.markDirty();
    }

    static redo() {
        if (this.actionStackTraversal <= 0) {
            return;
        }

        this.actionStackTraversal--;

        const targetIndex = this.actionStack.length - 1 - this.actionStackTraversal;
        const action = this.actionStack[targetIndex];

        if (action?.tab) hooks.showTab(action.tab);
        if (action && typeof action.forward === "function") {
            action.forward();
        }
        hooks.markDirty();

        if(Tools.Holdable.phantomObject && Tools.Holdable.type == "phantomVertex" && Tools.Holdable.phantomObject.reference?.coordinate) {
            Tools.Holdable.phantomObject.setEndPoint(Tools.Holdable.phantomObject.reference.coordinate);
        }
        clearAllSplitPreviews();
    }

    static newAction(forward, backward, prune = () => {}, overflow = () => {}, sel = null) {
        if (sel) {
            const S = Editor.SelectRegion;
            const f = forward, b = backward;
            forward  = () => { f(); S.restoreSelection(sel.after); };
            backward = () => { b(); S.restoreSelection(sel.before); };
        }

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

        this.actionStack.push({ forward, backward, prune, overflow, tab: hooks.getTab() });

        if (this.actionStack.length > this.actionStackLimit) {
            const droppedAction = this.actionStack.shift();
            if (droppedAction && typeof droppedAction.overflow === "function") {
                droppedAction.overflow();
            }
        }
        hooks.markDirty();
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

        const hit = Editor.Connections.findSplitTarget(reference);
        if (hit) {
            reference.move(Editor.newCoord(hit.x, hit.y, "normal"));   // cai exatamente na linha
            const split = this._splitConnection(hit.connection, reference);
            split.apply();

            this.newAction(
                () => { Actions.forceMode(EditorModes.REFERENCE); reference.enable(); split.apply(); },
                () => { Actions.forceMode(EditorModes.REFERENCE); split.unapply(); reference.disable(); },
                // prune: destruir a referência já destrói c1 e c2 (estão em reference.connections)
                () => { if (reference) { reference.destroy(); reference = null; } },
                // overflow: a conexão original ficou desativada para sempre
                () => hit.connection.destroy(),
            );
            return;
        }

        const forward = () => { Actions.forceMode(EditorModes.REFERENCE); reference.enable(); };
        const backward = () => { Actions.forceMode(EditorModes.REFERENCE); reference.disable(); };
        const prune = () => { if (reference) { reference.destroy(); reference = null; } };

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

        const p0 = heldObject.initialPos;
        const movedAway = object.coordinate.pos.x !== p0.x || object.coordinate.pos.y !== p0.y;
        const target = movedAway ? Editor.Referencer.findMergeTarget(object) : null;   // clique sem arrastar não funde
        if (target) {
            this.mergeReference(object, target, backwardCoord);
            return;
        }

        const split = movedAway ? Editor.Connections.findSplitTarget(object) : null;
        if (split) {
            object.move(Editor.newCoord(split.x, split.y, "normal"));
            forwardCoord = { x: split.x, y: split.y };
            const s = this._splitConnection(split.connection, object);
            s.apply();
            this.newAction(
                () => {
                    Actions.forceMode(EditorModes.REFERENCE);
                    object.move(Editor.newCoord(forwardCoord.x, forwardCoord.y, "normal"));
                    s.apply();
                },
                () => {
                    Actions.forceMode(EditorModes.REFERENCE);
                    s.unapply();
                    object.move(Editor.newCoord(backwardCoord.x, backwardCoord.y, "normal"));
                },
                () => { s.c1.destroy(); s.c2.destroy(); },
                () => split.connection.destroy(),
            );
            return;
        }

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

    static newConnectionSplit(from, hit) {
        const conn = hit.connection;
        let mid = new Editor.Reference(Editor.newCoord(hit.x, hit.y, "normal"));
        mid.enable();

        const split = this._splitConnection(conn, mid);
        split.apply();
        const link = new Editor.Connection(from, mid);

        this.newAction(
            () => {
                Actions.forceMode(EditorModes.CONNECTION);
                mid.enable();
                split.apply();
                link.enable();
            },
            () => {
                Actions.forceMode(EditorModes.CONNECTION);
                link.disable();
                split.unapply();
                mid.disable();
            },
            () => { if (mid) { mid.destroy(); mid = null; } },   // prune: destrói c1, c2 e link junto
            () => conn.destroy(),                                  // overflow: a original ficou desativada
        );
    }

    static mergeReference(ref, target, from) {
        const old = ref.connections.filter((c) => c.enabled);
        const added = [];

        for (const c of old) {
            const other = c.start === ref ? c.end : c.start;
            if (other === target || other === ref) continue;                 // viraria laço
            if (Editor.Connections.hasPair(target, other)) continue;         // já existe
            added.push(new Editor.Connection(target, other));
        }

        const apply = () => {
            ref.disable();
            for (const c of old) c.disable();
            for (const c of added) c.enable();
        };
        const unapply = () => {
            ref.enable();
            for (const c of old) c.enable();                  // antes do move: ele reindexa as conexões
            for (const c of added) c.disable();
            ref.move(Editor.newCoord(from.x, from.y, "normal"));
        };

        apply();
        this.newAction(
            () => { Actions.forceMode(EditorModes.REFERENCE); apply(); },
            () => { Actions.forceMode(EditorModes.REFERENCE); unapply(); },
            () => added.forEach((c) => c.destroy()),          // prune: ação desfeita e descartada
            () => ref.destroy(),                              // overflow: ação feita e esquecida
        );
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

    static newConnectionFromSplit(startHit, end) {
        const startConn = startHit.connection;

        let startRef = new Editor.Reference(
            Editor.newCoord(startHit.x, startHit.y, "normal"),
        );

        let endRef = null;
        let endSplit = null;
        let endLink = null;

        const startSplit = this._splitConnection(startConn, startRef);

        if (end.connection) {
            endRef = new Editor.Reference(
                Editor.newCoord(end.x, end.y, "normal"),
            );

            endSplit = this._splitConnection(end.connection, endRef);
            endLink = new Editor.Connection(startRef, endRef);
        } else {
            endLink = new Editor.Connection(startRef, end);
        }

        const apply = () => {
            startRef.enable();
            startSplit.apply();

            if (endSplit) {
                endRef.enable();
                endSplit.apply();
            }

            endLink.enable();
        };

        const unapply = () => {
            endLink.disable();

            if (endSplit) {
                endSplit.unapply();
                endRef.disable();
            }

            startSplit.unapply();
            startRef.disable();
        };

        apply();

        this.newAction(
            () => {
                Actions.forceMode(EditorModes.CONNECTION);
                apply();
            },
            () => {
                Actions.forceMode(EditorModes.CONNECTION);
                unapply();
            },
            () => {
                startRef?.destroy();
                endRef?.destroy();
                startSplit.c1.destroy();
                startSplit.c2.destroy();

                if (endSplit) {
                    endSplit.c1.destroy();
                    endSplit.c2.destroy();
                }

                endLink?.destroy();
            },
            () => {
                startConn.destroy();

                if (endSplit) {
                    endSplit.connection.destroy();
                }
            },
        );
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

    static _splitConnection(conn, ref) {
        const c1 = new Editor.Connection(conn.start, ref);
        const c2 = new Editor.Connection(ref, conn.end);
        return {
            c1, c2,
            apply()   { conn.disable(); c1.enable(); c2.enable(); },
            unapply() { c1.disable(); c2.disable(); conn.enable(); },
        };
    }

    static syncHighlight() {
        if (editorMode == EditorModes.BANNER) {
            Graficos.highlight([Graficos.groups.PINS, Graficos.groups.REFERENCES]);
        } else {
            Graficos.highlight(true);
        }
    }

    static applyMode(mode) {
        clearAllSplitPreviews()
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
        if (mode != editorMode) Tools.Task.reset();
        this.applyMode(mode);
    }

    static resetTask() {
        Editor.SnapGuides.clearAll();
        if (Tools.Holdable.type === "phantomVertex") {
            Tools.Holdable.set(false);
        }
        if (Tools.Task.task == "build" && Tools.Task.taskStep == 1) {
            const building = Tools.Task.data["buildObject"];
            if (building && !building.closed) {
                // descarta a criação e todos os pontos já colocados (ficam no topo da pilha)
                const idx = this.findActionIndex(building._helperCreate);
                if (idx >= 0) this.prune(idx, this.actionStack.length - idx);
            }
        }
        Tools.Task.reset();
    }

    static async switchMode(mode = EditorModes.FREE) {
        if (this.switching) return;
    
        this.switching = true;
        const bannerOk = await this.ensureBannerValid();
        this.switching = false;
        if (!bannerOk) return;

        if (editorMode == EditorModes.CONSTRUCTION) {
            const building = Tools.Task.task == "build" && Tools.Task.taskStep == 1 ? Tools.Task.data["buildObject"] : null;

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
        const snap = Tools.Task.snapshot();

        building.addVertex(Editor.newCoord(pos.x, pos.y, "normal"));
        this.syncTaskUI();

        this.newAction(
            () => {
                Actions.forceMode(EditorModes.CONSTRUCTION);
                building.addVertex(Editor.newCoord(pos.x, pos.y, "normal"));
                Tools.Task.restore(snap);
                building.updateGraphics();
            },
            () => {
                Actions.forceMode(EditorModes.CONSTRUCTION);
                building.removeLastVertex();
                Tools.Task.restore(snap);
                building.updateGraphics();
            },
        );
    }

    
    static placeVertex(x, y, shift = false) {
        const building = Tools.Task.data["buildObject"];

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

        if (Tools.Holdable.type === "phantomVertex") Tools.Holdable.set(false);

        const snap = Tools.Task.snapshot();
        building.close();
        const snapped = Editor.Buildings.snapReferencesTo(building);   // referências coladas na parede nova
        this.syncTaskUI();

        this.newAction(
            () => {
                Actions.forceMode(EditorModes.CONSTRUCTION);
                building.close();
                for (const { dot, after } of snapped) dot.move(Editor.newCoord(after.x, after.y, "normal"));
                Tools.Task.restore(snap);
            },
            () => {
                Actions.forceMode(EditorModes.CONSTRUCTION);
                building.reopen();   // antes de mover: assim as referências deixam de ser entrada
                for (const { dot, before } of snapped) dot.move(Editor.newCoord(before.x, before.y, "normal"));
                Tools.Task.restore(snap);
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
        const building = Tools.Task.data["buildObject"];
        if (!building) return;

        if (!building.closed && !this.closePolygon(building)) return;

        if (Tools.Holdable.type === "phantomVertex") Tools.Holdable.set(false);
        Tools.Task.reset();
    }

    static pinAction() {
        const state = pinBtn.dataset.state;
        if (state === "idle") this.beginTask("build", {});
        else if (state === "drawing") this.warnOpenPolygon(Tools.Task.data["buildObject"]);
        else if (state === "done") this.finishTask();
    }

    static finishTask() {
        const building = Tools.Task.data["buildObject"];
        if (!building) return;

        this.closePolygon(building);
        
        if (!building.closed) {
            return;
        }

        if (Tools.Holdable.type === "phantomVertex") {
            Tools.Holdable.set(false);
        }
        Tools.Task.reset();
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
        const { index, pos: from, entrances, inserted } = held.initialPos;
        const cur = building.vertices[index].pos;
        const to = { x: cur.x, y: cur.y };
        if (!inserted && to.x === from.x && to.y === from.y) return;

        const current = building.vertices.map(v => ({ x: v.pos.x, y: v.pos.y }));
        const dup = building.vertices.length > 3 &&
            building.vertices.some((v, k) => k !== index && v.pos.x === to.x && v.pos.y === to.y);

        const beforePts = inserted
            ? current.filter((_, k) => k !== index)
            : current.map((p, k) => k === index ? { x: from.x, y: from.y } : p);

        // vértice recém-criado solto sobre outro da mesma construção: não sobra nada a registrar
        if (inserted && dup) {
            building.setPolygon(beforePts);
            Editor.Buildings.reattachEntrances(building);
            return;
        }

        const afterPts = dup ? current.filter((_, k) => k !== index) : current;
        const rebuild = dup || inserted;

        if (dup) {
            building.setPolygon(afterPts);
            Editor.Buildings.reattachEntrances(building);
        }

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

        const apply = (pos, key, pts) => {
            Actions.forceMode(EditorModes.CONSTRUCTION);
            if (rebuild) building.setPolygon(pts);                 // parede primeiro
            else building.moveVertex(index, Editor.newCoord(pos.x, pos.y, "normal"));
            for (const m of moved) m.dot.move(Editor.newCoord(m[key].x, m[key].y, "normal"));
        };

        this.newAction(
            () => apply(to, "after", afterPts),
            () => apply(from, "before", beforePts),
        );
    }

    static removeVertex(building, index) {
        if (!building.closed || !building.vertices[index]) return false;
        if (building.vertices.length <= 3) {
            Toasts.toaster.show({ text: "Uma construção precisa de pelo menos 3 pontos.", category: "warn" });
            return false;
        }

        const pos = { x: building.vertices[index].pos.x, y: building.vertices[index].pos.y };
        const entrances = [...building.entrances]
            .filter(r => r.enabled)
            .map(r => ({ dot: r, pos: { ...r.coordinate.pos } }));

        Editor.Buildings.setHoverVertex(null);
        building.removeVertex(index);
        Editor.Buildings.reattachEntrances(building);   // entradas escorregam para a parede nova

        // o que as entradas / referências colidas na parede nova andaram (para o desfazer)
        const changes = new Map();
        for (const { dot, pos: p } of entrances) {
            const now = dot.coordinate.pos;
            if (now.x !== p.x || now.y !== p.y) {
                changes.set(dot, { before: p, after: { x: now.x, y: now.y } });
            }
        }
        for (const { dot, before, after } of Editor.Buildings.snapReferencesTo(building)) {
            const prev = changes.get(dot);
            changes.set(dot, { before: prev ? prev.before : before, after });
        }
        const moved = [...changes].map(([dot, c]) => ({ dot, ...c }));

        this.newAction(
            () => {
                Actions.forceMode(EditorModes.CONSTRUCTION);
                building.removeVertex(index);                          // parede primeiro
                for (const m of moved) m.dot.move(Editor.newCoord(m.after.x, m.after.y, "normal"));
            },
            () => {
                Actions.forceMode(EditorModes.CONSTRUCTION);
                building.insertVertex(index, Editor.newCoord(pos.x, pos.y, "normal"));
                for (const m of moved) m.dot.move(Editor.newCoord(m.before.x, m.before.y, "normal"));
            },
        );
        return true;
    }

    static moveBuildingPin(held) {
        const building = held.object;
        const from = held.initialPos.pos;
        const cur = building.coordinate.pos;
        const to = { x: cur.x, y: cur.y };
        if (to.x === from.x && to.y === from.y) return;

        const apply = (pos) => {
            Actions.forceMode(EditorModes.CONSTRUCTION);
            building.move(Editor.newCoord(pos.x, pos.y, "normal"));
        };
        this.newAction(() => apply(to), () => apply(from));
    }

    static renameBuilding(building, name) {
        const old = building.name;
        if (name === old) return;

        building.rename(name);

        this.newAction(
            () => { Actions.forceMode(EditorModes.CONSTRUCTION); building.rename(name); },
            () => { Actions.forceMode(EditorModes.CONSTRUCTION); building.rename(old); },
        );
    }

    // gesto cancelado pelo navegador: volta tudo ao que era antes do arrasto
    static revertDrag() {
        const building = Tools.Holdable.object;
        const init = Tools.Holdable.initialPos;

        if (Tools.Holdable.type === "buildingVertex") {
            if (init.inserted) {
                building.setPolygon(building.vertices
                    .filter((_, k) => k !== init.index)
                    .map(v => ({ x: v.pos.x, y: v.pos.y })));
            } else {
                building.moveVertex(init.index, Editor.newCoord(init.pos.x, init.pos.y, "normal"));
            }
            for (const { dot, pos } of init.entrances) {
                dot.move(Editor.newCoord(pos.x, pos.y, "normal"));
            }
        } else if (Tools.Holdable.type === "buildingPin") {
            building.move(Editor.newCoord(init.pos.x, init.pos.y, "normal"));
        }
        Tools.Holdable.set(false);
    }

    static resizeSelection(before, after) {
        const inFloor = Editor.SelectRegion.scope === "floor";
        const apply = (layout) => {
            if (!inFloor) Actions.forceMode(EditorModes.SELECTION);
            Editor.SelectRegion.applyLayout(layout);
        };
        const sel = Editor.SelectRegion.snapshot();
        this.newAction(() => apply(after), () => apply(before), undefined, undefined, { before: sel, after: sel });
    }

    

    static newBuilding(mouseX, mouseY) {
        const coord = Editor.newCoord(mouseX, mouseY, "screen");
        let building = new Editor.Building(coord, Tools.Task.data["name"]);

        const before = Tools.Task.snapshot();
        building.enable();
        Tools.Task.data["buildObject"] = building;
        Tools.Task.nextStep();
        const after = Tools.Task.snapshot();

        const forward = () => {
            Actions.forceMode(EditorModes.CONSTRUCTION);
            building.enable();
            Tools.Task.restore(after);
        };
        const backward = () => {
            Actions.forceMode(EditorModes.CONSTRUCTION);
            building.disable();
            Tools.Task.restore(before);
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

    static recordSelection(before) {
        if (!before) return;
        if (Editor.SelectRegion.scope === "floor") return; 
        const S = Editor.SelectRegion;
        const after = S.snapshot();
        if (S.sameSelection(before, after)) return;

        // forceMode → applyMode zera a seleção, então restauramos depois dele
        const apply = (snap) => {
            Actions.forceMode(EditorModes.SELECTION);
            S.restoreSelection(snap);
        };
        this.newAction(() => apply(after), () => apply(before));
    }

    static pinMode(bool) {
        mapObj.classList.toggle("custom-cursor", bool);
    }

    static beginTask(name, data) {
        if (name == "build") {
            Tools.Task.setTask(name, data);
        }
    }

    static syncTaskUI() {
        syncHandles();
        if (!pinBtn || !constructionPanel) return;
        const inBuild = Tools.Task.task === "build";
        const building = inBuild && Tools.Task.taskStep === 1 ? Tools.Task.data["buildObject"] : null;

        this.pinMode(inBuild && Tools.Task.taskStep === 0);

        let state = "idle";
        if (inBuild) {
            if (Tools.Task.taskStep === 0) state = "placing";
            else state = building && (building.closed || building.vertices.length >= 3) ? "done" : "drawing";
        }

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
        if (Tools.Holdable.type === "banner" && Tools.Holdable.object === obj &&
            !bannerTab.classList.contains("hidden")) return;

        if (!bannerTab.classList.contains("hidden")) {
            if (!(await this.ensureBannerValid())) return;   // incomplete banner: ask first

            const closing = this.closeBanner();
            const token = this.bannerToken;
            await closing;
            if (token !== this.bannerToken) return;
        }

        this.bannerToken++;

        let bannerIdx = Editor.BANNER_TABS.indexOf(obj?.banner?.mode) !== -1 ? Editor.BANNER_TABS.indexOf(obj.banner.mode) : (obj instanceof Editor.Reference ? 0 : 1);
        bannerTabId = obj?.banner?.mode ? obj?.banner?.mode : Editor.BANNER_TABS[bannerIdx].id;
        this.saveBanner();
        hooks.resetDisplayImage();
        Tools.Holdable.set(obj, "banner", { img: obj.banner.image || false });
        this.restoreBanner(obj);
        hooks.syncBannerStatus();
        
        let bannerTabIdx = Editor.BANNER_TABS.map((element) => element.id).indexOf(bannerTabId);
        imageWrapper.classList.toggle("hidden", Editor.BANNER_TABS[bannerTabIdx].uses.indexOf("imagem") === -1);
        bannerTitle.classList.toggle("hidden", Editor.BANNER_TABS[bannerTabIdx].uses.indexOf("título") === -1);
        bannerDescription.classList.toggle("hidden", Editor.BANNER_TABS[bannerTabIdx].uses.indexOf("descrição") === -1);
        document.querySelector('.banner-section-title').classList.toggle("hidden", Editor.BANNER_TABS[bannerTabIdx].uses.indexOf("descrição") === -1);
        bannerTab.classList.remove("hidden");
    }

    static async closeBanner() {
        const wasHidden = bannerTab.classList.contains("hidden");
        const token = ++this.bannerToken;

        bannerTab.classList.add("hidden");
        this.saveBanner();
        if (Tools.Holdable.type === "banner") Tools.Holdable.set(false);

        if (!wasHidden) await waitForTransition(bannerTab); // só espera se havia o que animar
        if (token !== this.bannerToken) return;             // foi reaberto/fechado de novo
        hooks.showImage(null);
    }

    static saveBanner() {
        if (page != "editor") return;
        if (!bannerHeld()) return;

        const banner = Tools.Holdable.object.banner;
        if (!banner) return;

        const image = Tools.Holdable.initialPos?.img || false;
        const title = bannerTitle.value.trim();
        const description = bannerDescription.value.trim();
        const priority = bannerPriority.value.trim();
        const titleAlias = [...hooks.getBannerAliases()];

        let state = bannerState();

        banner.detailed = !!(image || title || description);
        banner.image = image;
        banner.title = title;
        banner.description = description;
        banner.titleAlias = titleAlias;
        banner.mode = state.state == "empty" ? "" : bannerTabId;
        banner.priority = priority;
        Tools.Holdable.object.updateGraphics?.();
    }

    static restoreBanner(obj) {
        const b = obj.banner;

        if (b.image) {
            hooks.setDisplayImage(b.image);
        } else if (page == "main" && defaultImageFile) {
            hooks.showImage(defaultImageFile);
        } else if (page == "main") {
            hooks.showImage(defaultImage);
        }

        bannerTitle.value = b.title || "";
        if(page == "main" && !bannerTitle.value && obj.name) {
            bannerTitle.value = obj.name;
        }
        bannerDescription.value = b.description || "";
        if(bannerPriority) {
            bannerPriority.value = b.priority || 1;
        }

        hooks.setBannerAliases(b.titleAlias || []);

        if (page == "main") hooks.syncDescriptionLabel();
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
        hooks.clearBannerFields();
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
                        Tools.Task.data["name"] = name;
                        Actions.newBuilding(data.x, data.y);
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

        const selBefore = S.snapshot();                                   // NOVO

        const gone = new Set(refs);
        const connections = [...new Set(refs.flatMap((r) => r.connections.filter((c) => c.enabled)))];
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
            for (const r of refs) r.enable();
            for (const c of connections) c.enable();
            for (const r of revalidate) r.validatePos();
        };

        remove();
        S.refresh();
        const selAfter = S.snapshot();                                    // NOVO (vazia)

        this.newAction(
            () => { Actions.forceMode(EditorModes.DELETION); remove(); },
            () => { Actions.forceMode(EditorModes.DELETION); restore(); },
            undefined,
            () => { refs.forEach((r) => r.destroy()); builds.forEach((b) => b.destroy()); },
            { before: selBefore, after: selAfter },                       // NOVO
        );

        return true;
    }
}