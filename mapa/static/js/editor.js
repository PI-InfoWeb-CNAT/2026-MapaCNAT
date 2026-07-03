import * as Graficos from "./graficos.js";
import * as Geometria from "./geometria.js";

const referenceIcon = document.getElementById("reference");
const routeIcon = document.getElementById("route");

let buildName;
let buildCoordinates;

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
    }

    setEnd(end) {
        this.end = end;
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

    static addPair(a, b) {
        this.pairs[`${a.id},${b.id}`] = 1;
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

        Router.addPair(this.currPart.start, end);

        this.currPart = new routeLine(end);
    }

    end() {
        Graficos.clearRoutePart(this.currPart);
    }
}

export class Referencer {
    constructor() {
        throw new Error("Classe estática. Não instancie.");
    }

    static references = [];
    static hashMap = {};
    static hashSize = 100;
    static id = 0;
    static radius;

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

    static addReference(ref) {
        this.references.push(ref);
        const location = this.convertPos(ref.pos);
        const key = this.posKey(location);
        if (!(key in this.hashMap)) {
            this.hashMap[key] = [];
        }
        this.hashMap[key].push(ref);
    }

    static setReferenceObj(obj) {
        this.referenceObj = obj;
    }
}

export class Building {
    constructor(name) {
        this.name = name;
        this.areas = [];
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
        this.polygon = polygonUnion(this.areas);
    }
    setPolygonObj(obj) {
        this.polygonObj = obj;
    }
}

export class Reference {
    constructor(pos) {
        let mapPos = Graficos.getNormalizedCoordinates(pos.x, pos.y);
        this.pos = mapPos;
        this.id = Referencer.getId();
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
}