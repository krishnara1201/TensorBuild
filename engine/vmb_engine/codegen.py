from collections import defaultdict

from vmb_engine.executor import ExecutorError, split_ref, topological_sort
from vmb_engine.ir import PipelineIR
from vmb_engine.registry import NodeRegistry


def _slug(node_type: str) -> str:
    return node_type.rsplit(".", 1)[-1]


def _var_prefixes(ir: PipelineIR) -> dict[str, str]:
    """Map each node id to a readable variable-name prefix.

    Nodes get their type slug (e.g. "random_forest") when it's unique in
    the pipeline; colliding slugs fall back to slug + node id so variable
    names stay both readable and guaranteed unique.
    """
    slugs = {node.id: _slug(node.type) for node in ir.nodes}
    slug_counts: dict[str, int] = defaultdict(int)
    for slug in slugs.values():
        slug_counts[slug] += 1

    return {
        node_id: slug if slug_counts[slug] == 1 else f"{slug}_{node_id}"
        for node_id, slug in slugs.items()
    }


def generate_code(ir: PipelineIR, registry: NodeRegistry) -> str:
    order = topological_sort(ir)
    nodes_by_id = {node.id: node for node in ir.nodes}
    var_prefixes = _var_prefixes(ir)

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
            input_vars[port_name] = f"{var_prefixes[from_node]}_{from_port}"

        prefix = var_prefixes[node_id]
        var_names = {port.name: f"{prefix}_{port.name}" for port in node_def.manifest.outputs}

        try:
            lines = node_def.codegen(input_vars, node_spec.params, var_names)
        except Exception as exc:
            raise ExecutorError(
                f"node '{node_id}' ({node_spec.type}) codegen failed: {exc}"
            ) from exc

        if body_lines:
            body_lines.append("")
        body_lines.append(f"# --- {node_def.manifest.label} ({node_id}) ---")
        body_lines.extend(lines)

    import_lines = sorted(all_imports)
    return "\n".join(import_lines) + "\n\n" + "\n".join(body_lines) + "\n"
