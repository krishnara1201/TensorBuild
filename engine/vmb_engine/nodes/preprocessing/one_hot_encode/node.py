IMPORTS = ["import pandas as pd", "from sklearn.preprocessing import OneHotEncoder"]


def execute(inputs: dict, params: dict) -> dict:
    import pandas as pd
    from sklearn.preprocessing import OneHotEncoder

    target = params["target_column"]
    train_df = inputs["train_table"]
    test_df = inputs["test_table"]
    cat_cols = [
        c for c in train_df.select_dtypes(include=["object", "string"]).columns if c != target
    ]

    encoder = OneHotEncoder(handle_unknown="ignore", sparse_output=False)
    encoder.fit(train_df[cat_cols])

    def _transform(df):
        encoded = pd.DataFrame(
            encoder.transform(df[cat_cols]),
            columns=encoder.get_feature_names_out(cat_cols),
            index=df.index,
        )
        return pd.concat([df.drop(columns=cat_cols), encoded], axis=1)

    return {"train": _transform(train_df), "test": _transform(test_df)}


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    train_in = inputs["train_table"]
    test_in = inputs["test_table"]
    train_out = var_names["train"]
    test_out = var_names["test"]
    target = params["target_column"]
    return [
        f"{train_out}_cat_cols = [c for c in {train_in}.select_dtypes("
        f"include=['object', 'string']).columns if c != {target!r}]",
        f"{train_out}_encoder = OneHotEncoder(handle_unknown='ignore', sparse_output=False)",
        f"{train_out}_encoder.fit({train_in}[{train_out}_cat_cols])",
        f"{train_out}_encoded = pd.DataFrame(",
        f"    {train_out}_encoder.transform({train_in}[{train_out}_cat_cols]),",
        f"    columns={train_out}_encoder.get_feature_names_out({train_out}_cat_cols),",
        f"    index={train_in}.index,",
        f")",
        f"{train_out} = pd.concat([{train_in}.drop(columns={train_out}_cat_cols), {train_out}_encoded], axis=1)",
        f"{test_out}_encoded = pd.DataFrame(",
        f"    {train_out}_encoder.transform({test_in}[{train_out}_cat_cols]),",
        f"    columns={train_out}_encoder.get_feature_names_out({train_out}_cat_cols),",
        f"    index={test_in}.index,",
        f")",
        f"{test_out} = pd.concat([{test_in}.drop(columns={train_out}_cat_cols), {test_out}_encoded], axis=1)",
    ]
