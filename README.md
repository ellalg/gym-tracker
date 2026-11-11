# Gym Tracker

A small offline-first web app (PWA) for logging sets, reps, weights and RIR on Android.
Plain HTML, CSS and JavaScript — no build step, no framework.

## Files

| File | What it does |
|---|---|
| `program.js` | The training program: days, exercises, targets, rest times, swap alternatives, calisthenics levels. Edit this to change the program. |
| `app.js` | All screens and logic (logging, rest timer, interval timer, history, backup). |
| `db.js` | IndexedDB storage on the phone. |
| `styles.css` | The look. Colours are CSS variables at the top. |
| `sw.js` | Service worker — makes the app work offline. |
| `manifest.webmanifest`, `icons/` | Makes it installable to the home screen. |

## Deploy with GitHub Pages

1. Push to `main`.
2. Repo **Settings → Pages → Build and deployment**: Source *Deploy from a branch*, branch `main`, folder `/ (root)`.
3. After a minute it's live at `https://ellalg.github.io/gym-tracker/`.

## Install on Android

Open the URL in Chrome → ⋮ menu → **Add to Home screen** (or **Install app**). It then opens full-screen and works with no signal.

## Updating

After pushing changes, open the app once while online, close it, and open it again to pick up the new version.
If a change doesn't show up, bump `CACHE` in `sw.js` (e.g. `gym-tracker-v2`).

## Data

Workouts are stored only on the phone. Use **Backup → Export backup (.json)** regularly; **Restore from backup** merges a file back in. The CSV export opens in Google Sheets.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```
