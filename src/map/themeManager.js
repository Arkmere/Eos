/**
 * ThemeManager — tracks Day/Night/Auto preference and resolves it to a
 * concrete "day" | "night" value that the map and UI can consume.
 *
 * Auto mode listens to the OS prefers-color-scheme media query and fires
 * the onChange callback whenever the system preference changes.
 */

const ThemeManager = (() => {

  let _preference = "auto";   // "day" | "night" | "auto"
  let _resolved   = "night";  // "day" | "night"
  let _onChange   = null;
  let _mq         = null;     // MediaQueryList for prefers-color-scheme

  function _fromSystem() {
    return (_mq && _mq.matches) ? "night" : "day";
  }

  /**
   * Call once before any map or UI code runs.
   * @param {function(string):void} onChangeFn  Called with "day"|"night" on theme change.
   * @returns {string} The initial resolved theme ("day"|"night").
   */
  function init(onChangeFn) {
    _onChange = onChangeFn;
    _mq = window.matchMedia("(prefers-color-scheme: dark)");

    _mq.addEventListener("change", () => {
      if (_preference === "auto") {
        const next = _fromSystem();
        if (next !== _resolved) {
          _resolved = next;
          _onChange?.(_resolved);
        }
      }
    });

    _resolved = (_preference === "auto") ? _fromSystem() : _preference;
    return _resolved;
  }

  /**
   * Set the user's explicit preference.
   * @param {"day"|"night"|"auto"} pref
   * @returns {string} The newly resolved theme ("day"|"night").
   */
  function setPreference(pref) {
    _preference = pref;
    const next  = (pref === "auto") ? _fromSystem() : pref;
    if (next !== _resolved) {
      _resolved = next;
      _onChange?.(_resolved);
    }
    return _resolved;
  }

  function getResolved()   { return _resolved; }
  function getPreference() { return _preference; }

  return { init, setPreference, getResolved, getPreference };
})();

if (typeof module !== "undefined") module.exports = ThemeManager;
