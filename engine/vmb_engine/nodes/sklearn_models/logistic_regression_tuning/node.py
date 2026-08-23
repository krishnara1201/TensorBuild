IMPORTS = [
    "from sklearn.linear_model import LogisticRegression",
    "from sklearn.model_selection import GridSearchCV",
]


def _parse_grid(text, cast):
    values = []
    for raw in text.split(","):
        value = raw.strip()
        values.append(None if value == "None" else cast(value))
    return values


def _coefficients_summary(model, columns):
    coef = model.coef_
    if coef.shape[0] == 1:
        return {
            "coefficients": dict(zip(columns, coef[0].tolist())),
            "intercept": float(model.intercept_[0]),
        }
    classes = list(model.classes_)[-coef.shape[0] :]
    return {
        "coefficients": {
            str(c): dict(zip(columns, row.tolist())) for c, row in zip(classes, coef)
        },
        "intercept": {str(c): v for c, v in zip(classes, model.intercept_.tolist())},
    }


def execute(inputs: dict, params: dict) -> dict:
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import GridSearchCV

    target = params["target_column"]
    df = inputs["train_table"]
    X = df.drop(columns=[target])
    y = df[target]

    param_grid = {"C": _parse_grid(params["C_options"], float)}

    search = GridSearchCV(
        LogisticRegression(max_iter=1000, random_state=params["random_state"]),
        param_grid,
        cv=params["cv"],
        scoring=params["scoring"],
    )
    search.fit(X, y)

    best = search.best_estimator_
    model_summary = _coefficients_summary(best, X.columns)

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
        f"LogisticRegression(max_iter=1000, random_state={params['random_state']!r}), "
        f"{model_var}_param_grid, cv={params['cv']!r}, scoring={params['scoring']!r})",
        f"{model_var}_search.fit({model_var}_X, {model_var}_y)",
        f"{model_var} = {model_var}_search.best_estimator_",
        f"{metrics_var} = {{'best_params': {model_var}_search.best_params_, "
        f"'best_score': float({model_var}_search.best_score_)}}",
        f"print({metrics_var})",
        f"{summary_var}_coef = {model_var}.coef_",
        f"if {summary_var}_coef.shape[0] == 1:",
        f"    {summary_var} = {{'coefficients': "
        f"dict(zip({model_var}_X.columns, {summary_var}_coef[0].tolist())), "
        f"'intercept': float({model_var}.intercept_[0])}}",
        f"else:",
        f"    {summary_var}_classes = list({model_var}.classes_)[-{summary_var}_coef.shape[0]:]",
        f"    {summary_var} = {{'coefficients': {{str(c): "
        f"dict(zip({model_var}_X.columns, row.tolist())) "
        f"for c, row in zip({summary_var}_classes, {summary_var}_coef)}}, "
        f"'intercept': {{str(c): v for c, v in "
        f"zip({summary_var}_classes, {model_var}.intercept_.tolist())}}}}",
        f"print({summary_var})",
    ]
