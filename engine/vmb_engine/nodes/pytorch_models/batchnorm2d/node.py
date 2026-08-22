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
