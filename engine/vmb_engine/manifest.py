from pydantic import BaseModel, Field

from vmb_engine.ir import Port


class ParamSpec(BaseModel):
    name: str
    type: str
    label: str
    default: object = None
    options: list[str] | None = None


class NodeManifest(BaseModel):
    id: str
    category: str
    label: str
    inputs: list[Port] = Field(default_factory=list)
    outputs: list[Port] = Field(default_factory=list)
    params: list[ParamSpec] = Field(default_factory=list)
    long_running: bool = False
