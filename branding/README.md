# Librarium branding

Source of truth for the app logo/icon.

**Motif:** an open book whose pages resolve into a small knowledge graph — the
linked-notes identity of Librarium. Monochrome light mark on a neutral
rounded-square gradient tile.

## Files

| File | Purpose |
|------|---------|
| `logo.svg` | Hand-authored vector master (also shipped as `frontend/public/favicon.svg`). |
| `gen_logo.py` | Pillow generator that renders every raster size from one definition. |
| `master-1024.png` | Reference render of the full app icon. |
| `mark-light-512.png` / `mark-dark-512.png` | Standalone monochrome mark (transparent) for in-UI use on dark/light backgrounds. |

## Regenerating the raster set

```
cd branding && python3 gen_logo.py      # writes ./out/*
```

Then copy into place:

- **Tauri app icons** → `crates/librarium-tauri/icons/`
  `icon-32x32.png`, `icon-128x128.png`, `icon-256x256.png`, `icon-512x512.png`, `icon.ico`
  (all referenced in `tauri.conf.json > bundle.icon`; must be RGBA)
- **Tray icons** → `crates/librarium-tauri/icons/`
  `tray-green.png`, `tray-red.png`, `tray-yellow.png` (status-colored simplified mark)
- **Web favicons** → `frontend/public/`
  `favicon.svg`, `favicon-32x32.png`, `favicon-16x16.png`, `apple-touch-icon.png`
  (linked from `frontend/index.html`)

If you change `logo.svg` by hand, mirror the same geometry in `gen_logo.py`
(the two share coordinates) so the raster set stays in sync.
