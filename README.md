# PerdangaGoodHabits

[![Live demo](https://img.shields.io/badge/demo-GitHub%20Pages-2ea44f)](https://nikzergut.github.io/PerdangaGoodHabits/)
[![Deploy Pages](https://github.com/nikzergut/PerdangaGoodHabits/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/nikzergut/PerdangaGoodHabits/actions/workflows/deploy-pages.yml)

A small, fast habit tracker that runs both as a **desktop app** (Tauri v2 + Rust) and as a **static web app** from the exact same frontend source. No frameworks, no frontend build step, no backend service required for the web version.

**[Open the web demo →](https://nikzergut.github.io/PerdangaGoodHabits/)**

## Features

- Add and delete habits
- 14-day rolling board with previous / next navigation and a **Today** button
- Click any cell to toggle a completion for that habit and day
- A wider 60-day window is supported by the backend date logic
- Dark / light theme toggle
- Atomic, recoverable local storage:
  - desktop: `habits.json` in the Tauri app data directory, written via a temporary file and backup
  - web: `localStorage`, with corrupt data moved to a separate key instead of breaking startup
- Date validation (1900–2100) on both frontend and backend
- Single desktop instance: launching the app again focuses the running window instead of opening a second copy that could overwrite data
- The same `src/` folder powers both desktop and web — no duplicated UI code

## Tech stack

| Layer | Technology |
| --- | --- |
| Desktop shell | Tauri v2 |
| Backend | Rust, `chrono`, `serde` |
| Frontend | Plain HTML, CSS, ES modules (no bundler) |
| Web hosting | GitHub Pages (static files) |
| Tests | Rust unit tests (`cargo test`), Node smoke test (`npm run test:web`) |

## Repository layout

```text
.
├── habit-tracker-tauri/
│   ├── src/                  # frontend: shared by desktop and web
│   │   ├── api.js            # Tauri invoke ↔ localStorage adapter
│   │   ├── index.html
│   │   ├── main.js
│   │   └── styles.css
│   ├── src-tauri/            # Rust backend and Tauri configuration
│   ├── scripts/              # web server, Windows build, web smoke test
│   ├── package.json
│   └── README.md
├── .github/workflows/deploy-pages.yml
├── AGENTS.md                 # local development conventions
└── REVIEW.md                 # code audit and fix progress
```

## Quick start

### Web (no install)

Just open the [live demo](https://nikzergut.github.io/PerdangaGoodHabits/). Data is kept in that browser's `localStorage`.

To serve it locally:

```bash
cd habit-tracker-tauri
npm install
npm run dev:web
```

Then open <http://localhost:5173>. In web mode a small **web** badge appears in the header.

Deploying is equally simple: upload the contents of `habit-tracker-tauri/src/` to any static host. GitHub Pages deployment is automated by the workflow in `.github/workflows/deploy-pages.yml` and publishes that folder on every push to `main`.

### Desktop

Requirements: Node.js, Rust, and Tauri v2 system dependencies (WebView2 is normally preinstalled on Windows).

```bash
cd habit-tracker-tauri
npm install
npm run tauri dev
```

Production build:

```bash
npm run tauri build
```

Portable Windows release binary without an MSI/NSIS bundle:

```bash
npm run build:win
```

The result is copied to `habit-tracker-tauri/build/windows/PerdangaGoodHabits.exe`. MSI/NSIS installers additionally require WiX Toolset or NSIS; once installed, `npm run tauri build` produces them as usual.

## Checks

```bash
cd habit-tracker-tauri

# Frontend syntax
node --check src/api.js
node --check src/main.js

# Web adapter smoke test
npm run test:web

# Rust
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

## Data and privacy

- Nothing is sent anywhere. The desktop app reads and writes one local JSON file; the web app only uses browser storage.
- Desktop and web data are **not synchronized**. They are two separate stores with the same shape.
- A damaged JSON file is backed up (`habits.json.bak`) and the app starts with an empty store instead of failing to launch. The web equivalent is `habit-tracker-store-broken`.

## Notes

`REVIEW.md` tracks an ongoing audit and which findings have already been fixed. Contributions and issue reports are welcome.
