# Neural Network Training Core — Design

## Overview

Add the first slice of neural-network support to the engine: build and train
a feedforward (MLP) network on tabular `Table` data, on the same canvas and
through the same `PipelineIR` as the existing sklearn nodes. This is
sub-project 1 of 3 in the neural-network milestone (see decomposition below);
image data and CNN layers are explicitly out of scope here.

This sub-project also builds the async execution + WebSocket progress
infrastructure the original design spec
(`docs/superpowers/specs/2026-08-20-visual-ml-builder-design.md`) calls for
under "Execution Model" but that nothing currently uses — the engine's
`execute_pipeline` is 100% synchronous today, and no WebSocket endpoint
exists. Building it now, scoped to one node type (`Train`), means
sub-project 2 (CNNs, longer training runs) reuses it rather than needing its
own execution-model rework.

## Decomposition (for context)

1. **Neural network training core** (this spec) — MLP layer nodes, an
   architecture-assembly mechanism, a `Train` node, async execution + WS
   progress. Tabular data only.
2. **Image data & CNN layers** — new `Image`-ish data port, image data
   sources (folder/MNIST/CIFAR), transform preprocessing nodes, Conv2D /
   BatchNorm2D / Flatten layer nodes. Builds on #1's training/async infra.
3. **Transfer-learning backbones** (stretch) — pretrained ResNet/EfficientNet
   backbones with freeze/unfreeze controls. Builds on #2.

## Goals

- Compose an MLP architecture visually from chained layer nodes (Linear,
  ReLU, Dropout), matching the original spec's node-per-layer vision.
- Train it via a `Train` node against the existing `Table` /
  `train_test_split` pipeline, with `target_column` support for both
  classification and regression.
- Stream live epoch/loss progress to the frontend during training rather
  than blocking on a single HTTP response.
- Keep "run in-app" and "export code" equivalent, per the project's
  executor/codegen equivalence guarantee — a trained-in-app pipeline and its
  exported `.py` script must produce matching results.
- Let the existing evaluation nodes (`evaluate_classifier`,
  `evaluate_regressor`, `confusion_matrix`) work against a trained PyTorch
  model with zero changes to those nodes.

## Non-Goals

- Image data, CNN layers, transforms, built-in datasets (sub-project 2).
- Transfer learning / pretrained backbones (sub-project 3).
- Checkpointing, early stopping, multi-GPU/device selection beyond a basic
  CPU/CUDA-if-available default.
- Loss/Optimizer as separate draggable nodes (kept as `Train` node params —
  see Open Questions).

## New dependency

`torch` (CPU build) is added to the engine's dependencies. Exported scripts
that use a `Train` node will require `torch` to run standalone, same as
sklearn-using scripts already require `scikit-learn`.

## Node set

New category: `Models (PyTorch)`.

### `Input`
- Inputs: `train_table` (`Table`)
- Outputs: `architecture` (`Layer`)
- Params: `target_column` (text)
- Behavior: computes `in_features` as the count of non-target columns in
  `train_table`; starts an empty architecture list.

Exists as its own node — not folded into the first layer node — because the
executor requires every declared input port to be wired (no
optional/unconnected ports today), so the chain needs an explicit starting
point. This doubles as the "Input shape node" from the original spec;
output/shape nodes for CNNs are deferred to sub-project 2.

### `Linear`
- Inputs: `architecture` (`Layer`)
- Outputs: `architecture` (`Layer`)
- Params: `out_features` (number)
- Behavior: appends `nn.Linear(in_features, out_features)`; forwards
  `in_features = out_features` downstream.

### `ReLU`, `Dropout`
- Inputs/Outputs: `architecture` (`Layer`) → `architecture` (`Layer`)
- Params: `Dropout` takes `p` (number, default 0.5); `ReLU` has none.
- Behavior: appends `nn.ReLU()` / `nn.Dropout(p)`; `in_features` passes
  through unchanged.

### `Train`
- Inputs: `train_table` (`Table`), `test_table` (`Table`), `architecture`
  (`Layer`)
- Outputs: `model` (`Model`), `metrics` (`Metrics`)
- Params: `target_column` (text), `task_type` (select:
  `classification`/`regression`), `loss_fn` (select, options depend on
  `task_type`: `CrossEntropyLoss` or `MSELoss`), `optimizer` (select:
  `Adam`/`SGD`), `learning_rate` (number, default `0.001`), `epochs`
  (number, default `20`), `batch_size` (number, default `32`)
- Behavior: assembles `nn.Sequential(*architecture["modules"])`, builds
  DataLoaders from `train_table`/`test_table` split on `target_column`,
  trains for `epochs`, computing train/val loss (and accuracy, for
  classification) each epoch. Marked `long_running: true` in its manifest.
- Output `model["estimator"]` is a small adapter object (not the raw
  `nn.Module`) — see below.

Loss and Optimizer are `Train` params rather than separate nodes: they don't
compose with anything else the way layers do, so making them nodes would add
two node types and two edges per pipeline for what is really just
configuration. Revisit only if a concrete need for swappable/composable loss
nodes shows up later.

## The `Layer` port

Port `type` strings (`Table`, `Model`, `Metrics`, and now `Layer`) are
already just labels — `execute_pipeline`/`generate_code` treat every port
generically by name, so introducing `Layer` requires **no core executor or
codegen changes**. Only the frontend needs to know about it (for edge-color
hints / connection validation).

**Runtime value** (`execute()`): a plain dict `{"modules": [nn.Module, ...],
"in_features": int}`. Each layer node's `execute()` reads the upstream dict,
appends its own module, and returns the updated dict — the same
thread-two-things-through-linked-ports pattern `preprocessing/standardize`
already uses for its `train_table`/`test_table` pair.

**Codegen value**: since codegen only emits text (no access to runtime
values), each layer node threads two plain Python variables through the
generated script — a list-of-modules variable and an `in_features`
variable — mirroring how `standardize`'s codegen threads `numeric_cols`.
E.g. `Input` emits:
```python
n1_in_features = train_df.drop(columns=['target']).shape[1]
n1_layers = []
```
and `Linear` emits:
```python
n2_layers = n1_layers + [nn.Linear(n1_in_features, 64)]
n2_in_features = 64
```

## Model/evaluation integration

`evaluate_classifier`, `evaluate_regressor`, and `confusion_matrix` all call
`model["estimator"].predict(X)` — duck-typed against sklearn's `.predict()`,
not sklearn-specific in the calling code. So `Train`'s output
`model["estimator"]` is a thin adapter wrapping the trained `nn.Module`:

```python
class TorchPredictAdapter:
    def __init__(self, module, task_type):
        self.module, self.task_type = module, task_type
    def predict(self, X):
        self.module.eval()
        with torch.no_grad():
            out = self.module(torch.tensor(X.values, dtype=torch.float32))
        return (out.argmax(dim=1) if self.task_type == "classification"
                else out.squeeze(-1)).numpy()
```

In-app, this class lives in `vmb_engine`. In exported code, the equivalent
class body is emitted once via the existing `IMPORTS`-aggregation mechanism
in `codegen.py` (a deduped set of literal text prepended to the generated
script) — a minor reuse of that mechanism rather than a new one. Net effect:
**the three existing evaluation nodes work against `Train`'s output with
zero changes to those nodes**, live or exported.

## Async execution + WebSocket progress

- `POST /pipeline/run` keeps its current synchronous behavior for pipelines
  with no `long_running` nodes present — **zero behavior change for
  existing sklearn-only pipelines**.
- When the submitted `PipelineIR` contains a node whose manifest has
  `long_running: true` (only `Train`, today), `/pipeline/run` instead starts
  `execute_pipeline` as a background `asyncio` task, generates a `run_id`,
  and responds `202 {"run_id": "..."}` immediately.
- The frontend opens `WS /ws/runs/{run_id}`. The engine streams:
  - `{"event": "progress", "node_id", "epoch", "loss", "val_loss"}` —
    emitted once per epoch during `Train.execute()`
  - `{"event": "node_error", "node_id", "error"}` — on any node's exception,
    same per-node error tagging the executor already does for the
    synchronous path
  - `{"event": "complete", "metrics"}` — once the whole pipeline finishes
- Mechanism: `execute_pipeline` gains an optional `progress_callback`
  parameter. When present and the current node's `manifest.long_running` is
  true, the callback is passed into `execute()` as a keyword argument;
  `Train.execute()` calls it once per epoch with the progress dict above.
  Nodes that don't declare `long_running` are called exactly as before — no
  signature change for the ~13 existing node types.
- If the WS client disconnects mid-run, training continues to completion in
  the background task; there's no reconnect/replay of missed events in this
  slice (acceptable for training runs measured in seconds-to-low-minutes on
  tabular data — revisit if sub-project 2's CNN runs make this painful).

## Frontend

- Render `Input`/`Linear`/`ReLU`/`Dropout`/`Train` in the palette under
  "Models (PyTorch)", and the `Layer` port with its own edge color.
- Running a pipeline containing a `Train` node opens the `/ws/runs/{run_id}`
  connection instead of waiting on the plain HTTP response; a live-updating
  loss chart (train/val) replaces the "spinner until response" UX for that
  run, using progress events as they arrive.
- Non-`Train` pipelines are unaffected — same synchronous run flow as today.

## Testing

- Per-node unit tests for `Input`/`Linear`/`ReLU`/`Dropout`/`Train`
  (`execute()` and `codegen()`), following the existing per-node test
  pattern.
- Executor/codegen equivalence test extended to an MLP pipeline: run it live
  and via exported-and-executed code, assert matching final metrics —
  same bar `test_equivalence.py` already holds sklearn pipelines to.
- New WS integration test: a `Train`-containing pipeline run over
  `/ws/runs/{run_id}` emits `progress` events in increasing `epoch` order
  followed by exactly one `complete` event; a node that raises emits
  `node_error` and no `complete`.

## Open Questions (resolved during brainstorming, recorded for traceability)

- **Chained layer nodes vs. one configurable node** → chained nodes chosen;
  matches the product vision and sets up sub-project 2 for free.
- **Full async/WS now vs. synchronous-for-now** → full async now, scoped to
  just the `Train` node, to avoid a second execution-model rework in
  sub-project 2.
- **Loss/Optimizer as nodes vs. params** → params on `Train`, revisit only
  if a real need for composable loss/optimizer nodes emerges.
