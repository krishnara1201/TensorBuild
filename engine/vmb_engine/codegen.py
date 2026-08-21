from collections import defaultdict

from vmb_engine.executor import split_ref, topological_sort
from vmb_engine.ir import PipelineIR
from vmb_engine.registry import NodeRegistry


def generate_code(ir: PipelineIR, registry: NodeRegistry) -> str:
    order = topological_sort(ir)
    nodes_by_id = {node.id: node for node in ir.nodes}

    incoming_edges: dict[str, list] = defaultdict(list)
    for edge in ir.edges:
        to_node, to_port = split_ref(edge.to)
        incoming_edges[to_node].append((to_port, edge.from_))

    all_imports: set[str] = set()
    body_lines: list[str] = []

    for node_id in order:
        node_spec = nodes_by_id[node_id]
        node_def = registry.get(node_spec.type)
        all_imports.update(node_def.imports)

        input_vars = {}
        for port_name, from_ref in incoming_edges[node_id]:
            from_node, from_port = split_ref(from_ref)
            input_vars[port_name] = f"{from_node}_{from_port}"

        var_names = {port.name: f"{node_id}_{port.name}" for port in node_def.manifest.outputs}

        lines = node_def.codegen(input_vars, node_spec.params, var_names)
        body_lines.extend(lines)

    import_lines = sorted(all_imports)
    return "\n".join(import_lines) + "\n\n" + "\n".join(body_lines) + "\n"
