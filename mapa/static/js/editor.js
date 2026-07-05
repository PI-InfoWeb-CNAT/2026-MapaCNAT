import * as Graficos from "./graficos.js";
import * as Geometria from "./geometria.js";

const referenceIcon = document.getElementById("reference");
const routeIcon = document.getElementById("route");

let buildName;
let buildCoordinates;

function removeObj(list, obj) {
    const index = list.indexOf(obj);

    if (index !== -1) {
        list.splice(index, 1);
    }
    return list;
}

function squareToCoordinates(square) {
    let topLeft = [Math.min(square.x, square.x - square.width), Math.min(square.y, square.y - square.height)];
    let size = [Math.abs(square.width), Math.abs(square.height)];
    let vertices = [topLeft[0], topLeft[1], topLeft[0] + size[0], topLeft[1] + size[1]];

    return vertices;
}

function polygonUnion(squares) {
    let boxes = [];
    for (let i=0; i<squares.length;i++) {
        boxes.push(squareToCoordinates(squares[i]));
    }
    let polygons = Geometria.getUnionPolygonVertices(boxes);
    return polygons;
}

class routeLine {
    constructor(start) {
        this.start = start;
        start.lines.push(this);
    }
    
    setEnd(end) {
        this.end = end;
        end.lines.push(this);
    }

    setObj(obj) {
        this.obj = obj;
    }
}

export class Router {
    constructor() {
        throw new Error("Classe estática. Não instancie.");
    }

    static pairs = {};

    static addPair(route, a, b) {
        this.pairs[`${a.id},${b.id}`] = route;
    }

    static getCollision(point) {
        let mapPos = Graficos.getNormalizedCoordinates(point.x, point.y);

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

    static removeRoute(route, reverb=false) {
        Graficos.clearRoutePart(route);
        
        delete this.pairs[`${route.start.id},${route.end.id}`]; 
        delete this.pairs[`${route.end.id},${route.start.id}`];

        if (reverb) {
            route.start.lines = removeObj(route.start.lines, route);
            route.end.lines = removeObj(route.end.lines, route);
        }
    }
}

export class Route {
    constructor(start) {
        this.points = {};
        this.points[start.id] = 1;
        
        this.parts = [];

        this.currPart = new routeLine(start);
    }

    finishPart(end) {
        this.currPart.setEnd(end);

        this.parts.push(this.currPart);
        this.points[end.id] = 1;

        Router.addPair(this.currPart, this.currPart.start, end);

        this.currPart = new routeLine(end);
    }

    end() {
        this.currPart.start.lines = removeObj(this.currPart.start.lines, this.currPart);
        Graficos.clearRoutePart(this.currPart);
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

    static convertPos(pos) {
        const newPos = {
            x: Math.floor(pos.x / this.hashSize),
            y: Math.floor(pos.x / this.hashSize)
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

    static getCollision(pos, route=false) {
        let mapPos = Graficos.getNormalizedCoordinates(pos.x, pos.y);
        const location = this.convertPos({x: mapPos.x, y: mapPos.y});
        for (let i = 0; i < 9; i ++) {
            let offset = {
                x: (i % 3) - 1,
                y: Math.floor(i / 3) - 1
            }
            const key = this.posKey({x: location.x + offset.x, y: location.y + offset.y});
            if (key in this.hashMap) {
                for (const point of this.hashMap[key]) {
                    if (route != false) {
                        let pointKey = point.id;
                        let startKey = route.currPart.start.id;
                        let pairKeys = [
                            `${startKey},${pointKey}`,
                            `${pointKey},${startKey}`,
                        ];
                        let pairDone = Router.pairs[pairKeys[0]] || Router.pairs[pairKeys[1]];
                        if (pointKey in route.points || pairDone) {
                            continue;
                        }
                    }
                    const distance = Math.sqrt(Math.pow(point.pos.x - mapPos.x, 2) + Math.pow(point.pos.y - mapPos.y, 2));
                    if (distance < Referencer.radius) {
                        return point;
                    }
                }
            }
        }
        return false;
    }

    static removeReference(ref) {
        Graficos.clearPoint(ref);
        
        for (const element of ref.lines) {
            Router.removeRoute(element);
        }
        const location = this.convertPos(ref.pos);
        const key = this.posKey(location);
        
        delete this.references[String(ref.id)];

        this.hashMap[key] = removeObj(this.hashMap[key], ref);

    }

    static addReference(ref) {
        this.references[String(ref.id)] = ref;
        const location = this.convertPos(ref.pos);
        const key = this.posKey(location);
        if (!(key in this.hashMap)) {
            this.hashMap[key] = [];
        }
        this.hashMap[key].push(ref);
    }

    static updateRef(ref, pos) {
        let mapPos = Graficos.getNormalizedCoordinates(pos.x, pos.y);

        let location = this.convertPos(ref.pos);
        let key = this.posKey(location);
        this.hashMap[key] = removeObj(this.hashMap[key], ref);
        
        ref.pos = mapPos;
        ref.obj
        .clear()
        .circle(mapPos.x, mapPos.y, 10 / Graficos.zoom)
        .fill({ color: 0xffffff})
        .stroke({ width: 4 / Graficos.zoom, color: 0x4000ff });

        for(const line of ref.lines) {
            Graficos.setRouteLine(line, line.end.pos);
        }

        location = this.convertPos(ref.pos);
        key = this.posKey(location);
        if (!(key in this.hashMap)) {
            this.hashMap[key] = [];
        }
        this.hashMap[key].push(ref);
    }

    static setReferenceObj(obj) {
        this.referenceObj = obj;
    }
}

export class Builder {
    constructor() {
        throw new Error("Classe estática. Não instancie.");
    }

    static buildings = [];

    static removeBuild(build) {
        this.buildings = removeObj(this.buildings, build);
        Graficos.clearBuild(build);
    }

    static getCollision(point) {
        let mapPos = Graficos.getNormalizedCoordinates(point.x, point.y);

        for(const build of this.buildings) {
            for(const area of build.areas) {
                let box = area.aabb();
                let horizontal = mapPos.x > box.x && mapPos.x < box.x + box.w;
                let vertical = mapPos.y > box.y && mapPos.y < box.y + box.h;
                if (horizontal && vertical) {
                    return build;
                }
            }
        }
        return false;
    }
}

export class Building {
    constructor(name) {
        this.name = name;
        this.areas = [];
        this.polygon = false;
    }
    setPin(pos) {
        this.pos = pos;
    }
    setPinObj(obj) {
        this.pinObj = obj;
    }
    addArea(area) {
        this.areas.push(area);
    }
    generatePolygon() {
        Graficos.clearSquares(this);
        this.polygon = polygonUnion(this.areas);
        Graficos.addBuildPolygon(this);
    }
    revertPolygon() {
        for (const poly of this.polygonObj) {   
            poly.clear();
        }
        for (const area of this.areas) {
            area.areaObj
            .clear()
            .rect(0, 0, Math.abs(area.width), Math.abs(area.height))
            .fill({ color: 0x5c56f9, alpha: 0.78 })
            .stroke({ width: 4, color: 0x4000ff });

            area.areaObj.position.set(Math.min(area.x, area.x - area.width), Math.min(area.y, area.y - area.height));
        }
    }
    setPolygonObj(obj) {
        this.polygonObj = obj;
    }
    getCollision(point) {
        let mapPos = Graficos.getNormalizedCoordinates(point.x, point.y);

        for(const area of this.areas.reverse()) {
            let box = area.aabb();
            let horizontal = mapPos.x > box.x && mapPos.x < box.x + box.w;
            let vertical = mapPos.y > box.y && mapPos.y < box.y + box.h;
            if (horizontal && vertical) {
                return {
                    r: area,
                    b: box,
                }
            }
        }
        return false;
    }
    removeArea(area) {
        Graficos.clearArea(area);
        this.areas = removeObj(this.areas, area);
    }
}

export class Reference {
    constructor(pos) {
        let mapPos = Graficos.getNormalizedCoordinates(pos.x, pos.y);
        this.pos = mapPos;
        this.id = Referencer.getId();
        this.lines = [];
    }

    setObj(obj) {
        this.obj = obj;
    }
}

export class BuildArea {
    constructor(pos) {
        this.success = false;
        let mapPos = Graficos.getNormalizedCoordinates(pos.x, pos.y);
        this.x = mapPos.x;
        this.y = mapPos.y;
    }

    setAreaObj(obj) {
        this.areaObj = obj;
    }

    aabb() {
        return {x: Math.min(this.x, this.x - this.width), y: Math.min(this.y, this.y - this.height), w: Math.abs(this.width), h: Math.abs(this.height)};
    }

    setSize(size) {
        let mapSize = Graficos.getNormalizedCoordinates(size.x, size.y);
        this.width = this.x - mapSize.x;
        this.height = this.y - mapSize.y;

        if (!(Math.abs(this.width) > 10 && Math.abs(this.height) > 10)) {
            this.success = false;
        } else {
            this.success = true;
        }
    }
    setPos(pos, box) {
        let mapSize = Graficos.getNormalizedCoordinates(pos.x, pos.y);
        let mapClick = Graficos.getNormalizedCoordinates(pos.cx, pos.cy);
        this.x = mapSize.x + box.x - mapClick.x;
        this.y = mapSize.y + box.y - mapClick.y;
    }
}