const buildIcon = document.getElementById("build");
const referenceIcon = document.getElementById("reference");
const routeIcon = document.getElementById("route");

let confirmStep = document.getElementById("submit");

let mode;
let modeStep;
let buildName;
let buildCoordinates;
let stepSquares = [];

let buildings = [];

function addBuild() {
    if (!mode == "") {
        return;
    }

    mode = "build";
    modeStep = 0;
    const overlay = document.getElementById('buildModalOverlay');
    overlay.classList.add('active');
}

function nextStep() {
    if (mode == "build") {
        if (modeStep == 0) {
            map.classList.remove("custom-cursor");
        }
    }
    modeStep += 1;
}

class Polygon {
    constructor(points) {
        this.points = points;
    }
}

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
    polygons = getUnionPolygonVertices(boxes);
    return polygons;
}

function confirmObject() {
    if (mode == "build") {
        if (modeStep == 1) {
            let buildArea = polygonUnion(stepSquares);
            buildings.push(new Building(buildName, buildCoordinates, buildArea));

            confirmStep.classList.add("hidden");
            mode = "";
            modeStep = 0;
        }
    }
}

class Building {
    constructor(name, coordinates, area) {
        this.name = name;
        this.coordinates = coordinates;
        this.area = area;
        this.graphics = false;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('buildModalOverlay');
    const closeBtn = document.getElementById('closeBuildModal');

    closeBtn.addEventListener('click', () => {
        overlay.classList.remove('active');
    });

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.classList.remove('active');
        }
    });
});

function handleBuildSubmit(event) {
    event.preventDefault();
    
    buildName = document.getElementById('build-name').value;

    document.getElementById('buildModalOverlay').classList.remove('active');
    document.getElementById('buildForm').reset();

    map.classList.add("custom-cursor");
}