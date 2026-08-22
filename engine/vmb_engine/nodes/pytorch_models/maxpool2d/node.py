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
