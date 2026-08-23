import * as Transformacao from "./transformacao.js";
import * as Editor from "./editor.js";

export let map;
export let mapContainer;
let textContainer;
let referenceContainer;
let routeContainer;
let areasContainer;
let pinContainer;
let app;

export let tempConnection;
export let tempReference;

let page;

let color;
let textColor;
let mapImagePath;
let pinImagePath;

let pinoSprite;
let mapSprite;
let mapTextures;
let gl;

export let minZoom, maxZoom;
let zoomStep;

let smoothTransform = false;
let updating = false;
export let zoom = 1;
export let scaleFactor = 1;

export let imageSize;

export function getNormalizedCoordinates(screenX, screenY) {
    const localPoint = mapContainer.toLocal({ x: screenX, y: screenY });

    return {
        x: localPoint.x,
        y: localPoint.y
    };
}

export function getScreenCoordinates(localX, localY) {
    const screenPoint = mapContainer.toGlobal({ x: localX, y: localY });

    return {
        x: screenPoint.x,
        y: screenPoint.y
    };
}




export function newRegion(x=0, y=0, w=0, h=0) {
    let square = new PIXI.Graphics();

    if (!(w == 0 && h == 0)) {
        square
        .rect(0, 0, w, h)
        .fill({ color: 0x5c56f9, alpha: 0.78 })
        .stroke({ width: 4, color: 0x4000ff });
    }
    
    square.position.set(x, y);
    areasContainer.addChild(square);

    return square;
}
export function updateRegion(region, x, y, w, h) {
    region
    .clear()
    .rect(0, 0, w, h)
    .fill({ color: 0x5c56f9, alpha: 0.78 })
    .stroke({ width: 4, color: 0x4000ff });

    region.position.set(x, y);
}
export function removeRegion(region) {
    areasContainer.removeChild(region);
    
    region.destroy({
        children: true,
        texture: true,
        baseTexture: true
    });
}

export function newPolygon(points) {
    let polygons = [];
    for (const region of points) {
        let flattenedPoints = region.flat();
    
        let polygonObj = new PIXI.Graphics();

        polygonObj
            .poly(flattenedPoints, true)
            .fill({ color: 0x5c56f9, alpha: 0.78 })
            .stroke({ width: 4, color: 0x4000ff });
    
        polygonObj.position.set(0, 0);
        areasContainer.addChild(polygonObj);
    
        polygons.push(polygonObj);
    }

    return polygons;
}

export function removePolygon(polygons) {
    for(const polygon of polygons) {

        areasContainer.removeChild(polygon);
        
        polygon.destroy({
            children: true,
            texture: true,
            baseTexture: true
        });
    }
}

export function newPin(x, y, text) {
    let buildPino = PIXI.Sprite.from(pinImagePath);
    buildPino.anchor.set(0.5, 1);
    buildPino.x = x;
    buildPino.y = y;
    buildPino.scale.set(1 / zoom / 7.5);

    pinContainer.addChild(buildPino);

    const nodeLabel = new PIXI.Text({
        text: text,
        style: {
            fontFamily: 'Arial',
            fontSize: 28,
            fill: textColor,
            align: 'center',
            stroke: { color: "white", width: 3 }
        }
    });
    nodeLabel.anchor.set(-0.2, 1);
    nodeLabel.x = x;
    nodeLabel.y = y;
    nodeLabel.scale.set(1 / zoom / 2);

    pinContainer.addChild(nodeLabel);

    return {pin: buildPino, label: nodeLabel};
}
export function updatePin(pin, x, y, text) {
    pin.pin.x = x;
    pin.pin.y = y;
    pin.pin.scale.set(1 / zoom / 7.5);

    const nodeLabel = new PIXI.Text({
        text: text,
        style: {
            fontFamily: 'Arial',
            fontSize: 28,
            fill: textColor,
            align: 'center',
            stroke: { color: "white", width: 3 }
        }
    });
    nodeLabel.anchor.set(-0.2, 1);
    nodeLabel.x = x;
    nodeLabel.y = y;
    nodeLabel.scale.set(1 / zoom / 2);

    pinContainer.addChild(nodeLabel);

    pinContainer.removeChild(pin.label);
    pin.label.destroy({
        children: true,
        texture: true,
        baseTexture: true
    });

    pin.label = nodeLabel;
}
export function removePin(pin) {    
    pinContainer.removeChild(pin.pin);
    pinContainer.removeChild(pin.label);
    
    pin.pin.destroy({
        children: true,
        texture: true,
        baseTexture: true
    });
    pin.label.destroy({
        children: true,
        texture: true,
        baseTexture: true
    });
}



export function newReference(x, y, temp=false) {
    let point = new PIXI.Graphics();

    let alpha = 1;
    if (temp) {
        alpha = .5;
    }

    point
    .circle(x, y, 10 / zoom)
    .fill({ color: 0xffffff, alpha: alpha})
    .stroke({ width: 4 / zoom, color: 0x4000ff });
    
    point.position.set(0, 0);
    referenceContainer.addChild(point);

    return point;
}
export function updateReference(graphics, x, y, temp=false) {
    let alpha = 1;
    if (temp) {
        alpha = .5;
    }

    graphics
    .clear()
    .circle(x, y, 10 / zoom)
    .fill({ color: 0xffffff, alpha: alpha})
    .stroke({ width: 4 / zoom, color: 0x4000ff });
}

export function removeReference(graphics) {    
    referenceContainer.removeChild(graphics);
    
    graphics.destroy({
        children: true,
        texture: true,
        baseTexture: true
    });
}


export function newConnection(x1, y1, x2=null, y2=null, temp=false) {
    let routeGraphics = new PIXI.Graphics();
    
    if (x2 === null || y2 === null) {
        x2 = x1;
        y2 = y1;
    }

    let alpha = 1;
    if (temp) {
        alpha = .5;
    }

    routeGraphics
    .moveTo(x1, y1)
    .lineTo(x2, y2)
    .stroke({ width: 8, color: 0x4000ff, alpha: alpha});
    
    routeGraphics.position.set(0, 0);
    routeContainer.addChild(routeGraphics);

    return routeGraphics;
}

export function updateConnection(graphics, x1, y1, x2, y2, temp=false) {    
    let alpha = 1;
    if (temp) {
        alpha = .5;
    }
    
    graphics
    .clear()
    .moveTo(x1, y1)
    .lineTo(x2, y2)
    .stroke({ width: 8, color: 0x4000ff, alpha: alpha });
}
export function removeConnection(graphics) {    
    routeContainer.removeChild(graphics);
    
    graphics.destroy({
        children: true,
        texture: true,
        baseTexture: true
    });
}


export async function setBuildAreaSize(square) {
    if (!(Math.abs(square.width) > 10 && Math.abs(square.height) > 10)) {
        square.areaObj.clear();
    } else {
        square.areaObj
        .clear()
        .rect(0, 0, Math.abs(square.width), Math.abs(square.height))
        .fill({ color: 0x5c56f9, alpha: 0.78 })
        .stroke({ width: 4, color: 0x4000ff });
        square.areaObj.position.set(Math.min(square.x, square.x - square.width), Math.min(square.y, square.y - square.height));
    }
}

export function setContext(context) {
    page = context.page;
    color = context.blank_color;
    textColor = context.text_color;

    zoomStep = context.scroll_ratio;

    mapImagePath = mapImage;
    pinImagePath = pinImage;
}

export function setPinPosition(x, y) {
    pinoSprite.x = x;
    pinoSprite.y = y;
}

export function showPin(show) {
    pinoSprite.visible = show;
}

export async function main() {
    app = new PIXI.Application();
    await app.init({ 
        resizeTo: window,
        backgroundColor: color,
        resolution: window.devicePixelRatio || 1,
    });
    
    
    gl = app.renderer.gl;
    map = document.getElementById("map");
    map.appendChild(app.canvas);
    
    mapContainer = new PIXI.Container();
    app.stage.addChild(mapContainer);
    
    mapContainer.x = app.screen.width / 2;
    mapContainer.y = app.screen.height / 2;
    
    const texture = await PIXI.Assets.load(mapImagePath);
    mapSprite = PIXI.Sprite.from(texture);
    mapSprite.anchor.set(0.5); 
    mapSprite.x = 0;
    mapSprite.y = 0;
    mapContainer.addChild(mapSprite);
    
    imageSize = { width: mapSprite.width, height: mapSprite.height };

    minZoom = Math.max(app.screen.width, app.screen.height) / Math.max(imageSize.width, imageSize.height);
    maxZoom = 3;
    
    const pinoTexture = await PIXI.Assets.load(pinImagePath);
    pinoSprite = PIXI.Sprite.from(pinoTexture);
    pinoSprite.anchor.set(0.5, 1);
    pinoSprite.visible = false;
    pinoSprite.x = 0;
    pinoSprite.y = 0;
    pinoSprite.scale.set(1 / zoom / 7.5);
    mapContainer.addChild(pinoSprite);
    
    textContainer = new PIXI.Container();
    mapContainer.addChild(textContainer);

    areasContainer = new PIXI.Container();
    mapContainer.addChild(areasContainer);

    routeContainer = new PIXI.Container();
    mapContainer.addChild(routeContainer);

    referenceContainer = new PIXI.Container();
    mapContainer.addChild(referenceContainer);

    pinContainer = new PIXI.Container();
    mapContainer.addChild(pinContainer);
}

export function nodeText(text, configuration) {
    const nodeLabel = new PIXI.Text({
        text: text,
        style: {
            fontFamily: 'Arial',
            fontSize: 28,
            fill: textColor,
            align: 'center',
            dropShadow: true,
            dropShadowColor: '#fff',
            dropShadowAngle: Math.PI / 4,
            dropShadowDistance: 2,
            dropShadowBlur: 2
        }
    });
    nodeLabel.anchor.set(0.5, 1);
    nodeLabel.x = configuration.x;
    nodeLabel.y = configuration.y;
    nodeLabel.scale.set(1 / zoom / 2);
    textContainer.addChild(nodeLabel);
}

function ceilPowerOf2(x) { return x <= 0 ? 1 : Math.pow(2, Math.ceil(Math.log2(x))); }
function floorPowerOf2(x) { return x <= 0 ? 1 : Math.pow(2, Math.floor(Math.log2(x))); }

export async function loadMapScales() {
    const svgText = await fetch(mapImagePath).then(r => r.text());
    const mapBlob = new Blob([svgText], { type: "image/svg+xml" });
    const mapUrl = URL.createObjectURL(mapBlob);
    const img = new Image();

    mapTextures = {};

    img.onload = () => {
        for (const scale of [0.125, 0.25, 0.5, 1, 2, 4, 8]) {
            let key = `image-${scale}`;
            if (!localStorage.getItem(key)) {continue};
            const longestSide = Math.max(img.width, img.height);
            const maxRenderZoom = gl.getParameter(gl.MAX_TEXTURE_SIZE) / longestSide;
            let currentFactor = Math.min(floorPowerOf2(maxRenderZoom), Math.max(minZoom, scale * window.devicePixelRatio));
            const canvas = document.createElement("canvas");
            canvas.width = img.width * currentFactor;
            canvas.height = img.height * currentFactor;

            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            localStorage.setItem(key, PIXI.Texture.from(canvas));
        };
    };

    img.src = mapUrl;
}

async function updateMapTexture() {
    const longestSide = Math.max(imageSize.width, imageSize.height);
    const maxRenderZoom = gl.getParameter(gl.MAX_TEXTURE_SIZE) / longestSide;
    let currentFactor = Math.min(ceilPowerOf2(maxRenderZoom), Math.max(minZoom, zoom * window.devicePixelRatio));

    let scale = ceilPowerOf2(currentFactor);
    mapSprite.texture = localStorage.getItem(`image-${scale}`) || mapSprite.texture;
    mapSprite.scale.set(imageSize.width / mapSprite.texture.width);
};

export async function updateMap() {
    if (updating) return;
    updating = true;
    await updateMapTexture();
    updating = false;
}

function clampPos() {
    mapContainer.x = Math.max(-imageSize.width / 2 * zoom + 3 * app.screen.width / 4, Math.min(imageSize.width / 2 * zoom + app.screen.width / 4, mapContainer.x));
    mapContainer.y = Math.max(-imageSize.height / 2 * zoom + 3 * app.screen.height / 4, Math.min(imageSize.height / 2 * zoom + app.screen.height / 4, mapContainer.y));
}

function Position(x, y) {
    mapContainer.x = x;
    mapContainer.y = y;
    clampPos();
}

export function setPosition(x, y) {
    if (!smoothTransform) {
        Position(x, y);
    }
}

function Zoom(z) {
    zoom = z;
    mapContainer.scale.set(zoom);
    pinoSprite.scale.set(1 / zoom / 7.5);
    for (const child of pinContainer.children) {
        if (child instanceof PIXI.Text) {
            child.scale.set(1 / zoom / 2);
        } else {
            child.scale.set(1 / zoom / 7.5);
        }
    }
    for (const child of textContainer.children) {
        child.scale.set(1 / zoom / 2);
    }
    let references = Editor.Referencer.references;
    for (const ref of Object.values(references)) {
        updateReference(ref.graphics, ref.pos.x, ref.pos.y);
    };
    Editor.Referencer.radius = 15 / zoom;

    // if (tempReference) {
    //     tempReference.drawRef
    // }

    clampPos();
}

export function setZoom(z) {
    if (!smoothTransform) {
        Zoom(z);
    }
}

function Rotation(r) {
    mapContainer.rotation = r;
    pinoSprite.rotation = -r;
    for (const child of textContainer.children) {
        child.rotation = -r;
    }
}

export function setRotation(r) {
    if (!smoothTransform) {
        Rotation(r);
    }
}

export function editorFocus(value) {
    mapSprite.alpha = 1;
    if (value) {
        mapSprite.alpha = 0.5;
    }
}

export function smoothRotation(r) {
    if (!smoothTransform) {
        smoothTransform = true;

        let time = 0;
        const initialRotation = mapContainer.rotation;

        let diff = r - initialRotation;

        diff = ((diff + Math.PI) % (2 * Math.PI)) - Math.PI;
        if (diff < -Math.PI) diff += 2 * Math.PI;

        const shortestTargetRotation = initialRotation + diff;

        let containerPos = {x: mapContainer.x, y: mapContainer.y};

        const transform = setInterval(() => {
            time += 1000 / 60;
            let t = Math.min(time / 500, 1);
            let interpolation = t * t * (3 - 2 * t);

            Rotation(initialRotation + (shortestTargetRotation - initialRotation) * interpolation);
            let center = {x: window.visualViewport.width / 2, y: window.visualViewport.height / 2}
            let rotatedCenter = Transformacao.rotatePoint(center.x, center.y, mapContainer.rotation);
            let pivo = Transformacao.rotatePoint(containerPos.x - center.x, containerPos.y - center.y, mapContainer.rotation - initialRotation);
            pivo = {x: pivo.x + center.x, y: pivo.y + center.y};
            Position(pivo.x, pivo.y);
            if (time >= 500) {
                smoothTransform = false;
                clearInterval(transform);

                mapContainer.rotation = ((mapContainer.rotation + Math.PI) % (2 * Math.PI)) - Math.PI;
            }
        }, 1000 / 60);
    }
}