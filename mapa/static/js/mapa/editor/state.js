/* ============================================================================
 *  state.js — estado compartilhado do main + utilidades usadas por mais de um módulo
 *
 *  Regra do ES module: só o módulo dono pode REATRIBUIR um `let` exportado.
 *  Como as variáveis soltas do antigo main.js eram lidas e escritas por vários
 *  arquivos agora, elas moram no objeto `M` (M.leftClicking, M.page, ...).
 *
 *  Também ficam aqui: EditorModes, Holdable, Task, previews de split, setCursor,
 *  snapCoordinate, goToPlace e as funções de URL.
 * ========================================================================== */
import * as Graficos from "../graficos.js";
import * as Editor from "../objects.js";
import { Actions } from "./action.js";

export const ROTATION_SNAP = Math.PI / 8;
export const CLOSE_RADIUS_PX = 14;
export const AXIS_SNAP_PX = 10;

export const PIN_STATES = {
    idle:    { title: "Nova construção",     hint: "Clique para começar" },
    placing: { title: "Posicione o pin",     hint: "Clique no mapa onde fica a construção" },
    drawing: { title: "Marque os cantos",    hint: "Clique nos cantos da construção (mínimo 3 pontos)" },
    done:    { title: "Concluir construção", hint: "Fecha a forma e conclui (ou aperte Enter)" },
};

export const EditorModes = Object.freeze({
    FREE: "FREE",
    SELECTION: "SELECTION",
    DELETION: "DELETION",
    CONSTRUCTION: "CONSTRUCTION",
    REFERENCE: "REFERENCE",
    CONNECTION: "CONNECTION",
    BANNER: "BANNER",
});

export const M = {
    // ---- contexto ----
    page: undefined,
    zoom: 1,
    zoomStep: undefined,
    editorMode: EditorModes.FREE,

    // ---- elementos do DOM (preenchidos no addListeners) ----
    mapObj: null,
    mapContainer: null,
    buildBtn: null,
    referenceBtn: null,
    connectionBtn: null,
    saveBtn: null,
    bannerBtn: null,
    pinBtn: null,
    selectionBtn: null,
    deleteBtn: null,
    constructionPanel: null,
    bannerStatus: null,
    userTab: null,
    shareLocation: null,

    bannerTab: null,
    bannerTabsEl: null,
    imageInput: null,
    imageWrapper: null,
    imageLabel: null,
    bannerTitle: null,
    bannerDescription: null,
    bannerPriority: null,
    bannerAliasInput: null,
    bannerAliasList: null,
    bannerAliasField: null,

    // ---- banner ----
    bannerTabId: undefined,
    bannerAliases: [],
    defaultImageFile: undefined,

    // ---- gestos (lidos por pointer, actions e listeners) ----
    leftClicking: false,
    rightClicking: false,
    panGesture: false,        // pan iniciado com X (o arrasto continua mesmo se soltar o X)
    dragStarted: false,
    clickX: 0,
    clickY: 0,

    // ---- teclado ----
    quickPan: false,
    vertexSelect: false,

    // ---- hover ----
    hoverSet: new Set(),
    hoverTargetSet: new Set(),

    // ---- split preview ----
    splitHit: null,           // hit do fantasma do FIM da conexão
};

/* ---------------------------------- Cursor ---------------------------------- */
let cursorState = "";

export function setCursor(c) {
    if (c !== cursorState) {
        cursorState = c;
        M.mapObj.style.cursor = c;
    }
}

/* ------------------------------ Holdable / Task ------------------------------ */
export class Holdable {
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

export class Task {
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

/* ------------------------------ Previews de split ------------------------------ */
const splitPreview = new Editor.PhantomSplit();   // FIM da conexão
const startPreview = new Editor.PhantomSplit();   // INÍCIO da conexão

export function showSplitPreview(hit) {
    M.splitHit = hit;
    if (hit) splitPreview.show(hit.connection, hit.x, hit.y);
    else splitPreview.hide();
}
export function clearSplitPreview() { showSplitPreview(null); }

export function showStartPreview(hit) {
    if (hit) startPreview.show(hit.connection, hit.x, hit.y);
    else startPreview.hide();
}
export function clearAllSplitPreviews() { showSplitPreview(null); showStartPreview(null); }

/* ----------------------------- Geometria de desenho ----------------------------- */
export function nearFirstVertex(building, p) {
    const first = building.vertices[0]?.pos;
    return !!first && Math.hypot(p.x - first.x, p.y - first.y) <= CLOSE_RADIUS_PX / Graficos.zoom;
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

/* ---------------------------------- Câmera / URL ---------------------------------- */
export function goToPlace(place, zoomVal) {
    Graficos.animateTransform({ point: place.coordinate.getIn("normal"), zoom: zoomVal });
    M.zoom = zoomVal;
}

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