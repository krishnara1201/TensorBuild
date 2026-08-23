# Hyperparameter Tuning Nodes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three new `GridSearchCV`-backed node plugins (Random Forest, Logistic Regression, SVM tuning) to the engine, landing in a new "Hyperparameter Tuning (sklearn)" palette section, with matching unit tests and an executor/codegen equivalence test.

**Architecture:** Each tuning node is a self-contained plugin folder (`manifest.json` + `node.py`) under `engine/vmb_engine/nodes/sklearn_models/`, following the exact structure every existing model node already uses — no core engine or frontend changes. Each node takes `train_table`, grid-searches a small hyperparameter space (specified as comma-separated text params), and outputs a `Model` (best fitted estimator) plus a `Metrics` output (`best_params`, `best_score`). The palette groups nodes purely by manifest `category`, so the new category creates the new section automatically.

**Tech Stack:** Python, scikit-learn (`GridSearchCV`), pytest, FastAPI TestClient (existing deps — no new ones).

**Spec:** `docs/superpowers/specs/2026-08-23-hyperparameter-tuning-design.md`

## Global Constraints

- New node category (palette section) literal string, used verbatim across all three manifests: `Hyperparameter Tuning (sklearn)`.
- Each `node.py` is fully self-contained — no imports of `vmb_engine` internals or of other nodes' code. Exported pipelines must stay standalone/dependency-free (`CLAUDE.md`). Each of the 3 new node.py files defines its own private `_parse_grid(text, cast)` helper (duplicated 3x on purpose — matches this codebase's existing one-file-per-node convention).
- `Metrics` outputs must be native Python types, not numpy scalars — `float(...)` around `best_score_`; `best_params_` is safe as-is since the grid values we build are already plain `int`/`float`/`None`.
- `codegen()` parses grid text **at codegen time** (not into runtime parsing code) and embeds the resulting list/dict as a Python literal via `!r`, exactly like every existing node embeds scalar params (e.g. `n_estimators={params['n_estimators']!r}`).
- Model output shape must match the untuned counterpart exactly: `{"estimator": ..., "feature_columns": list(X.columns)}`.
- `GridSearchCV` only — no `RandomizedSearchCV`, no `n_jobs`/scorer customization beyond the fixed `scoring` select list (`accuracy`, `f1_weighted`, `f1_macro`, `precision_weighted`, `recall_weighted`).

---

### Task 1: Random Forest Tuning node

**Files:**
- Create: `engine/vmb_engine/nodes/sklearn_models/random_forest_tuning/manifest.json`
- Create: `engine/vmb_engine/nodes/sklearn_models/random_forest_tuning/node.py`
- Test: `engine/tests/test_nodes_sklearn.py` (append)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: node id `sklearn_models.random_forest_tuning`, importable via `_load_node_module("sklearn_models/random_forest_tuning")` (existing helper already in `test_nodes_sklearn.py`). `execute(inputs, params) -> {"model": {"estimator", "feature_columns"}, "metrics": {"best_params", "best_score"}}`. `codegen(inputs, params, var_names) -> list[str]`, `var_names` keyed `"model"`/`"metrics"`.

- [ ] **Step 1: Write the failing tests**

Append to `engine/tests/test_nodes_sklearn.py`:

```python
def test_random_forest_tuning_execute_fits_best_model():
    node = _load_node_module("sklearn_models/random_forest_tuning")
    train_df = _toy_frame()

    outputs = node.execute(
        {"train_table": train_df},
        {
            "target_column": "label",
            "n_estimators_options": "10,20",
            "max_depth_options": "3,None",
            "cv": 2,
            "scoring": "accuracy",
            "random_state": 42,
        },
    )

    model = outputs["model"]
    metrics = outputs["metrics"]
    assert model["feature_columns"] == ["x1", "x2"]
    assert hasattr(model["estimator"], "predict")
    assert metrics["best_params"]["n_estimators"] in (10, 20)
    assert metrics["best_params"]["max_depth"] in (3, None)
    assert isinstance(metrics["best_score"], float)
    assert 0.0 <= metrics["best_score"] <= 1.0


def test_random_forest_tuning_execute_raises_on_malformed_grid_value():
    node = _load_node_module("sklearn_models/random_forest_tuning")
    train_df = _toy_frame()

    with pytest.raises(ValueError):
        node.execute(
            {"train_table": train_df},
            {
                "target_column": "label",
                "n_estimators_options": "abc,20",
                "max_depth_options": "3,None",
                "cv": 2,
                "scoring": "accuracy",
                "random_state": 42,
            },
        )


def test_random_forest_tuning_codegen_emits_grid_search_call():
    node = _load_node_module("sklearn_models/random_forest_tuning")
    lines = node.codegen(
        {"train_table": "n2_train"},
        {
            "target_column": "label",
            "n_estimators_options": "10,20",
            "max_depth_options": "3,None",
            "cv": 2,
            "scoring": "accuracy",
            "random_state": 42,
        },
        {"model": "n3_model", "metrics": "n3_metrics"},
    )
    assert lines == [
        "n3_model_X = n2_train.drop(columns=['label'])",
        "n3_model_y = n2_train['label']",
        "n3_model_param_grid = {'n_estimators': [10, 20], 'max_depth': [3, None]}",
        "n3_model_search = GridSearchCV(RandomForestClassifier(random_state=42), "
        "n3_model_param_grid, cv=2, scoring='accuracy')",
        "n3_model_search.fit(n3_model_X, n3_model_y)",
        "n3_model = n3_model_search.best_estimator_",
        "n3_metrics = {'best_params': n3_model_search.best_params_, "
        "'best_score': float(n3_model_search.best_score_)}",
        "print(n3_metrics)",
    ]


def test_random_forest_tuning_codegen_raises_on_malformed_grid_value():
    node = _load_node_module("sklearn_models/random_forest_tuning")

    with pytest.raises(ValueError):
        node.codegen(
            {"train_table": "n2_train"},
            {
                "target_column": "label",
                "n_estimators_options": "abc,20",
                "max_depth_options": "3,None",
                "cv": 2,
                "scoring": "accuracy",
                "random_state": 42,
            },
            {"model": "n3_model", "metrics": "n3_metrics"},
        )
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest engine/tests/test_nodes_sklearn.py -k random_forest_tuning -v`
Expected: FAIL — `_load_node_module` raises `FileNotFoundError` (no `node.py` at that path yet).

- [ ] **Step 3: Create the manifest**

Create `engine/vmb_engine/nodes/sklearn_models/random_forest_tuning/manifest.json`:

```json
{
    "id": "sklearn_models.random_forest_tuning",
    "category": "Hyperparameter Tuning (sklearn)",
    "label": "Random Forest (Grid Search)",
    "inputs": [{"name": "train_table", "type": "Table"}],
    "outputs": [
        {"name": "model", "type": "Model"},
        {"name": "metrics", "type": "Metrics"}
    ],
    "params": [
        {
            "name": "target_column",
            "type": "select",
            "label": "Target Column",
            "default": "",
            "options_source": {"input_port": "train_table"}
        },
        {"name": "n_estimators_options", "type": "text", "label": "N Estimators Options", "default": "50,100,200"},
        {"name": "max_depth_options", "type": "text", "label": "Max Depth Options", "default": "5,10,None"},
        {"name": "cv", "type": "number", "label": "CV Folds", "default": 5},
        {
            "name": "scoring",
            "type": "select",
            "label": "Scoring",
            "default": "accuracy",
            "options": ["accuracy", "f1_weighted", "f1_macro", "precision_weighted", "recall_weighted"]
        },
        {"name": "random_state", "type": "number", "label": "Random State", "default": 42}
    ]
}
```

- [ ] **Step 4: Create the node module**

Create `engine/vmb_engine/nodes/sklearn_models/random_forest_tuning/node.py`:

```python
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/pytest engine/tests/test_nodes_sklearn.py -k random_forest_tuning -v`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add engine/vmb_engine/nodes/sklearn_models/random_forest_tuning engine/tests/test_nodes_sklearn.py
git commit -m "engine: add Random Forest hyperparameter tuning node"
```

---

### Task 2: Logistic Regression Tuning node

**Files:**
- Create: `engine/vmb_engine/nodes/sklearn_models/logistic_regression_tuning/manifest.json`
- Create: `engine/vmb_engine/nodes/sklearn_models/logistic_regression_tuning/node.py`
- Test: `engine/tests/test_nodes_sklearn.py` (append)

**Interfaces:**
- Consumes: nothing from Task 1 (independent node, same pattern).
- Produces: node id `sklearn_models.logistic_regression_tuning`, same `execute`/`codegen` shape as Task 1, with a `C_options` grid param (`float`-cast) instead of `n_estimators_options`/`max_depth_options`.

- [ ] **Step 1: Write the failing tests**

Append to `engine/tests/test_nodes_sklearn.py`:

```python
def test_logistic_regression_tuning_execute_fits_best_model():
    node = _load_node_module("sklearn_models/logistic_regression_tuning")
    train_df = _toy_frame()

    outputs = node.execute(
        {"train_table": train_df},
        {
            "target_column": "label",
            "C_options": "0.1,1",
            "cv": 2,
            "scoring": "accuracy",
            "random_state": 42,
        },
    )

    model = outputs["model"]
    metrics = outputs["metrics"]
    assert model["feature_columns"] == ["x1", "x2"]
    assert hasattr(model["estimator"], "predict")
    assert metrics["best_params"]["C"] in (0.1, 1.0)
    assert isinstance(metrics["best_score"], float)
    assert 0.0 <= metrics["best_score"] <= 1.0


def test_logistic_regression_tuning_execute_raises_on_malformed_grid_value():
    node = _load_node_module("sklearn_models/logistic_regression_tuning")
    train_df = _toy_frame()

    with pytest.raises(ValueError):
        node.execute(
            {"train_table": train_df},
            {
                "target_column": "label",
                "C_options": "abc,1",
                "cv": 2,
                "scoring": "accuracy",
                "random_state": 42,
            },
        )


def test_logistic_regression_tuning_codegen_emits_grid_search_call():
    node = _load_node_module("sklearn_models/logistic_regression_tuning")
    lines = node.codegen(
        {"train_table": "n2_train"},
        {
            "target_column": "label",
            "C_options": "0.1,1",
            "cv": 2,
            "scoring": "accuracy",
            "random_state": 42,
        },
        {"model": "n3_model", "metrics": "n3_metrics"},
    )
    assert lines == [
        "n3_model_X = n2_train.drop(columns=['label'])",
        "n3_model_y = n2_train['label']",
        "n3_model_param_grid = {'C': [0.1, 1.0]}",
        "n3_model_search = GridSearchCV(LogisticRegression(max_iter=1000, random_state=42), "
        "n3_model_param_grid, cv=2, scoring='accuracy')",
        "n3_model_search.fit(n3_model_X, n3_model_y)",
        "n3_model = n3_model_search.best_estimator_",
        "n3_metrics = {'best_params': n3_model_search.best_params_, "
        "'best_score': float(n3_model_search.best_score_)}",
        "print(n3_metrics)",
    ]


def test_logistic_regression_tuning_codegen_raises_on_malformed_grid_value():
    node = _load_node_module("sklearn_models/logistic_regression_tuning")

    with pytest.raises(ValueError):
        node.codegen(
            {"train_table": "n2_train"},
            {
                "target_column": "label",
                "C_options": "abc,1",
                "cv": 2,
                "scoring": "accuracy",
                "random_state": 42,
            },
            {"model": "n3_model", "metrics": "n3_metrics"},
        )
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest engine/tests/test_nodes_sklearn.py -k logistic_regression_tuning -v`
Expected: FAIL — `_load_node_module` raises `FileNotFoundError`.

- [ ] **Step 3: Create the manifest**

Create `engine/vmb_engine/nodes/sklearn_models/logistic_regression_tuning/manifest.json`:

```json
{
    "id": "sklearn_models.logistic_regression_tuning",
    "category": "Hyperparameter Tuning (sklearn)",
    "label": "Logistic Regression (Grid Search)",
    "inputs": [{"name": "train_table", "type": "Table"}],
    "outputs": [
        {"name": "model", "type": "Model"},
        {"name": "metrics", "type": "Metrics"}
    ],
    "params": [
        {
            "name": "target_column",
            "type": "select",
            "label": "Target Column",
            "default": "",
            "options_source": {"input_port": "train_table"}
        },
        {"name": "C_options", "type": "text", "label": "C Options", "default": "0.01,0.1,1,10"},
        {"name": "cv", "type": "number", "label": "CV Folds", "default": 5},
        {
            "name": "scoring",
            "type": "select",
            "label": "Scoring",
            "default": "accuracy",
            "options": ["accuracy", "f1_weighted", "f1_macro", "precision_weighted", "recall_weighted"]
        },
        {"name": "random_state", "type": "number", "label": "Random State", "default": 42}
    ]
}
```

- [ ] **Step 4: Create the node module**

Create `engine/vmb_engine/nodes/sklearn_models/logistic_regression_tuning/node.py`:

```python
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

    return {
        "model": {"estimator": search.best_estimator_, "feature_columns": list(X.columns)},
        "metrics": {"best_params": search.best_params_, "best_score": float(search.best_score_)},
    }


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    in_var = inputs["train_table"]
    model_var = var_names["model"]
    metrics_var = var_names["metrics"]
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
    ]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/pytest engine/tests/test_nodes_sklearn.py -k logistic_regression_tuning -v`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add engine/vmb_engine/nodes/sklearn_models/logistic_regression_tuning engine/tests/test_nodes_sklearn.py
git commit -m "engine: add Logistic Regression hyperparameter tuning node"
```

---

### Task 3: SVM Tuning node

**Files:**
- Create: `engine/vmb_engine/nodes/sklearn_models/svm_tuning/manifest.json`
- Create: `engine/vmb_engine/nodes/sklearn_models/svm_tuning/node.py`
- Test: `engine/tests/test_nodes_sklearn.py` (append)

**Interfaces:**
- Consumes: nothing from Tasks 1-2 (independent node, same pattern).
- Produces: node id `sklearn_models.svm_tuning`, same `execute`/`codegen` shape as Task 2 (`C_options` grid), wrapping `SVC` instead of `LogisticRegression`.

- [ ] **Step 1: Write the failing tests**

Append to `engine/tests/test_nodes_sklearn.py`:

```python
def test_svm_tuning_execute_fits_best_model():
    node = _load_node_module("sklearn_models/svm_tuning")
    train_df = _toy_frame()

    outputs = node.execute(
        {"train_table": train_df},
        {
            "target_column": "label",
            "C_options": "0.1,1",
            "cv": 2,
            "scoring": "accuracy",
            "random_state": 42,
        },
    )

    model = outputs["model"]
    metrics = outputs["metrics"]
    assert model["feature_columns"] == ["x1", "x2"]
    assert hasattr(model["estimator"], "predict")
    assert metrics["best_params"]["C"] in (0.1, 1.0)
    assert isinstance(metrics["best_score"], float)
    assert 0.0 <= metrics["best_score"] <= 1.0


def test_svm_tuning_execute_raises_on_malformed_grid_value():
    node = _load_node_module("sklearn_models/svm_tuning")
    train_df = _toy_frame()

    with pytest.raises(ValueError):
        node.execute(
            {"train_table": train_df},
            {
                "target_column": "label",
                "C_options": "abc,1",
                "cv": 2,
                "scoring": "accuracy",
                "random_state": 42,
            },
        )


def test_svm_tuning_codegen_emits_grid_search_call():
    node = _load_node_module("sklearn_models/svm_tuning")
    lines = node.codegen(
        {"train_table": "n2_train"},
        {
            "target_column": "label",
            "C_options": "0.1,1",
            "cv": 2,
            "scoring": "accuracy",
            "random_state": 42,
        },
        {"model": "n3_model", "metrics": "n3_metrics"},
    )
    assert lines == [
        "n3_model_X = n2_train.drop(columns=['label'])",
        "n3_model_y = n2_train['label']",
        "n3_model_param_grid = {'C': [0.1, 1.0]}",
        "n3_model_search = GridSearchCV(SVC(random_state=42), "
        "n3_model_param_grid, cv=2, scoring='accuracy')",
        "n3_model_search.fit(n3_model_X, n3_model_y)",
        "n3_model = n3_model_search.best_estimator_",
        "n3_metrics = {'best_params': n3_model_search.best_params_, "
        "'best_score': float(n3_model_search.best_score_)}",
        "print(n3_metrics)",
    ]


def test_svm_tuning_codegen_raises_on_malformed_grid_value():
    node = _load_node_module("sklearn_models/svm_tuning")

    with pytest.raises(ValueError):
        node.codegen(
            {"train_table": "n2_train"},
            {
                "target_column": "label",
                "C_options": "abc,1",
                "cv": 2,
                "scoring": "accuracy",
                "random_state": 42,
            },
            {"model": "n3_model", "metrics": "n3_metrics"},
        )
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest engine/tests/test_nodes_sklearn.py -k svm_tuning -v`
Expected: FAIL — `_load_node_module` raises `FileNotFoundError`.

- [ ] **Step 3: Create the manifest**

Create `engine/vmb_engine/nodes/sklearn_models/svm_tuning/manifest.json`:

```json
{
    "id": "sklearn_models.svm_tuning",
    "category": "Hyperparameter Tuning (sklearn)",
    "label": "SVM (Grid Search)",
    "inputs": [{"name": "train_table", "type": "Table"}],
    "outputs": [
        {"name": "model", "type": "Model"},
        {"name": "metrics", "type": "Metrics"}
    ],
    "params": [
        {
            "name": "target_column",
            "type": "select",
            "label": "Target Column",
            "default": "",
            "options_source": {"input_port": "train_table"}
        },
        {"name": "C_options", "type": "text", "label": "C Options", "default": "0.1,1,10,100"},
        {"name": "cv", "type": "number", "label": "CV Folds", "default": 5},
        {
            "name": "scoring",
            "type": "select",
            "label": "Scoring",
            "default": "accuracy",
            "options": ["accuracy", "f1_weighted", "f1_macro", "precision_weighted", "recall_weighted"]
        },
        {"name": "random_state", "type": "number", "label": "Random State", "default": 42}
    ]
}
```

- [ ] **Step 4: Create the node module**

Create `engine/vmb_engine/nodes/sklearn_models/svm_tuning/node.py`:

```python
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

    return {
        "model": {"estimator": search.best_estimator_, "feature_columns": list(X.columns)},
        "metrics": {"best_params": search.best_params_, "best_score": float(search.best_score_)},
    }


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    in_var = inputs["train_table"]
    model_var = var_names["model"]
    metrics_var = var_names["metrics"]
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
    ]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/pytest engine/tests/test_nodes_sklearn.py -k svm_tuning -v`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add engine/vmb_engine/nodes/sklearn_models/svm_tuning engine/tests/test_nodes_sklearn.py
git commit -m "engine: add SVM hyperparameter tuning node"
```

---

### Task 4: Registry/API integration check

**Files:**
- Test: `engine/tests/test_api.py` (append)

**Interfaces:**
- Consumes: the three node ids and category string from Tasks 1-3 (`sklearn_models.random_forest_tuning`, `sklearn_models.logistic_regression_tuning`, `sklearn_models.svm_tuning`, category `Hyperparameter Tuning (sklearn)`).
- Produces: nothing new — this task only verifies the registry/API surface the prior three tasks already produced (confirms no duplicate-id conflicts and correct category grouping via `GET /nodes`).

- [ ] **Step 1: Write the test**

Append to `engine/tests/test_api.py`, directly after `test_get_nodes_lists_registered_manifests`:

```python
def test_get_nodes_includes_hyperparameter_tuning_category(client):
    response = client.get("/nodes")
    assert response.status_code == 200
    manifests = response.json()

    ids = {m["id"] for m in manifests}
    assert {
        "sklearn_models.random_forest_tuning",
        "sklearn_models.logistic_regression_tuning",
        "sklearn_models.svm_tuning",
    }.issubset(ids)

    tuning_manifests = [m for m in manifests if m["id"].endswith("_tuning")]
    assert len(tuning_manifests) == 3
    assert all(m["category"] == "Hyperparameter Tuning (sklearn)" for m in tuning_manifests)
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `.venv/bin/pytest engine/tests/test_api.py -k hyperparameter_tuning_category -v`
Expected: PASS. (This confirms `NodeRegistry.scan()` — which raises `RegistryError` on any duplicate manifest id — succeeded with all three new nodes present alongside the existing `sklearn_models.*` set, and that the new category value is spelled identically across all three manifests.)

- [ ] **Step 3: Commit**

```bash
git add engine/tests/test_api.py
git commit -m "engine: verify hyperparameter tuning nodes register under new palette category"
```

---

### Task 5: Executor/codegen equivalence test

**Files:**
- Test: `engine/tests/test_equivalence.py` (append)

**Interfaces:**
- Consumes: `sklearn_models.random_forest_tuning` from Task 1 (`execute`/`codegen` producing `metrics.best_score`).
- Produces: nothing new — final verification that live execution and the exported script agree, matching the bar every other node in the suite holds.

- [ ] **Step 1: Write the test**

Append to `engine/tests/test_equivalence.py`:

```python
def test_executor_and_exported_script_agree_with_random_forest_tuning(tmp_path, registry):
    csv_path = tmp_path / "d.csv"
    csv_path.write_text("a,b,label\n" + "\n".join(f"{i},{i * 2},{i % 2}" for i in range(60)))

    ir = PipelineIR.model_validate(
        {
            "nodes": [
                {"id": "n1", "type": "data.csv_loader", "params": {"path": str(csv_path)}},
                {
                    "id": "n2",
                    "type": "data.train_test_split",
                    "params": {"test_size": 0.25, "random_state": 42},
                },
                {
                    "id": "n3",
                    "type": "sklearn_models.random_forest_tuning",
                    "params": {
                        "target_column": "label",
                        "n_estimators_options": "10,20",
                        "max_depth_options": "3,None",
                        "cv": 3,
                        "scoring": "accuracy",
                        "random_state": 42,
                    },
                },
            ],
            "edges": [
                {"from": "n1.table", "to": "n2.table"},
                {"from": "n2.train", "to": "n3.train_table"},
            ],
        }
    )

    context = execute_pipeline(ir, registry)
    executor_best_score = context["n3.metrics"]["best_score"]

    code = generate_code(ir, registry)
    script_path = tmp_path / "exported.py"
    script_path.write_text(code)

    result = subprocess.run(
        [sys.executable, str(script_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr

    match = re.search(r"'best_score':\s*([0-9.eE+-]+)", result.stdout)
    assert match is not None, f"no best_score found in script output:\n{result.stdout}"
    script_best_score = float(match.group(1))

    assert executor_best_score == pytest.approx(script_best_score, abs=1e-9)
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `.venv/bin/pytest engine/tests/test_equivalence.py -k random_forest_tuning -v`
Expected: PASS

- [ ] **Step 3: Run the full engine test suite**

Run: `.venv/bin/pytest engine/tests -v`
Expected: PASS (all tests, including the new ones from Tasks 1-5)

- [ ] **Step 4: Commit**

```bash
git add engine/tests/test_equivalence.py
git commit -m "engine: add executor/codegen equivalence test for hyperparameter tuning"
```
