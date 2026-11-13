import * as Transformacao from "./transformacao.js";
import * as Editor from "./editor.js";

export let map;
export let mapContainer;
let textContainer;
let referenceContainer;
let connectionContainer;
let areasContainer;
let pinContainer;
let app;

let avatarSize = 20;

export let tempConnection;
export let tempReference;

let page;

let color;
let textColor;
let mapImagePath;
let pinImagePath;
let userImagePath;
let entranceImagePath;

let entranceTexture;

let temporaryPin;
let mapSprite;
let userTexture;
let mapTextures;
let gl;

export let minZoom, maxZoom;
let zoomStep;

let smoothTransform = false;
let updating = false;
export let zoom = 1;
export let scaleFactor = 1;

export let imageSize;

export let groups;

export function getContainerPosForPoint(worldPos, screenTarget) {
    // 1. Get current scale and rotation of mapContainer
    const scaleX = mapContainer.scale?.x ?? mapContainer.scaleX ?? 1;
    const scaleY = mapContainer.scale?.y ?? mapContainer.scaleY ?? 1;
    const rotation = mapContainer.rotation || 0;

    // 2. Default screen target to the center of the viewport if not specified
    const target = screenTarget || {
        x: window.visualViewport.width / 2,
        y: window.visualViewport.height / 2,
    };

    // 3. Apply scale
    const scaledX = worldPos.x * scaleX;
    const scaledY = worldPos.y * scaleY;

    // 4. Apply container rotation to the scaled point
    // (Uses your Transformacao.rotatePoint if available, otherwise pure math)
    let rotatedX, rotatedY;

    if (typeof Transformacao !== "undefined" && Transformacao.rotatePoint) {
        const rotated = Transformacao.rotatePoint(scaledX, scaledY, rotation);
        rotatedX = rotated.x;
        rotatedY = rotated.y;
    } else {
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        rotatedX = scaledX * cos - scaledY * sin;
        rotatedY = scaledX * sin + scaledY * cos;
    }

    // 5. Calculate container offset to align local point with target screen position
    return {
        x: target.x - rotatedX,
        y: target.y - rotatedY,
    };
}

export function getNormalizedCoordinates(pos) {
    const localPoint = mapContainer.toLocal(pos);

    return {
        x: localPoint.x,
        y: localPoint.y,
    };
}

export function getScreenCoordinates(pos) {
    const screenPoint = mapContainer.toGlobal(pos);

    return {
        x: screenPoint.x,
        y: screenPoint.y,
    };
}

/////////////////// Reference

export function createReference() {
    let point = new PIXI.Graphics();

    point.position.set(0, 0);
    referenceContainer.addChild(point);

    let referenceImg = PIXI.Sprite.from(entranceTexture);
    referenceImg.anchor.set(0.5, 0.5);
    let initialSize = referenceImg.width;
    referenceImg.scale.set(15 / initialSize / zoom);
    referenceContainer.addChild(referenceImg);

    return { point: point, door: referenceImg, initialSize: initialSize };
}

export function renderReference(graphics, data) {
    let alpha = data.alpha;
    let colorOut = data.colorOut;
    let colorIn = data.colorIn;
    let size = data.size;
    let pos = data.coordinate.getIn("normal");

    graphics.point
        .clear()
        .circle(pos.x, pos.y, size / zoom)
        .fill({ color: colorIn, alpha: alpha })
        .stroke({ width: 4 / zoom, color: colorOut });

    if (data.isEntrance) {
        graphics.door.visible = true;
        graphics.door.scale.set((size * 2) / graphics.initialSize / zoom);
        graphics.door.tint = colorOut;
        graphics.door.x = pos.x;
        graphics.door.y = pos.y;
    } else {
        graphics.door.visible = false;
    }
}

export function BringToFrontReference(graphics) {
    if (graphics && graphics.parent === referenceContainer) {
        referenceContainer.addChild(graphics.point);
        referenceContainer.addChild(graphics.door);
    }
}

export function clearReference(graphics) {
    graphics.point.clear();
    graphics.door.visible = false;
}

export function destroyReference(graphics) {
    referenceContainer.removeChild(graphics.point);
    referenceContainer.removeChild(graphics.door);

    graphics.point.destroy({
        children: true,
        texture: true,
        baseTexture: true,
    });
    graphics.door.destroy({
        children: true,
        texture: true,
        baseTexture: true,
    });
}

/////////////////// Connection

export function createConnection() {
    let connection = new PIXI.Graphics();

    connection.position.set(0, 0);
    connectionContainer.addChild(connection);

    return connection;
}

export function renderConnection(graphics, data) {
    let alpha = data.alpha;
    let colorOut = data.colorOut;
    let colorIn = data.colorIn;
    let size = data.size;

    let points = data.points;
    let radius = data.radius ? data.radius : 5;

    if (points.length < 2) {
        return;
    }

    const buildPath = (g) => {
        let p0 = points[0].getIn("normal");
        g.moveTo(p0.x, p0.y);

        for (let i = 1; i < points.length - 1; i++) {
            const p1 = points[i].getIn("normal");
            const p2 = points[i + 1].getIn("normal");

            g.arcTo(p1.x, p1.y, p2.x, p2.y, radius);
        }

        const last = points[points.length - 1].getIn("normal");
        g.lineTo(last.x, last.y);
    };

    graphics.clear();

    buildPath(graphics);
    graphics.stroke({
        width: (size + 6) / zoom,
        color: colorOut,
        alpha: alpha,
        cap: "round",
        join: "round",
    });

    buildPath(graphics);
    graphics.stroke({
        width: size / zoom,
        color: colorIn,
        alpha: alpha,
        cap: "round",
        join: "round",
    });
}
export function clearConnection(graphics) {
    graphics.clear();
}

export function destroyConnection(graphics) {
    connectionContainer.removeChild(graphics);

    graphics.destroy({
        children: true,
        texture: true,
        baseTexture: true,
    });
}

/////////////////// Pin

export function createPin(name) {
    let buildPino = PIXI.Sprite.from(pinImagePath);
    buildPino.anchor.set(0.5, 1);
    buildPino.scale.set(1 / 7.5);
    buildPino.tint = 0xff0000;
    
    const nodeLabel = new PIXI.Text({
        text: name,
        style: {
            fontFamily: "Arial",
            fontSize: 28,
            fill: textColor,
            align: "center",
            stroke: { color: "white", width: 3 },
        },
    });
    nodeLabel.anchor.set(0, 1);
    nodeLabel.scale.set(1 / 2);
    nodeLabel.x = buildPino.width / 2;

    let pinGfx = new PIXI.Container();

    pinGfx.addChild(nodeLabel);
    pinGfx.addChild(buildPino);

    pinContainer.addChild(pinGfx);

    return pinGfx;
}

export function renderPin(graphics, data) {
    let pos = data.coordinate.getIn("normal");
    let size = data.size;
    graphics.children[0].style.fill = data.color;
    graphics.visible = true;
    graphics.x = pos.x;
    graphics.y = pos.y;
    graphics.scale.set(size / zoom);
}
export function clearPin(graphics) {
    graphics.visible = false;
}

export function destroyPin(graphics) {
    pinContainer.removeChild(graphics);

    for (const child of graphics.children) {
        child.destroy({
            children: true,
            texture: true,
            baseTexture: true,
        });
    }

    graphics.destroy({ children: true });
}

export function showTemporaryPin(coordinate) {
    if (!temporaryPin) return;

    renderPin(temporaryPin, {
        coordinate: coordinate,
        size: 1,
        color: textColor,
    });
}

export function hideTemporaryPin() {
    if (!temporaryPin) return;

    clearPin(temporaryPin);
}

/////////////////// Areas

function normalizeBox(x1, y1, x2, y2) {
    return {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
        minX: Math.min(x1, x2),
        maxX: Math.max(x1, x2),
        minY: Math.min(y1, y2),
        maxY: Math.max(y1, y2),
    };
}

export function createArea() {
    let area = new PIXI.Graphics();
    area.position.set(0, 0);
    areasContainer.addChild(area);
    return area;
}

export function renderArea(graphics, data) {
    let alpha = data.alpha;
    let colorOut = data.colorOut;
    let colorIn = data.colorIn;
    let size = data.borderSize / zoom;
    let radius = data.radius !== undefined ? data.radius : 12;

    let start = data.start.getIn("normal");
    let end = data.end.getIn("normal");
    let box = normalizeBox(start.x, start.y, end.x, end.y);

    graphics.clear();

    if (box.width < 2 || box.height < 2) return;

    const { x, y, width: w, height: h } = box;
    const r = Math.min(radius, w / 2, h / 2);

    graphics.roundRect(x, y, w, h, r);
    graphics.fill({ color: colorIn, alpha: alpha * 0.35 });

    const borderColors =
        typeof colorOut === "object" && colorOut !== null
            ? colorOut
            : {
                  top: colorOut,
                  right: colorOut,
                  bottom: colorOut,
                  left: colorOut,
              };

    const getStroke = (color) => ({
        width: size,
        color: color,
        alpha: alpha,
        alignment: 0.5,
    });

    if (r > 0) {
        graphics.beginPath();
        graphics.arc(x + r, y + r, r, Math.PI * 1.25, Math.PI * 1.5);
        graphics.lineTo(x + w - r, y);
        graphics.arc(x + w - r, y + r, r, Math.PI * 1.5, Math.PI * 1.75);
        graphics.stroke(getStroke(borderColors.top));

        graphics.beginPath();
        graphics.arc(x + w - r, y + r, r, Math.PI * 1.75, Math.PI * 2);
        graphics.lineTo(x + w, y + h - r);
        graphics.arc(x + w - r, y + h - r, r, 0, Math.PI * 0.25);
        graphics.stroke(getStroke(borderColors.right));

        graphics.beginPath();
        graphics.arc(x + w - r, y + h - r, r, Math.PI * 0.25, Math.PI * 0.5);
        graphics.lineTo(x + r, y + h);
        graphics.arc(x + r, y + h - r, r, Math.PI * 0.5, Math.PI * 0.75);
        graphics.stroke(getStroke(borderColors.bottom));

        graphics.beginPath();
        graphics.arc(x + r, y + h - r, r, Math.PI * 0.75, Math.PI);
        graphics.lineTo(x, y + r);
        graphics.arc(x + r, y + r, r, Math.PI, Math.PI * 1.25);
        graphics.stroke(getStroke(borderColors.left));
    } else {
        graphics
            .beginPath()
            .moveTo(x, y)
            .lineTo(x + w, y)
            .stroke(getStroke(borderColors.top));
        graphics
            .beginPath()
            .moveTo(x + w, y)
            .lineTo(x + w, y + h)
            .stroke(getStroke(borderColors.right));
        graphics
            .beginPath()
            .moveTo(x + w, y + h)
            .lineTo(x, y + h)
            .stroke(getStroke(borderColors.bottom));
        graphics
            .beginPath()
            .moveTo(x, y + h)
            .lineTo(x, y)
            .stroke(getStroke(borderColors.left));
    }
}

export function clearArea(graphics) {
    graphics.clear();
}

export function destroyArea(graphics) {
    if (!graphics) return;
    areasContainer.removeChild(graphics);

    graphics.destroy({
        children: true,
        texture: true,
        baseTexture: true,
    });
}

export function createPoly() {
    let area = new PIXI.Graphics();
    area.position.set(0, 0);
    areasContainer.addChild(area);
    return area;
}

export function renderPoly(graphics, data) {
    graphics.clear();

    let rawPoints = data.points;
    if (!rawPoints || rawPoints.length === 0) return;

    const isSinglePolygon =
        rawPoints[0] &&
        (typeof rawPoints[0].getIn === "function" ||
            typeof rawPoints[0].x === "number" ||
            (Array.isArray(rawPoints[0]) &&
                typeof rawPoints[0][0] === "number"));

    let polygons = isSinglePolygon ? [rawPoints] : rawPoints;

    let alpha = data.alpha;
    let colorOut = data.colorOut;
    let colorIn = data.colorIn;
    let size = data.borderSize / zoom;
    let radius = data.radius !== undefined ? data.radius : 12;

    const getPos = (p) => {
        if (!p) return { x: 0, y: 0 };
        if (typeof p.getIn === "function") return p.getIn("normal");
        if (Array.isArray(p)) return { x: p[0], y: p[1] };
        return p;
    };

    const buildPolygonPath = (g, points) => {
        if (!points || points.length < 3) return;

        let p0 = getPos(points[0]);
        g.moveTo(p0.x, p0.y);

        for (let i = 0; i < points.length; i++) {
            let p1 = getPos(points[i]);
            let p2 = getPos(points[(i + 1) % points.length]);
            let midX = (p1.x + p2.x) / 2;
            let midY = (p1.y + p2.y) / 2;
            g.arcTo(p1.x, p1.y, midX, midY, Math.min(radius, 20));
        }
    };

    for (const poly of polygons) {
        buildPolygonPath(graphics, poly);
    }
    graphics.fill({ color: colorIn, alpha: alpha * 0.45 });

    for (const poly of polygons) {
        buildPolygonPath(graphics, poly);
    }
    graphics.stroke({
        width: size + 1,
        color: colorOut,
        alpha: alpha,
        cap: "round",
        join: "round",
    });
}

export function clearPoly(graphics) {
    graphics.clear();
}

export function destroyPoly(graphics) {
    if (!graphics) return;
    areasContainer.removeChild(graphics);

    graphics.destroy({
        children: true,
        texture: true,
        baseTexture: true,
    });
}

/////////////////// User pin

export function createSelfPin() {
    let userPin = PIXI.Sprite.from(pinImagePath);
    userPin.anchor.set(0.5, 1);
    userPin.scale.set(1 / 7.5);
    userPin.tint = 0x0033ee;

    let pinGfx = new PIXI.Container();
    pinGfx.addChild(userPin);

    let userAvatar = PIXI.Sprite.from(userImagePath);
    userAvatar.anchor.set(0.5);
    
    userAvatar.width = avatarSize;
    userAvatar.height = avatarSize;

    const radius = avatarSize / 2;
    let avatarMask = new PIXI.Graphics();
    avatarMask.beginFill(0xffffff);
    avatarMask.drawCircle(0, 0, radius);
    avatarMask.endFill();

    userAvatar.position.set(0, -23);
    avatarMask.position.set(0, -23);

    userAvatar.mask = avatarMask;
    pinGfx.addChild(userAvatar);
    pinGfx.addChild(avatarMask);

    pinContainer.addChild(pinGfx);

    return pinGfx;
}

export function renderSelfPin(graphics, data) {
    let visibility = data.visible;
    let online = data.online;
    let size = data.size;
    let pos = data.coordinate.getIn("normal");

    graphics.visible = visibility;
    
    let color;
    if (online) {
        color = 0x0033ee;
    } else {
        color = 0x454545;
    }
    graphics.children[0].tint = color;

    graphics.x = pos.x;
    graphics.y = pos.y;

    graphics.scale.set(size / zoom);
}

export function destroySelfPin(graphics) {
    pinContainer.removeChild(graphics);
    
    for (const child of graphics.children) {
        child.destroy({
            children: true,
            texture: true,
            baseTexture: true
        });
    }

    graphics.destroy({ children: true });
}

/////////////////// touch pin

export function createTouchPin() {
    let buildPino = PIXI.Sprite.from(pinImagePath);
    buildPino.anchor.set(0.5, 1);
    buildPino.scale.set(1 / 7.5);
    buildPino.tint = 0xff0000;
    
    let pinGfx = new PIXI.Container();
    
    pinGfx.addChild(buildPino);

    pinContainer.addChild(pinGfx);

    return pinGfx;
}

export function renderTouchPin(graphics, data) {
    let pos = data.coordinate.getIn("normal");
    let size = data.size;
    graphics.children[0].tint = data.color;
    graphics.visible = true;
    graphics.x = pos.x;
    graphics.y = pos.y;
    graphics.scale.set(size / zoom);
}

export function destroyTouchPin(graphics) {
    pinContainer.removeChild(graphics);
    
    for (const child of graphics.children) {
        child.destroy({
            children: true,
            texture: true,
            baseTexture: true
        });
    }

    graphics.destroy({ children: true });
}

/////////////////// Context

export function setContext(context) {
    page = context.page;
    color = context.blank_color;
    textColor = context.text_color;

    zoomStep = context.scroll_ratio;

    mapImagePath = mapImage;
    pinImagePath = pinImage;
    userImagePath = defaultUserImage;
    entranceImagePath = entranceImage;
}

export async function main() {
    app = new PIXI.Application();
    await app.init({
        resizeTo: window,
        antialias: true,
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

    minZoom =
        Math.max(app.screen.width, app.screen.height) /
        Math.max(imageSize.width, imageSize.height);
    maxZoom = 3;
    
    const pinoTexture = await PIXI.Assets.load(pinImagePath);
    pinoSprite = PIXI.Sprite.from(pinoTexture);
    pinoSprite.anchor.set(0.5, 1);
    pinoSprite.visible = false;
    pinoSprite.x = 0;
    pinoSprite.y = 0;
    pinoSprite.scale.set(1 / zoom / 7.5);
    mapContainer.addChild(pinoSprite);
    
    entranceTexture = await PIXI.Assets.load(entranceImagePath);
    userTexture = await PIXI.Assets.load(userImagePath);
    
    textContainer = new PIXI.Container();
    mapContainer.addChild(textContainer);

    areasContainer = new PIXI.Container();
    mapContainer.addChild(areasContainer);

    connectionContainer = new PIXI.Container();
    mapContainer.addChild(connectionContainer);

    referenceContainer = new PIXI.Container();
    mapContainer.addChild(referenceContainer);
    
    pinContainer = new PIXI.Container();
    mapContainer.addChild(pinContainer);
    temporaryPin = createPin("");
    clearPin(temporaryPin);

    groups = {
        AREAS: areasContainer,
        CONNECTIONS: connectionContainer,
        REFERENCES: referenceContainer,
        PINS: pinContainer,
    };
}

export function nodeText(text, configuration) {
    const nodeLabel = new PIXI.Text({
        text: text,
        style: {
            fontFamily: "Arial",
            fontSize: 28,
            fill: textColor,
            align: "center",
            dropShadow: true,
            dropShadowColor: "#fff",
            dropShadowAngle: Math.PI / 4,
            dropShadowDistance: 2,
            dropShadowBlur: 2,
        },
    });
    nodeLabel.anchor.set(0.5, 1);
    nodeLabel.x = configuration.x;
    nodeLabel.y = configuration.y;
    nodeLabel.scale.set(1 / zoom / 2);
    textContainer.addChild(nodeLabel);
}

function ceilPowerOf2(x) {
    return x <= 0 ? 1 : Math.pow(2, Math.ceil(Math.log2(x)));
}
function floorPowerOf2(x) {
    return x <= 0 ? 1 : Math.pow(2, Math.floor(Math.log2(x)));
}

export async function loadMapScales() {
    const svgText = await fetch(mapImagePath).then((r) => r.text());
    const mapBlob = new Blob([svgText], { type: "image/svg+xml" });
    const mapUrl = URL.createObjectURL(mapBlob);
    const img = new Image();

    mapTextures = {};

    img.onload = () => {
        for (const scale of [0.125, 0.25, 0.5, 1, 2, 4, 8]) {
            let key = `image-${scale}`;
            if (!localStorage.getItem(key)) {
                continue;
            }
            const longestSide = Math.max(img.width, img.height);
            const maxRenderZoom =
                gl.getParameter(gl.MAX_TEXTURE_SIZE) / longestSide;
            let currentFactor = Math.min(
                floorPowerOf2(maxRenderZoom),
                Math.max(minZoom, scale * window.devicePixelRatio),
            );
            const canvas = document.createElement("canvas");
            canvas.width = img.width * currentFactor;
            canvas.height = img.height * currentFactor;

            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            localStorage.setItem(key, PIXI.Texture.from(canvas));
        }
    };

    img.src = mapUrl;
}

async function updateMapTexture() {
    const longestSide = Math.max(imageSize.width, imageSize.height);
    const maxRenderZoom = gl.getParameter(gl.MAX_TEXTURE_SIZE) / longestSide;
    let currentFactor = Math.min(
        ceilPowerOf2(maxRenderZoom),
        Math.max(minZoom, zoom * window.devicePixelRatio),
    );

    let scale = ceilPowerOf2(currentFactor);
    mapSprite.texture =
        localStorage.getItem(`image-${scale}`) || mapSprite.texture;
    mapSprite.scale.set(imageSize.width / mapSprite.texture.width);
}

export async function updateMap() {
    if (updating) return;
    updating = true;
    await updateMapTexture();
    updating = false;
}

function clampPos() {
    mapContainer.x = Math.max(
        (-imageSize.width / 2) * zoom + (3 * app.screen.width) / 4,
        Math.min(
            (imageSize.width / 2) * zoom + app.screen.width / 4,
            mapContainer.x,
        ),
    );
    mapContainer.y = Math.max(
        (-imageSize.height / 2) * zoom + (3 * app.screen.height) / 4,
        Math.min(
            (imageSize.height / 2) * zoom + app.screen.height / 4,
            mapContainer.y,
        ),
    );
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
    for (const child of pinContainer.children) {
        child.scale.set(1 / zoom);
    }
    for (const child of textContainer.children) {
        child.scale.set(1 / zoom / 2);
    }

    let references = Editor.Referencer.references;
    for (const ref of Object.values(references)) {
        ref.updateGraphics();
    }

    let areas = Editor.Buildings.areas;
    for (const area of Object.values(areas)) {
        area.updateGraphics();
    }

    let buildings = Editor.Buildings.buildings;
    for (const building of Object.values(buildings)) {
        building.updateGraphics();
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
export function highlight(activeGroups) {
    if (activeGroups === true) {
        for (const group of Object.values(groups)) {
            group.alpha = 1;
        }
        return;
    }
    for (const group of Object.values(groups)) {
        group.alpha = 0.25;
    }
    for (const group of activeGroups) {
        group.alpha = 1;
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

        let containerPos = { x: mapContainer.x, y: mapContainer.y };

        const transform = setInterval(() => {
            time += 1000 / 60;
            let t = Math.min(time / 500, 1);
            let interpolation = t * t * (3 - 2 * t);

            Rotation(
                initialRotation +
                    (shortestTargetRotation - initialRotation) * interpolation,
            );
            let center = {
                x: window.visualViewport.width / 2,
                y: window.visualViewport.height / 2,
            };
            let pivo = Transformacao.rotatePoint(
                containerPos.x - center.x,
                containerPos.y - center.y,
                mapContainer.rotation - initialRotation,
            );
            pivo = { x: pivo.x + center.x, y: pivo.y + center.y };
            Position(pivo.x, pivo.y);
            if (time >= 500) {
                smoothTransform = false;
                clearInterval(transform);

                mapContainer.rotation =
                    ((mapContainer.rotation + Math.PI) % (2 * Math.PI)) -
                    Math.PI;
            }
        }, 1000 / 60);
    }
}

export function animateTransform(
    targetX,
    targetY,
    targetScaleX,
    targetScaleY,
    targetRotation,
    duration = 500,
) {
    if (smoothTransform) return;
    smoothTransform = true;

    // 1. Capture initial transform states
    const initialX = mapContainer.x;
    const initialY = mapContainer.y;
    const initialScaleX = mapContainer.scale?.x ?? mapContainer.scaleX ?? 1;
    const initialScaleY = mapContainer.scale?.y ?? mapContainer.scaleY ?? 1;
    const initialRotation = mapContainer.rotation ?? 0;

    // 2. Fall back to current values if target parameters are omitted, null, or undefined
    const finalX = targetX ?? initialX;
    const finalY = targetY ?? initialY;
    const finalScaleX = targetScaleX ?? initialScaleX;
    const finalScaleY = targetScaleY ?? initialScaleY;
    const finalRotation = targetRotation ?? initialRotation;

    // 3. Shortest rotation path using finalRotation
    let diff = finalRotation - initialRotation;
    diff = ((diff + Math.PI) % (2 * Math.PI)) - Math.PI;
    if (diff < -Math.PI) diff += 2 * Math.PI;
    const shortestTargetRotation = initialRotation + diff;

    let time = 0;
    const frameRate = 1000 / 60;

    const transformTimer = setInterval(() => {
        time += frameRate;
        const t = Math.min(time / duration, 1);

        const interpolation = t * t * (3 - 2 * t);

        // 4. Interpolate toward target (or remain constant if defaulted)
        const currentX = initialX + (finalX - initialX) * interpolation;
        const currentY = initialY + (finalY - initialY) * interpolation;
        const currentScaleX =
            initialScaleX + (finalScaleX - initialScaleX) * interpolation;
        const currentScaleY =
            initialScaleY + (finalScaleY - initialScaleY) * interpolation;
        const currentRotation =
            initialRotation +
            (shortestTargetRotation - initialRotation) * interpolation;

        Position(currentX, currentY);
        Rotation(currentRotation);

        if (typeof zoom === "function") {
            zoom(currentScaleX, currentScaleY);
        } else if (typeof Scale === "function") {
            Scale(currentScaleX, currentScaleY);
        } else if (mapContainer.scale) {
            mapContainer.scale.x = currentScaleX;
            mapContainer.scale.y = currentScaleY;
        } else {
            mapContainer.scaleX = currentScaleX;
            mapContainer.scaleY = currentScaleY;
        }

        if (time >= duration) {
            smoothTransform = false;
            clearInterval(transformTimer);

            mapContainer.rotation =
                ((mapContainer.rotation + Math.PI) % (2 * Math.PI)) - Math.PI;
        }
    }, frameRate);
}
