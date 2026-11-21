import * as Editor from "../objects.js";
import * as Tools from './tools.js';
import {
    bannerHeld, bannerState, Actions, hooks, registerUI,
    getBannerTabId, setBannerTabId,
} from './action.js';
import { Autosave } from '../persistence.js';

let page;

let bannerTab;
let bannerTabsEl;
let bannerStatus;
let imageInput;
let imageWrapper;
let imageLabel;
let bannerTitle;
let bannerDescription;
let bannerPriority;
let bannerAliasInput;
let bannerAliasList;
let bannerAliasField;
let bannerAliases = [];

let currentObjectURL = null;

export function setContext(context) {
    page = context.page;
}

export const getTitle = () => bannerTitle?.value ?? "";

// ---------- tabs ----------

function renderBannerTabs() {
    bannerTabsEl = document.getElementById("banner-tabs");
    if (!bannerTabsEl) return;
    bannerTabsEl.replaceChildren();

    for (const t of Editor.BANNER_TABS) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "banner-tab";
        btn.dataset.bannerTab = t.id;          // not data-tab: that one belongs to the editor tabs
        btn.dataset.tip = t.label;
        btn.setAttribute("role", "tab");
        btn.setAttribute("aria-label", t.label);
        btn.style.setProperty("--tab-color", t.color);
        btn.innerHTML = `<i class="fa-solid fa-${t.icon}" aria-hidden="true"></i>`;
        btn.addEventListener("click", () => switchBannerTab(t.id));
        bannerTabsEl.appendChild(btn);
    }
    syncBannerTabs();
}

export function syncBannerTabs() {
    if (!bannerTabsEl) return;
    const obj = bannerHeld() ? Tools.Holdable.object : null;
    let objType = obj instanceof Editor.Building ? "building" : "reference";

    for (const btn of bannerTabsEl.children) {
        const id = btn.dataset.bannerTab;
        const active = id === getBannerTabId();
        let bannerTabIdx = Editor.BANNER_TABS.map((element) => element.id).indexOf(getBannerTabId());
        const BuildingExclusion = ["construcao", "laboratorio", "refeitorio"].indexOf(id) == -1;
        const ReferenceExclusion = ["referencia", "titulo", "banheiro", "laboratorio", "estacionamento", "refeitorio"].indexOf(id) == -1;
        let allowedTab;

        if (objType == "building") {
            allowedTab = BuildingExclusion;
        } else {
            allowedTab = ReferenceExclusion;
        }

        btn.classList.toggle("hidden", allowedTab);
        imageWrapper.classList.toggle("hidden", Editor.BANNER_TABS[bannerTabIdx].uses.indexOf("imagem") === -1);
        bannerTitle.classList.toggle("hidden", Editor.BANNER_TABS[bannerTabIdx].uses.indexOf("título") === -1);
        bannerAliasField.classList.toggle("hidden", Editor.BANNER_TABS[bannerTabIdx].uses.indexOf("palavras-chave") === -1);
        bannerAliasField.nextElementSibling.classList.toggle("hidden", Editor.BANNER_TABS[bannerTabIdx].uses.indexOf("palavras-chave") === -1);
        bannerDescription.classList.toggle("hidden", Editor.BANNER_TABS[bannerTabIdx].uses.indexOf("descrição") === -1);
        bannerDescription.nextElementSibling.classList.toggle("hidden", Editor.BANNER_TABS[bannerTabIdx].uses.indexOf("descrição") === -1);
        bannerTitle.placeholder = Editor.BANNER_TABS[bannerTabIdx].placeholder;
        bannerPriority.classList.toggle("hidden", Editor.BANNER_TABS[bannerTabIdx].uses.indexOf("prioridade") === -1);

        const headings = document.querySelectorAll('.banner-alias-heading');
        headings.forEach((el) => {
            const state = el.dataset.state;
            el.classList.toggle("hidden", (Editor.BANNER_TABS[bannerTabIdx].uses.indexOf(state) === -1));
            el.children[1].classList.toggle("hidden", (Editor.BANNER_TABS[bannerTabIdx].uses.indexOf(state) === -1 || Editor.BANNER_TABS[bannerTabIdx].requires.indexOf(state) !== -1));
        });

        btn.classList.toggle("active", active);
        btn.setAttribute("aria-selected", String(active));

        btn.classList.toggle("has-content", false);
    }
}

async function switchBannerTab(id) {
    if (id === getBannerTabId() || !bannerHeld()) return;
    setBannerTabId(id);

    Actions.saveBanner();                               // writes the UI into the current tab

    syncBannerStatus();
}

// ---------- labels / status ----------

export function syncDescriptionLabel() {
    const label = bannerTab.querySelector(".banner-section-title");
    if (!label) return;

    const empty = !bannerDescription.value.trim();
    label.textContent = empty ? "Sem descrição" : "Sobre";
    label.closest(".banner-section")?.classList.toggle("is-empty", empty);
}

export function syncBannerStatus() {
    syncBannerTabs();
    if (!bannerStatus) return;
    const { state, missing } = bannerState();

    bannerStatus.dataset.state = state;
    bannerStatus.textContent =
        state === "partial" ? `Falta: ${missing.join(", ")}` :
        state === "complete" ? "Completo" : "Não detalhado";
}

// ---------- aliases ----------

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

export function setBannerAliases(values) {
    bannerAliases = normalizeBannerAliases(values);
    renderBannerAliases();
}

export const getBannerAliases = () => bannerAliases;

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
    Autosave.markDirty();
}

function commitBannerAliasInput() {
    if (!bannerAliasInput) return;

    addBannerAliases(bannerAliasInput.value);
    bannerAliasInput.value = "";
}

export function clearBannerFields() {
    resetDisplayImage();

    bannerTitle.value = "";
    bannerDescription.value = "";
    bannerPriority.value = 1;

    setBannerAliases([]);

    if (bannerHeld()) Tools.Holdable.initialPos.img = false;

    syncBannerStatus();
    Autosave.markDirty();
}

// ---------- image ----------

export function showImage(src) {
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

export function setDisplayImage(file) {
    showImage(file);

    if (page == "editor") {
        imageLabel.textContent = "substituir imagem";
    }
    if (bannerHeld()) {
        Tools.Holdable.initialPos["img"] = file;
        syncBannerStatus();
    }
}

export function resetDisplayImage() {
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
    Autosave.markDirty();
}

// ---------- init ----------

/** Grabs the DOM, registers the hooks/refs that action.js needs and (editor only) wires the banner form. */
export function init() {
    imageInput = document.getElementById("banner-image-input");
    imageWrapper = document.getElementById("image-upload-wrapper");
    imageLabel = document.getElementById("image-upload-label");
    bannerTitle = document.getElementById("place-name");
    bannerDescription = document.getElementById("place-description");
    bannerTab = document.getElementById(page === "main" ? "screen-ui" : "banner");

    Object.assign(hooks, {
        syncBannerStatus,
        syncDescriptionLabel,
        resetDisplayImage,
        setDisplayImage,
        showImage,
        clearBannerFields,
        setBannerAliases,
        getBannerAliases,
    });

    if (page === "main") {
        bannerDescription.placeholder = "Sem descrição";
    } else if (page === "editor") {
        bannerStatus = document.getElementById("banner-status");
        bannerPriority = document.getElementById("place-priority");
        bannerAliasInput = document.getElementById("banner-alias-input");
        bannerAliasField = document.getElementById("banner-alias-field");
        bannerAliasList = document.getElementById("banner-alias-list");

        document.getElementById("bannerForm").addEventListener("submit", (e) => e.preventDefault());
        document.getElementById("banner-close").addEventListener("click", () => Actions.requestCloseBanner());

        for (const field of [bannerTitle, bannerDescription, bannerPriority]) {
            field.addEventListener("input", () => { syncBannerStatus(); Autosave.markDirty(); });
        }

        imageInput.addEventListener("change", updateImageDisplay);

        bannerAliasInput.addEventListener("keydown", (e) => {
            if (e.key === " " || e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                commitBannerAliasInput();
                return;
            }

            if (e.key === "Backspace" && !bannerAliasInput.value && bannerAliases.length > 0) {
                e.preventDefault();
                bannerAliases.pop();
                Autosave.markDirty();
                renderBannerAliases();
            }
        });

        bannerAliasInput.addEventListener("paste", (e) => {
            e.preventDefault();
            addBannerAliases(e.clipboardData?.getData("text") || "");
        });

        bannerAliasInput.addEventListener("blur", commitBannerAliasInput);
    }

    registerUI({ bannerTab, imageWrapper, bannerTitle, bannerDescription, bannerPriority });

    if (page === "editor") renderBannerTabs();
}