IMPORTS = ["from sklearn.svm import SVC"]


def execute(inputs: dict, params: dict) -> dict:
    from sklearn.svm import SVC

    target = params["target_column"]
    df = inputs["train_table"]
    X = df.drop(columns=[target])
    y = df[target]

    model = SVC(C=params["C"], random_state=params["random_state"])
    model.fit(X, y)

    summary = {"kernel": model.kernel, "n_support": model.n_support_.tolist()}

    return {
        "model": {"estimator": model, "feature_columns": list(X.columns)},
        "model_summary": summary,
    }


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    in_var = inputs["train_table"]
    out_var = var_names["model"]
    summary_var = var_names["model_summary"]
    target = params["target_column"]
    return [
        f"{out_var}_X = {in_var}.drop(columns=[{target!r}])",
        f"{out_var}_y = {in_var}[{target!r}]",
        f"{out_var} = SVC(C={params['C']!r}, random_state={params['random_state']!r})",
        f"{out_var}.fit({out_var}_X, {out_var}_y)",
        f"{summary_var} = {{'kernel': {out_var}.kernel, "
        f"'n_support': {out_var}.n_support_.tolist()}}",
        f"print({summary_var})",
    ]
