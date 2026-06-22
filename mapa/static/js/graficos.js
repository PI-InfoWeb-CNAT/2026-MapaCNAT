import * as Transformacao from "./transformacao.js";

export let map;
export let mapContainer;
let textContainer;
let buildContainer;
let areasContainer;
let pinContainer;
let app;

let page;

let color;
let textColor;
let mapImagePath;
let pinImagePath;

let pinoSprite;
let gl;
let mapSprite;
let mapTextures;

export let minZoom, maxZoom;
let zoomStep;

let smoothTransform = false;
let updating = false;
export let zoom = 1;
export let scaleFactor = 1;

export let imageSize;

class BuildArea {
    constructor(pos) {
        this.success = false;

        let mapPos = getNormalizedCoordinates(pos.x, pos.y);
        this.x = mapPos.x;
        this.y = mapPos.y;

        this.square = new PIXI.Graphics();

        this.square
        .rect(0, 0, 0, 0)
        .fill({ color: 0x5c56f9, alpha: 0.78 })
        .stroke({ width: 4, color: 0x4000ff });
        
        this.square.position.set(0, 0);
        buildContainer.addChild(this.square);
    }
    setSize(size) {
        let mapSize = getNormalizedCoordinates(size.x, size.y);
        this.width = this.x - mapSize.x;
        this.height = this.y - mapSize.y;

        if (!(Math.abs(this.width) > 10 && Math.abs(this.height) > 10)) {
            this.success = false;
            
            this.square.clear();
        } else {
            this.success = true;

            this.square
            .clear()
            .rect(0, 0, Math.abs(this.width), Math.abs(this.height))
            .fill({ color: 0x5c56f9, alpha: 0.78 })
            .stroke({ width: 4, color: 0x4000ff });
    
            this.square.position.set(Math.min(this.x, this.x - this.width), Math.min(this.y, this.y - this.height));
        }

        confirmStep.classList.add("hidden");
        for (let i=0; i < stepSquares.length; i++) {
            if (stepSquares[i].success) {
                confirmStep.classList.remove("hidden");
                break;
            }
        }
    }
}

export function updateBuilding() {
    for (const child of textContainer.children) {
        buildContainer.removeChild(child);
    }
    for (const square of stepSquares) {
        square.square.destroy({ 
            children: true, 
            texture: true, 
            baseTexture: true 
        });
    }
    stepSquares = [];

    for (const building of buildings) {
        if(!building.graphics) {
            building.graphics = true;
            for (const area of building.area) {
                let points = area;
    
                let flattenedPoints = points.flat();
    
                let build = new PIXI.Graphics();
    
                build
                    .poly(flattenedPoints, true)
                    .fill({ color: 0x5c56f9, alpha: 0.78 })
                    .stroke({ width: 4, color: 0x4000ff });
    
                build.position.set(0, 0);
                areasContainer.addChild(build);
            }
        }
    }
}

function getNormalizedCoordinates(screenX, screenY) {
    const localPoint = mapContainer.toLocal({ x: screenX, y: screenY });

    return {
        x: localPoint.x,
        y: localPoint.y
    };
}

function getScreenCoordinates(localX, localY) {
    const screenPoint = mapContainer.toGlobal({ x: localX, y: localY });

    return {
        x: screenPoint.x,
        y: screenPoint.y
    };
}

export async function addBuildPin(pos) {
    const buildPinoSprite = await PIXI.Assets.load(pinImagePath);

    let mapPos = getNormalizedCoordinates(pos.x, pos.y);
    let buildPino = PIXI.Sprite.from(buildPinoSprite);
    buildPino.anchor.set(0.5, 1);
    buildPino.x = mapPos.x;
    buildPino.y = mapPos.y;
    buildPino.scale.set(1 / zoom / 7.5);
    
    pinContainer.addChild(buildPino);

    const nodeLabel = new PIXI.Text({
        text: buildName,
        style: {
            fontFamily: 'Arial',
            fontSize: 28,
            fill: textColor,
            align: 'center',
            stroke: { color: "white", width: 3 }
        }
    });
    nodeLabel.anchor.set(-0.2, 1);
    nodeLabel.x = mapPos.x;
    nodeLabel.y = mapPos.y;
    buildCoordinates = mapPos;
    nodeLabel.scale.set(1 / zoom / 2);

    pinContainer.addChild(nodeLabel);
    
}

export function createBuildArea(pos) {
    let square = new BuildArea(pos);
    stepSquares.push(square);
    return square;
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

    buildContainer = new PIXI.Container();
    mapContainer.addChild(buildContainer);

    areasContainer = new PIXI.Container();
    mapContainer.addChild(areasContainer);

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
            stroke: { color: "white", width: 3 }
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