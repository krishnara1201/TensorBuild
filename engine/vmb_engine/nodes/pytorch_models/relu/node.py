IMPORTS = ["import torch.nn as nn"]


def execute(inputs: dict, params: dict) -> dict:
    import torch.nn as nn

    architecture = inputs["architecture"]
    modules = architecture["modules"] + [nn.ReLU()]
    return {"architecture": {"modules": modules, "in_features": architecture["in_features"]}}


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    in_var = inputs["architecture"]
    out_var = var_names["architecture"]
    return [
        f"{out_var} = {in_var} + [nn.ReLU()]",
        f"{out_var}_in_features = {in_var}_in_features",
    ]
