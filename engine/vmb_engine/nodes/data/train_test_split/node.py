IMPORTS = ["from sklearn.model_selection import train_test_split"]


def execute(inputs: dict, params: dict) -> dict:
    from sklearn.model_selection import train_test_split

    train_df, test_df = train_test_split(
        inputs["table"],
        test_size=params["test_size"],
        random_state=params["random_state"],
    )
    return {"train": train_df, "test": test_df}


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    in_var = inputs["table"]
    train_var = var_names["train"]
    test_var = var_names["test"]
    test_size = params["test_size"]
    random_state = params["random_state"]
    return [
        f"{train_var}, {test_var} = train_test_split("
        f"{in_var}, test_size={test_size}, random_state={random_state})"
    ]
