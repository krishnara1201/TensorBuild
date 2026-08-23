IMPORTS = ["from sklearn.cluster import KMeans"]


def execute(inputs: dict, params: dict) -> dict:
    from sklearn.cluster import KMeans

    df = inputs["train_table"]

    model = KMeans(n_clusters=params["n_clusters"], random_state=params["random_state"])
    model.fit(df)

    summary = {
        "cluster_centers": [dict(zip(df.columns, c.tolist())) for c in model.cluster_centers_],
        "inertia": float(model.inertia_),
    }

    return {
        "model": {"estimator": model, "feature_columns": list(df.columns)},
        "model_summary": summary,
    }


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    in_var = inputs["train_table"]
    out_var = var_names["model"]
    summary_var = var_names["model_summary"]
    return [
        f"{out_var} = KMeans("
        f"n_clusters={params['n_clusters']!r}, random_state={params['random_state']!r})",
        f"{out_var}.fit({in_var})",
        f"{summary_var} = {{'cluster_centers': "
        f"[dict(zip({in_var}.columns, c.tolist())) for c in {out_var}.cluster_centers_], "
        f"'inertia': float({out_var}.inertia_)}}",
        f"print({summary_var})",
    ]
