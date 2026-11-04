import * as Graficos from "./graficos.js";
import * as Interacao from "./interacao.js";
import * as Localizacao from "./localizacao.js";

fetch(config)
.then(response => response.json())
.then(async (data) => {
    data.page = "main";

    Graficos.setContext(data);
    
    await Graficos.main();
    
    Interacao.setContext(data);
    Interacao.addListeners(Graficos.map);
    Localizacao.UserLocation();

    Graficos.loadMapScales();
})
.catch(error => console.error('Falha ao carregar JSON:', error));