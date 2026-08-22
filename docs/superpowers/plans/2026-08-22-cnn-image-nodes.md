# CNN & Image Data Nodes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add image data loading (built-in datasets + folder loader), image normalization, and CNN layer nodes (Conv2D/BatchNorm2D/MaxPool2D/Flatten) to the engine, so a CNN can be composed on the canvas and trained end-to-end through the existing async/WebSocket training infrastructure — reusing the existing `Linear`/`ReLU`/`Dropout` nodes unmodified for the classifier head.

**Architecture:** A new `ImageBatch` port type threads an in-memory `{"images": tensor, "labels": tensor}` pair through new `data`/`preprocessing` nodes, exactly like `Table` threads a DataFrame — no core executor/codegen changes. The existing `Layer` port's runtime dict gains one additive key (`shape: (C,H,W) | None`, alongside the existing `in_features: int | None`) so the same architecture-list-threading mechanism serves both the tabular MLP path and the new CNN path; `Linear`/`ReLU`/`Dropout` need only tiny additive edits to keep working on both. New `image_input`/`train_image_classifier` nodes parallel the existing `input`/`train` nodes because the frontend's connection validation requires exact port-type equality (`Table` vs `ImageBatch`), so one node can't accept both.

**Tech Stack:** Same as `nn-training-core` — Python 3.11+, PyTorch (CPU), plus a new `torchvision` dependency for datasets/transforms. Pillow (PIL) comes in transitively via `torchvision` and is used directly in tests.

**Spec:** `docs/superpowers/specs/2026-08-22-cnn-image-nodes-design.md` (parent context: `docs/superpowers/specs/2026-08-21-nn-training-core-design.md`)

**Note on scope:** Engine only (`engine/`), matching this repo's precedent of splitting engine-core work from frontend follow-ups. The one frontend change in scope (Task 11: the `ImageBatch` port color) is small enough to include directly rather than spinning up a separate plan — everything else about rendering these nodes is already fully manifest-driven with zero frontend code, per the same pattern `nn-training-core`'s `pytorch_models` nodes already established.

## Global Constraints

- New dependency: `torchvision` (CPU build), added to `engine/pyproject.toml`
  `dependencies` alongside the existing `torch`/`websockets` entries.
- Port `type` strings are free-form labels the executor/codegen never
  branch on — adding `"ImageBatch"` requires no changes to
  `vmb_engine/executor.py` or `vmb_engine/codegen.py`, only to node
  manifests that use it.
- `ImageBatch` runtime value: a plain dict `{"images":
  FloatTensor[N,C,H,W], "labels": LongTensor[N]}`. Codegen threads this as
  two suffixed variables per port, `{var}_images`/`{var}_labels` — same
  style the `Layer` port already uses for `{var}`/`{var}_in_features`.
- The `Layer` runtime dict gains one additive key: `{"modules": [...],
  "in_features": int | None, "shape": (int,int,int) | None}`. Exactly one
  of `in_features`/`shape` is non-`None` at any point in a chain. This is
  **additive, not a rename** — every existing node that only reads
  `in_features` (`Train`) needs no change at all.
- `Conv2D` uses fixed same-padding (`padding="same"`, stride 1) — only
  channel count changes through a `Conv2D`; only `MaxPool2D` changes
  spatial (H, W) dimensions.
- A node whose `execute()` raises a plain exception (e.g. `ValueError`)
  is automatically wrapped as `ExecutorError` by `execute_pipeline` — new
  nodes should raise plain, clearly-worded exceptions, not import
  `ExecutorError` themselves (see `vmb_engine/executor.py`'s existing
  `try/except` around `node_def.execute(...)`).
- No data augmentation, no lazy `Dataset`/`DataLoader` — `image_size`
  resize happens inside `image_folder_loader` at load time (needed there
  to produce a uniform tensor); `normalize_images` only normalizes.
- Follow the executor/codegen equivalence bar `test_equivalence.py`
  already enforces: every new node's live-run output and
  exported-and-executed-script output must match.
- Tests must not require network access — `built_in_image_dataset`'s
  tests monkeypatch `torchvision.datasets.<Class>` rather than actually
  downloading; the CNN equivalence test uses `image_folder_loader`
  against tiny synthetic PNGs written to `tmp_path`, not a real
  downloaded dataset.

---

## Task 1: `torchvision` dependency + `data/built_in_image_dataset` node

**Files:**
- Modify: `engine/pyproject.toml`
- Create: `engine/vmb_engine/nodes/data/built_in_image_dataset/manifest.json`
- Create: `engine/vmb_engine/nodes/data/built_in_image_dataset/node.py`
- Test: `engine/tests/test_nodes_data_images.py`

**Interfaces:**
- Produces: `data.built_in_image_dataset` node — no inputs; outputs `train`
  (`ImageBatch`), `test` (`ImageBatch`). Runtime value per split:
  `{"images": FloatTensor[N,C,H,W], "labels": LongTensor[N]}`. Used by
  Task 3 (`normalize_images`) and Task 10 (equivalence test, optionally).

- [ ] **Step 1: Add the dependency**

Edit `engine/pyproject.toml`'s `dependencies` list (currently ends at
`"websockets>=12.0",`) to add one entry:

```toml
dependencies = [
    "fastapi>=0.110.0",
    "uvicorn>=0.29.0",
    "pydantic>=2.6.0",
    "pandas>=2.2.0",
    "scikit-learn>=1.4.0",
    "torch>=2.2.0",
    "websockets>=12.0",
    "torchvision>=0.17.0",
]
```

- [ ] **Step 2: Install and verify**

Run: `.venv/bin/pip install -e "engine[dev]"`
Then: `.venv/bin/python -c "import torchvision; from PIL import Image; print(torchvision.__version__)"`
Expected: prints a version string, no import errors.

- [ ] **Step 3: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add engine/pyproject.toml
git commit -m "engine: add torchvision dependency"
```

- [ ] **Step 4: Write the failing tests**

Create `engine/tests/test_nodes_data_images.py`:

```python
import importlib.util
from pathlib import Path

import torch
from PIL import Image

NODES_DIR = Path(__file__).resolve().parents[1] / "vmb_engine" / "nodes"


def _load_node_module(rel_path: str):
    node_path = NODES_DIR / rel_path / "node.py"
    spec = importlib.util.spec_from_file_location(rel_path.replace("/", "_"), node_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _FakeTorchvisionDataset:
    def __init__(self, root, train, download, transform):
        self.transform = transform
        offset = 0 if train else 100
        self._samples = [
            (Image.new("L", (4, 4), color=(i + offset) % 256), i % 2) for i in range(6)
        ]

    def __len__(self):
        return len(self._samples)

    def __getitem__(self, idx):
        img, label = self._samples[idx]
        return self.transform(img), label


def test_built_in_image_dataset_execute_builds_train_test_image_batches(monkeypatch):
    node = _load_node_module("data/built_in_image_dataset")
    import torchvision

    monkeypatch.setattr(torchvision.datasets, "MNIST", _FakeTorchvisionDataset)

    outputs = node.execute({}, {"dataset": "MNIST", "data_dir": "unused"})

    for split in ("train", "test"):
        batch = outputs[split]
        assert batch["images"].shape == (6, 1, 4, 4)
        assert batch["labels"].shape == (6,)
        assert batch["labels"].dtype == torch.long
        assert batch["labels"].tolist() == [0, 1, 0, 1, 0, 1]


def test_built_in_image_dataset_codegen_emits_dataset_construction():
    node = _load_node_module("data/built_in_image_dataset")
    lines = node.codegen(
        {},
        {"dataset": "FashionMNIST", "data_dir": "./data"},
        {"train": "n1_train", "test": "n1_test"},
    )
    assert lines == [
        "n1_train_ds = torchvision.datasets.FashionMNIST(root='./data', train=True, "
        "download=True, transform=torchvision.transforms.ToTensor())",
        "n1_train_images = torch.stack([n1_train_ds[i][0] for i in range(len(n1_train_ds))])",
        "n1_train_labels = torch.tensor("
        "[n1_train_ds[i][1] for i in range(len(n1_train_ds))], dtype=torch.long)",
        "n1_test_ds = torchvision.datasets.FashionMNIST(root='./data', train=False, "
        "download=True, transform=torchvision.transforms.ToTensor())",
        "n1_test_images = torch.stack([n1_test_ds[i][0] for i in range(len(n1_test_ds))])",
        "n1_test_labels = torch.tensor("
        "[n1_test_ds[i][1] for i in range(len(n1_test_ds))], dtype=torch.long)",
    ]
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `.venv/bin/pytest engine/tests/test_nodes_data_images.py -v`
Expected: FAIL — `vmb_engine/nodes/data/built_in_image_dataset/node.py`
does not exist yet.

- [ ] **Step 6: Write the manifest**

Create `engine/vmb_engine/nodes/data/built_in_image_dataset/manifest.json`:

```json
{
    "id": "data.built_in_image_dataset",
    "category": "Data",
    "label": "Built-in Image Dataset",
    "inputs": [],
    "outputs": [
        {"name": "train", "type": "ImageBatch"},
        {"name": "test", "type": "ImageBatch"}
    ],
    "params": [
        {
            "name": "dataset",
            "type": "select",
            "label": "Dataset",
            "default": "MNIST",
            "options": ["MNIST", "FashionMNIST", "CIFAR-10"]
        },
        {"name": "data_dir", "type": "text", "label": "Data Directory", "default": "./data"}
    ]
}
```

- [ ] **Step 7: Implement the node**

Create `engine/vmb_engine/nodes/data/built_in_image_dataset/node.py`:

```python
IMPORTS = ["import torch", "import torchvision"]

_DATASET_CLASS_NAMES = {
    "MNIST": "MNIST",
    "FashionMNIST": "FashionMNIST",
    "CIFAR-10": "CIFAR10",
}


def _load_split(dataset: str, data_dir: str, train: bool) -> dict:
    import torch
    import torchvision

    dataset_cls = getattr(torchvision.datasets, _DATASET_CLASS_NAMES[dataset])
    to_tensor = torchvision.transforms.ToTensor()
    ds = dataset_cls(root=data_dir, train=train, download=True, transform=to_tensor)
    images = torch.stack([ds[i][0] for i in range(len(ds))])
    labels = torch.tensor([ds[i][1] for i in range(len(ds))], dtype=torch.long)
    return {"images": images, "labels": labels}


def execute(inputs: dict, params: dict) -> dict:
    dataset = params["dataset"]
    data_dir = params["data_dir"]
    return {
        "train": _load_split(dataset, data_dir, train=True),
        "test": _load_split(dataset, data_dir, train=False),
    }


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    dataset = params["dataset"]
    data_dir = params["data_dir"]
    class_name = _DATASET_CLASS_NAMES[dataset]
    lines: list[str] = []
    for out_var, train_flag in ((var_names["train"], True), (var_names["test"], False)):
        lines.extend(
            [
                f"{out_var}_ds = torchvision.datasets.{class_name}("
                f"root={data_dir!r}, train={train_flag}, download=True, "
                f"transform=torchvision.transforms.ToTensor())",
                f"{out_var}_images = torch.stack("
                f"[{out_var}_ds[i][0] for i in range(len({out_var}_ds))])",
                f"{out_var}_labels = torch.tensor("
                f"[{out_var}_ds[i][1] for i in range(len({out_var}_ds))], dtype=torch.long)",
            ]
        )
    return lines
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `.venv/bin/pytest engine/tests/test_nodes_data_images.py -v`
Expected: PASS (2 passed).

- [ ] **Step 9: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add engine/vmb_engine/nodes/data/built_in_image_dataset engine/tests/test_nodes_data_images.py
git commit -m "engine: add data.built_in_image_dataset node (MNIST/FashionMNIST/CIFAR-10)"
```

---

## Task 2: `data/image_folder_loader` node

**Files:**
- Create: `engine/vmb_engine/nodes/data/image_folder_loader/manifest.json`
- Create: `engine/vmb_engine/nodes/data/image_folder_loader/node.py`
- Test: `engine/tests/test_nodes_data_images.py` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: `data.image_folder_loader` node — no inputs; outputs `train`
  (`ImageBatch`), `test` (`ImageBatch`), same shape as Task 1's node. Used
  by Task 10's equivalence test as the network-free CNN pipeline's data
  source.

- [ ] **Step 1: Write the failing tests**

Append to `engine/tests/test_nodes_data_images.py`:

```python
def _write_fake_image_folder(root: Path, per_class: int = 6) -> None:
    for class_name in ("a", "b"):
        class_dir = root / class_name
        class_dir.mkdir(parents=True)
        for i in range(per_class):
            shade = i * 20
            Image.new("RGB", (10, 10), color=(shade, shade, shade)).save(class_dir / f"{i}.png")


def test_image_folder_loader_execute_builds_uniform_train_test_batches(tmp_path):
    node = _load_node_module("data/image_folder_loader")
    _write_fake_image_folder(tmp_path)

    outputs = node.execute(
        {},
        {"directory": str(tmp_path), "image_size": 8, "test_size": 0.5, "random_state": 42},
    )

    assert outputs["train"]["images"].shape[1:] == (3, 8, 8)
    assert outputs["test"]["images"].shape[1:] == (3, 8, 8)
    total = outputs["train"]["images"].shape[0] + outputs["test"]["images"].shape[0]
    assert total == 12
    assert outputs["train"]["labels"].dtype == torch.long


def test_image_folder_loader_codegen_emits_load_and_split():
    node = _load_node_module("data/image_folder_loader")
    lines = node.codegen(
        {},
        {"directory": "/data/pics", "image_size": 8, "test_size": 0.5, "random_state": 42},
        {"train": "n1_train", "test": "n1_test"},
    )
    assert lines == [
        "n1_train_transform = torchvision.transforms.Compose("
        "[torchvision.transforms.Resize((8, 8)), torchvision.transforms.ToTensor()])",
        "n1_train_ds = torchvision.datasets.ImageFolder("
        "'/data/pics', transform=n1_train_transform)",
        "n1_train_images_all = torch.stack("
        "[n1_train_ds[i][0] for i in range(len(n1_train_ds))])",
        "n1_train_labels_all = torch.tensor("
        "[n1_train_ds[i][1] for i in range(len(n1_train_ds))], dtype=torch.long)",
        "n1_train_indices = list(range(len(n1_train_ds)))",
        "n1_train_idx, n1_test_idx = train_test_split("
        "n1_train_indices, test_size=0.5, random_state=42)",
        "n1_train_images = n1_train_images_all[n1_train_idx]",
        "n1_train_labels = n1_train_labels_all[n1_train_idx]",
        "n1_test_images = n1_train_images_all[n1_test_idx]",
        "n1_test_labels = n1_train_labels_all[n1_test_idx]",
    ]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest engine/tests/test_nodes_data_images.py -v -k image_folder`
Expected: FAIL — `vmb_engine/nodes/data/image_folder_loader/node.py` does
not exist yet.

- [ ] **Step 3: Write the manifest**

Create `engine/vmb_engine/nodes/data/image_folder_loader/manifest.json`:

```json
{
    "id": "data.image_folder_loader",
    "category": "Data",
    "label": "Image Folder Loader",
    "inputs": [],
    "outputs": [
        {"name": "train", "type": "ImageBatch"},
        {"name": "test", "type": "ImageBatch"}
    ],
    "params": [
        {"name": "directory", "type": "text", "label": "Directory", "default": ""},
        {"name": "image_size", "type": "number", "label": "Image Size", "default": 64},
        {"name": "test_size", "type": "number", "label": "Test Size", "default": 0.2},
        {"name": "random_state", "type": "number", "label": "Random State", "default": 42}
    ]
}
```

- [ ] **Step 4: Implement the node**

Create `engine/vmb_engine/nodes/data/image_folder_loader/node.py`:

```python
IMPORTS = [
    "import torch",
    "import torchvision",
    "from sklearn.model_selection import train_test_split",
]


def execute(inputs: dict, params: dict) -> dict:
    import torch
    import torchvision
    from sklearn.model_selection import train_test_split

    image_size = params["image_size"]
    transform = torchvision.transforms.Compose(
        [
            torchvision.transforms.Resize((image_size, image_size)),
            torchvision.transforms.ToTensor(),
        ]
    )
    ds = torchvision.datasets.ImageFolder(params["directory"], transform=transform)
    images = torch.stack([ds[i][0] for i in range(len(ds))])
    labels = torch.tensor([ds[i][1] for i in range(len(ds))], dtype=torch.long)

    indices = list(range(len(ds)))
    train_idx, test_idx = train_test_split(
        indices, test_size=params["test_size"], random_state=params["random_state"]
    )
    return {
        "train": {"images": images[train_idx], "labels": labels[train_idx]},
        "test": {"images": images[test_idx], "labels": labels[test_idx]},
    }


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    image_size = params["image_size"]
    directory = params["directory"]
    test_size = params["test_size"]
    random_state = params["random_state"]
    train_var = var_names["train"]
    test_var = var_names["test"]
    return [
        f"{train_var}_transform = torchvision.transforms.Compose("
        f"[torchvision.transforms.Resize(({image_size}, {image_size})), "
        f"torchvision.transforms.ToTensor()])",
        f"{train_var}_ds = torchvision.datasets.ImageFolder("
        f"{directory!r}, transform={train_var}_transform)",
        f"{train_var}_images_all = torch.stack("
        f"[{train_var}_ds[i][0] for i in range(len({train_var}_ds))])",
        f"{train_var}_labels_all = torch.tensor("
        f"[{train_var}_ds[i][1] for i in range(len({train_var}_ds))], dtype=torch.long)",
        f"{train_var}_indices = list(range(len({train_var}_ds)))",
        f"{train_var}_idx, {test_var}_idx = train_test_split("
        f"{train_var}_indices, test_size={test_size!r}, random_state={random_state!r})",
        f"{train_var}_images = {train_var}_images_all[{train_var}_idx]",
        f"{train_var}_labels = {train_var}_labels_all[{train_var}_idx]",
        f"{test_var}_images = {train_var}_images_all[{test_var}_idx]",
        f"{test_var}_labels = {train_var}_labels_all[{test_var}_idx]",
    ]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/pytest engine/tests/test_nodes_data_images.py -v`
Expected: PASS (4 passed).

- [ ] **Step 6: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add engine/vmb_engine/nodes/data/image_folder_loader engine/tests/test_nodes_data_images.py
git commit -m "engine: add data.image_folder_loader node"
```

---

## Task 3: `preprocessing/normalize_images` node

**Files:**
- Create: `engine/vmb_engine/nodes/preprocessing/normalize_images/manifest.json`
- Create: `engine/vmb_engine/nodes/preprocessing/normalize_images/node.py`
- Test: `engine/tests/test_nodes_preprocessing_images.py`

**Interfaces:**
- Consumes: nothing new (operates on the `ImageBatch` runtime/codegen
  shape defined in Task 1).
- Produces: `preprocessing.normalize_images` node — inputs `train_images`/
  `test_images` (`ImageBatch`), outputs `train`/`test` (`ImageBatch`).
  Used by Task 10's equivalence test.

- [ ] **Step 1: Write the failing tests**

Create `engine/tests/test_nodes_preprocessing_images.py`:

```python
import importlib.util
from pathlib import Path

import torch

NODES_DIR = Path(__file__).resolve().parents[1] / "vmb_engine" / "nodes"


def _load_node_module(rel_path: str):
    node_path = NODES_DIR / rel_path / "node.py"
    spec = importlib.util.spec_from_file_location(rel_path.replace("/", "_"), node_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _batch(values: list[float]) -> dict:
    images = torch.tensor(values, dtype=torch.float32).reshape(len(values), 1, 1, 1)
    labels = torch.arange(len(values), dtype=torch.long)
    return {"images": images, "labels": labels}


def test_normalize_images_execute_uses_train_stats_on_both_splits():
    node = _load_node_module("preprocessing/normalize_images")
    train = _batch([0.0, 10.0])
    test = _batch([5.0])

    outputs = node.execute({"train_images": train, "test_images": test}, {})

    mean, std = 5.0, 5.0
    assert outputs["train"]["images"].flatten().tolist() == [
        (0.0 - mean) / std,
        (10.0 - mean) / std,
    ]
    assert outputs["test"]["images"].flatten().tolist() == [(5.0 - mean) / std]
    assert outputs["train"]["labels"].tolist() == [0, 1]
    assert outputs["test"]["labels"].tolist() == [0]


def test_normalize_images_codegen_emits_train_stat_normalize():
    node = _load_node_module("preprocessing/normalize_images")
    lines = node.codegen(
        {"train_images": "n1_train", "test_images": "n1_test"},
        {},
        {"train": "n2_train", "test": "n2_test"},
    )
    assert lines == [
        "n2_train_mean = n1_train_images.mean(dim=(0, 2, 3), keepdim=True)",
        "n2_train_std = n1_train_images.std(dim=(0, 2, 3), keepdim=True)",
        "n2_train_images = (n1_train_images - n2_train_mean) / n2_train_std",
        "n2_train_labels = n1_train_labels",
        "n2_test_images = (n1_test_images - n2_train_mean) / n2_train_std",
        "n2_test_labels = n1_test_labels",
    ]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest engine/tests/test_nodes_preprocessing_images.py -v`
Expected: FAIL — the node module does not exist yet.

- [ ] **Step 3: Write the manifest**

Create `engine/vmb_engine/nodes/preprocessing/normalize_images/manifest.json`:

```json
{
    "id": "preprocessing.normalize_images",
    "category": "Preprocessing",
    "label": "Normalize Images",
    "inputs": [
        {"name": "train_images", "type": "ImageBatch"},
        {"name": "test_images", "type": "ImageBatch"}
    ],
    "outputs": [
        {"name": "train", "type": "ImageBatch"},
        {"name": "test", "type": "ImageBatch"}
    ],
    "params": []
}
```

- [ ] **Step 4: Implement the node**

Create `engine/vmb_engine/nodes/preprocessing/normalize_images/node.py`:

```python
IMPORTS = ["import torch"]


def execute(inputs: dict, params: dict) -> dict:
    train_batch = inputs["train_images"]
    test_batch = inputs["test_images"]
    train_images = train_batch["images"]

    mean = train_images.mean(dim=(0, 2, 3), keepdim=True)
    std = train_images.std(dim=(0, 2, 3), keepdim=True)

    return {
        "train": {"images": (train_images - mean) / std, "labels": train_batch["labels"]},
        "test": {
            "images": (test_batch["images"] - mean) / std,
            "labels": test_batch["labels"],
        },
    }


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    train_in = inputs["train_images"]
    test_in = inputs["test_images"]
    train_out = var_names["train"]
    test_out = var_names["test"]
    return [
        f"{train_out}_mean = {train_in}_images.mean(dim=(0, 2, 3), keepdim=True)",
        f"{train_out}_std = {train_in}_images.std(dim=(0, 2, 3), keepdim=True)",
        f"{train_out}_images = ({train_in}_images - {train_out}_mean) / {train_out}_std",
        f"{train_out}_labels = {train_in}_labels",
        f"{test_out}_images = ({test_in}_images - {train_out}_mean) / {train_out}_std",
        f"{test_out}_labels = {test_in}_labels",
    ]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/pytest engine/tests/test_nodes_preprocessing_images.py -v`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add engine/vmb_engine/nodes/preprocessing/normalize_images engine/tests/test_nodes_preprocessing_images.py
git commit -m "engine: add preprocessing.normalize_images node"
```

---

## Task 4: Extend the `Layer` dict with an additive `shape` key

**Files:**
- Modify: `engine/vmb_engine/nodes/pytorch_models/input/node.py`
- Modify: `engine/vmb_engine/nodes/pytorch_models/linear/node.py`
- Modify: `engine/vmb_engine/nodes/pytorch_models/relu/node.py`
- Modify: `engine/vmb_engine/nodes/pytorch_models/dropout/node.py`
- Modify: `engine/tests/test_nodes_pytorch.py`

**Interfaces:**
- Produces: the `Layer` runtime dict becomes `{"modules": [...],
  "in_features": int | None, "shape": (int,int,int) | None}` everywhere.
  Consumed by Tasks 5-9 (every CNN layer node requires `shape is not
  None`; `Linear` now requires `in_features is not None`).

This task touches only existing, already-tested files — no new node. Do
each of the four node-file replacements, then the matching test-file
edits, then run the full existing test file once at the end.

- [ ] **Step 1: Replace `pytorch_models/input/node.py`**

Replace `engine/vmb_engine/nodes/pytorch_models/input/node.py` with:

```python
IMPORTS = ["import torch"]


def execute(inputs: dict, params: dict) -> dict:
    import torch

    torch.manual_seed(params["random_state"])
    target = params["target_column"]
    df = inputs["train_table"]
    in_features = len([c for c in df.columns if c != target])
    return {"architecture": {"modules": [], "in_features": in_features, "shape": None}}


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    train_in = inputs["train_table"]
    out_var = var_names["architecture"]
    target = params["target_column"]
    random_state = params["random_state"]
    return [
        f"torch.manual_seed({random_state})",
        f"{out_var}_in_features = len([c for c in {train_in}.columns if c != {target!r}])",
        f"{out_var}_shape = None",
        f"{out_var} = []",
    ]
```

- [ ] **Step 2: Replace `pytorch_models/linear/node.py`**

Replace `engine/vmb_engine/nodes/pytorch_models/linear/node.py` with:

```python
IMPORTS = ["import torch.nn as nn"]


def execute(inputs: dict, params: dict) -> dict:
    import torch.nn as nn

    architecture = inputs["architecture"]
    if architecture["in_features"] is None:
        raise ValueError("Linear requires a flat shape; insert a Flatten node first")
    out_features = params["out_features"]
    layer = nn.Linear(architecture["in_features"], out_features)
    modules = architecture["modules"] + [layer]
    return {"architecture": {"modules": modules, "in_features": out_features, "shape": None}}


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    in_var = inputs["architecture"]
    out_var = var_names["architecture"]
    out_features = params["out_features"]
    return [
        f"assert {in_var}_in_features is not None, "
        f"'Linear requires a flat shape; insert a Flatten node first'",
        f"{out_var} = {in_var} + [nn.Linear({in_var}_in_features, {out_features})]",
        f"{out_var}_in_features = {out_features}",
        f"{out_var}_shape = None",
    ]
```

- [ ] **Step 3: Replace `pytorch_models/relu/node.py`**

Replace `engine/vmb_engine/nodes/pytorch_models/relu/node.py` with:

```python
IMPORTS = ["import torch.nn as nn"]


def execute(inputs: dict, params: dict) -> dict:
    import torch.nn as nn

    architecture = inputs["architecture"]
    modules = architecture["modules"] + [nn.ReLU()]
    return {
        "architecture": {
            "modules": modules,
            "in_features": architecture["in_features"],
            "shape": architecture["shape"],
        }
    }


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    in_var = inputs["architecture"]
    out_var = var_names["architecture"]
    return [
        f"{out_var} = {in_var} + [nn.ReLU()]",
        f"{out_var}_in_features = {in_var}_in_features",
        f"{out_var}_shape = {in_var}_shape",
    ]
```

- [ ] **Step 4: Replace `pytorch_models/dropout/node.py`**

Replace `engine/vmb_engine/nodes/pytorch_models/dropout/node.py` with:

```python
IMPORTS = ["import torch.nn as nn"]


def execute(inputs: dict, params: dict) -> dict:
    import torch.nn as nn

    architecture = inputs["architecture"]
    modules = architecture["modules"] + [nn.Dropout(p=params["p"])]
    return {
        "architecture": {
            "modules": modules,
            "in_features": architecture["in_features"],
            "shape": architecture["shape"],
        }
    }


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    in_var = inputs["architecture"]
    out_var = var_names["architecture"]
    p = params["p"]
    return [
        f"{out_var} = {in_var} + [nn.Dropout(p={p})]",
        f"{out_var}_in_features = {in_var}_in_features",
        f"{out_var}_shape = {in_var}_shape",
    ]
```

- [ ] **Step 5: Update the existing tests**

In `engine/tests/test_nodes_pytorch.py`, apply these four targeted edits
(everything else in the file — including `test_train_*` and
`_toy_architecture`, which only ever read `["architecture"]` as a whole
dict, not `in_features`/`shape` directly — is unaffected):

Edit 1 — replace:
```python
def test_input_codegen_emits_seed_and_empty_architecture():
    input_node = _load_node_module("pytorch_models/input")
    lines = input_node.codegen(
        {"train_table": "n1_table"},
        {"target_column": "label", "random_state": 42},
        {"architecture": "n2_architecture"},
    )
    assert lines == [
        "torch.manual_seed(42)",
        "n2_architecture_in_features = len([c for c in n1_table.columns if c != 'label'])",
        "n2_architecture = []",
    ]
```
with:
```python
def test_input_codegen_emits_seed_and_empty_architecture():
    input_node = _load_node_module("pytorch_models/input")
    lines = input_node.codegen(
        {"train_table": "n1_table"},
        {"target_column": "label", "random_state": 42},
        {"architecture": "n2_architecture"},
    )
    assert lines == [
        "torch.manual_seed(42)",
        "n2_architecture_in_features = len([c for c in n1_table.columns if c != 'label'])",
        "n2_architecture_shape = None",
        "n2_architecture = []",
    ]
```

Edit 2 — replace:
```python
def test_linear_execute_appends_layer_and_updates_in_features():
    linear = _load_node_module("pytorch_models/linear")

    outputs = linear.execute(
        {"architecture": {"modules": [], "in_features": 2}}, {"out_features": 8}
    )

    architecture = outputs["architecture"]
    assert len(architecture["modules"]) == 1
    assert architecture["modules"][0].in_features == 2
    assert architecture["modules"][0].out_features == 8
    assert architecture["in_features"] == 8


def test_linear_codegen_emits_layer_append():
    linear = _load_node_module("pytorch_models/linear")
    lines = linear.codegen(
        {"architecture": "n1_architecture"},
        {"out_features": 8},
        {"architecture": "n2_architecture"},
    )
    assert lines == [
        "n2_architecture = n1_architecture + [nn.Linear(n1_architecture_in_features, 8)]",
        "n2_architecture_in_features = 8",
    ]
```
with:
```python
def test_linear_execute_appends_layer_and_updates_in_features():
    linear = _load_node_module("pytorch_models/linear")

    outputs = linear.execute(
        {"architecture": {"modules": [], "in_features": 2, "shape": None}}, {"out_features": 8}
    )

    architecture = outputs["architecture"]
    assert len(architecture["modules"]) == 1
    assert architecture["modules"][0].in_features == 2
    assert architecture["modules"][0].out_features == 8
    assert architecture["in_features"] == 8
    assert architecture["shape"] is None


def test_linear_execute_raises_when_shape_is_still_spatial():
    linear = _load_node_module("pytorch_models/linear")

    try:
        linear.execute(
            {"architecture": {"modules": [], "in_features": None, "shape": (4, 8, 8)}},
            {"out_features": 8},
        )
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "Flatten" in str(exc)


def test_linear_codegen_emits_layer_append():
    linear = _load_node_module("pytorch_models/linear")
    lines = linear.codegen(
        {"architecture": "n1_architecture"},
        {"out_features": 8},
        {"architecture": "n2_architecture"},
    )
    assert lines == [
        "assert n1_architecture_in_features is not None, "
        "'Linear requires a flat shape; insert a Flatten node first'",
        "n2_architecture = n1_architecture + [nn.Linear(n1_architecture_in_features, 8)]",
        "n2_architecture_in_features = 8",
        "n2_architecture_shape = None",
    ]
```

Edit 3 — replace:
```python
def test_relu_execute_appends_activation_and_preserves_in_features():
    relu = _load_node_module("pytorch_models/relu")

    outputs = relu.execute({"architecture": {"modules": [], "in_features": 8}}, {})

    architecture = outputs["architecture"]
    assert len(architecture["modules"]) == 1
    assert architecture["in_features"] == 8


def test_relu_codegen_emits_activation_append():
    relu = _load_node_module("pytorch_models/relu")
    lines = relu.codegen(
        {"architecture": "n2_architecture"}, {}, {"architecture": "n3_architecture"}
    )
    assert lines == [
        "n3_architecture = n2_architecture + [nn.ReLU()]",
        "n3_architecture_in_features = n2_architecture_in_features",
    ]
```
with:
```python
def test_relu_execute_appends_activation_and_preserves_in_features():
    relu = _load_node_module("pytorch_models/relu")

    outputs = relu.execute(
        {"architecture": {"modules": [], "in_features": 8, "shape": None}}, {}
    )

    architecture = outputs["architecture"]
    assert len(architecture["modules"]) == 1
    assert architecture["in_features"] == 8
    assert architecture["shape"] is None


def test_relu_execute_preserves_spatial_shape():
    relu = _load_node_module("pytorch_models/relu")

    outputs = relu.execute(
        {"architecture": {"modules": [], "in_features": None, "shape": (4, 8, 8)}}, {}
    )

    assert outputs["architecture"]["shape"] == (4, 8, 8)
    assert outputs["architecture"]["in_features"] is None


def test_relu_codegen_emits_activation_append():
    relu = _load_node_module("pytorch_models/relu")
    lines = relu.codegen(
        {"architecture": "n2_architecture"}, {}, {"architecture": "n3_architecture"}
    )
    assert lines == [
        "n3_architecture = n2_architecture + [nn.ReLU()]",
        "n3_architecture_in_features = n2_architecture_in_features",
        "n3_architecture_shape = n2_architecture_shape",
    ]
```

Edit 4 — replace:
```python
def test_dropout_execute_appends_dropout_and_preserves_in_features():
    dropout = _load_node_module("pytorch_models/dropout")

    outputs = dropout.execute({"architecture": {"modules": [], "in_features": 8}}, {"p": 0.3})

    architecture = outputs["architecture"]
    assert len(architecture["modules"]) == 1
    assert architecture["modules"][0].p == 0.3
    assert architecture["in_features"] == 8


def test_dropout_codegen_emits_dropout_append():
    dropout = _load_node_module("pytorch_models/dropout")
    lines = dropout.codegen(
        {"architecture": "n2_architecture"}, {"p": 0.3}, {"architecture": "n3_architecture"}
    )
    assert lines == [
        "n3_architecture = n2_architecture + [nn.Dropout(p=0.3)]",
        "n3_architecture_in_features = n2_architecture_in_features",
    ]
```
with:
```python
def test_dropout_execute_appends_dropout_and_preserves_in_features():
    dropout = _load_node_module("pytorch_models/dropout")

    outputs = dropout.execute(
        {"architecture": {"modules": [], "in_features": 8, "shape": None}}, {"p": 0.3}
    )

    architecture = outputs["architecture"]
    assert len(architecture["modules"]) == 1
    assert architecture["modules"][0].p == 0.3
    assert architecture["in_features"] == 8
    assert architecture["shape"] is None


def test_dropout_codegen_emits_dropout_append():
    dropout = _load_node_module("pytorch_models/dropout")
    lines = dropout.codegen(
        {"architecture": "n2_architecture"}, {"p": 0.3}, {"architecture": "n3_architecture"}
    )
    assert lines == [
        "n3_architecture = n2_architecture + [nn.Dropout(p=0.3)]",
        "n3_architecture_in_features = n2_architecture_in_features",
        "n3_architecture_shape = n2_architecture_shape",
    ]
```

Also update `test_input_execute_computes_in_features` (the one test that
constructs the architecture dict via `input_node.execute(...)` and then
only asserts `in_features`) by adding one line:
replace
```python
    architecture = outputs["architecture"]
    assert architecture["modules"] == []
    assert architecture["in_features"] == 2
```
with
```python
    architecture = outputs["architecture"]
    assert architecture["modules"] == []
    assert architecture["in_features"] == 2
    assert architecture["shape"] is None
```
(this appears once, directly under `test_input_execute_computes_in_features`).

- [ ] **Step 6: Run the full pytorch node test file**

Run: `.venv/bin/pytest engine/tests/test_nodes_pytorch.py -v`
Expected: PASS, more tests than before (2 new: the `Linear`/`ReLU` shape
guard/passthrough cases).

- [ ] **Step 7: Run the full engine suite to catch any ripple effects**

Run: `.venv/bin/pytest engine/tests -v`
Expected: PASS — `test_equivalence.py`'s existing MLP test exercises
`Input`/`Linear`/`ReLU`/`Train` end to end and must still pass unchanged,
since none of these edits altered tabular-path behavior, only added the
`shape` key alongside it.

- [ ] **Step 8: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add engine/vmb_engine/nodes/pytorch_models/input engine/vmb_engine/nodes/pytorch_models/linear \
  engine/vmb_engine/nodes/pytorch_models/relu engine/vmb_engine/nodes/pytorch_models/dropout \
  engine/tests/test_nodes_pytorch.py
git commit -m "engine: extend the Layer architecture dict with an additive spatial shape"
```

---

## Task 5: `pytorch_models/image_input` node

**Files:**
- Create: `engine/vmb_engine/nodes/pytorch_models/image_input/manifest.json`
- Create: `engine/vmb_engine/nodes/pytorch_models/image_input/node.py`
- Test: `engine/tests/test_nodes_pytorch.py` (append)

**Interfaces:**
- Consumes: `ImageBatch` (Task 1's runtime/codegen shape).
- Produces: `pytorch_models.image_input` node — input `train_images`
  (`ImageBatch`), output `architecture` (`Layer`) with `shape=(C,H,W)`,
  `in_features=None`. Used by Task 6 (`conv2d`) and Task 10.

- [ ] **Step 1: Write the failing tests**

Append to `engine/tests/test_nodes_pytorch.py`:

```python
def _image_batch(n=4, channels=3, height=8, width=8):
    import torch

    images = torch.zeros(n, channels, height, width)
    labels = torch.zeros(n, dtype=torch.long)
    return {"images": images, "labels": labels}


def test_image_input_execute_infers_spatial_shape():
    image_input = _load_node_module("pytorch_models/image_input")

    outputs = image_input.execute(
        {"train_images": _image_batch(channels=3, height=8, width=8)}, {"random_state": 42}
    )

    architecture = outputs["architecture"]
    assert architecture["modules"] == []
    assert architecture["in_features"] is None
    assert architecture["shape"] == (3, 8, 8)


def test_image_input_codegen_emits_seed_and_shape():
    image_input = _load_node_module("pytorch_models/image_input")
    lines = image_input.codegen(
        {"train_images": "n1_train"},
        {"random_state": 42},
        {"architecture": "n2_architecture"},
    )
    assert lines == [
        "torch.manual_seed(42)",
        "n2_architecture_shape = tuple(n1_train_images.shape[1:])",
        "n2_architecture_in_features = None",
        "n2_architecture = []",
    ]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest engine/tests/test_nodes_pytorch.py -v -k image_input`
Expected: FAIL — the node module does not exist yet.

- [ ] **Step 3: Write the manifest**

Create `engine/vmb_engine/nodes/pytorch_models/image_input/manifest.json`:

```json
{
    "id": "pytorch_models.image_input",
    "category": "Models (PyTorch)",
    "label": "Image Input",
    "inputs": [{"name": "train_images", "type": "ImageBatch"}],
    "outputs": [{"name": "architecture", "type": "Layer"}],
    "params": [
        {"name": "random_state", "type": "number", "label": "Random State", "default": 42}
    ]
}
```

- [ ] **Step 4: Implement the node**

Create `engine/vmb_engine/nodes/pytorch_models/image_input/node.py`:

```python
IMPORTS = ["import torch"]


def execute(inputs: dict, params: dict) -> dict:
    import torch

    torch.manual_seed(params["random_state"])
    images = inputs["train_images"]["images"]
    channels, height, width = images.shape[1:]
    return {
        "architecture": {
            "modules": [],
            "in_features": None,
            "shape": (channels, height, width),
        }
    }


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    train_in = inputs["train_images"]
    out_var = var_names["architecture"]
    random_state = params["random_state"]
    return [
        f"torch.manual_seed({random_state})",
        f"{out_var}_shape = tuple({train_in}_images.shape[1:])",
        f"{out_var}_in_features = None",
        f"{out_var} = []",
    ]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/pytest engine/tests/test_nodes_pytorch.py -v -k image_input`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add engine/vmb_engine/nodes/pytorch_models/image_input engine/tests/test_nodes_pytorch.py
git commit -m "engine: add pytorch_models.image_input node"
```

---

## Task 6: `pytorch_models/conv2d` node

**Files:**
- Create: `engine/vmb_engine/nodes/pytorch_models/conv2d/manifest.json`
- Create: `engine/vmb_engine/nodes/pytorch_models/conv2d/node.py`
- Test: `engine/tests/test_nodes_pytorch.py` (append)

**Interfaces:**
- Consumes: the `Layer` dict's `shape` key (Task 4), `_image_batch`
  helper (Task 5, already in the test file).
- Produces: `pytorch_models.conv2d` node — `architecture` (`Layer`) in
  and out; same-padding conv, `shape=(out_channels, H, W)`. Used by
  Task 10.

- [ ] **Step 1: Write the failing tests**

Append to `engine/tests/test_nodes_pytorch.py`:

```python
def test_conv2d_execute_updates_channel_count_and_preserves_hw():
    conv2d = _load_node_module("pytorch_models/conv2d")

    outputs = conv2d.execute(
        {"architecture": {"modules": [], "in_features": None, "shape": (3, 8, 8)}},
        {"out_channels": 6, "kernel_size": 3},
    )

    architecture = outputs["architecture"]
    assert len(architecture["modules"]) == 1
    assert architecture["modules"][0].out_channels == 6
    assert architecture["shape"] == (6, 8, 8)
    assert architecture["in_features"] is None


def test_conv2d_execute_raises_without_spatial_shape():
    conv2d = _load_node_module("pytorch_models/conv2d")

    try:
        conv2d.execute(
            {"architecture": {"modules": [], "in_features": 8, "shape": None}},
            {"out_channels": 6, "kernel_size": 3},
        )
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "spatial shape" in str(exc)


def test_conv2d_codegen_emits_conv_append():
    conv2d = _load_node_module("pytorch_models/conv2d")
    lines = conv2d.codegen(
        {"architecture": "n1_architecture"},
        {"out_channels": 6, "kernel_size": 3},
        {"architecture": "n2_architecture"},
    )
    assert lines == [
        "assert n1_architecture_shape is not None, "
        "'Conv2D requires a spatial shape; insert after Image Input, another "
        "Conv2D/BatchNorm2D/MaxPool2D — not after Flatten/Linear'",
        "n2_architecture = n1_architecture + "
        "[nn.Conv2d(n1_architecture_shape[0], 6, 3, padding='same')]",
        "n2_architecture_shape = (6, n1_architecture_shape[1], n1_architecture_shape[2])",
        "n2_architecture_in_features = None",
    ]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest engine/tests/test_nodes_pytorch.py -v -k conv2d`
Expected: FAIL — the node module does not exist yet.

- [ ] **Step 3: Write the manifest**

Create `engine/vmb_engine/nodes/pytorch_models/conv2d/manifest.json`:

```json
{
    "id": "pytorch_models.conv2d",
    "category": "Models (PyTorch)",
    "label": "Conv2D",
    "inputs": [{"name": "architecture", "type": "Layer"}],
    "outputs": [{"name": "architecture", "type": "Layer"}],
    "params": [
        {"name": "out_channels", "type": "number", "label": "Output Channels", "default": 16},
        {"name": "kernel_size", "type": "number", "label": "Kernel Size", "default": 3}
    ]
}
```

- [ ] **Step 4: Implement the node**

Create `engine/vmb_engine/nodes/pytorch_models/conv2d/node.py`:

```python
IMPORTS = ["import torch.nn as nn"]

_SHAPE_ERROR = (
    "Conv2D requires a spatial shape; insert after Image Input, another "
    "Conv2D/BatchNorm2D/MaxPool2D — not after Flatten/Linear"
)


def execute(inputs: dict, params: dict) -> dict:
    import torch.nn as nn

    architecture = inputs["architecture"]
    shape = architecture["shape"]
    if shape is None:
        raise ValueError(_SHAPE_ERROR)
    channels, height, width = shape
    out_channels = params["out_channels"]
    kernel_size = params["kernel_size"]
    layer = nn.Conv2d(channels, out_channels, kernel_size, padding="same")
    modules = architecture["modules"] + [layer]
    return {
        "architecture": {
            "modules": modules,
            "in_features": None,
            "shape": (out_channels, height, width),
        }
    }


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    in_var = inputs["architecture"]
    out_var = var_names["architecture"]
    out_channels = params["out_channels"]
    kernel_size = params["kernel_size"]
    return [
        f"assert {in_var}_shape is not None, {_SHAPE_ERROR!r}",
        f"{out_var} = {in_var} + "
        f"[nn.Conv2d({in_var}_shape[0], {out_channels}, {kernel_size}, padding='same')]",
        f"{out_var}_shape = ({out_channels}, {in_var}_shape[1], {in_var}_shape[2])",
        f"{out_var}_in_features = None",
    ]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/pytest engine/tests/test_nodes_pytorch.py -v -k conv2d`
Expected: PASS (3 passed).

- [ ] **Step 6: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add engine/vmb_engine/nodes/pytorch_models/conv2d engine/tests/test_nodes_pytorch.py
git commit -m "engine: add pytorch_models.conv2d node (fixed same-padding)"
```

---

## Task 7: `pytorch_models/batchnorm2d` and `pytorch_models/maxpool2d` nodes

**Files:**
- Create: `engine/vmb_engine/nodes/pytorch_models/batchnorm2d/manifest.json`
- Create: `engine/vmb_engine/nodes/pytorch_models/batchnorm2d/node.py`
- Create: `engine/vmb_engine/nodes/pytorch_models/maxpool2d/manifest.json`
- Create: `engine/vmb_engine/nodes/pytorch_models/maxpool2d/node.py`
- Test: `engine/tests/test_nodes_pytorch.py` (append)

**Interfaces:**
- Consumes: the `Layer` dict's `shape` key (Task 4).
- Produces: `pytorch_models.batchnorm2d` (shape unchanged) and
  `pytorch_models.maxpool2d` (`shape=(C, H//pool_size, W//pool_size)`).
  Both consumed by Task 10.

Grouped into one task — both are small, single-purpose shape-preserving-
or-shape-halving nodes with no complex logic, same granularity precedent
as `nn-training-core`'s combined `ReLU`+`Dropout` task.

- [ ] **Step 1: Write the failing tests**

Append to `engine/tests/test_nodes_pytorch.py`:

```python
def test_batchnorm2d_execute_preserves_shape():
    batchnorm2d = _load_node_module("pytorch_models/batchnorm2d")

    outputs = batchnorm2d.execute(
        {"architecture": {"modules": [], "in_features": None, "shape": (6, 8, 8)}}, {}
    )

    architecture = outputs["architecture"]
    assert len(architecture["modules"]) == 1
    assert architecture["modules"][0].num_features == 6
    assert architecture["shape"] == (6, 8, 8)


def test_batchnorm2d_execute_raises_without_spatial_shape():
    batchnorm2d = _load_node_module("pytorch_models/batchnorm2d")

    try:
        batchnorm2d.execute(
            {"architecture": {"modules": [], "in_features": 8, "shape": None}}, {}
        )
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "spatial shape" in str(exc)


def test_batchnorm2d_codegen_emits_batchnorm_append():
    batchnorm2d = _load_node_module("pytorch_models/batchnorm2d")
    lines = batchnorm2d.codegen(
        {"architecture": "n1_architecture"}, {}, {"architecture": "n2_architecture"}
    )
    assert lines == [
        "assert n1_architecture_shape is not None, "
        "'BatchNorm2D requires a spatial shape; insert after Image Input, another "
        "Conv2D/BatchNorm2D/MaxPool2D — not after Flatten/Linear'",
        "n2_architecture = n1_architecture + [nn.BatchNorm2d(n1_architecture_shape[0])]",
        "n2_architecture_shape = n1_architecture_shape",
        "n2_architecture_in_features = None",
    ]


def test_maxpool2d_execute_halves_spatial_dims():
    maxpool2d = _load_node_module("pytorch_models/maxpool2d")

    outputs = maxpool2d.execute(
        {"architecture": {"modules": [], "in_features": None, "shape": (6, 8, 8)}},
        {"pool_size": 2},
    )

    architecture = outputs["architecture"]
    assert len(architecture["modules"]) == 1
    assert architecture["shape"] == (6, 4, 4)


def test_maxpool2d_execute_raises_without_spatial_shape():
    maxpool2d = _load_node_module("pytorch_models/maxpool2d")

    try:
        maxpool2d.execute(
            {"architecture": {"modules": [], "in_features": 8, "shape": None}}, {"pool_size": 2}
        )
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "spatial shape" in str(exc)


def test_maxpool2d_codegen_emits_pool_append():
    maxpool2d = _load_node_module("pytorch_models/maxpool2d")
    lines = maxpool2d.codegen(
        {"architecture": "n1_architecture"}, {"pool_size": 2}, {"architecture": "n2_architecture"}
    )
    assert lines == [
        "assert n1_architecture_shape is not None, "
        "'MaxPool2D requires a spatial shape; insert after Image Input, another "
        "Conv2D/BatchNorm2D/MaxPool2D — not after Flatten/Linear'",
        "n2_architecture = n1_architecture + [nn.MaxPool2d(2)]",
        "n2_architecture_shape = (n1_architecture_shape[0], "
        "n1_architecture_shape[1] // 2, n1_architecture_shape[2] // 2)",
        "n2_architecture_in_features = None",
    ]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest engine/tests/test_nodes_pytorch.py -v -k "batchnorm2d or maxpool2d"`
Expected: FAIL — neither node module exists yet.

- [ ] **Step 3: Write the manifests**

Create `engine/vmb_engine/nodes/pytorch_models/batchnorm2d/manifest.json`:

```json
{
    "id": "pytorch_models.batchnorm2d",
    "category": "Models (PyTorch)",
    "label": "BatchNorm2D",
    "inputs": [{"name": "architecture", "type": "Layer"}],
    "outputs": [{"name": "architecture", "type": "Layer"}],
    "params": []
}
```

Create `engine/vmb_engine/nodes/pytorch_models/maxpool2d/manifest.json`:

```json
{
    "id": "pytorch_models.maxpool2d",
    "category": "Models (PyTorch)",
    "label": "MaxPool2D",
    "inputs": [{"name": "architecture", "type": "Layer"}],
    "outputs": [{"name": "architecture", "type": "Layer"}],
    "params": [
        {"name": "pool_size", "type": "number", "label": "Pool Size", "default": 2}
    ]
}
```

- [ ] **Step 4: Implement the nodes**

Create `engine/vmb_engine/nodes/pytorch_models/batchnorm2d/node.py`:

```python
IMPORTS = ["import torch.nn as nn"]

_SHAPE_ERROR = (
    "BatchNorm2D requires a spatial shape; insert after Image Input, another "
    "Conv2D/BatchNorm2D/MaxPool2D — not after Flatten/Linear"
)


def execute(inputs: dict, params: dict) -> dict:
    import torch.nn as nn

    architecture = inputs["architecture"]
    shape = architecture["shape"]
    if shape is None:
        raise ValueError(_SHAPE_ERROR)
    layer = nn.BatchNorm2d(shape[0])
    modules = architecture["modules"] + [layer]
    return {"architecture": {"modules": modules, "in_features": None, "shape": shape}}


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    in_var = inputs["architecture"]
    out_var = var_names["architecture"]
    return [
        f"assert {in_var}_shape is not None, {_SHAPE_ERROR!r}",
        f"{out_var} = {in_var} + [nn.BatchNorm2d({in_var}_shape[0])]",
        f"{out_var}_shape = {in_var}_shape",
        f"{out_var}_in_features = None",
    ]
```

Create `engine/vmb_engine/nodes/pytorch_models/maxpool2d/node.py`:

```python
IMPORTS = ["import torch.nn as nn"]

_SHAPE_ERROR = (
    "MaxPool2D requires a spatial shape; insert after Image Input, another "
    "Conv2D/BatchNorm2D/MaxPool2D — not after Flatten/Linear"
)


def execute(inputs: dict, params: dict) -> dict:
    import torch.nn as nn

    architecture = inputs["architecture"]
    shape = architecture["shape"]
    if shape is None:
        raise ValueError(_SHAPE_ERROR)
    pool_size = params["pool_size"]
    channels, height, width = shape
    layer = nn.MaxPool2d(pool_size)
    modules = architecture["modules"] + [layer]
    return {
        "architecture": {
            "modules": modules,
            "in_features": None,
            "shape": (channels, height // pool_size, width // pool_size),
        }
    }


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    in_var = inputs["architecture"]
    out_var = var_names["architecture"]
    pool_size = params["pool_size"]
    return [
        f"assert {in_var}_shape is not None, {_SHAPE_ERROR!r}",
        f"{out_var} = {in_var} + [nn.MaxPool2d({pool_size})]",
        f"{out_var}_shape = ({in_var}_shape[0], "
        f"{in_var}_shape[1] // {pool_size}, {in_var}_shape[2] // {pool_size})",
        f"{out_var}_in_features = None",
    ]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/pytest engine/tests/test_nodes_pytorch.py -v -k "batchnorm2d or maxpool2d"`
Expected: PASS (6 passed).

- [ ] **Step 6: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add engine/vmb_engine/nodes/pytorch_models/batchnorm2d engine/vmb_engine/nodes/pytorch_models/maxpool2d \
  engine/tests/test_nodes_pytorch.py
git commit -m "engine: add pytorch_models.batchnorm2d and pytorch_models.maxpool2d nodes"
```

---

## Task 8: `pytorch_models/flatten` node

**Files:**
- Create: `engine/vmb_engine/nodes/pytorch_models/flatten/manifest.json`
- Create: `engine/vmb_engine/nodes/pytorch_models/flatten/node.py`
- Test: `engine/tests/test_nodes_pytorch.py` (append)

**Interfaces:**
- Consumes: the `Layer` dict's `shape` key (Task 4).
- Produces: `pytorch_models.flatten` node — collapses `shape=(C,H,W)`
  into `in_features = C*H*W`, `shape=None`, so the *existing*
  `Linear`/`ReLU`/`Dropout` nodes work unmodified downstream. Used by
  Task 10.

- [ ] **Step 1: Write the failing tests**

Append to `engine/tests/test_nodes_pytorch.py`:

```python
def test_flatten_execute_collapses_shape_to_in_features():
    flatten = _load_node_module("pytorch_models/flatten")

    outputs = flatten.execute(
        {"architecture": {"modules": [], "in_features": None, "shape": (6, 4, 4)}}, {}
    )

    architecture = outputs["architecture"]
    assert len(architecture["modules"]) == 1
    assert architecture["in_features"] == 96
    assert architecture["shape"] is None


def test_flatten_execute_raises_without_spatial_shape():
    flatten = _load_node_module("pytorch_models/flatten")

    try:
        flatten.execute({"architecture": {"modules": [], "in_features": 8, "shape": None}}, {})
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "spatial shape" in str(exc)


def test_flatten_codegen_emits_flatten_append():
    flatten = _load_node_module("pytorch_models/flatten")
    lines = flatten.codegen(
        {"architecture": "n1_architecture"}, {}, {"architecture": "n2_architecture"}
    )
    assert lines == [
        "assert n1_architecture_shape is not None, "
        "'Flatten requires a spatial shape; nothing to flatten'",
        "n2_architecture = n1_architecture + [nn.Flatten()]",
        "n2_architecture_in_features = "
        "n1_architecture_shape[0] * n1_architecture_shape[1] * n1_architecture_shape[2]",
        "n2_architecture_shape = None",
    ]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest engine/tests/test_nodes_pytorch.py -v -k flatten`
Expected: FAIL — the node module does not exist yet.

- [ ] **Step 3: Write the manifest**

Create `engine/vmb_engine/nodes/pytorch_models/flatten/manifest.json`:

```json
{
    "id": "pytorch_models.flatten",
    "category": "Models (PyTorch)",
    "label": "Flatten",
    "inputs": [{"name": "architecture", "type": "Layer"}],
    "outputs": [{"name": "architecture", "type": "Layer"}],
    "params": []
}
```

- [ ] **Step 4: Implement the node**

Create `engine/vmb_engine/nodes/pytorch_models/flatten/node.py`:

```python
IMPORTS = ["import torch.nn as nn"]

_SHAPE_ERROR = "Flatten requires a spatial shape; nothing to flatten"


def execute(inputs: dict, params: dict) -> dict:
    import torch.nn as nn

    architecture = inputs["architecture"]
    shape = architecture["shape"]
    if shape is None:
        raise ValueError(_SHAPE_ERROR)
    channels, height, width = shape
    modules = architecture["modules"] + [nn.Flatten()]
    return {
        "architecture": {
            "modules": modules,
            "in_features": channels * height * width,
            "shape": None,
        }
    }


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    in_var = inputs["architecture"]
    out_var = var_names["architecture"]
    return [
        f"assert {in_var}_shape is not None, {_SHAPE_ERROR!r}",
        f"{out_var} = {in_var} + [nn.Flatten()]",
        f"{out_var}_in_features = "
        f"{in_var}_shape[0] * {in_var}_shape[1] * {in_var}_shape[2]",
        f"{out_var}_shape = None",
    ]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/pytest engine/tests/test_nodes_pytorch.py -v -k flatten`
Expected: PASS (3 passed).

- [ ] **Step 6: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add engine/vmb_engine/nodes/pytorch_models/flatten engine/tests/test_nodes_pytorch.py
git commit -m "engine: add pytorch_models.flatten node"
```

---

## Task 9: `pytorch_models/train_image_classifier` node

**Files:**
- Create: `engine/vmb_engine/nodes/pytorch_models/train_image_classifier/manifest.json`
- Create: `engine/vmb_engine/nodes/pytorch_models/train_image_classifier/node.py`
- Test: `engine/tests/test_nodes_pytorch.py` (append)

**Interfaces:**
- Consumes: `ImageBatch` (Task 1), the `Layer` dict's `modules` list
  (unchanged shape, Task 4/8's output), and the `_image_batch(n, channels,
  height, width)` test helper already appended to
  `engine/tests/test_nodes_pytorch.py` by Task 5 (Step 1) — do not
  redefine it. `long_running: true`, so it reuses `execute_pipeline`'s
  existing `progress_callback` wiring (`vmb_engine/executor.py`) with no
  executor changes.
- Produces: `pytorch_models.train_image_classifier` — outputs `model`
  (`{"estimator": trained nn.Module}`) and `metrics`
  (`{"final_train_loss": float, "final_val_loss": float,
  "final_val_accuracy": float}`). Used by Task 10.

- [ ] **Step 1: Write the failing tests**

Append to `engine/tests/test_nodes_pytorch.py`:

```python
def _toy_cnn_architecture(channels=1, height=8, width=8, out_classes=2):
    image_input = _load_node_module("pytorch_models/image_input")
    conv2d = _load_node_module("pytorch_models/conv2d")
    flatten = _load_node_module("pytorch_models/flatten")
    linear = _load_node_module("pytorch_models/linear")

    train_images = _image_batch(n=8, channels=channels, height=height, width=width)
    arch = image_input.execute({"train_images": train_images}, {"random_state": 42})[
        "architecture"
    ]
    arch = conv2d.execute({"architecture": arch}, {"out_channels": 4, "kernel_size": 3})[
        "architecture"
    ]
    arch = flatten.execute({"architecture": arch}, {})["architecture"]
    arch = linear.execute({"architecture": arch}, {"out_features": out_classes})["architecture"]
    return arch, train_images


def test_train_image_classifier_execute_trains_and_returns_metrics():
    train_node = _load_node_module("pytorch_models/train_image_classifier")
    architecture, batch = _toy_cnn_architecture()

    outputs = train_node.execute(
        {"train_images": batch, "test_images": batch, "architecture": architecture},
        {
            "loss_fn": "CrossEntropyLoss",
            "optimizer": "Adam",
            "learning_rate": 0.01,
            "epochs": 2,
            "batch_size": 4,
        },
    )

    model = outputs["model"]
    preds = model["estimator"](batch["images"])
    assert preds.shape == (8, 2)

    metrics = outputs["metrics"]
    assert isinstance(metrics["final_train_loss"], float)
    assert isinstance(metrics["final_val_loss"], float)
    assert isinstance(metrics["final_val_accuracy"], float)


def test_train_image_classifier_execute_calls_progress_callback_once_per_epoch():
    train_node = _load_node_module("pytorch_models/train_image_classifier")
    architecture, batch = _toy_cnn_architecture()

    events = []
    train_node.execute(
        {"train_images": batch, "test_images": batch, "architecture": architecture},
        {
            "loss_fn": "CrossEntropyLoss",
            "optimizer": "Adam",
            "learning_rate": 0.01,
            "epochs": 2,
            "batch_size": 4,
        },
        progress_callback=events.append,
    )

    assert [e["epoch"] for e in events] == [0, 1]
    assert all(e["event"] == "progress" for e in events)


def test_train_image_classifier_codegen_emits_training_loop():
    train_node = _load_node_module("pytorch_models/train_image_classifier")
    lines = train_node.codegen(
        {"train_images": "n2_train", "test_images": "n2_test", "architecture": "n5_architecture"},
        {
            "loss_fn": "CrossEntropyLoss",
            "optimizer": "Adam",
            "learning_rate": 0.001,
            "epochs": 5,
            "batch_size": 16,
        },
        {"model": "n6_model", "metrics": "n6_metrics"},
    )
    assert lines == [
        "n6_model_module = nn.Sequential(*n5_architecture)",
        "n6_model_loss_fn = nn.CrossEntropyLoss()",
        "n6_model_optimizer = torch.optim.Adam(n6_model_module.parameters(), lr=0.001)",
        "n6_model_n = n2_train_images.shape[0]",
        "n6_model_train_loss = 0.0",
        "n6_model_val_loss = 0.0",
        "n6_model_val_accuracy = 0.0",
        "for n6_model_epoch in range(5):",
        "    n6_model_module.train()",
        "    n6_model_permutation = torch.randperm(n6_model_n)",
        "    n6_model_epoch_loss = 0.0",
        "    for n6_model_start in range(0, n6_model_n, 16):",
        "        n6_model_idx = n6_model_permutation[n6_model_start:n6_model_start + 16]",
        "        n6_model_xb = n2_train_images[n6_model_idx]",
        "        n6_model_yb = n2_train_labels[n6_model_idx]",
        "        n6_model_optimizer.zero_grad()",
        "        n6_model_out = n6_model_module(n6_model_xb)",
        "        n6_model_loss = n6_model_loss_fn(n6_model_out, n6_model_yb)",
        "        n6_model_loss.backward()",
        "        n6_model_optimizer.step()",
        "        n6_model_epoch_loss += n6_model_loss.item() * len(n6_model_idx)",
        "    n6_model_train_loss = n6_model_epoch_loss / n6_model_n",
        "    n6_model_module.eval()",
        "    with torch.no_grad():",
        "        n6_model_val_out = n6_model_module(n2_test_images)",
        "        n6_model_val_loss = n6_model_loss_fn(n6_model_val_out, n2_test_labels).item()",
        "        n6_model_val_accuracy = (n6_model_val_out.argmax(dim=1) == "
        "n2_test_labels).float().mean().item()",
        "n6_model = {'estimator': n6_model_module}",
        "n6_metrics = {'final_train_loss': float(n6_model_train_loss), "
        "'final_val_loss': float(n6_model_val_loss), "
        "'final_val_accuracy': float(n6_model_val_accuracy)}",
        "print(n6_metrics)",
    ]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest engine/tests/test_nodes_pytorch.py -v -k train_image_classifier`
Expected: FAIL — the node module does not exist yet.

- [ ] **Step 3: Write the manifest**

Create `engine/vmb_engine/nodes/pytorch_models/train_image_classifier/manifest.json`:

```json
{
    "id": "pytorch_models.train_image_classifier",
    "category": "Models (PyTorch)",
    "label": "Train Image Classifier",
    "inputs": [
        {"name": "train_images", "type": "ImageBatch"},
        {"name": "test_images", "type": "ImageBatch"},
        {"name": "architecture", "type": "Layer"}
    ],
    "outputs": [
        {"name": "model", "type": "Model"},
        {"name": "metrics", "type": "Metrics"}
    ],
    "params": [
        {
            "name": "loss_fn",
            "type": "select",
            "label": "Loss Function",
            "default": "CrossEntropyLoss",
            "options": ["CrossEntropyLoss"]
        },
        {
            "name": "optimizer",
            "type": "select",
            "label": "Optimizer",
            "default": "Adam",
            "options": ["Adam", "SGD"]
        },
        {"name": "learning_rate", "type": "number", "label": "Learning Rate", "default": 0.001},
        {"name": "epochs", "type": "number", "label": "Epochs", "default": 10},
        {"name": "batch_size", "type": "number", "label": "Batch Size", "default": 32}
    ],
    "long_running": true
}
```

- [ ] **Step 4: Implement the node**

Create `engine/vmb_engine/nodes/pytorch_models/train_image_classifier/node.py`:

```python
IMPORTS = ["import torch", "import torch.nn as nn"]


def execute(inputs: dict, params: dict, progress_callback=None) -> dict:
    import torch
    import torch.nn as nn

    train_images = inputs["train_images"]["images"]
    train_labels = inputs["train_images"]["labels"]
    test_images = inputs["test_images"]["images"]
    test_labels = inputs["test_images"]["labels"]
    architecture = inputs["architecture"]

    model = nn.Sequential(*architecture["modules"])
    loss_fn = getattr(nn, params["loss_fn"])()
    optimizer = getattr(torch.optim, params["optimizer"])(
        model.parameters(), lr=params["learning_rate"]
    )

    batch_size = params["batch_size"]
    n = train_images.shape[0]
    train_loss = 0.0
    val_loss = 0.0
    val_accuracy = 0.0

    for epoch in range(params["epochs"]):
        model.train()
        permutation = torch.randperm(n)
        epoch_loss = 0.0
        for start in range(0, n, batch_size):
            idx = permutation[start : start + batch_size]
            xb, yb = train_images[idx], train_labels[idx]
            optimizer.zero_grad()
            out = model(xb)
            loss = loss_fn(out, yb)
            loss.backward()
            optimizer.step()
            epoch_loss += loss.item() * len(idx)
        train_loss = epoch_loss / n

        model.eval()
        with torch.no_grad():
            val_out = model(test_images)
            val_loss = loss_fn(val_out, test_labels).item()
            val_accuracy = (val_out.argmax(dim=1) == test_labels).float().mean().item()

        if progress_callback is not None:
            progress_callback(
                {"event": "progress", "epoch": epoch, "loss": train_loss, "val_loss": val_loss}
            )

    return {
        "model": {"estimator": model},
        "metrics": {
            "final_train_loss": float(train_loss),
            "final_val_loss": float(val_loss),
            "final_val_accuracy": float(val_accuracy),
        },
    }


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    train_in = inputs["train_images"]
    test_in = inputs["test_images"]
    arch_in = inputs["architecture"]
    model_var = var_names["model"]
    metrics_var = var_names["metrics"]
    loss_fn = params["loss_fn"]
    optimizer = params["optimizer"]
    lr = params["learning_rate"]
    epochs = params["epochs"]
    batch_size = params["batch_size"]

    return [
        f"{model_var}_module = nn.Sequential(*{arch_in})",
        f"{model_var}_loss_fn = nn.{loss_fn}()",
        f"{model_var}_optimizer = torch.optim.{optimizer}({model_var}_module.parameters(), lr={lr})",
        f"{model_var}_n = {train_in}_images.shape[0]",
        f"{model_var}_train_loss = 0.0",
        f"{model_var}_val_loss = 0.0",
        f"{model_var}_val_accuracy = 0.0",
        f"for {model_var}_epoch in range({epochs}):",
        f"    {model_var}_module.train()",
        f"    {model_var}_permutation = torch.randperm({model_var}_n)",
        f"    {model_var}_epoch_loss = 0.0",
        f"    for {model_var}_start in range(0, {model_var}_n, {batch_size}):",
        f"        {model_var}_idx = "
        f"{model_var}_permutation[{model_var}_start:{model_var}_start + {batch_size}]",
        f"        {model_var}_xb = {train_in}_images[{model_var}_idx]",
        f"        {model_var}_yb = {train_in}_labels[{model_var}_idx]",
        f"        {model_var}_optimizer.zero_grad()",
        f"        {model_var}_out = {model_var}_module({model_var}_xb)",
        f"        {model_var}_loss = {model_var}_loss_fn({model_var}_out, {model_var}_yb)",
        f"        {model_var}_loss.backward()",
        f"        {model_var}_optimizer.step()",
        f"        {model_var}_epoch_loss += {model_var}_loss.item() * len({model_var}_idx)",
        f"    {model_var}_train_loss = {model_var}_epoch_loss / {model_var}_n",
        f"    {model_var}_module.eval()",
        "    with torch.no_grad():",
        f"        {model_var}_val_out = {model_var}_module({test_in}_images)",
        f"        {model_var}_val_loss = {model_var}_loss_fn({model_var}_val_out, {test_in}_labels).item()",
        f"        {model_var}_val_accuracy = ({model_var}_val_out.argmax(dim=1) == "
        f"{test_in}_labels).float().mean().item()",
        f"{model_var} = {{'estimator': {model_var}_module}}",
        f"{metrics_var} = {{'final_train_loss': float({model_var}_train_loss), "
        f"'final_val_loss': float({model_var}_val_loss), "
        f"'final_val_accuracy': float({model_var}_val_accuracy)}}",
        f"print({metrics_var})",
    ]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/pytest engine/tests/test_nodes_pytorch.py -v -k train_image_classifier`
Expected: PASS (3 passed).

- [ ] **Step 6: Run the full pytorch node test file**

Run: `.venv/bin/pytest engine/tests/test_nodes_pytorch.py -v`
Expected: PASS (all tests from Tasks 4-9 combined).

- [ ] **Step 7: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add engine/vmb_engine/nodes/pytorch_models/train_image_classifier engine/tests/test_nodes_pytorch.py
git commit -m "engine: add pytorch_models.train_image_classifier node"
```

---

## Task 10: Executor/codegen equivalence test for a full CNN pipeline

**Files:**
- Test: `engine/tests/test_equivalence.py` (append)

**Interfaces:**
- Consumes: `data.image_folder_loader`, `preprocessing.normalize_images`,
  `pytorch_models.image_input/conv2d/relu/maxpool2d/flatten/linear/
  train_image_classifier` (all existing by this point).

- [ ] **Step 1: Write the failing test**

Append to `engine/tests/test_equivalence.py`:

```python
def test_executor_and_exported_script_agree_with_cnn_pipeline(tmp_path, registry):
    from PIL import Image

    data_dir = tmp_path / "images"
    for class_name, shade in (("cat", 50), ("dog", 200)):
        class_dir = data_dir / class_name
        class_dir.mkdir(parents=True)
        for i in range(10):
            Image.new("RGB", (16, 16), color=(shade, shade, shade)).save(class_dir / f"{i}.png")

    ir = PipelineIR.model_validate(
        {
            "nodes": [
                {
                    "id": "n1",
                    "type": "data.image_folder_loader",
                    "params": {
                        "directory": str(data_dir),
                        "image_size": 16,
                        "test_size": 0.3,
                        "random_state": 42,
                    },
                },
                {"id": "n2", "type": "preprocessing.normalize_images", "params": {}},
                {"id": "n3", "type": "pytorch_models.image_input", "params": {"random_state": 42}},
                {
                    "id": "n4",
                    "type": "pytorch_models.conv2d",
                    "params": {"out_channels": 4, "kernel_size": 3},
                },
                {"id": "n5", "type": "pytorch_models.relu", "params": {}},
                {"id": "n6", "type": "pytorch_models.maxpool2d", "params": {"pool_size": 2}},
                {"id": "n7", "type": "pytorch_models.flatten", "params": {}},
                {"id": "n8", "type": "pytorch_models.linear", "params": {"out_features": 2}},
                {
                    "id": "n9",
                    "type": "pytorch_models.train_image_classifier",
                    "params": {
                        "loss_fn": "CrossEntropyLoss",
                        "optimizer": "Adam",
                        "learning_rate": 0.01,
                        "epochs": 2,
                        "batch_size": 4,
                    },
                },
            ],
            "edges": [
                {"from": "n1.train", "to": "n2.train_images"},
                {"from": "n1.test", "to": "n2.test_images"},
                {"from": "n2.train", "to": "n3.train_images"},
                {"from": "n3.architecture", "to": "n4.architecture"},
                {"from": "n4.architecture", "to": "n5.architecture"},
                {"from": "n5.architecture", "to": "n6.architecture"},
                {"from": "n6.architecture", "to": "n7.architecture"},
                {"from": "n7.architecture", "to": "n8.architecture"},
                {"from": "n2.train", "to": "n9.train_images"},
                {"from": "n2.test", "to": "n9.test_images"},
                {"from": "n8.architecture", "to": "n9.architecture"},
            ],
        }
    )

    context = execute_pipeline(ir, registry)
    executor_accuracy = context["n9.metrics"]["final_val_accuracy"]

    code = generate_code(ir, registry)
    script_path = tmp_path / "exported_cnn.py"
    script_path.write_text(code)

    result = subprocess.run(
        [sys.executable, str(script_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr

    match = re.search(r"'final_val_accuracy':\s*([0-9.eE+-]+)", result.stdout)
    assert match is not None, f"no final_val_accuracy found in script output:\n{result.stdout}"
    script_accuracy = float(match.group(1))

    assert executor_accuracy == pytest.approx(script_accuracy, abs=1e-6)
```

- [ ] **Step 2: Run to verify it fails or passes**

Run: `.venv/bin/pytest engine/tests/test_equivalence.py -v -k cnn`
Expected: this is the end-to-end integration check for Tasks 1-9 — if all
prior tasks are correct it may already PASS; run regardless to confirm.

- [ ] **Step 3: Fix any mismatch**

If `executor_accuracy != script_accuracy`, compare each new node's
`execute()` and `codegen()` side by side — the most likely cause is a
line-order/variable-naming mismatch, or RNG consumption happening in a
different order between the two paths (weight init in `Conv2D`/`Linear`,
batch shuffling in `train_image_classifier` — both must consume `torch`'s
global RNG in identical sequence live vs. exported).

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/pytest engine/tests/test_equivalence.py -v -k cnn`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add engine/tests/test_equivalence.py
git commit -m "engine: add executor/codegen equivalence test for CNN pipeline"
```

---

## Task 11: `ImageBatch` port color (frontend)

**Files:**
- Modify: `apps/frontend/src/canvas/PipelineCanvas.tsx`
- Modify: `apps/frontend/tests/PipelineCanvas.test.tsx`

**Interfaces:**
- Consumes: nothing new — `PORT_TYPE_COLORS` already exists
  (`apps/frontend/src/canvas/PipelineCanvas.tsx`).
- Produces: nothing consumed by later tasks — this is the plan's only
  frontend change; everything else (palette, inspector, canvas
  rendering, connection validation) is already fully manifest-driven, per
  the same pattern every `pytorch_models` node already follows.

- [ ] **Step 1: Write the failing test**

In `apps/frontend/tests/PipelineCanvas.test.tsx`, append (after the
existing `describe('PipelineCanvas port/edge coloring', ...)` block —
reuses that file's existing imports, `noop`, `csvManifest`, and `client`
mock, all already present):

```tsx
describe('PipelineCanvas ImageBatch port coloring', () => {
  it('colors an ImageBatch port handle distinctly from Table/Layer', () => {
    const loaderManifest: NodeManifest = {
      id: 'data.built_in_image_dataset',
      category: 'Data',
      label: 'Built-in Image Dataset',
      inputs: [],
      outputs: [
        { name: 'train', type: 'ImageBatch' },
        { name: 'test', type: 'ImageBatch' },
      ],
      params: [],
      long_running: false,
    }
    vi.mocked(client.useNodes).mockReturnValue({
      data: [loaderManifest],
      isLoading: false,
      error: null,
    } as ReturnType<typeof client.useNodes>)
    const node: PipelineNode = {
      id: 'n1',
      type: 'pipelineNode',
      position: { x: 0, y: 0 },
      data: { manifest: loaderManifest, params: {} },
    }

    const { container } = render(
      <PipelineCanvas
        nodes={[node]}
        edges={[]}
        onNodesChange={noop}
        onEdgesChange={noop}
        setNodes={noop}
        setEdges={noop}
        onSelectNode={noop}
      />,
    )

    const handles = container.querySelectorAll<HTMLElement>('.react-flow__handle')
    expect(handles).toHaveLength(2)
    expect(handles[0]?.style.background).toBe('rgb(231, 76, 60)')
    expect(handles[0]?.style.background).not.toBe('rgb(74, 144, 217)') // not Table
    expect(handles[0]?.style.background).not.toBe('rgb(155, 89, 182)') // not Layer
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/frontend && npm test -- PipelineCanvas.test.tsx`
Expected: FAIL — `ImageBatch` isn't in `PORT_TYPE_COLORS` yet, so the
handle falls back to `DEFAULT_PORT_COLOR` (`rgb(136, 136, 136)`), not
`rgb(231, 76, 60)`.

- [ ] **Step 3: Add the color mapping**

In `apps/frontend/src/canvas/PipelineCanvas.tsx`, find the
`PORT_TYPE_COLORS` constant:

```typescript
const PORT_TYPE_COLORS: Record<string, string> = {
  Table: 'rgb(74, 144, 217)',
  Layer: 'rgb(155, 89, 182)',
  Model: 'rgb(46, 204, 113)',
  Metrics: 'rgb(230, 126, 34)',
}
```

Replace it with:

```typescript
const PORT_TYPE_COLORS: Record<string, string> = {
  Table: 'rgb(74, 144, 217)',
  Layer: 'rgb(155, 89, 182)',
  Model: 'rgb(46, 204, 113)',
  Metrics: 'rgb(230, 126, 34)',
  ImageBatch: 'rgb(231, 76, 60)',
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/frontend && npm test -- PipelineCanvas.test.tsx`
Expected: PASS (all tests in the file, including the new one).

- [ ] **Step 5: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add apps/frontend/src/canvas/PipelineCanvas.tsx apps/frontend/tests/PipelineCanvas.test.tsx
git commit -m "frontend: color ImageBatch ports and edges distinctly"
```

---

## Task 12: Full-suite verification and dev-server smoke check

**Files:**
- No source changes expected; fix inline and re-run this task's steps if
  any check below fails.

**Interfaces:**
- Consumes: the full engine (Tasks 1-10) and frontend (Task 11).
- Produces: a verified full test suite. Nothing later depends on this
  task's output — it is the plan's final gate.

- [ ] **Step 1: Run the full engine test suite**

Run: `.venv/bin/pytest engine/tests -v`
Expected: all tests pass, including every new/modified test from Tasks
1-10. No test in this suite makes a real network call — confirm none of
`test_nodes_data_images.py`'s tests are unexpectedly slow (a real MNIST
download would show up as a multi-second `MNIST`-related test; the
`built_in_image_dataset` tests monkeypatch it, so this should not
happen).

- [ ] **Step 2: Run the full frontend test suite**

Run: `cd /home/shreyash/projects/visual_model_builder/apps/frontend && npm test`
Expected: all tests pass.

- [ ] **Step 3: Run the production build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 4: Smoke-check the engine + frontend dev servers together**

```bash
cd /home/shreyash/projects/visual_model_builder
.venv/bin/uvicorn vmb_engine.api:app --port 8000 &
ENGINE_PID=$!
sleep 2
curl -sf http://127.0.0.1:8000/nodes | grep -q "pytorch_models.train_image_classifier" && echo "ENGINE OK"

cd apps/frontend
npm run dev -- --port 5173 &
DEV_PID=$!
sleep 2
curl -sf http://127.0.0.1:5173 | grep -q '<div id="root">' && echo "FRONTEND OK"

kill $ENGINE_PID $DEV_PID
```

Expected: prints `ENGINE OK` and `FRONTEND OK`.

- [ ] **Step 5: Commit (only if Steps 1-4 required fixes)**

If every check above passed with no source changes, there is nothing to
commit — this task is done. Otherwise:

```bash
cd /home/shreyash/projects/visual_model_builder
git add -A engine apps/frontend
git commit -m "engine+frontend: fix issues found in full-suite/build verification"
```

---

## Manual QA (for a human, after this plan is merged)

No task above drives a real browser through an actual CNN training run —
that needs a human. Run this once all 12 tasks are complete:

1. Start the engine: `.venv/bin/uvicorn vmb_engine.api:app --reload`.
2. Start the frontend: `cd apps/frontend && npm run dev`, open the
   printed URL.
3. Drag **Built-in Image Dataset** (dataset: MNIST) onto the canvas,
   then **Normalize Images**, **Image Input**, **Conv2D**, **ReLU**,
   **MaxPool2D**, **Flatten**, **Linear** (out_features: 10), and
   **Train Image Classifier** (all under "Models (PyTorch)" except the
   first two).
4. Connect: Built-in Image Dataset's `train`/`test` → Normalize Images'
   `train_images`/`test_images`; Normalize Images' `train` → Image
   Input's `train_images`; Image Input → Conv2D → ReLU → MaxPool2D →
   Flatten → Linear (all via `architecture`); Normalize Images'
   `train`/`test` and Linear's `architecture` → Train Image Classifier's
   `train_images`/`test_images`/`architecture`. Confirm `ImageBatch`
   edges render in a distinct color from `Table` and `Layer` edges.
5. Click **Run**. Confirm the training monitor modal opens immediately
   and the loss chart updates live, epoch by epoch (first run downloads
   MNIST — expect a delay before the first epoch).
6. Confirm the modal switches to "Training complete" and shows
   `final_val_accuracy` once training finishes.
7. Run a second pipeline using **Image Folder Loader** against a small
   local folder of class-subdirectories instead of the built-in dataset,
   confirming the same architecture chain trains against it.
