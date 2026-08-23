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

  it('sets an inline overflow: auto style on every layout Panel so its content can scroll', () => {
    const { container } = render(
      <AppLayout
        palette={<div>Palette content</div>}
        canvas={<div>Canvas content</div>}
        inspector={<div>Inspector content</div>}
        output={<div>Output content</div>}
        visualizations={<div>Visualizations content</div>}
      />,
    )

    // react-resizable-panels applies `overflow: hidden` as an inline style
    // on each <Panel>, which beats a class-based `overflow: auto` rule in
    // the stylesheet. Only an inline style on the element itself can win —
    // a class-based assertion would not have caught this regression.
    const panels = container.querySelectorAll<HTMLElement>('.layout-panel')
    expect(panels.length).toBeGreaterThan(0)
    for (const panel of panels) {
      expect(panel.style.overflow).toBe('auto')
    }
  })
})
