/* ==========================================================================
   landmarker.js

   Marca 3 pontos correspondentes em um mapa geográfico (Leaflet) e no SVG
   do mapa, e calcula a transformação afim SVG -> coordenadas geográficas:

       lng = a·x + b·y + c
       lat = d·x + e·y + f

   Valor salvo no <input type="hidden" data-lm-input> (JSON), sempre com
   3 entradas quando há alguma marcação (vazio quando não há nenhuma):
   [
     { "svg": [x, y] | null,     // unidades do viewBox do SVG
       "geo": [lat, lng] | null } × 3
   ]
   O campo `coordinates` do modelo guarda essa lista; a matriz afim é
   recalculada no servidor.

   Uso:  const lm = Landmarker.mount(elementoRaiz, { svgUrl });
         lm.setSvg(file, { resetar: true });   // File/Blob ou URL
   ========================================================================== */

(() => {
    'use strict';

    const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    const ESRI_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
    const CENTRO_PADRAO = [-5.795, -35.209];   // Natal/RN
    const ZOOM_MAX_SVG = 40;

    /* ----------------------------------------------------------------------
       Matemática
       ---------------------------------------------------------------------- */

    // Seno do ângulo do triângulo no 1º vértice: ~0 quando os pontos estão alinhados.
    function seno(t) {
        const [p1, p2, p3] = t;
        const D = (p2[0] - p1[0]) * (p3[1] - p1[1]) - (p3[0] - p1[0]) * (p2[1] - p1[1]);
        return Math.abs(D) / (
            Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) *
            Math.hypot(p3[0] - p1[0], p3[1] - p1[1])
        );
    }

    // pontos: [{ svg:[x,y], geo:[lat,lng] }] × 3  ->  [a,b,c,d,e,f] ou null
    function resolverAfim(p) {
        const [x1, y1] = p[0].svg, [x2, y2] = p[1].svg, [x3, y3] = p[2].svg;
        const D = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1);
        if (!Number.isFinite(D) || Math.abs(D) < 1e-9) return null;

        const resolver = (u1, u2, u3) => {
            const a = ((u2 - u1) * (y3 - y1) - (u3 - u1) * (y2 - y1)) / D;
            const b = ((x2 - x1) * (u3 - u1) - (x3 - x1) * (u2 - u1)) / D;
            return [a, b, u1 - a * x1 - b * y1];
        };

        const [a, b, c] = resolver(p[0].geo[1], p[1].geo[1], p[2].geo[1]);   // lng
        const [d, e, f] = resolver(p[0].geo[0], p[1].geo[0], p[2].geo[0]);   // lat
        return [a, b, c, d, e, f];
    }

    // Escala (m/px), rotação e espelhamento: serve de "teste de sanidade" para o usuário.
    function diagnostico(m, lat0) {
        const [a, b, , d, e] = m;
        const kLng = 111320 * Math.cos(lat0 * Math.PI / 180);
        const kLat = 110540;
        return {
            sx: Math.hypot(a * kLng, d * kLat),
            sy: Math.hypot(b * kLng, e * kLat),
            rot: Math.atan2(d * kLat, a * kLng) * 180 / Math.PI,
            // com y do SVG crescendo para baixo, um mapa normal tem determinante negativo
            espelhado: (a * kLng) * (e * kLat) - (b * kLng) * (d * kLat) > 0,
        };
    }

    const fmt = (n) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    const valido = (v) => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite);

    function lerViewBox(texto) {
        const doc = new DOMParser().parseFromString(texto, 'image/svg+xml');
        const el = doc.documentElement;
        if (!el || el.localName !== 'svg' || doc.querySelector('parsererror')) return null;

        const v = (el.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
        if (v.length === 4 && v.every(Number.isFinite) && v[2] > 0 && v[3] > 0) {
            return { x: v[0], y: v[1], w: v[2], h: v[3] };
        }

        const w = parseFloat(el.getAttribute('width'));
        const h = parseFloat(el.getAttribute('height'));
        return w > 0 && h > 0 ? { x: 0, y: 0, w, h } : null;
    }


    /* ----------------------------------------------------------------------
       Componente
       ---------------------------------------------------------------------- */

    function mount(root, opcoes = {}) {
        const q = (s) => root.querySelector(s);
        const input = q('[data-lm-input]');
        const slotsEl = q('[data-lm-slots]');
        const geoEl = q('[data-lm-geo]');
        const vp = q('[data-lm-svg]');
        const stage = q('[data-lm-stage]');
        const img = q('[data-lm-img]');
        const vazio = q('[data-lm-vazio]');
        const statusEl = q('[data-lm-status]');
        const erroEl = q('[data-lm-erro]');

        const pts = [0, 1, 2].map(() => ({ svg: null, geo: null }));
        let ativo = 0;
        let vb = null;
        let view = { s: 1, tx: 0, ty: 0 };
        let fitS = 1;
        let usuarioMexeu = false;
        let urlAtual = null;
        let avisoTemp = '';
        let map = null;
        const marcadores = [];

        /* ---- valor inicial ------------------------------------------------ */
        try {
            const salvo = JSON.parse(input.value || 'null');
            (Array.isArray(salvo) ? salvo : []).slice(0, 3).forEach((p, i) => {
                if (valido(p?.svg)) pts[i].svg = p.svg;
                if (valido(p?.geo)) pts[i].geo = p.geo;
            });
        } catch { /* valor corrompido: começa vazio */ }

        /* ---- lista de pontos --------------------------------------------- */
        const slots = pts.map((_, i) => {
            const li = document.createElement('li');
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'lm-slot';
            b.innerHTML =
                `<span class="lm-num">${i + 1}</span>` +
                `<span>Ponto ${i + 1}</span>` +
                `<span class="lm-chip" data-s>SVG</span>` +
                `<span class="lm-chip" data-g>Mapa</span>`;
            b.addEventListener('click', () => { ativo = i; atualizar(); });
            li.append(b);
            slotsEl.append(li);
            return b;
        });

        /* ---- estado -> interface ----------------------------------------- */
        function calcular() {
            if (!pts.every((p) => p.svg && p.geo)) return { m: null };

            const sv = seno(pts.map((p) => p.svg));
            const ge = seno(pts.map((p) => p.geo));
            if (!(sv > 0.02) || !(ge > 0.02)) return { m: null, alinhado: true };

            const m = resolverAfim(pts);
            if (!m) return { m: null, alinhado: true };

            return {
                m,
                estreito: sv < 0.2 || ge < 0.2,
                diag: diagnostico(m, pts[0].geo[0]),
            };
        }

        function textoStatus(res) {
            if (avisoTemp) {
                const t = avisoTemp;
                avisoTemp = '';
                return [t, ''];
            }
            if (!pts.some((p) => p.svg || p.geo)) {
                return ['Marque o ponto 1 clicando no SVG e no mapa geográfico. Repita para os pontos 2 e 3.', ''];
            }
            if (res.alinhado) {
                return ['Os pontos estão alinhados. Escolha pontos bem espalhados, formando um triângulo.', 'is-erro'];
            }
            if (res.m) {
                const d = res.diag;
                const av = [];
                if (d.espelhado) av.push('o mapa ficou espelhado, confira a ordem dos pontos');
                if (Math.abs(d.sx - d.sy) / Math.max(d.sx, d.sy) > 0.15) av.push('a escala difere entre os eixos');
                if (res.estreito) av.push('triângulo estreito reduz a precisão');
                const base = `Transformação calculada · ≈ ${fmt(d.sx)} m/px · rotação ${fmt(d.rot)}°`;
                return av.length
                    ? [`${base}. Atenção: ${av.join('; ')}.`, '']
                    : [base, 'is-ok'];
            }
            const faltas = [];
            pts.forEach((p, i) => {
                const f = [];
                if (!p.svg) f.push('no SVG');
                if (!p.geo) f.push('no mapa');
                if (f.length) faltas.push(`ponto ${i + 1} ${f.join(' e ')}`);
            });
            return [`Falta marcar: ${faltas.join('; ')}.`, ''];
        }

        function salvar(res) {
            if (!pts.some((p) => p.svg || p.geo)) {
                input.value = '';
            } else {
                const r2 = (n) => Math.round(n * 100) / 100;
                const r7 = (n) => Math.round(n * 1e7) / 1e7;
                input.value = JSON.stringify(pts.map((p) => ({
                    svg: p.svg ? p.svg.map(r2) : null,
                    geo: p.geo ? p.geo.map(r7) : null,
                })));
            }
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }

        function renderSlots() {
            slots.forEach((b, i) => {
                const p = pts[i];
                b.classList.toggle('is-ativo', i === ativo);
                b.classList.toggle('is-completo', !!(p.svg && p.geo));
                b.setAttribute('aria-pressed', String(i === ativo));
                b.querySelector('[data-s]').classList.toggle('is-ok', !!p.svg);
                b.querySelector('[data-g]').classList.toggle('is-ok', !!p.geo);
            });
        }

        function renderSvgPins() {
            stage.querySelectorAll('.lm-pin').forEach((n) => n.remove());
            if (!vb) return;
            pts.forEach((p, i) => {
                if (!p.svg) return;
                const el = document.createElement('div');
                el.className = 'lm-pin' + (i === ativo ? ' is-ativo' : '');
                el.style.left = `${p.svg[0] - vb.x}px`;
                el.style.top = `${p.svg[1] - vb.y}px`;
                el.innerHTML = `<span class="lm-dot">${i + 1}</span>`;
                stage.append(el);
            });
        }

        function renderGeoPins() {
            if (!map) return;
            pts.forEach((p, i) => {
                let m = marcadores[i];
                if (!p.geo) {
                    if (m) { map.removeLayer(m); marcadores[i] = null; }
                    return;
                }
                const icone = L.divIcon({
                    className: 'lm-geo-pin' + (i === ativo ? ' is-ativo' : ''),
                    html: `<span class="lm-dot">${i + 1}</span>`,
                    iconSize: [26, 26],
                    iconAnchor: [13, 13],
                });
                if (!m) {
                    m = L.marker(p.geo, { icon: icone, draggable: true, keyboard: false }).addTo(map);
                    m.on('dragend', () => {
                        const ll = m.getLatLng();
                        pts[i].geo = [ll.lat, ll.lng];
                        ativo = i;
                        atualizar();
                    });
                    marcadores[i] = m;
                } else {
                    m.setLatLng(p.geo);
                    m.setIcon(icone);
                }
            });
        }

        function atualizar() {
            const res = calcular();
            const [texto, classe] = textoStatus(res);
            statusEl.textContent = texto;
            statusEl.className = 'lm-status ' + classe;
            renderSlots();
            renderSvgPins();
            renderGeoPins();
            salvar(res);
        }

        // depois de completar um ponto, seleciona o próximo que ainda falta
        function avancar() {
            if (!(pts[ativo].svg && pts[ativo].geo)) return;
            const prox = [1, 2, 3].map((k) => (ativo + k) % 3)
                .find((i) => !pts[i].svg || !pts[i].geo);
            if (prox !== undefined) ativo = prox;
        }


        /* ---- mapa geográfico (Leaflet) ----------------------------------- */
        function iniciarMapa() {
            if (!window.L) {
                geoEl.innerHTML = '<p class="lm-vazio">Não foi possível carregar o mapa geográfico.</p>';
                return;
            }

            map = L.map(geoEl).setView(CENTRO_PADRAO, 13);

            // O OpenStreetMap exige o cabeçalho Referer (política de uso dos tiles). O Django envia
            // "same-origin" por padrão, o que o remove nas requisições externas; este atributo
            // reenvia só a origem do site (https://seusite.com) para os servidores de tiles.
            const referrerPolicy = 'strict-origin-when-cross-origin';
            const osm = L.tileLayer(OSM_URL, { maxZoom: 19, attribution: '© OpenStreetMap', referrerPolicy });
            const sat = L.tileLayer(ESRI_URL, { maxZoom: 19, attribution: 'Imagens © Esri', referrerPolicy });

            let avisouTile = false;
            osm.on('tileerror', () => {
                if (avisouTile) return;
                avisouTile = true;
                erroEl.textContent = 'O servidor do mapa recusou algumas imagens. Tente a camada Satélite (ícone no canto do mapa).';
            });
            osm.addTo(map);
            L.control.layers({ 'Mapa': osm, 'Satélite': sat }, null, { collapsed: true }).addTo(map);

            map.on('click', (e) => {
                pts[ativo].geo = [e.latlng.lat, e.latlng.lng];
                avancar();
                atualizar();
            });

            // O modal abre com tamanho 0 por um instante: ajusta quando houver tamanho real.
            let ajustou = false;
            new ResizeObserver(() => {
                if (!geoEl.clientWidth || !geoEl.clientHeight) return;
                map.invalidateSize();
                if (!ajustou) {
                    ajustou = true;
                    const com = pts.filter((p) => p.geo).map((p) => p.geo);
                    if (com.length) map.fitBounds(L.latLngBounds(com).pad(0.5), { maxZoom: 18 });
                }
            }).observe(geoEl);
        }


        /* ---- explorador do SVG ------------------------------------------- */
        function aplicarView() {
            stage.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`;
            stage.style.setProperty('--inv', String(1 / view.s));
        }

        function ajustar() {
            if (!vb) return;
            const r = vp.getBoundingClientRect();
            if (!r.width || !r.height) return;
            fitS = Math.min(r.width / vb.w, r.height / vb.h) * 0.96;
            view = { s: fitS, tx: (r.width - vb.w * fitS) / 2, ty: (r.height - vb.h * fitS) / 2 };
            aplicarView();
        }

        function zoomEm(cx, cy, fator) {
            if (!vb) return;
            const r = vp.getBoundingClientRect();
            const px = cx - r.left;
            const py = cy - r.top;
            const ns = Math.min(ZOOM_MAX_SVG, Math.max(fitS * 0.5, view.s * fator));
            const k = ns / view.s;
            view = { s: ns, tx: px - (px - view.tx) * k, ty: py - (py - view.ty) * k };
            usuarioMexeu = true;
            aplicarView();
        }

        function colocarNoSvg(e) {
            if (!vb) return;
            const r = vp.getBoundingClientRect();
            const x = (e.clientX - r.left - view.tx) / view.s;
            const y = (e.clientY - r.top - view.ty) / view.s;
            if (x < 0 || y < 0 || x > vb.w || y > vb.h) return;
            pts[ativo].svg = [vb.x + x, vb.y + y];
            avancar();
            atualizar();
        }

        let arraste = null;
        vp.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || !vb) return;
            vp.setPointerCapture(e.pointerId);
            arraste = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moveu: false };
        });
        vp.addEventListener('pointermove', (e) => {
            if (!arraste) return;
            const dx = e.clientX - arraste.x;
            const dy = e.clientY - arraste.y;
            if (!arraste.moveu && Math.hypot(dx, dy) < 4) return;   // abaixo disso é clique
            arraste.moveu = true;
            usuarioMexeu = true;
            vp.classList.add('is-arrastando');
            view.tx = arraste.tx + dx;
            view.ty = arraste.ty + dy;
            aplicarView();
        });
        vp.addEventListener('pointerup', (e) => {
            if (arraste && !arraste.moveu) colocarNoSvg(e);
            arraste = null;
            vp.classList.remove('is-arrastando');
        });
        vp.addEventListener('pointercancel', () => {
            arraste = null;
            vp.classList.remove('is-arrastando');
        });
        vp.addEventListener('wheel', (e) => {
            e.preventDefault();
            zoomEm(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
        }, { passive: false });

        vp.addEventListener('keydown', (e) => {
            const passo = 40;
            const mapa = { ArrowLeft: [passo, 0], ArrowRight: [-passo, 0], ArrowUp: [0, passo], ArrowDown: [0, -passo] };
            if (mapa[e.key]) {
                e.preventDefault();
                view.tx += mapa[e.key][0];
                view.ty += mapa[e.key][1];
                usuarioMexeu = true;
                aplicarView();
            } else if (e.key === '+' || e.key === '=' || e.key === '-') {
                e.preventDefault();
                const r = vp.getBoundingClientRect();
                zoomEm(r.left + r.width / 2, r.top + r.height / 2, e.key === '-' ? 1 / 1.3 : 1.3);
            }
        });

        root.querySelectorAll('[data-lm-zoom]').forEach((b) => {
            b.addEventListener('click', () => {
                const r = vp.getBoundingClientRect();
                const cx = r.left + r.width / 2;
                const cy = r.top + r.height / 2;
                const acao = b.dataset.lmZoom;
                if (acao === 'ajustar') { usuarioMexeu = false; ajustar(); }
                else zoomEm(cx, cy, acao === '+' ? 1.5 : 1 / 1.5);
            });
        });

        new ResizeObserver(() => { if (!usuarioMexeu) ajustar(); }).observe(vp);


        /* ---- carregar o SVG ---------------------------------------------- */
        function limparSvg() {
            vb = null;
            img.removeAttribute('src');
            vazio.hidden = false;
            if (urlAtual) { URL.revokeObjectURL(urlAtual); urlAtual = null; }
            atualizar();
        }

        // fonte: File/Blob (arquivo escolhido) ou string (URL do SVG já salvo)
        async function setSvg(fonte, { resetar = false } = {}) {
            erroEl.textContent = '';
            if (!fonte) { limparSvg(); return; }

            try {
                let texto;
                if (fonte instanceof Blob) {
                    texto = await fonte.text();
                } else {
                    const resp = await fetch(fonte, { credentials: 'same-origin' });
                    if (!resp.ok) throw new Error('Não foi possível carregar o SVG atual.');
                    texto = await resp.text();
                }

                const novo = lerViewBox(texto);
                if (!novo) throw new Error('O SVG precisa ter viewBox ou width/height definidos.');

                const trocou = resetar && pts.some((p) => p.svg);
                if (trocou) {
                    pts.forEach((p) => { p.svg = null; });
                    avisoTemp = 'SVG trocado: refaça as marcações no SVG (os pontos do mapa geográfico foram mantidos).';
                }

                if (urlAtual) URL.revokeObjectURL(urlAtual);
                urlAtual = URL.createObjectURL(new Blob([texto], { type: 'image/svg+xml' }));

                vb = novo;
                img.style.width = `${vb.w}px`;
                img.style.height = `${vb.h}px`;
                stage.style.width = `${vb.w}px`;
                stage.style.height = `${vb.h}px`;
                img.src = urlAtual;
                vazio.hidden = true;
                usuarioMexeu = false;
                ajustar();
                atualizar();
            } catch (err) {
                erroEl.textContent = err.message || 'Não foi possível ler o SVG.';
                limparSvg();
            }
        }

        img.addEventListener('error', () => {
            erroEl.textContent = 'O navegador não conseguiu desenhar esse SVG.';
        });


        /* ---- botões ------------------------------------------------------ */
        q('[data-lm-limpar]')?.addEventListener('click', () => {
            pts[ativo] = { svg: null, geo: null };
            atualizar();
        });
        q('[data-lm-limpar-todos]')?.addEventListener('click', () => {
            pts.forEach((p) => { p.svg = null; p.geo = null; });
            ativo = 0;
            atualizar();
        });


        /* ---- início ------------------------------------------------------ */
        iniciarMapa();
        atualizar();
        if (opcoes.svgUrl) setSvg(opcoes.svgUrl);

        return { setSvg };
    }

    window.Landmarker = { mount, resolverAfim };
})();