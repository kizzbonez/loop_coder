// Applies the saved colour theme before first paint (external file so the CSP can forbid inline scripts).
(function () {
  var pref = 'system';
  try {
    pref = localStorage.getItem('lc-theme') || 'system';
  } catch (e) {
    /* storage unavailable */
  }
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
