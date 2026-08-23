from collections import defaultdict, deque

from vmb_engine.ir import PipelineIR
from vmb_engine.registry import NodeRegistry


class ExecutorError(Exception):
    pass


def split_ref(ref: str) -> tuple[str, str]:
    node_id, _, port = ref.partition(".")
    return node_id, port


def topological_sort(ir: PipelineIR) -> list[str]:
    node_ids = [node.id for node in ir.nodes]
    node_id_set = set(node_ids)

    dependencies: dict[str, set[str]] = defaultdict(set)
    dependents: dict[str, set[str]] = defaultdict(set)

    for edge in ir.edges:
        from_node, _ = split_ref(edge.from_)
        to_node, _ = split_ref(edge.to)
        if from_node not in node_id_set:
            raise ExecutorError(f"edge references unknown node '{from_node}'")
        if to_node not in node_id_set:
            raise ExecutorError(f"edge references unknown node '{to_node}'")
        dependencies[to_node].add(from_node)
        dependents[from_node].add(to_node)

    in_degree = {node_id: len(dependencies[node_id]) for node_id in node_ids}
    queue = deque(sorted(node_id for node_id in node_ids if in_degree[node_id] == 0))

    order: list[str] = []
    while queue:
        current = queue.popleft()
        order.append(current)
        for dependent in sorted(dependents[current]):
            in_degree[dependent] -= 1
            if in_degree[dependent] == 0:
                queue.append(dependent)

    if len(order) != len(node_ids):
        raise ExecutorError("pipeline graph has a cycle")

    return order


def ancestors_of(ir: PipelineIR, target_node_id: str) -> set[str]:
    incoming: dict[str, set[str]] = defaultdict(set)
    for edge in ir.edges:
        from_node, _ = split_ref(edge.from_)
        to_node, _ = split_ref(edge.to)
        incoming[to_node].add(from_node)

    visited: set[str] = set()
    stack = [target_node_id]
    while stack:
        node_id = stack.pop()
        if node_id in visited:
            continue
        visited.add(node_id)
        stack.extend(incoming[node_id])
    return visited


class PreviewError(Exception):
    pass


def _execute_nodes(
    ir: PipelineIR,
    registry: NodeRegistry,
    node_ids: list[str],
    progress_callback=None,
) -> dict[str, object]:
    nodes_by_id = {node.id: node for node in ir.nodes}

    incoming_edges: dict[str, list] = defaultdict(list)
    for edge in ir.edges:
        to_node, to_port = split_ref(edge.to)
        incoming_edges[to_node].append((to_port, edge.from_))

    context: dict[str, object] = {}

    for node_id in node_ids:
        node_spec = nodes_by_id[node_id]
        node_def = registry.get(node_spec.type)

        inputs = {}
        for port_name, from_ref in incoming_edges[node_id]:
            if from_ref not in context:
                raise ExecutorError(f"missing value for '{from_ref}' required by '{node_id}'")
            inputs[port_name] = context[from_ref]

        for port in node_def.manifest.inputs:
            if port.name not in inputs:
                raise ExecutorError(
                    f"node '{node_id}' missing required input '{port.name}'"
                )

        def node_progress(event: dict, _node_id=node_id) -> None:
            if progress_callback is not None:
                progress_callback({**event, "node_id": _node_id})

        try:
            if node_def.manifest.long_running:
                outputs = node_def.execute(
                    inputs, node_spec.params, progress_callback=node_progress
                )
            else:
                outputs = node_def.execute(inputs, node_spec.params)
        except Exception as exc:
            node_progress({"event": "node_error", "error": str(exc)})
            raise ExecutorError(
                f"node '{node_id}' ({node_spec.type}) failed: {exc}"
            ) from exc

        for port in node_def.manifest.outputs:
            if port.name not in outputs:
                raise ExecutorError(
                    f"node '{node_id}' did not produce declared output '{port.name}'"
                )
            context[f"{node_id}.{port.name}"] = outputs[port.name]

    return context


def execute_pipeline(
    ir: PipelineIR,
    registry: NodeRegistry,
    progress_callback=None,
) -> dict[str, object]:
    order = topological_sort(ir)
    return _execute_nodes(ir, registry, order, progress_callback)


def execute_subgraph_preview(
    ir: PipelineIR,
    registry: NodeRegistry,
    target_node_id: str,
    port: str,
) -> dict:
    nodes_by_id = {node.id: node for node in ir.nodes}
    if target_node_id not in nodes_by_id:
        raise PreviewError(f"unknown node '{target_node_id}'")

    ancestor_ids = ancestors_of(ir, target_node_id)
    for node_id in ancestor_ids:
        if registry.get(nodes_by_id[node_id].type).manifest.long_running:
            raise PreviewError("cannot preview past a training node")

    target_manifest = registry.get(nodes_by_id[target_node_id].type).manifest
    port_spec = next((p for p in target_manifest.outputs if p.name == port), None)
    if port_spec is None or port_spec.type != "Table":
        raise PreviewError(f"node '{target_node_id}' has no Table output named '{port}'")

    order = [node_id for node_id in topological_sort(ir) if node_id in ancestor_ids]
    context = _execute_nodes(ir, registry, order)

    df = context[f"{target_node_id}.{port}"]
    sample = df.head(50)
    return {
        "columns": [{"name": str(col), "dtype": str(df[col].dtype)} for col in df.columns],
        "rows": sample.values.tolist(),
        "total_rows": len(df),
    }


def collect_metrics_outputs(
    ir: PipelineIR, registry: NodeRegistry, context: dict
) -> dict:
    nodes_by_id = {node.id: node for node in ir.nodes}
    metrics = {}
    for ref, value in context.items():
        node_id, port_name = ref.split(".", 1)
        node_def = registry.get(nodes_by_id[node_id].type)
        port = next((p for p in node_def.manifest.outputs if p.name == port_name), None)
        if port is not None and port.type == "Metrics":
            metrics[ref] = value
    return metrics


def pipeline_has_long_running_node(ir: PipelineIR, registry: NodeRegistry) -> bool:
    return any(registry.get(node.type).manifest.long_running for node in ir.nodes)
