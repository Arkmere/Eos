/**
 * Eos — main application controller.
 */

(function () {
  "use strict";

  // ---- State ----
  let mode = "nav"; // "nav" | "air"
  let userLat = null, userLon = null;
  let userHeading = 0;
  let userSpeedMph = 0;
  let aircraftList = [];
  let gpsWatchId = null;
  let fetchTimer = null;
  let lastFetchTime = null;
  let lastFetchError = null;

  // ---- Init ----

  function init() {
    AdsbExchangeClient.init(CONFIG);

    // Resolve initial theme before map init so the first render uses the
    // correct palette.  ThemeManager.init() also registers the OS media-query
    // listener for Auto mode.
    const initialTheme = ThemeManager.init(_onThemeChange);
    _applyThemeToDom(initialTheme);

    showConfigWarningIfNeeded();
    startGps();
    bindButtons();
    UI.setModeLabel("nav");
    UI.setAdsbStatus("error", "ADS-B");
    UI.setLoading(false);
  }

  // ---- Theme ----

  function _onThemeChange(theme) {
    EosMap.setTheme(theme);
    _applyThemeToDom(theme);
  }

  function _applyThemeToDom(theme) {
    document.body.dataset.theme = theme; // triggers CSS variable overrides

    // Update PWA status-bar colour
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "day" ? "#f5f3ee" : "#0e1117";

    // Reflect active state on theme buttons
    ["day", "auto", "night"].forEach(t => {
      const btn = document.getElementById(`btn-theme-${t}`);
      if (!btn) return;
      const active = (t === ThemeManager.getPreference());
      btn.classList.toggle("active-theme", active);
    });
  }

  function showConfigWarningIfNeeded() {
    if (!AdsbExchangeClient.isConfigured()) {
      UI.showConfigBanner(true);
      UI.setAdsbStatus("error", "ADS-B");
    }
  }

  // ---- GPS ----

  function startGps() {
    if (!navigator.geolocation) {
      UI.showGpsMessage(true);
      return;
    }

    navigator.geolocation.getCurrentPosition(onGpsSuccess, onGpsError, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 5000,
    });

    gpsWatchId = navigator.geolocation.watchPosition(onGpsSuccess, onGpsError, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 3000,
    });
  }

  function onGpsSuccess(pos) {
    UI.showGpsMessage(false);

    userLat = pos.coords.latitude;
    userLon = pos.coords.longitude;
    userSpeedMph = (pos.coords.speed || 0) * 2.23694;

    if (pos.coords.heading != null && !isNaN(pos.coords.heading)
        && userSpeedMph > CONFIG.GPS_HEADING_MIN_SPEED_MPH) {
      userHeading = pos.coords.heading;
    }

    if (!window._mapInitialised) {
      window._mapInitialised = true;
      // Pass the already-resolved theme so the first render is correct.
      EosMap.init("map", userLat, userLon, ThemeManager.getResolved());
      scheduleFetch();
    } else {
      EosMap.updateUserPosition(userLat, userLon, userHeading);
    }

    if (mode === "nav") refreshIndicators();
  }

  function onGpsError(err) {
    console.warn("GPS error:", err.message);
    if (userLat === null) {
      UI.showGpsMessage(true);
      if (!window._mapInitialised) {
        window._mapInitialised = true;
        EosMap.init("map", 51.5, -0.12, ThemeManager.getResolved());
      }
    }
  }

  // ---- Data fetch loop ----

  function scheduleFetch() {
    fetchAircraft();
    fetchTimer = setInterval(fetchAircraft, CONFIG.REFRESH_INTERVAL_SECONDS * 1000);
  }

  async function fetchAircraft() {
    if (userLat === null) return;

    UI.setLoading(true);
    const result = await AdsbExchangeClient.fetchNearby(userLat, userLon, CONFIG.DEFAULT_RANGE_NM);
    UI.setLoading(false);

    lastFetchTime = Date.now();
    lastFetchError = result.error;

    if (result.error) {
      if (result.error === "not_configured") {
        UI.setAdsbStatus("error", "ADS-B");
      } else if (result.error === "auth_failed") {
        UI.setAdsbStatus("error", "Auth error");
      } else {
        UI.setAdsbStatus("stale", "No data");
      }
    } else {
      UI.setAdsbStatus("active", "ADS-B");
      UI.showConfigBanner(false);
    }

    aircraftList = result.aircraft.filter(
      a => a.lastSeenSeconds < CONFIG.REMOVE_THRESHOLD_SECONDS
    );

    UI.setAircraftCount(aircraftList.length);

    if (mode === "nav") {
      refreshIndicators();
    } else {
      refreshAirMode();
    }
  }

  // ---- Driving view ----

  function refreshIndicators() {
    if (userLat === null) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const userState = {
      lat: userLat, lon: userLon,
      heading: userHeading,
      viewportWidth: vw,
      viewportHeight: vh,
    };

    const indicators = Indicators.build(
      aircraftList, userState,
      CONFIG.MAX_AIRCRAFT_SHOWN,
      CONFIG.STALE_THRESHOLD_SECONDS
    );

    UI.renderIndicators(indicators, onIndicatorClick);
  }

  function onIndicatorClick(ind) {
    UI.showPopup(ind);
  }

  // ---- Air mode ----

  function refreshAirMode() {
    if (userLat === null) return;
    EosMap.renderAirMarkers(aircraftList, userLat, userLon, onAirMarkerClick);
  }

  function onAirMarkerClick(aircraft, vis) {
    UI.showAirPopup(aircraft, vis);
  }

  // ---- Mode switching ----

  function setMode(newMode) {
    if (mode === newMode) return;
    mode = newMode;
    UI.setModeLabel(newMode);
    UI.hidePopup();

    EosMap.setMode(newMode, userLat, userLon, userHeading);

    if (newMode === "nav") {
      EosMap.clearAirMarkers();
      refreshIndicators();
    } else {
      UI.clearIndicators();
      refreshAirMode();
    }
  }

  // ---- Button bindings ----

  function bindButtons() {
    document.getElementById("btn-air")?.addEventListener("click", () => setMode("air"));
    document.getElementById("btn-nav")?.addEventListener("click", () => setMode("nav"));

    // Theme buttons
    ["day", "auto", "night"].forEach(t => {
      document.getElementById(`btn-theme-${t}`)?.addEventListener("click", () => {
        ThemeManager.setPreference(t);
        _applyThemeToDom(ThemeManager.getResolved());
      });
    });

    window.addEventListener("resize", () => {
      if (mode === "nav") refreshIndicators();
    });

    document.getElementById("map")?.addEventListener("click", () => UI.hidePopup());
  }

  // ---- Boot ----
  document.addEventListener("DOMContentLoaded", init);
})();
