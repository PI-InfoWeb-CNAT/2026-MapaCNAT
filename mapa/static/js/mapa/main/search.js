import * as Editor from "../objects.js";
import * as Toasts from '../../toasts.js';
import * as Localizacao from '../localizacao.js';
import { Actions } from '../editor/action.js';
import { goToPlace } from '../pointer.js';

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

let locationRequestId = 0;

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

export function reportLocationFailure(status, deniedText = 'Localização desativada: não é possível traçar rota a partir da sua posição.') {
    if (status === 'denied') {
        Toasts.toaster.show({ text: deniedText, category: "error" });
    } else if (status !== 'dismissed') {
        Toasts.toaster.show({ text: 'Não foi possível obter sua localização.', category: "error" });
    }
}

function selfPoint() {
    return Editor.Self ? { ref: Editor.Self, title: 'Sua localização', self: true } : null;
}

export const RouteUI = {
    /** `titleText` is the banner title of the destination (falls back to "Destino"). */
    async start(place, titleText = '') {
        const title = titleText.trim() || 'Destino';
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

async function pickSelf() {
    activeInput = null;
    expanded = false;
    syncExpansion();

    const status = await Localizacao.requestLocation();
    if (!Editor.Route.active) return;

    if (status === 'granted') RouteUI.setPoint('origin', selfPoint());
    else reportLocationFailure(status);
}

export function init() {
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