# MangaDex Latest Enhancer

Chrome extension that adds **tag** and **content-rating** chips to chapter rows on
[mangadex.org/titles/latest](https://mangadex.org/titles/latest), so you can scan
the listing without clicking through.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select this folder (`mangadex-plugin/`).
5. Visit <https://mangadex.org/titles/latest>. Pills should appear next to each manga title within ~1 s.

## How it works

- Content script (`src/content.js`) watches the DOM for chapter rows on `/titles/latest`, extracts manga UUIDs from the title links.
- IDs are debounced (100 ms) and sent in batches to the service worker (`src/background.js`).
- Service worker checks `chrome.storage.local` (7-day TTL); cache misses are fetched from `https://api.mangadex.org/manga?ids[]=...` (max 100 per request).
- Results are rendered as pills next to each title.

No tracking, no analytics, no third-party calls — just MangaDex's public API.

## Files

```
manifest.json          # MV3 manifest
src/content.js         # DOM observer + pill renderer
src/background.js      # fetch + chrome.storage.local cache
src/styles.css         # pill styling
docs/superpowers/specs/ # design docs
```

## Reloading after changes

After editing any file: go to `chrome://extensions`, click the refresh icon on
the **MangaDex Latest Enhancer** card, then reload any open MangaDex tab.
