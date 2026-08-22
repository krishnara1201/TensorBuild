import asyncio
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from vmb_engine.codegen import generate_code
from vmb_engine.executor import (
    ExecutorError,
    collect_metrics_outputs,
    execute_pipeline,
    pipeline_has_long_running_node,
)
from vmb_engine.ir import PipelineIR
from vmb_engine.registry import NodeRegistry, RegistryError
from vmb_engine.runs import RunManager

DEFAULT_NODES_DIR = Path(__file__).resolve().parent / "nodes"


def create_app(node_paths: list[Path] | None = None) -> FastAPI:
    registry = NodeRegistry()
    registry.scan(node_paths if node_paths is not None else [DEFAULT_NODES_DIR])
    run_manager = RunManager()

    app = FastAPI(title="Visual Model Builder Engine")

    # The frontend dev server (and, later, a Tauri webview loading it) runs
    # on a different origin than this API, so the browser enforces CORS:
    # without this, GET /nodes responses get silently discarded and POST
    # /pipeline/run and /pipeline/codegen preflight OPTIONS requests get a
    # 405 from the router. This must ship with the app, not stay dev-only
    # scaffolding, since the packaged app will hit the same-origin problem.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    @app.get("/nodes")
    def list_nodes():
        return [manifest.model_dump(mode="json") for manifest in registry.all()]

    @app.post("/pipeline/run")
    async def run_pipeline(ir: PipelineIR):
        try:
            if pipeline_has_long_running_node(ir, registry):
                run_id = run_manager.start(ir, registry)
                return JSONResponse(status_code=202, content={"run_id": run_id})
            context = await asyncio.to_thread(execute_pipeline, ir, registry)
        except (ExecutorError, RegistryError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        return {"metrics": collect_metrics_outputs(ir, registry, context)}

    @app.websocket("/ws/runs/{run_id}")
    async def stream_run_events(websocket: WebSocket, run_id: str):
        await websocket.accept()
        async for event in run_manager.stream(run_id):
            await websocket.send_json(event)
        await websocket.close()

    @app.post("/pipeline/codegen")
    def codegen_pipeline(ir: PipelineIR):
        try:
            code = generate_code(ir, registry)
        except (ExecutorError, RegistryError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return {"code": code}

    return app


app = create_app()
