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
        Connections.setRelated(this, false);
        Connections.untrack(this);
    }
}

export class Building {
    constructor(start, end) {
        this.alpha = 1;
        this.colorOut = 0x3d97e0;
        this.colorIn = 0xa4d1f5;
        this.enabled = true;
        this.size = 10;

        this.id = -1;
        this.hover = 0;
        this.hoverTime = .2;
        // Connections.track(this);
        // Connections.setRelated(this, true);
        
        this.positionTracked = false;
        
        this.graphics = Graficos.createConnection();
        
        this.updateGraphics();
    }
}

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