import * as Graficos from "./graficos.js";
import * as Geometria from "./geometria.js";

export async function load() {
  try {
        const response = await fetch(URLSaveMap);
        if (!response.ok) throw new Error('Erro de rede');
        const data = await response.json();
        
        let refMap = {}

        for(const key of Object.keys(data.references)) {
            let ref = data.references[key];
            let objRef = Referencer.createReference(ref.pos.x, ref.pos.y, false);
            refMap[key] = objRef;
        }
        for(const conn of data.connections) {
            Connections.createConnection(refMap[conn[0]], refMap[conn[1]]);
        }
        for(const build of data.buildings) {
            let regions = [];
            for(const area of build.areas) {
                let end = {
                    x: area.pos.x + area.size.x,
                    y: area.pos.y + area.size.y,
                }
                let reg = Builder.createRegionObject({start: area.pos, end: end});
                regions.push(reg);
            }
            let building = Builder.createConstruction({
                name: build.name,
                pin: build.pin_pos,
                regions: regions
            })
            Builder.convertGraphical(building, "polygon");
        }

    } catch (error) {
        console.error('Fetch error:', error);
    }
}

export class TempConnection {
    reference;
    drawRef;

    constructor(reference, drawRef) {
        this.reference = reference;
        this.drawRef = drawRef;
        // Graficos.tempConnection = this;
    }
}
export class TempReference {
    drawRef;

    constructor(drawRef) {
        this.drawRef = drawRef;
        // Graficos.tempReference = this;
    }
}
export class TempConstruction {
    name;
    pin;
    pin_graphics;
    regions;

    constructor(name) {
        this.name = name;
        this.regions = [];
    }
}
export class TempRegion {
    start;
    end;
    drawRef;

    constructor(graphics, start) {
        this.drawRef = graphics;
        this.start = start;
    }
}

function removeObj(list, obj) {
    const index = list.indexOf(obj);

    if (index !== -1) {
        list.splice(index, 1);
    }
    return list;
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

    static pairs = {};

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

    static addPair(connection) {

        this.pairs[`${connection.start.id},${connection.end.id}`] = connection;
    }

    static hasPair(a, b) {
        const keyAB = `${a.id},${b.id}`;
        const keyBA = `${b.id},${a.id}`;

        if (this.pairs[keyAB]) {
            return this.pairs[keyAB];
        }
        if (this.pairs[keyBA]) {
            return this.pairs[keyBA];
        }

        return false;
    }

    static createConnection(a, b) {
        if (a == b) {
            return;
        }
        let conn = new Connection(a, b);
        this.addPair(conn);
    }

    static createTempConnection(ref) {
        return Graficos.newConnection(ref.pos.x, ref.pos.y, null, null, true);
    }
    static updateTempConnection(conn, x, y) {
        let mapPos = Graficos.getNormalizedCoordinates(x, y);
        Graficos.updateConnection(
            conn.drawRef,
            conn.reference.pos.x,
            conn.reference.pos.y,
            mapPos.x, mapPos.y, true
        );
    }
    static removeTempConnection(conn) {
        Graficos.removeConnection(conn.drawRef);
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

    static removeConnection(conn, reverb=false) {
        Graficos.removeConnection(conn.graphics);
        
        delete this.pairs[`${conn.start.id},${conn.end.id}`]; 
        delete this.pairs[`${conn.end.id},${conn.start.id}`];

        if (reverb) {
            conn.start.lines = removeObj(conn.start.lines, conn);
            conn.end.lines = removeObj(conn.end.lines, conn);
        }
    }
}

class Connection {
    constructor(start, end) {
        this.start = start;
        this.end = end;
        this.graphics = Graficos.newConnection(start.pos.x, start.pos.y, end.pos.x, end.pos.y);
        if (!(end.lines.includes(this))) {
            end.lines.push(this);
        }
        if (!(start.lines.includes(this))) {
            start.lines.push(this);
        }
    }
}

export class Builder {
    constructor() {
        throw new Error("Classe estática. Não instancie.");
    }

    static buildings = [];
    static selection = [];

    static toJson() {
        let jsonBuildings = [];
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

            jsonBuildings.push(jsonBuild);
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
        region.pos = {x: mapPos.x, y: mapPos.y};

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
    
    static references = {};
    static idMap = [];
    static hashMap = {};
    static hashSize = 100;
    static id = 0;
    static radius = 15;
    static selection = [];

    static toJson() {
        let data = {};
        for(const refKey of Object.keys(this.references)) {
            let ref = this.references[refKey];
            data[parseInt(refKey)] = {
                "pos": ref.pos
            }
        }
        return data;
    }

    static addSelection(ref, x, y) {
        let mapPos = Graficos.getNormalizedCoordinates(x, y);
        let offx = mapPos.x - ref.pos.x;
        let offy = mapPos.y - ref.pos.y;
        if (!(this.selection.includes(ref))) {
            this.selection.push({
                obj: ref,
                offx: offx * Graficos.zoom,
                offy: offy * Graficos.zoom
            });
        } 
    }

    static removeSelection(ref) {
        this.selection = removeObj(this.selection, ref);
    }

    static clearSelection() {
        this.selection = [];
    }

    static createReference(x, y, convert=true) {
        let mapPos;
        if (convert) {
            mapPos = Graficos.getNormalizedCoordinates(x, y);
        } else {
            mapPos = {x: x, y: y};
        }
        let ref = new Reference({x: mapPos.x, y: mapPos.y});
        this.addRefKey(ref);
        this.addRefHash(ref);

        return ref;
    }

    static createTempReference(x, y) {
        return Graficos.newReference(x, y, true);
    }

    static updateTempReference(conn, x, y) {
        let mapPos = Graficos.getNormalizedCoordinates(x, y);
        Graficos.updateReference(conn.drawRef, mapPos.x, mapPos.y, true);
    }

    static removeTempReference(ref) {
        Graficos.removeReference(ref.drawRef);
    }
    
    static convertPos(x, y) {
        const newPos = {
            x: Math.floor(x / this.hashSize),
            y: Math.floor(y / this.hashSize)
        };
        return newPos;
    }

    static setRadius(radius) {
        this.radius = radius;
    }

    static posKey(pos) {
        return `${pos.x},${pos.y}`;
    }

    static getId() {
        let id = this.id;
        this.id += 1;
        return id;
    }

    static getCollision(x, y, connection=false) {
        let mapPos = Graficos.getNormalizedCoordinates(x, y);
        const location = this.convertPos(mapPos.x, mapPos.y);
        for (let i = 0; i < 9; i ++) {
            let offset = {
                x: (i % 3) - 1,
                y: Math.floor(i / 3) - 1
            }
            const key = this.posKey({x: location.x + offset.x, y: location.y + offset.y});
            if (key in this.hashMap) {
                for (const point of this.hashMap[key]) {
                    const distance = Math.sqrt(Math.pow(point.pos.x - mapPos.x, 2) + Math.pow(point.pos.y - mapPos.y, 2));
                    if (distance < Referencer.radius) {
                        if (connection != false) {
                            if (Connections.hasPair(connection, point)) {
                                continue;
                            }
                        }
                        return point;
                    }
                }
            }
        }
        return false;
    }

    static removeReference(ref) {
        Graficos.removeReference(ref.graphics);
        
        for (const element of ref.lines) {
            Connections.removeConnection(element);
        }
        
        delete this.references[String(ref.id)];

        let key = this.getHashKey(ref.pos.x, ref.pos.y);
        this.hashMap[key] = removeObj(this.hashMap[key], ref);

    }

    static getHashKey(x, y) {
        const location = this.convertPos(x, y);
        const key = this.posKey(location);
        return key;
    }

    static addRefHash(ref) {
        let key = this.getHashKey(ref.pos.x, ref.pos.y);
        if (!(key in this.hashMap)) {
            this.hashMap[key] = [];
        }
        this.hashMap[key].push(ref);
    }
    static removeRefHash(ref) {
        let key = this.getHashKey(ref.pos.x, ref.pos.y);
        this.hashMap[key] = removeObj(this.hashMap[key], ref);
    }

    static addRefKey(ref) {
        this.references[String(ref.id)] = ref;
    }
    static removeRefKey(ref) {
        delete this.references[String(ref.id)];
    }

    static moveRef(ref, x, y) {
        this.removeRefHash(ref);
        
        let mapPos = Graficos.getNormalizedCoordinates(x, y);
        ref.pos = mapPos;
        Graficos.updateReference(ref.graphics, mapPos.x, mapPos.y);
        for(const conn of ref.lines) {
            Graficos.updateConnection(conn.graphics, conn.end.pos.x, conn.end.pos.y, conn.start.pos.x, conn.start.pos.y);
        }
        
        this.addRefHash(ref);
        // for(const line of ref.lines) {
        //     Graficos.setRouteLine(line, line.end.pos);
        // }

        // location = this.convertPos(ref.pos);
        // key = this.posKey(location);
        // if (!(key in this.hashMap)) {
        //     this.hashMap[key] = [];
        // }
        // this.hashMap[key].push(ref);
    }

    static setReferenceObj(obj) {
        this.referenceObj = obj;
    }
}

export class Reference {
    constructor(pos) {
        this.id = Referencer.getId();
        
        this.pos = pos;
        this.graphics = Graficos.newReference(this.pos.x, this.pos.y);

        this.lines = [];
    }
}