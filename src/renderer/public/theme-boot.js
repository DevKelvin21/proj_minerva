/*
 * Minerva theme boot (runs before the first paint; classic script so it
 * blocks parsing, allowed by `script-src 'self'`).
 *
 * Re-applies the palette the renderer last painted, cached in localStorage
 * by `src/theme/apply-theme.ts`, so a light theme never flashes the dark
 * defaults (or the other way round) while the window asks main for the saved
 * settings. The cache is untrusted input like everything in storage: only
 * `--theme-*` / `--appearance-contrast-*` names and canonical `oklch(...)` or
 * percentage values are applied; anything else is ignored. The renderer
 * replaces all of it moments later with the theme from settings.json.
 * Same idea as T3 Code's inline boot script (MIT, see THIRD_PARTY_NOTICES.md).
 */
/* global window, document */
;(function () {
  var NAME = /^--(theme-[a-z-]+|appearance-contrast-(base|boost|border-boost))$/
  var COLOR =
    /^oklch\((0|1|0\.\d{1,6}) (0|\d{1,2}(\.\d{1,6})?) (0|\d{1,3}(\.\d{1,3})?)( \/ (0|1|0\.\d{1,4}))?\)$/
  var PERCENT = /^\d{1,3}(\.\d{1,4})?%$/
  try {
    var raw = window.localStorage.getItem('minerva:theme-boot:v1')
    if (!raw || raw.length > 20000) return
    var cache = JSON.parse(raw)
    if (!cache || (cache.appearance !== 'light' && cache.appearance !== 'dark')) return
    var vars = cache.vars
    if (!vars || typeof vars !== 'object') return
    var root = document.documentElement
    var names = Object.keys(vars)
    for (var i = 0; i < names.length && i < 100; i++) {
      var name = names[i]
      var value = vars[name]
      if (typeof value !== 'string' || !NAME.test(name)) continue
      if (COLOR.test(value) || PERCENT.test(value)) root.style.setProperty(name, value)
    }
    root.setAttribute('data-appearance', cache.appearance)
  } catch {
    // Bad cache: the CSS defaults stay until the renderer applies the theme.
  }
})()
