const buildIcon = document.getElementById("build");
const referenceIcon = document.getElementById("reference");
const routeIcon = document.getElementById("route");

let mode;
let modeStep;

function addBuild() {
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
    
    const name = document.getElementById('build-name').value;

    document.getElementById('buildModalOverlay').classList.remove('active');
    document.getElementById('buildForm').reset();

    map.classList.add("custom-cursor");
}