import { MatrixTransform } from "./transformacao.js";
import * as Graficos from "./graficos.js";

let coordinateTransform;

function success(position) {
    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;
    const accuracy = position.coords.accuracy;
    let point = coordinateTransform.transform([latitude, longitude]);
    
    Graficos.setPinPosition(point[0], point[1]);
    Graficos.showPin(true);
}

function error(err) {
    console.warn(`ERROR(${err.code}): ${err.message}`);
    Graficos.showPin(false);
}

export function UserLocation() {
    if (!navigator.geolocation) {
        console.error("Geolocalização não é suportada pelo dispositivo.");
        return;
    }

    coordinateTransform = new MatrixTransform(
        [-5.811105868698768, -35.201445594283136],
        [-5.810082771429163, -35.204026579227964],
        [-5.812708592957059, -35.20497480931187],
    
        [-Graficos.imageSize.width / 2, -Graficos.imageSize.height / 2],
        [-Graficos.imageSize.width / 2, Graficos.imageSize.height / 2],
        [Graficos.imageSize.width / 2, Graficos.imageSize.height / 2]
    );

    const options = {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0
    };

    navigator.geolocation.watchPosition(success, error, options);
}