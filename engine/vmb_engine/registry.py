import importlib.util
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from vmb_engine.manifest import NodeManifest


class RegistryError(Exception):
    pass


@dataclass
class NodeDef:
    manifest: NodeManifest
    execute: Callable[[dict, dict], dict]
    codegen: Callable[[dict, dict, dict], list[str]]
    imports: list[str]


class NodeRegistry:
    def __init__(self) -> None:
        self._nodes: dict[str, NodeDef] = {}

    def scan(self, paths: list[Path]) -> None:
        for base in paths:
            if not base.exists():
                continue
            for manifest_path in sorted(base.rglob("manifest.json")):
                self._load_plugin(manifest_path.parent)

    def _load_plugin(self, plugin_dir: Path) -> None:
        manifest_path = plugin_dir / "manifest.json"
        node_path = plugin_dir / "node.py"

        try:
            manifest = NodeManifest.model_validate(json.loads(manifest_path.read_text()))
        except Exception as exc:
            raise RegistryError(f"{plugin_dir}: invalid manifest.json: {exc}") from exc

        if manifest.id in self._nodes:
            raise RegistryError(f"{plugin_dir}: duplicate node id '{manifest.id}'")

        if not node_path.exists():
            raise RegistryError(f"{plugin_dir}: missing node.py")

        spec = importlib.util.spec_from_file_location(
            f"vmb_engine_plugin_{manifest.id.replace('.', '_')}", node_path
        )
        if spec is None or spec.loader is None:
            raise RegistryError(f"{plugin_dir}: could not load node.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        execute = getattr(module, "execute", None)
        codegen = getattr(module, "codegen", None)
        if execute is None:
            raise RegistryError(f"{plugin_dir}: node.py missing execute()")
        if codegen is None:
            raise RegistryError(f"{plugin_dir}: node.py missing codegen()")

        imports = getattr(module, "IMPORTS", [])

        self._nodes[manifest.id] = NodeDef(
            manifest=manifest, execute=execute, codegen=codegen, imports=imports
        )

    def get(self, node_type: str) -> NodeDef:
        if node_type not in self._nodes:
            raise RegistryError(f"unknown node type '{node_type}'")
        return self._nodes[node_type]

    def all(self) -> list[NodeManifest]:
        return [node_def.manifest for node_def in self._nodes.values()]
