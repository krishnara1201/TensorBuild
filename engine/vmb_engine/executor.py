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


def execute_pipeline(ir: PipelineIR, registry: NodeRegistry) -> dict[str, object]:
    order = topological_sort(ir)
    nodes_by_id = {node.id: node for node in ir.nodes}

    incoming_edges: dict[str, list] = defaultdict(list)
    for edge in ir.edges:
        to_node, to_port = split_ref(edge.to)
        incoming_edges[to_node].append((to_port, edge.from_))

    context: dict[str, object] = {}

    for node_id in order:
        node_spec = nodes_by_id[node_id]
        node_def = registry.get(node_spec.type)

        inputs = {}
        for port_name, from_ref in incoming_edges[node_id]:
            if from_ref not in context:
                raise ExecutorError(f"missing value for '{from_ref}' required by '{node_id}'")
            inputs[port_name] = context[from_ref]

        outputs = node_def.execute(inputs, node_spec.params)

        for port in node_def.manifest.outputs:
            if port.name not in outputs:
                raise ExecutorError(
                    f"node '{node_id}' did not produce declared output '{port.name}'"
                )
            context[f"{node_id}.{port.name}"] = outputs[port.name]

    return context
