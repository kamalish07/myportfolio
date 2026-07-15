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

const ROOT = __dirname;
const WEBSITE_ROOT = path.join(ROOT, '..', 'website');
const PORT = process.env.PORT || 4174;
const HOST = process.env.HOST || '127.0.0.1';
const CONTENT_FILE = path.join(WEBSITE_ROOT, 'content', 'site.json');
const THEME_FILE = path.join(WEBSITE_ROOT, 'content', 'theme.json');
const BLOCKS_FILE = path.join(WEBSITE_ROOT, 'content', 'blocks.json');
const STYLES_FILE = path.join(WEBSITE_ROOT, 'content', 'styles.json');
const BACKUP_DIR = path.join(ROOT, 'backups');
const UPLOAD_DIR = path.join(WEBSITE_ROOT, 'assets', 'images');
const WEBSITE_ASSETS_DIR = path.join(WEBSITE_ROOT, 'assets');
const MAX_BODY = 25 * 1024 * 1024; // 25 MB

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
        reject(new Error('Body too large'));
        req.destroy();
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
    return sendJson(res, 200, { ok: true, path: '/assets/images/' + file });
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
