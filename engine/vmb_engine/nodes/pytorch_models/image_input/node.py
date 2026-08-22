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
