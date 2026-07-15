/*
 * theme-core.js — shared between the site pages and the CMS admin preview.
 * Turns content/theme.json into CSS custom-property overrides.
 *
 * The compiled stylesheet (assets/css/site.css) derives its entire palette
 * from a handful of root tokens (--ploy-neutral-primary/-secondary/-inverse,
 * --ploy-text-inverse, --ploy-accent-primary) via var() references and
 * color-mix(). Overriding just those tokens re-colors every derived surface
 * (borders, secondary text, card tints, buttons) consistently.
 */
(function (global) {
  // ---- base-path resolution --------------------------------------------
  // The site uses root-relative-looking paths in its JSON data (e.g.
  // "/assets/images/x.webp", "/work/product-decks", "/#work"). When the
  // site is hosted at a subpath (like GitHub Pages project sites:
  // https://user.github.io/<repo>/), a literal leading "/" would resolve
  // against the domain root and 404. We derive the real site root from
  // THIS script's own URL — it is always loaded from "<base>assets/js/
  // theme-core.js" — and rewrite leading-slash paths against it.
  //
  // This script must be a classic (non-deferred) tag so document.currentScript
  // is available here. It is the first script on every page, so PLOY_BASE is
  // set before anything else needs it.
  var BASE = '/';
  try {
    var self = document.currentScript && document.currentScript.src;
    if (self) {
      var marker = self.indexOf('assets/js/theme-core.js');
      if (marker !== -1) BASE = self.slice(0, marker);
    }
  } catch (e) {}
  global.PLOY_BASE = BASE;

  // Resolve a path for use in the current page. Leading-slash paths are
  // rewritten against the site root; everything else (already-relative,
  // absolute http(s), data:, #, mailto:) is left untouched.
  function url(p) {
    if (p == null) return p;
    if (typeof p !== 'string' || !p.length) return p;
    if (p.charAt(0) === '/' && p.charAt(1) !== '/') return BASE + p.slice(1);
    return p;
  }

  var FONT_PRESETS = {
    inter: '"Inter Variable", system-ui, sans-serif',
    playfair: '"Playfair Display Variable", Georgia, serif',
    georgia: 'Georgia, "Times New Roman", serif',
    times: '"Times New Roman", Times, serif',
    arial: 'Arial, Helvetica, sans-serif',
    system: 'system-ui, -apple-system, sans-serif',
    courier: '"Courier New", Courier, monospace',
  };

  var FONT_OPTIONS = [
    { id: 'inter', label: 'Inter (default body)' },
    { id: 'playfair', label: 'Playfair Display (default heading)' },
    { id: 'georgia', label: 'Georgia (serif)' },
    { id: 'times', label: 'Times New Roman (serif)' },
    { id: 'arial', label: 'Arial (sans-serif)' },
    { id: 'system', label: 'System UI (sans-serif)' },
    { id: 'courier', label: 'Courier New (monospace)' },
    { id: 'custom', label: 'Custom…' },
  ];

  function fontStack(preset, custom) {
    if (preset === 'custom') return custom || FONT_PRESETS.inter;
    return FONT_PRESETS[preset] || FONT_PRESETS.inter;
  }

  function cssVars(theme) {
    var c = (theme && theme.colors) || {};
    var f = (theme && theme.fonts) || {};
    var heading = fontStack(f.headingPreset, f.headingCustom);
    var body = fontStack(f.bodyPreset, f.bodyCustom);
    return {
      '--ploy-neutral-primary': c.background,
      '--ploy-neutral-secondary': c.surface,
      '--ploy-neutral-inverse': c.ink,
      '--ploy-text-inverse': c.onDark,
      '--ploy-accent-primary': c.accent,
      '--font-heading': heading,
      '--font-body': body,
      '--font-mono': body,
      '--font-eyebrow': body,
      '--font-button': body,
    };
  }

  function apply(doc, theme) {
    if (!theme) return;
    var vars = cssVars(theme);
    var root = doc.documentElement;
    Object.keys(vars).forEach(function (k) {
      var v = vars[k];
      if (v) root.style.setProperty(k, v);
    });
    
    // Apply global background, header, and footer color overrides
    var c = theme.colors || {};
    var styleId = 'ploy-theme-overrides';
    var style = doc.getElementById(styleId);
    if (!style) {
      style = doc.createElement('style');
      style.id = styleId;
      doc.head.appendChild(style);
    }
    var bg = c.bg || c.background || '';
    var hBg = c.headerBg || c.ink || '';
    var fBg = c.footerBg || c.ink || '';
    style.textContent = '';
    if (bg) style.textContent += 'body, .home-page, .bg-ploy-background-primary { background-color: ' + bg + ' !important; }\n';
    if (hBg) style.textContent += 'header.nav { background-color: ' + hBg + ' !important; }\n';
    if (fBg) style.textContent += 'footer.footer { background-color: ' + fBg + ' !important; }\n';
  }

  global.PloyTheme = {
    FONT_PRESETS: FONT_PRESETS,
    FONT_OPTIONS: FONT_OPTIONS,
    fontStack: fontStack,
    cssVars: cssVars,
    apply: apply,
    url: url,
    base: BASE,
  };
})(window);
