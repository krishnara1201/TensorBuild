# .vmb Project Save/Load — Design

## Overview

There is currently no way to persist a pipeline. `App.tsx` holds `nodes`/
`edges` purely in React state; closing the app, refreshing the dev server,
or clicking "Reset" loses all canvas work. `PipelineIR` (`nodes`, `edges`,
`params`) round-trips through the engine's HTTP API already, but it has no
notion of canvas layout — node `x, y` positions live only in
`PipelineNode.position` and are never serialized.

This spec adds a `.vmb` project file format (JSON, versioned, a superset of
`PipelineIR`), frontend serialize/deserialize logic, native Save/Save
As/Open support in the Tauri shell via a new `tauri-plugin-fs` dependency,
a browser-only fallback (download/upload) for plain `npm run dev` sessions
without the Tauri shell, and dirty-state tracking so New/Open/window-close
can guard against silently discarding unsaved work.

## Goals

- Save the current canvas (nodes, params, edges, layout) to a `.vmb` file
  and load it back byte-for-byte equivalent (same nodes, params, edges,
  positions).
- Native OS Save/Save As/Open dialogs when running inside the Tauri shell.
- A working fallback (browser download/upload) when running the frontend
  standalone (`npm run dev`, no Tauri shell) — matching the existing
  `isTauri()` parity pattern already used by `FilePickerParam`.
- Fail loudly and clearly on load if the file is malformed, has an
  unrecognized `version`, or references node types not present in the
  currently-loaded registry — never partially render a broken canvas.
- Guard against silent data loss: New (formerly unconditional "Reset"),
  Open, and closing the window all confirm first if there are unsaved
  changes.

## Non-Goals

- Changing `PipelineIR` itself. The engine's execution/codegen IR stays
  exactly as it is — `.vmb` is a frontend-only wrapper format, not a new
  engine concept. The engine is not involved in save/load at all.
- Recent-files list, autosave, file-format migration tooling, or multiple
  open documents/tabs. Single current file, opened or saved explicitly.
- Cloud sync, sharing, or any storage location beyond the local
  filesystem (Tauri) / browser download (fallback).
- Partial/best-effort load (e.g., dropping unknown nodes and loading the
  rest). A load either fully succeeds or fully fails with an error.
- Merging or diffing `.vmb` files.

## File format

A `.vmb` file is JSON:

```json
{
  "version": 1,
  "ir": {
    "nodes": [{ "id": "n1", "type": "data/csv_loader", "params": {} }],
    "edges": [{ "from": "n1.table", "to": "n2.table" }]
  },
  "layout": {
    "n1": { "x": 120, "y": 80 }
  }
}
```

- `version` — an integer, `1` today. Any other value fails the load with
  an explicit "unsupported file version" error rather than guessing.
- `ir` — exactly the `PipelineIR` shape already sent to `/pipeline/run` /
  `/pipeline/codegen`.
- `layout` — a map from node id to canvas position, covering every node
  in `ir.nodes`.

This type (`VmbProjectFile`) is defined in the frontend only
(`apps/frontend/src/ir/types.ts` or alongside the existing IR types) —
there is no corresponding pydantic model in the engine.

## Frontend: serialize/deserialize (`ir/convert.ts`)

Two functions alongside the existing `toIR`:

**`toVmbFile(nodes: PipelineNode[], edges: PipelineEdge[]): VmbProjectFile`**
Builds `ir` the same way `toIR` does, plus a `layout` entry per node from
`node.position`.

**`fromVmbFile(file: unknown, manifests: NodeManifest[]): FromVmbResult`**
where
```ts
type FromVmbResult =
  | { ok: true; nodes: PipelineNode[]; edges: PipelineEdge[] }
  | { ok: false; error: string }
```
Validates, in order:
1. `file` parses as JSON and matches the basic `VmbProjectFile` shape
   (has `version`, `ir.nodes`, `ir.edges`, `layout`).
2. `version === 1`.
3. Every `ir.nodes[].type` exists in `manifests` (the same manifest list
   already fetched for the node palette). Collects *all* missing types
   into one error message (e.g. `Unknown node types: pytorch_models.gru,
   evaluation.f1_score`) rather than failing on the first.

On success, reconstructs:
- `PipelineNode[]` — one per `ir.nodes` entry: `id`, `type` resolved to
  its manifest, `data.params` from the saved params, `position` from
  `layout[id]` (defaulting to `{x: 0, y: 0}` if a given node has no
  layout entry — e.g. a hand-edited file — rather than failing the load
  over a cosmetic gap).
- `PipelineEdge[]` — one per `ir.edges` entry, splitting `from`/`to` on
  the last `.` into `{source, sourceHandle}` / `{target, targetHandle}`,
  with a synthesized id (`${source}:${sourceHandle}->${target}:${targetHandle}`).

Any failure returns `{ok: false, error}` — the caller never applies a
partial result to canvas state.

**Node id counter.** `PipelineCanvas`'s `nodeIdCounter` (used to mint
`n1`, `n2`, … for newly dropped nodes) must be advanced past the highest
numeric suffix found in a loaded file's node ids, so a node dragged onto
the canvas after a load can't collide with a loaded node's id.

## Shell (Tauri): file access

Two new plain `#[tauri::command]`s in `main.rs` — `read_vmb_file(path)` /
`write_vmb_file(path, contents)` — implemented with `std::fs` directly,
the same trust tier as the existing `engine_base_url` command. This was
chosen over adding `tauri-plugin-fs` as a dependency: that plugin's
IPC-exposed commands enforce a path allowlist (`fs:scope`) that would need
to be configured to cover arbitrary user-chosen save/open locations,
whereas an app-defined command is trusted code with no ACL surface to
configure, matching how this project already treats `engine_base_url`. No
new Cargo dependency and no capability/permission file changes are
needed. Native picking uses the already-present `tauri-plugin-dialog`:

- **Save As**: `save({ filters: [{ name: 'TensorBuild Project', extensions: ['vmb'] }] })`
  → `invoke('write_vmb_file', { path, contents: JSON.stringify(toVmbFile(...), null, 2) })`.
- **Open**: `open({ filters: [{ name: 'TensorBuild Project', extensions: ['vmb'] }] })`
  → `invoke('read_vmb_file', { path })`, `JSON.parse`, run through `fromVmbFile`.
- **Save** (when `currentFilePath` is already set): writes directly to
  that path via `write_vmb_file`, no dialog.

## App state & UX

`App.tsx` gains:
- `currentFilePath: string | null`
- `isDirty: boolean` — set `true` on any node/edge/param mutation
  (`onNodesChange`, `onEdgesChange`, `handleParamChange`, node
  add/delete); cleared on successful save or load, and on New.

Toolbar changes (header, alongside Run/View Code):
- **Save** (Cmd/Ctrl+S) — if `currentFilePath` is set, writes there
  silently; otherwise behaves like Save As.
- **Save As** — always prompts for a location.
- **Open** — prompts to pick a `.vmb` file; if `isDirty`, confirms
  discarding unsaved changes first.
- **New** (renamed from "Reset") — clears the canvas and
  `currentFilePath`; confirms first only if `isDirty` (today's Reset
  always confirms unconditionally — this is a small, deliberate UX
  improvement bundled into this change).

Header displays the current filename (or "Untitled") plus a dirty
indicator (e.g. a `•` before the name) when `isDirty`.

## Browser fallback (no Tauri)

Using the same `isTauri()` check as `FilePickerParam`:
- **Save / Save As**: build a `Blob` from `JSON.stringify(toVmbFile(...))`
  and trigger a download via a temporary `<a download="pipeline.vmb">`.
  There is no way to silently overwrite an arbitrary path from a browser,
  so **Save behaves identically to Save As** in this mode — a documented
  limitation, not a bug. `currentFilePath` is never set outside Tauri.
- **Open**: a hidden `<input type="file" accept=".vmb">` + `FileReader`,
  feeding its contents through the same `fromVmbFile`.

## Dirty guard

- **New / Open**, when `isDirty`: `window.confirm` with a clear message
  before discarding (reusing the existing confirm pattern from today's
  Reset).
- **Window close** (Tauri only): listen for the window's
  `close-requested` event; if `isDirty`, call `event.preventDefault()`
  and show a confirm dialog, closing the window programmatically only if
  the user confirms. Not implemented in the browser fallback — a browser
  tab's `beforeunload` prompt is a different, less reliable mechanism and
  isn't in scope here.

## Error Handling Summary

| Scenario | Behavior |
|---|---|
| Loaded file: invalid JSON | Error banner, canvas unchanged |
| Loaded file: unrecognized `version` | Error banner naming the version found vs. supported, canvas unchanged |
| Loaded file: references node type(s) not in current registry | Error banner listing every missing type, canvas unchanged |
| Loaded file: otherwise malformed (missing `ir`/`layout`/required fields) | Error banner, canvas unchanged |
| Save/Save As: native dialog cancelled | No-op, no error shown |
| Open: native dialog cancelled | No-op, no error shown |
| New/Open while dirty | `window.confirm`; cancelling aborts the action, canvas unchanged |
| Window close while dirty (Tauri) | Close is intercepted; confirming proceeds, cancelling keeps the window open |

## Testing

- **Frontend unit tests** (`ir/convert.test.ts`): `toVmbFile` →
  `fromVmbFile` round-trip preserves nodes, params, edges, and positions
  exactly; `fromVmbFile` error cases (malformed JSON shape, wrong
  `version`, one unknown node type, multiple unknown node types all
  listed together); edge id reconstruction from `from`/`to` refs
  (including a node/port name containing no ambiguity issues since
  splitting is on the *last* `.`).
- **App-level tests**: dirty flag flips on node/param/edge mutation and
  clears on save/load/new; New/Open confirm only when dirty; Save writes
  to `currentFilePath` without prompting once one is set; Save As always
  prompts.
- **Manual QA** (native dialogs and window-close interception aren't
  practically unit-testable, matching the existing precedent for
  `FilePickerParam`'s Tauri path): save and reload a pipeline with
  multiple node types/edges in the packaged Tauri shell on at least one
  platform; verify Save/Save As/Open dialogs filter to `.vmb`; verify
  closing the window with unsaved changes prompts and cancelling keeps
  the app open; verify the browser-fallback download/upload path in
  plain `npm run dev`.

## Open Questions (resolved during brainstorming, recorded for traceability)

- **`.vmb` format vs. `PipelineIR`** → a wrapper (`{version, ir, layout}`)
  around the untouched `PipelineIR`, not an extension of the engine's
  pydantic model — keeps the execution/codegen IR free of UI-only
  concerns (canvas layout) that the engine never needs.
- **Save/Save As/Open vs. plain Export/Import** → full Save/Save
  As/Open with a remembered `currentFilePath`, matching normal
  desktop-app save semantics, over a simpler "always prompt" Export/
  Import that would re-ask for a location on every save.
- **Browser (non-Tauri) support** → yes, a download/upload fallback,
  mirroring the existing `isTauri()` parity pattern in `FilePickerParam`,
  so the feature is exercisable without the full Tauri shell during
  frontend-only dev sessions.
- **Dirty-state guard scope** → yes, guard New/Open/window-close behind
  a dirty flag, since tracking `currentFilePath` for Save already
  requires most of the same state; window-close guard is Tauri-only.
