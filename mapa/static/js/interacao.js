import * as Transformacao from "./transformacao.js";
import * as Graficos from "./graficos.js";
import * as Editor from "./editor.js";

let buildBtn;
let referenceBtn;
let connectionBtn;
let saveBtn;
let expandBannerBtn;
let bannerTab;
let imageInput;
let imageWrapper;
let imageLabel;
let bannerTitle;
let bannerDescription;
let tempFile;
let pinMap;
let bannerMap;
let previousTitle;
let mapInterface;

let selectionBtn;
let deleteBtn;
let confirmBtn;

let focusObjects = [];

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
        if (page == "main") {
            let colRegion = Editor.Builder.getCollisionPin(pinMap, clickX, clickY);
            if (colRegion) {
                mapInterface.classList.remove("hidden");
                
                let banner = bannerMap[colRegion.text];

                imageLabel.classList.remove("hidden");
                if (banner.image) {
                    imageLabel.src = banner.image;
                } else {
                    image.classList.add("hidden");
                }
                bannerTitle.innerHTML = banner.title;
                bannerDescription.innerHTML = banner.description;
            } else {
                mapInterface.classList.add("hidden");
            }
        } else if (page == "editor") {
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
            if (clicking) {
                Pointer.defaultMove(e);
            } else {
                if (!pinMap) return;
                let colRegion = Editor.Builder.getCollisionPin(pinMap, e.clientX, e.clientY);
                document.body.style.cursor = 'default';
                if (colRegion) {
                    let gfxObj = {"pin": colRegion.gfx, "label": colRegion.label};
                    Graficos.updatePin(gfxObj, colRegion.x, colRegion.y, colRegion.text, true);
                    colRegion.gfx = gfxObj.pin;
                    colRegion.label = gfxObj.label;
                    document.body.style.cursor = 'pointer';
                    
                    previousTitle = colRegion;
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
                    Actions.addFocus([obj.obj]);
                }
                for(const obj of Editor.Builder.selection) {
                    if (obj.obj instanceof Editor.Region) {
                        Editor.Builder.moveRegion(obj.obj, e.clientX - obj.offx, e.clientY - obj.offy);
                        Editor.Builder.reOrder(obj.obj);
                    }
                    if (obj.obj instanceof Editor.Pin) {
                        Editor.Builder.movePin(obj.obj, e.clientX - obj.offx, e.clientY - obj.offy);
                        Actions.addFocus([obj.obj]);
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
                if (!isInside(e, expandBannerBtn) && !isInside(e, bannerTab)) {
                    let focusList = []
                    if (Editor.Referencer.selection.length > 0) {
                        focusList.push(Editor.Referencer.selection[0].obj);
                    }
                    if (Editor.Builder.selection.length > 0) {
                        focusList.push(Editor.Builder.selection[0].obj);
                    }
                    Actions.addFocus(focusList);
                }
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
                'Authorization': `Bearer ${token}`,
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: data
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
    static toggleBanner() {
        bannerTab.classList.toggle("hidden");
    }
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

    static addFocus(objects) {
        if (focusObjects) {
            for (const object of focusObjects) {
                object.isFocus = false;
                if (object instanceof Editor.Reference) {
                    Editor.Referencer.drawMode(object);
                }
            }
        }
        if (focusObjects[0]) {
            Actions.saveBanner(focusObjects[0]);
        }
        focusObjects = objects;
        
        for (const object of objects) {
            object.isFocus = true;
            if (object instanceof Editor.Reference) {
                Editor.Referencer.drawMode(object);
            }
        }
        if (focusObjects.length > 0) {
            this.showBanner(focusObjects[0]);
        } else {
            this.hideBanner();
        }
    }

    static saveBanner(oldObject) {
        let image = tempFile;
        let title = bannerTitle.value;
        let description = bannerDescription.value;

        Editor.Banner.saveBanner(oldObject, image, title, description);

        tempFile = null;
    }

    static showBanner(obj) {
        expandBannerBtn.classList.remove("hidden");
        let banner = obj.banner;
        if (obj instanceof Editor.Pin) {
            banner = obj.construction.banner;
        }
        resetDisplayImage();
        if (banner) {
            if (banner.file) {
                setDisplayImage(banner.file);
            }
            bannerTitle.value = banner.title;
            bannerDescription.value = banner.description;
        }
        else {
            bannerTitle.value = "";
            bannerDescription.value = "";
        }
    }
    
    static hideBanner() {
        expandBannerBtn.classList.add("hidden");
        bannerTab.classList.add("hidden");
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

        let formData = Editor.Banner.toJson();

        let mapData = {
            "references": refs,
            "buildings": builds,
            "connections": conn,
            "banners": Editor.Banner.bannerJson()
        };

        formData.append("data", JSON.stringify(mapData));

        saveMapState(formData);
    }

    static OpenModal() {
        const overlay = document.getElementById('build-modal-overlay');
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

    document.getElementById('build-modal-overlay').classList.remove('active');
    document.getElementById('buildForm').reset();

    Actions.pinMode(true);
}

function handleConfirm(event) {
    Actions.finishBuild();

    Actions.goToMode();

    confirmBtn.classList.add("hidden");
}

export async function setMaps(data) {
    pinMap = data.pinMap;
    bannerMap = data.bannerMap;
}

function setDisplayImage(file) {
    const reader = new FileReader();
        
    reader.onload = function (event) {
        imageWrapper.style.backgroundImage = `url('${event.target.result}')`;
        imageWrapper.style.borderStyle = 'solid';
        
        imageLabel.textContent = 'substituir imagem';
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
    tempFile = file;
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
    
    } else {
        buildBtn = document.getElementById("build");
        referenceBtn = document.getElementById("reference");
        connectionBtn = document.getElementById("conection");
        saveBtn = document.getElementById("save");

        expandBannerBtn = document.getElementById("expand-banner");
        imageInput = document.getElementById("banner-image-input");
        imageWrapper = document.getElementById("image-upload-wrapper");
        imageLabel = document.getElementById("image-upload-label");
        bannerTitle = document.getElementById("place-name");
        bannerDescription = document.getElementById("place-description");

        selectionBtn = document.getElementById("selection");
        deleteBtn = document.getElementById("delete");

        confirmBtn = document.getElementById("submit");
        
        const buildModalBtn = document.getElementById("buildFormSubmit");
        const buildOverlay = document.getElementById("build-modal-overlay");
        const buildCloseBtn = document.getElementById("close-build-modal");

        const closeBuildModal = () => {
            document.getElementById("build-modal-overlay").classList.remove("active");
            document.getElementById("buildForm").reset();

            Actions.goToMode();
        }

        buildCloseBtn.addEventListener("click", closeBuildModal);

        buildOverlay.addEventListener("click", (e) => {
            if (e.target === buildOverlay) {
                closeBuildModal();
            }
        });

        buildBtn.addEventListener("click", () => Actions.goToMode(EditorModes.CONSTRUCTION));
        referenceBtn.addEventListener("click", () => Actions.goToMode(EditorModes.REFERENCE));
        connectionBtn.addEventListener("click", () => Actions.goToMode(EditorModes.CONNECTION));
        selectionBtn.addEventListener("click", () => Actions.goToMode(EditorModes.SELECTION));
        deleteBtn.addEventListener("click", () => Actions.goToMode(EditorModes.DELETION));

        saveBtn.addEventListener("click", Actions.save);
        buildModalBtn.addEventListener("click", handleBuildSubmit);
        confirmBtn.addEventListener("click", handleConfirm);

        expandBannerBtn.addEventListener("click", Actions.toggleBanner);
        imageInput.addEventListener("change", e => updateImageDisplay(e));

        Editor.load();
    }
}
