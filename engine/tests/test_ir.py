import json
from vmb_engine.ir import EdgeSpec, NodeSpec, PipelineIR


def test_node_spec_roundtrip():
    node = NodeSpec(id="n1", type="data.csv_loader", params={"path": "iris.csv"})
    assert node.id == "n1"
    assert node.type == "data.csv_loader"
    assert node.params == {"path": "iris.csv"}


def test_edge_spec_uses_from_alias():
    edge = EdgeSpec.model_validate({"from": "n1.table", "to": "n2.table"})
    assert edge.from_ == "n1.table"
    assert edge.to == "n2.table"
    # serializes back using the "from" alias, not "from_"
    dumped = edge.model_dump(by_alias=True)
    assert dumped == {"from": "n1.table", "to": "n2.table"}


def test_pipeline_ir_json_roundtrip():
    raw = {
        "nodes": [
            {"id": "n1", "type": "data.csv_loader", "params": {"path": "iris.csv"}},
            {"id": "n2", "type": "data.train_test_split", "params": {"test_size": 0.2}},
        ],
        "edges": [
            {"from": "n1.table", "to": "n2.table"},
        ],
    }
    ir = PipelineIR.model_validate(raw)
    assert len(ir.nodes) == 2
    assert len(ir.edges) == 1
    assert ir.nodes[0].id == "n1"
    assert ir.edges[0].from_ == "n1.table"

    dumped = json.loads(ir.model_dump_json(by_alias=True))
    assert dumped == raw
