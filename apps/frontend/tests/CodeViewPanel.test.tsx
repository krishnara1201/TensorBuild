import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CodeViewPanel } from '../src/codeview/CodeViewPanel'

describe('CodeViewPanel', () => {
  it('renders the given code', () => {
    const { container } = render(<CodeViewPanel code="import pandas as pd" onClose={vi.fn()} />)
    expect(container.textContent).toContain('import pandas as pd')
  })

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn()
    render(<CodeViewPanel code="x = 1" onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name: /close/i }))

    expect(onClose).toHaveBeenCalledOnce()
  })
})
