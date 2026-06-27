export function getUnionPolygonVertices(boxes) {
    if (!boxes || boxes.length === 0) return [];

    const allX = [];
    const allY = [];
    for (let i = 0; i < boxes.length; i++) {
        allX.push(boxes[i][0], boxes[i][2]);
        allY.push(boxes[i][1], boxes[i][3]);
    }
    
    const xCoords = Array.from(new Set(allX)).sort((a, b) => a - b);
    const yCoords = Array.from(new Set(allY)).sort((a, b) => a - b);

    const isInside = (x, y) => {
        for (let i = 0; i < boxes.length; i++) {
            const b = boxes[i];
            if (x > b[0] && x < b[2] && y > b[1] && y < b[3]) return true;
        }
        return false;
    };

    const segments = [];

    for (let i = 0; i < xCoords.length - 1; i++) {
        for (let j = 0; j < yCoords.length - 1; j++) {
            const x1 = xCoords[i], x2 = xCoords[i+1];
            const y1 = yCoords[j], y2 = yCoords[j+1];
            const cx = (x1 + x2) / 2;
            const cy = (y1 + y2) / 2;

            if (isInside(cx, cy)) {
                
                if (!isInside(cx, y1 - 0.001)) segments.push([[x2, y1], [x1, y1]]);
                if (!isInside(cx, y2 + 0.001)) segments.push([[x1, y2], [x2, y2]]);
                if (!isInside(x1 - 0.001, cy)) segments.push([[x1, y1], [x1, y2]]);
                if (!isInside(x2 + 0.001, cy)) segments.push([[x2, y2], [x2, y1]]);
            }
        }
    }

    const adjMap = new Map();
    for (let i = 0; i < segments.length; i++) {
        const startPt = segments[i][0];
        const endPt = segments[i][1];
        const key = startPt[0] + "," + startPt[1];
        
        if (!adjMap.has(key)) {
            adjMap.set(key, []);
        }
        adjMap.get(key).push(endPt);
    }

    const polygons = [];

    while (adjMap.size > 0) {
        const startKey = adjMap.keys().next().value;
        let currentKey = startKey;
        const rawPath = [];

        while (true) {
            const coords = currentKey.split(",");
            const cx = Number(coords[0]);
            const cy = Number(coords[1]);
            rawPath.push([cx, cy]);

            const nextOptions = adjMap.get(currentKey);
            if (!nextOptions || nextOptions.length === 0) {
                adjMap.delete(currentKey);
                break;
            }

            const nextPt = nextOptions.pop();
            if (nextOptions.length === 0) {
                adjMap.delete(currentKey);
            }

            const nextKey = nextPt[0] + "," + nextPt[1];
            if (nextKey === startKey) {
                break;
            }
            currentKey = nextKey;
        }

        if (rawPath.length > 2) {
            const cleanedPath = [];
            for (let i = 0; i < rawPath.length; i++) {
                const prev = rawPath[(i - 1 + rawPath.length) % rawPath.length];
                const curr = rawPath[i];
                const next = rawPath[(i + 1) % rawPath.length];

                const isHorizontalLine = (prev[1] === curr[1] && curr[1] === next[1]);
                const isVerticalLine = (prev[0] === curr[0] && curr[0] === next[0]);

                if (isHorizontalLine || isVerticalLine) {
                    continue; 
                }
                cleanedPath.push(curr);
            }

            if (cleanedPath.length > 2) {
                cleanedPath.push([cleanedPath[0][0], cleanedPath[0][1]]);
                polygons.push(cleanedPath);
            }
        }
    }

    return polygons;
}