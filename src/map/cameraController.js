/**
 * Navigation camera controller.
 *
 * Owns all camera state: pitch, bearing, zoom, padding, and easing.
 * app.js and map.js call into this; nothing outside reads camera state directly.
 *
 * NAV mode: low forward-looking driving perspective (Google Maps reference).
 *   User arrow anchors near the bottom of the screen (~78 % from top).
 *   Most useful screen space is the road ahead, not the area behind.
 * AIR mode: top-down north-up strategic overview.
 */

const CameraController = (() => {
  let _map = null;
  let _currentBearing = 0; // smoothed bearing, degrees

  // ---- Camera presets ----

  const _NAV_DEFAULTS = {
    pitch:               72,   // aggressive forward lean — windshield view
    zoom:                19,   // tight street-level zoom
    transitionMs:        900,
    followMs:            300,  // snappy continuous follow
    // Top-padding as fraction of container height.
    // 0.73 → user marker sits ~86 % from top — very low screen anchor.
    topPaddingFraction:  0.73,
    smoothAlpha:         0.13, // heading low-pass; lower = smoother/laggier
    lookAheadMeters:     120,  // project camera centre ahead of vehicle
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

  // Circular first-order low-pass — handles 0 / 360 wrap correctly.
  function _smoothBearing(target) {
    const cfg = _navConfig();
    let delta = target - _currentBearing;
    if (delta >  180) delta -= 360;
    if (delta < -180) delta += 360;
    _currentBearing = (_currentBearing + cfg.smoothAlpha * delta + 360) % 360;
    return _currentBearing;
  }

  // Project a point ahead of the vehicle along its heading.
  function _projectAhead(lat, lon, heading, meters) {
    if (!meters) return { lat, lon };
    const R   = 6371000;
    const d   = meters / R;
    const θ   = (heading * Math.PI) / 180;
    const φ1  = (lat * Math.PI) / 180;
    const λ1  = (lon * Math.PI) / 180;
    const φ2  = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
    const λ2  = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
    return { lat: φ2 * 180 / Math.PI, lon: λ2 * 180 / Math.PI };
  }

  // Cubic ease-out — fast start, gentle arrival. Good for continuous following.
  function _easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  // Cubic ease-in-out — smooth mode transitions.
  function _easeInOut(t) {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
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
    const target = _projectAhead(lat, lon, heading || _currentBearing, cfg.lookAheadMeters);
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
   * Applies heading smoothing to suppress GPS bearing jitter.
   */
  function followNav(lat, lon, heading) {
    if (!_map) return;
    const cfg    = _navConfig();
    const bear   = _smoothBearing(heading);
    const target = _projectAhead(lat, lon, bear, cfg.lookAheadMeters);
    _map.easeTo({
      center:   [target.lon, target.lat],
      bearing:  bear,
      pitch:    cfg.pitch,
      zoom:     cfg.zoom,
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
    const target = _projectAhead(lat, lon, heading, cfg.lookAheadMeters);
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
    getNavCameraDefaults,
    getNavCameraConfig,
    setNavCameraConfig,
    resetNavCameraConfig,
    refreshNavCamera,
  };
})();

if (typeof module !== "undefined") module.exports = CameraController;
