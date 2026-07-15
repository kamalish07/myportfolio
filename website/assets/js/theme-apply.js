/*
 * theme-apply.js — blocking (non-deferred) script for the site pages.
 * Applies content/theme.json before first paint so there is no flash of
 * default colors/fonts. Requires theme-core.js to load first.
 *
 * Also listens for live-preview messages from the separate CMS tool
 * (../cms), which runs on its own origin/port and previews unsaved edits
 * in an iframe of this site — it can't reach into this page's DOM
 * directly (different origin), so it posts the draft theme instead.
 */
(function () {
  try {
    var base = (window.PloyTheme && window.PloyTheme.base) || '/';
    var xhr = new XMLHttpRequest();
    xhr.open('GET', base + 'content/theme.json', false);
    xhr.send(null);
    if (xhr.status === 200 && window.PloyTheme) {
      window.PloyTheme.apply(document, JSON.parse(xhr.responseText));
    }
  } catch (e) {
    // no server / offline: stylesheet defaults remain
  }

  // Update this list if the CMS is served from a different origin/port.
  // Exposed on window so sections.js can use the same allow-list.
  var ALLOWED_PREVIEW_ORIGINS = window.PLOY_CMS_ORIGINS = ['http://localhost:4174', 'http://127.0.0.1:4174'];

  window.addEventListener('message', function (event) {
    if (ALLOWED_PREVIEW_ORIGINS.indexOf(event.origin) === -1) return;
    var msg = event.data;
    if (!msg || msg.type !== 'ploy-theme-preview' || !window.PloyTheme) return;
    window.PloyTheme.apply(document, msg.theme);
  });
})();
