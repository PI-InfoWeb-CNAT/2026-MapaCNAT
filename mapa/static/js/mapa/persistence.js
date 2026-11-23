import * as Graficos from "./graficos.js";
import * as Editor from "./objects.js";
import * as Toasts from '../toasts.js';
import * as Modals from '../modals.js';
import * as Versions from './editor/versions.js';
import * as Tools from './editor/tools.js';
import { bannerState, Actions, hooks } from './editor/action.js';
import { gestureActive } from './pointer.js';

let page;

export function setContext(context) {
    page = context.page;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// =====================================================================
// LOAD  (moved from objects.js)
// =====================================================================

const MIME_MAP = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'text/plain': 'txt',
    'application/json': 'json',
};

function generateRandomFileName(mimeType) {
    const extension = MIME_MAP[mimeType] || mimeType.split('/')[1] || 'bin';
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substring(2, 8);
    return `${timestamp}-${randomPart}.${extension}`;
}

async function urlToFile(url) {
    if (!url) return null;
    const response = await fetch(url);
    const blob = await response.blob();

    const mimeType = blob.type || 'image/png';
    const filename = generateRandomFileName(mimeType);
    return new File([blob], filename, { type: mimeType });
}

/** Copies the saved banner data onto an object's Banner. */
async function applyBanner(target, data) {
    const banner = target.banner;
    if (data.title) {
        banner.title = data.title;
        banner.detailed = true;
    }
    if (data.description) {
        banner.description = data.description;
        banner.detailed = true;
    }
    if (data.alias) banner.titleAlias = data.alias;
    if (data.mode) banner.mode = data.mode;
    if (data.priority) banner.priority = data.priority;
    if (data.image) {
        banner.image = await urlToFile(data.image);
        banner.detailed = true;
    }
}

export async function load() {
    try {
        const response = await fetch(URLLoadMap);
        if (!response.ok) throw new Error('Erro de rede');
        const data = await response.json();
        const refMap = {};
        const buildMap = {};

        if (data.buildings) {
            for (const key of Object.keys(data.buildings)) {
                const build = data.buildings[key];

                const buildCoord = Editor.newCoord(build.pin.x, build.pin.y, "normal");
                const building = new Editor.Building(buildCoord, build.name);
                buildMap[key] = building;

                const banner = data.banners[build.banner];
                if (banner) await applyBanner(building, banner);

                let poly = build.polygon;
                if (!poly && build.areas) {
                    poly = Editor.legacyPolygon(build.areas.map(k => data.areas?.[k]));
                }
                if (poly && poly.length >= 3) building.setPolygon(poly);
            }
        }

        if (data.references) {
            for (const key of Object.keys(data.references)) {
                const reference = data.references[key];
                const coord = Editor.newCoord(reference.pos.x, reference.pos.y, "normal");
                const refObject = new Editor.Reference(coord);
                refMap[key] = refObject;

                if (reference.banner == null) continue;
                const banner = data.banners[reference.banner];
                if (!banner) continue;

                await applyBanner(refObject, banner);
                if (banner.title) refObject.setName(banner.title);
                refObject.updateGraphics();
            }
        }

        if (data.connections) {
            for (const key of Object.keys(data.connections)) {
                const connection = data.connections[key];
                new Editor.Connection(refMap[connection.a], refMap[connection.b]);
            }
        }

        for (const ref of Object.values(refMap)) ref.updateGraphics();
        for (const build of Object.values(buildMap)) build.rename(build.name);

        Graficos.Zoom(Graficos.zoom);
    } catch (error) {
        console.error('Fetch error:', error);
    }
}

// =====================================================================
// SAVE
// =====================================================================

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
        const response = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "X-CSRFToken": getCookie("csrftoken"),
            },
            body: formData,
        });

        if (response.status === 401) console.error("Usuário não autorizado.");
        return response;
    } catch (error) {
        console.error("Erro de rede:", error);
        return null;
    }
}

async function persistMap() {
    const { payload, files } = Editor.buildPayload();

    const formData = new FormData();
    formData.append("data", JSON.stringify(payload));

    if (files && typeof files === "object") {
        for (const [bannerId, file] of Object.entries(files)) {
            if (file instanceof File) formData.append(`file_${bannerId}`, file, file.name);
        }
    }
    return saveMapState(formData);   // Response | null
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

// =====================================================================
// AUTOSAVE
// =====================================================================

const AUTOSAVE_DEBOUNCE_MS = 1500;
const AUTOSAVE_MAX_WAIT_MS = 10000;
const AUTOSAVE_RETRY_MS = [2000, 5000, 15000, 30000];

export const Autosave = {
    version: 0,          // increments on every change
    savedVersion: 0,     // version that the server already has
    timer: 0,
    firstDirtyAt: 0,
    failures: 0,
    halted: false,       // 401: stop retrying
    statusEl: null,

    get dirty() { return this.version !== this.savedVersion; },

    init() {
        this.statusEl = document.getElementById("save-status");
    },

    markDirty() {
        if (page !== "editor" || Versions.state.viewing !== null) return;
        this.version++;
        if (!this.firstDirtyAt) this.firstDirtyAt = performance.now();
        this.setStatus("pending");
        this.schedule(AUTOSAVE_DEBOUNCE_MS);
    },

    schedule(delay) {
        if (this.halted) return;
        clearTimeout(this.timer);
        const waited = performance.now() - this.firstDirtyAt;
        const wait = Math.min(delay, Math.max(0, AUTOSAVE_MAX_WAIT_MS - waited));
        this.timer = setTimeout(() => this.run(), wait);
    },

    // can we save right now without interrupting the user?
    safeNow() {
        if (isSaving || Actions.confirmingBanner || Actions.switching) return false;
        if (Modals.modal.dialog.open) return false;
        if (gestureActive()) return false;

        const draft = Tools.Task.task === "build" && Tools.Task.taskStep === 1 ? Tools.Task.data["buildObject"] : null;
        if (draft && !draft.closed) return false;   // unfinished building
        return true;
    },

    async run() {
        clearTimeout(this.timer);
        if (!this.dirty || this.halted) return;
        if (!this.safeNow()) { this.schedule(1000); return; }

        isSaving = true;
        const target = this.version;
        this.setStatus("saving");

        let ok = false;
        try {
            if (bannerState().state !== "partial") Actions.saveBanner();

            const response = await persistMap();
            if (response?.status === 401) {
                this.halted = true;
                this.setStatus("error");
                Toasts.toaster.show({ text: "Sessão expirada. Faça login de novo para continuar salvando.", category: "error" });
                return;
            }
            ok = !!response?.ok;
        } catch (err) {
            console.error("Autosave falhou:", err);
        } finally {
            isSaving = false;
        }

        if (ok) {
            this.savedVersion = target;   // changes made during the request stay dirty
            this.failures = 0;
            if (this.dirty) {
                this.setStatus("pending");
                this.schedule(AUTOSAVE_DEBOUNCE_MS);
            } else {
                this.firstDirtyAt = 0;
                this.setStatus("saved");
            }
        } else {
            const delay = AUTOSAVE_RETRY_MS[Math.min(this.failures++, AUTOSAVE_RETRY_MS.length - 1)];
            this.setStatus("error");
            this.schedule(delay);
        }
    },

    // called by the manual save when it succeeds
    markSaved(version) {
        this.savedVersion = Math.max(this.savedVersion, version);
        if (!this.dirty) { this.firstDirtyAt = 0; clearTimeout(this.timer); this.setStatus("saved"); }
    },

    setStatus(state) {
        if (!this.statusEl) return;
        this.statusEl.dataset.state = state;
        this.statusEl.textContent = {
            pending: "Alterações não salvas",
            saving:  "Salvando…",
            saved:   "Salvo",
            error:   "Erro ao salvar. Tentando de novo…",
        }[state] ?? "";
    },
};

/** Editor only: status element, the markDirty hook, version-history guard and page-leave handlers. */
export function initAutosave() {
    Autosave.init();
    hooks.markDirty = () => Autosave.markDirty();

    Versions.init({
        beforeLeave: async () => {
            if (!Autosave.dirty) return true;

            await Autosave.run();
            if (!Autosave.dirty) return true;

            const discard = await Modals.modal.confirm({
                title: "Alterações não salvas",
                message: "Algumas alterações ainda não foram salvas e serão perdidas se você continuar.",
                cancelText: "Ficar",
                confirmText: "Continuar mesmo assim",
            });
            if (discard) {
                Autosave.halted = true;
                clearTimeout(Autosave.timer);
            }
            return discard;
        },
    });

    window.addEventListener("beforeunload", (e) => {
        if (Autosave.dirty && !Versions.state.leaving) { e.preventDefault(); e.returnValue = ""; }
    });
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden" && Autosave.dirty) Autosave.run();
    });
    window.addEventListener("pagehide", () => { if (Autosave.dirty) Autosave.run(); });
}

export async function save() {
    if (Versions.state.viewing !== null) {
        Toasts.toaster.show({ text: "Você está vendo uma versão antiga. Restaure-a ou volte ao mapa atual.", category: "warn" });
        return;
    }
    if (isSaving) return;

    isSaving = true;
    const version = Autosave.version;     // what this save covers

    try {
        if (!(await Actions.ensureBannerValid())) return;
        const draft = Tools.Task.data["buildObject"];
        if (Tools.Task.task == "build" && draft && !draft.closed) {
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
            progress.completeTask("createdPayload");   // buildPayload now happens inside persistMap
            progress.completeTask("preparedFiles");

            const response = await persistMap();
            if (!response?.ok) throw new Error(`HTTP ${response?.status ?? "rede"}`);

            progress.completeTask("uploaded");
            Autosave.markSaved(version);
        } catch (error) {
            console.error("Erro ao salvar:", error);
            progress.fail("Não foi possível salvar o mapa.");
            throw error;
        }
    } finally {
        isSaving = false;
    }
}