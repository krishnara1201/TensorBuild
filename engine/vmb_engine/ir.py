from pydantic import BaseModel, ConfigDict, Field


class Port(BaseModel):
    name: str
    type: str


class NodeSpec(BaseModel):
    id: str
    type: str
    params: dict = Field(default_factory=dict)


class EdgeSpec(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    from_: str = Field(alias="from")
    to: str


class PipelineIR(BaseModel):
    nodes: list[NodeSpec] = Field(default_factory=list)
    edges: list[EdgeSpec] = Field(default_factory=list)
