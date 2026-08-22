# CNN & Image Data Nodes — Design

## Overview

Add image data support and CNN layer nodes to the engine: load images (from
a built-in torchvision dataset or a folder of class-subdirectories),
normalize them, and compose a convolutional architecture (Conv2D →
BatchNorm2D → MaxPool2D → Flatten) that feeds into the classifier head
(`Linear`/`ReLU`/`Dropout`) `nn-training-core` already built. This is
sub-project 2 of the neural-network milestone (see
`docs/superpowers/specs/2026-08-21-nn-training-core-design.md`'s
decomposition); transfer-learning backbones remain sub-project 3, out of
scope here.

This sub-project reuses sub-project 1's infrastructure wholesale: the
`Layer` port and its runtime/codegen threading pattern, the async
execution + WebSocket progress mechanism (`long_running: true`), and the
manifest-driven frontend (palette/inspector/canvas render any node type
with zero code changes beyond port-color mapping). No core executor or
codegen changes are needed — every addition here is new node plugins plus
one additive key on the existing `Layer` runtime dict.

## Decomposition (for context)

1. Neural network training core (done) — MLP layers, `Layer` port, `Train`
   node, async execution + WS progress. Tabular data only.
2. **Image data & CNN layers** (this spec) — `ImageBatch` port, image data
   sources (built-in datasets + folder loader), a normalize preprocessing
   node, Conv2D/BatchNorm2D/MaxPool2D/Flatten layer nodes, an
   image-classifier `Train` counterpart.
3. Transfer-learning backbones (stretch) — pretrained ResNet/EfficientNet
   backbones with freeze/unfreeze controls. Builds on #2.

## Goals

- Load image data from either a built-in dataset (MNIST, FashionMNIST,
  CIFAR-10) or a user's folder of class-subdirectories, producing an
  in-memory train/test `ImageBatch` pair.
- Normalize image batches (fit-on-train per-channel mean/std, apply to
  both), mirroring `preprocessing/standardize`'s shape.
- Compose a CNN architecture visually via chained layer nodes
  (Conv2D/BatchNorm2D/MaxPool2D/Flatten), reusing the *existing*
  `Linear`/`ReLU`/`Dropout` nodes unchanged for the classifier head.
- Train the resulting architecture via a new image-classifier `Train`
  node, streaming live epoch/loss progress exactly like the existing
  `Train` node.
- Keep executor/codegen equivalence for the new nodes, same bar as every
  existing node.

## Non-Goals

- Transfer learning / pretrained backbones (sub-project 3).
- Configurable Conv2D kernel/stride/padding with computed output shape —
  v1 uses fixed same-padding (stride 1, H/W unchanged by conv; only
  channel count changes). Revisit if a real need for strided/valid
  convolutions shows up.
- Data augmentation (random flip/crop) — normalize only in v1.
- Lazy/streaming data loading (`Dataset`/`DataLoader`) — `ImageBatch` is a
  single in-memory tensor pair, same "materialize once, slice with a
  Python loop" pattern the existing `Train` node already uses for tables.
  Doesn't scale to datasets that don't fit in RAM; acceptable for a v1
  desktop tool aimed at MNIST-sized data and modest folders.
- Excel/Parquet/SQL data loaders, non-image built-in datasets — unrelated
  to this milestone.
- Batched validation inference — `train_image_classifier`'s validation
  pass runs the full test split through the model in one forward call
  (mirroring `pytorch_models.train`'s tabular precedent). This is fine
  for MNIST/FashionMNIST-sized test splits, but a CIFAR-10 default-params
  run can peak at several GB of transient memory. Revisit (batch the
  validation loop, weighting loss by batch length, mirrored in codegen)
  if this becomes a real problem — deliberately deferred here rather than
  risking a same-wave equivalence-sensitive training-loop change.

## New dependency

`torchvision` (CPU build), added alongside the existing `torch`/
`websockets` engine dependencies. Exported scripts using an image node
require `torchvision` to run standalone, same as `Train`-using scripts
already require `torch`.

## The `ImageBatch` port

New port type, alongside `Table`/`Model`/`Metrics`/`Layer`. Like `Layer`,
this requires **no core executor/codegen changes** — ports are generic
by name. Only the frontend needs a color mapping for it.

**Runtime value** (`execute()`): a plain dict
`{"images": FloatTensor[N,C,H,W], "labels": LongTensor[N]}`.

**Codegen value**: two threaded variables per node, e.g. an
`{out_var}_images` / `{out_var}_labels` pair — same threading pattern the
`Layer` port already established for `_layers`/`_in_features`.

## Extending the `Layer` runtime dict

Today (`nn-training-core`): `{"modules": [...], "in_features": int}`.

New (additive, not a rename): `{"modules": [...], "in_features": int |
None, "shape": (C, H, W) | None}`. Exactly one of `in_features`/`shape` is
non-`None` at any point in a chain — `in_features` while the tensor is
flat (tabular path, or post-`Flatten` on the CNN path), `shape` while it's
spatial (image path, pre-`Flatten`).

Impact on existing nodes, all additive/one-line:
- `Input` (tabular): unchanged behavior; also emits `shape: None`.
- `ReLU`, `Dropout`: propagate `shape` through alongside `in_features`
  (today they only propagate `in_features`).
- `Linear`: add a guard — raise `ExecutorError` (via the executor's
  existing per-node exception wrapping) if `in_features` is `None`,
  with a message telling the user to insert a `Flatten` node first.

Codegen for `ReLU`/`Dropout`/`Linear` gains the equivalent
`{out_var}_shape = {in_var}_shape` passthrough line (or, for `Linear`,
an explicit `assert` mirroring the runtime guard) so exported scripts
fail the same way live runs do on a malformed chain.

## Node set

New nodes all live under existing categories: `Data`, `Preprocessing`,
`Models (PyTorch)`.

### `data/built_in_image_dataset`
- Inputs: none
- Outputs: `train` (`ImageBatch`), `test` (`ImageBatch`)
- Params: `dataset` (select: `MNIST`/`FashionMNIST`/`CIFAR-10`),
  `data_dir` (text, default `./data`)
- Behavior: `torchvision.datasets.<Dataset>(data_dir, train=True/False,
  download=True)`, materialized into the `ImageBatch` tensor pair.
  Train/test split comes from the dataset's own canonical split — no
  random split needed.

### `data/image_folder_loader`
- Inputs: none
- Outputs: `train` (`ImageBatch`), `test` (`ImageBatch`)
- Params: `directory` (text), `image_size` (number, default `64` — square
  resize target), `test_size` (number, default `0.2`), `random_state`
  (number, default `42`)
- Behavior: `torchvision.datasets.ImageFolder(directory)` (subfolder-per-
  class layout) with a resize-to-`image_size` transform applied at load
  time — required here (unlike the built-in-dataset loader) because
  source images aren't already uniform, and the chosen `ImageBatch`
  representation needs a single uniform tensor. Then a random train/test
  split by `test_size`/`random_state`, same split mechanics as
  `data/train_test_split`.

### `preprocessing/normalize_images`
- Inputs: `train_images` (`ImageBatch`), `test_images` (`ImageBatch`)
- Outputs: `train` (`ImageBatch`), `test` (`ImageBatch`)
- Params: none
- Behavior: computes per-channel mean/std from `train_images`, applies
  `(x - mean) / std` to both — exact same fit-on-train/apply-to-both
  shape as `preprocessing/standardize`, on image tensors instead of table
  columns.

### `pytorch_models/image_input`
- Inputs: `train_images` (`ImageBatch`)
- Outputs: `architecture` (`Layer`)
- Params: `random_state` (number, default `42`)
- Behavior: infers `(C, H, W)` from `train_images["images"].shape[1:]`;
  starts an empty architecture list with `shape=(C,H,W)`,
  `in_features=None`. Parallels `pytorch_models/input`, kept as a
  separate node (rather than widening `Input`) because port types must
  match exactly for a connection (`ImageBatch` vs `Table`) — `validation.ts`
  requires exact type equality, so one polymorphic node can't accept
  both.

### `pytorch_models/conv2d`
- Inputs/Outputs: `architecture` (`Layer`) → `architecture` (`Layer`)
- Params: `out_channels` (number, default `16`), `kernel_size` (number,
  default `3`)
- Behavior: requires `shape is not None` (else `ExecutorError` — "Conv2d
  requires a spatial shape; insert after Image Input, another Conv2d/
  BatchNorm2d/MaxPool2d — not after Flatten/Linear"). Appends
  `nn.Conv2d(in_channels, out_channels, kernel_size, padding='same')`;
  updates `shape=(out_channels, H, W)` (H/W unchanged by same-padding).

### `pytorch_models/batchnorm2d`
- Inputs/Outputs: `architecture` (`Layer`) → `architecture` (`Layer`)
- Params: none
- Behavior: requires `shape is not None` (same guard/message pattern as
  `Conv2d`). Appends `nn.BatchNorm2d(shape[0])`; `shape` unchanged.

### `pytorch_models/maxpool2d`
- Inputs/Outputs: `architecture` (`Layer`) → `architecture` (`Layer`)
- Params: `pool_size` (number, default `2`)
- Behavior: requires `shape is not None` (same guard). Appends
  `nn.MaxPool2d(pool_size)`; updates `shape=(C, H // pool_size, W //
  pool_size)`.

### `pytorch_models/flatten`
- Inputs/Outputs: `architecture` (`Layer`) → `architecture` (`Layer`)
- Params: none
- Behavior: requires `shape is not None` (same guard — "Flatten requires
  a spatial shape; nothing to flatten"). Appends `nn.Flatten()`; sets
  `in_features = C * H * W`, `shape = None`. From here, the existing
  `Linear`/`ReLU`/`Dropout` nodes work unmodified.

### `pytorch_models/train_image_classifier`
- Inputs: `train_images` (`ImageBatch`), `test_images` (`ImageBatch`),
  `architecture` (`Layer`)
- Outputs: `model` (`Model`), `metrics` (`Metrics`)
- Params: `loss_fn` (select: `CrossEntropyLoss`, only option — always
  classification), `optimizer` (select: `Adam`/`SGD`), `learning_rate`
  (number, default `0.001`), `epochs` (number, default `10`),
  `batch_size` (number, default `32`)
- Behavior: `nn.Sequential(*architecture["modules"])`; the same
  per-epoch train/val-loss loop `pytorch_models.train` already has,
  batching by slicing the in-memory `images`/`labels` tensors instead of
  DataFrame columns. Marked `long_running: true` — reuses the existing
  WS progress path (`{"event": "progress", "epoch", "loss", "val_loss"}`)
  and `TrainingMonitor` UI with zero frontend changes.
- `metrics` includes `final_train_loss`, `final_val_loss`, and
  `final_val_accuracy` (all native Python `float`s) computed directly
  inside `execute()`/`codegen()` — unlike sub-project 1, the existing
  `evaluate_classifier`/`confusion_matrix` nodes don't apply here (they
  require a `Table` test set with `model["feature_columns"]`, which the
  image path never produces), so `train_image_classifier` reports its own
  final accuracy rather than relying on a downstream eval node.
- Kept as a separate node from `pytorch_models.train` (not a widened
  version of it) for the same port-type-exactness reason as `image_input`
  — `train_table`/`test_table` are `Table`-typed, `train_images`/
  `test_images` are `ImageBatch`-typed, and a connection needs an exact
  type match.

## Example pipeline

```
built_in_image_dataset (MNIST)
  → normalize_images
  → image_input → conv2d → batchnorm2d → relu → maxpool2d
                → conv2d → relu → maxpool2d
                → flatten → linear(128) → relu → dropout → linear(10)
  → train_image_classifier ← (train/test images from normalize_images)
```

`relu`/`dropout`/`linear` here are the pre-existing sub-project-1 nodes,
unmodified.

## Frontend

- New `ImageBatch` entry in `PORT_TYPE_COLORS`
  (`apps/frontend/src/canvas/PipelineCanvas.tsx`) — one line, same
  pattern `Layer` used.
- Everything else (palette listing, inspector param forms, canvas
  rendering, connection validation) is fully manifest-driven — no other
  frontend code changes, per the existing pattern all `pytorch_models`
  nodes already follow.
- `train_image_classifier` being `long_running: true` means running a
  pipeline containing it automatically opens the existing
  `TrainingMonitor` over `/ws/runs/{run_id}` — no frontend changes needed
  there either.

## Testing

- Per-node unit tests for all nine new nodes (`execute()` and
  `codegen()`), following the existing per-node test pattern — including
  the `shape is None` guard-error cases for `Conv2d`/`BatchNorm2d`/
  `MaxPool2d`/`Flatten`/`Linear`.
- Executor/codegen equivalence test extended with a CNN pipeline (the
  example above, using `built_in_image_dataset` with `MNIST` — small
  enough to run in a test suite): run it live and via exported-and-executed
  code, assert matching final metrics, same bar every other equivalence
  case holds.
- Registry/manifest tests confirming the new node ids load without
  conflicting with the existing `pytorch_models.*` set.

## Open Questions (resolved during brainstorming, recorded for traceability)

- **`ImageBatch` in-memory tensor vs. lazy `Dataset`/`DataLoader`** →
  in-memory tensor pair chosen; matches the existing `Train` node's
  batching style, avoids introducing a second execution shape this
  milestone. Revisit if large-folder datasets make this painful.
- **Conv2D fixed same-padding vs. configurable kernel/stride/padding** →
  fixed same-padding chosen; keeps shape-tracking trivial (only channel
  count changes). `MaxPool2D` is the only shape-shrinking layer.
- **Include MaxPool2D in this milestone?** → yes; without it, same-padding
  Conv2D has no way to downsample spatial dimensions at all.
- **Which built-in datasets?** → MNIST + FashionMNIST + CIFAR-10, all via
  one node with a `dataset` select param (all three are single-line
  `torchvision.datasets.*` calls with the same `train=True/False` shape,
  so listing all three costs little over just MNIST).
- **Image transforms scope** → normalize only; resize is handled inside
  `image_folder_loader` (required there to produce a uniform tensor);
  augmentation (random flip/crop) deferred.
- **One polymorphic `Train`/`Input` vs. parallel image-specific nodes** →
  parallel nodes (`image_input`, `train_image_classifier`) chosen; the
  frontend's connection validation requires exact port-type equality, so
  a single node can't accept both `Table` and `ImageBatch` on the same
  port.
