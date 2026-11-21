import * as Graficos from "../graficos.js";
import * as Interacao from "../interacao.js";
import * as Editor from "../objects.js";
import * as Actions from "./action.js";

fetch(config)
.then(response => response.json())
.then(data => {
    data.page = "editor";

    Graficos.setContext(data);
    Editor.setContext(data);
    Graficos.main().then(async () => {
        Interacao.setContext(data);
        await Interacao.addListeners(Graficos.map);
        data.mapObj = Graficos.map;
        Actions.setContext(data);
    });
    Graficos.loadMapScales();
})
.catch(error => console.error('Falha ao carregar JSON:', error));