from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from vmb_engine.api import create_app

NODES_DIR = Path(__file__).resolve().parents[1] / "vmb_engine" / "nodes"


@pytest.fixture
def client():
    app = create_app(node_paths=[NODES_DIR])
    # Used as a context manager (not a bare `TestClient(app)`) so a single
    # anyio blocking portal/event loop persists for every call made with
    # this client. Without that, each client.post()/client.websocket_connect()
    # call gets its own short-lived portal, and RunManager's background
    # `asyncio.create_task(run())` (started during a POST) gets silently
    # orphaned the moment that POST's portal tears down — the WS endpoint
    # then hangs forever waiting on a "complete" event that never arrives.
    with TestClient(app) as test_client:
        yield test_client


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


def _mlp_pipeline(csv_path: str) -> dict:
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
                "type": "pytorch_models.input",
                "params": {"target_column": "label", "random_state": 42},
            },
            {"id": "n4", "type": "pytorch_models.linear", "params": {"out_features": 4}},
            {"id": "n5", "type": "pytorch_models.relu", "params": {}},
            {"id": "n6", "type": "pytorch_models.linear", "params": {"out_features": 2}},
            {
                "id": "n7",
                "type": "pytorch_models.train",
                "params": {
                    "target_column": "label",
                    "task_type": "classification",
                    "loss_fn": "CrossEntropyLoss",
                    "optimizer": "Adam",
                    "learning_rate": 0.01,
                    "epochs": 2,
                    "batch_size": 8,
                },
            },
        ],
        "edges": [
            {"from": "n1.table", "to": "n2.table"},
            {"from": "n2.train", "to": "n3.train_table"},
            {"from": "n3.architecture", "to": "n4.architecture"},
            {"from": "n4.architecture", "to": "n5.architecture"},
            {"from": "n5.architecture", "to": "n6.architecture"},
            {"from": "n2.train", "to": "n7.train_table"},
            {"from": "n2.test", "to": "n7.test_table"},
            {"from": "n6.architecture", "to": "n7.architecture"},
        ],
    }


def test_run_pipeline_with_long_running_node_returns_run_id(client, tmp_path):
    csv_path = tmp_path / "d.csv"
    csv_path.write_text("a,b,label\n" + "\n".join(f"{i},{i * 2},{i % 2}" for i in range(40)))

    response = client.post("/pipeline/run", json=_mlp_pipeline(str(csv_path)))

    assert response.status_code == 202
    assert "run_id" in response.json()


def test_ws_run_events_streams_progress_then_complete(client, tmp_path):
    csv_path = tmp_path / "d.csv"
    csv_path.write_text("a,b,label\n" + "\n".join(f"{i},{i * 2},{i % 2}" for i in range(40)))

    run_id = client.post("/pipeline/run", json=_mlp_pipeline(str(csv_path))).json()["run_id"]

    with client.websocket_connect(f"/ws/runs/{run_id}") as ws:
        events = []
        while True:
            event = ws.receive_json()
            events.append(event)
            if event["event"] in ("complete", "node_error"):
                break

    progress_events = [e for e in events if e["event"] == "progress"]
    assert [e["epoch"] for e in progress_events] == [0, 1]
    assert all(e["node_id"] == "n7" for e in progress_events)
    assert events[-1]["event"] == "complete"
    assert "n7.metrics" in events[-1]["metrics"]


def test_ws_run_events_streams_node_error(client, tmp_path):
    pipeline = _mlp_pipeline(str(tmp_path / "does_not_exist.csv"))

    run_id = client.post("/pipeline/run", json=pipeline).json()["run_id"]

    with client.websocket_connect(f"/ws/runs/{run_id}") as ws:
        event = ws.receive_json()

    assert event["event"] == "node_error"
    assert event["node_id"] == "n1"


def test_ws_run_events_unknown_run_id_closes_with_policy_violation(client):
    with client.websocket_connect("/ws/runs/does-not-exist") as ws:
        with pytest.raises(WebSocketDisconnect) as exc_info:
            ws.receive_json()

    assert exc_info.value.code == 1008
