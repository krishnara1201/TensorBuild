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
