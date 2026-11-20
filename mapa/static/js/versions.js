import * as Toasts from "./toasts.js";
import * as Modals from "./modals.js";

const PAGE_SIZE = 30;

const MOTIVOS = {
    auto: "Automática",
    shrink: "Muitos itens removidos",
    manual: "Manual",
    restore: "Antes de restaurar",
};

const param = new URLSearchParams(location.search).get("versao");

// shared with mapa-editor.js
export const state = {
    viewing: /^\d+$/.test(param ?? "") ? Number(param) : null,   // version number, or null for the live map
    leaving: false,                                              // navigating away on purpose: skip the beforeunload prompt
};

let beforeLeave = async () => true;
let els = {};
let items = [];
let nextBefore = null;
let loading = false;
let restoring = false;

/* ---------- helpers ---------- */

function getCookie(name) {
    const hit = document.cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith(name + "="));
    return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function relativeTime(date) {
    const diff = (date.getTime() - Date.now()) / 1000;
    const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
    for (const [unit, secs] of [["day", 86400], ["hour", 3600], ["minute", 60]]) {
        if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit);
    }
    return "agora há pouco";
}

function absoluteTime(date) {
    return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function go(url) {
    state.leaving = true;
    location.assign(url);
}

/* ---------- navigation ---------- */

export async function openVersion(n) {
    if (!(await beforeLeave())) return;
    const url = new URL(location.href);
    url.hash = "";
    url.searchParams.set("versao", n);
    go(url);
}

export function exitVersion() {
    const url = new URL(location.href);
    url.hash = "";
    url.searchParams.delete("versao");
    go(url);
}

async function restore(n) {
    if (restoring || n == null) return;

    const ok = await Modals.modal.confirm({
        title: `Restaurar a versão ${n}?`,
        message: "O mapa atual será substituído por esta versão. O estado atual é guardado como uma nova versão, então dá para desfazer depois.",
        cancelText: "Cancelar",
        confirmText: "Restaurar",
    });
    if (!ok) return;

    restoring = true;
    els.restore.disabled = true;
    try {
        const url = URLRestoreVersion.replace(/\/0\/(?=restaurar)/, `/${n}/`);
        const response = await fetch(url, {
            method: "POST",
            headers: { "X-CSRFToken": getCookie("csrftoken") },
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.status !== "success") throw new Error(data.message || `HTTP ${response.status}`);
        exitVersion();   // reloads the live map, which is now the restored one
    } catch (err) {
        console.error("Restauração falhou:", err);
        Toasts.toaster.show({ text: "Não foi possível restaurar esta versão.", category: "error" });
        els.restore.disabled = false;
        restoring = false;
    }
}

/* ---------- list ---------- */

async function fetchPage(before) {
    const url = new URL(URLVersions, location.origin);
    url.searchParams.set("limit", PAGE_SIZE);
    if (before) url.searchParams.set("before", before);

    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

async function loadPage(reset = false) {
    if (loading) return;
    loading = true;
    els.more.disabled = true;

    try {
        const data = await fetchPage(reset ? null : nextBefore);
        items = reset ? data.versions : items.concat(data.versions);
        nextBefore = data.next_before;
        render();
        updateBarText();
    } catch (err) {
        console.error("Histórico falhou:", err);
        Toasts.toaster.show({ text: "Não foi possível carregar o histórico.", category: "error" });
    } finally {
        loading = false;
        els.more.disabled = false;
    }
}

function currentRow() {
    const li = el("li", "history-item is-current");
    const top = el("div", "history-item-top");
    top.append(el("strong", "", "Mapa atual"));

    if (state.viewing === null) {
        top.append(el("span", "history-badge", "Em edição"));
        li.append(top, el("div", "history-when", "O que está salvo agora"));
    } else {
        li.append(top, el("div", "history-when", "O que está salvo agora"));
        const btn = el("button", "alt-botao history-action", "Voltar ao mapa atual");
        btn.type = "button";
        btn.dataset.action = "exit";
        li.append(btn);
    }
    return li;
}

function versionRow(v) {
    const date = new Date(v.criado_em);
    const viewing = v.numero === state.viewing;

    const li = el("li", "history-item" + (viewing ? " is-viewing" : ""));

    const top = el("div", "history-item-top");
    const badge = el("span", "history-badge", MOTIVOS[v.motivo] ?? v.motivo);
    badge.dataset.motivo = v.motivo;
    top.append(el("strong", "", `Versão ${v.numero}`), badge);

    const when = el("div", "history-when", `${relativeTime(date)} · ${absoluteTime(date)}`);
    when.title = date.toISOString();
    if (v.criado_por) when.append(` · ${v.criado_por}`);

    const r = v.resumo ?? {};
    const counts = el(
        "div",
        "history-counts",
        [
            plural(r.buildings ?? 0, "construção", "construções"),
            plural(r.references ?? 0, "referência", "referências"),
            plural(r.connections ?? 0, "conexão", "conexões"),
        ].join(" · "),
    );

    const btn = el("button", "alt-botao history-action", viewing ? "Visualizando" : "Visualizar");
    btn.type = "button";
    btn.disabled = viewing;
    btn.dataset.action = "view";
    btn.dataset.n = v.numero;

    li.append(top, when, counts, btn);
    return li;
}

function render() {
    const rows = [currentRow(), ...items.map(versionRow)];
    if (!items.length) rows.push(el("li", "history-empty", "Nenhuma versão ainda. Elas aparecem conforme o mapa é salvo."));
    els.list.replaceChildren(...rows);
    els.more.classList.toggle("hidden", nextBefore == null);
}

function onListClick(e) {
    const btn = e.target.closest("[data-action]");
    if (!btn || btn.disabled) return;
    if (btn.dataset.action === "view") openVersion(Number(btn.dataset.n));
    else if (btn.dataset.action === "exit") exitVersion();
}

/* ---------- panel + read-only mode ---------- */

export function isOpen() {
    return !!els.panel && !els.panel.classList.contains("hidden");
}

export function open() {
    els.panel.classList.remove("hidden");
    els.btn.setAttribute("aria-expanded", "true");
    loadPage(true);   // always fresh: new versions appear as the user saves
}

export function close() {
    els.panel.classList.add("hidden");
    els.btn.setAttribute("aria-expanded", "false");
}

function toggle() {
    if (isOpen()) close();
    else open();
}

function updateBarText() {
    if (state.viewing === null) return;
    const v = items.find((item) => item.numero === state.viewing);
    const when = v ? ` · ${absoluteTime(new Date(v.criado_em))}` : "";
    els.barText.textContent = `Visualizando a versão ${state.viewing}${when} (somente leitura)`;
}

function enterViewingUI() {
    els.app.classList.add("viewing-version");
    els.bar.classList.remove("hidden");
    updateBarText();

    els.status.dataset.state = "readonly";
    els.status.textContent = "Somente leitura";

    loadPage(true);   // fills in the date in the bar
}

/**
 * beforeLeave: async () => boolean. Called before leaving the live map
 * (so mapa-editor.js can flush or discard unsaved changes).
 */
export function init({ beforeLeave: hook } = {}) {
    if (hook) beforeLeave = hook;

    els = {
        app: document.getElementById("editor-app"),
        btn: document.getElementById("history-btn"),
        panel: document.getElementById("history"),
        close: document.getElementById("history-close"),
        list: document.getElementById("history-list"),
        more: document.getElementById("history-more"),
        bar: document.getElementById("version-bar"),
        barText: document.getElementById("version-bar-text"),
        restore: document.getElementById("version-restore"),
        exit: document.getElementById("version-exit"),
        status: document.getElementById("save-status"),
    };

    els.btn.addEventListener("click", toggle);
    els.close.addEventListener("click", close);
    els.more.addEventListener("click", () => loadPage(false));
    els.list.addEventListener("click", onListClick);
    els.restore.addEventListener("click", () => restore(state.viewing));
    els.exit.addEventListener("click", exitVersion);

    if (state.viewing !== null) enterViewingUI();
}