import * as Graficos from "./graficos.js";
import * as Geometria from "./geometria.js";
import { SpatialHash } from "./spatialHash.js";

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
const BORDER_GRAB = 15;        // espessura de captura das bordas de Area (unidades do mundo)
const PIN_REACH_MARGIN = 1.25; // o hover escala o pin até 1.2x

// buffers de consulta reutilizados: nada de alocar array a cada pointermove
const _dotBuf = [], _pinBuf = [], _lineBuf = [], _areaBuf = [], _clusterBuf = [], _nearBuf = [];
const EMPTY = Object.freeze([]);

const byZDesc = (a, b) => b.z - a.z;
const byIdDesc = (a, b) => b.id - a.id;

// as Areas sempre guardam start/end em "normal"
function areaBounds(area) {
    const s = area.start.pos, e = area.end.pos;
    return {
        minX: Math.min(s.x, e.x), maxX: Math.max(s.x, e.x),
        minY: Math.min(s.y, e.y), maxY: Math.max(s.y, e.y),
    };
}

function containsPoint(area, x, y, pad = 0) {
    const s = area.start.pos, e = area.end.pos;
    return x >= Math.min(s.x, e.x) - pad && x <= Math.max(s.x, e.x) + pad &&
           y >= Math.min(s.y, e.y) - pad && y <= Math.max(s.y, e.y) + pad;
}

function overlapsBounds(area, b, tol) {
    const s = area.start.pos, e = area.end.pos;
    return Math.max(s.x, e.x) >= b.minX - tol && Math.min(s.x, e.x) <= b.maxX + tol &&
           Math.max(s.y, e.y) >= b.minY - tol && Math.min(s.y, e.y) <= b.maxY + tol;
}

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

    for (const [id, area] of Object.entries(Buildings.areas)) {
        const s = area.start.getIn("normal");
        const e = area.end.getIn("normal");
        payload.areas[id] = {
            min: { x: Math.min(s.x, e.x), y: Math.min(s.y, e.y) },
            max: { x: Math.max(s.x, e.x), y: Math.max(s.y, e.y) },
        };
    }

    for (const [id, building] of Object.entries(Buildings.buildings)) {
        payload.buildings[id] = {
            name: building.name,
            pin: normalPos(building.coordinate),
            areas: building.areas
                .filter(a => a.id !== -1)
                .map(a => a.id),
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

      if (!banner?.title) return acc;

      // Collect all searchable fields.
      const searchFields = [
        banner.title,
        ...(Array.isArray(banner.titleAlias)
          ? banner.titleAlias
          : banner.titleAlias
            ? [banner.titleAlias]
            : []),
        element?.name,
        element?.building?.name
      ].filter(value => typeof value === "string" && value.trim());

      // Get the highest score across all fields.
      const score = Math.max(
        0,
        ...searchFields.map(field => getFieldScore(field, trimmedQuery))
      );

      if (score > 0) {
        acc.push({
          title: banner.title,
          image: banner.image,
          description: banner.description,
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
        let areaMap = {};
        
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

                for (const areaKey of build.areas) {
                    let area = data.areas[areaKey];
                    let start = newCoord(area.min.x, area.min.y, "normal");
                    let end = newCoord(area.max.x, area.max.y, "normal");
                    
                    if (!areaMap[areaKey]) {
                        let areaObject = new Area(start, end, building);
                        areaMap[key] = areaObject;
                    }
                }
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

export class PhantomConnection {
    constructor(start) {
        this.start = start;

        this.alpha = .6;
        this.colorOut = 0x3d97e0;
        this.colorIn = 0xa4d1f5;

        this.size = 6;

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

export class PhantomArea {
    constructor(startX, startY) {
        let coord = newCoord(startX, startY, "screen");
        coord.convertTo("normal");
        this.start = coord;
        this.alpha = .6;
        this.colorOut = {
            left: 0x3d97e0,
            top: 0x3d97e0,
            right: 0x3d97e0,
            bottom: 0x3d97e0,
        };
        this.colorIn = 0xa4d1f5;
        
        this.radius = 5;
        this.borderSize = 8;
        
        this.graphics = Graficos.createArea();

        this.phantomDots = {};
    }

    setEndPoint(end) {
        this.end = end;
        this.end.convertTo("normal");
        this.updateGraphics();

        // a própria área fantasma entra como `extra`: não copia mais Buildings.areas a cada movimento
        for(const ref of Object.values(Referencer.references)) {
            let validCoord = Referencer.getValidDot(ref.coordinate, this);

            if (!validCoord.isInside) {
                if (this.phantomDots[ref.id]) {
                    Graficos.destroyReference(this.phantomDots[ref.id].gfx);
                    delete this.phantomDots[ref.id];
                }
                continue;
            }
            if (!this.phantomDots[ref.id]) {
                this.phantomDots[ref.id] = { ref: ref, gfx: Graficos.createReference(), validPos: validCoord.coord };
            }

            this.phantomDots[ref.id].validPos = validCoord.coord;
            let data = {
                coordinate: this.phantomDots[ref.id].validPos,
                colorOut: 0x3d97e0,
                colorIn: 0xa4d1f5,
                size: 10,
                alpha: 1,
                isEntrance: true
            }
            Graficos.renderReference(this.phantomDots[ref.id].gfx, data);

        }
        
    }

    buildData() {
        let start = this.start;
        let end = this.end;
        return {
            colorOut: this.colorOut,
            colorIn: this.colorIn,
            alpha: this.alpha,
            borderSize: this.borderSize,
            radius: this.radius,
            start: start,
            end: end,
        }
    }

    updateGraphics() {
        Graficos.renderArea(this.graphics, this.buildData());
    }

    destroy() {
        Graficos.destroyArea(this.graphics);
        for(const key of Object.keys(this.phantomDots)) {
            Graficos.destroyReference(this.phantomDots[key].gfx);
            delete this.phantomDots[key];
        }
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
    static motionReport = {};
    static reporting = false;

    static beginReport() {
        this.reporting = true;
        this.motionReport = {};
    }
    static endReport() {
        this.reporting = false;
        this.motionReport = {};
    }

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

    /**
     * Se o ponto está dentro da união das áreas, devolve o ponto mais próximo da borda da união.
     * `extraArea` é uma área que ainda não está rastreada (a PhantomArea).
     */
    static getValidDot(coordinate, extraArea = null, tol = 1e-9) {
        let x, y;
        if (typeof coordinate.getIn === "function") {
            const p = coordinate.peekNormal();
            x = p.x;
            y = p.y;
        } else {
            x = coordinate.x;
            y = coordinate.y;
        }

        // só o aglomerado de áreas que se tocam e contém o ponto: as outras não mudam o resultado
        const boxes = Buildings.collectCluster(x, y, extraArea, tol);
        if (boxes.length === 0) {
            return { isInside: false, coord: newCoord(x, y, "normal") };
        }

        // a borda conta como dentro (conjunto fechado)
        const inOpen = (px, py) => boxes.some(b =>
            px > b.minX + tol && px < b.maxX - tol &&
            py > b.minY + tol && py < b.maxY - tol);

        const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
        const allXs = boxes.flatMap(b => [b.minX, b.maxX]);
        const allYs = boxes.flatMap(b => [b.minY, b.maxY]);

        const candidates = [];
        for (const b of boxes) {
            // arestas horizontais (y fixo), x varia em [minX, maxX]
            const xs = [clamp(x, b.minX, b.maxX), b.minX, b.maxX,
                        ...allXs.map(v => clamp(v, b.minX, b.maxX))];
            for (const edgeY of [b.minY, b.maxY]) {
                for (const cx of xs) candidates.push({ x: cx, y: edgeY, box: b.box });
            }

            // arestas verticais (x fixo), y varia em [minY, maxY]
            const ys = [clamp(y, b.minY, b.maxY), b.minY, b.maxY,
                        ...allYs.map(v => clamp(v, b.minY, b.maxY))];
            for (const edgeX of [b.minX, b.maxX]) {
                for (const cy of ys) candidates.push({ x: edgeX, y: cy, box: b.box });
            }
        }

        let best = null;
        let minDistSq = Infinity;
        for (const c of candidates) {
            if (inOpen(c.x, c.y)) continue;          // enterrado dentro da união
            const d = (c.x - x) ** 2 + (c.y - y) ** 2;
            if (d < minDistSq) {
                minDistSq = d;
                best = c;
            }
        }

        const p = best || { x, y };
        return { isInside: best ? best.box : boxes[0].box, coord: newCoord(p.x, p.y, "normal") };
    }
}

export class Buildings {
    constructor() {
        throw new Error("Classe estática. Não instancie.");
    }
    
    static idTracker = 0;
    static buildings = {};
    static areas = {};
    static areaHash = new SpatialHash(256);   // caixa da área + folga de captura
    static pinHash = new SpatialHash(256);    // pins das construções
    static maxPinReach = 0;
    
    static trackArea(area) {
        if (area.id !== -1) {
            return;
        }
        area.id = this.idTracker;
        this.areas[this.idTracker] = area;
        this.idTracker += 1;
        this.indexArea(area);
    }

    static untrackArea(area) {
        if (area.id !== -1) delete this.areas[area.id];
        area.id = -1;
        this.areaHash.delete(area);
    }

    /** Reindexa a caixa (com a folga de captura da borda). Ignora área não rastreada. */
    static indexArea(area) {
        if (area.id === -1 || !area.start || !area.end) return;
        const b = areaBounds(area);
        const pad = Math.max(area.borderSize / 2, BORDER_GRAB / 2);
        this.areaHash.set(area, b.minX - pad, b.minY - pad, b.maxX + pad, b.maxY + pad);
    }

    static track(building) {
        if (building.id !== -1) {
            return;
        }
        building.id = this.idTracker;
        this.buildings[this.idTracker] = building;
        this.idTracker += 1;

        for(const area of building.areas) {
            if (area.enabled) this.trackArea(area);   // antes religava até áreas já apagadas
        }
        this.syncPin(building);
    }
    
    static untrack(building) {
        delete this.buildings[building.id];
        building.id = -1;
        this.pinHash.delete(building);

        for(const area of building.areas) {
            Buildings.untrackArea(area);
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
    
    static setRelation(obj, building, state) {
        let iterator = obj instanceof Reference ? building.entrances : building.areas;

        if (state) {
            iterator = addObj(iterator, obj);
        } else {
            iterator = removeObj(iterator, obj);
        }
    }

    static getBannerless() {
        let flat = Object.values(this.buildings);
        let bannerless = flat.filter((element) => {return !(element.banner.detailed)});
        return bannerless;
    }

    /**
     * Áreas (fechadas) do aglomerado conexo que contém o ponto. Devolve EMPTY, sem alocar,
     * quando o ponto não está em nenhuma área (o caso mais comum).
     */
    static collectCluster(x, y, extra, tol) {
        const cand = this.areaHash.queryPoint(x, y, _clusterBuf);
        let any = extra ? containsPoint(extra, x, y, tol) : false;
        for (let i = 0; i < cand.length && !any; i++) any = containsPoint(cand[i], x, y, tol);
        if (!any) return EMPTY;

        const entries = [], seen = new Set();
        const visit = (area) => {
            if (seen.has(area)) return;
            seen.add(area);
            const b = areaBounds(area);
            b.box = area;
            entries.push(b);
        };

        for (let i = 0; i < cand.length; i++) {
            if (containsPoint(cand[i], x, y, tol)) visit(cand[i]);
        }
        if (extra && containsPoint(extra, x, y, tol)) visit(extra);

        // expande (BFS) para as áreas que tocam o aglomerado; `entries` funciona como fila
        for (let i = 0; i < entries.length; i++) {
            const b = entries[i];
            const near = this.areaHash.queryRect(b.minX - tol, b.minY - tol, b.maxX + tol, b.maxY + tol, _nearBuf);
            for (let j = 0; j < near.length; j++) {
                if (overlapsBounds(near[j], b, tol)) visit(near[j]);
            }
            if (extra && overlapsBounds(extra, b, tol)) visit(extra);
        }
        return entries;
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

    static getOverlappingAreas(coordinate, all) {
        const pos = coordinate.peekNormal();
        const cand = this.areaHash.queryPoint(pos.x, pos.y, _areaBuf);

        let best = null, hits = null;
        for (let i = 0; i < cand.length; i++) {
            const area = cand[i];
            if (!containsPoint(area, pos.x, pos.y, area.borderSize / 2)) continue;
            if (all) (hits ??= []).push(area);
            else if (!best || area.id > best.id) best = area;      // id maior = mais por cima
        }

        if (all) return hits ? hits.sort(byIdDesc) : false;
        return best || false;
    }

    static getOverlappingAreaBorders(coordinate, all) {
        const pos = coordinate.peekNormal();
        const half = BORDER_GRAB / 2;
        const cand = this.areaHash.queryPoint(pos.x, pos.y, _areaBuf);
        if (cand.length > 1) cand.sort(byIdDesc);                  // de cima para baixo

        let allList = null;

        for (let i = 0; i < cand.length; i++) {
            const area = cand[i];
            const s = area.start.pos, e = area.end.pos;
            const minX = Math.min(s.x, e.x), maxX = Math.max(s.x, e.x);
            const minY = Math.min(s.y, e.y), maxY = Math.max(s.y, e.y);

            if (pos.x >= minX - half && pos.x <= maxX + half &&
                pos.y >= minY - half && pos.y <= maxY + half) {

                const dTop = Math.abs(pos.y - minY), dRight = Math.abs(pos.x - maxX);
                const dBottom = Math.abs(pos.y - maxY), dLeft = Math.abs(pos.x - minX);

                if (!all) {
                    let side = null, bestD = Infinity;
                    if (dTop <= half && dTop < bestD) { side = "top"; bestD = dTop; }
                    if (dRight <= half && dRight < bestD) { side = "right"; bestD = dRight; }
                    if (dBottom <= half && dBottom < bestD) { side = "bottom"; bestD = dBottom; }
                    if (dLeft <= half && dLeft < bestD) { side = "left"; bestD = dLeft; }
                    if (side) return { area, side };
                } else {
                    const sides = [["top", dTop], ["right", dRight], ["bottom", dBottom], ["left", dLeft]]
                        .filter(([, d]) => d <= half)
                        .sort((p, q) => p[1] - q[1]);
                    for (const [side] of sides) (allList ??= []).push({ area, side });
                }
            }

            // uma área que cobre o ponto esconde as de baixo
            if (pos.x >= minX && pos.x <= maxX && pos.y >= minY && pos.y <= maxY) break;
        }

        return allList || false;
    }
}

export class Reference {
    constructor(coordinate) {
        this.alpha = 1;
        this.colorOut = 0x3d97e0;
        this.colorIn = 0xa4d1f5;
        this.enabled = true;
        this.size = 10;
        this.isEntrance = false;
        this.building = false;

        this.id = -1;
        this.uid = Referencer.uidTracker++;
        this.z = 0;
        this.connections = [];
        this.hover = 0;
        this.hoverTime = .2;
        Referencer.track(this);

        
        this.positionTracked = false;
        this.move(coordinate, true);
        
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
        this.tint = interpCol(0x000000, 0x00aaff, t);
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
    
    validatePos() {
        return this.move(this.coordinate);
    }

    move(coord, create=false) {
        let validCoord = Referencer.getValidDot(coord);
        let report = false;
        if (this.coordinate) {
            if (validCoord.isInside) {
                report = [this, this.coordinate.getIn("normal"), validCoord.coord.getIn("normal")];
            }
            if (!validCoord.isInside && this.isEntrance) {
                report = [this, this.coordinate.getIn("normal"), validCoord.coord.getIn("normal")];
            }
        }
        this.isEntrance = validCoord.isInside != false;

        if (this.isEntrance) {
            this.building = validCoord.isInside.building;
            Buildings.setRelated(this, this.isEntrance);
        } else {
            if (this.building) {
                Buildings.setRelated(this, this.isEntrance);
            }
            this.building = validCoord.isInside.building;
        }

        this.coordinate = validCoord.coord;
        this.coordinate.convertTo("normal");

        // indexa (ou reindexa). Referência desabilitada nunca volta para o hash.
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
        this.colorOut = 0x3d97e0;
        this.colorIn = 0xa4d1f5;
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
        this.visual = "areas";
        this.areas = [];
        this.entrances = [];
        this.hover = 0;
        this.hoverTime = .2;
        Buildings.track(this);
        
        this.move(coordinate, true);

        this.graphics = Graficos.createPin(name);
        Buildings.notePin(this);
        
        this.points = [];
        this.alpha = 1;
        this.colorOut = 0x3d97e0
        this.colorIn = 0xa4d1f5;
        this.borderSize = 8;
        this.radius = 5;
        this.tint = 0x000000;

        this.polygonGraphics = Graficos.createPoly();

        this.banner = new Banner();
        
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
        this.pinSize = 1 + t * .2;
        this.tint = interpCol(0x000000, 0x00aaff, t);
        this.updateGraphics();
    }

    getBoxes() {
        let boxes = [];
        for(const area of this.areas) {
            if(area.enabled == false) {
                continue;
            }
            let box = area.getBox();
            boxes.push(box);
        }
        return boxes;
    }

    buildPolygon() {
        let boxes = this.getBoxes();
        let polygons = Geometria.getUnionPolygonVertices(boxes);
        let coordPolygon = [];
        for(const polygon of polygons) {
            let coordPoints = [];
            for(const point of polygon) {
                let coord = newCoord(point[0], point[1], "normal");
                coordPoints.push(coord);
            }
            coordPolygon.push(coordPoints);
        }
        this.points = coordPolygon;

        this.updateGraphics();
    }

    convertTo(mode) {
        if (this.visual == mode) {
            return;
        }

        this.visual = mode;

        if (mode == "polygon") {
            for(const area of this.areas) {
                area.areaMode = false;
                area.updateGraphics();
            }
            
            this.buildPolygon();

        } else {
            for(const area of this.areas) {
                area.areaMode = true;
                area.updateGraphics();
            }
        }

        this.updateGraphics();
    }

    buildData() {
        return {
            size: this.pinSize,
            coordinate: this.coordinate,
            color: this.tint
        }
    }

    setColor(color) {
        this.tint = color;
        this.updateGraphics();
    }

    buildDataPoly() {
        return {
            points: this.points,
            alpha: this.alpha,
            colorOut: this.colorOut,
            colorIn: this.colorIn,
            borderSize: this.borderSize,
            radius: this.radius
        }
    }
    
    updateGraphics() {
        if (this.enabled) {
            Graficos.renderPin(this.graphics, this.buildData());

            if (this.visual == "polygon") {
                Graficos.renderPoly(this.polygonGraphics, this.buildDataPoly());
            } else {
                Graficos.clearPoly(this.polygonGraphics);
            }
        } else {
            Graficos.clearPin(this.graphics);
            Graficos.clearPoly(this.polygonGraphics);
        }
    }

    enable() {
        this.enabled = true;
        this.updateGraphics();
        Buildings.track(this);
    }
    disable() {
        this.enabled = false;
        this.updateGraphics();
        Buildings.untrack(this);
    }

    move(coordinate, create=false) {
        this.coordinate = coordinate;
        this.coordinate.convertTo("normal");
        Buildings.syncPin(this);

        if (!create) {
            this.updateGraphics();
            this.bringToFront();
        }
    }

    destroy() {
        Graficos.destroyPin(this.graphics);
        Buildings.untrack(this);
    }
}

class AreaBorder {
    constructor(side, area) {
        this.color = 0x3d97e0;
        this.colorBase = 0x3d97e0;
        this.colorHovered = 0xffffcc;
        this.side = side;
        this.area = area;
        this.hover = 0;
        this.hoverTime = .2;
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
        
        this.area.colorOut[this.side] = interpCol(this.colorBase, this.colorHovered, t);
        this.area.updateGraphics();
    }
}

export class Area {
    constructor(start, end, building) {
        this.alpha = 1;
        this.colorOut = {
            left: 0x3d97e0,
            top: 0x3d97e0,
            right: 0x3d97e0,
            bottom: 0x3d97e0,
        };
        this.sides = {
            left: new AreaBorder("left", this),
            top: new AreaBorder("top", this),
            right: new AreaBorder("right", this),
            bottom: new AreaBorder("bottom", this),
        };

        this.colorIn = 0xa4d1f5;
        this.colorInBase = 0xa4d1f5;
        this.colorInHover = 0xd4f1ff;
        this.radius = 5;
        this.borderSize = 8;
        
        this.enabled = true;
        this.areaMode = true;
    
        this.hover = 0;
        this.hoverTime = .2;
        
        let minStart = newCoord(Math.min(start.pos.x, end.pos.x), Math.min(start.pos.y, end.pos.y), start.space);
        let maxEnd = newCoord(Math.max(start.pos.x, end.pos.x), Math.max(start.pos.y, end.pos.y), end.space);
        minStart.convertTo("normal");
        maxEnd.convertTo("normal");

        this.id = -1;
        Buildings.trackArea(this);
        this.building = building;
        Buildings.setRelated(this, true);

        this.graphics = Graficos.createArea();
        
        this.move(minStart, maxEnd);

        this.updateGraphics();
    }

    motionReport(old) {
        if(!Referencer.reporting) {
            return;
        }

        // só referências perto da caixa antiga ou da nova podem mudar de estado
        const now = areaBounds(this);
        const minX = Math.min(now.minX, old ? old.minX : Infinity) - 1;
        const minY = Math.min(now.minY, old ? old.minY : Infinity) - 1;
        const maxX = Math.max(now.maxX, old ? old.maxX : -Infinity) + 1;
        const maxY = Math.max(now.maxY, old ? old.maxY : -Infinity) + 1;

        // array novo: validatePos reindexa as referências durante o loop
        const refs = Referencer.dotHash.queryRect(minX, minY, maxX, maxY, []);

        for(const ref of refs) {
            let refReport = ref.validatePos();
            if (refReport === false) {
                continue;
            }
            if(!Referencer.motionReport[ref.id]) {
                Referencer.motionReport[ref.id] = refReport;
            }
            Referencer.motionReport[ref.id][2] = refReport[2];
        }
    }

    move(start, end) {
        const old = this.start ? areaBounds(this) : null;    // caixa antes da mudança
        start.convertTo("normal");
        end.convertTo("normal");
        this.start = start;
        this.end = end;

        Buildings.indexArea(this);                            // o hash precisa estar atualizado ANTES do motionReport
        this.updateGraphics();

        this.motionReport(old);
    }

    getBox() {
        let start = this.start.getIn("normal");
        let end = this.end.getIn("normal");
        return [
            start.x,
            start.y,
            end.x,
            end.y
        ]
    }
    
    buildData() {
        let start = this.start;
        let end = this.end;
        return {
            colorOut: this.colorOut,
            colorIn: this.colorIn,
            alpha: this.alpha,
            borderSize: this.borderSize,
            radius: this.radius,
            start: start,
            end: end,
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
        this.colorIn = interpCol(this.colorInBase, this.colorInHover, t);
        this.updateGraphics();
    }

    updateGraphics() {
        if (this.enabled && this.areaMode) {
            if (page == "main") {
                return;
            }
            Graficos.renderArea(this.graphics, this.buildData());
        } else {
            Graficos.clearArea(this.graphics);
        }
    }

    enable() {
        this.enabled = true;
        this.updateGraphics();
        Buildings.trackArea(this);
    }
    disable() {
        this.enabled = false;
        this.updateGraphics();
        Buildings.untrackArea(this);
    }

    destroy() {
        Graficos.destroyArea(this.graphics);
        Buildings.setRelated(this, false);
        Buildings.untrackArea(this);
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