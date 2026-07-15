/*
 * CMS server — local-only editing tool (no dependencies).
 *
 *   node server.js          → http://localhost:4174/
 *
 * Serves the admin editor UI and its write API. This is deliberately kept
 * out of ../website so that folder stays a plain static site with no
 * content-editing endpoint reachable when deployed. This server:
 *
 *   - reads/writes ../website/content/site.json and theme.json
 *   - saves uploaded images into ../website/assets/images/
 *   - backs up every save to ./backups (kept out of the deployable site)
 *   - proxies GET /assets/* from ../website/assets so the editor can show
 *     image thumbnails and load the shared theme-core.js
 *
 * Bound to 127.0.0.1 only — this tool can rewrite site content, so it is
 * not exposed beyond the local machine.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = __dirname;
const WEBSITE_ROOT = path.join(ROOT, '..', 'website');
const PORT = process.env.PORT || 4174;
const HOST = process.env.HOST || '127.0.0.1';
const CONTENT_FILE = path.join(WEBSITE_ROOT, 'content', 'site.json');
const THEME_FILE = path.join(WEBSITE_ROOT, 'content', 'theme.json');
const BLOCKS_FILE = path.join(WEBSITE_ROOT, 'content', 'blocks.json');
const STYLES_FILE = path.join(WEBSITE_ROOT, 'content', 'styles.json');
const PAGES_FILE = path.join(WEBSITE_ROOT, 'content', 'pages.json');
const BACKUP_DIR = path.join(ROOT, 'backups');
const UPLOAD_DIR = path.join(WEBSITE_ROOT, 'assets', 'images');
const WEBSITE_ASSETS_DIR = path.join(WEBSITE_ROOT, 'assets');
const MAX_BODY = 100 * 1024 * 1024; // 100 MB

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({ 'Cache-Control': 'no-store' }, headers));
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        // Prevent further data processing but don't destroy immediately, 
        // to allow a proper 500 error response to be sent back.
        reject(new Error('Image is too large (exceeds 100MB limit). Please compress it and try again.'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function safeName(name) {
  return String(name).replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^\.+/, '').slice(0, 120) || 'upload';
}

function safeSlug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'new-page';
}

function saveJsonWithBackup(file, prefix, data) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (fs.existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(file, path.join(BACKUP_DIR, `${prefix}-${stamp}.json`));
    // keep the 20 most recent backups for this prefix
    const backups = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith(prefix + '-') && f.endsWith('.json')).sort();
    while (backups.length > 20) fs.unlinkSync(path.join(BACKUP_DIR, backups.shift()));
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// Automatically commit and push changes to GitHub
let pushTimeout = null;
function gitCommitAndPush() {
  // Debounce pushes to avoid spamming git if many small saves happen quickly
  if (pushTimeout) clearTimeout(pushTimeout);
  pushTimeout = setTimeout(() => {
    console.log('[Git] Committing and pushing changes...');
    const cmd = 'git add . && git commit -m "CMS Content Update" && git push';
    exec(cmd, { cwd: path.join(ROOT, '..') }, (error, stdout, stderr) => {
      if (error) {
        // It's normal for commit to fail if there are no changes
        if (!stdout.includes('nothing to commit')) {
          console.error('[Git] Push error:', error.message);
        }
        return;
      }
      console.log('[Git] Changes pushed to GitHub successfully.');
    });
  }, 2000); // Wait 2 seconds after the last save before pushing
}

function getPages() {
  if (fs.existsSync(PAGES_FILE)) {
    try { return JSON.parse(fs.readFileSync(PAGES_FILE, 'utf8')); } catch (e) {}
  }
  // Default pages that already exist as static HTML
  return {
    pages: [
      { slug: 'home', path: '/', label: 'Home', builtin: true },
      { slug: 'product-wireframes', path: '/work/product-wireframes/', label: 'Wireframes', builtin: true },
      { slug: 'product-decks', path: '/work/product-decks/', label: 'Decks', builtin: true },
      { slug: 'visual-systems', path: '/work/visual-systems/', label: 'Visual Systems', builtin: true },
    ]
  };
}

function generatePageHtml(title, slug) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" type="image/x-icon" href="../../favicon.ico">
<title>${title} — Kamalish</title>
<meta name="description" content="${title}">
<link rel="stylesheet" href="../../assets/css/site.css">
<script src="../../assets/js/theme-core.js"></script>
<script src="../../assets/js/theme-apply.js"></script>
<script src="../../assets/js/render.js" defer></script>
<script src="../../assets/js/sections.js" defer></script>
</head>
<body>
<div class="project-page min-h-screen bg-ploy-background-primary text-ploy-text-primary">

<header class="nav border-b border-ploy-border-primary bg-ploy-background-primary text-ploy-text-primary">
  <nav class="nav__container mx-auto flex min-h-18 max-w-7xl items-center justify-between gap-4 px-5 md:px-8" aria-label="Primary navigation">
    <a class="nav__logo font-heading text-2xl font-semibold tracking-tight md:text-3xl" href="../../" aria-label="Kamalish portfolio home" data-cms="site.nav.logo">Kamalish</a>
    <div class="nav__actions flex items-center justify-end gap-5">
      <a class="nav__link text-sm text-ploy-text-primary transition-opacity hover:opacity-55" href="../../#work" data-cms="site.nav.links.0.label" data-cms-href="site.nav.links.0.href">Projects</a>
      <a class="nav__link hidden text-sm text-ploy-text-primary transition-opacity hover:opacity-55 sm:inline" href="../../#about" data-cms="site.nav.links.1.label" data-cms-href="site.nav.links.1.href">Profile</a>
    </div>
  </nav>
</header>

<main class="project-page__main">

  <section class="project-hero border-b border-ploy-border-primary px-5 py-14 md:px-8 md:py-20" data-default-section="hero" data-default-label="Hero">
    <div class="project-hero__container mx-auto max-w-7xl">
      <a class="project-hero__back inline-flex items-center gap-2 text-sm transition-opacity hover:opacity-55" href="../../#work">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-left project-hero__back-icon size-4" aria-hidden="true"><path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path></svg>All projects</a>
      <div class="project-hero__grid mt-12 grid gap-10 md:grid-cols-[1.4fr_0.6fr] md:items-end">
        <div class="project-hero__copy">
          <h1 class="project-hero__title mt-4 max-w-4xl font-heading text-balance text-5xl leading-[1.02] tracking-tight md:text-7xl">${title}</h1>
          <p class="project-hero__summary mt-6 max-w-xl text-lg leading-relaxed text-ploy-text-secondary">Add a description for this page.</p>
        </div>
      </div>
    </div>
  </section>

<div class="custom-sections" data-page="${slug}"></div>
</main>

<footer class="footer bg-ploy-background-inverse text-ploy-text-inverse" id="about" data-default-section="footer" data-default-label="Footer">
  <div class="footer__container mx-auto grid max-w-7xl gap-14 px-5 py-16 md:grid-cols-[1.4fr_1fr] md:px-8 md:py-24">
    <div class="footer__statement max-w-2xl">
      <h2 class="footer__title font-heading text-balance text-4xl leading-tight tracking-tight md:text-6xl" data-cms="site.footer.title">Clear thinking deserves a clear form.</h2>
      <p class="footer__copy mt-6 max-w-lg text-base text-ploy-text-inverse-secondary" data-cms="site.footer.copy">This portfolio is designed to grow with real decks, wireframes, visual systems, and detailed project stories.</p>
    </div>
    <div class="footer__meta flex flex-col justify-between gap-10 border-t border-ploy-border-inverse pt-6 md:border-l md:border-t-0 md:pl-10 md:pt-0">
      <div class="footer__links flex flex-col gap-3" data-cms-list="site.footer.links">
        <template><a class="footer__link text-sm transition-opacity hover:opacity-60" data-f="label" data-f-href="href"></a></template>
        <a class="footer__link text-sm transition-opacity hover:opacity-60" href="../../#work">Selected work</a>
        <a class="footer__link text-sm transition-opacity hover:opacity-60" href="../../#experience">Experience</a>
        <a class="footer__link text-sm transition-opacity hover:opacity-60" href="../../">Home</a>
      </div>
      <div class="footer__bottom flex items-center justify-between gap-4">
        <p class="footer__copyright text-sm text-ploy-text-inverse-secondary">© <span data-cms="site.footer.copyrightYear">2026</span> <span data-cms="site.footer.copyrightName">Kamalish</span></p>
      </div>
    </div>
  </div>
</footer>

</div>
</body>
</html>
`;
}

async function handleApi(req, res, pathname) {
  if (pathname === '/api/content' && req.method === 'GET') {
    const raw = fs.readFileSync(CONTENT_FILE, 'utf8');
    return send(res, 200, raw, { 'Content-Type': 'application/json; charset=utf-8' });
  }

  if (pathname === '/api/content' && req.method === 'POST') {
    const body = await readBody(req);
    let data;
    try {
      data = JSON.parse(body.toString('utf8'));
    } catch (e) {
      return sendJson(res, 400, { error: 'Invalid JSON' });
    }
    if (!data || typeof data !== 'object' || !data.site || !data.home) {
      return sendJson(res, 400, { error: 'Content must include "site" and "home" sections' });
    }
    saveJsonWithBackup(CONTENT_FILE, 'site', data);
    gitCommitAndPush();
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/theme' && req.method === 'GET') {
    const raw = fs.readFileSync(THEME_FILE, 'utf8');
    return send(res, 200, raw, { 'Content-Type': 'application/json; charset=utf-8' });
  }

  if (pathname === '/api/theme' && req.method === 'POST') {
    const body = await readBody(req);
    let theme;
    try {
      theme = JSON.parse(body.toString('utf8'));
    } catch (e) {
      return sendJson(res, 400, { error: 'Invalid JSON' });
    }
    if (!theme || typeof theme !== 'object' || !theme.colors || !theme.fonts) {
      return sendJson(res, 400, { error: 'Theme must include "colors" and "fonts" sections' });
    }
    saveJsonWithBackup(THEME_FILE, 'theme', theme);
    gitCommitAndPush();
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/blocks' && req.method === 'GET') {
    const raw = fs.existsSync(BLOCKS_FILE) ? fs.readFileSync(BLOCKS_FILE, 'utf8') : '{"pages":{}}';
    return send(res, 200, raw, { 'Content-Type': 'application/json; charset=utf-8' });
  }

  if (pathname === '/api/blocks' && req.method === 'POST') {
    const body = await readBody(req);
    let blocks;
    try {
      blocks = JSON.parse(body.toString('utf8'));
    } catch (e) {
      return sendJson(res, 400, { error: 'Invalid JSON' });
    }
    if (!blocks || typeof blocks !== 'object' || !blocks.pages || typeof blocks.pages !== 'object') {
      return sendJson(res, 400, { error: 'Blocks must include a "pages" object' });
    }
    saveJsonWithBackup(BLOCKS_FILE, 'blocks', blocks);
    gitCommitAndPush();
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/styles' && req.method === 'GET') {
    const raw = fs.existsSync(STYLES_FILE) ? fs.readFileSync(STYLES_FILE, 'utf8') : '{"overrides":{}}';
    return send(res, 200, raw, { 'Content-Type': 'application/json; charset=utf-8' });
  }

  if (pathname === '/api/styles' && req.method === 'POST') {
    const body = await readBody(req);
    let styles;
    try {
      styles = JSON.parse(body.toString('utf8'));
    } catch (e) {
      return sendJson(res, 400, { error: 'Invalid JSON' });
    }
    if (!styles || typeof styles !== 'object' || !styles.overrides || typeof styles.overrides !== 'object') {
      return sendJson(res, 400, { error: 'Styles must include an "overrides" object' });
    }
    saveJsonWithBackup(STYLES_FILE, 'styles', styles);
    gitCommitAndPush();
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/upload' && req.method === 'POST') {
    const body = await readBody(req);
    let payload;
    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch (e) {
      return sendJson(res, 400, { error: 'Invalid JSON' });
    }
    const { name, dataBase64 } = payload || {};
    if (!name || !dataBase64) return sendJson(res, 400, { error: 'name and dataBase64 required' });
    const ext = path.extname(safeName(name)).toLowerCase();
    if (!['.webp', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.pdf'].includes(ext)) {
      return sendJson(res, 400, { error: 'Unsupported file type: ' + ext });
    }
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    let file = safeName(name);
    let target = path.join(UPLOAD_DIR, file);
    let i = 1;
    while (fs.existsSync(target)) {
      file = safeName(name).replace(ext, '') + '-' + i + ext;
      target = path.join(UPLOAD_DIR, file);
      i += 1;
    }
    fs.writeFileSync(target, Buffer.from(dataBase64, 'base64'));
    gitCommitAndPush();
    return sendJson(res, 200, { ok: true, path: '/assets/images/' + file });
  }

  // ---- Pages API ----
  if (pathname === '/api/pages' && req.method === 'GET') {
    return sendJson(res, 200, getPages());
  }

  if (pathname === '/api/pages' && req.method === 'POST') {
    const body = await readBody(req);
    let payload;
    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch (e) {
      return sendJson(res, 400, { error: 'Invalid JSON' });
    }
    const { title } = payload || {};
    if (!title || typeof title !== 'string' || !title.trim()) {
      return sendJson(res, 400, { error: 'title is required' });
    }
    const slug = safeSlug(title);
    const pagePath = '/work/' + slug + '/';
    const pageDir = path.join(WEBSITE_ROOT, 'work', slug);

    // Check if page already exists
    if (fs.existsSync(pageDir)) {
      return sendJson(res, 400, { error: 'A page with slug "' + slug + '" already exists' });
    }

    // Create the page directory and HTML
    fs.mkdirSync(pageDir, { recursive: true });
    fs.writeFileSync(path.join(pageDir, 'index.html'), generatePageHtml(title, slug), 'utf8');

    // Register in pages.json
    const pagesData = getPages();
    pagesData.pages.push({ slug, path: pagePath, label: title, builtin: false });
    saveJsonWithBackup(PAGES_FILE, 'pages', pagesData);

    // Initialize an empty entry in blocks.json
    let blocksData = { pages: {} };
    if (fs.existsSync(BLOCKS_FILE)) {
      try { blocksData = JSON.parse(fs.readFileSync(BLOCKS_FILE, 'utf8')); } catch (e) {}
    }
    if (!blocksData.pages[slug]) {
      blocksData.pages[slug] = { sections: [] };
      saveJsonWithBackup(BLOCKS_FILE, 'blocks', blocksData);
    }

    gitCommitAndPush();
    return sendJson(res, 200, { ok: true, slug, path: pagePath, label: title });
  }

  if (pathname === '/api/pages' && req.method === 'DELETE') {
    const body = await readBody(req);
    let payload;
    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch (e) {
      return sendJson(res, 400, { error: 'Invalid JSON' });
    }
    const { slug } = payload || {};
    if (!slug) return sendJson(res, 400, { error: 'slug is required' });

    const pagesData = getPages();
    const pageEntry = pagesData.pages.find((p) => p.slug === slug);
    if (!pageEntry) return sendJson(res, 404, { error: 'Page not found' });
    if (pageEntry.builtin) return sendJson(res, 400, { error: 'Cannot delete a built-in page' });

    // Remove page directory
    const pageDir = path.join(WEBSITE_ROOT, 'work', slug);
    if (fs.existsSync(pageDir)) {
      fs.rmSync(pageDir, { recursive: true, force: true });
    }

    // Remove from pages.json
    pagesData.pages = pagesData.pages.filter((p) => p.slug !== slug);
    saveJsonWithBackup(PAGES_FILE, 'pages', pagesData);

    gitCommitAndPush();
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'Not found' });
}

// Read-only passthrough so the editor can show image thumbnails and load
// the shared theme-core.js without duplicating website/assets.
function serveWebsiteAsset(req, res, pathname) {
  const rel = decodeURIComponent(pathname).replace(/^\/assets\//, '');
  const filePath = path.normalize(path.join(WEBSITE_ASSETS_DIR, rel));
  if (!filePath.startsWith(WEBSITE_ASSETS_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  send(res, 200, fs.readFileSync(filePath), { 'Content-Type': type });
}

function serveAdminUi(req, res, pathname) {
  if (pathname === '/' || pathname === '/index.html') {
    return send(res, 200, fs.readFileSync(path.join(ROOT, 'index.html')), { 'Content-Type': 'text/html; charset=utf-8' });
  }
  return send(res, 404, '404 — not found', { 'Content-Type': 'text/plain; charset=utf-8' });
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  try {
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
    if (pathname.startsWith('/assets/')) return serveWebsiteAsset(req, res, pathname);
    return serveAdminUi(req, res, pathname);
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, { error: String(err.message || err) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`CMS: http://localhost:${PORT}/  (writes into ${WEBSITE_ROOT})`);
});
