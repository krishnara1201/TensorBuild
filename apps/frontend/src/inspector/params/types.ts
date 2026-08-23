import type { ParamSpec } from '../../api/types'

export type DynamicOptionsState =
  | { status: 'disconnected' }
  | { status: 'loading' }
  | { status: 'ready'; options: string[] }
  | { status: 'error'; message: string }

export interface ParamControlProps {
  spec: ParamSpec
  value: unknown
  onChange: (value: unknown) => void
  dynamicOptions?: DynamicOptionsState
}
