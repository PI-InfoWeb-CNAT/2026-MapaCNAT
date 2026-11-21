import * as Graficos from "./graficos.js";
import * as Editor from "./objects.js";
import * as Toasts from '../toasts.js';
import * as Modals from '../modals.js';
import * as Localizacao from './localizacao.js';
import * as Tour from './editor/tour.js';
import * as Versions from './editor/versions.js';
import * as Tools from './editor/tools.js';
import * as Banner from './editor/banner.js';
import * as Persistence from './persistence.js';
import * as Search from './main/search.js';
import * as PointerInput from './pointer.js';
import {
    EditorModes, editorMode, bannerHeld, bannerState, Actions,
    clearAllSplitPreviews, setCursor, syncHandles,
    registerUI, selectionState,
} from './editor/action.js';
import { gesture, gestureActive, cancelPointer, goToPlace, buildURL } from './pointer.js';

let page;
let activeTab = "map";

const ROTATION_SNAP = Math.PI / 8;

export function setContext(context) {
    page = context.page;
    PointerInput.setContext(context);
    Banner.setContext(context);
    Persistence.setContext(context);
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

async function switchTab(name) {
    if (name === activeTab) return;
    if (!(await Actions.ensureBannerValid())) return;

    await Actions.switchMode(EditorModes.FREE);
    if (editorMode !== EditorModes.FREE) return;

    activeTab = name;
    for (const tab of document.querySelectorAll("[data-tab]")) {
        tab.setAttribute("aria-selected", String(tab.dataset.tab === name));
    }
    for (const view of document.querySelectorAll("[data-view]")) {
        view.classList.toggle("hidden", view.dataset.view !== name);
    }
}

// =====================================================================
// Keyboard
// =====================================================================

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
    ["Clique / Shift+Clique", "Seleção: seleciona o objeto / soma ao grupo (Shift em vértice soma o vértice)"],
    ["Delete / Backspace", "Apaga a seleção ou o que está na mão; sem nada, segurar = modo Excluir"],
    ["Esc", "Cancela o gesto, fecha o banner, sai do modo"],
    ["Enter", "Concluir construção"],
    ["Ctrl+Z / Ctrl+Y", "Desfazer / refazer"],
    ["Ctrl+S", "Salvar"],
    ["Ctrl+A", "Selecionar tudo"],
    ["T", "Seleção: tocar ↔ conter"],
    ["Clique", "Seleção: seleciona só aquele objeto"],
    ["Shift + clique / arrasto", "Seleção: soma ao grupo atual em vez de substituir"],
    ["V", "Seleção: alternar construções ↔ vértices"],
    ["Botão direito (vértice)", "Construção: remove o vértice (mínimo de 3 pontos)"],
    ["Shift (redimensionar)", "Seleção: redimensiona rígido; ao girar, trava em 15°"],
    ["F", "Enquadrar seleção (ou o mapa todo)"],
    ["Setas", "Mover a câmera (Shift = mais rápido)"],
    ["+ / −", "Zoom"],
    ["Q / E", "Girar a câmera"],
    ["0", "Norte para cima"],
    ["? / H", "Esta ajuda"],
];

// troca de modo síncrona só é segura sem tarefa em andamento, sem gesto e sem banner incompleto
function canSwitchSync() {
    return !Tools.Task.task && !gestureActive() &&
        !Actions.switching && !Actions.confirmingBanner &&
        bannerState().state !== "partial" &&
        (!Tools.Holdable.object || Tools.Holdable.type === "banner");
}

function showShortcuts() {
    const rows = SHORTCUTS.map(([k, d]) => `<tr><td><kbd class='modal-ticket'>${k}</kbd></td><td>${d}</td></tr>`).join("");
    Modals.modal.open({
        title: "Atalhos do editor",
        size: "lg",
        html: `<table class="shortcut-table">${rows}</table>`,
    });
}

function addShortcutHints(hints) {
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

    static holds = [];            // pilha de teclas de modo seguradas: { id, mode, prev, t, momentary, same }
    static pendingRestore = null; // modo a restaurar quando o ponteiro for solto

    static shiftDown = false;

    // estado compartilhado com pointer.js / action.js
    static get quickPan() { return gesture.quickPan; }
    static set quickPan(v) { gesture.quickPan = v; }
    static get vertexSelect() { return selectionState.vertexSelect; }
    static set vertexSelect(v) { selectionState.vertexSelect = v; }

    // ---------- entrada ----------

    static onKeyDown(e) {
        if (Modals.modal.dialog.open) return;
        if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;

        const key = e.key.toLowerCase();

        if (Versions.state.viewing !== null &&
            (key in MODE_KEYS || key === "delete" || key === "backspace")) return;

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
        if (Versions.state.viewing !== null && key !== "s") return;

        if (key === "s") {
            e.preventDefault();
            if (!e.repeat && !gestureActive()) Persistence.save();
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
                    Tools.Task.task === "build" && Tools.Task.taskStep === 1 && !gestureActive()) {
                    Actions.pinAction();
                    return true;
                }
                return false;
            case "f": if (first) this.frame(); return true;
            case "t": if (first) this.toggleTouch(); return true;
            case "q": if (first) this.rotateCamera(-1); return true;
            case "e": if (first) this.rotateCamera(1); return true;
            case "0": if (first) Graficos.smoothRotation(0); return true;
            case "v": if (first) this.toggleVertexSelect(); return true;
            case "?": case "h": if (first) showShortcuts(); return true;
        }

        if (key in MODE_KEYS) {
            if (first) this.pressMode(key, MODE_KEYS[key]);
            return true;
        }
        return false;
    }

    // ---------- modos (toque alterna, segurar é temporário) ----------

    static toggleVertexSelect() {
        this.vertexSelect = !this.vertexSelect;
        syncHandles();

        const S = Editor.SelectRegion;
        if (S.startCoord && S.currCoord) {          // no meio de um arrasto: reaplica
            S.updateSelection(this.vertexSelect);
            S.updateGraphics();
        }
        Toasts.toaster.show({
            text: this.vertexSelect ? "Seleção: vértices" : "Seleção: construções",
            category: "success",
        });
    }

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
        if (!gesture.pan) setCursor(on ? "grab" : "");
    }

    // ---------- Delete / Esc ----------

    static remove(first) {
        // desenhando uma construção: volta um ponto (igual ao Ctrl+Z)
        if (Tools.Task.task === "build") {
            if (first && Tools.Task.taskStep === 1 && !gestureActive()) Actions.undo();
            return true;
        }
        if (!first) return true;

        // segurando algo: apaga o que está na mão (voltando antes à posição original,
        // para o desfazer restaurar no lugar certo)
        const held = Tools.Holdable.object;
        if (held && Tools.Holdable.type === "reference") {
            const p = Tools.Holdable.initialPos;
            held.move(Editor.newCoord(p.x, p.y, "normal"));
            Tools.Holdable.set(false);
            Actions.destroyReference(held);
            return true;
        }
        if (held && Tools.Holdable.type === "buildingPin") {
            const p = Tools.Holdable.initialPos.pos;
            held.move(Editor.newCoord(p.x, p.y, "normal"));
            Tools.Holdable.set(false);
            gesture.clearDrag();
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
        if (Versions.isOpen()) { Versions.close(); return; }

        if (this.cancelGesture()) return;
        if (bannerHeld()) { Actions.requestCloseBanner(); return; }
        if (Tools.Task.task) { Actions.switchMode(EditorModes.FREE); return; }   // confirma se houver pontos
        if (Editor.SelectRegion.box) {
            const before = Editor.SelectRegion.snapshot();
            Editor.SelectRegion.refresh();
            Actions.recordSelection(before);
            return;
        }
        if (editorMode !== EditorModes.FREE) Actions.switchMode(EditorModes.FREE);
    }

    static cancelGesture() {
        if (!gestureActive()) return false;

        if (Tools.Holdable.type === "reference" && Tools.Holdable.object) {
            const p = Tools.Holdable.initialPos;
            Tools.Holdable.object.move(Editor.newCoord(p.x, p.y, "normal"));
            Tools.Holdable.set(false);
        } else if (Tools.Holdable.type === "connectionReference" || Tools.Holdable.type === "connectionSplitReference") {
            Tools.Holdable.set(false);
            clearAllSplitPreviews();
        }
        gesture.pan = false;
        cancelPointer();   // solta botões, reverte arrasto de construção, limpa seleção e guias
        return true;
    }

    // ---------- seleção ----------

    static onShift(e) {
        this.shiftDown = e.shiftKey;
        const S = Editor.SelectRegion;
        if (S.resizing) S.reapplyResize(e.shiftKey);   // alterna estica ↔ rígido sem mexer o mouse
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
        if (gestureActive() || Tools.Task.task) return;
        const S = Editor.SelectRegion;
        const before = S.snapshot();
        if (editorMode !== EditorModes.SELECTION) {
            if (!canSwitchSync()) return;
            Actions.applyMode(EditorModes.SELECTION);
        }
        S.selectAll();
        Actions.recordSelection(before);
    }

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

    static frame() {
        if (Graficos.smoothTransform) return;

        const S = Editor.SelectRegion;
        const b = S.box;
        let point = { x: 0, y: 0 };
        let target = Graficos.minZoom;

        if (b) {
            const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
            const c = Math.cos(S._rot), s = Math.sin(S._rot);
            point = { x: c * cx + s * cy, y: -s * cx + c * cy };

            const vp = Graficos.getViewport();
            const w = Math.max(b.maxX - b.minX, 1), h = Math.max(b.maxY - b.minY, 1);
            target = Math.min(vp.width / w, vp.height / h) * 0.7;
        }

        target = Math.min(Math.max(target, Graficos.minZoom), Graficos.maxZoom);
        Graficos.animateTransform({ point, zoom: target });
    }
}

export async function addListeners(map) {
    PointerInput.attach(map);

    const mapContainer = document.getElementById("map-container");

    if (sharePlaceLat && sharePlaceLong) {
        let normalPoint = Localizacao.GeographicalToMap({ x: sharePlaceLat, y: sharePlaceLong });
        let coord = Editor.newCoord(normalPoint[0], normalPoint[1], "normal");
        if (!(shareRender == "0")) {
            Editor.TouchPin.setPos(coord);
            Editor.TouchPin.setVisible(true);
        }
        goToPlace({ coordinate: coord }, 2);
    }

    if (page == "main") {
        const orientationBtn = document.getElementById("orientation");
        const optionsBtn = document.getElementById("options");
        const closeBtn = document.getElementById("close-sidebar");
        const sidebar = document.getElementById("sidebar");
        const backdrop = document.getElementById("sidebar-backdrop");

        Banner.init();
        Search.init();

        const response = await fetch(defaultImage);
        const blob = await response.blob();
        const defaultImageFile = new File([blob], "ifrn-logo.png", {
            type: blob.type || "image/png",
        });

        const closeMenu = () => deactivateList([sidebar, backdrop]);

        orientationBtn.addEventListener('click', () => Graficos.smoothRotation(0));
        optionsBtn.addEventListener('click', () => activateList([sidebar, backdrop]));
        closeBtn.addEventListener('click', closeMenu);
        backdrop.addEventListener('click', closeMenu);

        document.getElementById("banner-route").addEventListener("click", () => {
            if (bannerHeld()) Search.RouteUI.start(Tools.Holdable.object, Banner.getTitle());
        });

        document.getElementById("banner-share").addEventListener("click", async () => {
            let coord = Tools.Holdable.object.coordinate;

            let geocoords = Localizacao.mapToGeographical(coord.getIn("normal"));

            if (!Array.isArray(geocoords) || !Number.isFinite(geocoords[0]) || !Number.isFinite(geocoords[1])) {
                Toasts.toaster.show({ text: "Falha ao comparilhar.", category: "error" });
                return;
            }

            let url = buildURL(window.location.origin + window.location.pathname, { showpin: 0, lat: geocoords[0], long: geocoords[1] });

            Actions.shareFeature({
                title: 'Venha aqui!',
                text: 'Olha só esse lugar!',
                url: url,
            });
        });

        const userTab = document.getElementById("user-tab");
        const shareLocation = document.getElementById("share-location");
        shareLocation.addEventListener("click", async () => {
            const status = await Localizacao.requestLocation();
            if (status === "granted") {
                let geocoords = Localizacao.mapToGeographical(Editor.Self.coordinate.getIn("normal"));

                if (!Array.isArray(geocoords) || !Number.isFinite(geocoords[0]) || !Number.isFinite(geocoords[1])) {
                    Toasts.toaster.show({ text: "Falha ao comparilhar.", category: "error" });
                    return;
                }

                let url = buildURL(window.location.origin + window.location.pathname, { showpin: 1, lat: geocoords[0], long: geocoords[1] });

                Actions.shareFeature({
                    title: 'Venha ver onde eu estou!',
                    text: 'Olha só onde eu estou!',
                    url: url,
                });
            }
            else Search.reportLocationFailure(status, 'Localização desativada: não é possível compartilhá-la.');
        });

        registerUI({ mapContainer, userTab, defaultImageFile });

        Persistence.load();
    } else if (page == "editor") {
        const buildBtn = document.getElementById("build");
        const referenceBtn = document.getElementById("reference");
        const connectionBtn = document.getElementById("connection");
        const bannerBtn = document.getElementById("banner-btn");
        const saveBtn = document.getElementById("save");
        const pinBtn = document.getElementById("pin-mode");
        const constructionPanel = document.getElementById("construction-group");
        const selectionBtn = document.getElementById("selection");
        const deleteBtn = document.getElementById("delete");

        Banner.init();

        document.addEventListener("keydown", (e) => Keys.onKeyDown(e));
        document.addEventListener("keyup", (e) => Keys.onKeyUp(e));
        window.addEventListener("blur", () => Keys.reset());
        document.addEventListener("pointerup", () => Keys.flush());

        map.dataset.mode = editorMode;
        addShortcutHints([
            [selectionBtn, "S"], [referenceBtn, "R"], [connectionBtn, "C"],
            [buildBtn, "B"], [bannerBtn, "N"], [deleteBtn, "D"], [saveBtn, "Ctrl+S"],
        ]);

        Editor.SelectRegion.onRestoreMode = (vm) => {
            if (Keys.vertexSelect === vm) return;
            Keys.vertexSelect = vm;
            syncHandles();
        };

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
        saveBtn.addEventListener("click", Persistence.save);

        Persistence.initAutosave();

        Tour.init({ autoStart: Versions.state.viewing === null });

        document.getElementById("help-btn").addEventListener("click", () => {
            Versions.close();
            Tour.start();
        });

        registerUI({
            mapContainer,
            selectionBtn, deleteBtn, buildBtn, referenceBtn, connectionBtn, bannerBtn, pinBtn,
            constructionPanel,
        });

        Persistence.load();
    }
}