import * as Graficos from "./graficos.js";
import * as Transformacao from "./transformacao.js";

let clicking = false;
let touching = false;

let minZoom, maxZoom;
let zoomStep;
let currSquare;

let page;

let zoom = Graficos.zoom;

let mapStartX, mapStartY;
let clickX, clickY;
let pointerButton;
let mouseX, mouseY;
let touchX, touchY;
let startMidX, startMidY;
let startDistance, startAngle;
let startZoom, startRotation;
let startOffsetX, startOffsetY;
let currBuild;

let editMode;
let modeStep;

export function setContext(context) {
    page = context.page;
    minZoom = Graficos.minZoom;
    maxZoom = Graficos.maxZoom;
    zoomStep = context.scroll_ratio;
}

function nextStep() {
    if (editMode == "build") {
        if (modeStep == 0) {
            map.classList.remove("custom-cursor");
        }
    }
    modeStep += 1;
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
        pointerButton = e.button;
        mapStartX = Graficos.mapContainer.x;
        mapStartY = Graficos.mapContainer.y;
        clicking = true;
        if (page == "editor") {
            if (editMode == "build") {
                if (modeStep == 0) {
                    Graficos.addBuildPin({x: clickX, y: clickY});
                    nextStep();
                } else if (modeStep == 1) {
                    currSquare = Graficos.createBuildArea({x: clickX, y: clickY});
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
        if (!clicking) return;
        if (page == "main") {
            Pointer.defaultMove(e);
        } else {
            if (editMode == "build") {
                if (pointerButton == 2) {
                    Pointer.defaultMove(e);
                }
                if (pointerButton == 0) {
                    if (modeStep == 1) {
                        currSquare.setSize({x: e.clientX, y: e.clientY});
                    }
                }
            } else {
                Pointer.defaultMove(e);
            }
        }
    }

    static up(e) {
        clicking = false;
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

class Actions {
    static goToMode(mode) {
        if (mode == "build" && editMode == "build") {
            return;
        }
        editMode = mode;
        modeStep = 0;
        const overlay = document.getElementById('buildModalOverlay');
        overlay.classList.add('active');
    }
}

function handleBuildSubmit(event) {
    buildName = document.getElementById('build-name').value;
    
    event.preventDefault();

    document.getElementById('buildModalOverlay').classList.remove('active');
    document.getElementById('buildForm').reset();

    map.classList.add("custom-cursor");
}

export function addListeners(map) {
    map.addEventListener("pointerdown", Pointer.down);
    map.addEventListener("pointermove", Pointer.move);
    map.addEventListener("pointerup", Pointer.up);
    map.addEventListener("pointerleave", Pointer.up);
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

        orientationBtn.addEventListener('click', () => Graficos.smoothRotation(0));
        optionsBtn.addEventListener('click', () => activateList([sidebar, backdrop]));
        closeBtn.addEventListener('click', closeMenu);
        backdrop.addEventListener('click', closeMenu);
    
    } else {
        const confirmBtn = document.getElementById("submit");
        const buildBtn = document.getElementById("build");
        const buildModalBtn = document.getElementById("buildFormSubmit");

        confirmBtn.addEventListener("click", (e) => Graficos.updateBuilding());

        buildBtn.addEventListener("click", e => Actions.goToMode("build"));

        buildModalBtn.addEventListener("click", handleBuildSubmit);
    }
}
