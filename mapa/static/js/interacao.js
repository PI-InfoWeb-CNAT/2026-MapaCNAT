import * as Transformacao from "./transformacao.js";
import * as Graficos from "./graficos.js";
import * as Editor from "./editor.js";

let buildBtn;
let referenceBtn;
let connectionBtn;
let saveBtn;

let selectionBtn;
let deleteBtn;
let confirmBtn;

let clicking = false;
let touching = false;

let minZoom, maxZoom;
let zoomStep;

let page;

let zoom = Graficos.zoom;

let mapStartX, mapStartY;
let clickX, clickY;
let touchX, touchY;
let startMidX, startMidY;
let startDistance, startAngle;
let startZoom, startRotation;
let startOffsetX, startOffsetY;


let tempConn;
let tempReference;
let tempConstruction;
let tempRegion;

let holdingBuilding;

const EditorModes = Object.freeze({
  FREE: 'FREE',
  SELECTION: 'SELECTION',
  DELETION: 'DELETION',
  CONSTRUCTION: 'CONSTRUCTION',
  REFERENCE: 'REFERENCE',
  CONNECTION: 'CONNECTION'
});

let editorMode = EditorModes.FREE;

export function setContext(context) {
    page = context.page;
    minZoom = Graficos.minZoom;
    maxZoom = Graficos.maxZoom;
    zoomStep = context.scroll_ratio;
}

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

        if (page == "editor") {
            if (editorMode == EditorModes.REFERENCE) {
                Actions.createReference(clickX, clickY);
                
            } else if (editorMode == EditorModes.CONNECTION) {
                let col = Editor.Referencer.getCollision(clickX, clickY);
                if (col) {
                    Actions.beginConnection(col);
                }
            } else if (editorMode == EditorModes.CONSTRUCTION) {
                if (tempConstruction.pin == null) {
                    Actions.addPin(clickX, clickY);
                } else {
                    Actions.beginRegion(clickX, clickY);
                }
            } else if (editorMode == EditorModes.SELECTION) {
                let colRef = Editor.Referencer.getCollision(clickX, clickY);
                let colConstruction = Editor.Builder.getCollision(clickX, clickY);

                Actions.clearSelection();
                if (colRef) {
                    Actions.addSelection(colRef, clickX, clickY);

                    if (holdingBuilding) {
                        Editor.Builder.convertGraphical(holdingBuilding, "polygon");
                        holdingBuilding = null;
                    }
                } else {
                    if (colConstruction) {
                        if (holdingBuilding) {
                            let colRegion = Editor.Builder.getCollisionArea(holdingBuilding, clickX, clickY);
                            Actions.addSelection(colRegion, clickX, clickY);
                            Editor.Builder.convertGraphical(holdingBuilding, "polygon");
                        }
                        Editor.Builder.convertGraphical(colConstruction, "areas");
                        holdingBuilding = colConstruction;
                        
                    } else {
                        if (holdingBuilding) {
                            Editor.Builder.convertGraphical(holdingBuilding, "polygon");
                            holdingBuilding = null;
                        }
                    }
                    
                }
            } else if (editorMode == EditorModes.DELETION) {
                let colRef = Editor.Referencer.getCollision(clickX, clickY);
                let colLine = Editor.Connections.getCollision(clickX, clickY);
                let colConstruction = Editor.Builder.getCollision(clickX, clickY);

                if (colRef) {
                    Actions.removeReference(colRef);
                } else if (colLine) {
                    Actions.removeConnection(colLine);
                } else if (colConstruction) {
                    if (holdingBuilding) {
                        let colRegion = Editor.Builder.getCollisionArea(holdingBuilding, clickX, clickY);
                        Actions.removeRegion(colRegion);
                        if (holdingBuilding.areas.length == 0) {
                            Actions.removeConstruction(holdingBuilding);
                            Editor.Builder.clearSelection();
                        }
                        Actions.addSelection(colRegion, clickX, clickY);
                        Editor.Builder.convertGraphical(holdingBuilding, "polygon");
                    }
                    Editor.Builder.convertGraphical(colConstruction, "areas");
                    holdingBuilding = colConstruction;
                    
                } else {
                    if (holdingBuilding) {
                        Editor.Builder.convertGraphical(holdingBuilding, "polygon");
                        holdingBuilding = null;
                    }
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
        if (page == "main") {
            if (!clicking) return;
            
            Pointer.defaultMove(e);
            
        } else if (page == "editor") {
            if (editorMode == EditorModes.FREE) {
                if (!clicking) return;
                
                Pointer.defaultMove(e);

            } else if (editorMode == EditorModes.REFERENCE) {
                if (!tempReference) {
                    Actions.createTempReference(e.clientX, e.clickY);
                }
                Editor.Referencer.updateTempReference(tempReference, e.clientX, e.clientY);
                
            } else if (editorMode == EditorModes.CONSTRUCTION) {
                if (tempRegion) {
                    Editor.Builder.updateRegion(tempRegion, e.clientX, e.clientY);
                }
                if (tempRegion || tempConstruction.regions.length > 0) {
                    confirmBtn.classList.remove("hidden");
                }
            } else if (editorMode == EditorModes.CONNECTION) {
                if (tempConn != null) {
                    Editor.Connections.updateTempConnection(tempConn, e.clientX, e.clientY);

                    let col = Editor.Referencer.getCollision(e.clientX, e.clientY, tempConn.reference);
                    if (col) {
                        Actions.createConnection(tempConn.reference, col);
                    }
                }
            } else if (editorMode == EditorModes.SELECTION) {
                for(const obj of Editor.Referencer.selection) {
                    Editor.Referencer.moveRef(obj.obj, e.clientX - obj.offx, e.clientY - obj.offy);
                }
                for(const obj of Editor.Builder.selection) {
                    if (obj.obj instanceof Editor.Region) {
                        Editor.Builder.moveRegion(obj.obj, e.clientX - obj.offx, e.clientY - obj.offy);
                        Editor.Builder.reOrder(obj.obj);
                    }
                    if (obj.obj instanceof Editor.Pin) {
                        Editor.Builder.movePin(obj.obj, e.clientX - obj.offx, e.clientY - obj.offy);
                    }
                }
            }
        }
    }

    static up(e) {
        clicking = false;
        if (page == "editor") {
            if (editorMode == EditorModes.CONNECTION) {
                Actions.removeTempConnection();
            } else if (editorMode == EditorModes.CONSTRUCTION) {
                if (tempRegion) {
                    tempRegion.end = Graficos.getNormalizedCoordinates(e.clientX, e.clientY);
                }
                Actions.sendRegion();
                Actions.removeTempRegion();
            } else if (editorMode == EditorModes.SELECTION) {
                Actions.clearSelection();
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

async function saveMapState(data) {
    const url = URLSaveMap;
    
    const token = sessionStorage.getItem('authToken'); 

    try {
        let req = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify(data)
        }
        const response = await fetch(url, req);

        if (response.status === 401) {
        console.error('Usuário não autorizado.');
            return;
        }
    } catch (error) {
        console.error('Erro de rede:', error);
    }
}

class Actions {
    static createReference(x, y) {
        Editor.Referencer.createReference(x, y);
    }
    static removeReference(ref) {
        Editor.Referencer.removeReference(ref);
    }
    static createConnection(a, b) {
        Editor.Connections.createConnection(a, b);
        Actions.removeTempConnection();
        Actions.beginConnection(b);
    }
    static removeConnection(conn) {
        Editor.Connections.removeConnection(conn, true);
    }

    static addSelection(obj, x, y) {
        if (obj instanceof Editor.Reference) {
            Editor.Referencer.addSelection(obj, x, y);
        } else if (obj instanceof Editor.Region) {
            Editor.Builder.addSelection(obj, x, y);
        } else if (obj instanceof Editor.Pin) {
            Editor.Builder.addPinSelection(obj, x, y);
        }
    }
    static removeSelection(obj) {
        if (obj instanceof Editor.Reference) {
            Editor.Referencer.removeSelection(obj);
        } else if (obj instanceof Editor.Region) {
            Editor.Builder.removeSelection(obj);
        } else if (obj instanceof Editor.Pin) {
            Editor.Builder.removeSelection(obj);
        }
    }
    static clearSelection() {
        Editor.Referencer.clearSelection();
        Editor.Builder.clearSelection();
    }

    static removeTempConnection() {
        if (tempConn) {
            Editor.Connections.removeTempConnection(tempConn);
            tempConn = null;
        }
    }
    static beginConnection(ref) {
        let tempGraphics = Editor.Connections.createTempConnection(ref);
        tempConn = new Editor.TempConnection(ref, tempGraphics);
    }

    static removeTempReference() {
        if (tempReference) {
            Editor.Referencer.removeTempReference(tempReference);
            tempReference = null;
        }
    }
    static createTempReference(x, y) {
        let tempGraphics = Editor.Referencer.createTempReference(x, y);
        tempReference = new Editor.TempReference(tempGraphics);
    }

    static removeTempConstruction() {
        if (tempConstruction) {
            Editor.Builder.removeTempConstruction(tempConstruction);
            tempConstruction = null;
        }
    }
    static createTempConstruction(name) {
        tempConstruction = new Editor.TempConstruction(name);
    }
    static addPin(x, y) {
        let mapPos = Graficos.getNormalizedCoordinates(x, y);
        tempConstruction.pin = mapPos;
        tempConstruction.pin_graphics = Editor.Builder.createPin(x, y, tempConstruction.name);
        this.pinMode(false);
    }

    static beginRegion(x, y) {
        let mapPos = Graficos.getNormalizedCoordinates(x, y);
        let regionGraphics = Editor.Builder.createRegion();
        tempRegion = new Editor.TempRegion(regionGraphics, {x: mapPos.x, y: mapPos.y});
    }
    static removeTempRegion() {
        if (tempRegion) {
            Editor.Builder.removeTempRegion(tempRegion);
            tempRegion = null;
        }
    }
    static removeRegion(region) {
        Editor.Builder.removeRegion(region);
    }
    static removeConstruction(construction) {
        Editor.Builder.removeConstruction(construction);
    }
    static sendRegion() {
        if (tempRegion) {
            let region = Editor.Builder.createRegionObject(tempRegion);
            if (region.size.x != 0 && region.size.y != 0) {
                tempConstruction.regions.push(region);
            }
        }
    }
    static finishBuild() {
        let construction = Editor.Builder.createConstruction(tempConstruction);
        Editor.Builder.convertGraphical(construction, "polygon");
        this.removeTempConstruction();
    }

    static clearProgress() {
        Actions.removeTempReference();
        Actions.removeTempConnection();
        Actions.removeTempRegion();
        Actions.removeTempConstruction();
        if (holdingBuilding) {
            Editor.Builder.convertGraphical(holdingBuilding, "polygon");
        }

        Actions.clearSelection();
    }

    static goToMode(mode=EditorModes.FREE) {
        if (editorMode == EditorModes.CONSTRUCTION && tempConstruction) {
            return;
        }
        if (editorMode == mode) {
            mode = EditorModes.FREE;
        }
        editorMode = mode;

        Actions.clearProgress();

        Graficos.editorFocus(false);
        if ([
            EditorModes.SELECTION,
            EditorModes.DELETION,
            EditorModes.CONSTRUCTION,
            EditorModes.REFERENCE,
            EditorModes.CONNECTION
            ].includes(editorMode)) {
            Graficos.editorFocus(true);
        }

        if (editorMode == EditorModes.CONSTRUCTION) {
            Actions.OpenModal();
        }

        lightButton(selectionBtn, mode, EditorModes.SELECTION);
        lightButton(deleteBtn, mode, EditorModes.DELETION);
        lightButton(buildBtn, mode, EditorModes.CONSTRUCTION);
        lightButton(referenceBtn, mode, EditorModes.REFERENCE);
        lightButton(connectionBtn, mode, EditorModes.CONNECTION);
    }

    static save() {
        let refs = Editor.Referencer.toJson();
        let builds = Editor.Builder.toJson();
        let conn = Editor.Connections.toJson();
        let data = {
            "references": refs,
            "buildings": builds,
            "connections": conn
        }
        saveMapState(data);
    }

    static OpenModal() {
        const overlay = document.getElementById('buildModalOverlay');
        overlay.classList.add('active');
    }
    static pinMode(bool) {
        if (bool) {
            map.classList.add("custom-cursor");
        } else {
            map.classList.remove("custom-cursor");
        }
    }
}

function handleBuildSubmit(event) {
    event.preventDefault();

    let buildName = document.getElementById('build-name').value;

    Actions.createTempConstruction(buildName);

    document.getElementById('buildModalOverlay').classList.remove('active');
    document.getElementById('buildForm').reset();

    Actions.pinMode(true);
}

function handleConfirm(event) {
    // Editor.Builder.buildings.push(currBuild);
    
    // currBuild.generatePolygon();

    Actions.finishBuild();

    Actions.goToMode();
    // Actions.commitBuild();

    confirmBtn.classList.add("hidden");
}

export function addListeners(map) {
    map.addEventListener("pointerdown", Pointer.down);
    map.addEventListener("pointermove", Pointer.move);
    document.addEventListener("pointerup", Pointer.up);
    map.addEventListener("wheel", Pointer.wheel, { passive: false });
    map.addEventListener("touchstart", Touch.begin, { passive: false });
    map.addEventListener("touchmove", Touch.step, { passive: false });
    map.addEventListener("touchend", Touch.end);

    document.addEventListener('contextmenu', function(event) {
        event.preventDefault();
    });

    if (page == "main") {
        const orientationBtn = document.getElementById('orientation');
        const optionsBtn = document.getElementById('options');
        const closeBtn = document.getElementById('close-sidebar');
        const sidebar = document.getElementById('sidebar');
        const backdrop = document.getElementById('sidebar-backdrop');

        const closeMenu = () => deactivateList([sidebar, backdrop]);
-
        orientationBtn.addEventListener('click', () => Graficos.smoothRotation(0));
        optionsBtn.addEventListener('click', () => activateList([sidebar, backdrop]));
        closeBtn.addEventListener('click', closeMenu);
        backdrop.addEventListener('click', closeMenu);
    
    } else {
        buildBtn = document.getElementById("build");
        referenceBtn = document.getElementById("reference");
        connectionBtn = document.getElementById("conection");
        saveBtn = document.getElementById("save");

        selectionBtn = document.getElementById("selection");
        deleteBtn = document.getElementById("delete");

        confirmBtn = document.getElementById("submit");
        
        const buildModalBtn = document.getElementById("buildFormSubmit");
        const buildOverlay = document.getElementById('buildModalOverlay');
        const buildCloseBtn = document.getElementById('closeBuildModal');

        const closeBuildModal = () => {
            document.getElementById('buildModalOverlay').classList.remove('active');
            document.getElementById('buildForm').reset();

            Actions.goToMode();
        }

        buildCloseBtn.addEventListener('click', closeBuildModal);

        buildOverlay.addEventListener('click', (e) => {
            if (e.target === buildOverlay) {
                closeBuildModal();
            }
        });

        buildBtn.addEventListener("click", () => Actions.goToMode(EditorModes.CONSTRUCTION));
        referenceBtn.addEventListener("click", () => Actions.goToMode(EditorModes.REFERENCE));
        connectionBtn.addEventListener("click", () => Actions.goToMode(EditorModes.CONNECTION));

        selectionBtn.addEventListener("click", () => Actions.goToMode(EditorModes.SELECTION));
        deleteBtn.addEventListener("click", () => Actions.goToMode(EditorModes.DELETION));

        saveBtn.addEventListener("click", () => Actions.save());
        
        buildModalBtn.addEventListener("click", handleBuildSubmit);

        confirmBtn.addEventListener("click", handleConfirm);

        Editor.load();
    }
}
