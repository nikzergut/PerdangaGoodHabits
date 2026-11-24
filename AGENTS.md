# AGENTS.md

## Project overview
- Desktop habit tracker built with **Tauri v2**.
- Frontend: plain HTML/CSS/JS in `habit-tracker-tauri/src/`.
- Rust backend: `habit-tracker-tauri/src-tauri/`.
- Data is stored by the backend in `habits.json` inside the Tauri app data directory.

## Key paths
- `habit-tracker-tauri/src/index.html` - UI markup.
- `habit-tracker-tauri/src/styles.css` - styles.
- `habit-tracker-tauri/src/main.js` - frontend behavior and Tauri `invoke` calls.
- `habit-tracker-tauri/src-tauri/src/lib.rs` - Tauri commands and persistence.
- `habit-tracker-tauri/src-tauri/tauri.conf.json` - Tauri window/app config.

## Development
Run from `habit-tracker-tauri/`:

```bash
npm install
npm run tauri dev
```

Build:

```bash
npm run tauri build
```

Rust checks:

```bash
cd src-tauri
cargo check
```

## Conventions
- Keep the UI minimal, intentional, and consistent with the existing brutalist/minimal visual direction.
- Preserve accessibility: visible focus, labels/aria for icon-only controls, keyboard usability.
- Frontend talks to Rust only through Tauri commands (`get_board`, `add_habit`, `delete_habit`, `toggle_day`).
- `toggle_day` returns only toggle result (`habitId`, `date`, `completed`); frontend applies it optimistically and rolls back on error.
- Backend keeps store in Tauri managed state and writes to disk on mutations; `get_board` returns completions only for visible days.
- Avoid adding dependencies unless clearly needed; this project currently uses vanilla frontend.
- When changing date/navigation behavior, keep the 14-day board window and anchor-based loading logic coherent.
