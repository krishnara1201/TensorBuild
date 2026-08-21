IMPORTS = ["from sklearn.cluster import KMeans"]


def execute(inputs: dict, params: dict) -> dict:
    from sklearn.cluster import KMeans

    df = inputs["train_table"]

    model = KMeans(n_clusters=params["n_clusters"], random_state=params["random_state"])
    model.fit(df)

    return {"model": {"estimator": model, "feature_columns": list(df.columns)}}


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    in_var = inputs["train_table"]
    out_var = var_names["model"]
    return [
        f"{out_var} = KMeans("
        f"n_clusters={params['n_clusters']!r}, random_state={params['random_state']!r})",
        f"{out_var}.fit({in_var})",
    ]
