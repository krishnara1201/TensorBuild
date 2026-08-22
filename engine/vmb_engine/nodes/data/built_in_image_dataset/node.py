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
