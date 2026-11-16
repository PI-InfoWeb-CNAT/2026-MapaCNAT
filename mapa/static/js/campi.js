/* campi.js: busca instantânea, filtro por estado e atalhos do hub público.
   Sem JS, o formulário GET continua funcionando (a view filtra). */
(function () {
    'use strict';

    var form = document.getElementById('hub-form');
    var busca = document.getElementById('hub-busca');
    var estado = document.getElementById('hub-estado');
    var grid = document.getElementById('hub-grid');
    var contagem = document.getElementById('hub-contagem');
    var semResultados = document.getElementById('hub-sem-resultados');
    var limpar = document.getElementById('hub-limpar');
    var limparVazio = document.getElementById('hub-limpar-vazio');

    if (!form || !busca || !estado || !grid) return;

    document.querySelector('.hub-publico').classList.add('hub-js');
    estado.removeAttribute('onchange');

    var cards = Array.prototype.slice.call(grid.querySelectorAll('[data-nome]'));
    var total = cards.length;

    // ignora acentos e maiúsculas: "Natal" encontra "natál"
    function normalizar(s) {
        return (s || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();
    }

    cards.forEach(function (c) {
        c._chave = normalizar(c.dataset.nome);
    });

    // mapas em manutenção vão para o fim; dentro de cada grupo, ordem alfabética
    function ordenar() {
        var lista = cards.slice();
        lista.sort(function (a, b) {
            var dm = (a.dataset.estado === 'manutencao' ? 1 : 0) -
                     (b.dataset.estado === 'manutencao' ? 1 : 0);
            if (dm) return dm;
            return a._chave.localeCompare(b._chave, 'pt');
        });
        lista.forEach(function (c) { grid.appendChild(c); });
    }

    function atualizar() {
        var termo = normalizar(busca.value);
        var filtro = estado.value;               // todos | publico | manutencao
        var filtrando = !!termo || filtro !== 'todos';
        var visiveis = 0;

        cards.forEach(function (c) {
            var okNome = !termo || c._chave.indexOf(termo) !== -1;
            var okEstado = filtro === 'todos' || c.dataset.estado === filtro;
            var mostrar = okNome && okEstado;
            c.hidden = !mostrar;
            if (mostrar) visiveis++;
        });

        ordenar();

        if (total === 0) {
            contagem.textContent = '';
        } else if (filtrando) {
            contagem.textContent = visiveis + ' de ' + total + ' mapa' + (total === 1 ? '' : 's');
        } else {
            contagem.textContent = total + ' mapa' + (total === 1 ? '' : 's');
        }

        if (semResultados) semResultados.hidden = !(total > 0 && visiveis === 0);
        if (limpar) limpar.hidden = !busca.value;

        // mantém a URL compartilhável sem recarregar a página
        var params = new URLSearchParams();
        if (busca.value.trim()) params.set('nome', busca.value.trim());
        if (filtro !== 'todos') params.set('estado', filtro);
        var qs = params.toString();
        history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
    }

    // limpa só a pesquisa (botão X e Esc)
    function limparBusca() {
        busca.value = '';
        atualizar();
        busca.focus();
    }

    // limpa pesquisa E filtro (botão "Ver todos os mapas")
    function verTodos() {
        busca.value = '';
        estado.value = 'todos';
        atualizar();
        busca.focus();
    }

    busca.addEventListener('input', atualizar);
    estado.addEventListener('change', atualizar);
    form.addEventListener('submit', function (e) { e.preventDefault(); });
    if (limpar) limpar.addEventListener('click', limparBusca);
    if (limparVazio) limparVazio.addEventListener('click', verTodos);

    // "/" foca a busca; Esc limpa a pesquisa
    document.addEventListener('keydown', function (e) {
        var alvo = e.target;
        var digitando = alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' ||
                                 alvo.tagName === 'SELECT' || alvo.isContentEditable);
        if (e.key === '/' && !digitando && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            busca.focus();
            busca.select();
        } else if (e.key === 'Escape' && alvo === busca && busca.value) {
            limparBusca();
        }
    });

    // Enter na busca abre o mapa se só sobrou um resultado aberto
    busca.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        var abertos = cards.filter(function (c) { return !c.hidden && c.href; });
        if (abertos.length === 1) abertos[0].click();
    });

    atualizar();
})();