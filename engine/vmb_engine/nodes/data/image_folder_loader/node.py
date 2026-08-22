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
