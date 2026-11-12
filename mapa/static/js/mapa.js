import * as Graficos from "./graficos.js";
import * as Interacao from "./interacao.js";
import * as Localizacao from "./localizacao.js";
import * as Editor from "./editor.js";

fetch(config)
.then(response => response.json())
.then(async (data) => {
    data.page = "main";

    Graficos.setContext(data);
    Editor.setContext(data);

    await Graficos.main();
    
    Interacao.setContext(data);
    await Interacao.addListeners(Graficos.map);
    Localizacao.UserLocation();

    Graficos.loadMapScales();

    if (window.initialCoordinates) {
        const { x, y } = window.initialCoordinates;

        setTimeout(() => {
            const targetZoom = 2.0;
            Graficos.setZoom(targetZoom);

            const targetPos = Graficos.getContainerPosForPoint({ x, y });
            Graficos.setPosition(targetPos.x, targetPos.y);

            const marcador = Graficos.createPin(`(${x}, ${y})`);
            marcador.x = x;
            marcador.y = y;

            console.log("Posição aplicada:", { x, y, targetPos, imageSize: Graficos.imageSize });
        }, 300);
    }

    const shareBtn = document.getElementById("share-location-btn");
    if (shareBtn) {
        shareBtn.addEventListener("click", () => {
            let currentX = 0;
            let currentY = 0;

            if (window.currentPlaceCoords) {
                currentX = Math.round(window.currentPlaceCoords.x);
                currentY = Math.round(window.currentPlaceCoords.y);
            } else if (Graficos.mapContainer) {
                const centerScreen = {
                    x: window.innerWidth / 2,
                    y: window.innerHeight / 2
                };
                const worldCoords = Graficos.getNormalizedCoordinates(centerScreen);
                currentX = Math.round(worldCoords.x);
                currentY = Math.round(worldCoords.y);
            }

            const shareUrl = `${window.location.origin}${window.location.pathname}?x=${currentX}&y=${currentY}`;

            navigator.clipboard.writeText(shareUrl).then(() => {
                alert("Link de localização copiado:\n" + shareUrl);
            }).catch(err => {
                console.error("Erro ao copiar o link:", err);
            });
        });
    }
})
.catch(error => console.error('Falha ao carregar JSON:', error));