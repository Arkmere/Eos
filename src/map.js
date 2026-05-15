/**
 * MapLibre GL JS map — replaces the Leaflet renderer.
 *
 * Public interface is unchanged from the Leaflet version so app.js
 * requires only minimal edits (heading param on updateUserPosition,
 * lat/lon/heading params on setMode).
 */

const EosMap = (() => {
  let _map        = null;
  let _userMarker = null;
  let _airMarkers = [];
  let _mode       = "nav";
  let _heading    = 0;

  // CARTO dark raster style — no API key required.
  // Raster tiles work with MapLibre pitch: the tile plane tilts in 3D space;
  // the gap above the horizon shows the body background (#0e1117) as sky.
  const MAP_STYLE = {
    version: 8,
    sources: {
      "carto-dark": {
        type:       "raster",
        tiles: [
          "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
          "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
          "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
          "https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
        ],
        tileSize:   512,
        maxzoom:    19,
        attribution: '© <a href="https://carto.com/">CARTO</a> © <a href="https://www.openstreetmap.org/copyright">OSM</a>',
      },
    },
    layers: [
      {
        id:      "carto-dark-layer",
        type:    "raster",
        source:  "carto-dark",
        minzoom: 0,
        maxzoom: 20,
      },
    ],
  };

  // ---- Init ----

  function init(containerId, lat, lon) {
    _map = new maplibregl.Map({
      container:        containerId,
      style:            MAP_STYLE,
      center:           [lon, lat],
      zoom:             16,
      pitch:            60,
      bearing:          0,
      attributionControl: false,
      pitchWithRotate:  true,
      touchPitch:       false, // disable two-finger pitch in NAV (camera controller owns pitch)
    });

    _map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right"
    );

    _map.on("load", () => {
      CameraController.init(_map);
      // Apply initial NAV camera once the map is ready
      CameraController.followNav(lat, lon, 0);
    });

    _userMarker = _createUserMarker(lat, lon);
    return _map;
  }

  // ---- User marker ----

  function _createUserMarker(lat, lon) {
    const el = document.createElement("div");
    el.className = "user-marker";
    el.innerHTML = `
      <div class="user-marker-halo"></div>
      <svg class="user-marker-nav" viewBox="0 0 20 28" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 1 L19 27 L10 21 L1 27 Z"
              fill="#58a6ff" stroke="#ffffff" stroke-width="1.5"
              stroke-linejoin="round"/>
      </svg>`;

    // pitchAlignment viewport (default): marker stays flat against screen
    // regardless of map pitch — exactly what a navigation arrow needs.
    return new maplibregl.Marker({ element: el, anchor: "center" })
      .setLngLat([lon, lat])
      .addTo(_map);
  }

  function _updateArrow(mode, heading) {
    const el = _userMarker?.getElement();
    const svg = el?.querySelector(".user-marker-nav");
    if (!svg) return;
    // NAV: map rotates to match heading; arrow always points "up" = ahead.
    // AIR: map is north-up; rotate arrow to show heading relative to north.
    svg.style.transform = mode === "air"
      ? `rotate(${heading}deg)`
      : "rotate(0deg)";
  }

  // ---- Public API ----

  /**
   * Called on every GPS position fix.
   * Moves the user marker and advances the NAV camera follow.
   */
  function updateUserPosition(lat, lon, heading) {
    if (!_map) return;
    _heading = heading ?? _heading;
    _userMarker.setLngLat([lon, lat]);
    _updateArrow(_mode, _heading);
    if (_mode === "nav") CameraController.followNav(lat, lon, _heading);
  }

  /**
   * Switch between "nav" and "air" modes.
   * Triggers an animated camera transition and updates the user arrow.
   * lat/lon/heading are the current user state — needed for the transition target.
   */
  function setMode(mode, lat, lon, heading) {
    _mode    = mode;
    _heading = heading ?? _heading;
    _updateArrow(_mode, _heading);

    if (mode === "nav") {
      if (lat != null) CameraController.transitionToNav(lat, lon, _heading);
    } else {
      if (lat != null) CameraController.transitionToAir(lat, lon);
    }
  }

  function getMap() { return _map; }

  // ---- AIR mode aircraft markers ----

  function renderAirMarkers(aircraftList, userLat, userLon, onClickFn) {
    clearAirMarkers();
    aircraftList.forEach(a => {
      const vis = Visibility.estimate(userLat, userLon, a);
      const el  = document.createElement("div");
      el.className = "air-marker";
      el.innerHTML = _airMarkerHtml(a, vis);
      el.addEventListener("click", () => onClickFn(a, vis));

      const m = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([a.lon, a.lat])
        .addTo(_map);
      _airMarkers.push(m);
    });
  }

  function _airMarkerHtml(aircraft, vis) {
    const callsign = aircraft.callsign || aircraft.hex;
    const type     = aircraft.type || "";
    const rot      = aircraft.trackDeg != null ? aircraft.trackDeg : 0;
    return `
      <div class="air-marker-inner">
        <div class="air-icon" style="color:${vis.color};transform:rotate(${rot}deg)">✈</div>
        <div class="air-label-box">
          <div class="callsign" style="color:${vis.color}">${callsign}</div>
          ${type ? `<div class="actype">${type}</div>` : ""}
        </div>
      </div>`;
  }

  function clearAirMarkers() {
    _airMarkers.forEach(m => m.remove());
    _airMarkers = [];
  }

  // Kept for interface compatibility; camera transitions are normally owned by setMode.
  function flyTo(lat, lon, zoom) {
    if (_map) _map.easeTo({ center: [lon, lat], zoom, duration: 800 });
  }

  return { init, updateUserPosition, setMode, getMap, renderAirMarkers, clearAirMarkers, flyTo };
})();

if (typeof module !== "undefined") module.exports = EosMap;
