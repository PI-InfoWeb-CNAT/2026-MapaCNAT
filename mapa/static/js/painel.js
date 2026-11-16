/* ==========================================================================
   painel.js

   1. Diálogos <dialog> (página de staff) e proteção contra envio duplicado
   2. Hub de mapas: modal único de criar/editar (com landmarker) e modal de apagar
   ========================================================================== */

/* ==========================================================================
   1. Diálogos e envio duplicado
   ========================================================================== */
(() => {
    document.addEventListener("click", (e) => {
        const opener = e.target.closest("[data-dialog-open]");
        if (opener) {
            const dialog = document.getElementById(opener.dataset.dialogOpen);
            if (!dialog) return;

            if (opener.dataset.userId) {
                dialog.querySelector('input[name="user_id"]').value = opener.dataset.userId;
                dialog.querySelector("[data-remove-email]").textContent = opener.dataset.userEmail;
            }
            dialog.showModal();
            dialog.querySelector("input:not([type=hidden])")?.focus();
            return;
        }

        const closer = e.target.closest("[data-dialog-close]");
        if (closer) {
            closer.closest("dialog")?.close();
            return;
        }

        // clique no backdrop (o alvo é o próprio <dialog>)
        if (e.target instanceof HTMLDialogElement) e.target.close();
    });

    // Reabre o diálogo quando o servidor devolveu erros de validação
    document
        .querySelectorAll("dialog[data-open-on-load]")
        .forEach((dialog) => dialog.showModal());

    // Evita envio duplicado
    document.querySelectorAll(".painel-dialog form, .staff-form").forEach((form) => {
        form.addEventListener("submit", () => {
            form.querySelector('[type="submit"]')?.setAttribute("disabled", "");
        });
    });
    window.addEventListener("pageshow", () => {
        document
            .querySelectorAll('.painel-dialog [type="submit"], .staff-form [type="submit"]')
            .forEach((b) => b.removeAttribute("disabled"));
    });
})();


/* ==========================================================================
   2. Hub de mapas
   ========================================================================== */
document.addEventListener("DOMContentLoaded", () => {
    const MAX_SVG_BYTES = 20 * 1024 * 1024;

    const grid = document.getElementById("mapas-grid");
    const tplForm = document.getElementById("template-mapa-form");
    const tplApagar = document.getElementById("template-apagar-mapa");
    if (!grid || !tplForm) return;   // outra página do painel

    // as URLs de editar/apagar vêm com /0/ no lugar do id
    const urlDoMapa = (modelo, pk) => modelo.replace("/0/", `/${pk}/`);

    function dadosDoCard(card) {
        return {
            pk: card.dataset.pk,
            nome: card.dataset.nome,
            svgUrl: card.dataset.svgUrl || null,
            landmarks: card.dataset.landmarks || "",
        };
    }

    // Alarga o modal para os dois mapas ficarem lado a lado. Como não dependemos de uma classe
    // específica do ModalManager, sobe a partir do corpo e ajusta os contêineres com max-width em px.
    const LARGURA_MODAL = "min(1280px, 96vw)";

    function alargarModal(body) {
        for (let el = body; el && el !== document.body; el = el.parentElement) {
            if (getComputedStyle(el).maxWidth.endsWith("px")) {
                el.style.setProperty("max-width", LARGURA_MODAL, "important");
                el.style.setProperty("width", LARGURA_MODAL, "important");
            }
        }
    }

    function impedirEnvioDuplo(form) {
        form.addEventListener("submit", () => {
            form.querySelector('[type="submit"]')?.setAttribute("disabled", "");
        });
    }

    /* ---------- criar / editar (mesmo modal) ---------- */

    function abrirFormulario(mapa = null) {
        if (!window.modal) {
            console.error("ModalManager não está disponível.");
            return;
        }

        const editar = mapa !== null;
        const content = tplForm.content.firstElementChild.cloneNode(true);

        window.modal.open({
            title: editar ? "Editar mapa" : "Novo mapa",
            size: "xl",
            html: content,

            onMount: (body, manager) => {
                alargarModal(body);

                const form = body.querySelector("form");
                const nome = form.querySelector('input[name="nome"]');
                const arquivo = form.querySelector('input[type="file"]');
                const erroSvg = form.querySelector("[data-svg-erro]");
                const dicaSvg = form.querySelector("[data-svg-hint]");
                const raiz = form.querySelector("[data-landmarker]");
                const campoLandmarks = form.querySelector("[data-lm-input]");

                if (editar) {
                    form.action = urlDoMapa(grid.dataset.urlEditar, mapa.pk);
                    nome.value = mapa.nome;
                    campoLandmarks.value = mapa.landmarks;      // antes do mount
                    arquivo.required = false;                    // mantém o SVG atual se vazio
                    if (dicaSvg) {
                        dicaSvg.textContent =
                            "Deixe em branco para manter o SVG atual. Ao trocar o arquivo, " +
                            "as marcações no SVG precisam ser refeitas.";
                    }
                    form.querySelector("[data-submit-label]").textContent = "Salvar alterações";
                } else {
                    form.action = grid.dataset.urlCriar;
                }

                const landmarker = window.Landmarker.mount(raiz, {
                    svgUrl: editar ? mapa.svgUrl : null,
                });

                // valida e alimenta o landmarker assim que o arquivo é escolhido
                arquivo.addEventListener("change", () => {
                    const file = arquivo.files[0];
                    let mensagem = "";

                    if (file && !/\.svg$/i.test(file.name)) mensagem = "O arquivo precisa ser um SVG.";
                    else if (file && file.size > MAX_SVG_BYTES) mensagem = "O SVG passa de 20 MB.";

                    erroSvg.textContent = mensagem;
                    arquivo.setAttribute("aria-invalid", mensagem ? "true" : "false");

                    if (mensagem) {
                        arquivo.value = "";
                        return;
                    }
                    if (file) {
                        landmarker.setSvg(file, { resetar: editar });
                    } else {
                        landmarker.setSvg(editar ? mapa.svgUrl : null);
                    }
                });

                body.querySelector("[data-modal-cancelar]")?.addEventListener("click", () => manager.close());
                impedirEnvioDuplo(form);
                nome.focus();
            },
        });
    }

    /* ---------- apagar ---------- */

    function abrirApagar(mapa) {
        if (!window.modal || !tplApagar) return;

        const content = tplApagar.content.firstElementChild.cloneNode(true);

        window.modal.open({
            title: "Apagar mapa",
            size: "sm",
            html: content,

            onMount: (body, manager) => {
                const form = body.querySelector("form");
                form.action = urlDoMapa(grid.dataset.urlApagar, mapa.pk);
                body.querySelector("[data-apagar-nome]").textContent = mapa.nome;
                body.querySelector("[data-modal-cancelar]")?.addEventListener("click", () => manager.close());
                impedirEnvioDuplo(form);
            },
        });
    }

    /* ---------- eventos ---------- */

    document.getElementById("btn-novo-mapa")?.addEventListener("click", () => abrirFormulario());

    grid.addEventListener("click", (e) => {
        const card = e.target.closest(".mapa-card-existente");
        if (!card) return;

        if (e.target.closest("[data-editar-mapa]")) abrirFormulario(dadosDoCard(card));
        else if (e.target.closest("[data-apagar-mapa]")) abrirApagar(dadosDoCard(card));
    });

    // O botão voltou do cache (bfcache): reabilita os envios
    window.addEventListener("pageshow", () => {
        grid.querySelectorAll('[type="submit"][disabled]').forEach((b) => {
            if (!b.hasAttribute("title")) b.removeAttribute("disabled");   // não reabilita "Publicar" bloqueado
        });
    });

    // Reabre o modal de criação se o Django devolveu erros de validação
    if (tplForm.dataset.openOnLoad === "true") abrirFormulario();
});