import * as Graficos from "./graficos.js";
import * as Geometria from "./geometria.js";

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

        this.size = 5;

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
        return true;
    }
    return false;
}

function polygonUnion(squares) {
    let boxes = [];
    for (let i=0; i<squares.length;i++) {
        let minMaxArea = [
            squares[i].pos.x,
            squares[i].pos.y,
            squares[i].pos.x + squares[i].size.x,
            squares[i].pos.y + squares[i].size.y,
        ]
        boxes.push(minMaxArea);
    }
    let polygons = Geometria.getUnionPolygonVertices(boxes);
    return polygons;
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

        this.setRelation(connection, connection.start, true);
        this.setRelation(connection, connection.end, true);
    }

    static untrack(connection) {
        let key = this.createKey(connection);
        delete this.connections[key];

        this.setRelation(connection, connection.start, false);
        this.setRelation(connection, connection.end, false);
    }
    
    static setRelation(connection, reference, state) {
        if (state) {
            reference.connections = addObj(reference.connections, connection);
        } else {
            reference.connections = removeObj(reference.connections, connection);
        }
    }

    // static drawRoute(points) {
    //     return Graficos.multiRouteDraw(points);
    // }
    // static removeDrawRoute(draw) {
    //     Graficos.removeConnection(draw);
    // }

    // static addPair(connection) {

    //     this.pairs[`${connection.start.id},${connection.end.id}`] = connection;
    // }

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

    // static createConnection(a, b) {
    //     if (a == b) {
    //         return;
    //     }
    //     let conn = new Connection(a, b);
    //     this.addPair(conn);
    // }

    // static createTempConnection(ref) {
    //     return Graficos.newConnection(ref.pos.x, ref.pos.y, null, null, true);
    // }
    // static updateTempConnection(conn, x, y) {
    //     let mapPos = Graficos.getNormalizedCoordinates(x, y);
    //     Graficos.updateConnection(
    //         conn.drawRef,
    //         conn.reference.pos.x,
    //         conn.reference.pos.y,
    //         mapPos.x, mapPos.y, true
    //     );
    // }
    // static removeTempConnection(conn) {
    //     Graficos.removeConnection(conn.drawRef);
    // }

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

export class Builder {
    constructor() {
        throw new Error("Classe estática. Não instancie.");
    }

    static buildings = [];
    static selection = [];

    static toJson() {
        let jsonBuildings = {};
        for(const build of this.buildings) {
            
            let areas = [];
            for(const area of build.areas) {
                let jsonArea = {
                    "pos": area.pos,
                    "size": area.size
                }
                areas.push(jsonArea);
            }
            
            let jsonBuild = {
                "name": build.name,
                "pin_pos": build.pinPos,
                "areas": areas
            }

            jsonBuildings[build.name] = jsonBuild;
        }
        return jsonBuildings;
    }

    static calcBox(start, end) {
        let pos = {
            x: Math.min(start.x, end.x),
            y: Math.min(start.y, end.y)
        }
        let size = {
            x: Math.abs(start.x - end.x),
            y: Math.abs(start.y - end.y),
        }
        return {pos: pos, size: size};
    }

    static createPin(x, y, text) {
        let mapPos = Graficos.getNormalizedCoordinates(x, y);
        return Graficos.newPin(mapPos.x, mapPos.y, text);
    }
    static createRegion() {
        return Graficos.newRegion();
    }
    static createRegionObject(region) {
        let box = this.calcBox(region.start, region.end);
        let regionObject = new Region(box.pos, box.size);
        return regionObject;
    }

    static updateRegion(region, x, y, convert=true) {
        let mapStart = region.start;
        let mapEnd;
        if (convert) {
            mapEnd = Graficos.getNormalizedCoordinates(x, y);
        } else {
            mapEnd = {x: x, y: y};
        }
        let box = this.calcBox(mapStart, mapEnd);
        
        Graficos.updateRegion(region.drawRef, box.pos.x, box.pos.y, box.size.x, box.size.y);
    }
    
    static moveRegion(region, x, y) {
        let mapPos = Graficos.getNormalizedCoordinates(x, y);
        
        for (const ref of region.construction.refs) {
            let movedPos = {
                x: ref.pos.x + (mapPos.x - region.pos.x),
                y: ref.pos.y + (mapPos.y - region.pos.y)
            }
            movedPos = Graficos.getScreenCoordinates(movedPos.x, movedPos.y);
            Referencer.moveRef(ref, movedPos.x, movedPos.y);
        }
        region.pos = {x: mapPos.x, y: mapPos.y};
        
        for (const ref of Object.values(Referencer.references)) {
            let unnormedPos = Graficos.getScreenCoordinates(ref.pos.x, ref.pos.y);
            let pos = Builder.getClosestValidPosition(unnormedPos.x, unnormedPos.y);
            let hasBuild = pos.building;
            // pos = Graficos.getScreenCoordinates(pos.x, pos.y);
            // Referencer.moveRef(ref, pos.x, pos.y);
            if (hasBuild) {
                // console.log(ref, ref.renderProjection)
                console.log(ref.id, Referencer.references[ref.id]);
                ref.renderProjection(pos);
            }
        }

        Graficos.updateRegion(region.graphics, region.pos.x, region.pos.y, region.size.x, region.size.y);
    }
    static movePin(pin, x, y) {
        let mapPos = Graficos.getNormalizedCoordinates(x, y);
        pin.construction.pinPos = {x: mapPos.x, y: mapPos.y};

        Graficos.updatePin(pin.construction.pinGraphics, mapPos.x, mapPos.y, pin.construction.name);
    }
    static reOrder(region) {
        let construction = region.construction;
        construction.areas = removeObj(construction.areas, region)
        construction.areas.push(region);
        for(const area of construction.areas) {
            Graficos.removeRegion(area.graphics);
            area.graphics = Graficos.newRegion(
                area.pos.x,
                area.pos.y,
                area.size.x,
                area.size.y,
            );
        }
    }

    static removeTempConstruction(construction) {
        return Graficos.removePin(construction.pin_graphics);
    }
    static removeTempRegion(region) {
        return Graficos.removeRegion(region.drawRef);
    }
    static removeRegion(region) {
        Graficos.removeRegion(region.graphics);
        region.construction.areas = removeObj(region.construction.areas, region);
    }
    static removeConstruction(construction) {
        Graficos.removePin(construction.pinGraphics);
        this.buildings = removeObj(this.buildings, construction);
    }

    static createConstruction(construction) {
        let constructionObject = new Construction(construction.name, construction.pin, construction.regions);
        for(const region of construction.regions) {
            region.construction = constructionObject;
        }
        this.buildings.push(constructionObject);
        return constructionObject;
    }
    static convertGraphical(construction, state) {
        if (state == "polygon") {
            if (construction.polygonGraphics == null) {
                for(const square of construction.areas) {
                    Graficos.removeRegion(square.graphics);
                    square.graphics = null;
                }
                construction.polygon = polygonUnion(construction.areas);
                construction.polygonGraphics = Graficos.newPolygon(construction.polygon);
            }
        } else if (state == "areas") {
            if (construction.polygonGraphics != null) {
                Graficos.removePolygon(construction.polygonGraphics);
                construction.polygonGraphics = null;


                for(const square of construction.areas) {
                    let graphics = Graficos.newRegion(square.pos.x, square.pos.y, square.size.x, square.size.y);
                    square.graphics = graphics;
                }
            }
        }
    }

    static getCollisionMapArea(x, y, map) {
        let mapPos = Graficos.getNormalizedCoordinates(x, y);
        for(const buildKey of Object.keys(map)) {
            let build = map[buildKey];
            for(const area of build.areas) {
                let horizontal = mapPos.x > area.pos.x && mapPos.x < area.pos.x + area.size.x;
                let vertical = mapPos.y > area.pos.y && mapPos.y < area.pos.y + area.size.y;
                if (horizontal && vertical) {
                    return {"text": buildKey, "obj": build, "form": "build"};
                }
            }
        }
        return false;
    }

    static getClosestValidPosition(x, y) {
        let mapPos = Graficos.getNormalizedCoordinates(x, y);

        const boxes = [];
        for (const build of this.buildings) {
            const pinW = 24 / Graficos.zoom;
            const pinH = 32 / Graficos.zoom;
            boxes.push({
                minX: build.pinPos.x - pinW / 2,
                maxX: build.pinPos.x + pinW / 2,
                minY: build.pinPos.y - pinH,
                maxY: build.pinPos.y,
                building: build
            });
            
            for (const area of build.areas) {
                boxes.push({
                    minX: area.pos.x,
                    maxX: area.pos.x + area.size.x,
                    minY: area.pos.y,
                    maxY: area.pos.y + area.size.y,
                    building: build
                });
            }
        }

        const EPS = 1e-7;
        const isInsideAnyBox = (pt) => {
            return boxes.some(b => 
                pt.x > b.minX + EPS && pt.x < b.maxX - EPS &&
                pt.y > b.minY + EPS && pt.y < b.maxY - EPS
            );
        };

        if (!isInsideAnyBox(mapPos)) {
            return { x: mapPos.x, y: mapPos.y, building: null };
        }

        let closestPoint = null;
        let minSqDistance = Infinity;

        const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

        for (const box of boxes) {
            const segments = [
                { p1: { x: box.minX, y: box.minY }, p2: { x: box.maxX, y: box.minY }, axis: 'h' },
                { p1: { x: box.minX, y: box.maxY }, p2: { x: box.maxX, y: box.maxY }, axis: 'h' },
                { p1: { x: box.minX, y: box.minY }, p2: { x: box.minX, y: box.maxY }, axis: 'v' },
                { p1: { x: box.maxX, y: box.minY }, p2: { x: box.maxX, y: box.maxY }, axis: 'v' }
            ];

            for (const seg of segments) {
                let candidate;
                if (seg.axis === 'h') {
                    candidate = {
                        x: clamp(mapPos.x, seg.p1.x, seg.p2.x),
                        y: seg.p1.y
                    };
                } else {
                    candidate = {
                        x: seg.p1.x,
                        y: clamp(mapPos.y, seg.p1.y, seg.p2.y)
                    };
                }

                if (isInsideAnyBox(candidate)) {
                    continue;
                }

                const dx = mapPos.x - candidate.x;
                const dy = mapPos.y - candidate.y;
                const sqDist = dx * dx + dy * dy;

                if (sqDist < minSqDistance) {
                    minSqDistance = sqDist;
                    closestPoint = {
                        x: candidate.x,
                        y: candidate.y,
                        building: box.building
                    };
                }
            }
        }

        return closestPoint;
    }

    static getCollision(x, y) {
        let mapPos = Graficos.getNormalizedCoordinates(x, y);

        for(const build of this.buildings) {
            let horizontal = Math.abs(mapPos.x - build.pinPos.x) < 12 / Graficos.zoom;
            let vertical = Math.abs(mapPos.y - build.pinPos.y + 16 / Graficos.zoom) < 16 / Graficos.zoom;
            if (horizontal && vertical) {
                return build;
            }
            for(const area of build.areas) {
                let horizontal = mapPos.x > area.pos.x && mapPos.x < area.pos.x + area.size.x;
                let vertical = mapPos.y > area.pos.y && mapPos.y < area.pos.y + area.size.y;
                if (horizontal && vertical) {
                    return build;
                }
            }
        }
        return false;
    }

    static getCollisionPin(pinMap, x, y) {
        let mapPos = Graficos.getNormalizedCoordinates(x, y);
        for (const pin of Object.values(pinMap)) {
            let texWid = pin.label.getSize();
            let horizontal = Math.abs(mapPos.x - (pin.x + texWid.width / 2)) < (12 + texWid.width / 2) / Graficos.zoom;
            let vertical = Math.abs(mapPos.y - pin.y + 16 / Graficos.zoom) < 16 / Graficos.zoom;
            if (horizontal && vertical) {
                return pin;
            }
        }
        return false;
    }

    static getCollisionArea(construction, x, y) {
        let mapPos = Graficos.getNormalizedCoordinates(x, y);
        
        let horizontal = Math.abs(mapPos.x - construction.pinPos.x) < 12 / Graficos.zoom;
        let vertical = Math.abs(mapPos.y - construction.pinPos.y + 16 / Graficos.zoom) < 16 / Graficos.zoom;
        if (horizontal && vertical) {
            return new Pin(construction);
        }

        for(const area of construction.areas.toReversed()) {
            let horizontal = mapPos.x > area.pos.x && mapPos.x < area.pos.x + area.size.x;
            let vertical = mapPos.y > area.pos.y && mapPos.y < area.pos.y + area.size.y;
            if (horizontal && vertical) {
                return area;
            }
        }
        return false;
    }

    static addPinSelection(pin, x, y) {
        let mapPos = Graficos.getNormalizedCoordinates(x, y);
        let offx = mapPos.x - pin.construction.pinPos.x;
        let offy = mapPos.y - pin.construction.pinPos.y;
        if (!(this.selection.includes(pin))) {
            this.selection.push({
                obj: pin,
                offx: offx * Graficos.zoom,
                offy: offy * Graficos.zoom
            });
        } 
    }

    static addSelection(area, x, y) {
        let mapPos = Graficos.getNormalizedCoordinates(x, y);
        let offx = mapPos.x - area.pos.x;
        let offy = mapPos.y - area.pos.y;
        if (!(this.selection.includes(area))) {
            this.selection.push({
                obj: area,
                offx: offx * Graficos.zoom,
                offy: offy * Graficos.zoom
            });
        } 
    }

    static removeSelection(area) {
        this.selection = removeObj(this.selection, area);
    }

    static clearSelection() {
        this.selection = [];
    }
}

export class Pin {
    constructor(construction) {
        this.construction = construction;
    }
}

export class Construction {
    constructor(name, pinPos, areas) {
        this.name = name;
        this.pinPos = pinPos;
        this.areas = areas;
        this.pinGraphics = Graficos.newPin(pinPos.x, pinPos.y, name);
        this.polygon = null;
        this.polygonGraphics = null;
        this.construction = null;
        this.refs = [];

        this.banner = null;
    }
}

export class Region {
    constructor(pos, size) {
        this.pos = pos;
        this.size = size;
        this.graphics = Graficos.newRegion(this.pos.x, this.pos.y, this.size.x, this.size.y);
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
    // static idMap = [];
    // static selection = [];
    
    static track(reference) {
        if (!(reference.id === -1)) {
            return;
        }
        reference.id = this.idTracker;
        this.references[this.idTracker] = reference;
        this.idTracker += 1;
;
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
                        // if (connection != false) {
                            // if (Connections.hasPair(connection, point)) {
                                // continue;
                            // }
                        // }
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

    // static toJson() {
    //     let data = {};
    //     for(const refKey of Object.keys(this.references)) {
    //         let ref = this.references[refKey];
    //         let build = "";
    //         if (ref.building) {
    //             build = ref.building.name;
    //         }
    //         data[parseInt(refKey)] = {
    //             "build": build,
    //             "pos": ref.pos
    //         }
    //     }
    //     return data;
    // }

    // static extractReference(dataMap, refMap, clickX, clickY) {
    //     let pos = Graficos.getNormalizedCoordinates(clickX, clickY);
    //     let x = pos.x;
    //     let y = pos.y;
    //     let reference;
    //     if (dataMap.form == "pin") {
    //         let closest = [0, ""];
    //         for(const ref of dataMap.refs) {

    //             let refObj = refMap[ref];
    //             let distance = Math.sqrt((refObj.pos.x - x) * (refObj.pos.x - x) + (refObj.pos.y - y) * (refObj.pos.y - y))
                
    //             if (closest[1] == "" || distance < closest[0]) {
    //                 closest = [distance, ref];
    //             }
    //         }
    //         reference = closest[1];
    //     } else if (dataMap.form == "ref") {
    //         reference = dataMap.ref;
    //     } else if (dataMap.form == "build") {
    //         let closest = [0, ""];
            
    //         for(const ref of dataMap.obj.refs) {

    //             let refObj = refMap[ref];
    //             let distance = Math.sqrt((refObj.pos.x - x) * (refObj.pos.x - x) + (refObj.pos.y - y) * (refObj.pos.y - y))

    //             if (closest[1] == "" || distance < closest[0]) {
    //                 closest = [distance, ref];
    //             }
    //         }
    //         reference = closest[1];
    //     }
    //     return reference;
    // }

    // static setRelatedBuilding(obj, building) {
    //     if (obj.building == building) {
    //         return;
    //     }
    //     obj.building = building
    //     building.refs.push(obj);
    // }

    // static setUnrelatedBuilding(obj, building) {
    //     obj.building = null;
    //     building.refs = removeObj(building.refs, obj);
    // }

    // static addSelection(ref, x, y) {
    //     let mapPos = Graficos.getNormalizedCoordinates(x, y);
    //     let offx = mapPos.x - ref.pos.x;
    //     let offy = mapPos.y - ref.pos.y;
    //     if (!(this.selection.includes(ref))) {
    //         this.selection.push({
    //             obj: ref,
    //             offx: offx * Graficos.zoom,
    //             offy: offy * Graficos.zoom
    //         });
    //     } 
    // }

    // static removeSelection(ref) {
    //     this.selection = removeObj(this.selection, ref);
    // }

    // static clearSelection() {
    //     this.selection = [];
    // }
    
    // static convertPos(x, y) {
    //     const newPos = {
    //         x: Math.floor(x / this.hashSize),
    //         y: Math.floor(y / this.hashSize)
    //     };
    //     return newPos;
    // }

    // static setRadius(radius) {
    //     this.radius = radius;
    // }

    // static posKey(pos) {
    //     return `${pos.x},${pos.y}`;
    // }

    // static getId() {
    //     let id = this.id;
    //     this.id += 1;
    //     return id;
    // }

    

    // static removeReference(ref) {
    //     Graficos.removeReference(ref.graphics);
        
    //     for (const element of ref.lines) {
    //         Connections.removeConnection(element);
    //     }
        
    //     delete this.references[String(ref.id)];

    //     let key = this.getHashKey(ref.pos.x, ref.pos.y);
    //     this.hashMap[key] = removeObj(this.hashMap[key], ref);

    // }

    // static getHashKey(x, y) {
    //     const location = this.convertPos(x, y);
    //     const key = this.posKey(location);
    //     return key;
    // }

    // static addRefHash(ref) {
    //     let key = this.getHashKey(ref.pos.x, ref.pos.y);
    //     if (!(key in this.hashMap)) {
    //         this.hashMap[key] = [];
    //     }
    //     this.hashMap[key].push(ref);
    // }
    // static removeRefHash(ref) {
    //     let key = this.getHashKey(ref.pos.x, ref.pos.y);
    //     this.hashMap[key] = removeObj(this.hashMap[key], ref);
    // }

    // static addRefKey(ref) {
    //     this.references[String(ref.id)] = ref;
    // }
    // static removeRefKey(ref) {
    //     delete this.references[String(ref.id)];
    // }

    // static moveRef(ref, x, y) {
    //     this.removeRefHash(ref);
        
    //     let mapPos = Graficos.getNormalizedCoordinates(x, y);
    //     ref.pos = mapPos;
    //     Graficos.updateReference(ref.graphics, mapPos.x, mapPos.y, ref.isFocus);
    //     for(const conn of ref.lines) {
    //         Graficos.updateConnection(conn.graphics, conn.end.pos.x, conn.end.pos.y, conn.start.pos.x, conn.start.pos.y);
    //     }
        
    //     this.addRefHash(ref);
    // }

    // static setReferenceObj(obj) {
    //     this.referenceObj = obj;
    // }
}

export class Reference {
    constructor(coordinate) {
        this.alpha = 1;
        this.colorOut = 0x3d97e0;
        this.colorIn = 0xa4d1f5;
        this.enabled = true;
        this.size = 10;

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
        }
    }

    updateGraphics() {
        if (this.enabled) {
            Graficos.renderReference(this.graphics, this.buildData());
            for(const connection of this.connections) {
                connection.updateGraphics();
            }
        } else {
            this.graphics.clear();
        }
    }

    bringToFront() {
        Referencer.removePositionTrack(this);
        Referencer.addPositionTrack(this);
        Graficos.BringToFrontReference(this.graphics);
    }
    
    move(coordinate, create=false) {
        if (!create) {
            Referencer.removePositionTrack(this);
            
            this.coordinate = coordinate;
            this.coordinate.convertTo("normal");
            
            Referencer.addPositionTrack(this);

            this.updateGraphics();
            this.bringToFront();

            return;
        }
        
        this.coordinate = coordinate;
        this.coordinate.convertTo("normal");
        
        Referencer.addPositionTrack(this);
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
        this.size = 5;

        this.start = start;
        this.end = end;

        this.id = -1;
        this.hover = 0;
        this.hoverTime = .2;
        Connections.track(this);
        
        this.positionTracked = false;
        
        this.graphics = Graficos.createConnection();
        
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
        if (this.enabled) {
            Graficos.renderConnection(this.graphics, this.buildData());
        } else {
            this.graphics.clear();
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

        Connections.untrack(this);
    }
}

// export class Reference {
//     constructor(pos) {
//         this.id = Referencer.getId();
        
//         this.pos = pos;
//         this.graphics = Graficos.newReference(this.pos.x, this.pos.y);

//         this.lines = [];
//         this.isFocus = false;

//         this.banner = null;

//         this.building = null;

//         this.projGraphics = null;
//         this.projPos = null;
//     }

//     renderProjection(pos) {
//         if (this.projGraphics) {
//             Graficos.removeReference(this.projGraphics);
//         }
//         this.projGraphics = Graficos.newReference(pos.x, pos.y, true);
//         this.projPos = {x: pos.x, y: pos.y};
//     }

//     endProjection() {
//         if (this.projGraphics) {
//             Graficos.removeReference(this.projGraphics);
//         }
//         this.projGraphics = null;
//         this.projPos = null;
//     }
// }

export class Banner {
    static banners = []

    static saveBanner(focus, image, title, description) {
        if (focus instanceof Pin) {
            focus = focus.construction;
        }
        if (focus.banner) {
            if (image) {
                focus.banner.file = image;
            }
            focus.banner.title = title;
            focus.banner.description = description;
            return;
        }
        if (!image && !title && !description) {return};
        let newBanner = new BannerObject(focus, image, title, description);
        focus.banner = newBanner;
        this.banners.push(newBanner);
    }

    static bannerJson() {
        let data = {};

        for (const banner of this.banners) {
            let parent = banner.owner;
            let key = (parent instanceof Reference) ? parent.id : parent.name;

            data[key] = {
                "fileName": banner.file ? banner.file.name : null,
                "title": banner.title,
                "description": banner.description,
                "isRef": (parent instanceof Reference)
            };
        }
        return data;
    }

    static toJson() {
        const formData = new FormData();

        const jsonData = this.bannerJson();
        formData.append("metadata", JSON.stringify(jsonData));

        for (const banner of this.banners) {
            if (banner.file instanceof File) {
                let parent = banner.owner;
                let key = (parent instanceof Reference) ? parent.id : parent.name;

                formData.append(`file_${key}`, banner.file, banner.file.name);
            }
        }

        return formData;
    }
}

export class BannerObject {
    constructor(owner, file, title, description) {
        this.owner = owner;
        this.file = file;
        this.title = title;
        this.description = description;
    }
}