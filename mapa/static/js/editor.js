import * as Graficos from "./graficos.js";
import * as Geometria from "./geometria.js";
import { SpatialHash } from "./spatial-hash.js";
import { getShortestPath } from "./rota.js";

export const Palette = Object.freeze({
    reference:  { out: 0x3d97e0, in: 0xa4d1f5, hover: 0x00aaff },   // referências
    connection: { out: 0x3d97e0, in: 0xa4d1f5 },                    // conexões (a rede de rotas)
    building:   { out: 0xe8730c, in: 0xfcd5a8, hover: 0xc2410c, hoverFill: 0xffe8cc },
    route:      { out: 0x1a7f37, in: 0x4cc36a },                    // rota calculada (página main)
    accent:     { out: 0x16a34a, in: 0xbbf7d0 },                    // alvo clicável (fechar a forma)
    selection:  { out: 0x1d47b0, in: 0x1411ff },
});

let page;

const MIME_MAP = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'text/plain': 'txt',
    'application/json': 'json',
};

export const SNAP_RADIUS_PX = 40;

function closestPointOnSegment(px, py, x1, y1, x2, y2) {
    const cx = x2 - x1, cy = y2 - y1;
    const lenSq = cx * cx + cy * cy;
    let t = lenSq === 0 ? 0 : ((px - x1) * cx + (py - y1) * cy) / lenSq;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const x = x1 + t * cx, y = y1 + t * cy;
    return { x, y, d: (px - x) ** 2 + (py - y) ** 2 };
}

const MAX_DOT_SIZE = 16;       // maior `size` de uma Reference no editor (10 + 5 do hover) + folga
const MAX_LINE_HALF = 8;       // maior (size + 6) / 2 de uma Connection (size chega a 9)
const PIN_REACH_MARGIN = 1.25; // o hover escala o pin até 1.2x

// buffers de consulta reutilizados: nada de alocar array a cada pointermove
const _dotBuf = [], _pinBuf = [], _lineBuf = [];

const byZDesc = (a, b) => b.z - a.z;
const byIdDesc = (a, b) => b.id - a.id;

function distSqToSegment(px, py, x1, y1, x2, y2) {
    const cx = x2 - x1, cy = y2 - y1;
    const lenSq = cx * cx + cy * cy;
    let t = lenSq === 0 ? 0 : ((px - x1) * cx + (py - y1) * cy) / lenSq;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = px - (x1 + t * cx), dy = py - (y1 + t * cy);
    return dx * dx + dy * dy;
}

function pairKey(a, b) {
    return a.uid < b.uid ? `${a.uid}:${b.uid}` : `${b.uid}:${a.uid}`;
}

function generateRandomFileName(mimeType) {
    const extension = MIME_MAP[mimeType] || mimeType.split('/')[1] || 'bin';
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substring(2, 8);
    return `${timestamp}-${randomPart}.${extension}`;
}

export function setContext(context) {
    page = context.page;
}

function rgbToHex(r, g, b) {
    return ((r & 0xFF) << 16) | ((g & 0xFF) << 8) | (b & 0xFF);
}
function hexToRgb(hex) {
    return {
        r: (hex >> 16) & 0xFF,
        g: (hex >> 8) & 0xFF,
        b: hex & 0xFF
    };
}
function interpCol(start, end, t) {
    let rgbStart = hexToRgb(start);
    let rgbEnd = hexToRgb(end);

    let final = [
        rgbStart.r * (1 - t) + rgbEnd.r * t,
        rgbStart.g * (1 - t) + rgbEnd.g * t,
        rgbStart.b * (1 - t) + rgbEnd.b * t,
    ];

    return rgbToHex(final[0], final[1], final[2]);
}
function interp(start, end, t) {
    return start * (1 - t) + end * t;
}

function normalPos(coord) {
    const p = coord.getIn("normal");
    return { x: p.x, y: p.y };
}

function hasBannerContent(banner) {
    return banner.detailed
}

export function buildPayload() {
    const payload = {
        buildings: {},
        references: {},
        banners: {},
        areas: {},
        connections: {},
        files: {},
    };
    const files = {};

    let bannerCounter = 0;

    function registerBanner(banner) {
        if (!hasBannerContent(banner)) return null;

        const id = bannerCounter++;
        const hasFile = banner.image instanceof File;

        payload.banners[id] = {
            image: hasFile ? banner.image.name : null,
            title: banner.title,
            description: banner.description,
            alias: banner.titleAlias,
        };
        if (hasFile) files[id] = banner.image;

        return id;
    }

    for (const [id, building] of Object.entries(Buildings.buildings)) {
        if (!building.closed) continue;   // rascunho não vai para o servidor
        payload.buildings[id] = {
            name: building.name,
            pin: normalPos(building.coordinate),
            polygon: building.vertices.map(v => ({ x: v.pos.x, y: v.pos.y })),
            entrances: building.entrances
                .filter(r => r.id !== -1)
                .map(r => r.id),
            banner: registerBanner(building.banner),
        };
    }

    for (const [id, ref] of Object.entries(Referencer.references)) {
        payload.references[id] = {
            pos: normalPos(ref.coordinate),
            banner: registerBanner(ref.banner),
        };
    }

    for (const [key, conn] of Object.entries(Connections.connections)) {
        payload.connections[key] = {
            a: conn.start.id,
            b: conn.end.id,
        };
    }

    return { payload, files };
}

async function urlToFile(url) {
    if (!url) return null;
    const response = await fetch(url);
    const blob = await response.blob();
    
    const mimeType = blob.type || 'image/png'; 
    let filename = generateRandomFileName(mimeType);
    return new File([blob], filename, { type: mimeType });
}

function normalize(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function getFieldScore(targetText, query) {
  const target = normalize(targetText);
  const q = normalize(query);

  if (!target || !q) return 0;

  if (target === q) return 100;

  if (target.startsWith(q)) return 80;

  if (target.includes(q)) return 60;

  const queryTokens = q.split(/\s+/).filter(Boolean);
  const targetTokens = target.split(/\s+/).filter(Boolean);
  
  let totalTokenScore = 0;

  for (const qToken of queryTokens) {
    if (targetTokens.some(t => t === qToken)) {
      totalTokenScore += 3;
    } else if (targetTokens.some(t => t.startsWith(qToken))) {
      totalTokenScore += 2;
    } else if (targetTokens.some(t => t.includes(qToken))) {
      totalTokenScore += 1;
    }
  }

  return queryTokens.length > 0 ? totalTokenScore / queryTokens.length : 0;
}

export async function queryBanner(query) {
  const trimmedQuery = query?.trim();
  if (!trimmedQuery) return [];

  const combined = [
    ...Object.values(Buildings.buildings || {}),
    ...Object.values(Referencer.references || {})
  ];

  return combined
    .reduce((acc, element) => {
      const banner = element?.banner;
      const title = banner?.title || element?.name;

      if (!title) return acc;

      const searchFields = [
        title,
        ...(Array.isArray(banner?.titleAlias)
          ? banner.titleAlias
          : banner?.titleAlias
            ? [banner.titleAlias]
            : []),
        element?.name,
        element?.building?.name
      ].filter(value => typeof value === "string" && value.trim());

      const score = Math.max(
        0,
        ...searchFields.map(field => getFieldScore(field, trimmedQuery))
      );

      if (score > 0) {
        acc.push({
          title,
          image: banner?.image,
          description: banner?.description,
          ref: element,
          score
        });
      }

      return acc;
    }, [])
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

export async function load() {
    try {
        const response = await fetch(URLLoadMap);
        if (!response.ok) throw new Error('Erro de rede');
        const data = await response.json();
        let refMap = {};
        
        if (data.buildings) {
            for (const key of Object.keys(data.buildings)) {
                let build = data.buildings[key];
                
                let buildCoord = newCoord(build.pin.x, build.pin.y, "normal");
                
                let building = new Building(buildCoord, build.name);
                let bannerKey = build.banner;
                let banner = data.banners[bannerKey];
                if (banner) {
                    if (banner.title) {
                        building.banner.title = banner.title;
                        building.banner.detailed = true;
                    }
                    if (banner.description) {
                        building.banner.description = banner.description;
                        building.banner.detailed = true;
                    }
                    if (banner.alias) {
                        building.banner.titleAlias = banner.alias;
                    }
                    if (banner.image) {
                        const imageFile = banner.image 
                        ? await urlToFile(banner.image) 
                        : null;
                        building.banner.image = imageFile;
                        building.banner.detailed = true;
                    }
                }

                let poly = build.polygon;
                if (!poly && build.areas) {
                    poly = legacyPolygon(build.areas.map(k => data.areas?.[k]));
                }
                if (poly && poly.length >= 3) building.setPolygon(poly);
            }   
        }
        if (data.references) {
            for (const key of Object.keys(data.references)) {
                let reference = data.references[key];
                let coord = newCoord(reference.pos.x, reference.pos.y, "normal");
                let refObject = new Reference(coord);

                refMap[key] = refObject;
                let bannerKey = reference.banner;
                if (bannerKey == null) {
                    continue;
                }
                let banner = data.banners[bannerKey];
                if (banner.title) {
                    refObject.banner.title = banner.title;
                    refObject.setName(banner.title);
                    refObject.banner.detailed = true;
                }
                if (banner.description) {
                    refObject.banner.description = banner.description;
                    refObject.banner.detailed = true;
                }
                if (banner.alias) {
                    refObject.banner.titleAlias = banner.alias;
                }
                if (banner.image) {
                    const imageFile = banner.image 
                    ? await urlToFile(banner.image) 
                    : null;
                    refObject.banner.image = imageFile;
                    refObject.banner.detailed = true;
                }
            }
        }
        if (data.connections) {
            for (const key of Object.keys(data.connections)) {
                let connection = data.connections[key];
                let refStart = refMap[connection.a];
                let refEnd = refMap[connection.b];
                new Connection(refStart, refEnd);
            }
        }

    } catch (error) {
        console.error('Fetch error:', error);
    }
}

export class SnapGuides {
    static graphics = {
        horizontal: null,
        vertical: null,
    };

    static guides = {
        horizontal: null,
        vertical: null,
    };

    static styles = {
        horizontal: {
            colorOut: 0x28A7F0,
            colorIn: 0x28A7F0,
            alpha: 0.9,
            size: 1,
        },
        vertical: {
            colorOut: 0x28A7F0,
            colorIn: 0x28A7F0,
            alpha: 0.9,
            size: 1,
        },
    };

    static ensureGraphics(axis) {
        if (!this.graphics[axis]) {
            this.graphics[axis] = Graficos.createGuide();
        }

        return this.graphics[axis];
    }

    static draw(axis, start, end) {
        this.guides[axis] = { start, end };
        this.ensureGraphics(axis);

        this.render();
    }

    static snap(screenPt, targets, thresholdPx = 8) {
        let bx = null, by = null;

        for (const t of targets) {
            const n = t.peekNormal();
            const s = Graficos.getScreenCoordinates(n);
            const dx = Math.abs(s.x - screenPt.x);
            const dy = Math.abs(s.y - screenPt.y);

            if (dx <= thresholdPx && (!bx || dx < bx.d)) bx = { d: dx, x: s.x, n: { x: n.x, y: n.y } };
            if (dy <= thresholdPx && (!by || dy < by.d)) by = { d: dy, y: s.y, n: { x: n.x, y: n.y } };
        }

        return {
            x: bx ? bx.x : screenPt.x,
            y: by ? by.y : screenPt.y,
            guides: {
                vertical:   bx ? { start: bx.n, end: bx.n } : null,
                horizontal: by ? { start: by.n, end: by.n } : null,
            },
        };
    }

    static render() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        const margin = 100;   // passa da borda para a linha nunca terminar à vista

        for (const axis of ["horizontal", "vertical"]) {
            const guide = this.guides[axis];
            const graphics = this.graphics[axis];

            if (!guide || !graphics) {
                if (graphics) Graficos.clearGuide(graphics);
                continue;
            }

            // âncora (normal) -> tela
            const s = Graficos.getScreenCoordinates(guide.start);

            const a = axis === "horizontal"
                ? newCoord(-margin, s.y, "screen")
                : newCoord(s.x, -margin, "screen");
            const b = axis === "horizontal"
                ? newCoord(w + margin, s.y, "screen")
                : newCoord(s.x, h + margin, "screen");

            Graficos.renderGuide(graphics, {
                points: [a, b],
                ...this.styles[axis],
            });
        }
    }

    static clear(axis) {
        this.guides[axis] = null;

        if (this.graphics[axis]) {
            Graficos.clearGuide(this.graphics[axis]);
        }
    }

    static clearAll() {
        this.clear("horizontal");
        this.clear("vertical");
    }

    static update(guides) {
        for (const axis of ["horizontal", "vertical"]) {
            if (guides?.[axis]) {
                this.guides[axis] = {
                    start: guides[axis].start,
                    end: guides[axis].end,
                };

                this.ensureGraphics(axis);
            } else {
                this.guides[axis] = null;
            }
        }

        this.render();
    }

    static destroy() {
        for (const axis of ["horizontal", "vertical"]) {
            const graphics = this.graphics[axis];

            if (graphics) {
                Graficos.destroyConnection(graphics);
                this.graphics[axis] = null;
            }

            this.guides[axis] = null;
        }
    }
}

const _aabb = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

// Retângulo do frame da tela -> caixa alinhada ao mapa que o contém (broad-phase), com folga.
function frameRectToLocalAABB(c, s, minX, minY, maxX, maxY, pad) {
    let lx0 = Infinity, ly0 = Infinity, lx1 = -Infinity, ly1 = -Infinity;
    for (let i = 0; i < 4; i++) {
        const fx = i & 1 ? maxX : minX;
        const fy = i & 2 ? maxY : minY;
        const x = c * fx + s * fy, y = -s * fx + c * fy;      // R(-rot)
        if (x < lx0) lx0 = x;
        if (x > lx1) lx1 = x;
        if (y < ly0) ly0 = y;
        if (y > ly1) ly1 = y;
    }
    _aabb.minX = lx0 - pad; _aabb.minY = ly0 - pad;
    _aabb.maxX = lx1 + pad; _aabb.maxY = ly1 + pad;
    return _aabb;
}

// Os 4 cantos da caixa local estão no retângulo (convexo) => o polígono todo está.
function boxInsideFrameRect(box, c, s, minX, minY, maxX, maxY) {
    for (let i = 0; i < 4; i++) {
        const x = i & 1 ? box.maxX : box.minX;
        const y = i & 2 ? box.maxY : box.minY;
        const fx = c * x - s * y, fy = s * x + c * y;
        if (fx < minX || fx > maxX || fy < minY || fy > maxY) return false;
    }
    return true;
}

// Polígono x retângulo do frame. Sem aresta tocando, o retângulo está inteiro dentro OU
// inteiro fora: um teste de ponto (no espaço local) decide.
function polygonTouchesRectF(verts, c, s, minX, minY, maxX, maxY) {
    const n = verts.length;
    let p = verts[n - 1].pos;
    let px = c * p.x - s * p.y, py = s * p.x + c * p.y;
    for (let i = 0; i < n; i++) {
        const q = verts[i].pos;
        const qx = c * q.x - s * q.y, qy = s * q.x + c * q.y;
        if (segmentIntersectsRect(px, py, qx, qy, minX, minY, maxX, maxY)) return true;
        px = qx; py = qy;
    }
    return pointInPolygon(c * minX + s * minY, -s * minX + c * minY, verts);
}

function polygonInsideRectF(verts, c, s, minX, minY, maxX, maxY) {
    for (let i = 0; i < verts.length; i++) {
        const q = verts[i].pos;
        const fx = c * q.x - s * q.y, fy = s * q.x + c * q.y;
        if (fx < minX || fx > maxX || fy < minY || fy > maxY) return false;
    }
    return true;
}

export class SelectRegion {
    constructor() {
        throw new Error("Classe estática. Não instancie.");
    }

    static startCoord = null;
    static currCoord = null;
    static selected = {
        "buildVertices": [],
        "build": [],
        "references": [],
    };
    static graphics = null;

    static box = null;
    static _box = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    static boxGraphics = null;
    static boxPadPx = 10;
    static boxAlpha = [1, .3];
    static boxBorderSize = 0.1;
    static boxColorOut = Palette.selection.out;
    static boxColorIn = Palette.selection.in;

    static maxItemBoxes = 16;      // acima disso, só a caixa justa
    static itemGraphics = null;
    static itemPadPx = 3;          // folga ao redor de cada referência / construção
    static vertexBoxPx = 7;        // meia-largura da caixa de um vértice (px de tela)
    static itemAlpha = [0.8, 0.08];
    static itemBorderSize = 1;

    static _rot = 0;
    static _cos = 1;
    static _sin = 0;
    static _tmpBox = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

    static vertexMode = false;     // modo da seleção atual (shift = vértices, senão construções)
    static _shift = false;

    static touch = true;
    static _rect = { minX: NaN, minY: NaN, maxX: NaN, maxY: NaN };
    static _zoom = NaN;

    static resetBox(box) {
        box.minX = box.minY = Infinity;
        box.maxX = box.maxY = -Infinity;
        return box;
    }

    static growBox(box, minX, minY, maxX, maxY) {
        if (minX < box.minX) box.minX = minX;
        if (minY < box.minY) box.minY = minY;
        if (maxX > box.maxX) box.maxX = maxX;
        if (maxY > box.maxY) box.maxY = maxY;
    }

    static boundsWithVertices(selected = this.selected, out = {}) {
        return this.selectionBox(selected, out, { vertices: true, buildings: false });
    }
    static boundsWithBuildings(selected = this.selected, out = {}) {
        return this.selectionBox(selected, out, { vertices: false, buildings: true });
    }

    // ---- ciclo do arrasto ----

    static start(coordinate) {
        this.startCoord = coordinate;
        this.startCoord.convertTo("normal");
        this.currCoord = null;
        this.clearSelection();
    }

    static move(coordinate, shift) {
        this.currCoord = coordinate;
        this.currCoord.convertTo("normal");
        this.updateSelection(shift);
        this.updateGraphics();
    }

    static release() {
        this.startCoord = null;
        this.currCoord = null;
        this.updateGraphics();
    }

    static clear() {
        this.release();
        this.clearSelection();
    }
    
    static refresh() {
        this.clear();
        this.refreshBox();
    }

    static clearSelection() {
        this.selected.references.length = 0;
        this.selected.buildVertices.length = 0;
        this.selected.build.length = 0;
        this._rect.minX = NaN;
        this.updateBoxGraphics();
    }

    static refreshBox(shift = this.vertexMode) {
        this.vertexMode = !!shift;
        this.box = this.selectionBox(this.selected, this._box, {
            vertices: this.vertexMode,
            buildings: !this.vertexMode,
        });
        this.updateBoxGraphics();
    }

    static itemBoxes(zoom) {
        const sel = this.selected;
        const vm = this.vertexMode;
        const refs = sel.references;
        const second = vm ? sel.buildVertices : sel.build;

        const n = refs.length + second.length;
        if (n === 0 || n > this.maxItemBoxes) return null;

        const out = [];
        const gap = this.itemPadPx / zoom;

        for (let i = 0; i < refs.length; i++) {
            const ref = refs[i];
            const p = ref.coordinate.pos;
            const r = ref.size / zoom + gap;               // mesmo raio do teste de colisão
            out.push([p.x - r, p.y - r, p.x + r, p.y + r]);
        }

        if (vm) {
            const r = this.vertexBoxPx / zoom;
            for (let i = 0; i < second.length; i++) {
                const p = second[i].building.vertices[second[i].index].pos;
                out.push([p.x - r, p.y - r, p.x + r, p.y + r]);
            }
        } else {
            for (let i = 0; i < second.length; i++) {
                const b = Buildings.polyHash.box(second[i]) ?? second[i].bounds();
                out.push([b.minX - gap, b.minY - gap, b.maxX + gap, b.maxY + gap]);
            }
        }
        return out;
    }

    // ---- gráficos ----

    static ensureGraphics() {
        if (this.graphics) return;
        this.graphics = Graficos.createGuide();
    }

    static alpha = [0.6, 1];
    static colorIn = Palette.selection.in;
    static colorOut = Palette.selection.out;
    static borderSize = .1;
    static radius = 0;

    static syncFrame() {
        const rot = Graficos.mapContainer?.rotation ?? 0;
        if (rot === this._rot) return false;
        this._rot = rot;
        this._cos = Math.cos(rot);
        this._sin = Math.sin(rot);
        return true;
    }

    /** Caixa de uma construção NO FRAME DA TELA (sem rotação: usa a caixa do hash, O(1)). */
    static frameBounds(building, out) {
        const c = this._cos, s = this._sin;
        if (c === 1 && s === 0) {
            const b = Buildings.polyHash.box(building) ?? building.bounds();
            out.minX = b.minX; out.minY = b.minY; out.maxX = b.maxX; out.maxY = b.maxY;
            return out;
        }
        this.resetBox(out);
        const verts = building.vertices;
        for (let k = 0; k < verts.length; k++) {
            const p = verts[k].pos;
            const fx = c * p.x - s * p.y, fy = s * p.x + c * p.y;
            this.growBox(out, fx, fy, fx, fy);
        }
        return out;
    }

    /** Caixa justa no frame da tela (alinhada à tela). null se não há nada. */
    static selectionBox(selected = this.selected, out = {}, { vertices = true, buildings = true } = {}) {
        this.syncFrame();
        const c = this._cos, s = this._sin;
        const box = this.resetBox(out);

        const refs = selected.references;
        for (let i = 0; i < refs.length; i++) {
            const p = refs[i].coordinate.pos;
            const fx = c * p.x - s * p.y, fy = s * p.x + c * p.y;
            this.growBox(box, fx, fy, fx, fy);
        }

        if (vertices) {
            const verts = selected.buildVertices;
            for (let i = 0; i < verts.length; i++) {
                const p = verts[i].building.vertices[verts[i].index].pos;
                const fx = c * p.x - s * p.y, fy = s * p.x + c * p.y;
                this.growBox(box, fx, fy, fx, fy);
            }
        }

        if (buildings) {
            const builds = selected.build, t = this._tmpBox;
            for (let i = 0; i < builds.length; i++) {
                const b = this.frameBounds(builds[i], t);
                this.growBox(box, b.minX, b.minY, b.maxX, b.maxY);
            }
        }

        return box.minX === Infinity ? null : box;
    }

    static updateSelection(shift) {
        if (!this.startCoord || !this.currCoord) return;
        this.syncFrame();
        const c = this._cos, s = this._sin;

        const a = this.startCoord.pos, b = this.currCoord.pos;
        const ax = c * a.x - s * a.y, ay = s * a.x + c * a.y;      // arrasto no frame da tela
        const bx = c * b.x - s * b.y, by = s * b.x + c * b.y;
        const minX = Math.min(ax, bx), maxX = Math.max(ax, bx);
        const minY = Math.min(ay, by), maxY = Math.max(ay, by);

        const r = this._rect, zoom = Graficos.zoom, sh = !!shift;
        if (r.minX === minX && r.minY === minY && r.maxX === maxX && r.maxY === maxY &&
            this._zoom === zoom && this._shift === sh) return;
        r.minX = minX; r.minY = minY; r.maxX = maxX; r.maxY = maxY;
        this._zoom = zoom;
        this._shift = sh;

        const t = this.touch;
        Referencer.getReferencesInRect(minX, minY, maxX, maxY, this.selected.references, t, c, s);
        Buildings.getVerticesInRect(minX, minY, maxX, maxY, this.selected.buildVertices, t, c, s);
        Buildings.getPolygonsInRect(minX, minY, maxX, maxY, this.selected.build, t, c, s);

        this.refreshBox(sh);
    }

    /** A câmera girou (chamado por Graficos.Rotation). */
    static onCameraRotate() {
        if (!this.syncFrame()) return;
        if (this.startCoord && this.currCoord) {
            this._rect.minX = NaN;                  // refaz a consulta no frame novo
            this.updateSelection(this._shift);
            this.updateGraphics();
        } else if (this.box) {
            this.refreshBox();
        }
    }

    static itemBoxes(zoom) {
        const sel = this.selected;
        const vm = this.vertexMode;
        const refs = sel.references;
        const second = vm ? sel.buildVertices : sel.build;

        const n = refs.length + second.length;
        if (n === 0 || n > this.maxItemBoxes) return null;

        const c = this._cos, s = this._sin;
        const out = [];
        const gap = this.itemPadPx / zoom;

        for (let i = 0; i < refs.length; i++) {
            const ref = refs[i];
            const p = ref.coordinate.pos;
            const fx = c * p.x - s * p.y, fy = s * p.x + c * p.y;
            const r = ref.size / zoom + gap;
            out.push([fx - r, fy - r, fx + r, fy + r]);
        }

        if (vm) {
            const r = this.vertexBoxPx / zoom;
            for (let i = 0; i < second.length; i++) {
                const p = second[i].building.vertices[second[i].index].pos;
                const fx = c * p.x - s * p.y, fy = s * p.x + c * p.y;
                out.push([fx - r, fy - r, fx + r, fy + r]);
            }
        } else {
            const t = this._tmpBox;
            for (let i = 0; i < second.length; i++) {
                const b = this.frameBounds(second[i], t);
                out.push([b.minX - gap, b.minY - gap, b.maxX + gap, b.maxY + gap]);
            }
        }
        return out;
    }

    // retângulo de arrasto: no frame da tela, desenhado com a rotação da câmera
    static buildData() {
        const c = this._cos, s = this._sin;
        const a = this.startCoord.pos, b = this.currCoord.pos;
        return {
            points: [[
                c * a.x - s * a.y, s * a.x + c * a.y,
                c * b.x - s * b.y, s * b.x + c * b.y,
            ]],
            frameRotation: this._rot,
            alpha: this.alpha,
            colorOut: this.colorOut,
            colorIn: this.colorIn,
            borderSize: this.borderSize,
            radius: this.radius,
            handles: false,
            handleActive: false
        };
    }

    static updateGraphics() {
        this.ensureGraphics();
        if (this.startCoord && this.currCoord) {
            Graficos.renderSelect(this.graphics, this.buildData());
        } else {
            Graficos.clearGuide(this.graphics);
        }
        this.updateBoxGraphics();
    }

    static updateBoxGraphics() {
        if (this.box && this.syncFrame()) { this.refreshBox(); return; }   // rede de segurança: câmera girou
        const b = this.box;
        if (!b && !this.boxGraphics) return;
        this.boxGraphics ??= Graficos.createGuide();
        this.itemGraphics ??= Graficos.createGuide();

        if (!b) {
            Graficos.clearGuide(this.boxGraphics);
            Graficos.clearGuide(this.itemGraphics);
            return;
        }

        const zoom = Graficos.zoom;
        const items = this.itemBoxes(zoom);

        // caixa justa: com caixas individuais, envolve todas elas (nunca corta nenhuma);
        // sem elas (passou do limite), usa os extremos da seleção com folga que cobre o ponto
        let x0, y0, x1, y1, pad;
        if (items) {
            x0 = y0 = Infinity;
            x1 = y1 = -Infinity;
            for (let i = 0; i < items.length; i++) {
                const it = items[i];
                if (it[0] < x0) x0 = it[0];
                if (it[1] < y0) y0 = it[1];
                if (it[2] > x1) x1 = it[2];
                if (it[3] > y1) y1 = it[3];
            }
            pad = this.boxPadPx / zoom;
        } else {
            x0 = b.minX; y0 = b.minY; x1 = b.maxX; y1 = b.maxY;
            pad = Math.max(this.boxPadPx, MAX_DOT_SIZE) / zoom;
        }

        Graficos.renderSelect(this.boxGraphics, {
            points: [[x0 - pad, y0 - pad, x1 + pad, y1 + pad]],
            frameRotation: this._rot,
            alpha: this.boxAlpha,
            colorOut: this.boxColorOut,
            colorIn: this.boxColorIn,
            borderSize: 2,
            radius: 2,
            handles: false,
            handleActive: false
        });

        // com 1 elemento a caixa justa já é a dele: sem caixa duplicada
        if (items && items.length > 1) {
            Graficos.renderSelect(this.itemGraphics, {
                points: items,
                frameRotation: this._rot,
                alpha: this.itemAlpha,
                colorOut: this.boxColorOut,
                colorIn: this.boxColorIn,
                borderSize: this.itemBorderSize,
                radius: 2,
                handles: false,
                handleActive: false
            });
        } else {
            Graficos.clearGuide(this.itemGraphics);
        }
    }
}

export class Coordinate {
    constructor(pos, space = "screen") {
        this.pos = { x: pos.x, y: pos.y };
        this.space = space;
    }

    convertTo(targetSpace) {
        if (this.space === targetSpace) return;

        this.pos = this.getIn(targetSpace);
        this.space = targetSpace;
    }

    getIn(targetSpace) {
        if (this.space === targetSpace) {
            return { x: this.pos.x, y: this.pos.y };
        }

        let pos = { x: this.pos.x, y: this.pos.y };

        if (this.space === "screen") {
            pos = Graficos.getNormalizedCoordinates(pos);
        }

        if (targetSpace === "screen") {
            pos = Graficos.getScreenCoordinates(pos);
        }

        return pos;
    }

    // posição em "normal" sem alocar quando já está nesse espaço. SOMENTE LEITURA.
    peekNormal() {
        return this.space === "normal" ? this.pos : this.getIn("normal");
    }
}

export function newCoord(x, y, space) {
    return new Coordinate({x: x, y: y}, space);
}

function ease(x, type = "in-out", power = 2) {
    const t = Math.max(0, Math.min(1, x));

    switch (type) {
        case "in":
        return Math.pow(t, power);

        case "out":
        return 1 - Math.pow(1 - t, power);

        case "in-out":
        default:
        if (t < 0.5) {
            return Math.pow(2, power - 1) * Math.pow(t, power);
        } else {
            return 1 - Math.pow(-2 * t + 2, power) / 2;
        }
    }
}

const VERTEX_GRAB_PX = 10;
const WALL_SNAP_PX = 12;   // referência gruda na parede dentro desse raio (tela)
const WALL_EPS = 1e-4;     // redetecta quem já está exatamente na parede (undo/redo/load)
const _wallBuf = [], _polyBuf = [];

const _selBuf = [];   // buffer de broad-phase das consultas de região

// Distância² do ponto ao retângulo (0 se estiver dentro).
function distSqPointRect(x, y, minX, minY, maxX, maxY) {
    const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0;
    const dy = y < minY ? minY - y : y > maxY ? y - maxY : 0;
    return dx * dx + dy * dy;
}

// Segmento x retângulo: aceita/rejeita rápido, senão método das lajes (slab).
function segmentIntersectsRect(x1, y1, x2, y2, minX, minY, maxX, maxY) {
    if (x1 >= minX && x1 <= maxX && y1 >= minY && y1 <= maxY) return true;
    if (x2 >= minX && x2 <= maxX && y2 >= minY && y2 <= maxY) return true;
    if ((x1 < minX && x2 < minX) || (x1 > maxX && x2 > maxX) ||
        (y1 < minY && y2 < minY) || (y1 > maxY && y2 > maxY)) return false;

    let t0 = 0, t1 = 1;
    const dx = x2 - x1, dy = y2 - y1;

    if (dx === 0) {
        if (x1 < minX || x1 > maxX) return false;
    } else {
        let ta = (minX - x1) / dx, tb = (maxX - x1) / dx;
        if (ta > tb) { const s = ta; ta = tb; tb = s; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) return false;
    }
    if (dy === 0) {
        if (y1 < minY || y1 > maxY) return false;
    } else {
        let ta = (minY - y1) / dy, tb = (maxY - y1) / dy;
        if (ta > tb) { const s = ta; ta = tb; tb = s; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) return false;
    }
    return true;
}

function pointInPolygon(x, y, verts) {
    let inside = false;
    for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
        const a = verts[i].pos, b = verts[j].pos;
        if ((a.y > y) !== (b.y > y) &&
            x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

function closestOnPolygon(x, y, verts) {
    let best = null;
    for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
        const a = verts[j].pos, b = verts[i].pos;
        const p = closestPointOnSegment(x, y, a.x, a.y, b.x, b.y);
        if (!best || p.d < best.d) best = p;
    }
    return best;
}

function polygonArea(pts) {
    let s = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        s += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
    }
    return Math.abs(s) / 2;
}

function legacyPolygon(areas) {
    const boxes = areas.filter(Boolean).map(a => [a.min.x, a.min.y, a.max.x, a.max.y]);
    if (!boxes.length) return null;
    let best = null, bestArea = -1;
    for (const poly of Geometria.getUnionPolygonVertices(boxes)) {
        const pts = poly.map(([x, y]) => ({ x, y }));
        const a = polygonArea(pts);
        if (a > bestArea) { best = pts; bestArea = a; }
    }
    return best;
}

export class PhantomReference {
    constructor(coordinate, colors = Palette.reference) {
        this.alpha = 0.45;
        this.colorOut = colors.out;
        this.colorIn = colors.in;
        this.size = 10;
        this.tint = 0x00aaff;

        this.coordinate = coordinate;
        this.coordinate.convertTo("normal");

        this.graphics = Graficos.createReference();

        this.updateGraphics();
    }

    setPosition(coordinate) {
        this.coordinate = coordinate;
        this.coordinate.convertTo("normal");

        this.updateGraphics();
    }

    buildData() {
        return {
            coordinate: this.coordinate,
            colorOut: this.colorOut,
            colorIn: this.colorIn,
            size: this.size,
            alpha: this.alpha,
            isEntrance: false,
            color: this.tint,
        };
    }

    updateGraphics() {
        Graficos.renderReference(this.graphics, this.buildData());
    }

    destroy() {
        Graficos.destroyReference(this.graphics);
    }
}

// Alvo clicável no 1º vértice: some se a forma não está aberta com 3+ pontos
class CloseHandle {
    constructor(building) {
        this.building = building;
        this.hover = 0;
        this.hoverTime = .2;
        this.t = 0;
        this.size = 9;
        this.destroyed = false;
        this.graphics = Graficos.createReference();
    }

    hoverAdd() {
        this.hover = Math.min(this.hover + 1, this.hoverTime * 30);
        this.hoverUpdate();
    }
    hoverDec() {
        this.hover = Math.max(this.hover - 1, 0);
        this.hoverUpdate();
    }
    hoverUpdate() {
        this.t = ease(this.hover * (1000 / 30) / (this.hoverTime * 1000));
        this.size = 9 + this.t * 6;
        this.updateGraphics();
    }

    updateGraphics() {
        if (this.destroyed) return;
        const b = this.building;

        if (!b.enabled || b.closed || b.vertices.length < 3) {
            Graficos.clearReference(this.graphics);
            return;
        }
        Graficos.renderReference(this.graphics, {
            coordinate: b.vertices[0],
            colorOut: interpCol(Palette.building.out, Palette.accent.out, this.t),
            colorIn: interpCol(0xffffff, Palette.accent.in, this.t),
            size: this.size,
            alpha: 1,
            isEntrance: false,
            color: 0,
        });
    }

    destroy() {
        this.destroyed = true;
        Graficos.destroyReference(this.graphics);
    }
}

export class PhantomVertex {
    constructor(building, coordinate) {
        this.building = building;

        this.reference = new PhantomReference(coordinate, Palette.building);
        this.connectionOut = new PhantomConnection(building.vertices.at(-1), Palette.building);

        this.connectionBack = building.vertices.length >= 2
            ? new PhantomConnection(this.reference.coordinate, Palette.building)
            : null;

        this.updateGraphics();
    }

    setEndPoint(coordinate) {
        if (!this.building || this.building.closed) return;

        this.reference.setPosition(coordinate);

        const vertices = this.building.vertices;

        // Rota de continuação.
        this.connectionOut.start = vertices.at(-1);
        this.connectionOut.setEndPoint(this.reference.coordinate);

        // Rota de fechamento.
        if (vertices.length >= 2) {
            if (!this.connectionBack) {
                this.connectionBack = new PhantomConnection(this.reference.coordinate, Palette.building);
            }

            this.connectionBack.start = this.reference.coordinate;
            this.connectionBack.setEndPoint(vertices[0]);
        } else if (this.connectionBack) {
            this.connectionBack.destroy();
            this.connectionBack = null;
        }
    }

    updateGraphics() {
        this.setEndPoint(this.reference.coordinate);
    }

    destroy() {
        this.reference.destroy();
        this.connectionOut.destroy();

        if (this.connectionBack) {
            this.connectionBack.destroy();
            this.connectionBack = null;
        }
    }
}

export class PhantomConnection {
    constructor(start, colors = Palette.connection) {
        this.start = start;

        this.alpha = .6;
        this.colorOut = colors.out;
        this.colorIn = colors.in;

        this.size = 4;

        this.graphics = Graficos.createConnection();
    }

    setEndPoint(end) {
        this.end = end;
        this.updateGraphics();
    }

    buildData() {
        let start = this.start instanceof Reference ? this.start.coordinate : this.start;
        let end = this.end instanceof Reference ? this.end.coordinate : this.end;
        return {
            colorOut: this.colorOut,
            colorIn: this.colorIn,
            alpha: this.alpha,
            size: this.size,
            points: [start, end],
        }
    }

    updateGraphics() {
        Graficos.renderConnection(this.graphics, this.buildData());
    }

    destroy() {
        Graficos.destroyConnection(this.graphics);
    }
}

function removeObj(list, obj) {
    const index = list.indexOf(obj);

    if (index !== -1) {
        list.splice(index, 1);
    }
    return list;
}

function addObj(list, item) {
    if (!list.includes(item)) {
        list.push(item);
        return list;
    }
    return list;
}

export class TouchPin {
    constructor() {
        throw new Error("Classe estática. Não instancie.");
    }

    static graphics = null;
    static coordinate = newCoord(0, 0, "normal");
    static visible = false;
    static hover = 0;
    static hoverTime = .2;
    static size = 1;
    static tint = 0xff0000;
    static selfPin = true;

    static buildData() {
        return {
            coordinate: this.coordinate,
            size: this.size,
            color: this.tint,
        }
    }

    static updateGraphics() {
        if(this.graphics === null) {
            this.graphics = Graficos.createTouchPin();
        }
        Graficos.renderTouchPin(this.graphics, this.buildData());
    }

    static setVisible(bool) {
        this.visible = bool;
        this.updateGraphics();
    }

    static setPos(coordinate) {
        this.coordinate = coordinate;
        this.coordinate.convertTo("normal");
        this.updateGraphics();
    }

    static getOverlappingPin(coordinate) {
        if (Graficos.collisionTest(this.graphics, coordinate.peekNormal())) return this;
        return false;
    }
    
    static hoverAdd() {
        this.hover += 1;
        let cap = this.hoverTime * 30;

        if (this.hover >= cap) {
            this.hover = cap;
        }
        this.hoverUpdate();
    }
    static hoverDec() {
        this.hover -= 1;
        if (this.hover <= 0) {
            this.hover = 0;
        }

        this.hoverUpdate();
    }
    static hoverUpdate() {
        let ms = this.hoverTime * 1000;
        let t = this.hover * (1000 / 30) / ms;
        t = ease(t);
        
        this.size = interp(1, 1.2, t);
        this.updateGraphics();
    }
}

function nearestNodeId(coordinate, nodes) {
    const p = coordinate.getIn("normal");
    let best = null;
    let bestDist = Infinity;

    for (const [id, pos] of Object.entries(nodes)) {
        const d = (pos.x - p.x) ** 2 + (pos.y - p.y) ** 2;
        if (d < bestDist) {
            bestDist = d;
            best = id; // Object.entries devolve strings, que é o que o A* espera
        }
    }
    return best;
}

function findRoute(fromPlace, toPlace) {
    const edges = [];
    const nodes = {};

    // só entram referências que têm conexão, então o nó mais próximo nunca é um nó isolado
    for (const conn of Object.values(Connections.connections)) {
        edges.push([conn.start.id, conn.end.id]);
        nodes[conn.start.id] = conn.start.coordinate.getIn("normal");
        nodes[conn.end.id] = conn.end.coordinate.getIn("normal");
    }

    const startId = nearestNodeId(fromPlace.coordinate, nodes);
    const goalId = nearestNodeId(toPlace.coordinate, nodes);
    if (startId === null || goalId === null) return null;

    const ids = getShortestPath(edges, nodes, startId, goalId);
    return ids ? ids.map(id => Referencer.references[id]) : null;
}

export class Route {
    constructor() { throw new Error("Classe estática. Não instancie."); }

    static active = false;
    static origin = null;       // { ref, title, self? }
    static destination = null;  // { ref, title }
    static points = [];
    static graphics = null;

    static _listeners = new Set();
    static _frame = 0;
    static _lastSelf = null;

    /** fn(tipo, Route): tipos emitidos: "nopath" */
    static subscribe(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    static _emit(type) {
        for (const fn of this._listeners) fn(type, this);
    }

    static start(place, title) {
        if (!this.active) this.origin = null;
        this.active = true;
        this.destination = { ref: place, title };
        this.update();
    }

    static stop() {
        this.active = false;
        this.origin = null;
        this.destination = null;
        this.update();
    }

    static setPoint(which, point) {
        this[which] = point;
        this.update();
    }

    static clearPoint(which) {
        if (!this[which]) return;
        this[which] = null;
        this.update();
    }

    static swap() {
        [this.origin, this.destination] = [this.destination, this.origin];
        this.update();
    }

    static update() {
        this._compute(false);
        this._syncTracking();
    }

    static _compute(silent) {
        this.points = [];

        if (this.active && this.origin && this.destination) {
            const path = findRoute(this.origin.ref, this.destination.ref);

            if (path) {
                this.points = [
                    this.origin.ref.coordinate,
                    ...path.map(ref => ref.coordinate),
                    this.destination.ref.coordinate,
                ];
            } else if (!silent) {
                this._emit("nopath");
            }
        }
        this.redraw();
    }

    static redraw() {
        if (this.points.length < 2) {
            if (this.graphics) Graficos.clearConnection(this.graphics);
            return;
        }
        if (!this.graphics) this.graphics = Graficos.createConnection();

        Graficos.renderConnection(this.graphics, {
            points: this.points,
            colorOut: Palette.route.out,
            colorIn: Palette.route.in,
            alpha: 1,
            size: 8,
        });
    }

    static _tracksSelf() {
        return this.active && !!(this.origin?.self || this.destination?.self);
    }

    // A posição do usuário muda sozinha: UM loop recalcula só quando ela se mexe.
    // (Antes, cada Route.redraw() chamado no scroll abria mais um loop infinito.)
    static _syncTracking() {
        if (!this._tracksSelf()) {
            if (this._frame) cancelAnimationFrame(this._frame);
            this._frame = 0;
            return;
        }
        if (this._frame) return;

        const p = Self.coordinate.pos;
        this._lastSelf = { x: p.x, y: p.y };

        const tick = () => {
            if (!this._tracksSelf()) { this._frame = 0; return; }

            const q = Self.coordinate.pos;
            if (q.x !== this._lastSelf.x || q.y !== this._lastSelf.y) {
                this._lastSelf = { x: q.x, y: q.y };
                this._compute(true);       // silencioso: sem toast a cada movimento
            }
            this._frame = requestAnimationFrame(tick);
        };
        this._frame = requestAnimationFrame(tick);
    }
}

export class Self {
    constructor() {
        throw new Error("Classe estática. Não instancie.");
    }

    static graphics = null;
    static coordinate = newCoord(0, 0, "normal");
    static visible = false;
    static online = false;
    static hover = 0;
    static hoverTime = .2;
    static size = 1;
    static selfPin = true;
    static location = "";
    static onSince = null;
    // static active = false;

    static buildData() {
        return {
            coordinate: this.coordinate,
            online: this.online,
            visible: this.visible,
            size: this.size,
        }
    }

    static updateGraphics() {
        if(this.graphics === null) {
            this.graphics = Graficos.createSelfPin();
        }
        Graficos.renderSelfPin(this.graphics, this.buildData());
    }

    static setOnline(bool) {
        this.online = bool;
        this.updateGraphics();
    }

    static setVisible(bool) {
        this.visible = bool;
        this.updateGraphics();
    }

    static rawCoordinate = null;

    static setPos(coordinate) {
        coordinate.convertTo("normal");
        this.rawCoordinate = coordinate;                       // posição real do GPS
        this.coordinate = page === "main" ? Connections.snap(coordinate) : coordinate;
        this.updateGraphics();
    }

    static getOverlappingPin(coordinate) {
        if (Graficos.collisionTest(this.graphics, coordinate.peekNormal())) return this;
        return false;
    }
    
    static hoverAdd() {
        this.hover += 1;
        let cap = this.hoverTime * 30;

        if (this.hover >= cap) {
            this.hover = cap;
        }
        this.hoverUpdate();
    }
    static hoverDec() {
        this.hover -= 1;
        if (this.hover <= 0) {
            this.hover = 0;
        }

        this.hoverUpdate();
    }
    static hoverUpdate() {
        let ms = this.hoverTime * 1000;
        let t = this.hover * (1000 / 30) / ms;
        t = ease(t);
        
        this.size = interp(1, 1.2, t);
        this.updateGraphics();
    }
}

export class Connections {
    constructor() {
        throw new Error("Classe estática. Não instancie.");
    }

    static uidTracker = 0;
    static connections = {};              // uid -> Connection (só as ativas)
    static pairs = new Map();             // "uidA:uidB" -> Connection (sem direção)
    static hash = new SpatialHash(256);   // caixa do segmento

    // `tracked` + chave por uid: a identidade não depende do `id` da referência,
    // que é zerado em Referencer.untrack antes de as conexões serem desregistradas.
    static track(connection) {
        if (connection.tracked) return;
        connection.tracked = true;
        this.connections[connection.uid] = connection;
        this.pairs.set(pairKey(connection.start, connection.end), connection);
        this.reindex(connection);
    }

    static untrack(connection) {
        if (!connection.tracked) return;
        connection.tracked = false;
        delete this.connections[connection.uid];

        const k = pairKey(connection.start, connection.end);
        if (this.pairs.get(k) === connection) this.pairs.delete(k);
        this.hash.delete(connection);
    }

    /** Chamar quando uma ponta se mexe. */
    static reindex(connection) {
        if (!connection.tracked) return;
        const a = connection.start.coordinate.pos;
        const b = connection.end.coordinate.pos;
        this.hash.set(connection, Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));
    }

    static setRelated(connection, state) {
        this.setRelation(connection, connection.start, state);
        this.setRelation(connection, connection.end, state);
    }
    
    static setRelation(connection, reference, state) {
        if (state) {
            reference.connections = addObj(reference.connections, connection);
        } else {
            reference.connections = removeObj(reference.connections, connection);
        }
    }

    static hasPair(a, b) {
        return this.pairs.get(pairKey(a, b)) || false;
    }

    static snap(coordinate, radiusPx = SNAP_RADIUS_PX) {
        const pos = coordinate.peekNormal();
        const R = radiusPx / Graficos.zoom;          // 10px de tela = R unidades do mundo
        const cand = this.hash.queryRect(pos.x - R, pos.y - R, pos.x + R, pos.y + R, _lineBuf);

        let best = null, bestD = R * R;
        for (let i = 0; i < cand.length; i++) {
            const a = cand[i].start.coordinate.pos, b = cand[i].end.coordinate.pos;
            const p = closestPointOnSegment(pos.x, pos.y, a.x, a.y, b.x, b.y);
            if (p.d <= bestD) { best = p; bestD = p.d; }
        }
        return best ? newCoord(best.x, best.y, "normal") : coordinate;
    }

    static getOverlappingLines(coordinate, all) {
        const pos = coordinate.peekNormal();
        const zoom = Graficos.zoom;
        const R = MAX_LINE_HALF / zoom;
        const cand = this.hash.queryRect(pos.x - R, pos.y - R, pos.x + R, pos.y + R, _lineBuf);

        let best = null, bestD = Infinity, hits = null;
        for (let i = 0; i < cand.length; i++) {
            const c = cand[i];
            const a = c.start.coordinate.pos, b = c.end.coordinate.pos;
            const half = (c.size + 6) / 2 / zoom;          // largura desenhada = (size + 6) / zoom
            const d = distSqToSegment(pos.x, pos.y, a.x, a.y, b.x, b.y);
            if (d > half * half) continue;

            if (all) (hits ??= []).push({ c, d });
            else if (d < bestD) { best = c; bestD = d; }
        }

        if (all) return hits ? hits.sort((p, q) => p.d - q.d).map(h => h.c) : false;
        return best || false;
    }
}

export class Referencer {
    constructor() {
        throw new Error("Classe estática. Não instancie.");
    }
    
    static idTracker = 0;
    static uidTracker = 0;      // identidade permanente (o `id` muda quando a referência é reabilitada)
    static zCounter = 0;        // ordem de empilhamento: maior = mais por cima
    static references = {};
    static dotHash = new SpatialHash(128);   // todas as referências rastreadas (ponto)
    static pinHash = new SpatialHash(256);   // só as que têm pin (página main)
    static maxPinReach = 0;

    static track(reference) {
        if (reference.id !== -1) {
            return;
        }
        reference.id = this.idTracker;
        this.references[this.idTracker] = reference;
        this.idTracker += 1;
        
        for(const connection of reference.connections) {
            if (connection.enabled) Connections.track(connection);   // não ressuscita conexão apagada
        }
    }

    static untrack(reference) {
        if (reference.id === -1) {
            return;
        }
        delete this.references[reference.id];
        reference.id = -1;

        for(const connection of reference.connections) {
            Connections.untrack(connection);
        }
    }

    // ---- rastreio de posição ----

    /** Indexa a referência (ou reindexa, se já estiver indexada). */
    static addPositionTrack(reference) {
        if (!reference.positionTracked) {
            reference.positionTracked = true;
            reference.z = ++this.zCounter;
        }
        this.syncPosition(reference);
    }

    static removePositionTrack(reference) {
        if (!reference.positionTracked) {
            return;
        }
        reference.positionTracked = false;
        this.dotHash.delete(reference);
        this.pinHash.delete(reference);
    }

    /** Reflete a posição atual nos hashes. coordinate.pos está sempre em "normal". */
    static syncPosition(reference) {
        if (!reference.positionTracked) return;
        const p = reference.coordinate.pos;
        this.dotHash.set(reference, p.x, p.y);
        if (reference.name) this.pinHash.set(reference, p.x, p.y);
        else this.pinHash.delete(reference);
    }

    /** Traz para o topo da ordem de picking (equivale ao bringToFront gráfico). */
    static raise(reference) {
        if (reference.positionTracked) reference.z = ++this.zCounter;
    }

    /** Chamado quando a referência ganha pin (setName). */
    static notePin(reference) {
        this.maxPinReach = Math.max(this.maxPinReach, Graficos.pinReach(reference.graphics));
        this.syncPosition(reference);
    }

    // ---- consultas ----

    static getOverlappingDotPins(coordinate, all) {
        const pos = coordinate.peekNormal();
        const R = (this.maxPinReach * PIN_REACH_MARGIN) / Graficos.zoom;
        const cand = this.pinHash.queryRect(pos.x - R, pos.y - R, pos.x + R, pos.y + R, _pinBuf);

        let best = null, hits = null;
        for (let i = 0; i < cand.length; i++) {
            const ref = cand[i];
            if (!Graficos.collisionTest(ref.graphics, pos)) continue;
            if (all) (hits ??= []).push(ref);
            else if (!best || ref.z > best.z) best = ref;
        }

        if (all) return hits ? hits.sort(byZDesc) : false;
        return best || false;
    }

    static getOverlappingDots(coordinate, all) {
        const pos = coordinate.peekNormal();
        const zoom = Graficos.zoom;
        const R = MAX_DOT_SIZE / zoom;
        const cand = this.dotHash.queryRect(pos.x - R, pos.y - R, pos.x + R, pos.y + R, _dotBuf);

        let best = null, hits = null;
        for (let i = 0; i < cand.length; i++) {
            const ref = cand[i];
            const dx = ref.coordinate.pos.x - pos.x;
            const dy = ref.coordinate.pos.y - pos.y;
            const r = ref.size / zoom;
            if (dx * dx + dy * dy >= r * r) continue;      // distância ao quadrado: sem sqrt/pow
            if (all) (hits ??= []).push(ref);
            else if (!best || ref.z > best.z) best = ref;
        }

        if (all) return hits ? hits.sort(byZDesc) : false;
        return best || false;
    }
    
    static getReferencesInRect(minX, minY, maxX, maxY, out = [], touch = true, cos = 1, sin = 0) {
        const zoom = Graficos.zoom;
        const pad = touch ? MAX_DOT_SIZE / zoom : 0;
        const a = frameRectToLocalAABB(cos, sin, minX, minY, maxX, maxY, pad);
        const cand = this.dotHash.queryRect(a.minX, a.minY, a.maxX, a.maxY, _selBuf);

        out.length = 0;
        for (let i = 0; i < cand.length; i++) {
            const ref = cand[i];
            const p = ref.coordinate.pos;
            const fx = cos * p.x - sin * p.y, fy = sin * p.x + cos * p.y;
            const r = touch ? ref.size / zoom : 0;
            if (distSqPointRect(fx, fy, minX, minY, maxX, maxY) <= r * r) out.push(ref);
        }
        return out;
    }
}

export class Buildings {
    constructor() {
        throw new Error("Classe estática. Não instancie.");
    }
    
    static idTracker = 0;
    static buildings = {};
    static pinHash = new SpatialHash(256);    // pins das construções
    static polyHash = new SpatialHash(256);   // caixa de cada polígono FECHADO
    static maxPinReach = 0;

    static editing = false;   // mostra as alças (modo Seleção)
    static hovered = null;    // { building, index }

    static getVerticesInRect(minX, minY, maxX, maxY, out = [], touch = true, cos = 1, sin = 0) {
        const R = touch ? VERTEX_GRAB_PX / Graficos.zoom : 0;
        const a = frameRectToLocalAABB(cos, sin, minX, minY, maxX, maxY, R);
        const cand = this.polyHash.queryRect(a.minX, a.minY, a.maxX, a.maxY, _selBuf);
        const r2 = R * R;

        out.length = 0;
        for (let i = 0; i < cand.length; i++) {
            const b = cand[i], verts = b.vertices;
            for (let k = 0; k < verts.length; k++) {
                const v = verts[k].pos;
                const fx = cos * v.x - sin * v.y, fy = sin * v.x + cos * v.y;
                if (distSqPointRect(fx, fy, minX, minY, maxX, maxY) <= r2) out.push({ building: b, index: k });
            }
        }
        return out;
    }

    static getPolygonsInRect(minX, minY, maxX, maxY, out = [], touch = true, cos = 1, sin = 0) {
        const a = frameRectToLocalAABB(cos, sin, minX, minY, maxX, maxY, 0);
        const cand = this.polyHash.queryRect(a.minX, a.minY, a.maxX, a.maxY, _selBuf);
        const aligned = cos === 1 && sin === 0;

        out.length = 0;
        for (let i = 0; i < cand.length; i++) { 
            const b = cand[i];

            if (boxInsideFrameRect(this.polyHash.box(b), cos, sin, minX, minY, maxX, maxY)) {
                out.push(b);                               // inteira dentro: serve nos dois modos
                continue;
            }
            if (!touch) {
                if (aligned) continue;                     // sem rotação, a caixa já decide
                if (polygonInsideRectF(b.vertices, cos, sin, minX, minY, maxX, maxY)) out.push(b);
                continue;
            }
            if (polygonTouchesRectF(b.vertices, cos, sin, minX, minY, maxX, maxY)) out.push(b);
        }
        return out;
    }

    static setEditing(on) {
        if (this.editing === on) return;
        this.editing = on;
        if (!on) this.hovered = null;
        for (const b of Object.values(this.buildings)) b.updateGraphics();
    }

    static setHoverVertex(hit) {
        const prev = this.hovered;
        if (prev?.building === hit?.building && prev?.index === hit?.index) return;
        this.hovered = hit ? { building: hit.building, index: hit.index } : null;
        prev?.building.updateGraphics();
        hit?.building.updateGraphics();
    }

    static getOverlappingVertex(coordinate) {
        const pos = coordinate.peekNormal();
        const R = VERTEX_GRAB_PX / Graficos.zoom;
        const cand = this.polyHash.queryRect(pos.x - R, pos.y - R, pos.x + R, pos.y + R, _polyBuf);

        let best = null, bestD = R * R;
        for (let i = 0; i < cand.length; i++) {
            const b = cand[i];
            for (let k = 0; k < b.vertices.length; k++) {
                const v = b.vertices[k].pos;
                const d = (v.x - pos.x) ** 2 + (v.y - pos.y) ** 2;
                if (d <= bestD) { best = { building: b, index: k }; bestD = d; }
            }
        }
        return best;
    }

    /** Depois de mexer na parede: as entradas escorregam para o ponto mais próximo dela. */
    static reattachEntrances(building) {
        for (const ref of [...building.entrances]) {
            if (!ref.enabled) continue;
            const p = ref.coordinate.pos;
            const q = closestOnPolygon(p.x, p.y, building.vertices);
            ref.move(newCoord(q.x, q.y, "normal"));
        }
    }

    static syncPin(building) {
        if (building.id === -1 || !building.coordinate) {
            this.pinHash.delete(building);
            return;
        }
        const p = building.coordinate.pos;
        this.pinHash.set(building, p.x, p.y);
    }

    static notePin(building) {
        this.maxPinReach = Math.max(this.maxPinReach, Graficos.pinReach(building.graphics));
        this.syncPin(building);
    }

    static setRelated(obj, state) {
        this.setRelation(obj, obj.building, state);
    }

    static getBannerless() {
        let flat = Object.values(this.buildings);
        let bannerless = flat.filter((element) => {return !(element.banner.detailed)});
        return bannerless;
    }

    static indexPolygon(building) {
        if (building.id === -1 || !building.closed) return;
        const b = building.bounds();
        this.polyHash.set(building, b.minX, b.minY, b.maxX, b.maxY);
    }

    static unindexPolygon(building) {
        this.polyHash.delete(building);
    }

    static track(building) {
        if (building.id !== -1) return;
        building.id = this.idTracker;
        this.buildings[this.idTracker] = building;
        this.idTracker += 1;
        this.indexPolygon(building);
        this.syncPin(building);
    }

    static untrack(building) {
        delete this.buildings[building.id];
        building.id = -1;
        this.pinHash.delete(building);
        this.polyHash.delete(building);
    }

    static setRelation(obj, building, state) {
        building.entrances = state
            ? addObj(building.entrances, obj)
            : removeObj(building.entrances, obj);
    }
    // (setRelated pode ser apagado: ninguém mais o usa)

    /** Parede mais próxima (dentro de R, unidades do mundo) entre os polígonos fechados. */
    static nearestWall(x, y, R) {
        const cand = this.polyHash.queryRect(x - R, y - R, x + R, y + R, _wallBuf);
        let best = null, bestD = R * R;
        for (let i = 0; i < cand.length; i++) {
            const b = cand[i];
            const p = closestOnPolygon(x, y, b.vertices);
            if (p.d <= bestD) {
                best = { building: b, point: { x: p.x, y: p.y } };
                bestD = p.d;
            }
        }
        return best;
    }

    /** Construção sob o ponto (dentro do polígono ou na borda). Maior id = mais por cima. */
    static getOverlappingBuildings(coordinate, all) {
        const pos = coordinate.peekNormal();
        const pad = 4;
        const cand = this.polyHash.queryRect(pos.x - pad, pos.y - pad, pos.x + pad, pos.y + pad, _polyBuf);

        let best = null, hits = null;
        for (let i = 0; i < cand.length; i++) {
            const b = cand[i];
            const hit = pointInPolygon(pos.x, pos.y, b.vertices) ||
                        closestOnPolygon(pos.x, pos.y, b.vertices).d <= pad * pad;
            if (!hit) continue;
            if (all) (hits ??= []).push(b);
            else if (!best || b.id > best.id) best = b;
        }

        if (all) return hits ? hits.sort(byIdDesc) : false;
        return best || false;
    }

    /** Depois de fechar um polígono: referências próximas das paredes novas grudam. */
    static snapReferencesTo(building) {
        const b = building.bounds();
        const R = WALL_SNAP_PX / Graficos.zoom;
        const refs = Referencer.dotHash.queryRect(b.minX - R, b.minY - R, b.maxX + R, b.maxY + R, []);
        const moved = [];
        for (const ref of refs) {
            const rep = ref.move(ref.coordinate, false, true);
            if (rep) moved.push({ dot: ref, before: rep[1], after: rep[2] });
        }
        return moved;
    }

    
    static getOverlappingPins(coordinate, all) {
        const pos = coordinate.peekNormal();
        const R = (this.maxPinReach * PIN_REACH_MARGIN) / Graficos.zoom;
        const cand = this.pinHash.queryRect(pos.x - R, pos.y - R, pos.x + R, pos.y + R, _pinBuf);

        let best = null, hits = null;
        for (let i = 0; i < cand.length; i++) {
            const building = cand[i];
            if (!Graficos.collisionTest(building.graphics, pos)) continue;
            if (all) (hits ??= []).push(building);
            else if (!best || building.id > best.id) best = building;
        }

        if (all) return hits ? hits.sort(byIdDesc) : false;
        return best || false;
    }
}

export class Reference {
    constructor(coordinate, { snap = false } = {}) {
        this.alpha = 1;
        this.colorOut = Palette.reference.out;
        this.colorIn = Palette.reference.in;
        this.enabled = true;
        this.size = 10;
        this.isEntrance = false;
        this.building = false;
        this.selected = false;

        this.id = -1;
        this.uid = Referencer.uidTracker++;
        this.z = 0;
        this.connections = [];
        this.hover = 0;
        this.hoverTime = .2;
        Referencer.track(this);

        
        this.positionTracked = false;
        this.move(coordinate, true, snap);
        
        this.graphics = null;
        if (page == "editor") {
            this.graphics = Graficos.createReference();
        }
        this.name = "";
        this.tint = 0x000000;

        this.banner = new Banner();

        this.updateGraphics();
    }

    setColor(color) {
        this.tint = color;
        this.updateGraphics();
    }

    setName(name) {
        if (page == "main") {
            this.size = 1;
            this.name = name;
            this.graphics = Graficos.createPin(name);
            Referencer.notePin(this);          // entra no pinHash e atualiza o alcance máximo
            this.updateGraphics();
        }
    }

    hoverAdd() {
        this.hover += 1;
        let cap = this.hoverTime * 30;

        if (this.hover >= cap) {
            this.hover = cap;
        }
        this.hoverUpdate();
    }
    hoverDec() {
        this.hover -= 1;
        if (this.hover <= 0) {
            this.hover = 0;
        }

        this.hoverUpdate();
    }
    hoverUpdate() {
        let ms = this.hoverTime * 1000;
        let t = this.hover * (1000 / 30) / ms;
        t = ease(t);
        this.size = page == "editor" ? 10 + t * 5: 1 + t * .2;
        this.tint = interpCol(0x000000, Palette.reference.hover, t);;
        this.updateGraphics();
    }

    buildData() {
        return {
            coordinate: this.coordinate,
            colorOut: this.colorOut,
            colorIn: this.colorIn,
            size: this.size,
            alpha: this.alpha,
            isEntrance: this.isEntrance,
            color: this.tint
        }
    }

    updateGraphics() {
        if (this.enabled) {
            if (page == "main") {
                if(this.name) {
                    Graficos.renderPin(this.graphics, this.buildData());
                }
                return;
            }
            Graficos.renderReference(this.graphics, this.buildData());

            for(const connection of this.connections) {
                connection.updateGraphics();
            }
        } else {
            Graficos.clearReference(this.graphics);
        }
    }

    bringToFront() {
        Referencer.raise(this);
        Graficos.BringToFrontReference(this.graphics);
    }
    
    validatePos(snap = false) {
        return this.move(this.coordinate, false, snap);
    }

    move(coord, create = false, snap = false) {
        const p = coord.peekNormal();
        const R = snap ? WALL_SNAP_PX / Graficos.zoom : WALL_EPS;
        const hit = Buildings.nearestWall(p.x, p.y, R);
        const pos = hit ? hit.point : { x: p.x, y: p.y };
        const building = hit ? hit.building : false;

        let report = false;
        if (this.coordinate) {
            const old = this.coordinate.pos;
            if (old.x !== pos.x || old.y !== pos.y || this.building !== building) {
                report = [this, { x: old.x, y: old.y }, { x: pos.x, y: pos.y }];
            }
        }

        if (this.building !== building) {
            if (this.building) Buildings.setRelation(this, this.building, false);
            if (building) Buildings.setRelation(this, building, true);
        }
        this.building = building;
        this.isEntrance = !!building;

        this.coordinate = newCoord(pos.x, pos.y, "normal");

        if (this.enabled) Referencer.addPositionTrack(this);

        if (create) return report;

        for (const connection of this.connections) Connections.reindex(connection);
        this.updateGraphics();
        this.bringToFront();

        return report;
    }
    
    enable() {
        this.enabled = true;
        this.updateGraphics();
        
        Referencer.track(this);
        Referencer.addPositionTrack(this);
    }
    disable() {
        this.enabled = false;
        this.updateGraphics();
        
        Referencer.untrack(this);
        Referencer.removePositionTrack(this);
        
    }
    
    destroy() {
        let copyConnections = [...this.connections];
        for(const connection of copyConnections) {
            connection.destroy();
        }

        Referencer.untrack(this);
        Referencer.removePositionTrack(this);

        Graficos.destroyReference(this.graphics);
    }
}

export class Connection {
    constructor(start, end) {
        this.alpha = 1;
        this.colorOut = Palette.connection.out;
        this.colorIn = Palette.connection.in;
        this.enabled = true;
        this.size = 4;

        this.start = start;
        this.end = end;

        this.id = -1;
        this.uid = Connections.uidTracker++;
        this.tracked = false;
        this.hover = 0;
        this.hoverTime = .2;
        Connections.track(this);
        Connections.setRelated(this, true);
        
        this.positionTracked = false;
        
        this.graphics = Graficos.createConnection();
        
        this.updateGraphics();
    }

    hoverAdd() {
        this.hover += 1;
        let cap = this.hoverTime * 30;

        if (this.hover >= cap) {
            this.hover = cap;
        }
        this.hoverUpdate();
    }
    hoverDec() {
        this.hover -= 1;
        if (this.hover <= 0) {
            this.hover = 0;
        }

        this.hoverUpdate();
    }
    hoverUpdate() {
        let ms = this.hoverTime * 1000;
        let t = this.hover * (1000 / 30) / ms;
        t = ease(t);
        this.size = 4 + t * 5;
        this.updateGraphics();
    }
    
    buildData() {
        let start = this.start.coordinate;
        let end = this.end.coordinate;
        return {
            colorOut: this.colorOut,
            colorIn: this.colorIn,
            alpha: this.alpha,
            size: this.size,
            points: [start, end],
        }
    }
    
    updateGraphics() {
        if (this.enabled && this.end.enabled && this.start.enabled) {
            if (page == "main") {
                return;
            }
            Graficos.renderConnection(this.graphics, this.buildData());
        } else {
            Graficos.clearConnection(this.graphics);
        }
    }

    enable() {
        this.enabled = true;
        this.updateGraphics();
        Connections.track(this);
    }
    disable() {
        this.enabled = false;
        this.updateGraphics();
        Connections.untrack(this);
    }
    
    destroy() {
        Graficos.destroyConnection(this.graphics);
        Connections.setRelated(this, false);
        Connections.untrack(this);
    }
}

export class Building {
    constructor(coordinate, name) {
        this.enabled = true;
        this.pinSize = 1;
        this._helperCreate = null;
        this.name = name;

        this.id = -1;
        this.vertices = [];      // Coordinates sempre em "normal"
        this.closed = false;
        this.entrances = [];
        this.hover = 0;
        this.hoverTime = .2;
        Buildings.track(this);

        this.move(coordinate, true);

        this.graphics = Graficos.createPin(name);
        Buildings.notePin(this);

        this.alpha = 1;
        this.colorOut = Palette.building.out;
        this.colorIn = Palette.building.in;
        this.colorInBase = Palette.building.in;
        this.borderSize = 8;
        this.radius = 5;
        this.tint = 0x000000;

        this.polygonGraphics = Graficos.createPoly();
        this.closeHandle = page === "editor" ? new CloseHandle(this) : null; 
        this.banner = new Banner();

        this.updateGraphics();
    }

    hoverAdd() {
        this.hover += 1;
        const cap = this.hoverTime * 30;
        if (this.hover >= cap) this.hover = cap;
        this.hoverUpdate();
    }
    hoverDec() {
        this.hover -= 1;
        if (this.hover <= 0) this.hover = 0;
        this.hoverUpdate();
    }
    hoverUpdate() {
        const ms = this.hoverTime * 1000;
        const t = ease(this.hover * (1000 / 30) / ms);
        this.pinSize = 1 + t * .2;
        this.tint = interpCol(0x000000, Palette.building.hover, t);
        this.colorIn = interpCol(this.colorInBase, Palette.building.hoverFill, t);
        this.updateGraphics();
    }

    // ---- polígono ----

    bounds() {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const { pos } of this.vertices) {
            minX = Math.min(minX, pos.x); maxX = Math.max(maxX, pos.x);
            minY = Math.min(minY, pos.y); maxY = Math.max(maxY, pos.y);
        }
        return { minX, minY, maxX, maxY };
    }

    area() {
        return polygonArea(this.vertices.map(v => v.pos));
    }

    addVertex(coord) {
        coord.convertTo("normal");
        this.vertices.push(coord);
        this.updateGraphics();
    }

    removeLastVertex() {
        this.vertices.pop();
        this.updateGraphics();
    }

    close() {
        this.closed = true;
        Buildings.indexPolygon(this);
        this.updateGraphics();
    }

    reopen() {
        this.closed = false;
        Buildings.unindexPolygon(this);
        this.updateGraphics();
    }

    /** Usado no load: pontos {x, y} em "normal". */
    setPolygon(points) {
        this.vertices = points.map(p => newCoord(p.x, p.y, "normal"));
        this.closed = this.vertices.length >= 3;
        if (this.closed) Buildings.indexPolygon(this);
        this.updateGraphics();
    }

    moveVertex(index, coord) {
        coord.convertTo("normal");
        this.vertices[index] = newCoord(coord.pos.x, coord.pos.y, "normal");
        if (this.closed) Buildings.indexPolygon(this);   // o hash precisa estar certo antes das entradas
        this.updateGraphics();
    }

    rename(name) {
        this.name = name;
        Graficos.setPinText(this.graphics, name);
        Buildings.notePin(this);   // recalcula o alcance do pino com o novo texto
        this.updateGraphics();
    }

    // ---- gráficos ----

    buildData() {
        return { size: this.pinSize, coordinate: this.coordinate, color: this.tint };
    }

    setColor(color) {
        this.tint = color;
        this.updateGraphics();
    }

    updateGraphics() {
        this.closeHandle?.updateGraphics();

        if (!this.enabled) {
            Graficos.clearPin(this.graphics);
            Graficos.clearPoly(this.polygonGraphics);
            return;
        }

        Graficos.renderPin(this.graphics, this.buildData());

        // na página main só o pin aparece (como antes)
        if (page !== "editor" || this.vertices.length === 0) {
            Graficos.clearPoly(this.polygonGraphics);
            return;
        }

        const data = {
            points: this.vertices,
            alpha: this.alpha,
            colorOut: this.colorOut,
            colorIn: this.colorIn,
            borderSize: this.borderSize,
            radius: this.radius,
            handles: this.closed && (Buildings.editing) && page === "editor",
            handleActive: Buildings.hovered?.building === this ? Buildings.hovered.index : -1,
        };
        
        if (this.closed) {
            Graficos.renderPoly(this.polygonGraphics, data);
        } else {
            Graficos.renderDraft(this.polygonGraphics, { ...data, closable: this.vertices.length >= 3 });
        }
    }

    enable() {
        this.enabled = true;
        Buildings.track(this);
        this.updateGraphics();
    }
    disable() {
        this.enabled = false;
        this.updateGraphics();
        Buildings.untrack(this);
    }

    move(coordinate, create = false) {
        this.coordinate = coordinate;
        this.coordinate.convertTo("normal");
        Buildings.syncPin(this);

        if (!create) {
            this.updateGraphics();
        }
    }

    destroy() {
        this.closeHandle?.destroy();
        Graficos.destroyPin(this.graphics);
        Graficos.destroyPoly(this.polygonGraphics);
        Buildings.untrack(this);
    }
}

export class Banner {
    constructor() {
        this.detailed = false;
        this.title = "";
        this.titleAlias = [];
        this.description = "";
        this.image = false;
    }
}