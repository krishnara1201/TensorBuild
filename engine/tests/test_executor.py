import json
import textwrap
from pathlib import Path

import pytest

from vmb_engine.executor import (
    ExecutorError,
    PreviewError,
    ancestors_of,
    execute_pipeline,
    execute_subgraph_preview,
    topological_sort,
)
from vmb_engine.ir import PipelineIR
from vmb_engine.registry import NodeRegistry

NODES_DIR = Path(__file__).resolve().parents[1] / "vmb_engine" / "nodes"


@pytest.fixture
def registry():
    reg = NodeRegistry()
    reg.scan([NODES_DIR])
    return reg


def _pipeline(csv_path: str) -> PipelineIR:
    return PipelineIR.model_validate(
        {
            "nodes": [
                {"id": "n1", "type": "data.csv_loader", "params": {"path": csv_path}},
                {
                    "id": "n2",
                    "type": "data.train_test_split",
                    "params": {"test_size": 0.25, "random_state": 42},
                },
                {
                    "id": "n3",
                    "type": "sklearn_models.random_forest",
                    "params": {"target_column": "label", "n_estimators": 10, "random_state": 42},
                },
                {
                    "id": "n4",
                    "type": "evaluation.evaluate_classifier",
                    "params": {"target_column": "label"},
                },
            ],
            "edges": [
                {"from": "n1.table", "to": "n2.table"},
                {"from": "n2.train", "to": "n3.train_table"},
                {"from": "n3.model", "to": "n4.model"},
                {"from": "n2.test", "to": "n4.test_table"},
            ],
        }
    )


def test_topological_sort_orders_dependencies_first(tmp_path):
    csv_path = tmp_path / "d.csv"
    csv_path.write_text("a,label\n" + "\n".join(f"{i},{i % 2}" for i in range(20)))
    ir = _pipeline(str(csv_path))

    order = topological_sort(ir)

    assert order.index("n1") < order.index("n2")
    assert order.index("n2") < order.index("n3")
    assert order.index("n3") < order.index("n4")


def test_topological_sort_raises_on_cycle():
    ir = PipelineIR.model_validate(
        {
            "nodes": [
                {"id": "a", "type": "x", "params": {}},
                {"id": "b", "type": "x", "params": {}},
            ],
            "edges": [
                {"from": "a.out", "to": "b.in"},
                {"from": "b.out", "to": "a.in"},
            ],
        }
    )
    with pytest.raises(ExecutorError, match="cycle"):
        topological_sort(ir)


def test_execute_pipeline_runs_end_to_end(tmp_path, registry):
    csv_path = tmp_path / "d.csv"
    csv_path.write_text("a,label\n" + "\n".join(f"{i},{i % 2}" for i in range(40)))
    ir = _pipeline(str(csv_path))

    context = execute_pipeline(ir, registry)

    assert "n1.table" in context
    assert "n4.metrics" in context
    accuracy = context["n4.metrics"]["accuracy"]
    assert 0.0 <= accuracy <= 1.0


def test_execute_pipeline_wraps_node_exception_with_node_id(registry):
    ir = PipelineIR.model_validate(
        {
            "nodes": [
                {
                    "id": "n1",
                    "type": "data.csv_loader",
                    "params": {"path": "/does/not/exist.csv"},
                },
            ],
            "edges": [],
        }
    )

    with pytest.raises(ExecutorError, match="n1"):
        execute_pipeline(ir, registry)


def test_execute_pipeline_raises_on_missing_required_input(tmp_path, registry):
    csv_path = tmp_path / "d.csv"
    csv_path.write_text("a,label\n" + "\n".join(f"{i},{i % 2}" for i in range(20)))
    ir = PipelineIR.model_validate(
        {
            "nodes": [
                {"id": "n1", "type": "data.csv_loader", "params": {"path": str(csv_path)}},
                {
                    "id": "n3",
                    "type": "sklearn_models.random_forest",
                    "params": {"target_column": "label", "n_estimators": 10, "random_state": 42},
                },
            ],
            "edges": [],
        }
    )

    with pytest.raises(ExecutorError, match="n3") as exc_info:
        execute_pipeline(ir, registry)
    assert "train_table" in str(exc_info.value)


def _write_long_running_plugin(tmp_path):
    plugin_dir = tmp_path / "test_long_running"
    plugin_dir.mkdir()
    manifest = {
        "id": "test.long_running",
        "category": "Test",
        "label": "Test Long Running",
        "inputs": [],
        "outputs": [{"name": "out", "type": "Table"}],
        "params": [],
        "long_running": True,
    }
    (plugin_dir / "manifest.json").write_text(json.dumps(manifest))
    (plugin_dir / "node.py").write_text(
        textwrap.dedent(
            """
            IMPORTS = []

            def execute(inputs, params, progress_callback=None):
                if progress_callback is not None:
                    progress_callback({"event": "progress", "epoch": 0})
                    progress_callback({"event": "progress", "epoch": 1})
                return {"out": 1}

            def codegen(inputs, params, var_names):
                return [f"{var_names['out']} = 1"]
            """
        )
    )
    return plugin_dir


def test_execute_pipeline_passes_progress_callback_to_long_running_nodes(tmp_path):
    from vmb_engine.registry import NodeRegistry

    plugin_dir = _write_long_running_plugin(tmp_path)
    reg = NodeRegistry()
    reg.scan([plugin_dir])
    ir = PipelineIR.model_validate(
        {"nodes": [{"id": "n1", "type": "test.long_running", "params": {}}], "edges": []}
    )

    events = []
    context = execute_pipeline(ir, reg, progress_callback=events.append)

    assert context["n1.out"] == 1
    assert events == [
        {"event": "progress", "epoch": 0, "node_id": "n1"},
        {"event": "progress", "epoch": 1, "node_id": "n1"},
    ]


def test_execute_pipeline_without_progress_callback_still_works(tmp_path):
    from vmb_engine.registry import NodeRegistry

    plugin_dir = _write_long_running_plugin(tmp_path)
    reg = NodeRegistry()
    reg.scan([plugin_dir])
    ir = PipelineIR.model_validate(
        {"nodes": [{"id": "n1", "type": "test.long_running", "params": {}}], "edges": []}
    )

    context = execute_pipeline(ir, reg)

    assert context["n1.out"] == 1


def test_execute_pipeline_emits_node_error_event_before_raising(tmp_path):
    from vmb_engine.registry import NodeRegistry

    plugin_dir = tmp_path / "test_broken"
    plugin_dir.mkdir()
    manifest = {
        "id": "test.broken",
        "category": "Test",
        "label": "Test Broken",
        "inputs": [],
        "outputs": [{"name": "out", "type": "Table"}],
        "params": [],
    }
    (plugin_dir / "manifest.json").write_text(json.dumps(manifest))
    (plugin_dir / "node.py").write_text(
        textwrap.dedent(
            """
            IMPORTS = []

            def execute(inputs, params):
                raise RuntimeError("boom")

            def codegen(inputs, params, var_names):
                return []
            """
        )
    )
    reg = NodeRegistry()
    reg.scan([plugin_dir])
    ir = PipelineIR.model_validate(
        {"nodes": [{"id": "n1", "type": "test.broken", "params": {}}], "edges": []}
    )

    events = []
    with pytest.raises(ExecutorError):
        execute_pipeline(ir, reg, progress_callback=events.append)

    assert events == [{"event": "node_error", "error": "boom", "node_id": "n1"}]


def test_pipeline_has_long_running_node(tmp_path):
    from vmb_engine.executor import pipeline_has_long_running_node
    from vmb_engine.registry import NodeRegistry

    plugin_dir = _write_long_running_plugin(tmp_path)
    reg = NodeRegistry()
    reg.scan([plugin_dir])
    ir = PipelineIR.model_validate(
        {"nodes": [{"id": "n1", "type": "test.long_running", "params": {}}], "edges": []}
    )

    assert pipeline_has_long_running_node(ir, reg) is True


def test_collect_metrics_outputs_filters_by_port_type(tmp_path, registry):
    csv_path = tmp_path / "d.csv"
    csv_path.write_text("a,label\n" + "\n".join(f"{i},{i % 2}" for i in range(40)))
    ir = _pipeline(str(csv_path))

    from vmb_engine.executor import collect_metrics_outputs

    context = execute_pipeline(ir, registry)
    metrics = collect_metrics_outputs(ir, registry, context)

    assert set(metrics) == {"n4.metrics"}
    assert 0.0 <= metrics["n4.metrics"]["accuracy"] <= 1.0


def test_ancestors_of_returns_target_and_all_upstream_nodes():
    ir = PipelineIR.model_validate(
        {
            "nodes": [
                {"id": "n1", "type": "x", "params": {}},
                {"id": "n2", "type": "x", "params": {}},
                {"id": "n3", "type": "x", "params": {}},
                {"id": "n4", "type": "x", "params": {}},
            ],
            "edges": [
                {"from": "n1.out", "to": "n2.in"},
                {"from": "n1.out", "to": "n3.in"},
                {"from": "n2.out", "to": "n4.in"},
                {"from": "n3.out", "to": "n4.in"},
            ],
        }
    )
    assert ancestors_of(ir, "n4") == {"n1", "n2", "n3", "n4"}


def test_ancestors_of_excludes_disconnected_branch():
    ir = PipelineIR.model_validate(
        {
            "nodes": [
                {"id": "n1", "type": "x", "params": {}},
                {"id": "n2", "type": "x", "params": {}},
                {"id": "n3", "type": "x", "params": {}},
            ],
            "edges": [
                {"from": "n1.out", "to": "n2.in"},
            ],
        }
    )
    assert ancestors_of(ir, "n2") == {"n1", "n2"}
    assert ancestors_of(ir, "n3") == {"n3"}


def _table_preview_pipeline(csv_path: str) -> PipelineIR:
    return PipelineIR.model_validate(
        {
            "nodes": [
                {"id": "n1", "type": "data.csv_loader", "params": {"path": csv_path}},
                {
                    "id": "n2",
                    "type": "data.train_test_split",
                    "params": {"test_size": 0.25, "random_state": 42},
                },
            ],
            "edges": [{"from": "n1.table", "to": "n2.table"}],
        }
    )


def test_execute_subgraph_preview_returns_columns_rows_and_total(tmp_path, registry):
    csv_path = tmp_path / "d.csv"
    csv_path.write_text("a,label\n" + "\n".join(f"{i},{i % 2}" for i in range(40)))
    ir = _table_preview_pipeline(str(csv_path))

    result = execute_subgraph_preview(ir, registry, "n2", "train")

    assert {c["name"] for c in result["columns"]} == {"a", "label"}
    assert result["total_rows"] == 30
    assert len(result["rows"]) == 30


def test_execute_subgraph_preview_caps_rows_at_50(tmp_path, registry):
    csv_path = tmp_path / "d.csv"
    csv_path.write_text("a,label\n" + "\n".join(f"{i},{i % 2}" for i in range(200)))
    ir = _table_preview_pipeline(str(csv_path))

    result = execute_subgraph_preview(ir, registry, "n1", "table")

    assert result["total_rows"] == 200
    assert len(result["rows"]) == 50


def test_execute_subgraph_preview_rejects_wrong_port_name(tmp_path, registry):
    csv_path = tmp_path / "d.csv"
    csv_path.write_text("a,label\n1,0\n")
    ir = _table_preview_pipeline(str(csv_path))

    with pytest.raises(PreviewError, match="no Table output named"):
        execute_subgraph_preview(ir, registry, "n1", "not_a_port")


def test_execute_subgraph_preview_rejects_unknown_target_node(registry):
    ir = _table_preview_pipeline("unused.csv")

    with pytest.raises(PreviewError, match="unknown node"):
        execute_subgraph_preview(ir, registry, "does_not_exist", "table")


def test_execute_subgraph_preview_rejects_long_running_ancestor(registry):
    ir = PipelineIR.model_validate(
        {
            "nodes": [
                {"id": "n1", "type": "pytorch_models.input", "params": {"random_state": 42}},
                {"id": "n2", "type": "pytorch_models.train", "params": {"target_column": "label"}},
            ],
            "edges": [{"from": "n1.architecture", "to": "n2.architecture"}],
        }
    )

    with pytest.raises(PreviewError, match="training node"):
        execute_subgraph_preview(ir, registry, "n2", "model")
