import * as Graficos from "./graficos.js";
import * as Interacao from "./interacao.js";
import * as Localizacao from "./localizacao.js";

async function load() {
  try {
        const response = await fetch(URLSaveMap);
        if (!response.ok) throw new Error('Erro de rede');
        const data = await response.json();
        
        // let refMap = {}

        // for(const key of Object.keys(data.references)) {
            // let ref = data.references[key];
            // let objRef = Referencer.createReference(ref.pos.x, ref.pos.y, false);
            // refMap[key] = objRef;
        // }
        // for(const conn of data.connections) {
        //     Connections.createConnection(refMap[conn[0]], refMap[conn[1]]);
        // }
        for(const build of data.buildings) {
            // build.name,
            // build.pin_pos,
            Graficos.newPin(build.pin_pos.x, build.pin_pos.y, build.name);
        //     let regions = [];
        //     for(const area of build.areas) {
        //         let end = {
        //             x: area.pos.x + area.size.x,
        //             y: area.pos.y + area.size.y,
        //         }
        //         let reg = Builder.createRegionObject({start: area.pos, end: end});
        //         regions.push(reg);
        //     }
            // let building = Builder.createConstruction({
            
            //     regions: regions
            // })
            // Builder.convertGraphical(building, "polygon");
        }

    } catch (error) {
        console.error('Fetch error:', error);
    }
}

fetch(config)
.then(response => response.json())
.then(data => {
    data.page = "main";

    Graficos.setContext(data);
    Graficos.main().then(() => {
        Interacao.setContext(data);
        Interacao.addListeners(Graficos.map);
        Localizacao.UserLocation();
        load();
    });
    Graficos.loadMapScales();

})
.catch(error => console.error('Falha ao carregar JSON:', error));