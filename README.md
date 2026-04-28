# MangaDex QOL Chrome Extension

Chrome extension that adds quality-of-life enhancements to
[MangaDex](https://mangadex.org/) listing pages:

- **v0.1** — Tag and content-rating chips next to manga titles on
  `/titles/latest`, with a `+N` overflow tooltip.
- **v0.2** — Visual parity with the chips MangaDex shows natively on
  `/titles/recent`. Tag chips colored by group (genre/theme = accent,
  format = purple, content = red). Pornographic ratings labeled "MATURE".
- **v0.3** — Colored left-edge stripes on every listing row indicating
  the manga's reading status in your library (Reading / Plan to Read /
  Completed / On Hold / Re-reading / Dropped). Manga not in your library
  get no stripe. Read-only — does not modify your library.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. **Load unpacked** → select this folder.
4. Visit any of these pages to see it in action:
   - <https://mangadex.org/titles/latest>
   - <https://mangadex.org/titles/recent>
   - <https://mangadex.org/search>
   - any `/list/{id}` page

## How it works

### Pills (v0.1, v0.2)

- Content script watches the DOM for chapter rows on listing pages.
- Manga UUIDs are batched, debounced, and resolved against
  `https://api.mangadex.org/manga?ids[]=...` (max 100 per request).
- Results cached in `chrome.storage.local` for 7 days, keyed by manga ID.
- Pills render using MangaDex's own Tailwind classes (`bg-accent`,
  `bg-status-*`) so they inherit the site's tokens and follow theme switches.

### Library stripes (v0.3)

- On boot, scans `mangadex.org` localStorage for a JWT-shaped value whose
  decoded claims look MangaDex-related. Token is sent to the service worker
  and stored in `chrome.storage.session` (cleared on browser close, never
  written to disk).
- Service worker calls `https://api.mangadex.org/manga/status` with
  `Authorization: Bearer {token}`. The endpoint returns the entire library
  in a single call.
- Statuses cached for 5 minutes (also `chrome.storage.session`).
- A CSS class is added to each row anchor; a `::before` pseudo-element
  draws a 4px colored stripe on the left edge.
- If you're not logged in, or no JWT is found, the feature silently
  no-ops — no errors, no extra requests.

No tracking, no analytics, no third-party calls — only `api.mangadex.org`.

## Files

```
manifest.json
src/
├── content.js           # DOM observation, JWT discovery, pill + stripe renderers
├── background.js        # API fetch (manga attrs + library status), caches
└── styles.css           # pill styling + stripe color rules
docs/superpowers/specs/  # design docs for v0.1, v0.2, v0.3
```

## Reloading after changes

Edit a file → `chrome://extensions` → click the refresh icon on this
extension's card → reload any open MangaDex tab.

## Color reference

### Content-rating chips

| Rating | Color |
|---|---|
| Safe | sky-900 (`#0c4a6e`) |
| Suggestive | orange |
| Erotica / Mature | red |

### Tag chips (by group)

| Group | Color |
|---|---|
| Genre / Theme | MangaDex `bg-accent` |
| Format | purple |
| Content (Gore, Sexual Violence) | red |

### Library stripes (by reading status)

| Status | Color |
|---|---|
| Reading | green (`#16a34a`) |
| Re-reading | cyan (`#06b6d4`) |
| Plan to Read | amber (`#f59e0b`) |
| Completed | indigo (`#6366f1`) |
| On Hold | slate (`#64748b`) |
| Dropped | red (`#ef4444`) |
