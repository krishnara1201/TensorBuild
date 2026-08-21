from pathlib import Path

import pytest

from vmb_engine.executor import ExecutorError, execute_pipeline, topological_sort
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
