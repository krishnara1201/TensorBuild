import type { ParamSpec } from '../../api/types'

export interface ParamControlProps {
  spec: ParamSpec
  value: unknown
  onChange: (value: unknown) => void
}
