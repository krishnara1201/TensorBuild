IMPORTS = ["import torch.nn as nn"]


def execute(inputs: dict, params: dict) -> dict:
    import torch.nn as nn

    architecture = inputs["architecture"]
    out_features = params["out_features"]
    layer = nn.Linear(architecture["in_features"], out_features)
    modules = architecture["modules"] + [layer]
    return {"architecture": {"modules": modules, "in_features": out_features}}


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    in_var = inputs["architecture"]
    out_var = var_names["architecture"]
    out_features = params["out_features"]
    return [
        f"{out_var} = {in_var} + [nn.Linear({in_var}_in_features, {out_features})]",
        f"{out_var}_in_features = {out_features}",
    ]
