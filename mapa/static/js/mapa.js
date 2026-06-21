import * as Graficos from "./graficos.js";
import * as Interacao from "./interacao.js";
import * as Localizacao from "./localizacao.js";

fetch(config)
.then(response => response.json())
.then(data => {
    Graficos.setContext(data);
    Graficos.main().then(() => {
        Interacao.setContext(data);
        Interacao.addListeners(Graficos.map);

        for (const label of data.labels) {
            Graficos.nodeText(label.text, { x: label.x, y: label.y });
        }

        Localizacao.UserLocation();
    });
    Graficos.loadMapScales();
})
.catch(error => console.error('Falha ao carregar JSON:', error));