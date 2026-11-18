// Hash espacial uniforme. Guarda itens com uma caixa (um ponto é uma caixa de tamanho 0).
// Cada item ocupa as células que a caixa cobre; itens enormes vão para uma lista à parte.
const MAX_CELLS = 1024;
// chave numérica: sem alocar string. Vale para células em [-32768, 32767].
const key = (cx, cy) => (cx + 32768) * 65536 + (cy + 32768);

export class SpatialHash {
    constructor(cellSize = 128) {
        this.cellSize = cellSize;
        this._inv = 1 / cellSize;
        this._buckets = new Map();   // chave da célula -> Set<Entry>
        this._entries = new Map();   // item -> Entry
        this._big = new Set();       // entradas com mais de MAX_CELLS células
        this._seen = new Set();      // dedupe de consultas de retângulo
        this._multi = 0;             // quantas entradas ocupam mais de uma célula
    }

    get size() { return this._entries.size; }
    has(item) { return this._entries.has(item); }

    /** Insere o item ou atualiza a caixa dele. Só mexe nos buckets se as células mudarem. */
    set(item, minX, minY, maxX = minX, maxY = minY) {
        if (!(Number.isFinite(minX) && Number.isFinite(minY) &&
              Number.isFinite(maxX) && Number.isFinite(maxY))) {
            this.delete(item);
            return;
        }
        if (minX > maxX) [minX, maxX] = [maxX, minX];
        if (minY > maxY) [minY, maxY] = [maxY, minY];

        const inv = this._inv;
        const cx0 = Math.floor(minX * inv), cy0 = Math.floor(minY * inv);
        const cx1 = Math.floor(maxX * inv), cy1 = Math.floor(maxY * inv);

        let e = this._entries.get(item);
        if (e) {
            e.minX = minX; e.minY = minY; e.maxX = maxX; e.maxY = maxY;
            if (e.cx0 === cx0 && e.cy0 === cy0 && e.cx1 === cx1 && e.cy1 === cy1) return;
            this._unlink(e);
            e.cx0 = cx0; e.cy0 = cy0; e.cx1 = cx1; e.cy1 = cy1;
        } else {
            e = { item, minX, minY, maxX, maxY, cx0, cy0, cx1, cy1, big: false };
            this._entries.set(item, e);
        }
        this._link(e);
    }

    delete(item) {
        const e = this._entries.get(item);
        if (!e) return false;
        this._unlink(e);
        this._entries.delete(item);
        return true;
    }

    clear() {
        this._buckets.clear();
        this._entries.clear();
        this._big.clear();
        this._multi = 0;
    }

    /** Itens cuja caixa contém o ponto. Preenche e devolve `out`. */
    queryPoint(x, y, out = []) {
        out.length = 0;
        const bucket = this._buckets.get(key(Math.floor(x * this._inv), Math.floor(y * this._inv)));
        if (bucket) {
            for (const e of bucket) {
                if (x >= e.minX && x <= e.maxX && y >= e.minY && y <= e.maxY) out.push(e.item);
            }
        }
        for (const e of this._big) {
            if (x >= e.minX && x <= e.maxX && y >= e.minY && y <= e.maxY) out.push(e.item);
        }
        return out;
    }

    /** Itens cuja caixa intersecta o retângulo. Preenche e devolve `out`. */
    queryRect(minX, minY, maxX, maxY, out = []) {
        out.length = 0;
        const inv = this._inv;
        const cx0 = Math.floor(minX * inv), cx1 = Math.floor(maxX * inv);
        const cy0 = Math.floor(minY * inv), cy1 = Math.floor(maxY * inv);
        const cells = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);

        // retângulo grande (ou NaN): varrer as entradas sai mais barato que varrer as células
        if (!(cells <= this._entries.size)) {
            for (const e of this._entries.values()) {
                if (e.maxX >= minX && e.minX <= maxX && e.maxY >= minY && e.minY <= maxY) out.push(e.item);
            }
            return out;
        }

        const dedupe = this._multi > 0;
        const seen = this._seen;
        if (dedupe) seen.clear();

        for (let cx = cx0; cx <= cx1; cx++) {
            for (let cy = cy0; cy <= cy1; cy++) {
                const bucket = this._buckets.get(key(cx, cy));
                if (!bucket) continue;
                for (const e of bucket) {
                    if (dedupe) {
                        if (seen.has(e)) continue;
                        seen.add(e);
                    }
                    if (e.maxX >= minX && e.minX <= maxX && e.maxY >= minY && e.minY <= maxY) out.push(e.item);
                }
            }
        }
        for (const e of this._big) {
            if (e.maxX >= minX && e.minX <= maxX && e.maxY >= minY && e.minY <= maxY) out.push(e.item);
        }
        return out;
    }

    _link(e) {
        const cells = (e.cx1 - e.cx0 + 1) * (e.cy1 - e.cy0 + 1);
        if (cells > MAX_CELLS) {
            e.big = true;
            this._big.add(e);
            return;
        }
        e.big = false;
        if (cells > 1) this._multi++;
        for (let cx = e.cx0; cx <= e.cx1; cx++) {
            for (let cy = e.cy0; cy <= e.cy1; cy++) {
                const k = key(cx, cy);
                let b = this._buckets.get(k);
                if (!b) { b = new Set(); this._buckets.set(k, b); }
                b.add(e);
            }
        }
    }

    _unlink(e) {
        if (e.big) {
            this._big.delete(e);
            e.big = false;
            return;
        }
        if ((e.cx1 - e.cx0 + 1) * (e.cy1 - e.cy0 + 1) > 1) this._multi--;
        for (let cx = e.cx0; cx <= e.cx1; cx++) {
            for (let cy = e.cy0; cy <= e.cy1; cy++) {
                const k = key(cx, cy);
                const b = this._buckets.get(k);
                if (!b) continue;
                b.delete(e);
                if (b.size === 0) this._buckets.delete(k);   // não vaza bucket vazio
            }
        }
    }
}
