import asyncio
import uuid
from typing import AsyncIterator

from vmb_engine.executor import ExecutorError, collect_metrics_outputs, execute_pipeline
from vmb_engine.ir import PipelineIR
from vmb_engine.registry import NodeRegistry


class RunNotFoundError(Exception):
    """Raised when streaming events for an unknown or already-consumed run_id."""


class RunManager:
    def __init__(self) -> None:
        self._queues: dict[str, asyncio.Queue] = {}
        # asyncio only holds a weak reference to a task, so a fire-and-forget
        # task with no other referent can be garbage-collected mid-run; this
        # set is the standard idiom to keep it alive until it finishes.
        self._tasks: set[asyncio.Task] = set()

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
            except ExecutorError as exc:
                await queue.put({"event": "node_error", "error": str(exc)})
                return
            metrics = collect_metrics_outputs(ir, registry, context)
            await queue.put({"event": "complete", "metrics": metrics})

        task = asyncio.create_task(run())
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return run_id

    async def stream(self, run_id: str) -> AsyncIterator[dict]:
        try:
            queue = self._queues[run_id]
        except KeyError:
            raise RunNotFoundError(run_id) from None
        try:
            while True:
                event = await queue.get()
                yield event
                if event["event"] in ("complete", "node_error"):
                    return
        finally:
            # Runs even if the consumer disconnects before a terminal event
            # arrives (GeneratorExit from an early aclose()), not just on
            # normal completion — otherwise an abandoned WS connection leaks
            # this queue forever.
            self._queues.pop(run_id, None)
