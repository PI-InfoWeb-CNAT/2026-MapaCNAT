import * as Graficos from "./graficos.js";
import * as Interacao from "./interacao.js";
import * as Editor from "./editor.js";

fetch(config)
.then(response => response.json())
.then(data => {
    data.page = "editor";

    Graficos.setContext(data);
    Editor.setContext(data);
    Graficos.main().then(async () => {
        Interacao.setContext(data);
        await Interacao.addListeners(Graficos.map);
    });
    Graficos.loadMapScales();
})
.catch(error => console.error('Falha ao carregar JSON:', error));