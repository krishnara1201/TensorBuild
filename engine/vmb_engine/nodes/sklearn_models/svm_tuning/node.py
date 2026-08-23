IMPORTS = [
    "from sklearn.svm import SVC",
    "from sklearn.model_selection import GridSearchCV",
]


def _parse_grid(text, cast):
    values = []
    for raw in text.split(","):
        value = raw.strip()
        values.append(None if value == "None" else cast(value))
    return values


def execute(inputs: dict, params: dict) -> dict:
    from sklearn.svm import SVC
    from sklearn.model_selection import GridSearchCV

    target = params["target_column"]
    df = inputs["train_table"]
    X = df.drop(columns=[target])
    y = df[target]

    param_grid = {"C": _parse_grid(params["C_options"], float)}

    search = GridSearchCV(
        SVC(random_state=params["random_state"]),
        param_grid,
        cv=params["cv"],
        scoring=params["scoring"],
    )
    search.fit(X, y)

    best = search.best_estimator_
    model_summary = {"kernel": best.kernel, "n_support": best.n_support_.tolist()}

    return {
        "model": {"estimator": best, "feature_columns": list(X.columns)},
        "metrics": {"best_params": search.best_params_, "best_score": float(search.best_score_)},
        "model_summary": model_summary,
    }


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    in_var = inputs["train_table"]
    model_var = var_names["model"]
    metrics_var = var_names["metrics"]
    summary_var = var_names["model_summary"]
    target = params["target_column"]

    param_grid = {"C": _parse_grid(params["C_options"], float)}

    return [
        f"{model_var}_X = {in_var}.drop(columns=[{target!r}])",
        f"{model_var}_y = {in_var}[{target!r}]",
        f"{model_var}_param_grid = {param_grid!r}",
        f"{model_var}_search = GridSearchCV("
        f"SVC(random_state={params['random_state']!r}), "
        f"{model_var}_param_grid, cv={params['cv']!r}, scoring={params['scoring']!r})",
        f"{model_var}_search.fit({model_var}_X, {model_var}_y)",
        f"{model_var} = {model_var}_search.best_estimator_",
        f"{metrics_var} = {{'best_params': {model_var}_search.best_params_, "
        f"'best_score': float({model_var}_search.best_score_)}}",
        f"print({metrics_var})",
        f"{summary_var} = {{'kernel': {model_var}.kernel, "
        f"'n_support': {model_var}.n_support_.tolist()}}",
        f"print({summary_var})",
    ]
