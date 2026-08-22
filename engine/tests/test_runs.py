import asyncio

import pytest

from vmb_engine.runs import RunManager, RunNotFoundError


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
