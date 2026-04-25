export function decodePolyline(encodedPolyline) {
    if (typeof encodedPolyline !== 'string' || encodedPolyline.length === 0) {
        return [];
    }

    const path = [];
    let index = 0;
    let latitude = 0;
    let longitude = 0;

    while (index < encodedPolyline.length) {
        let shift = 0;
        let result = 0;
        let byte;

        do {
            if (index >= encodedPolyline.length) {
                return path;
            }

            byte = encodedPolyline.charCodeAt(index) - 63;
            index += 1;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);

        const latitudeChange = result & 1 ? ~(result >> 1) : result >> 1;
        latitude += latitudeChange;

        shift = 0;
        result = 0;

        do {
            if (index >= encodedPolyline.length) {
                return path;
            }

            byte = encodedPolyline.charCodeAt(index) - 63;
            index += 1;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);

        const longitudeChange = result & 1 ? ~(result >> 1) : result >> 1;
        longitude += longitudeChange;

        path.push({
            lat: latitude / 1e5,
            lng: longitude / 1e5,
        });
    }

    return path;
}

function getDistance(p1, p2) {
    const R = 6371000; // Earth radius in meters
    const dLat = (p2.lat - p1.lat) * Math.PI / 180;
    const dLon = (p2.lng - p1.lng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) * 
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

export function segmentRoute(decodedPoints, targetKm = 15) {
    if (!decodedPoints || decodedPoints.length < 2) return [];
    
    const targetMeters = targetKm * 1000;
    const segments = [];
    let currentSegment = [];
    let accumulatedDistance = 0;

    for (let i = 0; i < decodedPoints.length - 1; i++) {
        const p1 = decodedPoints[i];
        const p2 = decodedPoints[i + 1];
        const dist = getDistance(p1, p2);

        if (currentSegment.length === 0) {
            currentSegment.push(p1);
        }

        currentSegment.push(p2);
        accumulatedDistance += dist;

        if (accumulatedDistance >= targetMeters) {
            segments.push({
                points: [...currentSegment],
                distance: accumulatedDistance,
                start_lat: currentSegment[0].lat,
                start_lng: currentSegment[0].lng,
                end_lat: p2.lat,
                end_lng: p2.lng
            });
            
            // Overlap p2 to ensure no gaps
            currentSegment = [p2];
            accumulatedDistance = 0;
        }
    }
    
    // Catch the final remaining segment
    if (currentSegment.length > 1) {
        segments.push({ 
            points: currentSegment, 
            distance: accumulatedDistance,
            start_lat: currentSegment[0].lat,
            start_lng: currentSegment[0].lng,
            end_lat: currentSegment[currentSegment.length - 1].lat,
            end_lng: currentSegment[currentSegment.length - 1].lng
        });
    }

    return segments;
}
