IMPORTS = ["from sklearn.preprocessing import StandardScaler"]


def execute(inputs: dict, params: dict) -> dict:
    from sklearn.preprocessing import StandardScaler

    target = params["target_column"]
    train_df = inputs["train_table"]
    test_df = inputs["test_table"]
    numeric_cols = [c for c in train_df.select_dtypes(include="number").columns if c != target]

    scaler = StandardScaler()
    train_out = train_df.copy()
    test_out = test_df.copy()
    train_out[numeric_cols] = scaler.fit_transform(train_df[numeric_cols])
    test_out[numeric_cols] = scaler.transform(test_df[numeric_cols])

    return {"train": train_out, "test": test_out}


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    train_in = inputs["train_table"]
    test_in = inputs["test_table"]
    train_out = var_names["train"]
    test_out = var_names["test"]
    target = params["target_column"]
    return [
        f"{train_out}_scaler = StandardScaler()",
        f"{train_out}_numeric_cols = [c for c in {train_in}.select_dtypes(include='number').columns "
        f"if c != {target!r}]",
        f"{train_out} = {train_in}.copy()",
        f"{test_out} = {test_in}.copy()",
        f"{train_out}[{train_out}_numeric_cols] = "
        f"{train_out}_scaler.fit_transform({train_in}[{train_out}_numeric_cols])",
        f"{test_out}[{train_out}_numeric_cols] = "
        f"{train_out}_scaler.transform({test_in}[{train_out}_numeric_cols])",
    ]
