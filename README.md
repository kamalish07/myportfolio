# Kamalish — Product Design Portfolio (local copy)

Local import of https://my-site-458e10ea.ploy.build/ with a built-in CMS editor.

The project is split into two independent pieces:

```
├── website/     ← the actual site. Static files only, no write API.
│                  Safe to deploy as-is to any static host. This is what
│                  gets published to GitHub Pages.
├── cms/         ← local-only editing tool. Writes into ../website.
│                  Never deployed.
└── .github/     ← GitHub Actions workflow that deploys website/ to Pages.
```

## Run

Both servers are independent — start whichever you need.

```
node website/server.js     → http://localhost:4173/   (the site)
node cms/server.js          → http://localhost:4174/   (the editor)
```

To edit content, run both at once and open the CMS; its live preview loads
the site from the website server.

## Put it on GitHub

This folder is a git repo. Create an empty repo on GitHub (no README/licence),
then from this folder:

```
git remote add origin https://github.com/<you>/<repo>.git
git branch -M main
git push -u origin main
```

(If you have the GitHub CLI: `gh repo create <repo> --public --source=. --push`.)

## Publish the live site (GitHub Pages, free)

A workflow at `.github/workflows/deploy.yml` publishes **only the `website/`
folder** to GitHub Pages on every push to `main`. The `cms/` folder is never
deployed — it's a local editing tool that writes to disk and must stay off
the public internet.

One-time setup: on GitHub, go to **Settings → Pages → Build and deployment**
and set **Source = GitHub Actions**. Then push. Your site appears at:

```
https://<you>.github.io/<repo>/
```

The site is **path-independent**, so it works whether it's served from that
`/<repo>/` subpath or from a root domain — no configuration needed. (If you
name the repo `<you>.github.io`, it's served at the root instead.)

### Editing after it's live

The CMS only runs on your machine. To update the live site: run the CMS
locally, make your edits (they save into `website/content/…` and
`website/assets/images/…`), then commit and push — the workflow redeploys.

```
git add -A && git commit -m "Update content" && git push
```

## Structure

```
website/
├── index.html                     Home page
├── work/
│   ├── product-wireframes/       Case study page
│   ├── product-decks/            Deck gallery page
│   └── visual-systems/           Case study page
├── assets/
│   ├── css/site.css              Original site stylesheet (fonts localized)
│   ├── fonts/                    Inter + Playfair Display (self-hosted)
│   ├── images/                   All site images (CMS uploads land here too)
│   └── js/
│       ├── render.js             Binds content/site.json into the pages
│       ├── theme-core.js         Turns theme.json into CSS variable overrides
│       └── theme-apply.js        Applies theme.json on load + listens for
│                                  live-preview messages from the CMS
├── content/
│   ├── site.json                 ← ALL editable text/images/links
│   ├── theme.json                ← site-wide colors/fonts
│   ├── blocks.json               ← user-added page sections (Sections tab)
│   └── styles.json               ← per-text font/size/color overrides (Aa)
└── server.js                     Static file server. GET only — no
                                   content-editing endpoint exists here.

cms/
├── index.html                    CMS editor UI (content + appearance)
├── server.js                     Editor server: serves index.html, exposes
│                                  /api/content, /api/theme, /api/upload —
│                                  all writing into ../website — and reads
│                                  ../website/assets for thumbnails/fonts.
│                                  Bound to 127.0.0.1 only.
└── backups/                      Last 20 versions of each saved file
                                   (kept out of website/ on purpose)
```

## Why split like this

`website/` has no write API and no admin code, so it's safe to hand to any
static host (Netlify, Vercel, GitHub Pages, S3, …) exactly as it sits on
disk — there's nothing in it a visitor could use to rewrite your content.
All editing capability lives in `cms/`, which you only ever run locally.

## How editing works

Every page in `website/` has its original content baked in, plus `data-cms`
attributes that bind elements to paths in `content/site.json`, and CSS
variables driven by `content/theme.json`. `render.js` and `theme-apply.js`
fetch that JSON on load and re-render text, images, links, lists, colors,
and fonts — so the pages always reflect what's in the JSON.

The CMS at `cms/` (http://localhost:4174) edits that JSON through its own
server:

- **Save changes** / **Save appearance** (or Ctrl+S for content) writes the
  JSON into `website/content/` and backs up the previous version to
  `cms/backups/`.
- **Upload image…** saves the file into `website/assets/images/` and fills
  in the path.
- PDF URLs: on case-study pages a "View PDF" button appears when `pdfUrl` is
  set; deck-gallery cards become clickable when their `pdfUrl` is set.
- Adding a project card with a new slug only links to `/work/<slug>` —
  create that page by copying one of the existing `website/work/*/index.html`
  files.

Reload an open website tab after saving content to see the change (the
Appearance live preview updates instantly, before saving, via its own
mechanism below).

## Appearance (colors & fonts)

The **Appearance** section at the top of the CMS edits `theme.json` — 5
color tokens (page background, card/panel background, ink, text-on-dark,
accent) and 2 fonts (heading, body), picked from a preset list or a custom
CSS font-family string.

The compiled stylesheet derives its entire palette from these few root
tokens via `var()` and `color-mix()`, so overriding them re-colors every
derived surface (borders, secondary text, card tints, buttons) consistently
— you don't need to touch each one individually.

- Edits show instantly in the built-in preview (use the Home/Wireframes/
  Decks/Visual Systems tabs above it to check every page) before anything is
  saved. Since the CMS and website are different origins/ports, the preview
  updates via `postMessage` rather than reaching into the iframe directly —
  `website/assets/js/theme-apply.js` listens for it from an allow-listed
  CMS origin (`localhost:4174` by default).
- **Save appearance** writes `content/theme.json` and backs it up, just like
  the content editor.
- **Reset to defaults** restores the original ployai design (still requires
  Save to persist).
- Custom fonts must already be installed as a system font — this setup
  doesn't load fonts from the internet, to keep the site fully offline.

## Sections (visual page builder)

The **Sections** tab in the CMS design studio adds free-form sections to the
bottom of any page, edited directly in the live preview:

- **Add section** creates a section; click it (or its blocks) in the preview
  to select. Selected blocks get a toolbar (move ◀ ▶, delete ✕) and a blue
  drag handle to resize their width; sections get ↑ ↓ / + Text / + Image /
  ✕ and a purple bottom handle to set their height.
- **Text blocks**: type straight into the preview. The inspector sets the
  text style (Heading 1–3 / Paragraph / Small), font, size, color, bold,
  alignment, and width.
- **Image blocks**: pick or upload an image in the inspector, set width and
  corner radius.
- **Auto-layout**: blocks sit in a wrapping flex row with a gap — widths are
  % of the row, so deleting or resizing a block reflows the rest and keeps
  everything aligned. Width snaps near 25 / 33 / 50 / 66 / 75 / 100%.
- Each section has its own background color, vertical padding, gap, content
  max-width, min height, and vertical block alignment.
- **Save sections** writes `content/blocks.json` (backed up like the rest).
  Pages render saved sections via `assets/js/sections.js`.

## Per-text styles (Aa buttons)

Every text field in the CMS content editor has an **Aa** button that sets a
font, size, and color for that specific piece of text on the site (e.g. just
the hero title). Overrides live in `content/styles.json`, apply live in the
preview, and save together with **Save changes**. "Clear" removes the
override and returns the text to the theme defaults.

## Changing ports

If you run the website on a different port than 4173, update:
- `window.WEBSITE_ORIGIN` at the top of `cms/index.html`
- `ALLOWED_PREVIEW_ORIGINS` in `website/assets/js/theme-apply.js` (if you
  also move the CMS off port 4174)
