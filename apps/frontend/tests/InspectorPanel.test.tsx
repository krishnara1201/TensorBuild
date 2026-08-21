import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InspectorPanel } from '../src/inspector/InspectorPanel'
import type { PipelineNode } from '../src/canvas/types'
import type { NodeManifest, ParamSpec } from '../src/api/types'

// InspectorPanel's param inputs are fully controlled by `node.data.params`.
// Rendering it with a static `node` prop (as a real controlled <input> requires
// value to be echoed back after each keystroke, or React reverts the DOM to the
// stale prop value) only exercises single-keystroke interactions correctly.
// This harness plays the role Task 10's App will play: it applies each
// onParamChange call back onto the node before re-rendering, so multi-keystroke
// interactions (clearing then retyping a number, typing a multi-character path)
// accumulate the way they will in the real app, while still letting every test
// assert on the exact (nodeId, paramName, value) arguments reported upward.
function Harness({
  initialNode,
  onParamChange,
}: {
  initialNode: PipelineNode
  onParamChange: (nodeId: string, paramName: string, value: unknown) => void
}) {
  const [node, setNode] = useState(initialNode)
  const handleParamChange = (nodeId: string, paramName: string, value: unknown) => {
    onParamChange(nodeId, paramName, value)
    setNode((prev) => ({
      ...prev,
      data: { ...prev.data, params: { ...prev.data.params, [paramName]: value } },
    }))
  }
  return <InspectorPanel node={node} onParamChange={handleParamChange} />
}

function manifestWithParam(param: ParamSpec): NodeManifest {
  return {
    id: 'test.node',
    category: 'Test',
    label: 'Test Node',
    inputs: [],
    outputs: [],
    params: [param],
    long_running: false,
  }
}

function nodeWithParam(param: ParamSpec, value: unknown): PipelineNode {
  return {
    id: 'n1',
    type: 'pipelineNode',
    position: { x: 0, y: 0 },
    data: { manifest: manifestWithParam(param), params: { [param.name]: value } },
  }
}

describe('InspectorPanel', () => {
  it('shows a placeholder when no node is selected', () => {
    render(<InspectorPanel node={null} onParamChange={vi.fn()} />)
    expect(screen.getByText(/select a node/i)).toBeInTheDocument()
  })

  it('renders a text control and reports changes', async () => {
    const onParamChange = vi.fn()
    const node = nodeWithParam({ name: 'path', type: 'text', label: 'File Path', default: '' }, '')
    render(<Harness initialNode={node} onParamChange={onParamChange} />)

    await userEvent.type(screen.getByLabelText('File Path'), 'a')

    expect(onParamChange).toHaveBeenCalledWith('n1', 'path', 'a')
  })

  it('renders a number control and reports changes', async () => {
    const onParamChange = vi.fn()
    const node = nodeWithParam(
      { name: 'n_estimators', type: 'number', label: 'N Estimators', default: 100 },
      100,
    )
    render(<Harness initialNode={node} onParamChange={onParamChange} />)

    const input = screen.getByLabelText('N Estimators')
    await userEvent.clear(input)
    await userEvent.type(input, '5')

    expect(onParamChange).toHaveBeenLastCalledWith('n1', 'n_estimators', 5)
  })

  it('renders a checkbox control and reports changes', async () => {
    const onParamChange = vi.fn()
    const node = nodeWithParam({ name: 'shuffle', type: 'checkbox', label: 'Shuffle', default: false }, false)
    render(<Harness initialNode={node} onParamChange={onParamChange} />)

    await userEvent.click(screen.getByLabelText('Shuffle'))

    expect(onParamChange).toHaveBeenCalledWith('n1', 'shuffle', true)
  })

  it('renders a select control with options and reports changes', async () => {
    const onParamChange = vi.fn()
    const spec: ParamSpec = {
      name: 'kernel',
      type: 'select',
      label: 'Kernel',
      default: 'linear',
      options: ['linear', 'rbf'],
    }
    const node = nodeWithParam(spec, 'linear')
    render(<Harness initialNode={node} onParamChange={onParamChange} />)

    await userEvent.selectOptions(screen.getByLabelText('Kernel'), 'rbf')

    expect(onParamChange).toHaveBeenCalledWith('n1', 'kernel', 'rbf')
  })

  it('falls back to a text control when a select has no options', async () => {
    const onParamChange = vi.fn()
    const spec: ParamSpec = { name: 'kernel', type: 'select', label: 'Kernel', default: '' }
    const node = nodeWithParam(spec, '')
    render(<Harness initialNode={node} onParamChange={onParamChange} />)

    const input = screen.getByLabelText('Kernel')
    expect(input.tagName).toBe('INPUT')
    await userEvent.type(input, 'x')

    expect(onParamChange).toHaveBeenCalledWith('n1', 'kernel', 'x')
  })

  it('renders a slider control with bounds and reports changes', () => {
    const onParamChange = vi.fn()
    const spec: ParamSpec = {
      name: 'test_size',
      type: 'slider',
      label: 'Test Size',
      default: 0.2,
      min: 0,
      max: 1,
      step: 0.1,
    }
    const node = nodeWithParam(spec, 0.2)
    render(<Harness initialNode={node} onParamChange={onParamChange} />)

    fireEvent.change(screen.getByLabelText('Test Size'), { target: { value: '0.5' } })

    expect(onParamChange).toHaveBeenCalledWith('n1', 'test_size', 0.5)
  })

  it('falls back to a number control when a slider has no bounds', () => {
    const onParamChange = vi.fn()
    const spec: ParamSpec = { name: 'test_size', type: 'slider', label: 'Test Size', default: 0.2 }
    const node = nodeWithParam(spec, 0.2)
    render(<Harness initialNode={node} onParamChange={onParamChange} />)

    expect(screen.getByLabelText('Test Size')).toHaveAttribute('type', 'number')
  })

  it('renders a file_picker control as a plain path input', async () => {
    const onParamChange = vi.fn()
    const spec: ParamSpec = { name: 'folder', type: 'file_picker', label: 'Folder', default: '' }
    const node = nodeWithParam(spec, '')
    render(<Harness initialNode={node} onParamChange={onParamChange} />)

    await userEvent.type(screen.getByLabelText('Folder'), '/tmp')

    expect(onParamChange).toHaveBeenCalledWith('n1', 'folder', '/tmp')
  })
})
