IMPORTS = [
    "from sklearn.ensemble import RandomForestClassifier",
    "from sklearn.model_selection import GridSearchCV",
]


def _parse_grid(text, cast):
    values = []
    for raw in text.split(","):
        value = raw.strip()
        values.append(None if value == "None" else cast(value))
    return values


def execute(inputs: dict, params: dict) -> dict:
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.model_selection import GridSearchCV

    target = params["target_column"]
    df = inputs["train_table"]
    X = df.drop(columns=[target])
    y = df[target]

    param_grid = {
        "n_estimators": _parse_grid(params["n_estimators_options"], int),
        "max_depth": _parse_grid(params["max_depth_options"], int),
    }

    search = GridSearchCV(
        RandomForestClassifier(random_state=params["random_state"]),
        param_grid,
        cv=params["cv"],
        scoring=params["scoring"],
    )
    search.fit(X, y)

    return {
        "model": {"estimator": search.best_estimator_, "feature_columns": list(X.columns)},
        "metrics": {"best_params": search.best_params_, "best_score": float(search.best_score_)},
    }


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    in_var = inputs["train_table"]
    model_var = var_names["model"]
    metrics_var = var_names["metrics"]
    target = params["target_column"]

    param_grid = {
        "n_estimators": _parse_grid(params["n_estimators_options"], int),
        "max_depth": _parse_grid(params["max_depth_options"], int),
    }

    return [
        f"{model_var}_X = {in_var}.drop(columns=[{target!r}])",
        f"{model_var}_y = {in_var}[{target!r}]",
        f"{model_var}_param_grid = {param_grid!r}",
        f"{model_var}_search = GridSearchCV("
        f"RandomForestClassifier(random_state={params['random_state']!r}), "
        f"{model_var}_param_grid, cv={params['cv']!r}, scoring={params['scoring']!r})",
        f"{model_var}_search.fit({model_var}_X, {model_var}_y)",
        f"{model_var} = {model_var}_search.best_estimator_",
        f"{metrics_var} = {{'best_params': {model_var}_search.best_params_, "
        f"'best_score': float({model_var}_search.best_score_)}}",
        f"print({metrics_var})",
    ]
