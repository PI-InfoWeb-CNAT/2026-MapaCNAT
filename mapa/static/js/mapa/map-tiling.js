const IS_MOBILE = matchMedia("(pointer: coarse)").matches;

const TILE_PX = 512;
const PAD_PX = 1;
const SETTLE_MS = 90;
const FRAME_BUDGET_MS = 8;
const FADE_MS = 180;

// Perfil do dispositivo: mobile troca nitidez marginal por memória.
const BASE_MAX_PX = IS_MOBILE ? 1536 : 2048;
const LEVEL_BIAS = IS_MOBILE ? 0.6 : 0.35;
const PRELOAD_RING = !IS_MOBILE;
const DEFAULT_MAX_TILES = IS_MOBILE ? 60 : 256;
const DEFAULT_MAX_BYTES = (IS_MOBILE ? 80 : 256) * 1024 * 1024;
const DEFAULT_TTL_MS = IS_MOBILE ? 2500 : 6000;

// Cada tile ocupa memória duas vezes: canvas (CPU) + textura (GPU).
const BYTES_PER_PX = 4 * 2;

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

export class SvgTileEngine {
    constructor({
        PIXI = globalThis.PIXI,
        container,
        svgUrl,
        background = "#ffffff",
        getScreenSize,
        getZoomRange,
        onUpdate,
        maxDpr = 2, // use o mesmo teto de `resolution` do renderer
        maxTextureSize = 4096,
        maxTiles = DEFAULT_MAX_TILES,
        maxBytes = DEFAULT_MAX_BYTES,
        tileTtlMs = DEFAULT_TTL_MS,
    }) {
        this.PIXI = PIXI;
        this.container = container;
        this.svgUrl = svgUrl;
        this.getScreenSize = getScreenSize;
        this.getZoomRange = getZoomRange;
        this.onUpdate = onUpdate;
        this.maxDpr = maxDpr;
        this.maxTextureSize = maxTextureSize;
        this.maxTiles = maxTiles;
        this.maxBytes = maxBytes;
        this.tileTtlMs = tileTtlMs;

        const color = new PIXI.Color(background);
        this.bgCss = color.toHex();
        this.bgNumber = color.toNumber();

        this.width = 0;
        this.height = 0;
        this.baseScale = 1;

        this.tiles = new Map(); // key -> registro do tile
        this._bytes = 0;
        this._queue = [];
        this._wantedKeys = new Set();
        this._target = 0;

        this._images = new Map(); // variante -> HTMLImageElement pronto
        this._imagePromises = new Map(); // variante -> Promise
        this._blobUrls = [];

        this._lastChange = 0;
        this._updateQueued = false;
        this._pumpPending = false;
        this._fading = new Set();
        this._fadeRaf = 0;
        this._gcTimer = 0;
        this._destroyed = false;
    }

    /* ------------------------------------------------------------------ */
    /* Inicialização em duas fases: load() descobre o tamanho; start()    */
    /* monta a camada base (precisa do minZoom, que depende do tamanho).  */
    /* ------------------------------------------------------------------ */

    async load() {
        const res = await fetch(this.svgUrl);
        if (!res.ok) throw new Error(`Falha ao carregar o SVG do mapa (HTTP ${res.status})`);
        this._parse(await res.text());
        return { width: this.width, height: this.height };
    }

    async start() {
        const { PIXI } = this;

        this.layer = new PIXI.Container();
        this.tileLayer = new PIXI.Container();
        this.tileLayer.sortableChildren = true; // níveis maiores desenham por cima

        await this._buildBase();

        this.overlay = new PIXI.Graphics()
            .rect(-this.width / 2, -this.height / 2, this.width, this.height)
            .fill({ color: this.bgNumber, alpha: 0.5 });
        this.overlay.visible = false;

        this.layer.addChild(this.baseSprite, this.tileLayer, this.overlay);
        this.container.addChildAt(this.layer, 0);

        this._gcTimer = setInterval(() => this._gc(), 2000);
        this.requestUpdate();
    }

    /**
     * Recria base e tiles do zero. Chame após `webglcontextrestored`.
     */
    async rebuild() {
        if (this._destroyed || !this.layer) return;

        for (const t of [...this.tiles.values()]) this._destroyTile(t);
        this._queue = [];
        this._wantedKeys = new Set();

        this.layer.removeChild(this.baseSprite);
        this.baseSprite.destroy({ texture: true, textureSource: true });
        await this._buildBase();
        if (this._destroyed) return;

        this.layer.addChildAt(this.baseSprite, 0);
        this.requestUpdate();
        this.onUpdate?.();
    }

    _parse(text) {
        const doc = new DOMParser().parseFromString(text, "image/svg+xml");
        if (doc.querySelector("parsererror")) throw new Error("SVG do mapa inválido");
        const root = doc.documentElement;

        const num = (v) => (v && !/%$/.test(v.trim()) ? parseFloat(v) : NaN);
        let w = num(root.getAttribute("width"));
        let h = num(root.getAttribute("height"));
        const vb = (root.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
        const hasVB = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0;

        // Preferimos width/height (é o que o Pixi usava como tamanho intrínseco),
        // para não mudar o sistema de coordenadas dos seus dados.
        if (!(w > 0 && h > 0)) {
            if (!hasVB) throw new Error("SVG sem width/height nem viewBox");
            w = vb[2];
            h = vb[3];
        }
        if (!hasVB) root.setAttribute("viewBox", `0 0 ${w} ${h}`);
        root.setAttribute("width", String(w));
        root.setAttribute("height", String(h));

        this.width = w;
        this.height = h;
        this.doc = doc;
        this.svgText = new XMLSerializer().serializeToString(doc);
        this.thresholds = [
            ...new Set(
                [...doc.querySelectorAll("[data-min-zoom]")]
                    .map((e) => parseFloat(e.getAttribute("data-min-zoom")))
                    .filter(Number.isFinite),
            ),
        ].sort((a, b) => a - b);
    }

    /* ------------------------------------------------------------------ */
    /* Variantes do SVG por LOD de conteúdo                               */
    /* ------------------------------------------------------------------ */

    /** DPR efetivo: nunca acima do que o renderer realmente desenha. */
    _dpr() {
        return Math.min(window.devicePixelRatio || 1, this.maxDpr);
    }

    _variantFor(zoomEq) {
        let idx = 0;
        for (const t of this.thresholds) if (t <= zoomEq + 1e-6) idx++;
        return idx;
    }

    _levelVariant(level) {
        return this._variantFor(2 ** level / this._dpr());
    }

    _ensureVariant(idx) {
        let p = this._imagePromises.get(idx);
        if (p) return p;

        let svg = this.svgText;
        if (this.thresholds.length) {
            const keepMax = idx === 0 ? -Infinity : this.thresholds[idx - 1];
            const clone = this.doc.cloneNode(true);
            for (const el of clone.querySelectorAll("[data-min-zoom]")) {
                if (parseFloat(el.getAttribute("data-min-zoom")) > keepMax) el.remove();
            }
            svg = new XMLSerializer().serializeToString(clone);
        }

        const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        this._blobUrls.push(url);

        p = new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                this._images.set(idx, img);
                resolve(img);
            };
            img.onerror = () => reject(new Error("Falha ao decodificar o SVG do mapa"));
            img.src = url;
        });
        this._imagePromises.set(idx, p);
        return p;
    }

    /* ------------------------------------------------------------------ */
    /* Rasterização                                                       */
    /* ------------------------------------------------------------------ */

    _rasterize(img, x0, y0, wPx, hPx, scale) {
        const canvas = document.createElement("canvas");
        canvas.width = wPx;
        canvas.height = hPx;
        const ctx = canvas.getContext("2d");
        // Fundo opaco: tiles sobrepostos não somam transparência.
        ctx.fillStyle = this.bgCss;
        ctx.fillRect(0, 0, wPx, hPx);
        ctx.imageSmoothingQuality = "high";
        ctx.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale);
        ctx.drawImage(img, 0, 0, this.width, this.height);
        return canvas;
    }

    async _buildBase() {
        const { PIXI } = this;
        const maxSide = Math.max(this.width, this.height);
        const px = Math.min(BASE_MAX_PX, this.maxTextureSize);
        this.baseScale = Math.min(px / maxSide, 2);
        this.minLevel = Math.floor(Math.log2(this.baseScale)) + 1;

        const { min } = this.getZoomRange();
        const img = await this._ensureVariant(this._variantFor(min || 0));

        const canvas = this._rasterize(
            img,
            0,
            0,
            Math.ceil(this.width * this.baseScale),
            Math.ceil(this.height * this.baseScale),
            this.baseScale,
        );
        this.baseSprite = new PIXI.Sprite(PIXI.Texture.from(canvas, true));
        this.baseSprite.anchor.set(0.5);
        this.baseSprite.width = this.width;
        this.baseSprite.height = this.height;
    }

    /* ------------------------------------------------------------------ */
    /* Atualização da vista                                               */
    /* ------------------------------------------------------------------ */

    /** Chame sempre que zoom, posição, rotação ou tamanho da tela mudarem. */
    requestUpdate() {
        this._lastChange = performance.now();
        if (this._updateQueued || this._destroyed || !this.layer) return;
        this._updateQueued = true;
        requestAnimationFrame(() => {
            this._updateQueued = false;
            this._update();
        });
    }

    setDimmed(value, alpha = 0.5) {
        if (!this.overlay) return;
        this.overlay.visible = !!value;
        this.overlay.alpha = alpha / 0.5; // o fill já tem alpha 0.5
    }

    _viewBounds() {
        const c = this.container;
        const { width, height } = this.getScreenSize();
        const z = c.scale.x || 1;
        const cos = Math.cos(-c.rotation);
        const sin = Math.sin(-c.rotation);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [sx, sy] of [[0, 0], [width, 0], [0, height], [width, height]]) {
            const dx = sx - c.x;
            const dy = sy - c.y;
            const wx = (dx * cos - dy * sin) / z + this.width / 2;
            const wy = (dx * sin + dy * cos) / z + this.height / 2;
            minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
            minY = Math.min(minY, wy); maxY = Math.max(maxY, wy);
        }
        return { minX, minY, maxX, maxY };
    }

    _grid(level) {
        const s = 2 ** level;
        const tw = TILE_PX / s;
        return {
            s,
            tw,
            cols: Math.ceil((this.width * s) / TILE_PX),
            rows: Math.ceil((this.height * s) / TILE_PX),
        };
    }

    _collect(level, b, prio, out, seen, center) {
        if (b.maxX < 0 || b.minX > this.width || b.maxY < 0 || b.minY > this.height) return;
        const { tw, cols, rows } = this._grid(level);
        const tx0 = clamp(Math.floor(b.minX / tw), 0, cols - 1);
        const tx1 = clamp(Math.floor(b.maxX / tw), 0, cols - 1);
        const ty0 = clamp(Math.floor(b.minY / tw), 0, rows - 1);
        const ty1 = clamp(Math.floor(b.maxY / tw), 0, rows - 1);
        for (let ty = ty0; ty <= ty1; ty++) {
            for (let tx = tx0; tx <= tx1; tx++) {
                const key = `${level}/${tx}/${ty}`;
                if (seen.has(key)) continue;
                seen.add(key);
                const dx = (tx + 0.5) * tw - center.x;
                const dy = (ty + 0.5) * tw - center.y;
                out.push({ key, level, tx, ty, prio, dist: dx * dx + dy * dy });
            }
        }
    }

    _update() {
        if (this._destroyed) return;
        const now = performance.now();
        const zoom = this.container.scale.x || 1;
        const needed = zoom * this._dpr();
        const { max } = this.getZoomRange();
        const maxLevel = Math.max(this.minLevel, Math.ceil(Math.log2((max || 1) * this._dpr())));

        const view = this._viewBounds();
        const center = { x: (view.minX + view.maxX) / 2, y: (view.minY + view.maxY) / 2 };

        const wanted = [];
        const seen = new Set();
        let target = this.minLevel - 1; // "nenhum": só a base basta

        if (needed > this.baseScale * 1.2) {
            target = clamp(Math.ceil(Math.log2(needed) - LEVEL_BIAS), this.minLevel, maxLevel);

            // P0: tiles em foco, na qualidade alvo.
            this._collect(target, view, 0, wanted, seen, center);

            // P1 (só desktop): anel ao redor em nível mais baixo, para quando o usuário arrastar.
            if (PRELOAD_RING) {
                const ringLevel = target - 1 >= this.minLevel ? target - 1 : target;
                const m = this._grid(ringLevel).tw;
                const ring = {
                    minX: view.minX - m, maxX: view.maxX + m,
                    minY: view.minY - m, maxY: view.maxY + m,
                };
                this._collect(ringLevel, ring, 1, wanted, seen, center);
            }
        }
        this._target = target;

        wanted.sort((a, b) => a.prio - b.prio || a.dist - b.dist);
        this._wantedKeys = new Set(wanted.map((w) => w.key));

        // Visibilidade + "mantém vivo" os tiles que estão servindo na vista atual.
        for (const t of this.tiles.values()) {
            const inView =
                t.x1 >= view.minX && t.x0 <= view.maxX && t.y1 >= view.minY && t.y0 <= view.maxY;
            t.sprite.visible = inView;
            if (this._wantedKeys.has(t.key) || (inView && t.level <= target + 1)) t.lastUsed = now;
        }

        // Jobs: só o que falta; o que saiu da vista é descartado da fila.
        this._queue = wanted.filter((w) => !this.tiles.has(w.key));
        if (this._queue.length) this._schedulePump();
        this._gc();
    }

    /* ------------------------------------------------------------------ */
    /* Fila em segundo plano (fatiada por frame)                          */
    /* ------------------------------------------------------------------ */

    _schedulePump() {
        if (this._pumpPending || this._destroyed) return;
        this._pumpPending = true;
        const wait = Math.max(0, SETTLE_MS - (performance.now() - this._lastChange));
        setTimeout(() => {
            requestAnimationFrame(() => {
                this._pumpPending = false;
                this._pump();
            });
        }, wait);
    }

    _pump() {
        if (this._destroyed || !this._queue.length) return;
        if (performance.now() - this._lastChange < SETTLE_MS) {
            this._schedulePump();
            return;
        }

        const t0 = performance.now();
        const q = this._queue;
        let rendered = 0;
        let i = 0;

        while (i < q.length && (rendered === 0 || performance.now() - t0 < FRAME_BUDGET_MS)) {
            const job = q[i];
            if (this.tiles.has(job.key)) {
                q.splice(i, 1);
                continue;
            }
            const variant = this._levelVariant(job.level);
            const img = this._images.get(variant);
            if (!img) {
                // variante ainda não decodificada: dispara e segue para o próximo
                this._ensureVariant(variant)
                    .then(() => this._schedulePump())
                    .catch((e) => console.error(e));
                i++;
                continue;
            }
            q.splice(i, 1);
            this._createTile(job, img);
            rendered++;
        }

        if (rendered > 0 && q.length) this._schedulePump();
    }

    _createTile(job, img) {
        const { PIXI } = this;
        const { level, tx, ty, key } = job;
        const s = 2 ** level;
        const tw = TILE_PX / s;
        const x0 = tx * tw;
        const y0 = ty * tw;
        const wWorld = Math.min(tw, this.width - x0);
        const hWorld = Math.min(tw, this.height - y0);
        const wPx = Math.ceil(wWorld * s) + PAD_PX;
        const hPx = Math.ceil(hWorld * s) + PAD_PX;

        const canvas = this._rasterize(img, x0, y0, wPx, hPx, s);
        const texture = PIXI.Texture.from(canvas, true); // true = não guarda no cache global
        const sprite = new PIXI.Sprite(texture);
        sprite.x = x0 - this.width / 2;
        sprite.y = y0 - this.height / 2;
        sprite.width = wPx / s;
        sprite.height = hPx / s;
        sprite.zIndex = level;
        sprite.alpha = 0;
        this.tileLayer.addChild(sprite);

        const now = performance.now();
        const rec = {
            key, level, sprite, texture, canvas,
            x0, y0, x1: x0 + wPx / s, y1: y0 + hPx / s,
            bytes: wPx * hPx * BYTES_PER_PX,
            lastUsed: now, born: now, alpha: 0,
        };
        this.tiles.set(key, rec);
        this._bytes += rec.bytes;
        this._fading.add(rec);
        if (!this._fadeRaf) this._fadeRaf = requestAnimationFrame(this._fadeStep);

        // Uma rajada de tiles não pode esperar o próximo ciclo do GC para respeitar o orçamento.
        if (this._overBudget()) this._gc();
        this.onUpdate?.();
    }

    _fadeStep = () => {
        const now = performance.now();
        for (const t of this._fading) {
            const a = clamp((now - t.born) / FADE_MS, 0, 1);
            t.alpha = a;
            t.sprite.alpha = a;
            if (a >= 1) this._fading.delete(t);
        }
        this._fadeRaf = this._fading.size ? requestAnimationFrame(this._fadeStep) : 0;
        this.onUpdate?.();
    };

    /* ------------------------------------------------------------------ */
    /* Garbage collection                                                 */
    /* ------------------------------------------------------------------ */

    _overBudget() {
        return this.tiles.size > this.maxTiles || this._bytes > this.maxBytes;
    }

    _destroyTile(t) {
        this._fading.delete(t);
        this.tileLayer.removeChild(t.sprite);
        t.sprite.destroy();
        t.texture.destroy(true); // true = destrói também a source
        t.canvas.width = t.canvas.height = 0;
        this._bytes -= t.bytes;
        this.tiles.delete(t.key);
    }

    _gc() {
        if (this._destroyed) return;
        const now = performance.now();

        // 1) expirou e ninguém quer
        for (const t of [...this.tiles.values()]) {
            if (!this._wantedKeys.has(t.key) && now - t.lastUsed > this.tileTtlMs) this._destroyTile(t);
        }

        // 2) estourou o orçamento: remove os menos recentes que não são alvo
        if (this._overBudget()) {
            const victims = [...this.tiles.values()]
                .filter((t) => !this._wantedKeys.has(t.key))
                .sort((a, b) => a.lastUsed - b.lastUsed);
            for (const t of victims) {
                if (!this._overBudget()) break;
                this._destroyTile(t);
            }
        }
    }

    stats() {
        return {
            tiles: this.tiles.size,
            megabytes: +(this._bytes / 1048576).toFixed(1),
            queue: this._queue.length,
            targetLevel: this._target,
        };
    }

    destroy() {
        this._destroyed = true;
        clearInterval(this._gcTimer);
        cancelAnimationFrame(this._fadeRaf);
        for (const t of [...this.tiles.values()]) this._destroyTile(t);
        this.layer?.destroy({ children: true, texture: true, textureSource: true });
        for (const u of this._blobUrls) URL.revokeObjectURL(u);
        this._blobUrls = [];
        this._images.clear();
        this._imagePromises.clear();
    }
}