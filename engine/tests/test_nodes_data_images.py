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
