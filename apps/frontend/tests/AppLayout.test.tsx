import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AppLayout } from '../src/layout/AppLayout'

describe('AppLayout', () => {
  it('renders all five zones', () => {
    render(
      <AppLayout
        palette={<div>Palette content</div>}
        canvas={<div>Canvas content</div>}
        inspector={<div>Inspector content</div>}
        output={<div>Output content</div>}
        visualizations={<div>Visualizations content</div>}
      />,
    )

    expect(screen.getByText('Palette content')).toBeInTheDocument()
    expect(screen.getByText('Canvas content')).toBeInTheDocument()
    expect(screen.getByText('Inspector content')).toBeInTheDocument()
    expect(screen.getByText('Output content')).toBeInTheDocument()
    expect(screen.getByText('Visualizations content')).toBeInTheDocument()
  })
})
