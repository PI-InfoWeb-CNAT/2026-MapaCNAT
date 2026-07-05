import * as Graficos from "./graficos.js";
import * as Transformacao from "./transformacao.js";
import * as Editor from "./editor.js";

const buildBtn = document.getElementById("build");
const referenceBtn = document.getElementById("reference");
const routeBtn = document.getElementById("route");

let clicking = false;
let touching = false;

let minZoom, maxZoom;
let zoomStep;

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
let selectBuild = false;
let selectRef = false;
let selectArea = false;
let currSquare;
let currRoute = false;
let confirmBtn;
let addBtn;
let editBtn;
let deleteBtn;

let editMode = "";
let modeStep = 0;
let stateEditMode = "";

export function setContext(context) {
    page = context.page;
    minZoom = Graficos.minZoom;
    maxZoom = Graficos.maxZoom;
    zoomStep = context.scroll_ratio;
}

function nextStep() {
    if (editMode == "build") {
        if (modeStep == 0) {
            map.classList.add("custom-cursor");
        }

        if (modeStep == 1) {
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
                if (stateEditMode == "add") {
                    if (modeStep == 1) {
                        currBuild.setPin({x: clickX, y: clickY});
                        Graficos.addBuildPin(currBuild);
                    } else if (modeStep == 2) {
                        currSquare = new Editor.BuildArea({x: clickX, y: clickY});
                        currBuild.addArea(currSquare);
                        Graficos.addBuildArea(currSquare);
                    }
                } else if (stateEditMode == "edit") {
                    if (selectBuild == false) {
                        let build = Editor.Builder.getCollision({x: clickX, y: clickY});
                        if (build != false) {
                            build.revertPolygon();
                            selectBuild = build;
                            if (build.areas.length == 1) {
                                let area = {
                                    r: build.areas[0],
                                    b: build.areas[0].aabb(),
                                }
                                selectArea = area;
                            }
                        }
                    } else {
                        let area = selectBuild.getCollision({x: clickX, y: clickY});

                        if (area != false) {
                            selectArea = area;
                        } else {
                            let build = Editor.Builder.getCollision({x: clickX, y: clickY});
                            if (build != false) {
                                Actions.commitBuild();
                                build.revertPolygon();
                                selectBuild = build;
                            } else {
                                currSquare = new Editor.BuildArea({x: clickX, y: clickY});
                                selectBuild.addArea(currSquare);
                                Graficos.addBuildArea(currSquare);
                            }
                        }
                    }
                } else if (stateEditMode == "delete") {
                    if (selectBuild == false) {
                        let build = Editor.Builder.getCollision({x: clickX, y: clickY});
                        if (build != false) {
                            build.revertPolygon();
                            selectBuild = build;
                            if (selectBuild.areas.length == 1) {
                                selectBuild.removeArea(selectBuild.areas[0]);
                                if (selectBuild.areas.length == 0) {
                                    Editor.Builder.removeBuild(selectBuild);
                                    selectBuild = false;
                                }
                            }
                        }
                    } else {
                        let area = selectBuild.getCollision({x: clickX, y: clickY});

                        if (area != false) {
                            selectBuild.removeArea(area.r);
                            if (selectBuild.areas.length == 0) {
                                Editor.Builder.removeBuild(selectBuild);
                                selectBuild = false;
                            }
                        } else {
                            let build = Editor.Builder.getCollision({x: clickX, y: clickY});
                            if (build != false) {
                                Actions.commitBuild();
                                build.revertPolygon();
                                selectBuild = build;
                            }
                        }
                    }
                }
            } else if (editMode == "reference") {
                if (stateEditMode == "add") {
                    let ref = new Editor.Reference({x: clickX, y: clickY});
                    Editor.Referencer.addReference(ref);
                    Graficos.addReference(ref);
                } else if (stateEditMode == "edit") {
                    let point = Editor.Referencer.getCollision({x: clickX, y: clickY});
                    if (point != false) {
                        selectRef = point;
                    }

                } else if (stateEditMode == "delete") {
                    let point = Editor.Referencer.getCollision({x: clickX, y: clickY});
                    if (point != false) {
                        Editor.Referencer.removeReference(point);
                    }
                }
            } else if (editMode == "route") {
                if (stateEditMode == "add") {
                    let point = Editor.Referencer.getCollision({x: clickX, y: clickY});
                    if (point != false) {
                        currRoute = new Editor.Route(point);
                    Graficos.addRoute(currRoute.currPart, {x: e.clientX, y: e.clientY});
                    } else {
                        currRoute = false;
                    }
                } else if (stateEditMode == "delete") {
                    let route = Editor.Router.getCollision({x: clickX, y: clickY});
                    if (route != false) {
                        Editor.Router.removeRoute(route, true);
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
        if (!clicking) return;
        if (page == "main") {
            Pointer.defaultMove(e);
        } else {
            if (editMode == "build") {
                if (stateEditMode == "add") {
                    if (pointerButton == 2) {
                        Pointer.defaultMove(e);
                    }
                    if (pointerButton == 0) {
                        if (modeStep == 2) {
                            currSquare.setSize({x: e.clientX, y: e.clientY});
                            Graficos.setBuildAreaSize(currSquare);

                            let squareList = currBuild.areas;
                            confirmBtn.classList.add("hidden");
                            for (let i=0; i < squareList.length; i++) {
                                if (squareList[i].success) {
                                    confirmBtn.classList.remove("hidden");
                                    break;
                                }
                            }
                        }
                    }
                } else if (stateEditMode == "edit") {
                    if (selectArea != false) {
                        let pos = {
                            x: e.clientX,
                            y: e.clientY,
                            cx: clickX,
                            cy: clickY,
                        }
                        selectArea.r.setPos(pos, selectArea.b);
                        Graficos.setBuildAreaSize(selectArea.r);
                    } else if (currSquare) {
                        currSquare.setSize({x: e.clientX, y: e.clientY});
                        Graficos.setBuildAreaSize(currSquare);
                    }
                }
            } else if (editMode == "reference") {
                if (stateEditMode == "edit") {
                    if (selectRef != false) {
                        Editor.Referencer.updateRef(selectRef, {x: e.clientX, y: e.clientY});
                    }
                }
            } else if (editMode == "route") {
                if (currRoute != false) {
                    let point = Editor.Referencer.getCollision({x: e.clientX, y: e.clientY}, currRoute);
                    if (point != false) {
                        Graficos.setRouteLine(currRoute.currPart, point.pos);
                        currRoute.finishPart(point);
                        Graficos.addRoute(currRoute.currPart, {x: e.clientX, y: e.clientY});
                    } else {
                        let normalizedPos = Graficos.getNormalizedCoordinates(e.clientX, e.clientY);
                        Graficos.setRouteLine(currRoute.currPart, normalizedPos);
                    }
                }
            } else {
                Pointer.defaultMove(e);
            }
        }
    }

    static up(e) {
        clicking = false;
        if (page == "editor") {
            selectRef = false;
            selectArea = false;
            if (editMode == "build") {
                if (modeStep == 1) {
                    nextStep();
                }
            } else if (editMode == "route") {
                if (currRoute != false) {
                    currRoute.end();
                    currRoute = false;
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
    static commitBuild() {
        if (selectBuild != false) {
            selectBuild.generatePolygon();
            selectBuild = false;
            currSquare = false;
        }
    }
    static goToEditionMode(mode) {
        if (editMode == "build") {
            if (stateEditMode != "add") {
                this.commitBuild();
                stateEditMode = mode;

                if (mode == "add") {
                    const overlay = document.getElementById('buildModalOverlay');
                    overlay.classList.add('active');
                }

                addBtn.classList.remove('mode-active'); 
                editBtn.classList.remove('mode-active'); 
                deleteBtn.classList.remove('mode-active'); 

                if (stateEditMode == "add") {
                    addBtn.classList.add('mode-active');
                }
                if (stateEditMode == "edit") {
                    editBtn.classList.add('mode-active');
                }
                if (stateEditMode == "delete") {
                    deleteBtn.classList.add('mode-active');
                }
            }
            return;
        }
        if (mode == stateEditMode) {
            mode = "";
        }
        stateEditMode = mode;
        addBtn.classList.remove('mode-active'); 
        editBtn.classList.remove('mode-active'); 
        deleteBtn.classList.remove('mode-active'); 

        if (stateEditMode == "add") {
            addBtn.classList.add('mode-active');
        }
        if (stateEditMode == "edit") {
            editBtn.classList.add('mode-active');
        }
        if (stateEditMode == "delete") {
            deleteBtn.classList.add('mode-active');
        }
    }
    static goToMode(mode) {
        if (stateEditMode == "add") {
            if (mode == editMode) {
                if (mode == "build") {
                    return;
                }
                if (mode == "reference" || mode == "route") {
                    mode = "";
                    modeStep = 0;
                    Graficos.editorFocus(false);
                }
            }
            if (editMode == "build" && mode != "") {
                return;
            }

            if (mode == "") {
                editMode = "";
                modeStep = 0;
                
                Graficos.editorFocus(false);
                buildBtn.classList.remove('mode-active');
                routeBtn.classList.remove('mode-active');
                referenceBtn.classList.remove('mode-active');
                return;
            }

            editMode = mode;
            modeStep = 0;
            
            if (mode) {
                Graficos.editorFocus(true);
            } else {
                Graficos.editorFocus(false);
            }

            routeBtn.classList.remove('mode-active');
            referenceBtn.classList.remove('mode-active');
            
            if (mode == "build") {
                const overlay = document.getElementById('buildModalOverlay');
                overlay.classList.add('active');
            } else if (mode == "reference") {
                referenceBtn.classList.add('mode-active'); 
            } else if (mode == "route") {
                routeBtn.classList.add('mode-active');
            }
        } else if (stateEditMode == "edit") {
            this.commitBuild();
            if (mode == editMode) {
                editMode = "";
            } else {
                editMode = mode;
                modeStep = 0;
            }
            if (editMode != "") {
                Graficos.editorFocus(true);
            } else {
                Graficos.editorFocus(false);
            }

            buildBtn.classList.remove('mode-active');
            referenceBtn.classList.remove('mode-active');
            routeBtn.classList.remove('mode-active');
            if (editMode == "build") {
                buildBtn.classList.add('mode-active'); 
            } else if (editMode == "reference") {
                referenceBtn.classList.add('mode-active'); 
            } else if (editMode == "route") {
                routeBtn.classList.add('mode-active');
            }

        } else if (stateEditMode == "delete") {
            this.commitBuild();
            if (mode == editMode) {
                editMode = "";
            } else {
                editMode = mode;
                modeStep = 0;
            }
            if (editMode != "") {
                Graficos.editorFocus(true);
            } else {
                Graficos.editorFocus(false);
            }

            buildBtn.classList.remove('mode-active');
            referenceBtn.classList.remove('mode-active');
            routeBtn.classList.remove('mode-active');
            if (editMode == "build") {
                buildBtn.classList.add('mode-active'); 
            } else if (editMode == "reference") {
                referenceBtn.classList.add('mode-active'); 
            } else if (editMode == "route") {
                routeBtn.classList.add('mode-active');
            }
        }
    }
}

function handleBuildSubmit(event) {
    event.preventDefault();

    let buildName = document.getElementById('build-name').value;

    currBuild = new Editor.Building(buildName);
    nextStep();

    document.getElementById('buildModalOverlay').classList.remove('active');
    document.getElementById('buildForm').reset();
}

function handleConfirm(event) {
    Editor.Builder.buildings.push(currBuild);
    
    currBuild.generatePolygon();

    Actions.goToMode("");

    confirmBtn.classList.add("hidden");
}

export function addListeners(map) {
    map.addEventListener("pointerdown", Pointer.down);
    map.addEventListener("pointermove", Pointer.move);
    map.addEventListener("pointerup", Pointer.up);
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
        confirmBtn = document.getElementById("submit");
        addBtn = document.getElementById("add");
        editBtn = document.getElementById("edit");
        deleteBtn = document.getElementById("delete");
        
        const buildModalBtn = document.getElementById("buildFormSubmit");
        const buildOverlay = document.getElementById('buildModalOverlay');
        const buildCloseBtn = document.getElementById('closeBuildModal');

        const closeBuildModal = () => {
            document.getElementById('buildModalOverlay').classList.remove('active');
            document.getElementById('buildForm').reset();

            Actions.goToMode("");
        }

        buildCloseBtn.addEventListener('click', closeBuildModal);

        buildOverlay.addEventListener('click', (e) => {
            if (e.target === buildOverlay) {
                closeBuildModal();
            }
        });
        buildBtn.addEventListener("click", e => Actions.goToMode("build"));
        referenceBtn.addEventListener("click", e => Actions.goToMode("reference"));
        routeBtn.addEventListener("click", e => Actions.goToMode("route"));
        buildModalBtn.addEventListener("click", handleBuildSubmit);
        addBtn.addEventListener("click", e => Actions.goToEditionMode("add"));
        editBtn.addEventListener("click", e => Actions.goToEditionMode("edit"));
        deleteBtn.addEventListener("click", e => Actions.goToEditionMode("delete"));
        confirmBtn.addEventListener("click", handleConfirm);
    }
}
