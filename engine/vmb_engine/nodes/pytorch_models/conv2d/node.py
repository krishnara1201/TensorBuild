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
