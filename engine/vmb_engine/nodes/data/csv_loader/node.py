IMPORTS = ["import pandas as pd"]


def execute(inputs: dict, params: dict) -> dict:
    import pandas as pd

    df = pd.read_csv(params["path"])
    return {"table": df}


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    out_var = var_names["table"]
    return [f"{out_var} = pd.read_csv({params['path']!r})"]
