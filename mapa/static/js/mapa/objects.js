import * as Graficos from "./graficos.js";
import * as Geometria from "./editor/geometria.js";
import { SpatialHash } from "./spatial-hash.js";
import { getShortestPath } from "./rota.js";

export const BANNER_TABS = [
    { id: "referencia",     label: "Referência",     placeholder: "Nome do ponto de referência", icon: "map-pin",        color: "#7ddd3d", compColor: "#9ef763", pinColor: "#4edd3b", uses: ["imagem", "título", "palavras-chave", "descrição", "prioridade"], requires: ["imagem", "título", "descrição"] },
    { id: "construcao",     label: "Construção",     placeholder: "Nome da construção",          icon: "building",       color: "#e8730c", compColor: "#f7a259", pinColor: "#ffa33b", uses: ["imagem", "título", "palavras-chave", "descrição", "prioridade"], requires: ["imagem", "título", "descrição"] },
    { id: "titulo",         label: "Título",         placeholder: "Nome",                        icon: "heading",        color: "#3d6fe0", compColor: "#84a8fd", pinColor: "#4677e0", uses: ["imagem", "título", "palavras-chave", "prioridade"],              requires: ["imagem", "título"] },
    { id: "banheiro",       label: "Banheiro",       placeholder: "Nome de busca",               icon: "restroom",       color: "#e0489a", compColor: "#f588c2", pinColor: "#c757c1", uses: ["imagem", "título", "prioridade"],                                requires: ["imagem", "título"] },
    { id: "laboratorio",    label: "Laboratório",    placeholder: "Nome do laboratório",         icon: "flask",          color: "#7c4ddb", compColor: "#b394f3", pinColor: "#cb58ee", uses: ["imagem", "título", "palavras-chave", "descrição", "prioridade"], requires: ["imagem", "título", "descrição"] },
    { id: "estacionamento", label: "Estacionamento", placeholder: "Nome",                        icon: "square-parking", color: "#0e8fa3", compColor: "#5cbdcc", pinColor: "#755be9", uses: ["imagem", "título", "descrição", "prioridade"],                   requires: ["imagem", "título", "descrição"] },
    { id: "refeitorio",     label: "Refeitório",     placeholder: "Nome do refeitório",          icon: "utensils",       color: "#c0da2d", compColor: "#def369", pinColor: "#e6d862", uses: ["imagem", "título", "palavras-chave", "descrição", "prioridade"], requires: ["imagem", "título", "descrição"] },
];

export const Palette = Object.freeze({
    reference:  { out: 0x1a7f37, in: 0x4cc36a, hover: 0x00aaff },   // referências
    connection: { out: 0x1a7f37, in: 0x4cc36a },                    // conexões (a rede de rotas)
    building:   { out: 0xe8730c, in: 0xfcd5a8, hover: 0xc2410c, hoverFill: 0xffe8cc },
    route:      { out: 0x1a7f37, in: 0x4cc36a },                    // rota calculada (página main)
    accent:     { out: 0x16a34a, in: 0xbbf7d0 },                    // alvo clicável (fechar a forma)
    selection:  { out: 0x3d97e0, in: 0xa4d1f5 },
    hardSelection: { out: 0x134ec3, in: 0x5c8ff5 },
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
export const MERGE_RADIUS_PX = 15;
export const SPLIT_RADIUS_PX = 15;
const MID_GRAB_PX = 8;

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
            priority: banner.priority,
            mode: banner.mode
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
        let buildMap = {};
        
        if (data.buildings) {
            for (const key of Object.keys(data.buildings)) {
                let build = data.buildings[key];
                
                let buildCoord = newCoord(build.pin.x, build.pin.y, "normal");
                
                let building = new Building(buildCoord, build.name);
                buildMap[key] = building;
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
                    if (banner.mode) {
                        building.banner.mode = banner.mode;
                    }
                    if (banner.priority) {
                        building.banner.priority = banner.priority;
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
                if (banner.mode) {
                    refObject.banner.mode = banner.mode;
                }
                if (banner.priority) {
                    refObject.banner.priority = banner.priority;
                }
                if (banner.image) {
                    const imageFile = banner.image 
                    ? await urlToFile(banner.image) 
                    : null;
                    refObject.banner.image = imageFile;
                    refObject.banner.detailed = true;
                }
                refObject.updateGraphics();
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
        for(let ref of Object.values(refMap)) {
            ref.updateGraphics();
        }
        for(let build of Object.values(buildMap)) {
            build.rename(build.name);
        }
        Graficos.Zoom(Graficos.zoom);
        Buildings.notePin(this);

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
                Graficos.destroyGuide(graphics);
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

const ANGLE_SNAP = Math.PI / 12;   // Shift ao girar a seleção: passos de 15°

const ROTATE_CURSOR = (() => {
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
        `<path d="M20 12a8 8 0 1 1-2.6-5.9" fill="none" stroke="white" stroke-width="4.5" stroke-linecap="round"/>` +
        `<path d="M20 12a8 8 0 1 1-2.6-5.9" fill="none" stroke="black" stroke-width="2" stroke-linecap="round"/>` +
        `<path d="M20 3v5h-5" fill="none" stroke="white" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<path d="M20 3v5h-5" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, crosshair`;
})();

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
    static base = null;

    static touch = true;
    static _rect = { minX: NaN, minY: NaN, maxX: NaN, maxY: NaN };
    static _zoom = NaN;

    static boxRect = null;                 // retângulo desenhado (com folga), no frame da tela
    static _boxRect = { x0: 0, y0: 0, x1: 0, y1: 0 };
    static _f = { x: 0, y: 0 };
    static handlePx = 7;                   // tolerância para agarrar a borda (pixels de tela)
    static resize = null;                  // estado do gesto em andamento
    static get resizing() { return this.resize !== null; }

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

    static start(coordinate, { keep = false } = {}) {
        this.startCoord = coordinate;
        this.startCoord.convertTo("normal");
        this.currCoord = null;

        if (keep) {
            // guarda o grupo atual: o arrasto soma a ele em vez de substituí-lo
            const s = this.selected;
            this.base = {
                references: [...s.references],
                build: [...s.build],
                buildVertices: s.buildVertices.map(v => ({ building: v.building, index: v.index })),
            };
            this._rect.minX = NaN;      // força recalcular o retângulo
        } else {
            this.base = null;
            this.clearSelection();
        }
    }

    static release() {
        this.startCoord = null;
        this.currCoord = null;
        this.base = null;
        this.updateGraphics();
    }

    static move(coordinate, shift) {
        this.currCoord = coordinate;
        this.currCoord.convertTo("normal");
        this.updateSelection(shift);
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
        this.box = null;                 // ← de volta
        this.updateBoxGraphics();
    }

    static selectAll() {
        this.release();
        const sel = this.selected;
        sel.references.length = 0;
        sel.buildVertices.length = 0;
        sel.build.length = 0;
        for (const r of Object.values(Referencer.references)) sel.references.push(r);
        for (const b of Object.values(Buildings.buildings)) if (b.closed) sel.build.push(b);
        this.refreshBox(false);
    }

    static refreshBox(shift = this.vertexMode) {
        this.vertexMode = !!shift;
        this.box = this.selectionBox(this.selected, this._box, {
            vertices: this.vertexMode,
            buildings: !this.vertexMode,
        });
        this.updateBoxGraphics();
    }

    // ---- gráficos ----

    static ensureGraphics() {
        if (this.graphics) return;
        this.graphics = Graficos.createGuide();
    }

    static alpha = [0.6, 1];
    static colorIn = Palette.hardSelection.in;
    static colorOut = Palette.hardSelection.out;
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

    static updateSelection(vm) {
        if (!this.startCoord || !this.currCoord) return;
        this.syncFrame();
        const c = this._cos, s = this._sin;

        const a = this.startCoord.pos, b = this.currCoord.pos;
        const ax = c * a.x - s * a.y, ay = s * a.x + c * a.y;
        const bx = c * b.x - s * b.y, by = s * b.x + c * b.y;
        const minX = Math.min(ax, bx), maxX = Math.max(ax, bx);
        const minY = Math.min(ay, by), maxY = Math.max(ay, by);

        const r = this._rect, zoom = Graficos.zoom, mode = !!vm;
        if (r.minX === minX && r.minY === minY && r.maxX === maxX && r.maxY === maxY &&
            this._zoom === zoom && this._shift === mode) return;
        r.minX = minX; r.minY = minY; r.maxX = maxX; r.maxY = maxY;
        this._zoom = zoom;
        this._shift = mode;

        const t = this.touch;
        Referencer.getReferencesInRect(minX, minY, maxX, maxY, this.selected.references, t, c, s);
        Buildings.getVerticesInRect(minX, minY, maxX, maxY, this.selected.buildVertices, t, c, s);
        Buildings.getPolygonsInRect(minX, minY, maxX, maxY, this.selected.build, t, c, s);

        if (this.base) this.mergeBase(mode);
        this.refreshBox(mode);
    }

    /** Soma o grupo anterior ao resultado da região (sem duplicar). */
    static mergeBase(vm) {
        const base = this.base, sel = this.selected;

        for (const r of base.references) {
            if (!sel.references.includes(r)) sel.references.push(r);
        }
        if (vm) {
            for (const v of base.buildVertices) {
                if (!sel.buildVertices.some(x => x.building === v.building && x.index === v.index)) {
                    sel.buildVertices.push(v);
                }
            }
        } else {
            for (const b of base.build) {
                if (!sel.build.includes(b)) sel.build.push(b);
            }
        }
    }

    /** A câmera girou (chamado por Graficos.Rotation). */
    static onCameraRotate() {
        if (!this.syncFrame()) return;
        if (this.resize) this.cancelResize();
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
        if (this.box && this.syncFrame()) { this.refreshBox(); return; }   // câmera girou

        const b = this.box;
        if (!b) this.boxRect = null;
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

        // retângulo desenhado: é nele que o hitHandle procura a borda
        const br = this._boxRect;
        br.x0 = x0 - pad; br.y0 = y0 - pad; br.x1 = x1 + pad; br.y1 = y1 + pad;

        if (this.resize?.cur) {                               // <-- novo
            const k = this.resize.cur;
            br.x0 = k.x0; br.y0 = k.y0; br.x1 = k.x1; br.y1 = k.y1;
        }
        this.boxRect = br;

        Graficos.renderSelect(this.boxGraphics, {
            points: [[br.x0, br.y0, br.x1, br.y1]],
            frameRotation: this._rot,
            alpha: this.boxAlpha,
            colorOut: this.boxColorOut,
            colorIn: this.boxColorIn,
            borderSize: 2,
            radius: 2,
            handles: false,
            handleActive: false
        });

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

    static pointerFrame(clientX, clientY, out) {
        const p = Graficos.getNormalizedCoordinates({ x: clientX, y: clientY });
        out.x = this._cos * p.x - this._sin * p.y;
        out.y = this._sin * p.x + this._cos * p.y;
        return out;
    }

    /** "n" "s" "e" "w" "ne" "nw" "se" "sw" ou null. */
    static hitHandle(clientX, clientY) {
        const r = this.boxRect;
        if (!r || this.startCoord) return null;           // sem caixa, ou arrastando uma região

        const f = this.pointerFrame(clientX, clientY, this._f);
        const tol = this.handlePx / Graficos.zoom;
        if (f.x < r.x0 - tol || f.x > r.x1 + tol || f.y < r.y0 - tol || f.y > r.y1 + tol) return null;

        const dl = Math.abs(f.x - r.x0), dr = Math.abs(f.x - r.x1);
        const dt = Math.abs(f.y - r.y0), db = Math.abs(f.y - r.y1);
        const xs = Math.min(dl, dr) <= tol ? (dl <= dr ? "w" : "e") : "";
        const ys = Math.min(dt, db) <= tol ? (dt <= db ? "n" : "s") : "";
        return (ys + xs) || null;
    }

    static rotatePx = 26;   // alcance da zona de rotação além dos cantos (px de tela)

    /** { kind: "resize", handle } | { kind: "move" } | { kind: "rotate" } | null */
    static hitZone(clientX, clientY) {
        const r = this.boxRect;
        if (!r || this.startCoord) return null;

        const handle = this.hitHandle(clientX, clientY);
        if (handle) return { kind: "resize", handle };

        const f = this.pointerFrame(clientX, clientY, this._f);

        if (f.x >= r.x0 && f.x <= r.x1 && f.y >= r.y0 && f.y <= r.y1) {
            return { kind: "move" };
        }

        // fora do retângulo, na "quina" (fora nos dois eixos) e perto do canto
        const outX = f.x < r.x0 || f.x > r.x1;
        const outY = f.y < r.y0 || f.y > r.y1;
        if (outX && outY) {
            const cx = f.x < r.x0 ? r.x0 : r.x1;
            const cy = f.y < r.y0 ? r.y0 : r.y1;
            if (Math.hypot(f.x - cx, f.y - cy) <= this.rotatePx / Graficos.zoom) {
                return { kind: "rotate" };
            }
        }
        return null;
    }

    static cursorForZone(zone) {
        if (!zone) return "";
        if (zone.kind === "resize") return this.cursorFor(zone.handle);
        if (zone.kind === "move") return "move";
        return ROTATE_CURSOR;
    }

    static cursorFor(handle) {
        switch (handle) {
            case "n": case "s": return "ns-resize";
            case "e": case "w": return "ew-resize";
            case "nw": case "se": return "nwse-resize";
            default: return "nesw-resize";                // ne, sw
        }
    }

    static captureLayout() {
        const R = this.resize;
        return {
            builds: R.builds.map((rec) => ({
                building: rec.building,
                verts: rec.building.vertices.map((v) => ({ x: v.pos.x, y: v.pos.y })),
                pin: rec.pin ? { x: rec.building.coordinate.pos.x, y: rec.building.coordinate.pos.y } : null,
            })),
            refs: [...R.free, ...R.owned, ...R.slide].map((o) => ({
                ref: o.ref, x: o.ref.coordinate.pos.x, y: o.ref.coordinate.pos.y,
            })),
        };
    }

    /** Aplica posições guardadas: construções primeiro, para as entradas reencontrarem a parede. */
    static applyLayout(layout) {
        for (const b of layout.builds) {
            b.building.setPolygon(b.verts);
            if (b.pin) b.building.move(newCoord(b.pin.x, b.pin.y, "normal"));
        }
        for (const r of layout.refs) r.ref.move(newCoord(r.x, r.y, "normal"));
    }

    static beginGesture(zone, coord) {
        this.syncFrame();
        const sel = this.selected, vm = this.vertexMode;
        const c = this._cos, s = this._sin;
        const p = coord.peekNormal();

        // referência = retângulo VISÍVEL (com folga)
        const r = this.boxRect;
        const ref = r
            ? { minX: r.x0, minY: r.y0, maxX: r.x1, maxY: r.y1 }
            : { ...this.box };

        const grab = { x: c * p.x - s * p.y, y: s * p.x + c * p.y };
        const pivot = { x: (ref.minX + ref.maxX) / 2, y: (ref.minY + ref.maxY) / 2 };

        const R = {
            kind: zone.kind,
            handle: zone.handle ?? "",
            vm, c, s,
            box: ref,
            cur: null,                                   // retângulo atual (só no resize)
            grab,                                        // ponteiro no frame da tela
            grabN: { x: p.x, y: p.y },                   // ponteiro no espaço do mapa (move)
            pivot,                                       // centro, frame da tela (rotate)
            pivotN: { x: c * pivot.x + s * pivot.y, y: -s * pivot.x + c * pivot.y },
            angle0: Math.atan2(grab.y - pivot.y, grab.x - pivot.x),
            last: null,
            builds: [], free: [], owned: [], slide: [],
            before: null,
        };
        const taken = new Set();
        const snap = (r) => ({ ref: r, x: r.coordinate.pos.x, y: r.coordinate.pos.y });

        if (!vm) {
            // modo polígono: construções inteiras; as entradas delas acompanham
            for (const b of sel.build) {
                if (!b.enabled) continue;
                const verts = b.vertices.map((v) => ({ x: v.pos.x, y: v.pos.y }));
                const rec = {
                    building: b, verts, idx: null,
                    pin: { x: b.coordinate.pos.x, y: b.coordinate.pos.y },
                    centroid: polygonCentroid(verts), dx: 0, dy: 0,
                };
                R.builds.push(rec);
                for (const r of b.entrances) {
                    if (!r.enabled || taken.has(r)) continue;
                    taken.add(r);
                    R.owned.push({ ...snap(r), rec });
                }
            }
        } else {
            // modo vértice: só os vértices escolhidos; as entradas deslizam na parede
            const groups = new Map();
            for (const { building, index } of sel.buildVertices) {
                if (!building.enabled) continue;
                let g = groups.get(building);
                if (!g) {
                    g = {
                        building, idx: new Set(), pin: null, centroid: null, dx: 0, dy: 0,
                        verts: building.vertices.map((v) => ({ x: v.pos.x, y: v.pos.y })),
                    };
                    groups.set(building, g);
                }
                g.idx.add(index);
            }
            const picked = new Set(sel.references);
            for (const g of groups.values()) {
                R.builds.push(g);
                for (const r of g.building.entrances) {
                    if (!r.enabled || picked.has(r)) continue;
                    R.slide.push({ ...snap(r), rec: g });
                }
            }
        }

        for (const r of sel.references) {
            if (r.enabled && !taken.has(r)) R.free.push(snap(r));
        }

        this.resize = R;
        R.before = this.captureLayout();
    }

    static updateResize(coord, shift) {
        const R = this.resize;
        if (!R) return;
        R.last = coord;

        const { c, s } = R;
        const p = coord.peekNormal();
        const o = { x: 0, y: 0 };
        let T;

        if (R.kind === "move") {
            const dx = p.x - R.grabN.x, dy = p.y - R.grabN.y;
            T = (x, y) => { o.x = x + dx; o.y = y + dy; return o; };
            shift = false;                               // sempre rígido: usa o ramo "T em tudo"

        } else if (R.kind === "rotate") {
            const fx = c * p.x - s * p.y, fy = s * p.x + c * p.y;
            let d = Math.atan2(fy - R.pivot.y, fx - R.pivot.x) - R.angle0;
            if (shift) d = Math.round(d / ANGLE_SNAP) * ANGLE_SNAP;   // Shift = trava em 15°
            const cd = Math.cos(d), sd = Math.sin(d);
            const px = R.pivotN.x, py = R.pivotN.y;
            T = (x, y) => {
                const rx = x - px, ry = y - py;
                o.x = px + cd * rx - sd * ry;
                o.y = py + sd * rx + cd * ry;
                return o;
            };
            shift = false;

        } else {                                         // resize (como antes)
            const b = R.box;
            const dx = (c * p.x - s * p.y) - R.grab.x;
            const dy = (s * p.x + c * p.y) - R.grab.y;

            const h = R.handle;
            const [nx0, nx1] = resizeAxis(b.minX, b.maxX, h.includes("w"), h.includes("e"), dx);
            const [ny0, ny1] = resizeAxis(b.minY, b.maxY, h.includes("n"), h.includes("s"), dy);

            const wx = b.maxX - b.minX, wy = b.maxY - b.minY;
            const sx = wx > 1e-6 ? (nx1 - nx0) / wx : 1;
            const sy = wy > 1e-6 ? (ny1 - ny0) / wy : 1;
            R.cur = { x0: nx0, y0: ny0, x1: nx1, y1: ny1 };

            const cxo = (b.minX + b.maxX) / 2, cyo = (b.minY + b.maxY) / 2;
            const cxn = (nx0 + nx1) / 2, cyn = (ny0 + ny1) / 2;

            T = (x, y) => {
                const fx = c * x - s * y, fy = s * x + c * y;
                const gx = cxn + (fx - cxo) * sx, gy = cyn + (fy - cyo) * sy;
                o.x = c * gx + s * gy;
                o.y = -s * gx + c * gy;
                return o;
            };
        }

        // 1) construções (antes das referências)
        for (const rec of R.builds) {
            let pts, pin = null;

            if (rec.idx) {                                     // modo vértice
                pts = rec.verts.map((v, i) => {
                    if (!rec.idx.has(i)) return { x: v.x, y: v.y };
                    T(v.x, v.y);
                    return { x: o.x, y: o.y };
                });
            } else if (shift) {                                // resize rígido (Shift)
                T(rec.centroid.x, rec.centroid.y);
                rec.dx = o.x - rec.centroid.x;
                rec.dy = o.y - rec.centroid.y;
                pts = rec.verts.map((v) => ({ x: v.x + rec.dx, y: v.y + rec.dy }));
                pin = { x: rec.pin.x + rec.dx, y: rec.pin.y + rec.dy };
            } else {                                           // estica / move / gira
                pts = rec.verts.map((v) => { T(v.x, v.y); return { x: o.x, y: o.y }; });
                T(rec.pin.x, rec.pin.y);
                pin = { x: o.x, y: o.y };
            }

            rec.building.setPolygon(pts);
            if (pin) rec.building.move(newCoord(pin.x, pin.y, "normal"));
        }

        // 2) entradas que acompanham a construção inteira
        for (const e of R.owned) {
            if (shift) e.ref.move(newCoord(e.x + e.rec.dx, e.y + e.rec.dy, "normal"));
            else { T(e.x, e.y); e.ref.move(newCoord(o.x, o.y, "normal")); }
        }
        // 3) entradas que deslizam na parede (modo vértice)
        for (const e of R.slide) {
            const q = closestOnPolygon(e.x, e.y, e.rec.building.vertices);
            e.ref.move(newCoord(q.x, q.y, "normal"));
        }
        // 4) referências selecionadas
        for (const f of R.free) {
            T(f.x, f.y);
            f.ref.move(newCoord(o.x, o.y, "normal"));
        }

        this.refreshBox();
    }

    static reapplyResize(shift) {
        if (this.resize?.last) this.updateResize(this.resize.last, shift);
    }

    /** Fim do gesto: { before, after } se algo mudou (para o desfazer), senão null. */
    static endResize() {
        const R = this.resize;
        if (!R) return null;

        const before = R.before;
        const after = this.captureLayout();
        this.resize = null;
        this.refreshBox();

        const moved =
            after.refs.some((a, i) => a.x !== before.refs[i].x || a.y !== before.refs[i].y) ||
            after.builds.some((a, i) =>
                a.verts.some((v, k) => v.x !== before.builds[i].verts[k].x || v.y !== before.builds[i].verts[k].y));
        return moved ? { before, after } : null;
    }

    static cancelResize() {
        const R = this.resize;
        if (!R) return;
        this.resize = null;
        this.applyLayout(R.before);
        this.refreshBox();
    }

    static pickAt(coord, vertices = false) {
        if (vertices) {
            const v = Buildings.getOverlappingVertex(coord);
            if (v) return { kind: "vertex", building: v.building, index: v.index };
        }
        const ref = Referencer.getOverlappingDots(coord, false);
        if (ref) return { kind: "reference", ref };
        if (vertices) return null;   // modo vértice: corpo/pin de construção não é alvo

        const b = Buildings.getOverlappingPins(coord) || Buildings.getOverlappingBuildings(coord, false);
        if (b && b.closed && b.enabled) return { kind: "building", building: b };
        return null;
    }

    static isSelected(item) {
        const sel = this.selected;
        switch (item.kind) {
            case "reference": return sel.references.includes(item.ref);
            case "building":  return sel.build.includes(item.building);
            case "vertex":    return sel.buildVertices.some(v => v.building === item.building && v.index === item.index);
        }
        return false;
    }

    /** Seleciona `item`. additive = soma ao grupo atual; senão substitui. */
    static pick(item, additive = false) {
        if (!item) return;
        this.release();

        const sel = this.selected;
        if (!additive) this.clearSelection();

        // construções inteiras e vértices não convivem; referências convivem com os dois
        const mode = item.kind === "vertex" ? true
                : item.kind === "building" ? false
                : this.vertexMode;
        if (mode !== this.vertexMode) {
            sel.build.length = 0;
            sel.buildVertices.length = 0;
        }

        if (!this.isSelected(item)) {
            if (item.kind === "reference") sel.references.push(item.ref);
            else if (item.kind === "building") sel.build.push(item.building);
            else sel.buildVertices.push({ building: item.building, index: item.index });
        }

        this._rect.minX = NaN;        // o próximo arrasto de região recalcula do zero
        this.refreshBox(mode);
    }

    static snapshot() {
        const s = this.selected, vm = this.vertexMode;
        return {
            vertexMode: vm,
            references: [...s.references],
            build: vm ? [] : [...s.build],
            buildVertices: vm ? s.buildVertices.map(v => ({ building: v.building, index: v.index })) : [],
        };
    }

    static sameSelection(a, b) {
        const sameList = (x, y) => x.length === y.length && x.every(i => y.includes(i));
        return sameList(a.references, b.references) &&
            sameList(a.build, b.build) &&
            a.buildVertices.length === b.buildVertices.length &&
            a.buildVertices.every(v => b.buildVertices.some(w => w.building === v.building && w.index === v.index));
    }

    static restoreSelection(snap) {
        this.release();
        const sel = this.selected;

        sel.references.length = 0;
        sel.build.length = 0;
        sel.buildVertices.length = 0;

        // ignora o que foi desabilitado (apagado) entretanto
        for (const r of snap.references) if (r.enabled) sel.references.push(r);
        for (const b of snap.build) if (b.enabled) sel.build.push(b);
        for (const v of snap.buildVertices) {
            if (v.building.enabled && v.building.vertices[v.index]) {
                sel.buildVertices.push({ building: v.building, index: v.index });
            }
        }

        this._rect.minX = NaN;
        this.onRestoreMode?.(snap.vertexMode);
        this.refreshBox(snap.vertexMode);
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

function polygonCentroid(pts) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const f = pts[j].x * pts[i].y - pts[i].x * pts[j].y;
        a += f;
        cx += (pts[j].x + pts[i].x) * f;
        cy += (pts[j].y + pts[i].y) * f;
    }
    if (Math.abs(a) < 1e-9) {                       // degenerado: média dos vértices
        let mx = 0, my = 0;
        for (const p of pts) { mx += p.x; my += p.y; }
        return { x: mx / pts.length, y: my / pts.length };
    }
    return { x: cx / (3 * a), y: cy / (3 * a) };
}

// Move a borda arrastada de um eixo. Nunca inverte nem colapsa; eixo degenerado vira translação.
function resizeAxis(lo, hi, grabLo, grabHi, d) {
    if (!grabLo && !grabHi) return [lo, hi];
    const span = hi - lo;
    if (span < 1e-6) return [lo + d, hi + d];
    const min = span * 0.02;
    return grabLo ? [Math.min(lo + d, hi - min), hi] : [lo, Math.max(hi + d, lo + min)];
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
        const cap = this.hoverTime * 30;
        if (this.hover >= cap) return;
        this.hover += 1;
        this.hoverUpdate();
    }
    hoverDec() {
        if (this.hover <= 0) return;
        this.hover -= 1;
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
        if (!this.end) return;
        Graficos.renderConnection(this.graphics, this.buildData());
    }

    destroy() {
        Graficos.destroyConnection(this.graphics);
    }
}

export class PhantomSplit {
    constructor() { this.point = null; this.a = null; this.b = null; }

    show(connection, x, y) {
        const pos = newCoord(x, y, "normal");
        if (!this.point) {
            this.point = new PhantomReference(pos);
            this.a = new PhantomConnection(connection.start);
            this.b = new PhantomConnection(this.point.coordinate);
        } else {
            this.point.setPosition(pos);          // troca o objeto de coordenada
        }
        this.a.start = connection.start;
        this.a.setEndPoint(this.point.coordinate);
        this.b.start = this.point.coordinate;
        this.b.setEndPoint(connection.end);
    }

    hide() {
        if (!this.point) return;
        this.point.destroy(); this.a.destroy(); this.b.destroy();
        this.point = this.a = this.b = null;
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
        const cap = this.hoverTime * 30;
        if (this.hover >= cap) return;
        this.hover += 1;
        this.hoverUpdate();
    }
    static hoverDec() {
        if (this.hover <= 0) return;
        this.hover -= 1;
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
        const cap = this.hoverTime * 30;
        if (this.hover >= cap) return;
        this.hover += 1;
        this.hoverUpdate();
    }
    static hoverDec() {
        if (this.hover <= 0) return;
        this.hover -= 1;
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

    static findSplitAt(pos, { ref = null, exclude = null, excludeConnection = null, avoidWalls = false, radiusPx = SPLIT_RADIUS_PX } = {}) {
        const R = radiusPx / Graficos.zoom;
        if (avoidWalls && Buildings.nearestWall(pos.x, pos.y, WALL_SNAP_PX / Graficos.zoom)) return null;

        const cand = this.hash.queryRect(pos.x - R, pos.y - R, pos.x + R, pos.y + R, _lineBuf);
        let best = null, bestD = R * R;
        for (let i = 0; i < cand.length; i++) {
            const c = cand[i];
            if (c === excludeConnection) continue;                       // NEW
            if (!c.enabled || !c.start.enabled || !c.end.enabled) continue;
            if (c.start === ref || c.end === ref) continue;
            if (exclude && (c.start === exclude || c.end === exclude)) continue;
            if (ref && (this.hasPair(ref, c.start) || this.hasPair(ref, c.end))) continue;

            const a = c.start.coordinate.pos, b = c.end.coordinate.pos;
            const p = closestPointOnSegment(pos.x, pos.y, a.x, a.y, b.x, b.y);
            if (p.d <= bestD) { best = { connection: c, x: p.x, y: p.y }; bestD = p.d; }
        }
        return best;
    }

    static findSplitTarget(ref, radiusPx = SPLIT_RADIUS_PX) {
        if (!ref || ref.building) return null;
        return this.findSplitAt(ref.coordinate.pos, { ref, radiusPx });
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
        if (reference.hasPin) this.pinHash.set(reference, p.x, p.y);
        else this.pinHash.delete(reference);
    }

    

    /** Traz para o topo da ordem de picking (equivale ao bringToFront gráfico). */
    static raise(reference) {
        if (reference.positionTracked) reference.z = ++this.zCounter;
    }

    /** Chamado quando a referência ganha pin (setName). */
    static notePin(reference) {
        this.maxPinReach = Math.max(this.maxPinReach, Graficos.pinReach(reference.pinGfx));
        this.syncPosition(reference);
    }

    // ---- consultas ----

    static findMergeTarget(ref, radiusPx = MERGE_RADIUS_PX) {
        const p = ref.coordinate.pos;
        const R = radiusPx / Graficos.zoom;
        const cand = this.dotHash.queryRect(p.x - R, p.y - R, p.x + R, p.y + R, []);

        let best = null, bestD = R * R;
        for (const o of cand) {
            if (o === ref || !o.enabled) continue;
            const d = (o.coordinate.pos.x - p.x) ** 2 + (o.coordinate.pos.y - p.y) ** 2;
            if (d <= bestD) { best = o; bestD = d; }
        }
        return best;
    }

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
            if (dx * dx + dy * dy >= r * r) continue;
            if (all) (hits ??= []).push(ref);
            else if (!best || ref.z > best.z) best = ref;
        }

        // editor: the pin on top is part of the reference
        const pins = page === "editor" && this.maxPinReach > 0
            ? this.getOverlappingDotPins(coordinate, all)
            : false;

        if (all) {
            const out = hits ? hits.sort(byZDesc) : [];
            if (pins) for (const r of pins) if (!out.includes(r)) out.push(r);
            return out.length ? out : false;
        }
        return best || pins || false;
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

    static midHandles = false;
    static hoveredMid = null;    // { building, index }  (aresta index: vértice index → index+1)

    static setEditing(on, mids = false) {
        mids = on && mids;
        if (this.editing === on && this.midHandles === mids) return;
        this.editing = on;
        this.midHandles = mids;
        if (!on) this.hovered = null;
        if (!mids) this.hoveredMid = null;
        for (const b of Object.values(this.buildings)) b.updateGraphics();
    }

    static setHoverMid(hit) {
        const prev = this.hoveredMid;
        if (prev?.building === hit?.building && prev?.index === hit?.index) return;
        this.hoveredMid = hit ? { building: hit.building, index: hit.index } : null;
        prev?.building.updateGraphics();
        hit?.building.updateGraphics();
    }

    static getOverlappingMid(coordinate) {
        const pos = coordinate.peekNormal();
        const R = MID_GRAB_PX / Graficos.zoom;
        const cand = this.polyHash.queryRect(pos.x - R, pos.y - R, pos.x + R, pos.y + R, _polyBuf);

        let best = null, bestD = R * R;
        for (let i = 0; i < cand.length; i++) {
            const b = cand[i];
            if (!b.closed) continue;
            const v = b.vertices, n = v.length;
            for (let k = 0; k < n; k++) {
                const p = v[k].pos, q = v[(k + 1) % n].pos;
                const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
                if (Math.hypot(p.x - q.x, p.y - q.y) < 200 / Graficos.zoom) {
                    continue;
                }
                const d = (mx - pos.x) ** 2 + (my - pos.y) ** 2;
                if (d <= bestD) { best = { building: b, index: k, pos: { x: mx, y: my } }; bestD = d; }
            }
        }
        return best;
    }

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

    static setHoverVertex(hit) {
        const prev = this.hovered;
        if (prev?.building === hit?.building && prev?.index === hit?.index) return;
        this.hovered = hit ? { building: hit.building, index: hit.index } : null;
        prev?.building.updateGraphics();
        hit?.building.updateGraphics();
    }

    static nearestVertex(pos, R, skipBuilding = null, skipIndex = -1) {
        const cand = this.polyHash.queryRect(pos.x - R, pos.y - R, pos.x + R, pos.y + R, _polyBuf);

        let best = null, bestD = R * R;
        for (let i = 0; i < cand.length; i++) {
            const b = cand[i];
            for (let k = 0; k < b.vertices.length; k++) {
                if (b === skipBuilding && k === skipIndex) continue;
                const v = b.vertices[k].pos;
                const d = (v.x - pos.x) ** 2 + (v.y - pos.y) ** 2;
                if (d <= bestD) { best = { building: b, index: k, pos: { x: v.x, y: v.y } }; bestD = d; }
            }
        }
        return best;
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
        this.colorPin = "#ff1a1a";
        this.visible = page == "main" ? false : true;

        this.hasPin = false;
        this.pinGraphics = null;

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

        this.bannerMode = "";

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
            this.hasPin = true;
            this.graphics = Graficos.createMapPin(name);
            Referencer.notePin(this);
            this.updateGraphics();
        }
    }

    get pinGfx() {
        return page === "main" ? this.graphics : this.pinGraphics;
    }

    editorPinData() {
        const tab = BANNER_TABS.find(t => t.id === this.banner.mode);
        return {
            coordinate: this.coordinate,
            size: 1 + ((this.size - 10) / 5) * 0.2,   // follows the dot's hover growth (10 → 15)
            color: this.tint,
            colorPin: tab?.pinColor ?? "#ff1a1a",
            bannerMode: tab?.icon ?? null,
            iconBgColor: 0xffffff,
            iconColor: tab?.pinColor,
            text: "",                                  // no label in the editor
        };
    }

    syncPin() {
        if (page !== "editor") return;
        const want = this.enabled && !!this.banner?.detailed;

        if (want) {
            this.pinGraphics ??= Graficos.createMapPin("");
            Graficos.renderMapPin(this.pinGraphics, this.editorPinData());
        } else if (this.pinGraphics) {
            Graficos.clearPin(this.pinGraphics);
        }

        if (this.hasPin !== want) {
            this.hasPin = want;
            Referencer.notePin(this);   // updates the pin hash and the max reach
        }
    }

    hoverAdd() {
        const cap = this.hoverTime * 30;
        if (this.hover >= cap) return;
        this.hover += 1;
        this.hoverUpdate();
    }
    hoverDec() {
        if (this.hover <= 0) return;
        this.hover -= 1;
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
        let idx = BANNER_TABS.map(el => el.id).indexOf(this.banner.mode);
        let text = "";
        let textOnly = false;
        if (idx !== -1) {
            let drawMode = BANNER_TABS[idx].icon;
            let drawColor = BANNER_TABS[idx].color;
            let drawColorPin = BANNER_TABS[idx].pinColor;
            let drawCompColor = BANNER_TABS[idx].compColor;

            if (page == "main") {
                this.colorIn = drawCompColor;
                this.colorOut = drawColor;
                this.bannerMode = drawMode;
                this.colorPin = drawColorPin;
                text = this.banner.title;
                if (drawMode == "heading") {
                    textOnly = true;
                } 
            }
        } else {
            this.colorOut = Palette.reference.out;
            this.colorIn = Palette.reference.in;
            this.bannerMode = "";
            this.colorPin = "";
        }

        return {
            coordinate: this.coordinate,
            colorOut: this.colorOut,
            colorIn: this.colorIn,
            size: this.size,
            alpha: this.alpha,
            isEntrance: this.isEntrance,
            color: this.tint,
            colorPin: this.colorPin,
            bannerMode: this.bannerMode ?? null,
            iconBgColor: 0xffffff,
            iconColor: this.colorPin,
            text: text,
            textOnly: textOnly,
            visible: this.visible
        }
    }

    updateGraphics() {
        if (this.enabled) {
            if (page == "main") {
                if (this.name) {
                    Graficos.renderMapPin(this.graphics, this.buildData());
                }
                return;
            }
            Graficos.renderReference(this.graphics, this.buildData());
        } else {
            Graficos.clearReference(this.graphics);
        }
        this.syncPin();
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

        for (const connection of this.connections) {
            Connections.reindex(connection);
            connection.updateGraphics();     // cheap: the sprite layer skips unchanged calls
        }
        this.updateGraphics();
        this.bringToFront();

        return report;
    }
    
    enable() {
        this.enabled = true;
        this.updateGraphics();
        
        Referencer.track(this);
        Referencer.addPositionTrack(this);

        for (const c of this.connections) c.updateGraphics();
    }
    disable() {
        this.enabled = false;
        this.updateGraphics();
        
        Referencer.untrack(this);
        Referencer.removePositionTrack(this);

        for (const c of this.connections) c.updateGraphics();
        
    }
    
    destroy() {
        let copyConnections = [...this.connections];
        for(const connection of copyConnections) {
            connection.destroy();
        }

        Referencer.untrack(this);
        Referencer.removePositionTrack(this);

        Graficos.destroyReference(this.graphics);
        if (this.pinGraphics) {
            Graficos.destroyMapPin(this.pinGraphics);
            this.pinGraphics = null;
        }
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
        const cap = this.hoverTime * 30;
        if (this.hover >= cap) return;
        this.hover += 1;
        this.hoverUpdate();
    }
    hoverDec() {
        if (this.hover <= 0) return;
        this.hover -= 1;
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
        this.midGraphics = [];

        this.id = -1;
        this.vertices = [];      // Coordinates sempre em "normal"
        this.closed = false;
        this.entrances = [];
        this.hover = 0;
        this.hoverTime = .2;
        this.bannerMode = "";
        this.visible = page == "main" ? false : true;
        this.colorPin = "";

        this.graphics = Graficos.createMapPin(name);
        Buildings.notePin(this);
        
        
        this.alpha = 1;
        this.colorOut = Palette.building.out;
        this.colorIn = Palette.building.in;
        this.colorInBase = Palette.building.in;
        this.borderSize = 8;
        this.radius = 0;
        this.tint = 0x000000;

        this.polygonGraphics = Graficos.createPoly();
        this.closeHandle = page === "editor" ? new CloseHandle(this) : null; 
        this.banner = new Banner();
        
        this.updateGraphics();

        Buildings.track(this);
        this.move(coordinate, true);
    }

    hoverAdd() {
        const cap = this.hoverTime * 30;
        if (this.hover >= cap) return;
        this.hover += 1;
        this.hoverUpdate();
    }
    hoverDec() {
        if (this.hover <= 0) return;
        this.hover -= 1;
        this.hoverUpdate();
    }
    hoverUpdate() {
        const ms = this.hoverTime * 1000;
        const t = ease(this.hover * (1000 / 30) / ms);
        this.pinSize = 1 + t * .2;
        this.tint = interpCol(0x000000, Palette.reference.hover, t);
        this.colorIn = interpCol(this.colorInBase, Palette.building.hoverFill, t);
        this.updateGraphics();
    }

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

    insertVertex(index, coord) {
        coord.convertTo("normal");
        this.vertices.splice(index, 0, newCoord(coord.pos.x, coord.pos.y, "normal"));
        if (this.closed) Buildings.indexPolygon(this);
        this.updateGraphics();
    }

    syncMidHandles() {
        const show = page === "editor" && this.enabled && this.closed && Buildings.midHandles;
        const n = show ? this.vertices.length : 0;
        
        while (this.midGraphics.length < n) this.midGraphics.push(Graficos.createReference());
        
        for (let i = 0; i < this.midGraphics.length; i++) {
            const g = this.midGraphics[i];
            if (i >= n) { Graficos.clearReference(g); continue; }

            const a = this.vertices[i].pos, b = this.vertices[(i + 1) % n].pos;
            const hot = Buildings.hoveredMid?.building === this && Buildings.hoveredMid.index === i;
            if (Math.hypot(a.x - b.x, a.y - b.y) < 200 / Graficos.zoom) {
                Graficos.clearReference(g);
                continue;
            };
            Graficos.renderReference(g, {
                coordinate: newCoord((a.x + b.x) / 2, (a.y + b.y) / 2, "normal"),
                colorOut: Palette.building.out,
                colorIn: hot ? Palette.building.hoverFill : 0xffffff,
                size: hot ? 7 : 5,
                alpha: 1,
                isEntrance: false,
                color: 0xffffff,
            });
        }
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

    removeVertex(index) {
        this.vertices.splice(index, 1);
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
        let idx = BANNER_TABS.map(el => el.id).indexOf(this.banner.mode);

        if (idx !== -1) {
            let drawMode = BANNER_TABS[idx].icon;
            let drawColorPin = BANNER_TABS[idx].pinColor;

            this.bannerMode = drawMode;
            this.colorPin = drawColorPin;
        }
        return {
            size: this.pinSize,
            coordinate: this.coordinate,
            color: this.tint,
            text: this.name,
            colorPin: this.colorPin,//BANNER_TABS[1].pinColor,
            visible: this.visible,
            bannerMode: this.bannerMode ?? null,
        };
    }

    setColor(color) {
        this.tint = color;
        this.updateGraphics();
    }

    updateGraphics() {
        this.syncMidHandles();
        this.closeHandle?.updateGraphics();
        
        if (!this.enabled) {
            Graficos.clearPin(this.graphics);
            Graficos.clearPoly(this.polygonGraphics);
            return;
        }

        Graficos.renderMapPin(this.graphics, this.buildData());

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
        for (const g of this.midGraphics) Graficos.destroyReference(g);
        this.midGraphics.length = 0;
    }
}

export class Banner {
    constructor() {
        this.detailed = false;
        this.title = "";
        this.titleAlias = [];
        this.description = "";
        this.image = false;
        this.priority = 1;
        this.mode = "";          // data of the non-main tabs, by id
    }
}