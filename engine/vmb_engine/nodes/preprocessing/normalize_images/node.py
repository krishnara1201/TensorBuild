IMPORTS = ["import torch"]


def execute(inputs: dict, params: dict) -> dict:
    train_batch = inputs["train_images"]
    test_batch = inputs["test_images"]
    train_images = train_batch["images"]

    mean = train_images.mean(dim=(0, 2, 3), keepdim=True)
    std = train_images.std(dim=(0, 2, 3), keepdim=True, unbiased=False)

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
