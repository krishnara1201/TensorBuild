from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from vmb_engine.api import create_app

NODES_DIR = Path(__file__).resolve().parents[1] / "vmb_engine" / "nodes"


@pytest.fixture
def client():
    app = create_app(node_paths=[NODES_DIR])
    return TestClient(app)


def _pipeline(csv_path: str) -> dict:
    return {
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


def test_get_nodes_lists_registered_manifests(client):
    response = client.get("/nodes")
    assert response.status_code == 200
    ids = {m["id"] for m in response.json()}
    assert "data.csv_loader" in ids
    assert "sklearn_models.random_forest" in ids


def test_run_pipeline_returns_metrics(client, tmp_path):
    csv_path = tmp_path / "d.csv"
    csv_path.write_text("a,label\n" + "\n".join(f"{i},{i % 2}" for i in range(40)))

    response = client.post("/pipeline/run", json=_pipeline(str(csv_path)))

    assert response.status_code == 200
    body = response.json()
    assert "n4.metrics" in body["metrics"]
    assert 0.0 <= body["metrics"]["n4.metrics"]["accuracy"] <= 1.0


def test_run_pipeline_with_bad_edge_returns_422(client, tmp_path):
    csv_path = tmp_path / "d.csv"
    csv_path.write_text("a,label\n1,0\n")
    pipeline = _pipeline(str(csv_path))
    pipeline["edges"][0]["to"] = "does_not_exist.table"

    response = client.post("/pipeline/run", json=pipeline)

    assert response.status_code == 422


def test_codegen_endpoint_returns_script(client, tmp_path):
    csv_path = tmp_path / "d.csv"
    csv_path.write_text("a,label\n1,0\n")

    response = client.post("/pipeline/codegen", json=_pipeline(str(csv_path)))

    assert response.status_code == 200
    code = response.json()["code"]
    assert "RandomForestClassifier" in code
