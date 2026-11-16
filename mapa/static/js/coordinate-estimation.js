function analyzeMapCalibration(mapCoordinates) {
    if (!Array.isArray(mapCoordinates) || mapCoordinates.length < 2) {
        throw new Error("At least 2 calibration points are required.");
    }

    const EARTH_RADIUS_METERS = 6371000;
    const toRad = (deg) => (deg * Math.PI) / 180;

    const points = mapCoordinates.map((item, index) => {
        const geo = Array.isArray(item.geo)
            ? { lat: Number(item.geo[0]), lon: Number(item.geo[1]) }
            : { lat: Number(item.lat), lon: Number(item.lon) };

        const svg = Array.isArray(item.svg)
            ? { x: Number(item.svg[0]), y: Number(item.svg[1]) }
            : { x: Number(item.x), y: Number(item.y) };

        if (
            !Number.isFinite(geo.lat) || !Number.isFinite(geo.lon) ||
            !Number.isFinite(svg.x) || !Number.isFinite(svg.y)
        ) {
            throw new Error(`Invalid coordinates at index ${index}`);
        }

        return { index, geo, svg, raw: item };
    });

    const haversineMeters = (a, b) => {
        const dLat = toRad(b.lat - a.lat);
        const dLon = toRad(b.lon - a.lon);
        const sinLat = Math.sin(dLat / 2);
        const sinLon = Math.sin(dLon / 2);
        const h =
            sinLat * sinLat +
            Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLon * sinLon;
        return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    };

    const svgDistance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

    // Traverse all unique pairs
    const pairs = [];
    let farthestPair = null;

    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            const pA = points[i];
            const pB = points[j];

            const meters = haversineMeters(pA.geo, pB.geo);
            const svgUnits = svgDistance(pA.svg, pB.svg);

            if (svgUnits === 0) {
                throw new Error(`Duplicate SVG coordinates between index ${i} and ${j}`);
            }

            const pairMetrics = {
                indices: [pA.index, pB.index],
                from: pA.raw,
                to: pB.raw,
                meters,
                svgUnits,
                metersPerUnit: meters / svgUnits,
                unitsPerMeter: svgUnits / meters,
            };

            pairs.push(pairMetrics);

            if (!farthestPair || meters > farthestPair.meters) {
                farthestPair = pairMetrics;
            }
        }
    }

    // Aggregate scale stats across all pairs (useful to detect distortion or misclicks)
    const ratios = pairs.map((p) => p.metersPerUnit);
    const avgMetersPerUnit = ratios.reduce((sum, r) => sum + r, 0) / ratios.length;
    const minMetersPerUnit = Math.min(...ratios);
    const maxMetersPerUnit = Math.max(...ratios);

    // Primary conversion factors anchored on the longest baseline (most accurate)
    const { meters, svgUnits, metersPerUnit, unitsPerMeter } = farthestPair;

    return {
        // Primary baseline (the two geographically farthest dots)
        farthestPair: {
            indices: farthestPair.indices,
            from: farthestPair.from,
            to: farthestPair.to,
            meters,
            svgUnits,
            metersPerUnit,
            unitsPerMeter,
        },

        // Direct top-level shortcuts
        meters,
        svgUnits,
        metersPerUnit,
        unitsPerMeter,

        // Scale consistency across all calibration pairs
        scaleStats: {
            pairCount: pairs.length,
            avgMetersPerUnit,
            minMetersPerUnit,
            maxMetersPerUnit,
            maxVariancePercent:
                avgMetersPerUnit > 0
                    ? ((maxMetersPerUnit - minMetersPerUnit) / avgMetersPerUnit) * 100
                    : 0,
        },

        // All evaluated pairs sorted from longest to shortest
        allPairs: pairs.sort((a, b) => b.meters - a.meters),

        // Ready-to-use conversion helpers
        toSvgUnits: (distanceInMeters) => distanceInMeters * unitsPerMeter,
        toMeters: (distanceInSvgUnits) => distanceInSvgUnits * metersPerUnit,
    };
}