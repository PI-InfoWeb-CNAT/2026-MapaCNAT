import { DEMOS } from "./tour-demos.js";
import * as Toasts from "../../toasts.js";

const STORAGE_KEY = "mapa-editor-tour";
const TOUR_VERSION = 1;   // aumente este número para mostrar o tour de novo a todos (ex.: ao lançar uma ferramenta nova)

const SPOT_PAD = 8;       // folga em volta do item destacado
const CARD_GAP = 16;      // distância entre o item e o cartão
const EDGE = 12;          // margem mínima até a borda da tela

/* ---------- passos ----------
   target: seletor do item a destacar (sem target = cartão centralizado)
   placement: lado preferido do cartão (opcional)
   key: atalho de teclado mostrado no cartão (opcional)                      */
const STEPS = [
    {
        icon: "map-location-dot",
        title: "Bem-vindo ao editor!",
        text: `
            <p>Este é um tour, de cerca de 1 minuto, pelas ferramentas. A tela vai escurecer destacando cada aspecto do editor.</p>
            <p>Já conhece o editor? Clique em <strong>Pular tour</strong> ou aperte <kbd>Esc</kbd> a qualquer momento.</p>`,
    },
    {
        icon: "compass",
        title: "Navegando pelo mapa",
        text: `
            <ul>
                <li><strong>Mover:</strong> arrastar com o botão esquerdo.</li>
                <li><strong>Zoom:</strong> roda do mouse (ou pinça no celular).</li>
                <li><strong>Girar:</strong> botão direito + arrastar, ou <kbd>Q</kbd> / <kbd>E</kbd>. A tecla <kbd>0</kbd> volta o norte para cima.</li>
                <li>Segurar <kbd>X</kbd> move o mapa em qualquer ferramenta.</li>
            </ul>`,
    },
    {
        target: "#selection",
        key: "S",
        icon: "hand",
        title: "Seleção",
        text: `
            <p>Clique em um item ou arraste uma região para selecionar vários elementos. Com a seleção feita, arraste a caixa para mover, as bordas para redimensionar e os cantos (por fora) para girar.</p>
            <p><kbd>Shift</kbd> soma à seleção, <kbd>T</kbd> alterna entre "tocar" e "conter" para selecionar, enquanto <kbd>V</kbd> alterna entre a seleção de construções ou de seus vértices.</p>`,
    },
    {
        target: "#delete",
        key: "D",
        icon: "trash",
        title: "Apagar",
        text: `
            <p>Clique em uma referência, conexão ou construção para apagá-la. Para apagar vários de uma vez, selecione e aperte <kbd>Delete</kbd>.</p>
            <p><kbd>Ctrl</kbd>+<kbd>Z</kbd> desfaz.</p>`,
    },
     {
        target: "#build",
        key: "B",
        icon: "building",
        title: "Construções",
        demo: DEMOS.construction,
        text: `
            <ol>
                <li>Ative a ferramenta e clique no <strong>ícone de pino</strong> que surge ao lado dela.</li>
                <li>Clique no mapa, dê um nome e depois clique em cada canto da construção (mínimo de 3).</li>
                <li>Feche clicando no <strong>primeiro ponto</strong> (ele fica verde) ou apertando <kbd>Enter</kbd>.</li>
            </ol>
            <p>Depois, arraste os vértices; os pontinhos no meio das arestas criam vértices novos. Clique no pino para renomear. <kbd>Shift</kbd> alinha com os outros pontos.</p>`,
    },
    {
        target: "#reference",
        key: "R",
        icon: "map-pin",
        title: "Referências",
        demo: DEMOS.reference,
        text: `
            <p>Clique no mapa para criar um ponto e arraste para movê-lo.</p>
            <ul>
                <li>Perto da parede de uma construção, ele vira uma <strong>entrada</strong>.</li>
                <li>Solto sobre uma conexão, divide a linha em duas.</li>
                <li>Solto sobre outro ponto, os dois se fundem.</li>
            </ul>`,
    },
    {
        target: "#connection",
        key: "C",
        icon: "circle-nodes",
        title: "Conexões",
        demo: DEMOS.connection,
        text: `
            <p>Arraste de uma referência até outra para ligá-las. Essas ligações formam os caminhos que o mapa usa para calcular rotas.</p>
            <p>Sem soltar o botão, continue até a próxima referência para encadear várias conexões de uma vez.</p>`,
    },
    {
        target: "#banner-btn",
        key: "N",
        icon: "image",
        title: "Banners",
        demo: DEMOS.banner,
        text: `
            <ol>
                <li>Ative <strong>Banners</strong> e clique em uma referência ou construção.</li>
                <li>No painel, escolha a <strong>categoria</strong> nas abas de cima. Ela define o ícone e a cor do pino.</li>
                <li>Preencha os campos pedidos. O painel avisa o que falta, e tudo é salvo sozinho.</li>
            </ol>
            <p>O pino só aparece no mapa depois que o banner tem conteúdo.</p>`,
    },
    {
        target: "#save-status",
        placement: "bottom",
        icon: "cloud-arrow-up",
        title: "Salvamento automático",
        text: `
            <p>Você <strong>não precisa salvar</strong>: o editor salva sozinho poucos segundos depois de cada alteração.</p>
            <p>Este indicador mostra o estado: <em>Alterações não salvas</em> → <em>Salvando…</em> → <strong>Salvo</strong>. Quando aparecer "Salvo", pode fechar a janela sem medo.</p>`,
    },
    {
        target: "#save",
        placement: "bottom",
        key: "Ctrl+S",
        icon: "floppy-disk",
        title: "Salvar agora",
        text: `<p>Caso queira ter certeza de que salvou, utilize o botão. Ele informará possíveis problemas como rotas desconectadas, construções sem banners, interiores ausentes, etc.</p>`,
    },
    {
        target: "#history-btn",
        placement: "bottom",
        icon: "clock-rotate-left",
        title: "Histórico de versões",
        text: `
            <p>O sistema guarda cópias do mapa ao longo do tempo. Abra o histórico para <strong>visualizar versões antigas</strong> (somente leitura) e <strong>restaurar</strong> uma delas se algo der errado.</p>
            <p>Restaurar é reversível: a versão atual também é guardada antes.</p>`,
    },
    {
        target: "#help-btn",
        placement: "bottom",
        icon: "circle-question",
        title: "Precisa de ajuda? Use o (?)",
        text: `
            <p>Este botão <strong>(?)</strong> reabre este tour a qualquer momento.</p>
            <p>Para ver todos os atalhos de teclado, aperte <kbd>H</kbd> ou <kbd>?</kbd>.</p>
            <p>Pronto, bom trabalho!</p>`,
    },
];

/* ---------- memória do "já viu" ---------- */

function hasSeen() {
    try {
        return Number(localStorage.getItem(STORAGE_KEY)) >= TOUR_VERSION;
    } catch {
        return false;   // localStorage bloqueado: mostra, mas não insiste em lembrar
    }
}

function markSeen() {
    try {
        localStorage.setItem(STORAGE_KEY, String(TOUR_VERSION));
    } catch { /* sem armazenamento: tudo bem */ }
}

/* ---------- estado e DOM ---------- */

let root, spot, card, refs;
let index = 0;
let active = false;
let lastFocus = null;

function build() {
    if (root) return;

    root = document.createElement("div");
    root.className = "tour-root";
    root.innerHTML = `
        <div class="tour-blocker"></div>
        <div class="tour-spot is-empty" aria-hidden="true"></div>
        <section class="tour-card" role="dialog" aria-modal="true"
                 aria-labelledby="tour-title" aria-describedby="tour-text" tabindex="-1">
            <button type="button" class="tour-close" aria-label="Pular tour">
                <i class="fa-solid fa-xmark"></i>
            </button>

            <div class="tour-head">
                <span class="tour-icon-wrap"><i class="tour-icon fa-solid"></i></span>
                <h2 id="tour-title" class="tour-title"></h2>
            </div>
            <div class="tour-demo" hidden aria-hidden="true"></div>
            <div class="tour-key"></div>
            <div id="tour-text" class="tour-text" aria-live="polite"></div>

            <div class="tour-progress"><span class="tour-progress-fill"></span></div>
            <div class="tour-footer">
                <span class="tour-count"></span>
                <div class="tour-actions">
                    <button type="button" class="tour-btn tour-btn--ghost tour-skip">Pular tour</button>
                    <button type="button" class="tour-btn tour-prev">Voltar</button>
                    <button type="button" class="tour-btn tour-btn--primary tour-next">Próximo</button>
                </div>
            </div>
        </section>`;
    document.body.appendChild(root);

    spot = root.querySelector(".tour-spot");
    card = root.querySelector(".tour-card");
    refs = {
        close: card.querySelector(".tour-close"),
        icon: card.querySelector(".tour-icon"),
        title: card.querySelector(".tour-title"),
        key: card.querySelector(".tour-key"),
        text: card.querySelector(".tour-text"),
        fill: card.querySelector(".tour-progress-fill"),
        count: card.querySelector(".tour-count"),
        skip: card.querySelector(".tour-skip"),
        prev: card.querySelector(".tour-prev"),
        next: card.querySelector(".tour-next"),
        demo: card.querySelector(".tour-demo"),
    };

    const lastIndex = STEPS.length - 1;
    refs.close.addEventListener("click", () => finish(index < lastIndex));
    refs.skip.addEventListener("click", () => finish(true));
    refs.prev.addEventListener("click", () => go(index - 1));
    refs.next.addEventListener("click", () => (index === lastIndex ? finish(false) : go(index + 1)));
}

/* ---------- posicionamento ---------- */

function targetRect(step) {
    if (!step.target) return null;
    const el = document.querySelector(step.target);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width || r.height ? r : null;   // display:none => sem destaque
}

function place() {
    if (!active) return;

    const step = STEPS[index];
    const rect = targetRect(step);
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // holofote: sem alvo, vira um ponto no centro (só escurece)
    spot.classList.toggle("is-empty", !rect);
    if (rect) {
        spot.style.left = `${rect.left - SPOT_PAD}px`;
        spot.style.top = `${rect.top - SPOT_PAD}px`;
        spot.style.width = `${rect.width + SPOT_PAD * 2}px`;
        spot.style.height = `${rect.height + SPOT_PAD * 2}px`;
    } else {
        spot.style.left = `${vw / 2}px`;
        spot.style.top = `${vh / 2}px`;
        spot.style.width = "0px";
        spot.style.height = "0px";
    }

    // cartão
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    let x = (vw - cw) / 2;
    let y = (vh - ch) / 2;

    if (rect) {
        const L = rect.left - SPOT_PAD, T = rect.top - SPOT_PAD;
        const R = rect.right + SPOT_PAD, B = rect.bottom + SPOT_PAD;

        const sides = {
            right:  { x: R + CARD_GAP,           y: (T + B) / 2 - ch / 2, ok: R + CARD_GAP + cw <= vw - EDGE },
            left:   { x: L - CARD_GAP - cw,      y: (T + B) / 2 - ch / 2, ok: L - CARD_GAP - cw >= EDGE },
            bottom: { x: (L + R) / 2 - cw / 2,   y: B + CARD_GAP,         ok: B + CARD_GAP + ch <= vh - EDGE },
            top:    { x: (L + R) / 2 - cw / 2,   y: T - CARD_GAP - ch,    ok: T - CARD_GAP - ch >= EDGE },
        };
        const order = [step.placement, "right", "bottom", "left", "top"].filter(Boolean);
        const side = order.find((s) => sides[s].ok);

        if (side) {
            x = sides[side].x;
            y = sides[side].y;
        } else {
            y = vh - ch - EDGE;   // sem espaço (tela pequena): cartão embaixo
        }
    }

    x = Math.min(Math.max(x, EDGE), Math.max(vw - cw - EDGE, EDGE));
    y = Math.min(Math.max(y, EDGE), Math.max(vh - ch - EDGE, EDGE));
    card.style.left = `${x}px`;
    card.style.top = `${y}px`;
}

/* ---------- navegação ---------- */

function go(i) {
    index = Math.min(Math.max(i, 0), STEPS.length - 1);
    const step = STEPS[index];
    const last = index === STEPS.length - 1;

    refs.icon.className = `tour-icon fa-solid fa-${step.icon ?? "circle-info"}`;
    refs.title.textContent = step.title;
    refs.key.innerHTML = step.key ? `Atalho: <kbd>${step.key}</kbd>` : "";
    refs.key.hidden = !step.key;
    refs.text.innerHTML = step.text;                        // texto estático e confiável, definido acima
    refs.count.textContent = `${index + 1} de ${STEPS.length}`;
    refs.fill.style.width = `${((index + 1) / STEPS.length) * 100}%`;

    refs.prev.hidden = index === 0;
    refs.skip.hidden = last;
    refs.next.textContent = last ? "Concluir" : index === 0 ? "Começar" : "Próximo";

    refs.demo.innerHTML = step.demo?.html ?? "";   // trocar o HTML reinicia a animação
    refs.demo.style.setProperty("--dur", step.demo?.dur ?? "8s");
    refs.demo.hidden = !step.demo;

    place();
    refs.next.focus({ preventScroll: true });
}

function finish(skipped) {
    if (!active) return;
    active = false;

    markSeen();
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", place);
    root.classList.remove("is-open");
    lastFocus?.focus?.({ preventScroll: true });
    lastFocus = null;

    if (skipped) {
        Toasts.toaster.show({
            text: "Tour pulado. Para rever, clique no botão (?) no topo da tela.",
            category: "success",
        });
    }
}

/* ---------- teclado ---------- */
// Captura na janela: roda antes dos atalhos do editor, que não recebem a tecla enquanto o tour está aberto.
function onKey(e) {
    if (!active) return;

    if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish(index < STEPS.length - 1);
        return;
    }
    if (e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        if (index < STEPS.length - 1) go(index + 1);
        return;
    }
    if (e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        if (index > 0) go(index - 1);
        return;
    }
    if (e.key === "Tab") {
        e.stopPropagation();
        const items = [...card.querySelectorAll("button:not([hidden])")];
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        const inside = card.contains(document.activeElement);

        if (!inside || (e.shiftKey && document.activeElement === first)) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
        return;
    }
    e.stopPropagation();   // Enter/Espaço ainda ativam o botão focado (ação padrão do navegador)
}

/* ---------- API pública ---------- */

export function start() {
    build();
    if (active) return;
    active = true;
    lastFocus = document.activeElement;

    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", place);

    root.classList.add("no-anim", "is-open");   // 1º passo: sem o cartão "voar" da posição 0,0
    go(0);
    void root.offsetWidth;
    requestAnimationFrame(() => root.classList.remove("no-anim"));
}

export function isActive() {
    return active;
}

export { hasSeen };

/** Mostra o tour automaticamente na primeira visita. */
export function init({ autoStart = true, delay = 800 } = {}) {
    if (autoStart && !hasSeen()) setTimeout(start, delay);
}