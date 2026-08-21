# Tauri Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Tauri (Rust) desktop shell at `apps/shell/` that spawns the
Python engine as a dev-mode child process on a free port, waits for it to be
ready, exposes that port to the React frontend, and cleans up the child
process on exit — so `cargo tauri dev` replaces "start two dev servers by
hand."

**Architecture:** A hand-scaffolded Tauri v2 project (no `create-tauri-app`
scaffolding — its templates assume a co-located frontend, ours lives in a
sibling directory). A pure, tauri-free `engine.rs` module owns port-picking,
process-spawning, readiness-polling, and process-killing as unit-testable
functions; `main.rs` wires that module into Tauri's app lifecycle (`setup`
equivalent done inline in `main()` before `.build()`, cleanup in the
`RunEvent` handler passed to `.run()`). The frontend gets a thin config layer
in `client.ts` that asks Tauri for the engine's base URL at startup and falls
back to today's hardcoded URL outside a Tauri context.

**Tech Stack:** Rust (Tauri v2, `std::process`/`std::net` only — no async
runtime needed since this is one-shot startup logic), existing
React/TypeScript frontend, existing Python/FastAPI engine (unmodified).

**Spec:** `docs/superpowers/specs/2026-08-21-tauri-shell-design.md`

## Global Constraints

- No auth token on the loopback HTTP connection (explicit non-goal — see spec).
- The engine is spawned via the repo's `.venv/bin/uvicorn`, not a
  PyInstaller-frozen binary — this only works in this dev checkout and is not
  a stand-in for real sidecar packaging (explicit non-goal — see spec).
- `apps/frontend`'s standalone workflow (`npm run dev` in a plain browser,
  `npm test`) must keep working unmodified — `client.ts` must fall back to
  `http://127.0.0.1:8000` when there's no Tauri context.
- No changes to the engine's CORS allowlist or `vmb_engine/api.py` — dev mode
  loads `http://localhost:5173`, already an allowed origin.
- `engine.rs` must not import any `tauri::` types, so its tests run under
  plain `cargo test` with no display/webview required.

---

### Task 1: Install prerequisites and hand-scaffold the Tauri project

**Files:**
- Create: `apps/shell/src-tauri/Cargo.toml`
- Create: `apps/shell/src-tauri/build.rs`
- Create: `apps/shell/src-tauri/tauri.conf.json`
- Create: `apps/shell/src-tauri/src/main.rs`

**Interfaces:**
- Produces: a `cargo check`-clean Tauri v2 project at
  `apps/shell/src-tauri/` with a window that (in dev mode) loads
  `http://localhost:5173`. No engine process management yet — that's Task 2/3.

- [ ] **Step 1: Install Linux GUI prerequisites for Tauri v2 (Ubuntu/Debian)**

```bash
sudo apt update && sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

- [ ] **Step 2: Install the Rust toolchain (non-interactive)**

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustc --version
cargo --version
```

Expected: both print version numbers.

- [ ] **Step 3: Install the Tauri CLI**

```bash
source "$HOME/.cargo/env"
cargo install tauri-cli --version "^2.0.0" --locked
cargo tauri --version
```

Expected: prints a `2.x.y` version. This step compiles from source and can
take several minutes — use a long timeout (10 minutes) if running
non-interactively.

- [ ] **Step 4: Create the project directories**

```bash
mkdir -p apps/shell/src-tauri/src
```

- [ ] **Step 5: Write `Cargo.toml`**

```toml
[package]
name = "vmb-shell"
version = "0.1.0"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }

[[bin]]
name = "vmb-shell"
path = "src/main.rs"
```

- [ ] **Step 6: Write `build.rs`**

```rust
fn main() {
    tauri_build::build()
}
```

- [ ] **Step 7: Write `tauri.conf.json`**

`beforeDevCommand`/`beforeBuildCommand` are resolved by tauri-cli relative to
the "app root" — `apps/shell/` (this file's parent directory, i.e.
`src-tauri`'s parent) — so reaching the sibling `apps/frontend` from there
needs only one `../`: `npm --prefix ../frontend run dev` /
`run build`.

`frontendDist`, however, is resolved relative to this file's own directory
(`apps/shell/src-tauri/`) — a *different* base than the other two build
keys. This asymmetry was confirmed empirically (an isolated throwaway Tauri
project was built to verify it) after an earlier draft of this plan wrongly
assumed all three paths shared the same base and used `../../frontend` for
all of them, which broke `beforeDevCommand`/`beforeBuildCommand` (there is no
`apps/shell/frontend`). Since `src-tauri` is two levels below `apps/frontend`,
`frontendDist` needs `../../frontend/dist` to reach `apps/frontend/dist`.

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Visual Model Builder",
  "version": "0.1.0",
  "identifier": "com.vmb.app",
  "build": {
    "beforeDevCommand": "npm --prefix ../frontend run dev",
    "beforeBuildCommand": "npm --prefix ../frontend run build",
    "devUrl": "http://localhost:5173",
    "frontendDist": "../../frontend/dist"
  },
  "app": {
    "windows": [
      {
        "title": "Visual Model Builder",
        "width": 1280,
        "height": 800
      }
    ]
  },
  "bundle": {
    "active": false,
    "icon": []
  }
}
```

- [ ] **Step 8: Write a minimal `src/main.rs` (no engine logic yet)**

```rust
fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 9: Verify it compiles**

```bash
cd apps/shell/src-tauri && cargo check
```

Expected: compiles with no errors (warnings OK). If `tauri.conf.json`
validation fails, read the error message — the exact field names can drift a
little between Tauri 2.x minor versions — and adjust the field names above
to match while keeping the same values and directory structure.

- [ ] **Step 10: Commit**

```bash
git add apps/shell
git commit -m "Scaffold the Tauri shell project

Hand-scaffolded rather than via create-tauri-app, since its templates
assume a co-located frontend and ours lives in a sibling directory.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UgGcdqRptAMjXrapHKXxNe"
```

---

### Task 2: `engine.rs` — pure, testable process-management functions

**Files:**
- Create: `apps/shell/src-tauri/src/engine.rs`
- Modify: `apps/shell/src-tauri/src/main.rs` (add `mod engine;`)

**Interfaces:**
- Consumes: nothing from Task 1 beyond the crate skeleton.
- Produces (used by Task 3):
  - `pub fn pick_free_port() -> std::io::Result<u16>`
  - `pub fn spawn_engine(port: u16) -> std::io::Result<std::process::Child>`
  - `pub fn wait_for_ready(port: u16, timeout: std::time::Duration) -> bool`
  - `pub fn kill_engine(child: &mut std::process::Child)`

- [ ] **Step 1: Write `src/engine.rs` with the functions and their tests together**

```rust
use std::io;
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::time::{Duration, Instant};

pub fn pick_free_port() -> io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    listener.local_addr().map(|addr| addr.port())
}

fn venv_dir() -> PathBuf {
    // CARGO_MANIFEST_DIR is apps/shell/src-tauri; the repo's .venv is three
    // levels up (src-tauri -> shell -> apps -> repo root). This only ever
    // resolves correctly in this dev checkout, not in a packaged build.
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../.venv")
}

pub fn spawn_engine(port: u16) -> io::Result<Child> {
    let uvicorn = venv_dir().join("bin").join("uvicorn");
    Command::new(uvicorn)
        .args(["vmb_engine.api:app", "--port", &port.to_string()])
        .spawn()
}

pub fn wait_for_ready(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

pub fn kill_engine(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pick_free_port_returns_a_port_that_is_free_again_immediately() {
        let port = pick_free_port().expect("should find a free port");
        assert!(port > 0);
        TcpListener::bind(("127.0.0.1", port)).expect("port should be free to rebind");
    }

    #[test]
    fn wait_for_ready_returns_true_when_something_is_listening() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(wait_for_ready(port, Duration::from_secs(1)));
    }

    #[test]
    fn wait_for_ready_times_out_when_nothing_is_listening() {
        let port = pick_free_port().unwrap();
        assert!(!wait_for_ready(port, Duration::from_millis(300)));
    }

    #[test]
    fn kill_engine_terminates_the_child_process() {
        let mut child = Command::new("sleep")
            .arg("30")
            .spawn()
            .expect("should spawn sleep");
        kill_engine(&mut child);
        let status = child.try_wait().expect("try_wait should not error");
        assert!(status.is_some(), "child should have exited after kill_engine");
    }
}
```

- [ ] **Step 2: Run the tests and confirm they fail to compile first (module not wired in yet)**

Run: `cd apps/shell/src-tauri && cargo test`
Expected: compile error, `engine` module not found — confirms the test file
exists but isn't reachable yet.

- [ ] **Step 3: Add `mod engine;` to `src/main.rs`**

```rust
mod engine;

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: Run the tests again and confirm they pass**

Run: `cd apps/shell/src-tauri && cargo test`
Expected: 4 tests pass (`pick_free_port_returns_a_port_that_is_free_again_immediately`,
`wait_for_ready_returns_true_when_something_is_listening`,
`wait_for_ready_times_out_when_nothing_is_listening`,
`kill_engine_terminates_the_child_process`).

- [ ] **Step 5: Commit**

```bash
git add apps/shell/src-tauri/src/engine.rs apps/shell/src-tauri/src/main.rs
git commit -m "Add tauri-free engine process-management functions

Kept free of tauri:: types so cargo test runs without a display/webview.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UgGcdqRptAMjXrapHKXxNe"
```

---

### Task 3: Wire the engine lifecycle into the Tauri app

**Files:**
- Modify: `apps/shell/src-tauri/src/main.rs`

**Interfaces:**
- Consumes: `engine::pick_free_port`, `engine::spawn_engine`,
  `engine::wait_for_ready`, `engine::kill_engine` from Task 2.
- Produces: a `#[tauri::command] engine_base_url() -> String` invokable from
  the frontend (consumed by Task 4).

- [ ] **Step 1: Replace `src/main.rs` with the full lifecycle wiring**

```rust
mod engine;

use std::sync::Mutex;
use std::time::Duration;

struct EnginePort(u16);
struct EngineProcess(Mutex<Option<std::process::Child>>);

#[tauri::command]
fn engine_base_url(port: tauri::State<EnginePort>) -> String {
    format!("http://127.0.0.1:{}", port.0)
}

fn main() {
    let port = engine::pick_free_port().expect("failed to find a free port for the engine");

    let child = engine::spawn_engine(port).expect("failed to spawn the engine process");

    if !engine::wait_for_ready(port, Duration::from_secs(10)) {
        panic!("engine did not become ready on port {port} within 10s");
    }

    tauri::Builder::default()
        .manage(EnginePort(port))
        .manage(EngineProcess(Mutex::new(Some(child))))
        .invoke_handler(tauri::generate_handler![engine_base_url])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                use tauri::Manager;
                let state = app_handle.state::<EngineProcess>();
                if let Some(mut child) = state.0.lock().unwrap().take() {
                    engine::kill_engine(&mut child);
                }
            }
        });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/shell/src-tauri && cargo check`
Expected: compiles with no errors. If the `tauri::RunEvent` variants or
`tauri::Manager::state` signature differ from what's shown here, read the
compiler error (it names the actual expected signature) and adjust — this is
the one part of the plan most exposed to Tauri 2.x minor-version API drift.

- [ ] **Step 3: Manual smoke test — engine actually starts and becomes reachable**

```bash
cd apps/shell/src-tauri
timeout 30 cargo tauri dev > /tmp/vmb-shell-dev.log 2>&1 &
sleep 20
grep -i "panic\|error" /tmp/vmb-shell-dev.log || echo "no panics/errors logged"
pkill -f "target/debug/vmb-shell" || true
```

Expected: no panic about the engine failing to become ready. If this WSL2
environment can't render a GUI window at all (no WSLg passthrough working),
`cargo tauri dev` may still fail for window-creation reasons unrelated to the
engine — if so, note that in the task's completion notes as a known
environment limitation to verify on Mac/Windows instead, since `cargo check`
already confirmed the Rust code itself is correct.

- [ ] **Step 4: Commit**

```bash
git add apps/shell/src-tauri/src/main.rs
git commit -m "Spawn the engine as a dev sidecar and clean it up on exit

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UgGcdqRptAMjXrapHKXxNe"
```

---

### Task 4: Frontend config plumbing (`client.ts` resolves the engine's base URL)

**Files:**
- Modify: `apps/frontend/package.json` (add `@tauri-apps/api` dependency)
- Modify: `apps/frontend/src/api/client.ts`
- Modify: `apps/frontend/src/main.tsx`
- Test: `apps/frontend/tests/client.test.ts`

**Interfaces:**
- Consumes: the `engine_base_url` Tauri command from Task 3 (mocked in
  tests via `@tauri-apps/api/core`'s `invoke`).
- Produces: `resolveBaseUrl(): Promise<string>` exported from `client.ts`,
  called once by `main.tsx` before the app renders.

- [ ] **Step 1: Install the dependency**

```bash
cd apps/frontend && npm install @tauri-apps/api
```

- [ ] **Step 2: Write the failing tests in `apps/frontend/tests/client.test.ts`**

Add this `describe` block (new imports go at the top of the existing file,
alongside the existing ones):

```ts
import { invoke } from '@tauri-apps/api/core'
import { resolveBaseUrl } from '../src/api/client'
```

```ts
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
```

```ts
describe('resolveBaseUrl', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.mocked(invoke).mockReset()
  })

  it('uses the Tauri-provided base URL when invoke resolves', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('http://127.0.0.1:54321')

    await resolveBaseUrl()
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
    await getNodes()

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:54321/nodes')
  })

  it('falls back to the default URL when invoke rejects (no Tauri context)', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('no tauri context'))

    await resolveBaseUrl()
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
    await getNodes()

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8000/nodes')
  })
})
```

(`getNodes` is already imported at the top of this file by the existing
tests — no new import needed for it.)

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `cd apps/frontend && npm test -- client.test.ts`
Expected: FAIL — `resolveBaseUrl` is not exported from `../src/api/client`.

- [ ] **Step 4: Add `resolveBaseUrl` and a mutable base URL to `client.ts`**

Replace the top of `apps/frontend/src/api/client.ts`:

```ts
import { invoke } from '@tauri-apps/api/core'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { CodegenResult, NodeManifest, PipelineIR, RunResult } from './types'

const DEFAULT_BASE_URL = 'http://127.0.0.1:8000'
let baseUrl = DEFAULT_BASE_URL

export async function resolveBaseUrl(): Promise<string> {
  try {
    baseUrl = await invoke<string>('engine_base_url')
  } catch {
    baseUrl = DEFAULT_BASE_URL
  }
  return baseUrl
}

export async function getNodes(): Promise<NodeManifest[]> {
  const response = await fetch(`${baseUrl}/nodes`)
  if (!response.ok) {
    throw new Error(`GET /nodes failed: ${response.status}`)
  }
  return response.json()
}

async function postPipeline<T>(path: string, ir: PipelineIR): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
```

Everything below the `postPipeline` signature line stays as it already is —
only the `BASE_URL` const and the two `fetch` calls' template-literal base
change from `BASE_URL` to `baseUrl`.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `cd apps/frontend && npm test -- client.test.ts`
Expected: PASS, including the pre-existing tests in this file (they never
call `resolveBaseUrl`, so `baseUrl` stays at its `DEFAULT_BASE_URL` default
and their hardcoded `http://127.0.0.1:8000` expectations still hold).

- [ ] **Step 6: Call `resolveBaseUrl` at startup in `main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@xyflow/react/dist/style.css'
import './index.css'
import { App } from './App'
import { resolveBaseUrl } from './api/client'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } })

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('missing #root element')
}

async function bootstrap() {
  await resolveBaseUrl()
  createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  )
}

bootstrap()
```

- [ ] **Step 7: Run the full frontend test suite and confirm nothing broke**

Run: `cd apps/frontend && npm test`
Expected: all tests pass (including `App.integration.test.tsx`, which never
calls `resolveBaseUrl` either, so it's unaffected).

- [ ] **Step 8: Type-check and build**

Run: `cd apps/frontend && npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 9: Commit**

```bash
git add apps/frontend/package.json apps/frontend/package-lock.json \
  apps/frontend/src/api/client.ts apps/frontend/src/main.tsx \
  apps/frontend/tests/client.test.ts
git commit -m "Resolve the engine base URL from Tauri at startup

Falls back to the existing hardcoded URL outside a Tauri context, so
the standalone 'npm run dev' / 'npm test' workflow is unchanged.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UgGcdqRptAMjXrapHKXxNe"
```

---

### Task 5: End-to-end smoke test and docs update

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Run the full end-to-end smoke test**

```bash
cd apps/shell/src-tauri
timeout 30 cargo tauri dev > /tmp/vmb-shell-e2e.log 2>&1 &
sleep 20
grep -i "panic\|error" /tmp/vmb-shell-e2e.log || echo "no panics/errors logged"
```

While it's running (within the 20s window), find the engine's port from the
log or by checking listening ports, and confirm the engine actually answers:

```bash
ss -ltnp 2>/dev/null | grep uvicorn || ss -ltnp 2>/dev/null | grep python
# then, with the port found above:
curl -s http://127.0.0.1:<port>/nodes | head -c 200
```

Expected: a JSON array of node manifests. Then:

```bash
pkill -f "target/debug/vmb-shell" || true
pgrep -f "uvicorn vmb_engine.api:app" && echo "LEAK: engine still running" || echo "engine process cleaned up"
```

Expected: "engine process cleaned up" — confirms Task 3's exit-cleanup
actually kills the child, not just compiles.

If GUI rendering doesn't work in this WSL2 environment (no window ever
appears, unrelated to the engine logic), note that explicitly as a known
environment limitation rather than a plan failure — the engine
spawn/readiness/cleanup checks above don't require a rendered window and are
the real verification for this milestone.

- [ ] **Step 2: Update `CLAUDE.md`'s Commands section**

Add a new subsection after the existing "### Frontend" subsection:

```markdown
### Shell (Tauri)

All commands run from `apps/shell/src-tauri/`.

```bash
# One-time setup: Rust toolchain + Tauri CLI + Linux GUI deps
# (see docs/superpowers/specs/2026-08-21-tauri-shell-design.md for the
# exact apt package list on Ubuntu/Debian)
cargo install tauri-cli --version "^2.0.0" --locked

# Run everything with one command: starts the Vite dev server, spawns the
# engine (via the repo's .venv/bin/uvicorn) on a free port, and opens the
# app window. Replaces running the engine and frontend dev servers by hand.
cargo tauri dev
```

The engine is spawned straight out of this repo's `.venv` — a dev-only
stopgap, not the packaged sidecar binary the project will eventually ship
(see the Tauri shell design spec's non-goals).
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "Document the Tauri shell dev workflow

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UgGcdqRptAMjXrapHKXxNe"
```
