import asyncio
import uuid
from typing import AsyncIterator

from vmb_engine.executor import ExecutorError, collect_metrics_outputs, execute_pipeline
from vmb_engine.ir import PipelineIR
from vmb_engine.registry import NodeRegistry


class RunManager:
    def __init__(self) -> None:
        self._queues: dict[str, asyncio.Queue] = {}

    def start(self, ir: PipelineIR, registry: NodeRegistry) -> str:
        run_id = str(uuid.uuid4())
        queue: asyncio.Queue = asyncio.Queue()
        self._queues[run_id] = queue
        loop = asyncio.get_running_loop()

        def progress_callback(event: dict) -> None:
            loop.call_soon_threadsafe(queue.put_nowait, event)

        async def run() -> None:
            try:
                context = await asyncio.to_thread(
                    execute_pipeline, ir, registry, progress_callback
                )
            except ExecutorError:
                return
            metrics = collect_metrics_outputs(ir, registry, context)
            await queue.put({"event": "complete", "metrics": metrics})

        asyncio.create_task(run())
        return run_id

    async def stream(self, run_id: str) -> AsyncIterator[dict]:
        queue = self._queues[run_id]
        while True:
            event = await queue.get()
            yield event
            if event["event"] in ("complete", "node_error"):
                del self._queues[run_id]
                return
