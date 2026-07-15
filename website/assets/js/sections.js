/*
 * sections.js — renders user-defined page sections (content/blocks.json)
 * and per-element text style overrides (content/styles.json), and provides
 * the in-preview editing mode used by the CMS (../cms).
 *
 * Sections use auto-layout: a flex row that wraps, with a gap. Each block
 * has a width in % of the row; removing a block lets the others reflow so
 * everything stays aligned.
 *
 * Editing protocol (postMessage; allowed origins come from theme-apply.js):
 *   CMS → page: { type:'ploy-blocks-preview', sections, editMode, selected, defaultOverrides }
 *               { type:'ploy-styles-preview', overrides }
 *   page → CMS: { type:'ploy-blocks-ready', page, defaultSections }
 *               { type:'ploy-blocks-select', sectionId, blockId }
 *               { type:'ploy-blocks-text', sectionId, blockId, text }
 *               { type:'ploy-blocks-resize', sectionId, blockId, width }
 *               { type:'ploy-blocks-section-resize', sectionId, minHeight }
 *               { type:'ploy-blocks-op', op, sectionId, blockId?, dir?, blockType? }
 */
(function () {
  var container = document.querySelector('.custom-sections');
  var PAGE = container ? container.dataset.page : null;
  var framed = window.parent && window.parent !== window;
  var ORIGINS = window.PLOY_CMS_ORIGINS || [];

  var state = { sections: [], editMode: false, selected: { s: null, b: null }, defaultOverrides: {}, migrated: false };
  var focusBlockId = null;
  var styledEls = [];
  var pendingOverrides = null;
  var defaultSectionEls = []; // track annotated default section elements
  var extractedDefaultNodes = {};

  var TAGS = {
    h1: { size: 48, weight: 600, heading: true },
    h2: { size: 36, weight: 600, heading: true },
    h3: { size: 28, weight: 600, heading: true },
    p: { size: 16, weight: 400, heading: false },
    small: { size: 13, weight: 400, heading: false },
  };

  var styleEl = document.createElement('style');
  styleEl.textContent = [
    '.ploy-sec{position:relative}',
    '.custom-sections--edit .ploy-blk{cursor:pointer}',
    '.custom-sections--edit .ploy-blk:hover{outline:1px dashed rgba(37,99,235,.55);outline-offset:2px}',
    '.ploy-blk.ploy-sel{outline:2px solid #2563eb!important;outline-offset:2px}',
    '.ploy-sec.ploy-sel-sec{outline:2px solid #7c3aed;outline-offset:-2px}',
    '.ploy-handle{position:absolute;width:14px;height:14px;border-radius:3px;z-index:60;box-shadow:0 0 0 2px #fff;touch-action:none}',
    '.ploy-handle--right{background:#2563eb;right:-8px;top:50%;transform:translateY(-50%);cursor:ew-resize}',
    '.ploy-handle--bottom{background:#7c3aed;left:50%;bottom:-8px;transform:translateX(-50%);cursor:ns-resize}',
    '.ploy-toolbar{position:absolute;display:flex;gap:4px;z-index:70;font-family:system-ui,sans-serif}',
    '.ploy-toolbar--sec{top:6px;right:6px}',
    '.ploy-toolbar--blk{top:-30px;left:0}',
    '.ploy-toolbar button{border:0;border-radius:3px;padding:3px 9px;font-size:12px;line-height:1.5;cursor:pointer;background:#1f2937;color:#fff}',
    '.ploy-toolbar--sec button{background:#7c3aed}',
    '.ploy-empty{border:2px dashed #b9b2a6;border-radius:8px;margin:28px auto;max-width:900px;padding:44px 20px;text-align:center;color:#8a8375;font:14px/1.5 system-ui,sans-serif}',
    '.ploy-imgph{border:2px dashed #999;border-radius:6px;min-height:140px;display:flex;align-items:center;justify-content:center;color:#777;font:13px system-ui,sans-serif;background:rgba(0,0,0,.04);padding:12px;text-align:center}',
    '.ploy-blk__text:focus{outline:none}',
    /* Default section edit-mode styles */
    '.ploy-defsec--edit{position:relative;cursor:pointer;transition:outline .15s}',
    '.ploy-defsec--edit:hover{outline:2px dashed rgba(124,58,237,.4);outline-offset:-2px}',
    '.ploy-defsec--selected{outline:2px solid #7c3aed!important;outline-offset:-2px}',
    '.ploy-defsec-label{position:absolute;top:6px;left:6px;z-index:70;background:rgba(124,58,237,.88);color:#fff;font:600 11px/1.4 system-ui,sans-serif;padding:3px 10px;border-radius:3px;pointer-events:none;letter-spacing:.3px}',
    /* Link styling */
    '.ploy-blk__text a{color:var(--ploy-accent-primary, #2563eb);text-decoration:none;border-bottom:1px solid transparent;transition:border-color .15s}',
    '.ploy-blk__text a:hover{border-color:currentColor}',
  ].join('\n');
  document.head.appendChild(styleEl);

  function post(msg) {
    if (!framed) return;
    try { window.parent.postMessage(msg, '*'); } catch (e) {}
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function blockFlex(b, gap) {
    var w = clamp(b.width || 100, 8, 100);
    var reduce = (gap * (100 - w)) / 100;
    return '0 1 calc(' + w + '% - ' + reduce.toFixed(2) + 'px)';
  }

  // ---------------- default section detection & editing ----------------
  function getDefaultSections() {
    return Array.prototype.slice.call(document.querySelectorAll('[data-default-section]')).map(function (el) {
      return {
        id: 'default:' + el.dataset.defaultSection,
        key: el.dataset.defaultSection,
        label: el.dataset.defaultLabel || el.dataset.defaultSection,
        el: el
      };
    }).concat(Object.keys(extractedDefaultNodes).map(function(k) {
      var el = extractedDefaultNodes[k];
      return {
        id: 'default:' + k,
        key: k,
        label: el.dataset.defaultLabel || k,
        el: el
      };
    }));
  }

  function applyDefaultOverrides(overrides) {
    var secs = getDefaultSections();
    secs.forEach(function (sec) {
      var ov = (overrides || {})[sec.key];
      if (!ov) return;
      if (ov.bg) sec.el.style.backgroundColor = ov.bg;
      if (ov.paddingY != null && ov.paddingY !== '') {
        sec.el.style.paddingTop = ov.paddingY + 'px';
        sec.el.style.paddingBottom = ov.paddingY + 'px';
      }
    });
  }

  function annotateDefaultSections() {
    // Clear previous annotations
    cleanupDefaultAnnotations();

    var secs = getDefaultSections();
    defaultSectionEls = [];

    secs.forEach(function (sec) {
      if (state.editMode) {
        sec.el.classList.add('ploy-defsec--edit');
        defaultSectionEls.push(sec.el);

        // Label overlay
        var label = document.createElement('div');
        label.className = 'ploy-defsec-label';
        label.textContent = '📌 ' + sec.label;
        label.dataset.ployAnnotation = 'true';
        sec.el.appendChild(label);

        // Selection state
        if (state.selected.s === sec.id) {
          sec.el.classList.add('ploy-defsec--selected');
        }

        // Click handler
        sec.el._ployClickHandler = function (ev) {
          // Don't intercept if clicking a link or inside custom-sections
          if (ev.target.closest && (ev.target.closest('a') || ev.target.closest('.custom-sections'))) return;
          ev.stopPropagation();
          if (state.selected.s === sec.id && !state.selected.b) return;
          state.selected = { s: sec.id, b: null };
          annotateDefaultSections();
          post({ type: 'ploy-blocks-select', sectionId: sec.id, blockId: null });
        };
        sec.el.addEventListener('click', sec.el._ployClickHandler);
      }
    });

    // Apply visual overrides
    applyDefaultOverrides(state.defaultOverrides);
  }

  function cleanupDefaultAnnotations() {
    // Remove all annotation labels
    var labels = document.querySelectorAll('[data-ploy-annotation]');
    for (var i = 0; i < labels.length; i++) labels[i].remove();

    // Remove edit classes and click handlers
    defaultSectionEls.forEach(function (el) {
      el.classList.remove('ploy-defsec--edit', 'ploy-defsec--selected');
      if (el._ployClickHandler) {
        el.removeEventListener('click', el._ployClickHandler);
        delete el._ployClickHandler;
      }
    });
    defaultSectionEls = [];
  }

  // ---------------- rendering ----------------
  function renderSections() {
    if (!container) return;
    
    // Extract default sections if the page is migrated, so we can reorder them
    if (state.migrated && Object.keys(extractedDefaultNodes).length === 0) {
      document.querySelectorAll('[data-default-section]').forEach(function (el) {
        extractedDefaultNodes[el.dataset.defaultSection] = el;
        if (el.parentNode) el.parentNode.removeChild(el);
      });
    }

    container.innerHTML = '';
    container.classList.toggle('custom-sections--edit', state.editMode);
    
    if (!state.sections.length && state.migrated) {
      if (state.editMode) {
        var ph = document.createElement('div');
        ph.className = 'ploy-empty';
        ph.textContent = 'No sections on this page yet — use "Add custom section" in the CMS panel.';
        container.appendChild(ph);
      }
      return;
    }
    
    // If not migrated, we just append custom sections into container and leave default sections alone in the DOM.
    // If migrated, ALL sections are in state.sections and will be rendered here.
    state.sections.forEach(function (sec) {
      if (sec.type === 'default_section') {
        var el = extractedDefaultNodes[sec.key];
        if (el) {
          if (sec.bg) {
             el.style.setProperty('background-color', sec.bg, 'important');
             el.classList.remove('bg-ploy-background-primary', 'bg-ploy-background-inverse', 'bg-ploy-background-secondary');
          }
          if (sec.paddingY != null) el.style.padding = sec.paddingY + 'px 0';
          
          if (state.editMode) attachSectionEditing(el, sec);
          container.appendChild(el);
        }
        return;
      }

      var secEl = document.createElement('section');
      secEl.className = 'ploy-sec';
      secEl.dataset.sid = sec.id;
      if (sec.bg) secEl.style.background = sec.bg;
      secEl.style.padding = (sec.paddingY != null ? sec.paddingY : 64) + 'px 20px';
      if (sec.minHeight) secEl.style.minHeight = sec.minHeight + 'px';
      var row = document.createElement('div');
      row.className = 'ploy-sec__row';
      row.style.maxWidth = (sec.maxWidth || 1152) + 'px';
      row.style.margin = '0 auto';
      row.style.display = 'flex';
      row.style.flexWrap = 'wrap';
      row.style.gap = (sec.gap != null ? sec.gap : 24) + 'px';
      row.style.alignItems = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' }[sec.align || 'start'];
      (sec.blocks || []).forEach(function (b) { row.appendChild(renderBlock(sec, b)); });
      secEl.appendChild(row);
      if (state.editMode) attachSectionEditing(secEl, sec);
      container.appendChild(secEl);
    });
    if (focusBlockId) {
      var el = container.querySelector('[data-bid="' + focusBlockId + '"] .ploy-blk__text');
      if (el) {
        el.focus();
        try {
          var r = document.createRange();
          r.selectNodeContents(el);
          r.collapse(false);
          var s = window.getSelection();
          s.removeAllRanges();
          s.addRange(r);
        } catch (e) {}
      }
      focusBlockId = null;
    }

    // Re-annotate default sections after rendering
    annotateDefaultSections();
  }

  function renderBlock(sec, b) {
    var gap = sec.gap != null ? sec.gap : 24;
    var wrap = document.createElement('div');
    wrap.className = 'ploy-blk';
    wrap.dataset.bid = b.id;
    wrap.style.flex = blockFlex(b, gap);
    wrap.style.minWidth = '60px';
    wrap.style.position = 'relative';
    if (b.type === 'container') {
      wrap.style.display = 'flex';
      wrap.style.flexDirection = b.flexDirection || 'column';
      wrap.style.gap = (b.gap != null ? b.gap : 16) + 'px';
      wrap.style.alignItems = b.alignItems || 'stretch';
      wrap.style.justifyContent = b.justifyContent || 'flex-start';
      if (b.padding) wrap.style.padding = b.padding + 'px';
      if (b.bg) wrap.style.backgroundColor = b.bg;
      if (b.radius) wrap.style.borderRadius = b.radius + 'px';
      (b.blocks || []).forEach(function (child) { wrap.appendChild(renderBlock(sec, child)); });
      if (state.editMode && !(b.blocks && b.blocks.length)) {
         var ph = document.createElement('div');
         ph.className = 'ploy-empty';
         ph.textContent = 'Empty container';
         ph.style.padding = '20px';
         ph.style.border = '1px dashed #ccc';
         wrap.appendChild(ph);
      }
    } else if (b.type === 'button') {
      var btn = document.createElement('a');
      btn.className = 'button-link typography-button inline-flex items-center justify-center rounded-button border px-5 py-3 text-sm transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 button-link--primary border-ploy-button-primary-border bg-ploy-button-primary-background text-ploy-button-primary-text hover:opacity-80';
      btn.textContent = b.text || 'Button';
      btn.href = b.url || '#';
      if (state.editMode) btn.addEventListener('click', function(e) { e.preventDefault(); });
      wrap.appendChild(btn);
    } else if (b.type === 'image') {
      if (b.src) {
        var img = document.createElement('img');
        img.src = window.PloyTheme ? window.PloyTheme.url(b.src) : b.src;
        img.alt = b.alt || '';
        img.style.width = '100%';
        img.style.display = 'block';
        if (b.radius) img.style.borderRadius = b.radius + 'px';
        wrap.appendChild(img);
      } else if (state.editMode) {
        var ph = document.createElement('div');
        ph.className = 'ploy-imgph';
        ph.textContent = 'Image — choose or upload one in the CMS panel';
        wrap.appendChild(ph);
      }
    } else {
      var d = TAGS[b.tag] || TAGS.p;
      var el = document.createElement(TAGS[b.tag] ? b.tag : 'p');
      el.className = 'ploy-blk__text';
      if (!state.editMode && b.text) {
        // Parse simple markdown links: [text](url)
        var html = b.text
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') // escape
          .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
        el.innerHTML = html;
      } else {
        el.textContent = b.text || '';
      }
      el.style.margin = '0';
      el.style.whiteSpace = 'pre-wrap';
      el.style.fontSize = (b.size || d.size) + 'px';
      el.style.fontWeight = b.bold ? 700 : d.weight;
      el.style.lineHeight = d.heading ? '1.15' : '1.6';
      el.style.textAlign = b.align || 'left';
      el.style.fontFamily = (b.font && window.PloyTheme)
        ? window.PloyTheme.fontStack(b.font, b.fontCustom)
        : (d.heading ? 'var(--font-heading)' : 'var(--font-body)');
      if (b.color) el.style.color = b.color;
      wrap.appendChild(el);
    }
    if (state.editMode) attachBlockEditing(wrap, sec, b);
    return wrap;
  }

  // ---------------- edit mode ----------------
  function select(sid, bid, focusText) {
    state.selected = { s: sid, b: bid };
    focusBlockId = focusText ? bid : null;
    renderSections();
    post({ type: 'ploy-blocks-select', sectionId: sid, blockId: bid });
  }

  function dragHandle(handle, onMove, onEnd) {
    handle.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      var startX = ev.clientX;
      var startY = ev.clientY;
      handle.setPointerCapture(ev.pointerId);
      function move(e) { onMove(e.clientX - startX, e.clientY - startY); }
      function up() {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        if (onEnd) onEnd();
      }
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  function toolbarButton(label, title, fn) {
    var btn = document.createElement('button');
    btn.textContent = label;
    btn.title = title;
    btn.addEventListener('click', function (ev) { ev.stopPropagation(); fn(); });
    return btn;
  }

  function attachSectionEditing(secEl, sec) {
    if (sec.type === 'default_section') {
      // Add overlay to block interactions with links/buttons
      var existing = secEl.querySelector('.ploy-sec-overlay');
      if (!existing) {
        var over = document.createElement('div');
        over.className = 'ploy-sec-overlay';
        over.style.position = 'absolute';
        over.style.inset = '0';
        over.style.zIndex = '50';
        over.style.cursor = 'pointer';
        secEl.style.position = 'relative'; // Ensure overlay is contained
        secEl.appendChild(over);
      }
    }

    secEl.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (state.selected.s === sec.id && !state.selected.b) return;
      select(sec.id, null);
    });
    if (state.selected.s !== sec.id || state.selected.b) return;
    secEl.classList.add('ploy-sel-sec');

    var bar = document.createElement('div');
    bar.className = 'ploy-toolbar ploy-toolbar--sec';
    
    if (sec.type === 'default_section') {
      bar.append(
        toolbarButton('↑', 'Move section up', function () { post({ type: 'ploy-blocks-op', op: 'moveSection', sectionId: sec.id, dir: -1 }); }),
        toolbarButton('↓', 'Move section down', function () { post({ type: 'ploy-blocks-op', op: 'moveSection', sectionId: sec.id, dir: 1 }); }),
        toolbarButton('✕', 'Delete section', function () { post({ type: 'ploy-blocks-op', op: 'deleteSection', sectionId: sec.id }); })
      );
    } else {
      bar.append(
        toolbarButton('↑', 'Move section up', function () { post({ type: 'ploy-blocks-op', op: 'moveSection', sectionId: sec.id, dir: -1 }); }),
        toolbarButton('↓', 'Move section down', function () { post({ type: 'ploy-blocks-op', op: 'moveSection', sectionId: sec.id, dir: 1 }); }),
        toolbarButton('+ Text', 'Add a text block', function () { post({ type: 'ploy-blocks-op', op: 'addBlock', sectionId: sec.id, blockType: 'text' }); }),
        toolbarButton('+ Image', 'Add an image block', function () { post({ type: 'ploy-blocks-op', op: 'addBlock', sectionId: sec.id, blockType: 'image' }); }),
        toolbarButton('✕', 'Delete section', function () { post({ type: 'ploy-blocks-op', op: 'deleteSection', sectionId: sec.id }); })
      );
    }
    secEl.appendChild(bar);

    if (sec.type !== 'default_section') {
      var handle = document.createElement('div');
      handle.className = 'ploy-handle ploy-handle--bottom';
      handle.title = 'Drag to set section height';
      var startH = 0;
      handle.addEventListener('pointerdown', function () { startH = secEl.getBoundingClientRect().height; });
      dragHandle(handle, function (dx, dy) {
        sec.minHeight = Math.max(0, Math.round(startH + dy));
        secEl.style.minHeight = sec.minHeight + 'px';
      }, function () {
        post({ type: 'ploy-blocks-section-resize', sectionId: sec.id, minHeight: sec.minHeight });
      });
      secEl.appendChild(handle);
    }
  }

  function attachBlockEditing(wrap, sec, b) {
    wrap.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (state.selected.b === b.id) return;
      select(sec.id, b.id, b.type === 'text');
    });

    if (b.type === 'text') {
      var el = wrap.querySelector('.ploy-blk__text');
      try { el.contentEditable = 'plaintext-only'; } catch (e) { el.contentEditable = 'true'; }
      el.addEventListener('input', function () {
        b.text = el.innerText;
        post({ type: 'ploy-blocks-text', sectionId: sec.id, blockId: b.id, text: b.text });
      });
    }

    if (state.selected.b !== b.id) return;
    wrap.classList.add('ploy-sel');

    var bar = document.createElement('div');
    bar.className = 'ploy-toolbar ploy-toolbar--blk';
    bar.append(
      toolbarButton('◀', 'Move block left', function () { post({ type: 'ploy-blocks-op', op: 'moveBlock', sectionId: sec.id, blockId: b.id, dir: -1 }); }),
      toolbarButton('▶', 'Move block right', function () { post({ type: 'ploy-blocks-op', op: 'moveBlock', sectionId: sec.id, blockId: b.id, dir: 1 }); }),
      toolbarButton('✕', 'Delete block', function () { post({ type: 'ploy-blocks-op', op: 'deleteBlock', sectionId: sec.id, blockId: b.id }); }),
    );
    wrap.appendChild(bar);

    var handle = document.createElement('div');
    handle.className = 'ploy-handle ploy-handle--right';
    handle.title = 'Drag to resize';
    var startW = 0;
    var rowW = 1;
    handle.addEventListener('pointerdown', function () {
      startW = wrap.getBoundingClientRect().width;
      rowW = wrap.parentElement.getBoundingClientRect().width || 1;
    });
    var SNAPS = [25, 33.33, 50, 66.67, 75, 100];
    dragHandle(handle, function (dx) {
      var pct = clamp(((startW + dx) / rowW) * 100, 8, 100);
      for (var i = 0; i < SNAPS.length; i += 1) {
        if (Math.abs(pct - SNAPS[i]) < 2.5) { pct = SNAPS[i]; break; }
      }
      b.width = Math.round(pct * 100) / 100;
      wrap.style.flex = blockFlex(b, sec.gap != null ? sec.gap : 24);
    }, function () {
      post({ type: 'ploy-blocks-resize', sectionId: sec.id, blockId: b.id, width: b.width });
    });
    wrap.appendChild(handle);
  }

  document.addEventListener('click', function (ev) {
    if (!state.editMode || !container) return;
    if (container.contains(ev.target)) return;
    // Don't deselect if clicking inside a default section
    var defaultEl = ev.target.closest && ev.target.closest('[data-default-section]');
    if (defaultEl) return;
    if (state.selected.s || state.selected.b) select(null, null);
  });

  // ---------------- text style overrides ----------------
  function targetsFor(key) {
    var direct = document.querySelectorAll('[data-cms="' + key + '"]');
    if (direct.length) return Array.prototype.slice.call(direct);
    var m = key.match(/^(.*)\.(\d+)(?:\.([a-zA-Z_]+))?$/);
    if (!m) return [];
    var cont = document.querySelector('[data-cms-list="' + m[1] + '"], [data-cms-textlist="' + m[1] + '"]');
    if (!cont) return [];
    var items = Array.prototype.filter.call(cont.children, function (n) { return n.tagName !== 'TEMPLATE'; });
    var item = items[Number(m[2])];
    if (!item) return [];
    if (!m[3]) return [item];
    var els = item.querySelectorAll('[data-f="' + m[3] + '"]');
    return Array.prototype.slice.call(els);
  }

  function applyOverrides(ov) {
    if (!window.__ployRendered) { pendingOverrides = ov; return; }
    styledEls.forEach(function (el) {
      el.style.fontFamily = '';
      el.style.fontSize = '';
      el.style.color = '';
    });
    styledEls = [];
    Object.keys(ov || {}).forEach(function (key) {
      var o = ov[key] || {};
      targetsFor(key).forEach(function (el) {
        if (o.font && window.PloyTheme) el.style.fontFamily = window.PloyTheme.fontStack(o.font, o.fontCustom);
        if (o.size) el.style.fontSize = o.size + 'px';
        if (o.color) el.style.color = o.color;
        styledEls.push(el);
      });
    });
  }

  document.addEventListener('ploy:rendered', function () {
    if (pendingOverrides) {
      var o = pendingOverrides;
      pendingOverrides = null;
      applyOverrides(o);
    }
  });

  // ---------------- messages from the CMS ----------------
  window.addEventListener('message', function (ev) {
    if (ORIGINS.indexOf(ev.origin) === -1) return;
    var d = ev.data || {};
    if (d.type === 'ploy-blocks-preview') {
      state.sections = d.sections || [];
      state.editMode = !!d.editMode;
      state.selected = d.selected || { s: null, b: null };
      state.defaultOverrides = d.defaultOverrides || {};
      renderSections();
    } else if (d.type === 'ploy-styles-preview') {
      applyOverrides(d.overrides || {});
    } else if (d.type === 'ploy-scroll-to-section') {
      // CMS asks us to scroll a default section into view
      var target = document.querySelector('[data-default-section="' + d.sectionKey + '"]');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });

  // ---------------- initial load ----------------
  var base = (window.PloyTheme && window.PloyTheme.base) || '/';
  Promise.all([
    fetch(base + 'content/blocks.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
    fetch(base + 'content/styles.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
  ]).then(function (res) {
    var blocks = res[0];
    var styles = res[1];
    if (blocks && blocks.pages && PAGE && blocks.pages[PAGE]) {
      state.sections = blocks.pages[PAGE].sections || [];
      state.migrated = !!blocks.pages[PAGE].migrated;
      // Also load default overrides for this page
      if (blocks.pages[PAGE].defaultOverrides) {
        state.defaultOverrides = blocks.pages[PAGE].defaultOverrides;
      }
      renderSections();
    }
    if (styles && styles.overrides && Object.keys(styles.overrides).length) applyOverrides(styles.overrides);

    // Collect default section info to send to CMS
    var defSecs = getDefaultSections().map(function (s) { return { id: s.id, key: s.key, label: s.label }; });
    post({ type: 'ploy-blocks-ready', page: PAGE, defaultSections: defSecs });
  });
})();
