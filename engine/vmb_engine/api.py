from pathlib import Path

from fastapi import FastAPI, HTTPException

from vmb_engine.codegen import generate_code
from vmb_engine.executor import ExecutorError, execute_pipeline
from vmb_engine.ir import PipelineIR
from vmb_engine.registry import NodeRegistry, RegistryError

DEFAULT_NODES_DIR = Path(__file__).resolve().parent / "nodes"


def create_app(node_paths: list[Path] | None = None) -> FastAPI:
    registry = NodeRegistry()
    registry.scan(node_paths if node_paths is not None else [DEFAULT_NODES_DIR])

    app = FastAPI(title="Visual Model Builder Engine")

    @app.get("/nodes")
    def list_nodes():
        return [manifest.model_dump(mode="json") for manifest in registry.all()]

    @app.post("/pipeline/run")
    def run_pipeline(ir: PipelineIR):
        try:
            context = execute_pipeline(ir, registry)
        except (ExecutorError, RegistryError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        nodes_by_id = {node.id: node for node in ir.nodes}
        metrics = {}
        for ref, value in context.items():
            node_id, port_name = ref.split(".", 1)
            node_def = registry.get(nodes_by_id[node_id].type)
            port = next((p for p in node_def.manifest.outputs if p.name == port_name), None)
            if port is not None and port.type == "Metrics":
                metrics[ref] = value

        return {"metrics": metrics}

    @app.post("/pipeline/codegen")
    def codegen_pipeline(ir: PipelineIR):
        try:
            code = generate_code(ir, registry)
        except (ExecutorError, RegistryError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return {"code": code}

    return app


app = create_app()
