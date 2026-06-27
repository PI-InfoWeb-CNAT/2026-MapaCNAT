import * as Graficos from "./graficos.js";
import * as Interacao from "./interacao.js";
import * as Geometria from "./geometria.js";

fetch(config)
.then(response => response.json())
.then(data => {
    data.page = "editor";
    
    Graficos.setContext(data);
    Graficos.main().then(() => {
        Interacao.setContext(data);
        Interacao.addListeners(Graficos.map);
    });
    Graficos.loadMapScales();
})
.catch(error => console.error('Falha ao carregar JSON:', error));