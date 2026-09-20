import * as Graficos from "./graficos.js";
import * as Interacao from "./interacao.js";
import * as Localizacao from "./localizacao.js";

async function load() {
  try {
        const response = await fetch(URLSaveMap);
        if (!response.ok) throw new Error('Erro de rede');
        const data = await response.json();
        
        let pins = {};
        for(const buildKey of Object.keys(data.buildings)) {
            let build = data.buildings[buildKey];
            let gfx = Graficos.newPin(build.pin_pos.x, build.pin_pos.y, build.name);
            pins[buildKey] = {text: build.name, x: build.pin_pos.x, y: build.pin_pos.y, gfx: gfx.pin, label: gfx.label};
        }

        let bannerMap = {};
        for(const bannerKey of Object.keys(data.banners)) {
            let banner = data.banners[bannerKey];
            bannerMap[bannerKey] = {"title": banner.title, "description": banner.description, "image": banner.imageUrl};
        }
        return {"pinMap": pins, "bannerMap": bannerMap};

    } catch (error) {
        console.error('Fetch error:', error);
    }
}

fetch(config)
.then(response => response.json())
.then(async (data) => { // 1. Added async here
    data.page = "main";

    Graficos.setContext(data);
    
    await Graficos.main();
    
    Interacao.setContext(data);
    Interacao.addListeners(Graficos.map);
    Localizacao.UserLocation();

    let mapData = await load(); 
    Interacao.setMaps(mapData);

    Graficos.loadMapScales();
})
.catch(error => console.error('Falha ao carregar JSON:', error));