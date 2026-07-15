/*
 * Static file server for the public website (no dependencies).
 *
 *   node server.js          → http://localhost:4173
 *
 * This serves ONLY static files — HTML, CSS, JS, images, fonts, and the
 * read-only content/*.json files the pages fetch at load time. There is no
 * write API here, so this folder is safe to deploy as-is to any static
 * host (Netlify, Vercel, GitHub Pages, S3, etc.) — editing happens in the
 * separate ../cms tool, which writes into this folder's content/ and
 * assets/images/ directories.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 4173;

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

function serveStatic(req, res, pathname) {
  const rel = decodeURIComponent(pathname);
  let filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) return send(res, 403, 'Forbidden');

  let stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  if (stat && stat.isDirectory()) {
    // Redirect /work/x → /work/x/ so the page's relative asset paths
    // (../../assets/…) resolve correctly. This mirrors GitHub Pages, which
    // adds the trailing slash automatically for directory index pages.
    if (!pathname.endsWith('/')) {
      return send(res, 301, null, { Location: pathname + '/' });
    }
    filePath = path.join(filePath, 'index.html');
    stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  }
  if (!stat) {
    // extensionless page routes like /work/product-decks
    if (!path.extname(filePath) && fs.existsSync(filePath + '.html')) {
      filePath += '.html';
    } else {
      return send(res, 404, '404 — not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
  }
  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  send(res, 200, fs.readFileSync(filePath), { 'Content-Type': type });
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, 'Method not allowed', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    return serveStatic(req, res, pathname);
  } catch (err) {
    console.error(err);
    return send(res, 500, 'Internal error', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
});

server.listen(PORT, () => {
  console.log(`Website: http://localhost:${PORT}/  (static only — edit content via ../cms)`);
});
