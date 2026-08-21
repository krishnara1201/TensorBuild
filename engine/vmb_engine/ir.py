from pydantic import BaseModel, ConfigDict, Field, field_validator


class Port(BaseModel):
    name: str
    type: str


class NodeSpec(BaseModel):
    id: str
    type: str
    params: dict = Field(default_factory=dict)

    @field_validator("id")
    @classmethod
    def _validate_id(cls, v: str) -> str:
        if not v.isidentifier() or "." in v:
            raise ValueError(f"node id {v!r} must be a valid Python identifier")
        return v


class EdgeSpec(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    from_: str = Field(alias="from")
    to: str


class PipelineIR(BaseModel):
    nodes: list[NodeSpec] = Field(default_factory=list)
    edges: list[EdgeSpec] = Field(default_factory=list)
