IMPORTS = ["import torch"]


def execute(inputs: dict, params: dict) -> dict:
    import torch

    torch.manual_seed(params["random_state"])
    target = params["target_column"]
    df = inputs["train_table"]
    in_features = len([c for c in df.columns if c != target])
    return {"architecture": {"modules": [], "in_features": in_features, "shape": None}}


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    train_in = inputs["train_table"]
    out_var = var_names["architecture"]
    target = params["target_column"]
    random_state = params["random_state"]
    return [
        f"torch.manual_seed({random_state})",
        f"{out_var}_in_features = len([c for c in {train_in}.columns if c != {target!r}])",
        f"{out_var}_shape = None",
        f"{out_var} = []",
    ]
