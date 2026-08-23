# Hyperparameter Tuning Nodes — Design

## Overview

Add a `GridSearchCV`-backed tuning counterpart for each existing
Classification (sklearn) model node — Random Forest, Logistic Regression,
SVM. Each new node takes the same `train_table` input the untuned model
node takes, searches a small hyperparameter grid the user specifies via
comma-separated text fields, and outputs the best fitted `Model` plus a
`Metrics` output reporting the winning params and CV score.

This is purely a new set of node plugins. `NodePalette.tsx` groups nodes
by `manifest.category` alone, so giving these nodes a new category —
`Hyperparameter Tuning (sklearn)` — creates a new palette section
automatically. No core executor/codegen changes, no frontend changes: the
existing manifest-driven param rendering (`text`/`number`/`select`) already
covers every param type this feature needs.

## Goals

- Let a user grid-search Random Forest, Logistic Regression, and SVM
  directly on the canvas, without hand-writing `GridSearchCV` code.
- Keep the existing per-model-node convention (one node per estimator,
  `target_column` dynamic select, same `Model` output shape
  `{"estimator": ..., "feature_columns": [...]}`) so tuning nodes drop
  into pipelines exactly where their untuned counterparts do.
- Surface what the search picked — `best_params`/`best_score` — as a
  `Metrics` output, viewable the same way other metrics nodes are.
- Keep executor/codegen equivalence, same bar as every existing node.

## Non-Goals

- A regression tuning node. The only current Regression-category node,
  `sklearn_models/linear_regression`, has no numeric hyperparameters (just
  `fit_intercept`/`positive` booleans) — not a meaningful grid search.
  Revisit when a regression model with real hyperparameters (e.g. Ridge,
  a Random Forest Regressor) exists.
- A KMeans/clustering tuning node — clustering has no labeled score to
  optimize against in the same sense; out of scope here.
- `RandomizedSearchCV` or any other search strategy — `GridSearchCV` only.
- A generic/dynamic param-grid UI (e.g. a `range`/`json` param type, or one
  node that wraps an arbitrary estimator). Each tuned hyperparameter is
  its own static `text` param on a node scoped to one estimator, matching
  every other node in the app — no core param-schema changes.
- Nested/repeated CV, parallelism controls (`n_jobs`), or custom scorers
  beyond a fixed `scoring` select list.

## Node set

All three live under a new category, `Hyperparameter Tuning (sklearn)`,
alongside the existing `sklearn_models/` node folder.

Shared shape across all three:
- Input: `train_table` (`Table`)
- Outputs: `model` (`Model`, same shape as the untuned node —
  `{"estimator": search.best_estimator_, "feature_columns": [...]}`),
  `metrics` (`Metrics` — `{"best_params": {...}, "best_score": float}`,
  native-typed)
- Common params: `target_column` (select, `options_source` on
  `train_table` — identical to every existing model node), `cv` (number,
  default `5`), `scoring` (select, default `"accuracy"`, options
  `accuracy`/`f1_weighted`/`f1_macro`/`precision_weighted`/
  `recall_weighted`), `random_state` (number, default `42` — passed to the
  base estimator, not searched)
- Grid parsing: since node modules are self-contained (no `node.py`
  imports another node's code or `vmb_engine` internals — exported
  scripts must stay dependency-free per `CLAUDE.md`), each node defines
  its own private `_parse_grid(text, cast)` function: splits on commas,
  strips whitespace, maps the literal `"None"` to `None`, else
  `cast(value)` (`int` for `n_estimators`/`max_depth`, `float` for `C`).
  A non-numeric, non-`"None"` value raises `ValueError`.
  - In `execute()`, parsing happens at run time — a bad value surfaces as
    an `ExecutorError` (the executor already wraps per-node exceptions).
  - In `codegen()`, parsing happens at **codegen time** (params are known
    when the script is generated), and the result is emitted as a Python
    list/dict *literal* — e.g. `{out_var}_param_grid = {{'n_estimators':
    [50, 100, 200], 'max_depth': [5, 10, None]}}` — the same
    literal-embedding convention every existing node's `codegen()` already
    uses for scalar params (`n_estimators={params['n_estimators']!r}`).
    A bad value raises `ValueError` while generating code, not in the
    exported script.

### `sklearn_models/random_forest_tuning`
- Extra params: `n_estimators_options` (text, default `"50,100,200"`),
  `max_depth_options` (text, default `"5,10,None"`)
- Behavior: `param_grid = {"n_estimators": parse(...), "max_depth":
  parse(...)}`; `GridSearchCV(RandomForestClassifier(random_state=...),
  param_grid, cv=cv, scoring=scoring).fit(X, y)`.

### `sklearn_models/logistic_regression_tuning`
- Extra params: `C_options` (text, default `"0.01,0.1,1,10"`)
- Behavior: `param_grid = {"C": parse_float(...)}` (reuses the shared
  parser generalized to `float` since `C` is continuous —
  `_parse_grid_values` takes a `cast` argument, `int` for
  `n_estimators`/`max_depth`, `float` for `C`);
  `GridSearchCV(LogisticRegression(max_iter=1000,
  random_state=...), param_grid, cv=cv, scoring=scoring).fit(X, y)`.
  `max_iter` fixed at `1000` (matches the untuned node's default),
  not exposed as a search dimension.

### `sklearn_models/svm_tuning`
- Extra params: `C_options` (text, default `"0.1,1,10,100"`)
- Behavior: `param_grid = {"C": parse_float(...)}`;
  `GridSearchCV(SVC(random_state=...), param_grid, cv=cv,
  scoring=scoring).fit(X, y)`.

## Example pipeline

```
csv_loader → train_test_split → random_forest_tuning → evaluate_classifier
                                        ↑ (train)              ↑ (test, from train_test_split)
```

Drop-in replacement for `sklearn_models/random_forest` in any existing
pipeline — same input/output port shapes.

## Testing

- Per-node unit tests for all three new nodes (`execute()` and
  `codegen()`), following the existing per-node test pattern in
  `engine/tests/test_nodes_sklearn.py` — grid parsing in both `execute()`
  (run-time `ValueError`) and `codegen()` (codegen-time `ValueError`,
  literal grid emitted correctly including the `"None"` case), that
  `model.estimator` is fitted, and that `metrics.best_params`/`best_score`
  are JSON-safe native types (no numpy scalars).
- One executor/codegen equivalence test (styled after
  `test_equivalence.py`) covering `random_forest_tuning`, run both live
  and via exported-and-executed script, asserting matching `best_score`.
- Registry/manifest test confirming the three new node ids load without
  conflicting with the existing `sklearn_models.*` set and that the new
  category appears in `GET /nodes`.

## Open Questions (resolved during brainstorming, recorded for traceability)

- **New tuning nodes vs. an inspector-UI sweep feature on existing model
  nodes vs. both** → new nodes chosen; fits the existing node-plugin
  architecture with zero core/frontend changes, versus a dynamic
  per-hyperparameter-range UI which would need new param-schema
  machinery.
- **Grid input: per-hyperparameter comma-separated text fields vs. one
  JSON param-grid field** → per-field text chosen; matches the app's
  existing no-JSON, one-field-per-param style used by every other node.
- **Model scope: classification only vs. classification + regression** →
  started as classification + regression, narrowed to classification-only
  after finding `linear_regression` has no meaningful hyperparameters
  today (see Non-Goals).
- **Search strategy and outputs** → `GridSearchCV` (not
  `RandomizedSearchCV`), outputting both `Model` (best estimator) and
  `Metrics` (`best_params`, `best_score`) rather than `Model` alone, so
  the winning configuration is visible in-app without reading exported
  code.
