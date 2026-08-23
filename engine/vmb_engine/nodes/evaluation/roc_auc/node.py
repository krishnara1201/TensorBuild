IMPORTS = ["from sklearn.metrics import roc_auc_score, roc_curve"]


def execute(inputs: dict, params: dict) -> dict:
    from sklearn.metrics import roc_auc_score, roc_curve

    target = params["target_column"]
    df = inputs["test_table"]
    model = inputs["model"]
    estimator = model["estimator"]

    X = df[model["feature_columns"]]
    y = df[target]
    classes = list(estimator.classes_)

    if len(classes) == 2:
        if hasattr(estimator, "predict_proba"):
            score = estimator.predict_proba(X)[:, 1]
        elif hasattr(estimator, "decision_function"):
            score = estimator.decision_function(X)
        else:
            raise ValueError(
                "Model does not support predict_proba or decision_function, required for ROC AUC"
            )
        fpr, tpr, _ = roc_curve(y, score, pos_label=classes[1])
        return {
            "metrics": {
                "roc_auc": float(roc_auc_score(y, score)),
                "fpr": fpr.tolist(),
                "tpr": tpr.tolist(),
            }
        }
    else:
        if not hasattr(estimator, "predict_proba"):
            raise ValueError("Model must support predict_proba for multiclass ROC AUC")
        score = estimator.predict_proba(X)
        return {
            "metrics": {
                "macro_roc_auc": float(
                    roc_auc_score(y, score, multi_class="ovr", average="macro")
                )
            }
        }


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    model_var = inputs["model"]
    test_var = inputs["test_table"]
    out_var = var_names["metrics"]
    target = params["target_column"]
    return [
        f"{out_var}_X = {test_var}[{model_var}_X.columns]",
        f"{out_var}_y = {test_var}[{target!r}]",
        f"{out_var}_classes = list({model_var}.classes_)",
        f"if len({out_var}_classes) == 2:",
        f"    if hasattr({model_var}, 'predict_proba'):",
        f"        {out_var}_score = {model_var}.predict_proba({out_var}_X)[:, 1]",
        f"    elif hasattr({model_var}, 'decision_function'):",
        f"        {out_var}_score = {model_var}.decision_function({out_var}_X)",
        "    else:",
        "        raise ValueError("
        "'Model does not support predict_proba or decision_function, required for ROC AUC')",
        f"    {out_var}_fpr, {out_var}_tpr, _ = roc_curve("
        f"{out_var}_y, {out_var}_score, pos_label={out_var}_classes[1])",
        f"    {out_var} = {{'roc_auc': float(roc_auc_score({out_var}_y, {out_var}_score)), "
        f"'fpr': {out_var}_fpr.tolist(), 'tpr': {out_var}_tpr.tolist()}}",
        "else:",
        f"    if not hasattr({model_var}, 'predict_proba'):",
        "        raise ValueError('Model must support predict_proba for multiclass ROC AUC')",
        f"    {out_var}_score = {model_var}.predict_proba({out_var}_X)",
        f"    {out_var} = {{'macro_roc_auc': float(roc_auc_score("
        f"{out_var}_y, {out_var}_score, multi_class='ovr', average='macro'))}}",
        f"print({out_var})",
    ]
