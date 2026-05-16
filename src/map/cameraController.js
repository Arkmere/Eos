/**
 * Navigation camera controller.
 *
 * Owns all camera state: pitch, bearing, zoom, padding, and easing.
 * app.js and map.js call into this; nothing outside reads camera state directly.
 *
 * Camera states:
 *   NAV_IDLE         — NAV mode, no active route; heading-based look-ahead.
 *   NAV_ROUTE_ACTIVE — NAV mode, route loaded; camera follows route corridor.
 *   AIR              — top-down north-up strategic overview.
 *
 * NAV mode: low forward-looking driving perspective (Google Maps reference).
 *   User arrow anchors near the bottom of the screen (~78 % from top).
 *   Most useful screen space is the road ahead, not the area behind.
 */

const CameraController = (() => {
  let _map = null;
  let _currentBearing = 0; // smoothed bearing, degrees

  // Route state
  let _routeCoords    = null; // [lon,lat][] from active route geometry
  let _navCameraState = "NAV_IDLE"; // NAV_IDLE | NAV_ROUTE_ACTIVE | AIR

  // ---- Camera presets ----

  const _NAV_DEFAULTS = {
    pitch:                72,    // aggressive forward lean — windshield view
    zoom:                 18.5,  // tight street-level zoom
    transitionMs:         900,
    followMs:             300,   // snappy continuous follow
    // Top-padding as fraction of container height.
    // 0.73 → user marker sits ~86 % from top — very low screen anchor.
    topPaddingFraction:   0.73,
    smoothAlpha:          0.13,  // heading low-pass; lower = smoother/laggier
    lookAheadMeters:      120,   // heading-based look-ahead when no route
    routeLookAheadMeters: 300,   // base route look-ahead (scaled by speed)
    minLookAheadMeters:   80,
    maxLookAheadMeters:   1200,
  };

  const AIR = {
    pitch:        0,
    zoom:         10,
    transitionMs: 900,
  };

  let _devOverrides = {};

  function _navConfig() {
    return Object.assign({}, _NAV_DEFAULTS, _devOverrides);
  }

  // ---- Init ----

  function init(map) {
    _map = map;
  }

  // ---- Internal helpers ----

  function _containerH() {
    return _map ? _map.getContainer().clientHeight : 600;
  }

  function _navPadding() {
    const cfg = _navConfig();
    return {
      top:    Math.round(_containerH() * cfg.topPaddingFraction),
      bottom: 0,
      left:   0,
      right:  0,
    };
  }

  // Circular first-order low-pass — handles 0/360 wrap correctly.
  function _smoothBearing(target) {
    const cfg   = _navConfig();
    let delta   = target - _currentBearing;
    if (delta >  180) delta -= 360;
    if (delta < -180) delta += 360;
    _currentBearing = (_currentBearing + cfg.smoothAlpha * delta + 360) % 360;
    return _currentBearing;
  }

  // Project a point ahead of the vehicle along its heading (fallback when no route).
  function _projectAhead(lat, lon, heading, meters) {
    if (!meters) return { lat, lon };
    const R  = 6371000;
    const d  = meters / R;
    const θ  = (heading * Math.PI) / 180;
    const φ1 = (lat * Math.PI) / 180;
    const λ1 = (lon * Math.PI) / 180;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
    return { lat: φ2 * 180 / Math.PI, lon: λ2 * 180 / Math.PI };
  }

  // Dynamic look-ahead distance scaled to speed.
  // urban/low: 80-150 m  |  medium: 200-400 m  |  fast/motorway: 600-1200 m
  function _dynamicLookAhead(speedMph) {
    const cfg = _navConfig();
    if (!speedMph || speedMph < 3) return cfg.minLookAheadMeters;
    // 6-second time horizon scaled to speed
    const speedMs = speedMph * 0.44704;
    const raw     = speedMs * 6;
    return Math.max(cfg.minLookAheadMeters, Math.min(cfg.maxLookAheadMeters, raw));
  }

  // Camera centre target — route-aware when a route is active.
  function _cameraTarget(lat, lon, heading, speedMph) {
    const cfg = _navConfig();
    if (_routeCoords && _routeCoords.length >= 2) {
      const nearest   = RouteGeometry.nearestOnLine(_routeCoords, lon, lat);
      const lookAhead = _dynamicLookAhead(speedMph) || cfg.routeLookAheadMeters;
      const ahead     = RouteGeometry.projectAlong(_routeCoords, nearest.segIdx, nearest.t, lookAhead);
      if (ahead) return { lat: ahead.lat, lon: ahead.lon };
    }
    // Fallback: heading-based look-ahead
    return _projectAhead(lat, lon, heading, cfg.lookAheadMeters);
  }

  // Zoom level adapts to speed when a route is active — zoom out at highway speed.
  function _navZoom(speedMph) {
    const cfg = _navConfig();
    if (!_routeCoords || !speedMph || speedMph < 5) return cfg.zoom;
    const speedMs = speedMph * 0.44704;
    // Gradually zoom out up to 2.5 levels at ~90 mph / 40 m/s
    const offset  = Math.min(2.5, speedMs / 16);
    return Math.max(14, cfg.zoom - offset);
  }

  // Cubic ease-out — fast start, gentle arrival. Good for continuous following.
  function _easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  // Cubic ease-in-out — smooth mode transitions.
  function _easeInOut(t) {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // ---- Route state API ----

  function setRouteActive(geometry) {
    _routeCoords    = (geometry && geometry.coordinates) ? geometry.coordinates : null;
    _navCameraState = _routeCoords ? "NAV_ROUTE_ACTIVE" : "NAV_IDLE";
  }

  function clearRoute() {
    _routeCoords    = null;
    _navCameraState = "NAV_IDLE";
  }

  function getNavCameraState() {
    return _navCameraState;
  }

  // ---- Dev config API ----

  function getNavCameraDefaults() {
    return Object.assign({}, _NAV_DEFAULTS);
  }

  function getNavCameraConfig() {
    return _navConfig();
  }

  function setNavCameraConfig(partial) {
    Object.assign(_devOverrides, partial);
  }

  function resetNavCameraConfig() {
    _devOverrides = {};
  }

  /**
   * Immediately apply current NAV config to the map at the given position.
   * duration defaults to 0 (instant) so slider drags feel live.
   */
  function refreshNavCamera(lat, lon, heading, duration) {
    if (!_map) return;
    const cfg    = _navConfig();
    const target = _cameraTarget(lat, lon, heading || _currentBearing, 0);
    _map.easeTo({
      center:   [target.lon, target.lat],
      bearing:  _currentBearing,
      pitch:    cfg.pitch,
      zoom:     cfg.zoom,
      padding:  _navPadding(),
      duration: duration !== undefined ? duration : 0,
    });
  }

  // ---- Public API ----

  /**
   * Smooth camera follow called on each GPS position update in NAV mode.
   * Applies heading smoothing and route-aware camera targeting.
   * @param {number} speedMph  Optional — enables dynamic look-ahead scaling.
   */
  function followNav(lat, lon, heading, speedMph) {
    if (!_map) return;
    const cfg    = _navConfig();
    const bear   = _smoothBearing(heading);
    const target = _cameraTarget(lat, lon, bear, speedMph);
    _map.easeTo({
      center:   [target.lon, target.lat],
      bearing:  bear,
      pitch:    cfg.pitch,
      zoom:     _navZoom(speedMph),
      padding:  _navPadding(),
      duration: cfg.followMs,
      easing:   _easeOut,
    });
  }

  /**
   * Animated transition INTO NAV mode (e.g. from AIR).
   * Resets bearing smoothing to avoid a spin from the last smoothed value.
   */
  function transitionToNav(lat, lon, heading) {
    if (!_map) return;
    const cfg    = _navConfig();
    _currentBearing = heading; // reset — don't interpolate from stale smoothed value
    _navCameraState  = _routeCoords ? "NAV_ROUTE_ACTIVE" : "NAV_IDLE";
    const target = _cameraTarget(lat, lon, heading, 0);
    _map.easeTo({
      center:   [target.lon, target.lat],
      bearing:  heading,
      pitch:    cfg.pitch,
      zoom:     cfg.zoom,
      padding:  _navPadding(),
      duration: cfg.transitionMs,
      easing:   _easeInOut,
    });
  }

  /**
   * Animated transition INTO AIR mode (e.g. from NAV).
   * Resets to north-up, top-down, wider zoom.
   */
  function transitionToAir(lat, lon) {
    if (!_map) return;
    _navCameraState = "AIR";
    _map.easeTo({
      center:   [lon, lat],
      bearing:  0,
      pitch:    AIR.pitch,
      zoom:     AIR.zoom,
      padding:  { top: 0, bottom: 0, left: 0, right: 0 },
      duration: AIR.transitionMs,
      easing:   _easeInOut,
    });
  }

  return {
    init,
    followNav,
    transitionToNav,
    transitionToAir,
    setRouteActive,
    clearRoute,
    getNavCameraState,
    getNavCameraDefaults,
    getNavCameraConfig,
    setNavCameraConfig,
    resetNavCameraConfig,
    refreshNavCamera,
  };
})();

if (typeof module !== "undefined") module.exports = CameraController;
