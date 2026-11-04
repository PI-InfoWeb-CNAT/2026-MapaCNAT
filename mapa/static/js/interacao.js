import * as Transformacao from "./transformacao.js";
import * as Graficos from "./graficos.js";
import * as Editor from "./editor.js";

let mapObj;
let buildBtn;
let referenceBtn;
let connectionBtn;
let saveBtn;
let bannerBtn;
let pinBtn;
let pinDone = false;
let mapInterface;

let bannerTab;
let imageInput;
let imageWrapper;
let imageLabel;
let bannerTitle;
let bannerDescription;
let pinMap;
let constructionMap;
let previousTitle;
let moved;

let selectionBtn;
let deleteBtn;

let page;

let minZoom, maxZoom;
let zoomStep;
let zoom = Graficos.zoom;

let clicking = false;
let touching = false;

let mapStartX, mapStartY;
let clickX, clickY;
let touchX, touchY;
let startMidX, startMidY;
let startDistance, startAngle;
let startZoom, startRotation;
let startOffsetX, startOffsetY;

let hoverSet = new Set();
let hoverTargetSet = new Set();
let hoverLoop;

const EditorModes = Object.freeze({
    FREE: 'FREE',
    SELECTION: 'SELECTION',
    DELETION: 'DELETION',
    CONSTRUCTION: 'CONSTRUCTION',
    REFERENCE: 'REFERENCE',
    CONNECTION: 'CONNECTION',
    BANNER: 'BANNER'
});

let editorMode = EditorModes.FREE;

export function setContext(context) {
    page = context.page;
    minZoom = Graficos.minZoom;
    maxZoom = Graficos.maxZoom;
    zoomStep = context.scroll_ratio;
}

class Detail {
    constructor() {
        throw new Error("Classe estática. Não instancie.");
    }
    static detail = null;
    static set(detail) {
        if (this.detail) {
            this.detail.convertTo("polygon");
        }
        
        this.detail = detail;
        
        if (this.detail) {
            this.detail.convertTo("areas");
        }
    }

}

class Holdable {
    constructor() {
        throw new Error("Classe estática. Não instancie.");
    }
    static object = null;
    static type = "";
    static initialPos = null;
    static phantomObject = null;

    static set(object, type = "", initialPos = false, phantomObject = false) {
        if (this.phantomObject) {
            this.phantomObject.destroy();
        }
        
        this.object = object;
        this.type = type;
        this.initialPos = initialPos;
        this.phantomObject = phantomObject;
    }
}

class Task {
    constructor() { throw new Error("Classe estática. Não instancie."); }
    static task = "";
    static taskStep = 0;
    static data = {};

    static snapshot() {
        return { task: this.task, taskStep: this.taskStep, data: { ...this.data } };
    }
    static restore(snap) {
        this.task = snap.task;
        this.taskStep = snap.taskStep;
        this.data = { ...snap.data };
        Actions.syncTaskUI();
    }
    static setTask(name, data) {
        this.task = name; this.taskStep = 0; this.data = data;
        Actions.syncTaskUI();
    }
    static reset() {
        this.task = ""; this.taskStep = 0; this.data = {};
        Actions.syncTaskUI();
    }
    static nextStep() {
        this.taskStep += 1;
        Actions.syncTaskUI();
    }
}

const hasEnabledAreas = (b) => !!b && b.areas.some(a => a.enabled);

class Touch {
    constructor() {
        throw new Error("Classe estática. Não instancie.");
    }

    static begin(e) {
        touching = true;
        if (e.touches.length == 1) {
            const touch = e.touches[0];
            touchX = touch.clientX;
            touchY = touch.clientY;
            mapStartX = Graficos.mapContainer.x;
            mapStartY = Graficos.mapContainer.y;
        }
        if (e.touches.length == 2) {
            const a = e.touches[0];
            const b = e.touches[1];
            const mid = Transformacao.midpoint(a, b);
            startMidX = mid.x;
            startMidY = mid.y;
            startDistance = Transformacao.distance(a, b);
            startAngle = Transformacao.angle(a, b);
            startZoom = zoom;
            startRotation = Graficos.mapContainer.rotation;
            startOffsetX = (Graficos.mapContainer.x - startMidX) / zoom;
            startOffsetY = (Graficos.mapContainer.y - startMidY) / zoom;
        }
    }

    static step(e) {
        if (!touching) return;
        if (e.touches.length == 1) {
            let touch = e.touches[0];
            Graficos.setPosition(
                mapStartX + (touch.clientX - touchX),
                mapStartY + (touch.clientY - touchY)
            );
        }
        if (e.touches.length == 2) {
            const a = e.touches[0];
            const b = e.touches[1];
            const mid = Transformacao.midpoint(a, b);
            const currentDistance = Transformacao.distance(a, b);
            const currentAngle = Transformacao.angle(a, b);

            zoom = Math.min(Math.max(startZoom * (currentDistance / startDistance), minZoom), maxZoom);
            Graficos.setZoom(zoom);
            Graficos.updateMap();

            const deltaAngle = currentAngle - startAngle;
            Graficos.setRotation((startRotation + deltaAngle) % (2 * Math.PI));
            
            const rotated = Transformacao.rotatePoint(startOffsetX, startOffsetY, deltaAngle);
            Graficos.setPosition(
                mid.x + rotated.x * zoom,
                mid.y + rotated.y * zoom
            );
        }
    }

    static end(e) {
        touching = false;
    }
}

function isInside(event, target) {
    const element = typeof target === 'string' ? document.querySelector(target) : target;
    
    if (!element) return false;

    const rect = element.getBoundingClientRect();
    
    return event.clientX >= rect.left && 
           event.clientX <= rect.right && 
           event.clientY >= rect.top && 
           event.clientY <= rect.bottom;
}

class Pointer {
    constructor() {
        throw new Error("Classe estática. Não instancie.");
    }

    static down(e) {
        clickX = e.clientX;
        clickY = e.clientY;
        mapStartX = Graficos.mapContainer.x;
        mapStartY = Graficos.mapContainer.y;
        clicking = true;
        moved = false;
        
        if (page == "main") {
            return;
        } else if (page == "editor") {
            if (editorMode == EditorModes.REFERENCE) {
                let coord = Editor.newCoord(clickX, clickY, "screen");
                let overlap = Editor.Referencer.getOverlappingDots(coord, false);
                Holdable.set(false);
                if (overlap) {
                    Holdable.set(overlap, "reference", { ...overlap.coordinate.pos });
                } else {
                    Actions.newReference(clickX, clickY);
                }
            } else if (editorMode == EditorModes.DELETION) {
                let coord = Editor.newCoord(clickX, clickY, "screen");
                let overlapDots = Editor.Referencer.getOverlappingDots(coord, false);
                let overlapLines = Editor.Connections.getOverlappingLines(coord, false);
                let overlapAreas = Editor.Buildings.getOverlappingAreas(coord, false);
                if (overlapDots) {
                    Actions.destroyReference(overlapDots);
                } else if (overlapLines) {
                    Actions.destroyConnection(overlapLines);
                } else if (overlapAreas) {
                    Actions.destroyArea(overlapAreas);
                }
            } else if (editorMode == EditorModes.CONNECTION) {
                let coord = Editor.newCoord(clickX, clickY, "screen");
                let overlap = Editor.Referencer.getOverlappingDots(coord, false);
                
                if (overlap) {
                    let phantomObject = new Editor.PhantomConnection(overlap);
                    Holdable.set(overlap, "connectionReference", false, phantomObject=phantomObject);
                }
            } else if (editorMode == EditorModes.CONSTRUCTION) {
                if (Task.task == "build") {
                    if (Task.taskStep == 0 && isInside(e, mapObj)) {
                        const overlay = document.getElementById('build-modal-overlay');
                        overlay.classList.add('active');
                    } else if (Task.taskStep == 1) {
                        let coord = Editor.newCoord(clickX, clickY, "screen");
                        let border = Editor.Buildings.getOverlappingAreaBorders(coord);
                        if(border) {
                            Holdable.set(border, "BuildAreaBorder", {start: border.area.start.getIn("normal"), end: border.area.end.getIn("normal")});
                            Editor.Referencer.beginReport();
                        } else {
                            let phantomObject = new Editor.PhantomArea(clickX, clickY);
                            Holdable.set(true, "BuildArea", {x: clickX, y: clickY}, phantomObject=phantomObject);
                        }
                    }
                } else {
                    let coord = Editor.newCoord(clickX, clickY, "screen");
                    let border = Editor.Buildings.getOverlappingAreaBorders(coord);
                    if(border) {
                        Holdable.set(border, "BuildAreaBorder", {start: border.area.start.getIn("normal"), end: border.area.end.getIn("normal")});
                        Editor.Referencer.beginReport();
                    }
                }
            } else if (editorMode == EditorModes.BANNER) {
                let coord = Editor.newCoord(e.clientX, e.clientY, "screen");
                let overlapDots = Editor.Referencer.getOverlappingDots(coord);
                let overlapPins = Editor.Buildings.getOverlappingPins(coord);
                if (overlapDots) {
                    Actions.openBanner(overlapDots);
                } else if (overlapPins) {
                    Actions.openBanner(overlapPins);   
                } else {
                    Actions.closeBanner();
                }
            }
        }
    }

    static defaultMove(e) {
        Graficos.setPosition(
            mapStartX + (e.clientX - clickX),
            mapStartY + (e.clientY - clickY)
        );
    }

    static move(e) {
        moved = true;
        hoverTargetSet = new Set();
        if (page == "main") {
            if (clicking) {
                Pointer.defaultMove(e);
            } else {
                if (!pinMap) return;
                let colPin = Editor.Builder.getCollisionPin(pinMap, e.clientX, e.clientY);
                let colConstruction = Editor.Builder.getCollisionMapArea(e.clientX, e.clientY, constructionMap);
                let resultPin = colPin || pinMap[colConstruction.text];

                Graficos.map.style.cursor = 'default';
                if (resultPin) {
                    if (resultPin != previousTitle && previousTitle) {
                        let gfxObj = {"pin": previousTitle.gfx, "label": previousTitle.label};
                        Graficos.updatePin(gfxObj, previousTitle.x, previousTitle.y, previousTitle.text, false);
                        previousTitle.gfx = gfxObj.pin;
                        previousTitle.label = gfxObj.label;
                    }
                    let gfxObj = {"pin": resultPin.gfx, "label": resultPin.label};
                    Graficos.updatePin(gfxObj, resultPin.x, resultPin.y, resultPin.text, true);
                    resultPin.gfx = gfxObj.pin;
                    resultPin.label = gfxObj.label;
                    Graficos.map.style.cursor = 'pointer';
                    
                    previousTitle = resultPin;
                } else if (previousTitle) {
                    let gfxObj = {"pin": previousTitle.gfx, "label": previousTitle.label};
                    Graficos.updatePin(gfxObj, previousTitle.x, previousTitle.y, previousTitle.text, false);
                    previousTitle.gfx = gfxObj.pin;
                    previousTitle.label = gfxObj.label;
                }
            }
            
        } else if (page == "editor") {
            if (editorMode == EditorModes.FREE) {
                if (!clicking) return;
                Pointer.defaultMove(e);
                
            } else if (editorMode == EditorModes.REFERENCE) {
                if (Holdable.object) {
                    let coord = Editor.newCoord(e.clientX, e.clientY, "screen");
                    
                    Holdable.object.move(coord);
                } else {
                    let coord = Editor.newCoord(e.clientX, e.clientY, "screen");
                    let overlap = Editor.Referencer.getOverlappingDots(coord);
                    if (overlap) {
                        hoverTargetSet.add(overlap);
                    }
                }
            } else if (editorMode == EditorModes.CONNECTION) {
                let coord = Editor.newCoord(e.clientX, e.clientY, "screen");
                if (Holdable.type == "connectionReference") {
                    Holdable.phantomObject.setEndPoint(coord);

                    let overlap = Editor.Referencer.getOverlappingDots(coord);
                    if (overlap) {
                        if (overlap != Holdable.phantomObject.start && !Editor.Connections.hasPair(overlap, Holdable.phantomObject.start)) {
                            Actions.newConnection(Holdable.phantomObject.start, overlap);
    
                            let phantomObject = new Editor.PhantomConnection(overlap);
                            Holdable.set(overlap, "connectionReference", false, phantomObject=phantomObject);
                        }
                    }

                } else {
                    let overlap = Editor.Referencer.getOverlappingDots(coord);
                    if (overlap) {
                        hoverTargetSet.add(overlap);
                    } else {
                        if (!clicking) return;
                        Pointer.defaultMove(e);
                    }
                }
            } else if (editorMode == EditorModes.DELETION) {
                let coord = Editor.newCoord(e.clientX, e.clientY, "screen");
                let overlapDots = Editor.Referencer.getOverlappingDots(coord);
                let overlapLines = Editor.Connections.getOverlappingLines(coord);
                let overlapAreas = Editor.Buildings.getOverlappingAreas(coord);
                let area = Editor.Buildings.getOverlappingAreas(coord);
                Detail.set(false);
                if (area) {
                    Detail.set(area.building);
                }
                if (overlapDots) {
                    hoverTargetSet.add(overlapDots);
                } else if (overlapLines) {
                    hoverTargetSet.add(overlapLines);
                } else if (overlapAreas) {
                    hoverTargetSet.add(overlapAreas);
                } else {
                    if (!clicking) return;
                    Pointer.defaultMove(e);
                }
            } else if (editorMode == EditorModes.CONSTRUCTION) {
                if (Task.task == "build") {
                    if (Holdable.type == "BuildAreaBorder") {
                        let screenStart = Holdable.object.area.start.getIn("screen");
                        let screenEnd = Holdable.object.area.end.getIn("screen");
                        if (Holdable.object.side == "top") {
                            screenStart = {x: screenStart.x, y: Math.min(e.clientY, screenEnd.y - 20)};
                        } else if (Holdable.object.side == "left") {
                            screenStart = {x: Math.min(e.clientX, screenEnd.x - 20), y: screenStart.y};
                        } else if (Holdable.object.side == "right") {
                            screenEnd = {x: Math.max(e.clientX, screenStart.x + 20), y: screenEnd.y};
                        } else {
                            screenEnd = {x: screenEnd.x, y: Math.max(e.clientY, screenStart.y + 20)};
                        }
                        screenStart = Editor.newCoord(screenStart.x, screenStart.y, "screen");
                        screenEnd = Editor.newCoord(screenEnd.x, screenEnd.y, "screen");
                        screenStart.convertTo("normal");
                        screenEnd.convertTo("normal");
                        Holdable.object.area.move(screenStart, screenEnd);
                    }
                    if (Holdable.type == "BuildArea") {
                        let coord = Editor.newCoord(e.clientX, e.clientY, "screen");
                        Holdable.phantomObject.setEndPoint(coord);
                    }
                    if (Task.taskStep == 1) {
                        let coord = Editor.newCoord(e.clientX, e.clientY, "screen");
                        let border = Editor.Buildings.getOverlappingAreaBorders(coord);
                        if(border) {
                            hoverTargetSet.add(border.area.sides[border.side]);
                        }
                    }
                } else {
                    let coord = Editor.newCoord(e.clientX, e.clientY, "screen");
                    let area = Editor.Buildings.getOverlappingAreas(coord);
                    let border = Editor.Buildings.getOverlappingAreaBorders(coord);
                    Detail.set(false);
                    if (area) {
                        Detail.set(area.building);
                    }
                    if (border) {
                        hoverTargetSet.add(border.area.sides[border.side]);
                    }

                    if (Holdable.type == "BuildAreaBorder") {
                        let area = Holdable.object.area;
                        Detail.set(area.building);
                        let screenStart = area.start.getIn("screen");
                        let screenEnd = area.end.getIn("screen");
                        if (Holdable.object.side == "top") {
                            screenStart = {x: screenStart.x, y: Math.min(e.clientY, screenEnd.y - 20)};
                        } else if (Holdable.object.side == "left") {
                            screenStart = {x: Math.min(e.clientX, screenEnd.x - 20), y: screenStart.y};
                        } else if (Holdable.object.side == "right") {
                            screenEnd = {x: Math.max(e.clientX, screenStart.x + 20), y: screenEnd.y};
                        } else {
                            screenEnd = {x: screenEnd.x, y: Math.max(e.clientY, screenStart.y + 20)};
                        }
                        screenStart = Editor.newCoord(screenStart.x, screenStart.y, "screen");
                        screenEnd = Editor.newCoord(screenEnd.x, screenEnd.y, "screen");
                        screenStart.convertTo("normal");
                        screenEnd.convertTo("normal");
                        area.move(screenStart, screenEnd);
                    } else {
                        if (!clicking) return;
                        Pointer.defaultMove(e);
                    }
                }
            } else if (editorMode == EditorModes.BANNER) {
                let coord = Editor.newCoord(e.clientX, e.clientY, "screen");
                let overlapDots = Editor.Referencer.getOverlappingDots(coord);
                let overlapPins = Editor.Buildings.getOverlappingPins(coord);
                if (overlapDots) {
                    hoverTargetSet.add(overlapDots);
                } else if (overlapPins) {
                    hoverTargetSet.add(overlapPins);
                } else {
                    if (!clicking) return;
                    Pointer.defaultMove(e);
                }
            } else {
                if (!clicking) return;
                Pointer.defaultMove(e);
            }
        }
    }

    static up(e) {
        clicking = false;
        if (page == "main") {
            if (moved) {
                return;
            }
        } else if (page == "editor") {
            if (editorMode == EditorModes.REFERENCE) {
                if (Holdable.object) {
                    Actions.moveReference(Holdable);
                }
                Holdable.set(false);
            } else if (editorMode == EditorModes.CONNECTION) {
                if (Holdable.object && Holdable.type == "connectionReference") {
                    Holdable.phantomObject.destroy();
                    Holdable.set(false);
                }
            } else if (editorMode == EditorModes.CONSTRUCTION) {
                if (Task.task == "build") {
                    if (Holdable.object) {
                        if (Holdable.type == "BuildArea") {
                            let phantom = Holdable.phantomObject;
                            if(phantom.end && Math.abs(phantom.end.pos.x - phantom.start.pos.x) >= 20 && Math.abs(phantom.end.pos.y - phantom.start.pos.y) >= 20) {
                                
                                Actions.newArea(phantom.start, phantom.end);
                            }
                            phantom.destroy();
                            Holdable.set(false);
                        } else if (Holdable.type == "BuildAreaBorder") {
                            Actions.moveAreaBorder(Holdable);
                            Holdable.set(false);
                        }
                    }
                } else {
                    if (Holdable.type == "BuildAreaBorder") {
                        Detail.set(false);
                        Actions.moveAreaBorder(Holdable);
                        Holdable.set(false);
                    }
                }
            }
        }
    }

    static wheel(e) {
        e.preventDefault();

        const mX = e.offsetX;
        const mY = e.offsetY;

        let zoomFactor = e.deltaY < 0 ? zoomStep : 1 / zoomStep;
        const nextZoom = Math.min(Math.max(zoom * zoomFactor, minZoom), maxZoom);
        zoomFactor = nextZoom / zoom;

        Graficos.setPosition(
            mX - (mX - Graficos.mapContainer.x) * zoomFactor,
            mY - (mY - Graficos.mapContainer.y) * zoomFactor
        );
        
        zoom = nextZoom;
        Graficos.setZoom(zoom);
        if (Holdable.phantomObject) {
            Holdable.phantomObject.updateGraphics();
        }
        Graficos.updateMap();
    }
}

function activateList(list) {
    for (const tag of list) {
        tag.classList.add('active');
    };
}
function deactivateList(list) {
    for (const tag of list) {
        tag.classList.remove('active');
    };
}

function lightButton(button, mode, buttonMode) {
    button.classList.remove('mode-active');
    if (mode == buttonMode) {
        button.classList.add('mode-active');
    }
}

export function WaitButtonClick(buttonElements) {
    return new Promise((resolve) => {
        const elements = buttonElements.map(el => 
            typeof el === 'string' ? document.querySelector(el) : el
        );

        if (elements.some(el => !el)) {
            console.error("One or more button elements were not found!");
            return;
        }

        const cleanup = () => {
            elements.forEach((btn, idx) => {
                btn.removeEventListener('click', handlers[idx]);
            });
        };

        const handlers = elements.map((btn, index) => {
            return (event) => {
                cleanup();
                resolve({
                    index: index,
                    button: btn,
                    event: event,
                    id: btn.id || btn.className || `btn_${index}`
                });
            };
        });

        elements.forEach((btn, idx) => {
            btn.addEventListener('click', handlers[idx]);
        });
    });
}

class Actions {
    static actionStack = [];
    static actionStackReferencial = {};
    static actionStackTraversal = 0;
    static actionStackLimit = 64;

    static prune(startIndex, deleteCount = 1, pruneOut = true) {
        const total = this.actionStack.length;
        if (total === 0) return [];

        if (startIndex < 0) {
            startIndex = Math.max(0, total + startIndex);
        }

        startIndex = Math.max(0, Math.min(startIndex, total));
        deleteCount = Math.max(0, Math.min(deleteCount, total - startIndex));

        if (deleteCount === 0) return [];

        const currIndex = total - this.actionStackTraversal;

        const undoneStart = Math.max(startIndex, currIndex);
        const undoneEnd = Math.min(startIndex + deleteCount, total);
        const undoneRemoved = Math.max(0, undoneEnd - undoneStart);

        const prunedActions = this.actionStack.splice(startIndex, deleteCount);

        this.actionStackTraversal -= undoneRemoved;

        if (pruneOut) {
            for (const action of prunedActions) {
                if (action && typeof action.prune === "function") {
                    action.prune();
                }
            }
        }

        return prunedActions;
    }

    static undo() {
        if (this.actionStackTraversal >= this.actionStack.length) {
            return;
        }

        const targetIndex = this.actionStack.length - 1 - this.actionStackTraversal;
        const action = this.actionStack[targetIndex];

        if (action && typeof action.backward === "function") {
            action.backward();
        }

        this.actionStackTraversal++;
    }

    static redo() {
        if (this.actionStackTraversal <= 0) {
        return;
        }

        this.actionStackTraversal--;

        const targetIndex = this.actionStack.length - 1 - this.actionStackTraversal;
        const action = this.actionStack[targetIndex];

        if (action && typeof action.forward === "function") {
            action.forward();
        }
    }

    static newAction(forward, backward, prune = () => {}, overflow = () => {}) {
    
        if (this.actionStackTraversal > 0) {
            const prunedActions = this.actionStack.splice(
                this.actionStack.length - this.actionStackTraversal
            );

            for (const action of prunedActions) {
                if (typeof action.prune === "function") {
                    action.prune();
                }
            }

            this.actionStackTraversal = 0;
        }

        this.actionStack.push({ forward, backward, prune, overflow });

        if (this.actionStack.length > this.actionStackLimit) {
            const droppedAction = this.actionStack.shift();
            if (droppedAction && typeof droppedAction.overflow === "function") {
                droppedAction.overflow();
            }
        }
    }

    static findActionIndex(target, compareBySource = false) {
        if (!Array.isArray(this.actionStack) || target == null) return -1;

        return this.actionStack.findIndex(item => {
            if (item === target) return true;

            if (Array.isArray(item) && Array.isArray(target)) {
                if (item.length !== target.length) return false;
                return item.every((fn, i) => this.matchFunctions(fn, target[i], compareBySource));
            }

            if (typeof item === "object" && typeof target === "object" && item !== null && target !== null) {
                const targetKeys = Object.keys(target);
                if (targetKeys.length === 0) return false;
                return targetKeys.every(key => this.matchFunctions(item[key], target[key], compareBySource));
            }

            if (typeof target === "function") {
                const values = Array.isArray(item) ? item : Object.values(item);
                return values.some(fn => this.matchFunctions(fn, target, compareBySource));
            }

            return false;
        });
    }

    static matchFunctions(a, b, compareBySource = false) {
        if (a === b) return true;
        if (compareBySource && typeof a === "function" && typeof b === "function") {
            return a.toString() === b.toString();
        }
        return false;
    }

    static newReference(mouseX, mouseY) {
        const coord = Editor.newCoord(mouseX, mouseY, "screen");
        let reference = new Editor.Reference(coord);

        const forward = () => {
            Actions.forceMode(EditorModes.REFERENCE);
            reference.enable();
        };
        
        const backward = () => {
            Actions.forceMode(EditorModes.REFERENCE);
            reference.disable();
        };

        const prune = () => {
            if (reference) {
                reference.destroy();
                reference = null;
            }
        }

        reference.enable();

        this.newAction(forward, backward, prune);
    }

    static destroyReference(reference) {
        let goneConnections = [...reference.connections].filter(item => item.enabled);
        
        const forward = () => {
            Actions.forceMode(EditorModes.DELETION);

            reference.disable();
            for (const connection of goneConnections) {
                connection.disable();
            }
        };
        
        const backward = () => {
            Actions.forceMode(EditorModes.DELETION);
            
            reference.enable();
            for (const connection of goneConnections) {
                connection.enable();
            }
        };
        
        const overflow = () => {
            if (reference) {
                reference.destroy();
                reference = null;
            }
        }
        
        reference.disable();
        for (const connection of goneConnections) {
            connection.disable();
        }

        this.newAction(forward, backward, undefined, overflow);

        return reference;
    }

    static moveReference(heldObject) {
        let object = heldObject.object;

        let forwardCoord = {x: object.coordinate.pos.x, y: object.coordinate.pos.y};
        let backwardCoord = {x: heldObject.initialPos.x, y: heldObject.initialPos.y};

        const forward = () => {
            Actions.forceMode(EditorModes.REFERENCE);

            const coord = Editor.newCoord(forwardCoord.x, forwardCoord.y, "normal");
            object.move(coord);
        };
        
        const backward = () => {
            Actions.forceMode(EditorModes.REFERENCE);

            const coord = Editor.newCoord(backwardCoord.x, backwardCoord.y, "normal");
            object.move(coord);
        };

        this.newAction(forward, backward);
    }


    static newConnection(start, end) {
        let connection = new Editor.Connection(start, end);

        const forward = () => {
            Actions.forceMode(EditorModes.CONNECTION);
            connection.enable();
        };
        
        const backward = () => {
            Actions.forceMode(EditorModes.CONNECTION);
            connection.disable();
        };

        const prune = () => {
            if (connection) {
                connection.destroy();
                connection = null;
            }
        }

        connection.enable();

        this.newAction(forward, backward, prune);
    }

    static destroyConnection(connection) {
        const forward = () => {
            Actions.forceMode(EditorModes.DELETION);
            connection.disable();
        };
        
        const backward = () => {
            Actions.forceMode(EditorModes.DELETION);
            connection.enable();
        };

        const overflow = () => {
            if (connection) {
                connection.destroy();
                connection = null;
            }
        }

        connection.disable();

        this.newAction(forward, backward, undefined, overflow);

        return connection;
    }

    static applyMode(mode) {
        Detail.set();
        editorMode = mode;
        Graficos.editorFocus([
            EditorModes.DELETION, EditorModes.CONSTRUCTION,
            EditorModes.REFERENCE, EditorModes.CONNECTION, EditorModes.BANNER
        ].includes(mode));

        if (mode == EditorModes.BANNER) {
            Graficos.highlight([Graficos.groups.PINS, Graficos.groups.REFERENCES]);
        } else {
            Graficos.highlight(true);
        }

        this.closeBanner();

        lightButton(selectionBtn, mode, EditorModes.SELECTION);
        lightButton(deleteBtn, mode, EditorModes.DELETION);
        lightButton(buildBtn, mode, EditorModes.CONSTRUCTION);
        lightButton(referenceBtn, mode, EditorModes.REFERENCE);
        lightButton(connectionBtn, mode, EditorModes.CONNECTION);
        lightButton(bannerBtn, mode, EditorModes.BANNER);
        this.syncTaskUI();
    }

    static forceMode(mode = EditorModes.FREE) {
        if (mode != editorMode) Task.reset();   // the action restores its own snapshot right after
        this.applyMode(mode);
    }


    static resetTask() {
        if (Task.task == "build" && Task.taskStep == 1) {
            const building = Task.data["buildObject"];
            if (building && !hasEnabledAreas(building)) {
                const idx = this.findActionIndex(building._helperCreate);
                if (idx >= 0) this.prune(idx, 1);
            }
        }
        Task.reset();
    }

    static switching = false;

    static async switchMode(mode = EditorModes.FREE) {
        if (this.switching) return;
        if (editorMode == EditorModes.CONSTRUCTION) {
            const building = Task.data["buildObject"];
            if (Task.task == "build" && Task.taskStep == 1 && !hasEnabledAreas(building)) {
                this.switching = true;
                const result = await confirmationCall();
                this.switching = false;
                document.getElementById('confirm-modal-overlay').classList.remove('active');
                if (result.index == 0 || result.index == 1) return;
            }
            this.resetTask();
        }
        if (editorMode == mode) mode = EditorModes.FREE;
        this.applyMode(mode);
    }

    static finishTask() {
        const before = Task.snapshot();

        let building = Task.data["buildObject"];

        building.convertTo("polygon");
        
        Task.reset();
        const after = Task.snapshot();

        this.newAction(
            () => {
                Actions.forceMode(EditorModes.CONSTRUCTION);
                
                building.convertTo("polygon");
                
                Task.restore(after);
            },
            () => {
                Actions.forceMode(EditorModes.CONSTRUCTION);
                
                Task.restore(before);
                
                building.convertTo("areas");
            }
        );
    }

    static snapshotMotion() {
        let snapshot = Object.values(Editor.Referencer.motionReport).map(([dot, b]) => ({
            dot,
            before: { x: b.x, y: b.y },
            after:  { x: dot.coordinate.pos.x, y: dot.coordinate.pos.y }
        }));
        return snapshot;
    }

    static newBuilding(mouseX, mouseY) {
        const coord = Editor.newCoord(mouseX, mouseY, "screen");
        let building = new Editor.Building(coord, Task.data["name"]);

        const before = Task.snapshot();
        building.enable();
        Task.data["buildObject"] = building;
        Task.nextStep();
        const after = Task.snapshot();

        const forward = () => { Actions.forceMode(EditorModes.CONSTRUCTION); building.enable();  Task.restore(after); };
        const backward = () => { Actions.forceMode(EditorModes.CONSTRUCTION); building.disable(); Task.restore(before); };
        const prune = () => { if (building) { building.destroy(); building = null; } };

        this.newAction(forward, backward, prune);
        building._helperCreate = this.actionStack[this.actionStack.length - 1];
        building._createBefore = before;
        return building;
    }

    static newArea(start, end) {
        let parent = Task.data["buildObject"];
        const isFirst = !hasEnabledAreas(parent);

        let before = Task.snapshot();
        let parentForwards = () => {}, parentBackwards = () => {}, parentPrune = () => {};

        if (isFirst) {
            const idx = this.findActionIndex(parent._helperCreate);
            if (idx >= 0) {
                this.prune(idx, 1, false);
                before = parent._createBefore;
                parentForwards  = () => parent.enable();
                parentBackwards = () => parent.disable();
                parentPrune     = () => { if (parent) { parent.destroy(); parent = null; } };
            }
        }

        Editor.Referencer.beginReport();
        let area = new Editor.Area(start, end, parent);

        let motionReport = this.snapshotMotion();
        Editor.Referencer.endReport();
        area.enable();
        this.syncTaskUI();
        const after = Task.snapshot();

        const forward = () => {
            Actions.forceMode(EditorModes.CONSTRUCTION);
            area.enable();
            area.building.buildPolygon();

            for (const { dot, after } of motionReport) {
                dot.move(Editor.newCoord(after.x, after.y, "normal"));
            }

            parentForwards();
            Task.restore(after);                       // restore last: it counts enabled areas
        };
        const backward = () => {
            Actions.forceMode(EditorModes.CONSTRUCTION);
            area.disable();
            area.building.buildPolygon();

            for (const { dot, before } of motionReport) {
                dot.move(Editor.newCoord(before.x, before.y, "normal"));
            }
            
            parentBackwards();
            Task.restore(before);
        };
        const prune = () => {
            if (area) { area.destroy(); area = null; }
            parentPrune();
        };

        this.newAction(forward, backward, prune);
    }
    static moveAreaBorder(heldObject) {
        let object = heldObject.object.area;
        let forwardCoord = { start: object.start.getIn("normal"), end: object.end.getIn("normal") };
        let backwardCoord = heldObject.initialPos;
        
        let motionReport = this.snapshotMotion();

        Editor.Referencer.endReport();

        const forward = () => {
            Actions.forceMode(EditorModes.CONSTRUCTION);

            let startCoord = Editor.newCoord(forwardCoord.start.x, forwardCoord.start.y, "normal");
            let endCoord = Editor.newCoord(forwardCoord.end.x, forwardCoord.end.y, "normal");
            object.move(startCoord, endCoord);

            for (const { dot, after } of motionReport) {
                dot.move(Editor.newCoord(after.x, after.y, "normal"));
            }

            object.building.buildPolygon();
        };
        
        const backward = () => {
            Actions.forceMode(EditorModes.CONSTRUCTION);
            
            let startCoord = Editor.newCoord(backwardCoord.start.x, backwardCoord.start.y, "normal");
            let endCoord = Editor.newCoord(backwardCoord.end.x, backwardCoord.end.y, "normal");
            object.move(startCoord, endCoord);

            for (const { dot, before } of motionReport) {
                dot.move(Editor.newCoord(before.x, before.y, "normal"));
            }

            object.building.buildPolygon();
        };

        this.newAction(forward, backward);
    }

    static destroyArea(area) {
        const building = area.building;
        const onlyOne = [...building.areas].filter(a => a.enabled).length == 1;
        
        const parentForwards = onlyOne ? () => building.disable() : () => {};
        const parentBackwards = onlyOne ? () => building.enable() : () => {};
        const parentOverflow = onlyOne ? () => building.destroy() : () => {};

        const entrances = [...building.entrances].filter(a => a.enabled);

        const forward = () => {
            Actions.forceMode(EditorModes.DELETION);
            area.disable();
            area.building.buildPolygon();

            for (const ref of entrances) {
                ref.validatePos();
            }

            parentForwards();
        };
        
        const backward = () => {
            Actions.forceMode(EditorModes.DELETION);
            area.enable();
            area.building.buildPolygon();

            for (const ref of entrances) {
                ref.validatePos();
            }

            parentBackwards();
        };

        const overflow = () => {
            if (area) {
                area.destroy();
                area = null;
            }
            parentOverflow();
        }

        area.disable();
        parentForwards();

        for (const ref of entrances) {
            ref.validatePos();
        }

        this.newAction(forward, backward, undefined, overflow);

        return area;
    }

    static pinDoneMode(mode) {
        if(mode) {
            pinBtn.children[0].classList.remove("hidden");
            pinBtn.children[1].classList.add("hidden");
        } else {
            pinBtn.children[1].classList.remove("hidden");
            pinBtn.children[0].classList.add("hidden");
        }
        pinDone = mode;
    }

    static pinMode(bool) {
        mapObj.classList.toggle("custom-cursor", bool);
    }
    
    static beginTask(name, data) {
        if (name == "build") {
            Task.setTask(name, data)
        }
    }

    static syncTaskUI() {
        if (!pinBtn) return;
        const inBuild = Task.task === "build";
        const hasAreas = inBuild && Task.taskStep === 1 && hasEnabledAreas(Task.data["buildObject"]);

        this.pinMode(inBuild && Task.taskStep === 0);
        const show = editorMode === EditorModes.CONSTRUCTION && (!inBuild || hasAreas);
        pinBtn.classList.toggle("hidden", !show);
        this.pinDoneMode(hasAreas);
    }

    static openBanner(obj) {
        this.saveBanner();

        resetDisplayImage();
        bannerTitle.value = "";
        bannerDescription.value = "";

        Holdable.set(obj, "banner", {img: false});

        this.restoreBanner(obj);
        bannerTab.classList.remove("hidden");
    }
    static closeBanner() {
        bannerTab.classList.add("hidden");
        
        this.saveBanner();
        
        Holdable.set(false);
    }
    static saveBanner() {
        if (!Holdable.object) {
            return;
        }
        let edited = false;

        let image = Holdable.initialPos["img"];
        if (image) {
            edited = true;
        }
        let title = bannerTitle.value;
        if (bannerTitle.value) {
            edited = true;
        }
        let description = bannerDescription.value;
        if (bannerDescription.value) {
            edited = true;
        }
        let banner = Holdable.object.banner;
        banner.detailed = edited;
        banner.image = image;
        banner.title = title;
        banner.description = description;
    }
    static restoreBanner(obj) {
        if (obj.banner.image) {
            setDisplayImage(obj.banner.image);
        }
        if (obj.banner.title) {
            bannerTitle.value = obj.banner.title;
        }
        if (obj.banner.description) {
            bannerDescription.value = obj.banner.description;
        }
    }
}
function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}

async function saveMapState(formData) {
    const url = URLSaveMap;
    const token = sessionStorage.getItem('authToken'); 

    try {
        const req = {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: formData
        };
        
        const response = await fetch(url, req);

        if (response.status === 401) {
            console.error('Usuário não autorizado.');
            return;
        }

        return response;
    } catch (error) {
        console.error('Erro de rede:', error);
    }
}

export async function save() {
    const { payload, files } = Editor.buildPayload();

    const formData = new FormData();

    // 1. Envia a estrutura do mapa como JSON na chave 'data'
    formData.append("data", JSON.stringify(payload));

    // 2. Anexa cada arquivo do objeto files no FormData usando a chave 'file_<bannerId>'
    if (files && typeof files === 'object') {
        for (const [bannerId, file] of Object.entries(files)) {
            if (file instanceof File) {
                formData.append(`file_${bannerId}`, file, file.name);
            }
        }
    }

    // 3. Envia o FormData para a requisição
    await saveMapState(formData);
}

async function confirmationCall() {
    const overlay = document.getElementById('confirm-modal-overlay');

    overlay.classList.add('active');
    
    let close = document.getElementById('close-confirm-modal');
    let decline = document.getElementById('modal-decline');
    let confirm = document.getElementById('modal-confirm');
    
    const result = await WaitButtonClick([close, decline, confirm]);

    return result;
}

function handleBuildSubmit(event) {
    event.preventDefault();
    const buildName = document.getElementById('build-name').value.trim();
    if (!buildName) return;
    document.getElementById('build-modal-overlay').classList.remove('active');
    document.getElementById('buildForm').reset();
    Task.data["name"] = buildName;
    Actions.newBuilding(clickX, clickY);
}

function setDisplayImage(file) {
    const reader = new FileReader();
        
    reader.onload = function (event) {
        imageWrapper.style.backgroundImage = `url('${event.target.result}')`;
        imageWrapper.style.borderStyle = 'solid';
        
        imageLabel.textContent = 'substituir imagem';

        Holdable.initialPos["img"] = file;
    };

    reader.readAsDataURL(file);
}

function resetDisplayImage() {
    imageInput.value = '';

    imageWrapper.style.backgroundImage = 'none';
    imageWrapper.style.borderStyle = '';

    imageLabel.textContent = 'adicionar imagem +';
}

function updateImageDisplay(e) {
    const file = e.target.files[0];
    if (file) {
        setDisplayImage(file);
    }
}

export function addListeners(map) {
    mapObj = map;
    map.addEventListener("pointerdown", Pointer.down);
    map.addEventListener("pointermove", Pointer.move);
    document.addEventListener("pointerup", Pointer.up);
    map.addEventListener("wheel", Pointer.wheel, { passive: false });

    map.addEventListener("touchstart", Touch.begin, { passive: false });
    map.addEventListener("touchmove", Touch.step, { passive: false });
    document.addEventListener("touchend", Touch.end);

    document.addEventListener('contextmenu', function(event) {
        event.preventDefault();
    });

    bannerTab = document.getElementById("banner");

    if (page == "main") {
        const orientationBtn = document.getElementById('orientation');
        const optionsBtn = document.getElementById('options');
        const closeBtn = document.getElementById('close-sidebar');
        const sidebar = document.getElementById('sidebar');
        const backdrop = document.getElementById('sidebar-backdrop');

        mapInterface = document.getElementById('screen-ui');

        imageLabel = document.getElementById("banner-image");
        bannerTitle = document.getElementById("banner-title");
        bannerDescription = document.getElementById("banner-description");

        const closeMenu = () => deactivateList([sidebar, backdrop]);
-
        orientationBtn.addEventListener('click', () => Graficos.smoothRotation(0));
        optionsBtn.addEventListener('click', () => activateList([sidebar, backdrop]));
        closeBtn.addEventListener('click', closeMenu);
        backdrop.addEventListener('click', closeMenu);

        Editor.load();
    
    } else if (page == "editor") {
        buildBtn = document.getElementById("build");
        referenceBtn = document.getElementById("reference");
        connectionBtn = document.getElementById("connection");
        bannerBtn = document.getElementById("banner-btn");
        saveBtn = document.getElementById("save");
        pinBtn = document.getElementById("pin-mode");

        imageInput = document.getElementById("banner-image-input");
        imageWrapper = document.getElementById("image-upload-wrapper");
        imageLabel = document.getElementById("image-upload-label");
        bannerTitle = document.getElementById("place-name");
        bannerDescription = document.getElementById("place-description");

        selectionBtn = document.getElementById("selection");
        deleteBtn = document.getElementById("delete");
        
        const buildModalBtn = document.getElementById("build-form-submit");
        const buildOverlay = document.getElementById("build-modal-overlay");
        const buildCloseBtn = document.getElementById("close-build-modal");

        let bannerForm = document.getElementById("bannerForm");

        bannerForm.addEventListener("submit", (e) => {
            e.preventDefault();
        });

        document.addEventListener("keydown", (e) => {
            if (e.target.closest?.("input, textarea, [contenteditable]")) return; // Ctrl+Z in the name field was undoing the map
            if (clicking || Holdable.object) return;

            const isModifierPressed = e.ctrlKey || e.metaKey;

            if (!isModifierPressed) return;

            const key = e.key.toLowerCase();

            if (key === "y" || (e.shiftKey && key === "z")) {
                e.preventDefault();
                Actions.redo();
            }
            else if (key === "z" && !e.shiftKey) {
                e.preventDefault();
                Actions.undo();
            }
        });

        const closeBuildModal = () => {
            document.getElementById("build-modal-overlay").classList.remove("active");
            document.getElementById("buildForm").reset();

            Actions.switchMode();
        }

        buildCloseBtn.addEventListener("click", closeBuildModal);

        buildOverlay.addEventListener("click", (e) => {
            if (e.target === buildOverlay) {
                closeBuildModal();
            }
        });

        buildBtn.addEventListener("click", () => Actions.switchMode(EditorModes.CONSTRUCTION));
        referenceBtn.addEventListener("click", () => Actions.switchMode(EditorModes.REFERENCE));
        connectionBtn.addEventListener("click", () => Actions.switchMode(EditorModes.CONNECTION));
        bannerBtn.addEventListener("click", () => Actions.switchMode(EditorModes.BANNER));
        selectionBtn.addEventListener("click", () => Actions.switchMode(EditorModes.SELECTION));
        deleteBtn.addEventListener("click", () => Actions.switchMode(EditorModes.DELETION));
        pinBtn.addEventListener("click", () => {
            if (!pinDone) Actions.beginTask("build", {});
            else Actions.finishTask();
        });

        hoverLoop = () => {
            for(const obj of hoverTargetSet) {
                obj.hoverAdd();
                if (!hoverSet.has(obj)) {
                    hoverSet.add(obj);
                }
            }
            let remove = [];
            for(const obj of hoverSet) {
                if (!hoverTargetSet.has(obj)) {
                    obj.hoverDec();
                    if (obj.hover <= 0) {
                        remove.push(obj);
                    }
                }
            }
            for (const obj of remove) {
                hoverSet.delete(obj);
            }
        }
        setInterval(hoverLoop, 1000 / 30);

        buildModalBtn.addEventListener("click", handleBuildSubmit);
        saveBtn.addEventListener("click", save);

        imageInput.addEventListener("change", e => updateImageDisplay(e));

        Editor.load();

        // let k = 100;
        // let r = 100;
        // let c = [1920 / 2, 1080 / 2];
        // for(let i = 0; i < k; i ++) {
        //     Actions.newReference(c[0] + Math.cos(i / k * Math.PI * 2) * r, c[1] + Math.sin(i / k * Math.PI * 2) * r);
        // }
        // for(let i of Object.values(Editor.Referencer.references)) {
        //     for(let j of Object.values(Editor.Referencer.references)) {
        //         Actions.newConnection(i, j);
        //     }
        // }
    }
}
