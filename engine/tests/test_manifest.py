import json
from vmb_engine.manifest import NodeManifest


MANIFEST_JSON = {
    "id": "data.csv_loader",
    "category": "Data",
    "label": "CSV Loader",
    "inputs": [],
    "outputs": [{"name": "table", "type": "Table"}],
    "params": [
        {"name": "path", "type": "text", "label": "File Path", "default": ""}
    ],
}


def test_manifest_parses_ports_and_params():
    manifest = NodeManifest.model_validate(MANIFEST_JSON)
    assert manifest.id == "data.csv_loader"
    assert manifest.outputs[0].name == "table"
    assert manifest.outputs[0].type == "Table"
    assert manifest.params[0].name == "path"
    assert manifest.params[0].default == ""


def test_manifest_long_running_defaults_false():
    manifest = NodeManifest.model_validate(MANIFEST_JSON)
    assert manifest.long_running is False


def test_manifest_long_running_can_be_set():
    raw = dict(MANIFEST_JSON, long_running=True)
    manifest = NodeManifest.model_validate(raw)
    assert manifest.long_running is True
