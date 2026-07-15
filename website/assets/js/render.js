/*
 * render.js — binds content/site.json into the static pages.
 *
 * Bindings:
 *   data-cms="path"            → textContent
 *   data-cms-src="path"        → img src
 *   data-cms-alt="path"        → img alt
 *   data-cms-href="path"       → link href
 *   data-cms-show="path"       → element removed when value is falsy
 *   data-cms-hide="path"       → element removed when value is truthy
 *   data-cms-list="path"       → container re-rendered from array of objects
 *                                (uses its <template> child; fields bind with
 *                                data-f, data-f-src, data-f-alt, data-f-href
 *                                [+ data-href-prefix], data-f-if)
 *   data-cms-textlist="path"   → container re-rendered from array of strings
 *   data-cms-linkedin="path"   → pending badge becomes a real link when set
 *   <body data-title-path>     → document.title updated from content
 */
(async function () {
  // Resolve leading-slash paths against the site root so the page works
  // whether hosted at "/" or at a subpath (GitHub Pages project sites).
  const rurl = (p) => (window.PloyTheme ? window.PloyTheme.url(p) : p);
  const base = (window.PloyTheme && window.PloyTheme.base) || '/';

  let data;
  try {
    const res = await fetch(base + 'content/site.json', { cache: 'no-store' });
    if (!res.ok) return;
    data = await res.json();
  } catch (e) {
    return; // no server / offline: baked-in static content remains
  }

  const get = (path) =>
    path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), data);

  document.querySelectorAll('[data-cms]').forEach((el) => {
    const v = get(el.dataset.cms);
    if (v != null) el.textContent = v;
  });
  document.querySelectorAll('[data-cms-src]').forEach((el) => {
    const v = get(el.dataset.cmsSrc);
    if (v) el.setAttribute('src', rurl(v));
  });
  document.querySelectorAll('[data-cms-alt]').forEach((el) => {
    const v = get(el.dataset.cmsAlt);
    if (v != null) el.setAttribute('alt', v);
  });
  document.querySelectorAll('[data-cms-href]').forEach((el) => {
    const v = get(el.dataset.cmsHref);
    if (v) el.setAttribute('href', rurl(v));
  });
  document.querySelectorAll('[data-cms-show]').forEach((el) => {
    if (!get(el.dataset.cmsShow)) el.remove();
  });
  document.querySelectorAll('[data-cms-hide]').forEach((el) => {
    if (get(el.dataset.cmsHide)) el.remove();
  });

  document.querySelectorAll('[data-cms-list]').forEach((container) => {
    const items = get(container.dataset.cmsList);
    const tpl = container.querySelector('template');
    if (!Array.isArray(items) || !tpl) return;
    Array.from(container.children).forEach((n) => {
      if (n !== tpl) n.remove();
    });
    items.forEach((item) => {
      const node = tpl.content.cloneNode(true);
      node.querySelectorAll('[data-f]').forEach((el) => {
        const v = item[el.dataset.f];
        if (v != null) el.textContent = v;
      });
      node.querySelectorAll('[data-f-src]').forEach((el) => {
        const v = item[el.dataset.fSrc];
        if (v) el.setAttribute('src', rurl(v));
      });
      node.querySelectorAll('[data-f-alt]').forEach((el) => {
        const v = item[el.dataset.fAlt];
        if (v != null) el.setAttribute('alt', v);
      });
      node.querySelectorAll('[data-f-href]').forEach((el) => {
        const v = item[el.dataset.fHref];
        const prefix = el.dataset.hrefPrefix || '';
        if (v) el.setAttribute('href', rurl(prefix + v));
        else el.removeAttribute('href');
      });
      node.querySelectorAll('[data-f-if]').forEach((el) => {
        if (!item[el.dataset.fIf]) el.remove();
      });
      container.appendChild(node);
    });
  });

  document.querySelectorAll('[data-cms-textlist]').forEach((container) => {
    const items = get(container.dataset.cmsTextlist);
    const tpl = container.querySelector('template');
    if (!Array.isArray(items) || !tpl) return;
    Array.from(container.children).forEach((n) => {
      if (n !== tpl) n.remove();
    });
    items.forEach((text) => {
      const node = tpl.content.cloneNode(true);
      if (node.firstElementChild) node.firstElementChild.textContent = text;
      container.appendChild(node);
    });
  });

  document.querySelectorAll('[data-cms-linkedin]').forEach((el) => {
    const url = get(el.dataset.cmsLinkedin);
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.className = el.className.replace('footer__linkedin--pending', '').trim();
    a.setAttribute('aria-label', 'LinkedIn profile');
    a.innerHTML = el.innerHTML;
    el.replaceWith(a);
  });

  const titlePath = document.body.dataset.titlePath;
  if (titlePath) {
    const t = get(titlePath);
    if (t) document.title = t;
  }

  // Lets sections.js apply per-element style overrides only after the
  // list re-renders above have produced their final elements.
  window.__ployRendered = true;
  document.dispatchEvent(new CustomEvent('ploy:rendered'));
})();
