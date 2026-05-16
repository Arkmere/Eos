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
    pitch:               63,   // stronger forward lean than 60° — reduces "drone" feel
    zoom:                17,   // tighter zoom, road detail clearly visible
    transitionMs:        900,
    followMs:            400,  // snappier continuous follow
    // Top-padding as fraction of container height.
    // User renders at: 0.5 + topPaddingFraction/2 from top.
    // 0.55 → ~77.5 % from top — lower-centre driving anchor.
    topPaddingFraction:  0.55,
    smoothAlpha:         0.12, // slightly smoother bearing; lower = smoother/laggier
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
    _map.easeTo({
      center:   [lon, lat],
      bearing:  _currentBearing,
      pitch:    _navConfig().pitch,
      zoom:     _navConfig().zoom,
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
    const cfg = _navConfig();
    _map.easeTo({
      center:   [lon, lat],
      bearing:  _smoothBearing(heading),
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
    const cfg = _navConfig();
    _currentBearing = heading; // reset — don't interpolate from stale smoothed value
    _map.easeTo({
      center:   [lon, lat],
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
