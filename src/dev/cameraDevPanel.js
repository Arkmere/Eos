const CameraDevPanel = (() => {
  const STORAGE_KEY = 'eos-camera-dev';

  let _visible = false;
  let _panel   = null;
  let _toggleBtn = null;
  let _getCurrentNavState = null;

  const FIELDS = [
    { key: 'pitch',                label: 'Pitch',             min: 45,   max: 80,   step: 1,    dec: 0 },
    { key: 'zoom',                 label: 'Zoom',              min: 14,   max: 21,   step: 0.1,  dec: 1 },
    { key: 'topPaddingFraction',   label: 'Top padding',       min: 0.30, max: 0.85, step: 0.01, dec: 2 },
    { key: 'followMs',             label: 'Follow ms',         min: 100,  max: 1200, step: 10,   dec: 0 },
    { key: 'smoothAlpha',          label: 'Bearing smooth',    min: 0.02, max: 0.40, step: 0.01, dec: 2 },
    { key: 'lookAheadMeters',      label: 'Look-ahead m',      min: 0,    max: 300,  step: 5,    dec: 0 },
    { key: 'routeLookAheadMeters', label: 'Route look-ahead m',min: 50,   max: 1200, step: 10,   dec: 0 },
    { key: 'minLookAheadMeters',   label: 'Min look-ahead m',  min: 20,   max: 200,  step: 5,    dec: 0 },
    { key: 'maxLookAheadMeters',   label: 'Max look-ahead m',  min: 200,  max: 2000, step: 50,   dec: 0 },
  ];

  function _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  function _save(partial) {
    try {
      const existing = _load();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.assign(existing, partial)));
    } catch (e) {}
  }

  function _clearStorage() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  function _buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'cam-dev-panel';

    const header = document.createElement('div');
    header.className = 'cdp-header';
    header.innerHTML = '<span class="cdp-title">CAM TUNING — DEV</span>';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'cdp-close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', hide);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    const body = document.createElement('div');
    body.className = 'cdp-body';
    const cfg = CameraController.getNavCameraConfig();

    FIELDS.forEach(f => {
      const row = document.createElement('div');
      row.className = 'cdp-row';

      const label = document.createElement('label');
      label.className = 'cdp-label';
      label.textContent = f.label;

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'cdp-slider';
      slider.min   = f.min;
      slider.max   = f.max;
      slider.step  = f.step;
      slider.value = cfg[f.key];
      slider.dataset.key = f.key;

      const readout = document.createElement('span');
      readout.className = 'cdp-val';
      readout.id = 'cdp-val-' + f.key;
      readout.textContent = Number(cfg[f.key]).toFixed(f.dec);

      slider.addEventListener('input', () => {
        const val = parseFloat(slider.value);
        readout.textContent = val.toFixed(f.dec);
        CameraController.setNavCameraConfig({ [f.key]: val });
        _save({ [f.key]: val });
        _applyIfNav();
      });

      row.appendChild(label);
      row.appendChild(slider);
      row.appendChild(readout);
      body.appendChild(row);
    });

    panel.appendChild(body);

    const footer = document.createElement('div');
    footer.className = 'cdp-footer';

    const resetBtn = document.createElement('button');
    resetBtn.className = 'cdp-btn';
    resetBtn.textContent = 'Reset';
    resetBtn.addEventListener('click', () => {
      CameraController.resetNavCameraConfig();
      _clearStorage();
      const defaults = CameraController.getNavCameraDefaults();
      FIELDS.forEach(f => {
        const sl = panel.querySelector('[data-key="' + f.key + '"]');
        const vl = panel.querySelector('#cdp-val-' + f.key);
        sl.value = defaults[f.key];
        vl.textContent = Number(defaults[f.key]).toFixed(f.dec);
      });
      _applyIfNav(80);
    });

    const copyBtn = document.createElement('button');
    copyBtn.className = 'cdp-btn cdp-btn-accent';
    copyBtn.textContent = 'Copy JSON';
    copyBtn.addEventListener('click', () => {
      const json = JSON.stringify(CameraController.getNavCameraConfig(), null, 2);
      const restore = () => { copyBtn.textContent = 'Copy JSON'; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(json)
          .then(() => { copyBtn.textContent = 'Copied!'; setTimeout(restore, 1500); })
          .catch(() => { prompt('Copy camera config:', json); });
      } else {
        prompt('Copy camera config:', json);
      }
    });

    footer.appendChild(resetBtn);
    footer.appendChild(copyBtn);
    panel.appendChild(footer);

    return panel;
  }

  function _applyIfNav(duration) {
    if (!_getCurrentNavState) return;
    const state = _getCurrentNavState();
    if (state.mode !== 'nav' || state.lat === null) return;
    CameraController.refreshNavCamera(state.lat, state.lon, state.heading, duration !== undefined ? duration : 0);
  }

  function show() {
    if (!_panel) {
      _panel = _buildPanel();
      document.body.appendChild(_panel);
    }
    _panel.classList.remove('hidden');
    if (_toggleBtn) _toggleBtn.classList.add('active');
    _visible = true;
  }

  function hide() {
    if (_panel) _panel.classList.add('hidden');
    if (_toggleBtn) _toggleBtn.classList.remove('active');
    _visible = false;
  }

  function toggle() {
    _visible ? hide() : show();
  }

  function init(toggleBtnEl, options) {
    _toggleBtn = toggleBtnEl;
    if (options && typeof options.getCurrentNavState === 'function') {
      _getCurrentNavState = options.getCurrentNavState;
    }
    const saved = _load();
    if (Object.keys(saved).length > 0) {
      CameraController.setNavCameraConfig(saved);
    }
    toggleBtnEl.addEventListener('click', toggle);
  }

  return { init, show, hide, toggle };
})();
