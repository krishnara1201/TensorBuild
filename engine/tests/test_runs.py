import asyncio
from pathlib import Path

import pytest

from vmb_engine.ir import PipelineIR
from vmb_engine.registry import NodeRegistry
from vmb_engine.runs import RunManager, RunNotFoundError

NODES_DIR = Path(__file__).resolve().parents[1] / "vmb_engine" / "nodes"


def test_stream_unknown_run_id_raises_run_not_found_error():
    manager = RunManager()

    async def _consume():
        async for _event in manager.stream("does-not-exist"):
            pass

    with pytest.raises(RunNotFoundError):
        asyncio.run(_consume())


def test_stream_cleans_up_queue_on_early_disconnect():
    manager = RunManager()
    run_id = "fake-run"
    manager._queues[run_id] = asyncio.Queue()

    async def _scenario():
        manager._queues[run_id].put_nowait({"event": "progress", "epoch": 0})
        events = manager.stream(run_id)
        await events.__anext__()
        assert run_id in manager._queues
        await events.aclose()

    asyncio.run(_scenario())

    assert run_id not in manager._queues


def test_stream_cleans_up_queue_on_normal_completion():
    manager = RunManager()
    run_id = "fake-run-2"
    manager._queues[run_id] = asyncio.Queue()

    async def _scenario():
        manager._queues[run_id].put_nowait({"event": "complete", "metrics": {}})
        async for _event in manager.stream(run_id):
            pass

    asyncio.run(_scenario())

    assert run_id not in manager._queues


def test_run_emits_node_error_event_on_pre_execution_executor_error():
    # An edge pointing at a node id that isn't in the pipeline makes
    # topological_sort raise ExecutorError before any node ever executes —
    # RunManager.run() must still emit a node_error event over the queue,
    # not swallow the error and leave stream() hanging forever.
    registry = NodeRegistry()
    registry.scan([NODES_DIR])
    ir = PipelineIR.model_validate(
        {
            "nodes": [{"id": "n1", "type": "data.csv_loader", "params": {"path": "unused.csv"}}],
            "edges": [{"from": "n1.table", "to": "does_not_exist.table"}],
        }
    )
    manager = RunManager()

    async def _scenario():
        run_id = manager.start(ir, registry)
        events = manager.stream(run_id)
        return await asyncio.wait_for(events.__anext__(), timeout=2.0)

    event = asyncio.run(_scenario())

    assert event["event"] == "node_error"
    assert "does_not_exist" in event["error"]
