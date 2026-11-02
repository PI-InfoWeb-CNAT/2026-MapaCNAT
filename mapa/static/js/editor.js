import * as Graficos from "./graficos.js";
import * as Geometria from "./geometria.js";

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

async function urlToFile(url, filename = 'banner.png') {
    if (!url) return null;
    const response = await fetch(url);
    const blob = await response.blob();
    
    const mimeType = blob.type || 'image/png'; 
    return new File([blob], filename, { type: mimeType });
}

export async function load() {
    try {
        const response = await fetch(URLSaveMap);
        if (!response.ok) throw new Error('Erro de rede');
        const data = await response.json();
        
        let refMap = {};
        let buildMap = {};

        if (data.buildings) {
            for (const key of Object.keys(data.buildings)) {
                let build = data.buildings[key];
                let regions = [];

                for (const area of build.areas) {
                    let end = {
                        x: area.pos.x + area.size.x,
                        y: area.pos.y + area.size.y,
                    };
                    let reg = Builder.createRegionObject({ start: area.pos, end: end });
                    regions.push(reg);
                }

                let building = Builder.createConstruction({
                    name: build.name,
                    pin: build.pin_pos,
                    regions: regions
                });

                Builder.convertGraphical(building, "polygon");
                
                buildMap[key] = building;
            }
        }

        if (data.references) {
            for (const key of Object.keys(data.references)) {
                let ref = data.references[key];
                let building = buildMap[ref.build];

                let objRef = Referencer.createReference(ref.pos.x, ref.pos.y, false, building);
                refMap[key] = objRef;
            }
        }

        if (data.connections) {
            for (const conn of data.connections) {
                let startObj = refMap[conn[0]];
                let endObj = refMap[conn[1]];
                if (startObj) {
                    Connections.createConnection(startObj, endObj);
                }
            }
        }

        if (data.banners) {
            for (const key of Object.keys(data.banners)) {
                let banner = data.banners[key];
                
                let parentObj = banner.isRef ? refMap[key] : buildMap[key];

                if (parentObj) {
                    const fileName = banner.imageUrl ? banner.imageUrl.split('/').pop() : `banner_${key}.png`;
                    
                    const imageFile = banner.imageUrl 
                        ? await urlToFile(banner.imageUrl, fileName) 
                        : null;

                    Banner.saveBanner(
                        parentObj,
                        imageFile,
                        banner.title,
                        banner.description
                    );
                } else {
                    console.warn(`Parent object for banner key '${key}' not found.`);
                }
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

        this.size = 10;

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
        this.borderSize = 10;
        
        this.graphics = Graficos.createArea();

        this.phantomDots = {};
    }

    setEndPoint(end) {
        this.end = end;
        this.end.convertTo("normal");
        this.updateGraphics();
        
        let areaPhantom = { ...Buildings.areas };
        areaPhantom[-1] = this;

        for(const ref of Object.values(Referencer.references)) {
            let validCoord = Referencer.getValidDot(ref.coordinate, areaPhantom);

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

export class Connections {
    constructor() {
        throw new Error("Classe estática. Não instancie.");
    }

    static toJson() {
        let pairs = [];
        for(const rawKey of Object.keys(this.pairs)) {
            const values = rawKey.split(",");
            let start = parseInt(values[0]);
            let end = parseInt(values[1]);
            pairs.push([start, end]);
        }
        return pairs;
    }
    
    static connections = {};

    static track(connection) {
        let key = this.createKey(connection);

        if (this.connections[key]) {
            return;
        }
        this.connections[key] = connection;
    }

    static untrack(connection) {
        let key = this.createKey(connection);
        delete this.connections[key];
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

    static createKey(connection) {
        return `${connection.start.id},${connection.end.id}`;
    }

    static hasPair(a, b) {
        const keyAB = `${a.id},${b.id}`;
        const keyBA = `${b.id},${a.id}`;

        if (this.connections[keyAB]) {
            return this.connections[keyAB];
        }
        if (this.connections[keyBA]) {
            return this.connections[keyBA];
        }

        return false;
    }

    static getOverlappingLines(coordinate, all) {
        let pos = coordinate.getIn("normal");
        let allList = [];

        for(const key of Object.keys(this.connections)) {
            let connection = this.connections[key];
            
            const px = pos.x;
            const py = pos.y;
            const x1 = connection.start.coordinate.pos.x;
            const y1 = connection.start.coordinate.pos.y;
            const x2 = connection.end.coordinate.pos.x;
            const y2 = connection.end.coordinate.pos.y;

            const A = px - x1;
            const B = py - y1;
            const C = x2 - x1;
            const D = y2 - y1;
            
            const dot = A * C + B * D;
            const lenSq = C * C + D * D;
            
            let param = -1;
            if (lenSq !== 0) {
                param = dot / lenSq;
            }
            
            let closestX, closestY;
            
            if (param < 0) {
                closestX = x1;
                closestY = y1;
            } else if (param > 1) {
                closestX = x2;
                closestY = y2;
            } else {
                closestX = x1 + param * C;
                closestY = y1 + param * D;
            }
            
            const dx = px - closestX;
            const dy = py - closestY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            let Radius = connection.size / 2;
            if (distance <= Radius) {
                if (!all) {
                    return connection;
                }
                allList.push(connection);
            }
        }
        if (allList.length === 0) {
            return false;
        }
        return allList;
    }

    static getCollision(x, y) {
        let mapPos = Graficos.getNormalizedCoordinates(x, y);

        for (const [key, value] of Object.entries(this.pairs)) {
            let ids = key.split(",");
            let a = Referencer.references[ids[0]];
            let b = Referencer.references[ids[1]];
            let aTob = {
                x: b.pos.x - a.pos.x,
                y: b.pos.y - a.pos.y,
            }
            let aToPoint = {
                x: mapPos.x - a.pos.x,
                y: mapPos.y - a.pos.y,
            }
            let dot = aTob.x * aToPoint.x + aTob.y * aToPoint.y;
            let mag = Math.sqrt(aTob.x * aTob.x + aTob.y * aTob.y);
            let normal = {
                x: aTob.x / mag / mag,
                y: aTob.y / mag / mag
            }
            let projection = {
                x: a.pos.x + normal.x * dot,
                y: a.pos.y + normal.y * dot
            }
            let mapToPoint = {
                x: mapPos.x - projection.x,
                y: mapPos.y - projection.y,
            }

            let finalDist = Math.sqrt(mapToPoint.x * mapToPoint.x + mapToPoint.y * mapToPoint.y);
            if (finalDist < 7.5 && dot / mag / mag > 0 && dot / mag / mag < 1) {
                return value;
            }
        }
        return false;
    }
}

export class Referencer {
    constructor() {
        throw new Error("Classe estática. Não instancie.");
    }
    
    static idTracker = 0;
    static references = {};
    static hashMap = {};
    static hashSize = 100;
    static radius = 15;
    static motionReport = {};

    static beginReport() {
        this.reporting = true;
        this.motionReport = {};
    }
    static endReport() {
        this.reporting = false;
        this.motionReport = {};
    }

    static track(reference) {
        if (!(reference.id === -1)) {
            return;
        }
        reference.id = this.idTracker;
        this.references[this.idTracker] = reference;
        this.idTracker += 1;
        
        for(const connection of reference.connections) {
            Connections.track(connection);
        }
    }

    static untrack(reference) {
        delete this.references[reference.id];
        reference.id = -1;

        for(const connection of reference.connections) {
            Connections.untrack(connection);
        }
    }

    static getHashKey(pos, map=true) {
        if (map) {
            pos = this.getHashCoord(pos);
        }

        let key = `${pos.x},${pos.y}`;

        return key;
    }

    static getHashCoord(pos) {
        let x = pos.x;
        let y = pos.y;

        const newPos = {
            x: Math.floor(x / this.hashSize),
            y: Math.floor(y / this.hashSize)
        };

        return newPos;
    }

    static removePositionTrack(reference) {
        if (!reference.positionTracked) {
            return;
        }
        reference.positionTracked = false;

        let key = this.getHashKey(reference.coordinate.pos);

        this.hashMap[key] = removeObj(this.hashMap[key], reference);
    }
    static addPositionTrack(reference) {
        if (reference.positionTracked) {
            return;
        }
        reference.positionTracked = true;
        let key = this.getHashKey(reference.coordinate.pos);
        
        if (!(key in this.hashMap)) {
            this.hashMap[key] = [];
        }
        this.hashMap[key].push(reference);
    }
    
    static getOverlappingDots(coordinate, all) {
        let pos = coordinate.getIn("normal");
        let hashPos = this.getHashCoord(pos);

        let allList = [];

        for (let i = 0; i < 9; i ++) {
            let offset = {
                x: (i % 3) - 1,
                y: Math.floor(i / 3) - 1
            }

            const key = this.getHashKey({x: hashPos.x + offset.x, y: hashPos.y + offset.y}, false);
            
            if (key in this.hashMap) {
                for (const reference of this.hashMap[key].toReversed()) {
                    const distance = Math.sqrt(Math.pow(reference.coordinate.pos.x - pos.x, 2) + Math.pow(reference.coordinate.pos.y - pos.y, 2));
                    if (distance < reference.size / Graficos.zoom) {
                        if (!all) {
                            return reference;
                        }
                        allList.push(reference);
                    }
                }
            }
        }

        if (allList.length == 0) {
            return false;
        }
        return allList;
    }

    static getValidDot(coordinate, areas = null, tol = 1e-9) {
        let x, y, space = "normal";

        if (typeof coordinate === "object" && coordinate !== null) {
            if (typeof coordinate.getIn === "function") {
                const pos = coordinate.getIn("normal");
                x = pos.x;
                y = pos.y;
            } else if (coordinate.pos) {
                x = coordinate.pos.x;
                y = coordinate.pos.y;
                space = coordinate.space || "normal";
            } else {
                x = coordinate.x;
                y = coordinate.y;
            }
        }

        const areaSource = areas !== null ? areas : (Buildings.areas || {});
        const areaList = Array.isArray(areaSource) ? areaSource : Object.values(areaSource);

        const areaListNormal = areaList.map(area => ({box: area, start: area.start.getIn("normal"), end: area.end.getIn("normal")}));

        const boxes = areaListNormal.map(area => ({
            minX: Math.min(area.start.x, area.end.x),
            maxX: Math.max(area.start.x, area.end.x),
            minY: Math.min(area.start.y, area.end.y),
            maxY: Math.max(area.start.y, area.end.y),
            box: area.box
        }));
        
        // closed set: the border counts as inside
        const inClosed = (px, py) => boxes.some(b =>
            px >= b.minX - tol && px <= b.maxX + tol &&
            py >= b.minY - tol && py <= b.maxY + tol);

        // open interior: strictly inside a box, so NOT on the union's boundary
        const inOpen = (px, py) => boxes.some(b =>
            px > b.minX + tol && px < b.maxX - tol &&
            py > b.minY + tol && py < b.maxY - tol);

        if (!inClosed(x, y)) {
            return { isInside: false, coord: newCoord(x, y, space) };
        }

        const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
        const allXs = boxes.flatMap(b => [b.minX, b.maxX]);
        const allYs = boxes.flatMap(b => [b.minY, b.maxY]);

        const candidates = [];

        for (const b of boxes) {
            // horizontal edges (y fixed), x ranges over [minX, maxX]
            const xs = [clamp(x, b.minX, b.maxX), b.minX, b.maxX,
                        ...allXs.map(v => clamp(v, b.minX, b.maxX))];
            for (const edgeY of [b.minY, b.maxY]) {
                for (const cx of xs) candidates.push({ x: cx, y: edgeY, box: b.box });
            }

            // vertical edges (x fixed), y ranges over [minY, maxY]
            const ys = [clamp(y, b.minY, b.maxY), b.minY, b.maxY,
                        ...allYs.map(v => clamp(v, b.minY, b.maxY))];
            for (const edgeX of [b.minX, b.maxX]) {
                for (const cy of ys) candidates.push({ x: edgeX, y: cy, box: b.box });
            }
        }

        let best = null;
        let minDistSq = Infinity;
        for (const c of candidates) {
            if (inOpen(c.x, c.y)) continue;          // buried inside the union
            const d = (c.x - x) ** 2 + (c.y - y) ** 2;
            if (d < minDistSq) {
                minDistSq = d;
                best = c;
            }
        }

        const finalPoint = best || { x, y };
        return { isInside: best.box, coord: newCoord(finalPoint.x, finalPoint.y, space) };
    }
}

export class Buildings {
    constructor() {
        throw new Error("Classe estática. Não instancie.");
    }
    
    static idTracker = 0;
    static buildings = {};
    static areas = {};
    
    static trackArea(area) {
        if (!(area.id === -1)) {
            return;
        }
        area.id = this.idTracker;
        this.areas[this.idTracker] = area;
        this.idTracker += 1;
    }

    static untrackArea(area) {
        delete this.areas[area.id];
        area.id = -1;
    }

    static track(building) {
        if (!(building.id === -1)) {
            return;
        }
        building.id = this.idTracker;
        this.buildings[this.idTracker] = building;
        this.idTracker += 1;

        for(const area of building.areas) {
            Buildings.trackArea(area);
        }
    }
    
    static untrack(building) {
        delete this.buildings[building.id];
        building.id = -1;

        for(const area of building.areas) {
            Buildings.untrackArea(area);
        }
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
    
    static getOverlappingAreas(coordinate, all) {
        let pos = coordinate.getIn("normal");
        let allList = [];

        const areas = Object.values(this.areas).toReversed();

        for (const area of areas) {
            const minX = Math.min(area.start.pos.x, area.end.pos.x) - area.borderSize / 2;
            const maxX = Math.max(area.start.pos.x, area.end.pos.x) + area.borderSize / 2;
            const minY = Math.min(area.start.pos.y, area.end.pos.y) - area.borderSize / 2;
            const maxY = Math.max(area.start.pos.y, area.end.pos.y) + area.borderSize / 2;

            if (pos.x >= minX && pos.x <= maxX && pos.y >= minY && pos.y <= maxY) {
                if (!all) {
                    return area;
                }
                allList.push(area);
            }
        }

        if (allList.length === 0) {
            return false;
        }
        return allList;
    }

    static getOverlappingAreaBorders(coordinate, all) {
        let pos = coordinate.getIn("normal");
        let allList = [];

        const zoom = (typeof Graficos !== "undefined" && Graficos.zoom) ? Graficos.zoom : 1;
        const thickness = 15;
        const halfThick = thickness / 2;

        const areas = Object.values(this.areas).toReversed();
        let isCovered = false;

        for (const area of areas) {
            const minX = Math.min(area.start.pos.x, area.end.pos.x);
            const maxX = Math.max(area.start.pos.x, area.end.pos.x);
            const minY = Math.min(area.start.pos.y, area.end.pos.y);
            const maxY = Math.max(area.start.pos.y, area.end.pos.y);

            if (isCovered) {
                break;
            }

            if (
                pos.x >= minX - halfThick && pos.x <= maxX + halfThick &&
                pos.y >= minY - halfThick && pos.y <= maxY + halfThick
            ) {
                const sides = [
                    {
                        side: "top",
                        hit: Math.abs(pos.y - minY) <= halfThick,
                        dist: Math.abs(pos.y - minY)
                    },
                    {
                        side: "right",
                        hit: Math.abs(pos.x - maxX) <= halfThick,
                        dist: Math.abs(pos.x - maxX)
                    },
                    {
                        side: "bottom",
                        hit: Math.abs(pos.y - maxY) <= halfThick,
                        dist: Math.abs(pos.y - maxY)
                    },
                    {
                        side: "left",
                        hit: Math.abs(pos.x - minX) <= halfThick,
                        dist: Math.abs(pos.x - minX)
                    }
                ];

                const matchedSides = sides.filter(s => s.hit);

                if (matchedSides.length > 0) {
                    matchedSides.sort((a, b) => a.dist - b.dist);

                    if (!all) {
                        return { area, side: matchedSides[0].side };
                    }

                    for (const match of matchedSides) {
                        allList.push({ area, side: match.side });
                    }
                }
            }

            if (pos.x >= minX && pos.x <= maxX && pos.y >= minY && pos.y <= maxY) {
                isCovered = true;
            }
        }

        if (allList.length === 0) {
            return false;
        }
        return allList;
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
        this.connections = [];
        this.hover = 0;
        this.hoverTime = .2;
        Referencer.track(this);

        
        this.positionTracked = false;
        this.move(coordinate, true);
        
        this.graphics = Graficos.createReference();

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
        this.size = 10 + t * 5;
        this.updateGraphics();
    }

    buildData() {
        return {
            coordinate: this.coordinate,
            colorOut: this.colorOut,
            colorIn: this.colorIn,
            size: this.size,
            alpha: this.alpha,
            isEntrance: this.isEntrance
        }
    }

    updateGraphics() {
        if (this.enabled) {
            Graficos.renderReference(this.graphics, this.buildData());

            for(const connection of this.connections) {
                connection.updateGraphics();
            }
        } else {
            Graficos.clearReference(this.graphics);
        }
    }

    bringToFront() {
        Referencer.removePositionTrack(this);
        Referencer.addPositionTrack(this);
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

        
        let coordinate = validCoord.coord;
        if (!create) {
            Referencer.removePositionTrack(this);
            
            this.coordinate = coordinate;
            this.coordinate.convertTo("normal");
            
            Referencer.addPositionTrack(this);

            this.updateGraphics();
            this.bringToFront();

            return report;
        }
        
        this.coordinate = coordinate;
        this.coordinate.convertTo("normal");
        
        Referencer.addPositionTrack(this);

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
        this.size = 10;

        this.start = start;
        this.end = end;

        this.id = -1;
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
        this.size = 10 + t * 5;
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
        this.size = 10;
        this._helperCreate = null;

        this.id = -1;
        this.visual = "areas";
        this.areas = [];
        this.entrances = [];
        this.hover = 0;
        this.hoverTime = .2;
        Buildings.track(this);
        
        this.move(coordinate, true);

        this.graphics = Graficos.createPin(name);
        
        this.points = [];
        this.alpha = 1;
        this.colorOut = 0x3d97e0
        this.colorIn = 0xa4d1f5;
        this.borderSize = 10;
        this.radius = 5;

        this.polygonGraphics = Graficos.createPoly();
        
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
            size: this.size,
            coordinate: this.coordinate
        }
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
        if (!create) {
            this.coordinate = coordinate;
            this.coordinate.convertTo("normal");
            
            this.updateGraphics();
            this.bringToFront();

            return;
        }
        
        this.coordinate = coordinate;
        this.coordinate.convertTo("normal");
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
        this.borderSize = 10;
        
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

    motionReport() {
        if(!Referencer.reporting) {
            return;
        }
        for(const ref of Object.values(Referencer.references)) {
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
        this.start = start;
        this.end = end;
        this.updateGraphics();

        this.motionReport();
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