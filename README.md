# Business Expense Deductibility Checker

A static web app that lets users look up whether a given business expense is tax-deductible under Singapore corporate income tax. Data lives in an Excel file that is converted to JSON at Docker build time. Designed for deployment on **Airbase** (Singapore Government static hosting) with strict CSP.

The primary maintenance task is editing the Excel file — just edit and push; the conversion runs automatically during the Docker build.

---

## What it does

Two ways to find an expense:

1. **Search** — type to filter all ~50 expense types (matches the name and, at lower priority, the tax-treatment text).
2. **Browse** — pick an expense type from a dropdown.

Each result shows:
- Expense type title
- The full tax-treatment explanation. Cell formatting from Excel is preserved: blank lines become paragraph breaks, `(i)/(ii)/(iii)` lines render as a numbered list, and `- ` lines render as a bulleted list.
- A "More details on the IRAS website ↗" link (only for entries that have a URL in the Excel)

There's also an "Others" option in the dropdown that walks the user through the four general deductibility conditions as a Yes/No checklist and reports whether all are met.

Other niceties: deep-links via URL hash (`#exp=…`), `Last-Modified` of the data file shown as "Last Updated", "Start over" reset, mobile-first responsive layout, and a collapsible "What makes a business expense deductible?" info box at the top of the page (opened by default, hardcoded in `index.html`).

---

## Project structure

```
expense-deductibility/
├── index.html               Markup. No inline JS, no inline event handlers (CSP-safe).
├── styles.css               IRAS-inspired blue palette, mobile-first.
├── app.js                   All app logic in one IIFE. Fetches data.json, wires UI.
├── logo.png                 IRAS logo, 2400×2400 RGBA.
├── Deductibility.xlsx       The data. Edit this file to update the app.
├── convert.py               Converts Deductibility.xlsx → data.json (runs at Docker build time).
├── Dockerfile               Two-stage build: Python converter + nginx-1.28 final image.
├── airbase.json             Airbase deploy manifest (framework, handle, port).
├── deploy/
│   └── default.conf         Nginx server config (gzip, Cache-Control: no-cache on all assets, port 3000).
├── .dockerignore            Excludes .git, ~$ Excel lock files, lib/, README, etc.
└── README.md                You are here.
```

> **`lib/` is no longer used.** SheetJS has been removed — the Excel-to-JSON conversion now runs in the Docker build via `convert.py`, so the browser never downloads the 273 KB library.

---

## Data model

Only the `Deductibility` sheet of `Deductibility.xlsx` is read — one row per expense type, flat list, no category hierarchy.

The `Deductibility` sheet has 3 columns (header in row 1):

| Expense Type | Tax Treatment | IRAS Website |
|---|---|---|
| Motor vehicle expenses | To qualify for tax deduction, the expense must not be incurred on... | *(optional URL)* |
| Fines/Penalties | Fines and penalties are not deductible as they are... | https://www.iras.gov.sg/... |

Notes:
- Expense Type values must be unique — if two rows share the same name, only the first is used.
- Cell formatting is preserved at render time. The rules are:
  - **Blank lines** within a cell create a paragraph break (vertical gap) in the rendered output.
  - **Lines starting with `(i)`, `(ii)`, `(1)`, etc.** become an `<ol>` list. The rendered marker is always `(i)/(ii)/(iii)…` (lower-roman), regardless of whether the source uses roman or arabic.
  - **Lines starting with `- ` or `• `** become a `<ul>` bulleted list.
  - Everything else flows as a regular paragraph. Single line breaks within the same paragraph are preserved as soft `<br>` line breaks, so manual alt+enter line breaks in Excel render as separate visual lines (with the larger paragraph gap reserved for blank lines).
- `IRAS Website` is optional — rows without a URL simply won't show the link. When present, a "More details on the IRAS website ↗" callout is rendered below the tax-treatment explanation.
- The app reads columns by **header name**, not position — reordering columns in Excel is fine.

---

## Editing the data

Routine workflow:

1. Open `Deductibility.xlsx`.
2. Edit rows in the **`Deductibility`** sheet.
3. Save. Redeploy.

That's it. The app re-derives everything on next load:
- Expense type dropdown (sorted alphabetically), with "Others" appended last
- Search index

**Things you should NOT do:**
- Don't rename the column headers `Expense Type` / `Tax Treatment` / `IRAS Website` (or if you do, also update `CONFIG.columns` in `app.js`).
- Don't rename the `Deductibility` sheet (or update `SHEET_NAME` in `convert.py`).
- Don't give two rows the same Expense Type — only the first would be shown.

If a column is missing or renamed, the page shows a clear error: *"Column(s) "Tax Treatment" not found. Found: …"*

---

## Local development

The app fetches `data.json` at runtime, which requires HTTP — it won't work opened directly via `file://`.

**Step 1 — generate data.json** (once after editing the Excel, requires Python + openpyxl):

```bash
pip install openpyxl   # one-time
python3 convert.py
```

**Step 2 — serve over HTTP:**

```bash
python3 -m http.server 8765
```

Open <http://localhost:8765>. If `index.html` is opened directly via `file://`, the script detects this and shows an explicit error.

In production the conversion runs automatically inside the Docker build — the local step is only needed if you want to preview changes before pushing.

---

## Deployment (Airbase)

Airbase deploys a container; the project includes everything needed:

```
Dockerfile               two-stage build: Python converter + nginx-1.28 final image
convert.py               Excel → JSON conversion script (runs in stage 1)
airbase.json             framework, handle, port (3000)
deploy/default.conf      nginx server config (port hardcoded to 3000)
.dockerignore            keeps junk out of the build context
```

**To deploy:** push to your Airbase project. Airbase builds the Dockerfile, deploys the resulting image, sets `PORT=3000` (matching `airbase.json`), and routes external HTTPS to the container's port 3000.

**To test locally:**

```bash
docker build -t expense-deductibility .
docker run --rm -p 3000:3000 expense-deductibility
# open http://localhost:3000
```

### CSP

Airbase enforces `script-src 'self'` (and a planned `style-src 'self'`). What that means:

- ✅ External `.js` and `.css` files from same origin — fine.
- ❌ Inline `<script>...</script>` blocks — banned.
- ❌ Inline event handlers (`onclick="..."`) — banned. All listeners are attached via `addEventListener` in `app.js`.
- ❌ CDN scripts — banned. Nothing external is loaded; all assets are same-origin.

Reference: <https://docs.app.tc1.airbase.sg/explanation/security-csp/>

### Why the nginx config is baked at build time (not envsubst'd at runtime)

The standard nginx Docker entrypoint substitutes `$PORT` into templates from `/etc/nginx/templates/` and writes the result to `/etc/nginx/conf.d/`. But Airbase runs the container as the non-root `app` user, which doesn't have write access to `/etc/nginx/conf.d/` — so the substitution silently fails and the default config is left in place. We avoid this by copying the final config in at build time, with the listen port hardcoded to `3000`.

**If you change the port in `airbase.json`, also update `deploy/default.conf` and rebuild.**

### Image base image requirements (Airbase)

| Requirement | How we satisfy it |
|---|---|
| Base image from `gdssingapore/airbase:*` | `nginx-1.28` |
| Run as non-root `app` user (UID 999) | `USER app` at end of Dockerfile (already default in base image) |
| `--chown=app:app` on every COPY | Yes |
| Listen on `$PORT` | Hardcoded to `3000` in `deploy/default.conf`; `airbase.json` sets `port: 3000` so Airbase routes accordingly |

---

## Configuration

All edit-friendly values are in one `CONFIG` block at the top of [app.js](app.js):

```js
var CONFIG = {
  dataUrl: "data.json",
  columns: {
    name:      "Expense Type",
    treatment: "Tax Treatment",
    irasLink:  "IRAS Website",
  },
  placeholderValue: "Please select",
  maxSearchResults: 12,
  examples: [ /* curated example chips */ ],
};
```

`examples` lists real `Expense Type` values from the data. Any example whose row no longer exists is silently dropped at runtime — chips disappear, page doesn't break.

The disclaimer text lives in `index.html` (the `.disclaimer` `<p>` in the footer), not in JS.

---

## "Others" checklist

Picking **Others** from the dropdown (or visiting `#exp=Others`) doesn't show a row from the Excel — instead it walks the user through the four general conditions:

1. The expenses are solely incurred in the production of income.
2. The expenses must be incurred (legal liability to pay arose).
3. The expenses are revenue in nature, not capital.
4. The expenses are not prohibited from deduction under the Income Tax Act 1947.

Each is a Yes/No button. Once all four are answered, the panel reveals "Deductible" (all yes) or "Not deductible" (any no) with an explanation. The condition list is hardcoded in `OTHERS_CONDITIONS` near the top of [app.js](app.js); edit there if the four general conditions change. The "Others" option in the dropdown is appended at runtime in `populateExpenseTypes()`.

---

## Key design decisions

### Flat list, no category hierarchy
Earlier versions of the Excel had a two-level category → sub-expense structure with cascading selection. The current Excel is a flat list of expense types, so selection is one step: pick (or search for) an expense type, see its tax treatment.

### Search-first
The search box is the primary input on initial load. Browse-by-expense-type is in a collapsible details element below it — secondary affordance for users who don't know what to search.

### IIFE, no modules, no build
Single file, ~860 lines of vanilla ES5-friendly JS in an IIFE (uses `Map`, `Array.from`, `fetch`, and `Promise` — all supported in current Chrome / Safari / Firefox / Edge). No bundler, no transpilation. Splitting into ES modules would add `<script type="module">` rituals with no real maintainability win at this size.

### Fetch + parse on every load
`data.json` is re-fetched every page load (`cache: "no-cache"`) so updates appear immediately after redeploy. The JSON is small (~40 KB) and requires no client-side parsing library.

### Everything served with `Cache-Control: no-cache`
Not just `data.json` — `index.html`, `app.js`, and `styles.css` too (see `deploy/default.conf`). `no-cache` means "revalidate before use", so browsers still cache and get 304s, but never run a stale `app.js` against a fresh `data.json`. Without this, browser heuristic caching can keep old code alive for days after a redeploy, which breaks the page whenever the data format and code change together.

### Excel → JSON at build time (not in the browser)
`convert.py` runs inside the Docker build (stage 1) and writes `data.json`. The final nginx image serves only static files — no SheetJS shipped to the browser, saving ~273 KB. The team's workflow is unchanged: edit the Excel, push, Airbase rebuilds automatically.

### Hash routing, not History API
`history.replaceState` updates `#exp=…` without polluting browser history. Sharing a URL works; back/forward is unaffected. Simpler than a real router.

### CSP-safe by default
No inline scripts, no `onclick` attrs, all fonts are system fonts (no Google Fonts CDN), all assets same-origin. Should pass Airbase's `script-src 'self'` and a future `style-src 'self'` without changes.

---

## Disclaimer

The disclaimer in the footer reads:

> *This tool is for general understanding and is not meant to comprehensively address all possible issues that arise. The application of tax treatment depends on the totality of facts and circumstances of each case.*

Important to keep — this tool reproduces IRAS guidance content but is not itself an authoritative service.

---

## Tech notes / gotchas

- iOS Safari zooms into form fields with font-size < 16px. The search input and select are both 16px to prevent this.
- The browser's native `<input type="search">` clear button (`::-webkit-search-cancel-button`) is hidden via CSS so it doesn't conflict with our custom clear button.
- The IRAS logo is 2400×2400 PNG. CSS scales it to 80px (mobile) / 96px (desktop) — renders crisply on retina because the source is large.
- `prefers-reduced-motion` is respected — transitions are essentially disabled when set.

---

## File reference

| File | Purpose |
|---|---|
| [index.html](index.html) | Markup, no logic. SVG icons inline. |
| [styles.css](styles.css) | Custom-properties palette, mobile-first, single 640px breakpoint. |
| [app.js](app.js) | All logic. Top-of-file comment block lists what's safe to edit. |
| [convert.py](convert.py) | Converts `Deductibility.xlsx` → `data.json`. Runs at Docker build time. |
| [Deductibility.xlsx](Deductibility.xlsx) | Source of truth. Only the `Deductibility` sheet is read by `convert.py`. |
| [logo.png](logo.png) | IRAS logo, 2400×2400 RGBA, transparent background. |
