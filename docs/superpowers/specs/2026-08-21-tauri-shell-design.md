# Tauri Shell — Design Spec

**Date:** 2026-08-21
**Status:** Approved for implementation

## Overview

The desktop shell (`apps/shell/`) that hosts the existing React frontend
(`apps/frontend/`) in a Tauri window and manages the Python engine
(`engine/`) as a child process, so a user (or developer) launches one thing
instead of running two dev servers by hand.

This is the first milestone toward the shell described in
`docs/superpowers/specs/2026-08-20-visual-ml-builder-design.md`'s
architecture and "Local IPC" sections. It deliberately narrows that spec's
scope in two ways, both called out explicitly below: no auth token, and no
PyInstaller-frozen sidecar binary yet.

## Goals

- A single command (`cargo tauri dev`, run from `apps/shell/`) starts the
  Vite dev server, starts the Python engine, waits for the engine to be
  ready, and opens a window showing the app.
- The engine's port is not hardcoded: the shell picks a free port, spawns
  the engine on it, and hands that port to the frontend at startup.
- The frontend keeps working unmodified when run standalone (`npm run dev`
  in a browser, or under Vitest) without a Tauri context — it falls back to
  today's hardcoded `http://127.0.0.1:8000`.
- No orphaned engine processes: the child process is killed when the shell
  exits.

## Non-goals (this milestone)

- **Auth token.** The parent spec's IPC model includes a per-session token
  because *other* local processes (a browser tab's JS doing a loopback port
  probe, or other software on the machine) could otherwise reach the engine
  over `127.0.0.1`. Deliberately dropped for this milestone per product
  decision — cheap to add later if this ever ships broadly.
- **PyInstaller-frozen sidecar binary.** The parent spec's packaging section
  calls for freezing the engine into a standalone binary bundled as a real
  Tauri sidecar. That freeze step doesn't exist yet (it's part of the future
  CI/packaging milestone). This milestone's shell spawns the engine directly
  out of the repo's `.venv` instead — a dev-only stopgap, not a
  distributable artifact.
- Production-build CORS origin (`tauri://localhost` / `http://tauri.localhost`).
  The engine's CORS allowlist (`vmb_engine/api.py`) only allows
  `localhost:5173`/`127.0.0.1:5173` today, which is correct for `cargo tauri
  dev` (window loads the Vite dev URL) but wrong for `cargo tauri build`
  (window loads bundled static files from a `tauri://` origin). Fixing that
  belongs to the packaging milestone, not this one.
- CI, installers, code signing, auto-update — all future packaging work.

## Architecture

```
apps/shell/
  src-tauri/
    Cargo.toml
    tauri.conf.json
    src/
      main.rs / lib.rs   # setup(): pick port, spawn engine, wait-ready
                          # #[tauri::command] engine_base_url()
                          # on-exit: kill engine child process
```

`tauri.conf.json`:
- `beforeDevCommand`: `npm --prefix ../frontend run dev` (resolved relative
  to `apps/shell/`, the app root — `src-tauri`'s parent)
- `devUrl`: `http://localhost:5173`
- `beforeBuildCommand`: `npm --prefix ../frontend run build` (same base as
  `beforeDevCommand` above)
- `frontendDist`: `../../frontend/dist` (resolved relative to `src-tauri/`
  itself — a different base than the two build commands above; confirmed
  empirically during implementation)

This means `cargo tauri dev` alone starts Vite (via Tauri's own process
orchestration) — the shell's Rust code is only responsible for the engine,
not the frontend dev server.

## Engine process management

On startup, before creating the window, the shell's `setup()` hook:

1. Binds a `TcpListener` to `127.0.0.1:0` to obtain an OS-assigned free
   port, then drops the listener (small, accepted race — this isn't a
   multi-tenant server).
2. Spawns `uvicorn vmb_engine.api:app --port <port>`, invoked via the
   repo's `.venv/bin/uvicorn`, located relative to `CARGO_MANIFEST_DIR`
   (compile-time constant pointing at `apps/shell/src-tauri`, so
   `../../../.venv/bin/uvicorn` reaches the repo-root `.venv` regardless of
   the process's runtime working directory). This only works in this dev
   checkout — it is not a stand-in for real sidecar packaging.
3. Polls the port with a plain TCP connect in a short retry loop (~10s
   timeout) so window creation doesn't race the engine's startup time.
4. Stores the child process handle in Tauri's managed state.

A `#[tauri::command] fn engine_base_url(state) -> String` returns
`http://127.0.0.1:<port>` for the frontend to call at startup.

On app exit (window close / `RunEvent::ExitRequested` or `Exit`), the shell
kills the stored child process so no `uvicorn` instance survives the app.

## Frontend config plumbing

`apps/frontend` gains a dependency on `@tauri-apps/api`.

`apps/frontend/src/api/client.ts`'s hardcoded `const BASE_URL =
'http://127.0.0.1:8000'` becomes a module-level variable resolved once at
startup instead of a constant:

- `main.tsx`, before rendering, calls `invoke('engine_base_url')` and
  passes the result into a setter exported from `client.ts`.
- If `invoke` rejects — no Tauri context, which is the case for `npm run
  dev` in a plain browser or under Vitest — `client.ts` keeps its current
  hardcoded `http://127.0.0.1:8000` default. This preserves the existing
  CLAUDE.md workflow of running the frontend standalone against a
  manually-started engine.

No other frontend behavior changes; all existing `fetch` calls in
`client.ts` keep using whatever `BASE_URL` currently resolves to.

## Testing / verification strategy

- **Rust**: little pure logic to unit test (port-picking and process
  spawning are thin wrappers over `std`/Tauri APIs). Verification is
  `cargo build`/`cargo check`, plus an actual `cargo tauri dev` smoke test.
  This WSL2 dev environment has no Rust toolchain and no
  webkit2gtk/GTK dev libraries installed yet; installing them and attempting
  a real window via WSLg (`DISPLAY`/`WAYLAND_DISPLAY` are already set) is
  best-effort for this milestone. If GUI rendering doesn't work out here,
  fall back to build-only verification (`cargo check`) and flag the actual
  windowed smoke test as something to run on a Mac/Windows machine.
- **Frontend**: a unit test for the config-resolution fallback in
  `client.ts` — mock `@tauri-apps/api`'s `invoke`: rejecting falls back to
  the default URL, resolving uses the returned URL.

## Future work (explicitly deferred)

- Per-session auth token on the loopback HTTP connection.
- PyInstaller freeze of the engine into a real Tauri sidecar binary.
- Production CORS origin handling for `cargo tauri build`.
- WebSocket support for training progress (depends on the engine's own
  async execution model, not yet built — see parent spec's Execution Model
  section).
- CI build matrix (`macos-latest`, `windows-latest`) and GitHub Releases
  packaging.
