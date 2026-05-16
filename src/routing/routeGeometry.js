/**
 * Route polyline geometry utilities.
 *
 * All coordinate inputs/outputs use [lon, lat] GeoJSON convention.
 */
const RouteGeometry = (() => {
  const R = 6371000; // Earth radius in metres

  function _toRad(d) { return d * Math.PI / 180; }

  // Haversine distance in metres between two [lon, lat] points.
  function _dist(a, b) {
    const dLat = _toRad(b[1] - a[1]);
    const dLon = _toRad(b[0] - a[0]);
    const s    = Math.sin(dLat / 2);
    const o    = Math.sin(dLon / 2);
    const h    = s * s + Math.cos(_toRad(a[1])) * Math.cos(_toRad(b[1])) * o * o;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // Nearest point on segment [a, b] to point p.
  // Uses planar approximation — accurate enough for short driving segments.
  function _nearestOnSegment(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return { t: 0, point: a.slice() };
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return { t, point: [a[0] + t * dx, a[1] + t * dy] };
  }

  /**
   * Find nearest point on a GeoJSON LineString to the given position.
   * @param {number[][]} coords  Array of [lon, lat] pairs from LineString.coordinates
   * @param {number}     lon
   * @param {number}     lat
   * @returns {{ segIdx: number, t: number, point: number[] }}
   */
  function nearestOnLine(coords, lon, lat) {
    const p = [lon, lat];
    let bestDist = Infinity, bestSeg = 0, bestT = 0, bestPt = coords[0];
    for (let i = 0; i < coords.length - 1; i++) {
      const { t, point } = _nearestOnSegment(p, coords[i], coords[i + 1]);
      const d = _dist(p, point);
      if (d < bestDist) {
        bestDist = d;
        bestSeg  = i;
        bestT    = t;
        bestPt   = point;
      }
    }
    return { segIdx: bestSeg, t: bestT, point: bestPt };
  }

  /**
   * Project forward along the route from a given position by `meters`.
   * @param {number[][]} coords   LineString coordinate array
   * @param {number}     segIdx   Segment index (from nearestOnLine)
   * @param {number}     t        Parameter within segment [0, 1]
   * @param {number}     meters   Distance to project ahead
   * @returns {{ lon: number, lat: number }}
   */
  function projectAlong(coords, segIdx, t, meters) {
    if (!coords || coords.length < 2) return null;

    const a = coords[segIdx];
    const b = coords[Math.min(segIdx + 1, coords.length - 1)];

    // Current position within this segment
    const curLon = a[0] + t * (b[0] - a[0]);
    const curLat = a[1] + t * (b[1] - a[1]);

    // Remaining metres to end of current segment
    const segRemain = _dist([curLon, curLat], b);

    if (meters <= segRemain || segIdx + 1 >= coords.length - 1) {
      const frac = meters / Math.max(segRemain, 0.001);
      return {
        lon: curLon + frac * (b[0] - curLon),
        lat: curLat + frac * (b[1] - curLat),
      };
    }

    let remaining = meters - segRemain;

    for (let i = segIdx + 1; i < coords.length - 1; i++) {
      const segLen = _dist(coords[i], coords[i + 1]);
      if (remaining <= segLen) {
        const frac = remaining / Math.max(segLen, 0.001);
        return {
          lon: coords[i][0] + frac * (coords[i + 1][0] - coords[i][0]),
          lat: coords[i][1] + frac * (coords[i + 1][1] - coords[i][1]),
        };
      }
      remaining -= segLen;
    }

    // Past end of route — clamp to final coordinate.
    const last = coords[coords.length - 1];
    return { lon: last[0], lat: last[1] };
  }

  return { nearestOnLine, projectAlong };
})();

if (typeof module !== "undefined") module.exports = RouteGeometry;
