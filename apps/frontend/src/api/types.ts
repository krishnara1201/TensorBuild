export interface Port {
  name: string
  type: string
}

export interface ParamSpec {
  name: string
  type: 'text' | 'number' | 'select' | 'file_picker' | 'checkbox' | 'slider'
  label: string
  default: unknown
  // Not sent by the engine today (see this plan's Global Constraints) —
  // optional for forward compatibility.
  options?: string[]
  min?: number
  max?: number
  step?: number
}

export interface NodeManifest {
  id: string
  category: string
  label: string
  inputs: Port[]
  outputs: Port[]
  params: ParamSpec[]
  long_running: boolean
}

export interface NodeSpec {
  id: string
  type: string
  params: Record<string, unknown>
}

export interface EdgeSpec {
  from: string
  to: string
}

export interface PipelineIR {
  nodes: NodeSpec[]
  edges: EdgeSpec[]
}

export type RunOutcome =
  | { kind: 'sync'; metrics: Record<string, unknown> }
  | { kind: 'async'; runId: string }

export interface CodegenResult {
  code: string
}
